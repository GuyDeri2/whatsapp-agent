/**
 * WhatsApp Session Manager.
 * Manages the lifecycle of Baileys WhatsApp sessions per tenant:
 *   - Start/stop sessions
 *   - QR code generation
 *   - Auto-reconnection
 *   - Message routing to the handler
 */

import {
    makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage,
    WASocket,
    Browsers,
} from "@whiskeysockets/baileys";
import { proto } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import { useSupabaseAuthState, clearSessionData, flushCacheToDB, stopBackgroundSync } from "./session-store";
import { handleIncomingMessage, clearPendingAiReply, setLidResolver, markOwnerSent } from "./message-handler";
// Inject LID resolver so message-handler can re-resolve JIDs at send time
setLidResolver((tenantId, jid) => resolveLidJid(tenantId, jid));
import { transcribeAudioBuffer } from "./transcribe";

// ─── Types ────────────────────────────────────────────────────────────
interface SessionInfo {
    socket: WASocket;
    qrCode: string | null;
    status: "connecting" | "connected" | "disconnected";
    tenantId: string;
    retryCount: number;
    preKeyErrors: number; // track PreKey errors to decide when to reset
}

type QRUpdateCallback = (tenantId: string, qrDataUrl: string | null) => void;

// ─── State ────────────────────────────────────────────────────────────
const sessions = new Map<string, SessionInfo>();
const MAX_RETRIES = 5;
const MAX_PREKEY_ERRORS = 50; // after this many PreKeyErrors, clear session and reconnect (raised from 10 — PreKey errors self-resolve via Baileys renegotiation)

/**
 * Tracks tenants that are currently in the process of reconnecting.
 * Used by the watchdog cron to avoid triggering a second concurrent reconnect.
 */
const _reconnecting = new Set<string>();

/** Returns true if the given tenant is currently in a reconnect cycle. */
export function isReconnecting(tenantId: string): boolean {
    return _reconnecting.has(tenantId);
}

/** Track periodic intervals per tenant so we can clean them up on reconnect */
const profilePicIntervals = new Map<string, NodeJS.Timeout>();

/** Track presence heartbeat intervals per tenant (prevents WhatsApp idle disconnects) */
const presenceHeartbeatIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Interval for sending presence heartbeats to WhatsApp.
 * WhatsApp servers distinguish between WebSocket pings (transport-level) and
 * XMPP presence stanzas (application-level). A connection that only sends
 * WebSocket pings but never any XMPP-level activity may be treated as stale
 * and disconnected (typically with code 408).
 * Sending "available" every 5 minutes keeps the XMPP session active.
 */
const PRESENCE_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Cache group metadata to avoid fetching from WhatsApp on every message */
const groupMetadataCache = new Map<string, { subject: string; fetchedAt: number }>();
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Track which conversations we've already checked for profile pics this session */
const profilePicChecked = new Set<string>();
// Prune profilePicChecked every 24 hours to prevent unbounded growth
setInterval(() => {
    const sizeBefore = profilePicChecked.size;
    profilePicChecked.clear();
    if (sizeBefore > 0) console.log(`[cleanup] 🧹 Cleared ${sizeBefore} entries from profilePicChecked set`);
}, 24 * 60 * 60 * 1000).unref();

/**
 * Track whether the initial post-connect sync (profile pics, group names, etc.)
 * has already been run for each tenant. Reset only when a session is fully stopped
 * (not on auto-reconnect) so we never re-run the expensive bulk calls after a drop.
 */
const hasRunInitialSync = new Set<string>();

/**
 * Hard lock: prevents concurrent or duplicate invocations of resolveProfilePictures.
 * A second invocation (e.g. from the 6-hour periodic interval firing while the first
 * batch is still running) would double-flood WhatsApp and cause a 408 disconnect.
 */
const _profilePicRunning = new Set<string>();

/** Minimum time (ms) a connection must be alive before the bulk sync is allowed. */
const INITIAL_SYNC_MIN_AGE_MS = 30_000; // 30 seconds

/** Timestamp of the most recent "open" connection event per tenant. */
const connectedAt = new Map<string, number>();

/** Helper: resolves after `ms` milliseconds. */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Memory cache for phonebook contacts */
const tenantContactsCache = new Map<string, Map<string, string>>();

export function getCachedContactName(tenantId: string, phoneNumber: string): string | null {
    const cache = tenantContactsCache.get(tenantId);
    return cache ? (cache.get(phoneNumber) || null) : null;
}

/**
 * LID → real phone mapping.
 * WhatsApp assigns pseudo-IDs (e.g. 240213326622964@lid) to some accounts.
 * Baileys exposes both `lid` and `jid` on Contact objects, letting us resolve them.
 */
const tenantLidToPhone = new Map<string, Map<string, string>>();

function buildLidMapping(tenantId: string, contact: { id?: string; lid?: string; jid?: string }): void {
    let lidJid: string | null = null;
    let phoneJid: string | null = null;

    if (contact.id?.endsWith("@s.whatsapp.net") && contact.lid?.endsWith("@lid")) {
        // Primary ID is phone JID; lid field has the LID
        phoneJid = contact.id;
        lidJid = contact.lid;
    } else if (contact.id?.endsWith("@lid") && contact.jid?.endsWith("@s.whatsapp.net")) {
        // Primary ID is LID; jid field has the real phone JID
        lidJid = contact.id;
        phoneJid = contact.jid;
    }

    if (!lidJid || !phoneJid) return;

    let map = tenantLidToPhone.get(tenantId);
    if (!map) {
        map = new Map();
        tenantLidToPhone.set(tenantId, map);
    }
    const lidNum = lidJid.split("@")[0];
    const phoneNum = phoneJid.split("@")[0];
    if (map.get(lidNum) !== phoneNum) {
        map.set(lidNum, phoneNum);
        console.log(`[${tenantId}] 🔗 LID resolved: ${lidNum} → ${phoneNum}`);
    }
}

/**
 * Reverse-lookup a contact's phone number by their WhatsApp display name (pushName).
 * Returns the phone number only when exactly ONE contact in the cache has that name,
 * to avoid false matches. Returns null if ambiguous or not found.
 */
function findPhoneByPushName(tenantId: string, pushName: string): string | null {
    const cache = tenantContactsCache.get(tenantId);
    if (!cache) return null;
    const nameLower = pushName.toLowerCase();
    let match: string | null = null;
    let count = 0;
    for (const [phone, name] of cache) {
        // Skip LID-like numbers (≥ 14 digits) — they are not valid phone numbers
        if (phone.length >= 14) continue;
        if (name.toLowerCase() === nameLower) {
            match = phone;
            if (++count > 1) return null; // ambiguous
        }
    }
    return count === 1 ? match : null;
}

/**
 * Rename a conversation stored under a LID phone number to the real phone number.
 * Skips if a conversation with the real phone already exists (no merge needed for now).
 */
async function fixLidConversation(tenantId: string, lidNum: string, realPhone: string): Promise<void> {
    const supabase = getSupabase();

    const { data: lidConv } = await supabase
        .from("conversations").select("id")
        .eq("tenant_id", tenantId).eq("phone_number", lidNum).maybeSingle();
    if (!lidConv) return; // Nothing to fix

    const { data: realConv } = await supabase
        .from("conversations").select("id")
        .eq("tenant_id", tenantId).eq("phone_number", realPhone).maybeSingle();

    if (!realConv) {
        // Simple case: no real-phone conversation yet — rename LID conversation
        await supabase.from("conversations")
            .update({ phone_number: realPhone }).eq("id", lidConv.id);
        console.log(`[${tenantId}] ✅ LID conversation renamed: ${lidNum} → ${realPhone}`);
    } else {
        // Both exist: move messages from LID conversation to real one, then delete LID
        await supabase.from("messages")
            .update({ conversation_id: realConv.id }).eq("conversation_id", lidConv.id);
        await supabase.from("conversations").delete().eq("id", lidConv.id);
        console.log(`[${tenantId}] 🔀 LID conversation merged into real: ${lidNum} → ${realPhone}`);
    }
}

/**
 * If `jid` ends with `@lid`, return the resolved `PHONE@s.whatsapp.net` JID.
 * Otherwise return `jid` unchanged.
 */
export function resolveLidJid(tenantId: string, jid: string): string {
    if (!jid.endsWith("@lid")) return jid;
    const lidNum = jid.split("@")[0];
    const map = tenantLidToPhone.get(tenantId);
    const realPhone = map?.get(lidNum);
    return realPhone ? `${realPhone}@s.whatsapp.net` : jid;
}

/** Save contacts cache to DB */
async function saveContactsToDB(tenantId: string) {
    const cache = tenantContactsCache.get(tenantId);
    if (!cache || cache.size === 0) return;
    try {
        await getSupabase().from("whatsapp_sessions").upsert(
            { tenant_id: tenantId, session_key: "contacts", session_data: Object.fromEntries(cache) },
            { onConflict: "tenant_id,session_key" }
        );
    } catch (err) {
        console.error(`[${tenantId}] Failed to save contacts to DB:`, err);
    }
}

/** Sync the RAM contact cache to the conversations table retroactively */
async function syncCachedContactsToDB(tenantId: string) {
    const cache = tenantContactsCache.get(tenantId);
    if (!cache || cache.size === 0) return;

    try {
        const supabase = getSupabase();
        const { data: conversations } = await supabase
            .from("conversations")
            .select("id, phone_number, contact_name, is_saved_contact")
            .eq("tenant_id", tenantId);

        if (!conversations) return;

        let updatedCount = 0;
        for (const conv of conversations) {
            const cachedName = cache.get(conv.phone_number);
            if (cachedName) {
                // If it's in the phonebook, update name and ensure it's marked as saved
                if (conv.contact_name !== cachedName || !conv.is_saved_contact) {
                    await supabase
                        .from("conversations")
                        .update({ contact_name: cachedName, is_saved_contact: true })
                        .eq("id", conv.id);
                    updatedCount++;
                }
            }
        }
        if (updatedCount > 0) {
            console.log(`[${tenantId}] 🔄 Retroactively synced ${updatedCount} existing contacts from cache to DB.`);
        }
    } catch (err) {
        console.error(`[${tenantId}] Error syncing cached contacts to DB:`, err);
    }
}

/** Load contacts cache from DB */
async function loadContactsFromDB(tenantId: string) {
    try {
        const { data } = await getSupabase()
            .from("whatsapp_sessions")
            .select("session_data")
            .eq("tenant_id", tenantId)
            .eq("session_key", "contacts")
            .single();

        if (data?.session_data) {
            const cacheMap = new Map<string, string>(Object.entries(data.session_data));
            tenantContactsCache.set(tenantId, cacheMap);
            console.log(`[${tenantId}] 📇 Loaded ${cacheMap.size} contacts from database into RAM.`);
        }
    } catch (err) {
        // Normal if 'contacts' session_key doesn't exist yet
    }
}

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
    if (!_supabase)
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    return _supabase;
}

// QR update callbacks (supports multiple SSE clients)
const _qrCallbacks = new Set<QRUpdateCallback>();

export function setQRUpdateCallback(cb: QRUpdateCallback) {
    _qrCallbacks.add(cb);
}

export function removeQRUpdateCallback(cb: QRUpdateCallback) {
    _qrCallbacks.delete(cb);
}

function notifyQRUpdate(tenantId: string, qrDataUrl: string | null) {
    for (const cb of _qrCallbacks) {
        try { cb(tenantId, qrDataUrl); } catch { /* ignore dead SSE connections */ }
    }
}

// ─── Logger ───────────────────────────────────────────────────────────
const logger = pino({ level: "warn" });

// ─── Human-like send wrapper ──────────────────────────────────────────
// Simulates typing before each AI reply so the connection looks human.
function makeHumanSend(socket: WASocket) {
    return async (jid: string, content: { text: string }) => {
        // Only simulate typing for individual chats (not groups / system JIDs)
        if (jid.endsWith("@s.whatsapp.net")) {
            // Pre-establish the Signal encryption session so the recipient never
            // sees "בהמתנה להודעה זו" (waiting for message / clock icon).
            // assertSessions(false) fetches keys only if not already cached.
            // Wrapped in try-catch with timeout — a failure here must not block the send
            // or cause unhandled rejections that destabilise the Baileys socket.
            try {
                await Promise.race([
                    socket.assertSessions([jid], false),
                    new Promise<void>((_, reject) =>
                        setTimeout(() => reject(new Error("assertSessions timeout")), 5_000)
                    ),
                ]);
            } catch (assertErr: any) {
                console.warn(`[makeHumanSend] assertSessions skipped: ${assertErr.message}`);
            }

            const words = content.text.trim().split(/\s+/).length;
            // ~80 wpm typing speed, capped at 3s, plus 0-500ms random jitter
            const typingMs = Math.min(Math.ceil((words / 80) * 60_000), 3_000)
                + Math.floor(Math.random() * 500);
            await socket.sendPresenceUpdate("composing", jid);
            await new Promise((r) => setTimeout(r, typingMs));
            // Set "available" before sending so WhatsApp clears the composing state
            // immediately when the message arrives — eliminates the ~2s pending clock
            await socket.sendPresenceUpdate("available", jid);
        }
        return socket.sendMessage(jid, content);
    };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Start a new WhatsApp session for a tenant.
 * Returns immediately — QR code will be available via getSessionInfo().
 */
export async function startSession(tenantId: string): Promise<void> {
    if (sessions.has(tenantId)) {
        const existing = sessions.get(tenantId)!;
        if (existing.status === "connected") {
            console.log(`[${tenantId}] Session already connected`);
            return;
        }
        // If disconnected, clean up before reconnecting
        try {
            existing.socket.end(undefined);
        } catch { /* ignore */ }
        sessions.delete(tenantId);
    }

    console.log(`[${tenantId}] Starting new WhatsApp session...`);
    await createSession(tenantId);
}

/**
 * Stop a session and optionally clear stored auth data.
 */
export async function stopSession(
    tenantId: string,
    clearData = false
): Promise<void> {
    const session = sessions.get(tenantId);
    if (session) {
        if (clearData) {
            // User explicitly wants to disconnect — logout invalidates the session
            try { await session.socket.logout(); } catch { /* ignore */ }
        } else {
            // Server shutdown / routine stop — just close the socket, KEEP auth valid
            try { session.socket.end(undefined); } catch { /* ignore */ }
        }
        sessions.delete(tenantId);
    }

    // Clear periodic intervals to prevent memory leak on reconnect
    const picInterval = profilePicIntervals.get(tenantId);
    if (picInterval) {
        clearInterval(picInterval);
        profilePicIntervals.delete(tenantId);
    }
    const heartbeat = presenceHeartbeatIntervals.get(tenantId);
    if (heartbeat) {
        clearInterval(heartbeat);
        presenceHeartbeatIntervals.delete(tenantId);
    }

    // Reset the initial-sync guard so a fresh QR-scan triggers sync again
    hasRunInitialSync.delete(tenantId);
    connectedAt.delete(tenantId);

    // Flush any pending cache writes to DB so creds are fully saved
    await flushCacheToDB(tenantId);
    stopBackgroundSync(tenantId);

    if (clearData) {
        await clearSessionData(tenantId);
        tenantContactsCache.delete(tenantId); // Clear contact RAM map too
    }

    // Update tenant status
    await getSupabase()
        .from("tenants")
        .update({ whatsapp_connected: false })
        .eq("id", tenantId);

    console.log(`[${tenantId}] Session stopped (clearData: ${clearData})`);
}

/**
 * Force-reconnect: stop session, optionally clear auth, and restart.
 */
// Track last reconnect time per tenant to prevent spam
const lastReconnectTime = new Map<string, number>();
const RECONNECT_COOLDOWN_MS = 30000; // 30 seconds minimum between reconnects

export async function reconnectSession(
    tenantId: string,
    clearAuth = false
): Promise<void> {
    // Prevent rapid reconnect spam that causes notification floods
    const now = Date.now();
    const lastTime = lastReconnectTime.get(tenantId) || 0;
    if (now - lastTime < RECONNECT_COOLDOWN_MS) {
        const waitSec = Math.ceil((RECONNECT_COOLDOWN_MS - (now - lastTime)) / 1000);
        console.log(`[${tenantId}] ⏳ Reconnect cooldown — wait ${waitSec}s before trying again`);
        throw new Error(`Reconnect cooldown active. Try again in ${waitSec} seconds.`);
    }
    lastReconnectTime.set(tenantId, now);

    console.log(`[${tenantId}] 🔄 Force reconnecting (clearAuth: ${clearAuth})...`);
    const session = sessions.get(tenantId);
    if (session) {
        // Flush pending writes before disconnecting
        await flushCacheToDB(tenantId);
        stopBackgroundSync(tenantId);
        try { session.socket.end(undefined); } catch { /* ignore */ }
        sessions.delete(tenantId);
    }
    if (clearAuth) {
        await clearSessionData(tenantId);
        tenantContactsCache.delete(tenantId);
    }
    await getSupabase()
        .from("tenants")
        .update({ whatsapp_connected: false })
        .eq("id", tenantId);
    // Wait 5 seconds to let WhatsApp server settle
    await new Promise((r) => setTimeout(r, 5000));
    await startSession(tenantId);
}

/**
 * Get info about a session.
 */
export function getSessionInfo(tenantId: string): {
    status: string;
    qrCode: string | null;
} {
    const session = sessions.get(tenantId);
    if (!session) return { status: "not_started", qrCode: null };
    return { status: session.status, qrCode: session.qrCode };
}

/** Get all active session IDs. */
export function getActiveSessions(): string[] {
    return Array.from(sessions.keys());
}

/**
 * Probe a connected session's health by sending a lightweight presence update.
 * Returns true if the socket responds, false if it's a zombie (dead but still in map).
 * Used by the watchdog to detect and restart stale connections.
 */
export async function probeSessionHealth(tenantId: string): Promise<boolean> {
    const session = sessions.get(tenantId);
    if (!session || session.status !== "connected") return false;
    try {
        await Promise.race([
            session.socket.sendPresenceUpdate("available"),
            new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error("probe timeout")), 10_000)
            ),
        ]);
        return true;
    } catch {
        return false;
    }
}

export async function sendMessage(tenantId: string, jid: string, text: string): Promise<string> {
    const session = sessions.get(tenantId);
    if (!session || session.status !== "connected") {
        throw new Error("Session not connected");
    }

    // 1. Send via Baileys
    const sentMsg = await session.socket.sendMessage(jid, { text });
    const waMessageId = sentMsg?.key?.id || "unknown";

    // Suppress the Baileys echo (fromMe=true upsert) that fires almost immediately
    // after sendMessage(). Without this, handleIncomingMessage would treat the echo
    // as a new owner message and save it a second time (race condition).
    if (waMessageId !== "unknown") {
        markOwnerSent(waMessageId);
    }

    // 2. Save to DB as owner message
    const supabase = getSupabase();
    const phoneNumber = jid.split("@")[0];

    // Ensure conversation exists and update its timestamp
    const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .upsert(
            { tenant_id: tenantId, phone_number: phoneNumber, updated_at: new Date().toISOString() },
            { onConflict: "tenant_id,phone_number" }
        )
        .select("id")
        .single();

    if (conversation && !convError) {
        // Clear any pending AI reply since the owner just replied manually
        clearPendingAiReply(tenantId, conversation.id);

        await supabase.from("messages").insert({
            conversation_id: conversation.id,
            tenant_id: tenantId,
            role: "owner",
            content: text,
            sender_name: "Owner",
            is_from_agent: false,
            wa_message_id: waMessageId !== "unknown" ? waMessageId : null,
            status: "sent"
        });
    }

    return waMessageId;
}

/**
 * Normalize any phone number string to international format (digits only, e.g. 972526991415).
 * Handles: 05x..., +972..., 972..., with spaces/dashes/parentheses.
 */
export function normalizePhone(raw: string): string {
    // Remove everything except digits and leading +
    let s = raw.replace(/[^\d+]/g, "");
    // Strip leading +
    s = s.replace(/^\+/, "");
    // Israeli local: 05XXXXXXXX (10 digits starting with 0)
    if (s.startsWith("0") && s.length === 10) {
        s = "972" + s.substring(1);
    }
    return s;
}

/**
 * Check whether a phone number is registered on WhatsApp.
 * Returns the canonical JID if found, null if not found, or throws if no active session.
 */
export async function checkWhatsAppNumber(tenantId: string, phone: string): Promise<string | null> {
    const session = sessions.get(tenantId);
    if (!session || session.status !== "connected") {
        throw new Error("No active WhatsApp session for this tenant");
    }
    const normalized = normalizePhone(phone);
    const results = await session.socket.onWhatsApp(normalized);
    if (results && results.length > 0 && results[0].exists) {
        return results[0].jid;
    }
    return null;
}

/**
 * Restore all previously connected sessions on server start.
 */
export async function restoreAllSessions(): Promise<void> {
    // Find all tenants that have saved WhatsApp auth state (creds)
    const { data: sessionsWithCreds } = await getSupabase()
        .from("whatsapp_sessions")
        .select("tenant_id")
        .eq("session_key", "creds");

    if (!sessionsWithCreds || sessionsWithCreds.length === 0) {
        console.log("No sessions to restore");
        return;
    }

    const uniqueTenants = [...new Set(sessionsWithCreds.map((s) => s.tenant_id))];

    console.log(`Restoring ${uniqueTenants.length} session(s)...`);
    for (const tenantId of uniqueTenants) {
        try {
            await startSession(tenantId);
            // small delay between starts to avoid rate-limiting
            await new Promise((r) => setTimeout(r, 2000));
        } catch (err) {
            console.error(`Failed to restore session for tenant ${tenantId}:`, err);
        }
    }
}

// ─── Resolve group names from WhatsApp ────────────────────────────────
const _groupNamesRunning = new Set<string>();

async function resolveGroupNames(tenantId: string, socket: WASocket): Promise<void> {
    // Prevent concurrent runs (setTimeout on connect + isLatest history sync can overlap)
    if (_groupNamesRunning.has(tenantId)) {
        console.log(`[${tenantId}] 🏷️ Skipping group name resolution — already running`);
        return;
    }
    _groupNamesRunning.add(tenantId);
    try {
        const supabase = getSupabase();
        // Find all group conversations without a name
        const { data: namelessGroups } = await supabase
            .from("conversations")
            .select("id, phone_number")
            .eq("tenant_id", tenantId)
            .eq("is_group", true)
            .is("contact_name", null);

        if (!namelessGroups || namelessGroups.length === 0) return;

        // Cap batch size and add inter-request delay to avoid WhatsApp bulk-activity detection (408)
        const MAX_GROUP_RESOLVE_BATCH = 10;
        const batch = namelessGroups.slice(0, MAX_GROUP_RESOLVE_BATCH);
        console.log(`[${tenantId}] 🏷️ Resolving names for ${batch.length} groups (of ${namelessGroups.length} total)...`);
        let resolved = 0;

        for (const group of batch) {
            try {
                // Reconstruct the JID: phone_number + @g.us
                const jid = group.phone_number + "@g.us";
                const metadata = await socket.groupMetadata(jid);
                if (metadata?.subject) {
                    await supabase
                        .from("conversations")
                        .update({ contact_name: metadata.subject })
                        .eq("id", group.id);
                    resolved++;
                }
            } catch {
                // Group might not exist anymore or access denied
            }
            // 3-second delay between calls to avoid WhatsApp bulk-activity detection
            await delay(3_000);
        }

        console.log(`[${tenantId}] ✅ Resolved ${resolved}/${batch.length} group names`);
    } catch (err) {
        console.error(`[${tenantId}] Error resolving group names:`, err);
    } finally {
        _groupNamesRunning.delete(tenantId);
    }
}

// ─── Resolve LID JIDs for existing conversations ─────────────────────
/**
 * Calls socket.onWhatsApp() with all real phone numbers we have in the
 * conversations table. The API returns { jid, lid } for each — letting
 * us build the LID→phone map AND retroactively rename any conversation
 * that was stored under a LID instead of the real phone number.
 *
 * LID numbers are always ≥15 digits; real phone numbers are ≤13 digits.
 */
async function resolveLidPhoneMappings(tenantId: string, socket: any): Promise<void> {
    const supabase = getSupabase();

    const { data: conversations } = await supabase
        .from("conversations")
        .select("id, phone_number")
        .eq("tenant_id", tenantId)
        .eq("is_group", false);

    if (!conversations || conversations.length === 0) return;

    const realPhones = conversations
        .map(c => c.phone_number as string)
        .filter(p => p.length <= 13); // real phone numbers ≤ 13 digits; LIDs ≥ 15

    const lidConversations = conversations.filter(c => (c.phone_number as string).length >= 15);

    if (realPhones.length > 0) {
        try {
            // onWhatsApp returns [{ jid, exists, lid }] — batch in chunks of 50
            const CHUNK = 50;
            for (let i = 0; i < realPhones.length; i += CHUNK) {
                const chunk = realPhones.slice(i, i + CHUNK);
                const results: Array<{ jid: string; lid?: string; exists: boolean }> =
                    await socket.onWhatsApp(...chunk);

                for (const r of results || []) {
                    if (!r.lid || !r.jid) continue;
                    const lidNum = r.lid.split("@")[0];
                    const phoneNum = r.jid.split("@")[0];

                    let map = tenantLidToPhone.get(tenantId);
                    if (!map) { map = new Map(); tenantLidToPhone.set(tenantId, map); }
                    map.set(lidNum, phoneNum);
                    console.log(`[${tenantId}] 🔗 LID resolved via onWhatsApp: ${lidNum} → ${phoneNum}`);
                }
                // Delay between chunks to avoid WhatsApp rate limiting
                if (i + CHUNK < realPhones.length) await delay(3_000);
            }
        } catch (err: any) {
            console.error(`[${tenantId}] onWhatsApp LID resolution error:`, err.message);
        }
    }

    // Fix existing conversations stored under a LID phone number
    if (lidConversations.length > 0) {
        const map = tenantLidToPhone.get(tenantId);
        if (!map) return;

        for (const lidConv of lidConversations) {
            const realPhone = map.get(lidConv.phone_number as string);
            if (!realPhone) continue;
            // fixLidConversation handles both cases: rename-only and merge-when-both-exist
            await fixLidConversation(tenantId, lidConv.phone_number as string, realPhone);
        }
    }
}

// ─── Fetch a single profile picture (on-demand for new conversations) ──
async function fetchProfilePicture(
    tenantId: string,
    socket: WASocket,
    conversationId: string,
    phoneNumber: string,
    isGroup: boolean
): Promise<void> {
    try {
        const jid = phoneNumber + (isGroup ? "@g.us" : "@s.whatsapp.net");
        const url = await socket.profilePictureUrl(jid, "image");
        if (url) {
            await getSupabase()
                .from("conversations")
                .update({ profile_picture_url: url })
                .eq("id", conversationId);
        }
    } catch {
        // Private profile picture or no picture set — this is normal
    }
}

// ─── Resolve profile pictures from WhatsApp (batch) ───────────────────
/**
 * Fetch/refresh profile pictures for conversations that are missing them.
 * Batch is capped at MAX_PROFILE_PIC_BATCH to avoid triggering WhatsApp's
 * bulk-activity detection (which causes 408 disconnects).
 * A 2-second inter-request delay is enforced for the same reason.
 */
const MAX_PROFILE_PIC_BATCH = 5; // Reduced from 20 — lower batch size avoids WhatsApp bulk-activity detection

async function resolveProfilePictures(
    tenantId: string,
    socket: WASocket,
    refreshStale = false
): Promise<void> {
    // Hard lock: prevents concurrent runs (e.g. periodic 6h interval firing while initial batch runs)
    if (_profilePicRunning.has(tenantId)) {
        console.log(`[${tenantId}] 📸 Skipping profile pic fetch — already running`);
        return;
    }
    // Primary gate: only run once per session (hasRunInitialSync is set before setTimeout fires)
    if (!refreshStale && !hasRunInitialSync.has(tenantId)) {
        // This should never happen (flag is set before we're called), but be defensive
        console.log(`[${tenantId}] 📸 Skipping profile pic fetch — initial sync gate not set`);
        return;
    }
    _profilePicRunning.add(tenantId);
    try {
        // Guard: don't run if the connection is too young (reconnect protection)
        const connectedTime = connectedAt.get(tenantId);
        if (!connectedTime || Date.now() - connectedTime < INITIAL_SYNC_MIN_AGE_MS) {
            console.log(`[${tenantId}] 📸 Skipping profile pic fetch — connection too young (reconnect guard)`);
            return;
        }

        const supabase = getSupabase();
        let query = supabase
            .from("conversations")
            .select("id, phone_number, is_group")
            .eq("tenant_id", tenantId);

        if (refreshStale) {
            // Refresh mode: re-fetch ALL pictures (URLs expire over time)
            console.log(`[${tenantId}] 📸 Refreshing profile pictures (stale refresh)...`);
        } else {
            // Initial mode: only fetch missing pictures
            query = query.is("profile_picture_url", null);
        }

        // Limit batch size to avoid WhatsApp bulk-activity detection
        query = query.limit(MAX_PROFILE_PIC_BATCH);

        const { data: conversations } = await query;

        if (!conversations || conversations.length === 0) return;

        console.log(`[${tenantId}] 📸 Fetching profile pictures for ${conversations.length} contacts (max ${MAX_PROFILE_PIC_BATCH})...`);
        let resolved = 0;
        let failed = 0;

        for (const conv of conversations) {
            try {
                const jid = conv.phone_number + (conv.is_group ? "@g.us" : "@s.whatsapp.net");
                const url = await socket.profilePictureUrl(jid, "image");
                if (url) {
                    await supabase
                        .from("conversations")
                        .update({ profile_picture_url: url })
                        .eq("id", conv.id);
                    resolved++;
                }
            } catch (err: any) {
                failed++;
                const statusCode = err?.output?.statusCode || err?.statusCode || 'unknown';
                const msg = err?.message || String(err);
                // Suppress noisy expected errors (401, 404, or 500 with specific Baileys messages)
                if (statusCode !== 404 && statusCode !== 401 && !msg.includes('item-not-found') && !msg.includes('not-authorized')) {
                    console.warn(`[${tenantId}] 📸 Failed [${statusCode}] ${conv.phone_number}: ${msg}`);
                }
            }
            // 5-second delay between calls — prevents WhatsApp from treating this
            // as suspicious bulk activity and dropping the connection (code 408)
            // Increased from 2s to 5s for extra safety margin.
            await delay(5_000);
        }

        console.log(`[${tenantId}] ✅ Profile pictures: ${resolved} resolved, ${failed} failed (of ${conversations.length})`);
    } catch (err) {
        console.error(`[${tenantId}] Error resolving profile pictures:`, err);
    } finally {
        // Always release the lock so future runs (e.g. 6h periodic refresh) can proceed
        _profilePicRunning.delete(tenantId);
    }
}

// ─── Internal: create Baileys socket ──────────────────────────────────
async function createSession(tenantId: string): Promise<void> {
    // Fix C: Clean up old socket's event listeners BEFORE creating a new socket.
    // Without this, every reconnect accumulates stale event handlers on the dead socket
    // (they never get GC'd because Baileys keeps internal references), causing memory
    // leaks and duplicate message processing.
    const existingSession = sessions.get(tenantId);
    // Capture retry count BEFORE clearing the session so it survives the transition
    const prevRetryCount = existingSession?.retryCount ?? 0;
    if (existingSession) {
        // Remove all known event listeners to prevent accumulation on reconnect.
        // Baileys types ev.removeAllListeners per-event, so we list all events explicitly.
        const ev = existingSession.socket.ev;
        const baileysEvents = [
            "connection.update", "creds.update", "messaging-history.set",
            "messages.upsert", "messages.update", "contacts.upsert", "contacts.update",
            "chats.upsert", "chats.update", "chats.delete", "presence.update",
            "groups.upsert", "groups.update", "group-participants.update",
            "blocklist.set", "blocklist.update", "call",
        ] as const;
        for (const event of baileysEvents) {
            try { ev.removeAllListeners(event); } catch { /* ignore */ }
        }
        try {
            existingSession.socket.end(undefined);
        } catch { /* ignore */ }
    }

    // Mark this tenant as actively reconnecting so the watchdog doesn't pile on
    _reconnecting.add(tenantId);

    const { state, saveCreds } = await useSupabaseAuthState(tenantId);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
        version,
        logger,
        browser: Browsers.ubuntu("Chrome"),  // Appear as Chrome on Linux — not "Baileys"
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        keepAliveIntervalMs: 25_000,  // ping every 25s — matches standard WhatsApp Web keepalive interval
        retryRequestDelayMs: 2_000,   // wait 2s before retrying failed WhatsApp requests
        maxMsgRetryCount: 5,          // limit Baileys message retry attempts to avoid infinite retry loops
        getMessage: async (key) => {
            // Called by Baileys when WhatsApp requests a message retry (e.g. decryption failure).
            // We look up the real content from Supabase so retried messages contain the
            // correct text — not the "hello" placeholder that was here before.
            try {
                if (key.id) {
                    const { data } = await getSupabase()
                        .from("messages")
                        .select("content")
                        .eq("wa_message_id", key.id)
                        .eq("tenant_id", tenantId)
                        .maybeSingle();
                    if (data?.content) return { conversation: data.content };
                }
            } catch { /* ignore — fallback to undefined */ }
            return undefined;
        },
    });

    // Preserve retry count from previous session (captured before cleanup above)
    const sessionInfo: SessionInfo = {
        socket,
        qrCode: null,
        status: "connecting",
        tenantId,
        retryCount: prevRetryCount,
        preKeyErrors: 0,
    };
    sessions.set(tenantId, sessionInfo);

    // 2. Load contacts from persistent storage immediately so incoming messages map properly
    await loadContactsFromDB(tenantId);

    // ── Event: connection update ──
    socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code received
        if (qr) {
            const qrDataUrl = await QRCode.toDataURL(qr);
            sessionInfo.qrCode = qrDataUrl;
            sessionInfo.status = "connecting";
            console.log(`[${tenantId}] 📱 QR code generated — waiting for scan...`);
            notifyQRUpdate(tenantId, qrDataUrl);
        }

        // Connected
        if (connection === "open") {
            sessionInfo.status = "connected";
            sessionInfo.qrCode = null;
            sessionInfo.retryCount = 0;

            // Fix C/D: Clear the reconnecting flag — connection is now stable
            _reconnecting.delete(tenantId);

            // Extract phone number from socket
            const phoneNumber = socket.user?.id?.split(":")[0] || null;

            await getSupabase()
                .from("tenants")
                .update({
                    whatsapp_connected: true,
                    whatsapp_phone: phoneNumber,
                })
                .eq("id", tenantId);

            console.log(`[${tenantId}] ✅ WhatsApp connected (${phoneNumber})`);
            notifyQRUpdate(tenantId, null);

            // Record the time this connection became active (used by reconnect guards)
            connectedAt.set(tenantId, Date.now());

            // ── Presence Heartbeat: prevent WhatsApp idle disconnects ──
            // WhatsApp servers may terminate connections that only send WebSocket pings
            // but show no XMPP-level activity. Sending a presence stanza every 5 minutes
            // keeps the application-layer session alive without affecting user visibility.
            const prevHeartbeat = presenceHeartbeatIntervals.get(tenantId);
            if (prevHeartbeat) clearInterval(prevHeartbeat);

            // Send initial presence immediately so WhatsApp knows we're active
            try { await socket.sendPresenceUpdate("available"); } catch { /* ignore */ }

            const heartbeatInterval = setInterval(async () => {
                const session = sessions.get(tenantId);
                if (!session || session.status !== "connected") return;
                try {
                    await socket.sendPresenceUpdate("available");
                } catch (err: any) {
                    console.warn(`[${tenantId}] 💓 Presence heartbeat failed: ${err.message}`);
                }
            }, PRESENCE_HEARTBEAT_INTERVAL_MS);
            presenceHeartbeatIntervals.set(tenantId, heartbeatInterval);

            // Only run expensive bulk syncs on the FIRST connect, not on every reconnect.
            // Repeated profile-pic / group-name storms after reconnects cause WhatsApp to
            // drop the connection with code 408 (bulk activity detected), creating an
            // infinite reconnect loop.
            if (!hasRunInitialSync.has(tenantId)) {
                hasRunInitialSync.add(tenantId);

                // After a short delay, resolve any group names and profile pictures.
                // resolveProfilePictures has its own reconnect-age guard as a second line
                // of defence, but the flag above is the primary gatekeeper.
                setTimeout(() => resolveGroupNames(tenantId, socket), 10_000);
                setTimeout(() => syncCachedContactsToDB(tenantId), 12_000); // Retroactively fix missing names
                setTimeout(() => resolveProfilePictures(tenantId, socket), 15_000);
                // Resolve LID JIDs after contacts have synced (contacts.upsert fires first)
                setTimeout(() => resolveLidPhoneMappings(tenantId, socket), 25_000);
            } else {
                console.log(`[${tenantId}] ♻️ Reconnect detected — skipping bulk sync to protect connection`);
            }

            // Periodic refresh: re-fetch profile pictures every 6 hours (URLs expire)
            // Clear any previous interval first to prevent leak on reconnect
            const prevInterval = profilePicIntervals.get(tenantId);
            if (prevInterval) clearInterval(prevInterval);
            const SIX_HOURS = 6 * 60 * 60 * 1000;
            const picInterval = setInterval(() => {
                const session = sessions.get(tenantId);
                if (session?.status === "connected") {
                    resolveProfilePictures(tenantId, socket, true);
                }
            }, SIX_HOURS);
            profilePicIntervals.set(tenantId, picInterval);
        }

        // Disconnected
        if (connection === "close") {
            sessionInfo.status = "disconnected";
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const errorMessage = (lastDisconnect?.error as Boom)?.message || "";

            console.log(
                `[${tenantId}] ❌ Connection closed (code: ${statusCode}, msg: ${errorMessage})`
            );

            // Immediately mark as disconnected in DB so the dashboard reflects reality.
            // Will be set back to true as soon as connection re-opens.
            await getSupabase()
                .from("tenants")
                .update({ whatsapp_connected: false })
                .eq("id", tenantId);

            // Handle 515 (restartRequired) — WhatsApp server asks us to restart the connection.
            // This is NOT a permanent failure; reconnect quickly without clearing auth.
            if (statusCode === 515) {
                console.log(`[${tenantId}] 🔄 WhatsApp restart requested (515) — reconnecting in 3s...`);
                sessions.delete(tenantId);
                // _reconnecting stays set — createSession will clear it on "open"
                setTimeout(() => createSession(tenantId), 3_000);
                return;
            }

            // Fix B: Handle badSession — clear corrupted crypto state and reconnect fresh
            if (statusCode === DisconnectReason.badSession) {
                console.log(`[${tenantId}] ❌ Bad session detected — clearing corrupted session data and reconnecting...`);
                sessions.delete(tenantId);
                await clearSessionData(tenantId);
                tenantContactsCache.delete(tenantId);
                // Do NOT clear _reconnecting — we're about to reconnect immediately
                setTimeout(() => createSession(tenantId), 5_000);
                return;
            }

            // Fix B: Handle loggedOut — session expired, user must rescan QR
            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`[${tenantId}] 🚪 Logged out — clearing session data, QR rescan required`);
                sessions.delete(tenantId);
                _reconnecting.delete(tenantId); // Terminal state — clear reconnecting flag
                await clearSessionData(tenantId);
                return;
            }

            const shouldReconnect = sessionInfo.retryCount < MAX_RETRIES;

            if (shouldReconnect) {
                sessionInfo.retryCount++;
                // Flush cache before reconnect to prevent data loss
                await flushCacheToDB(tenantId);
                // Use exponential backoff: 5s, 15s, 30s, 60s, 120s (capped)
                // Slower reconnects look less suspicious to WhatsApp servers.
                const backoffSteps = [5000, 15000, 30000, 60000, 120000];
                const backoffDelay = backoffSteps[Math.min(sessionInfo.retryCount - 1, backoffSteps.length - 1)];
                console.log(
                    `[${tenantId}] ♻️ Reconnecting in ${backoffDelay / 1000}s (attempt ${sessionInfo.retryCount}/${MAX_RETRIES})...`
                );
                // _reconnecting stays set — createSession will clear it on "open"
                setTimeout(() => createSession(tenantId), backoffDelay);
            } else {
                sessions.delete(tenantId);
                _reconnecting.delete(tenantId); // Terminal state — clear reconnecting flag
                console.log(`[${tenantId}] ⚠️ Max retries (${MAX_RETRIES}) reached. Manual reconnect required.`);
            }
        }
    });

    // ── Event: save credentials ──
    socket.ev.on("creds.update", saveCreds);

    // ── Event: history sync ──
    socket.ev.on("messaging-history.set", async ({ chats, messages, isLatest }) => {
        try {
            console.log(`[${tenantId}] 📥 History sync received: ${chats.length} chats, ${messages.length} messages (isLatest: ${isLatest})`);
            const supabase = getSupabase();

            let chatsSynced = 0;
            let messagesSynced = 0;

            // Process chats
            for (const chat of chats) {
                if (!chat.id) continue;
                const resolvedChatId = resolveLidJid(tenantId, chat.id);
                const phoneNumber = resolvedChatId.split("@")[0];
                const isGroup = resolvedChatId.endsWith("@g.us");
                let contactName = chat.name || null;

                // Use conversationTimestamp from WhatsApp for proper sorting
                const chatTimestamp = chat.conversationTimestamp
                    ? new Date((chat.conversationTimestamp as number) * 1000).toISOString()
                    : new Date().toISOString();

                // Upsert conversation to keep it alive AND update timestamp
                const upsertData: any = {
                    tenant_id: tenantId,
                    phone_number: phoneNumber,
                    is_group: isGroup,
                    updated_at: chatTimestamp,
                };

                // Only payload contact_name if it exists, so we don't overwrite existing names with null
                if (contactName) {
                    upsertData.contact_name = contactName;
                }

                const { data: conversation, error: convError } = await supabase
                    .from("conversations")
                    .upsert(upsertData, { onConflict: "tenant_id,phone_number" })
                    .select("id")
                    .single();

                if (convError || !conversation) {
                    console.error(`[${tenantId}] Failed to upsert conversation for ${phoneNumber}:`, convError?.message);
                    continue;
                }
                chatsSynced++;
            }

            // Process messages separately (they may belong to any chat)
            for (const msg of messages) {
                if (!msg.message) continue;
                if (msg.key.remoteJid === "status@broadcast") continue;
                if (msg.message.protocolMessage) continue;

                const textContent =
                    msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    msg.message.imageMessage?.caption ||
                    msg.message.videoMessage?.caption ||
                    null;

                if (!textContent) continue;

                const rawMsgJid = msg.key.remoteJid!;
                const resolvedMsgJid = resolveLidJid(tenantId, rawMsgJid);
                const phoneNumber = resolvedMsgJid.split("@")[0];
                const isGroup = resolvedMsgJid.endsWith("@g.us");

                // Ensure conversation exists
                const { data: conversation } = await supabase
                    .from("conversations")
                    .upsert(
                        {
                            tenant_id: tenantId,
                            phone_number: phoneNumber,
                            is_group: isGroup,
                        },
                        { onConflict: "tenant_id,phone_number" }
                    )
                    .select("id")
                    .single();

                if (!conversation) continue;

                const isFromMe = msg.key.fromMe ?? false;
                const role = isFromMe ? "owner" : "user";
                const senderName = isFromMe ? "Owner" : (msg.pushName || null);
                const waMessageId = msg.key.id || null;

                const createdAt = new Date(
                    (msg.messageTimestamp as number) * 1000 || Date.now()
                ).toISOString();

                // Skip if message with this WA ID already exists
                if (waMessageId) {
                    const { data: existing } = await supabase
                        .from("messages")
                        .select("id")
                        .eq("conversation_id", conversation.id)
                        .eq("wa_message_id", waMessageId)
                        .maybeSingle();
                    if (existing) continue;
                }

                const { error: insertErr } = await supabase.from("messages").insert({
                    conversation_id: conversation.id,
                    tenant_id: tenantId,
                    role,
                    content: textContent,
                    sender_name: senderName,
                    is_from_agent: false,
                    created_at: createdAt,
                    wa_message_id: waMessageId,
                });

                if (!insertErr) {
                    messagesSynced++;
                    // If this message has a pushName and the conversation has no name, update it
                    if (senderName && senderName !== "Owner" && !isFromMe) {
                        await supabase
                            .from("conversations")
                            .update({ contact_name: senderName })
                            .eq("id", conversation.id)
                            .is("contact_name", null);
                    }
                }
            }

            console.log(`[${tenantId}] ✅ History sync done: ${chatsSynced} chats, ${messagesSynced} messages saved`);

            // Fetch actual group names for groups that don't have one yet.
            // Only run on the FINAL history batch (isLatest: true) to avoid
            // making socket.groupMetadata() calls on every incremental batch —
            // WhatsApp interprets rapid bulk API calls as suspicious and responds
            // with a 408 disconnect.
            if (isLatest) {
                await resolveGroupNames(tenantId, socket);
            }
        } catch (err) {
            console.error(`[${tenantId}] History sync error:`, err);
        }
    });

    // ── Event: incoming messages ──
    socket.ev.on("messages.upsert", async (upsert) => {
        const sessionInfo = sessions.get(tenantId);

        try { for (const msg of upsert.messages) {
            // Skip status broadcasts, newsletters, and protocol messages
            if (!msg.key.remoteJid) continue;
            if (msg.key.remoteJid === "status@broadcast") continue;
            if (msg.key.remoteJid.endsWith("@newsletter")) continue;
            if (msg.key.remoteJid.endsWith("@broadcast")) continue;
            if (msg.message?.protocolMessage) continue;

            // ── Handle outgoing messages (isFromMe) ──
            // Messages sent via sendMessage() / AI agent are already saved to DB.
            // Messages typed directly on the phone go through Baileys but NOT our sendMessage().
            // We use wa_message_id dedup to skip already-saved messages and save phone-typed ones.
            const isFromMe = msg.key.fromMe ?? false;
            if (isFromMe) {
                const waMessageId = msg.key.id || null;
                if (waMessageId) {
                    const { data: existing } = await getSupabase()
                        .from("messages")
                        .select("id")
                        .eq("wa_message_id", waMessageId)
                        .maybeSingle();
                    if (existing) continue; // Already saved by sendMessage() — skip
                }
                // Message typed on phone — save it via handleIncomingMessage
            }

            // Check for decryption failures (CIPHERTEXT stub or missing message entirely)
            if (!msg.message) {
                if (msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
                    if (sessionInfo) {
                        sessionInfo.preKeyErrors++;
                        console.warn(`[${tenantId}] ⚠️ Decryption error (PreKey) detected. Count: ${sessionInfo.preKeyErrors}/${MAX_PREKEY_ERRORS}`);

                        if (sessionInfo.preKeyErrors >= MAX_PREKEY_ERRORS) {
                            console.error(`[${tenantId}] 🚨 Max PreKey errors reached. Session crypto corrupted. Force wiping auth state!`);

                            // Immediately disconnect and clear corrupted keys
                            // This stops silent message loss and forces user to rescan QR
                            stopSession(tenantId, true);
                            return; // Stop processing this batch further because session is dead
                        }
                    }
                }
                continue; // Skip processing since there's no content
            }

            // Successful decryption — reset error counter
            if (sessionInfo && sessionInfo.preKeyErrors > 0) {
                sessionInfo.preKeyErrors = 0;
            }

            // Extract wa_message_id for dedup
            const waMessageId = msg.key.id || null;

            // Extract text content and media
            // Check if message has media
            const hasMedia = !!(
                msg.message?.imageMessage ||
                msg.message?.videoMessage ||
                msg.message?.audioMessage ||
                msg.message?.documentMessage ||
                msg.message?.stickerMessage
            );

            let mediaUrl: string | null = null;
            let mediaType: string | null = null;

            // Extract text or fallback to media description
            let textContent =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                msg.message?.documentMessage?.caption ||
                "";

            if (!textContent && hasMedia) {
                if (msg.message?.imageMessage) textContent = "[Image received]";
                else if (msg.message?.videoMessage) textContent = "[Video received]";
                else if (msg.message?.audioMessage) textContent = "[Voice message received]";
                else if (msg.message?.documentMessage) textContent = "[Document received]";
                else if (msg.message?.stickerMessage) textContent = "[Sticker received]";
            }

            if (hasMedia) {
                // ── Media upload DISABLED ──────────────────────────────────────────────
                // The 'whatsapp_media' Supabase Storage bucket does not exist.
                // Attempting to upload causes StorageApiError (status 400) which triggers
                // a Baileys stream ACK error → connection drop (code 500).
                // We set mediaType only (so the DB knows what kind of media arrived) and
                // leave mediaUrl as null. The descriptive textContent (e.g. "[Image received]")
                // was already set above and is sufficient for the AI agent context.
                //
                // Audio transcription also requires the download, so it is disabled here too.
                // To re-enable: create the 'whatsapp_media' bucket in Supabase Storage and
                // uncomment the download + upload block below.
                if (msg.message?.imageMessage) { mediaType = "image"; }
                else if (msg.message?.videoMessage) { mediaType = "video"; }
                else if (msg.message?.audioMessage) { mediaType = "audio"; }
                else if (msg.message?.documentMessage) { mediaType = "document"; }
                else if (msg.message?.stickerMessage) { mediaType = "sticker"; }

                console.log(`[${tenantId}] 📎 Media message received (${mediaType}) — stored without upload (bucket disabled)`);
                // mediaUrl stays null — message saved to DB below without media_url
            }

            if (!textContent && !mediaUrl) continue;

            const rawJid = msg.key.remoteJid!;
            // Resolve LID JID (e.g. 240213326622964@lid) to real phone JID
            let remoteJid = resolveLidJid(tenantId, rawJid);

            // Fallback: if still unresolved LID, try matching pushName against contacts cache
            if (remoteJid.endsWith("@lid") && msg.pushName) {
                const realPhone = findPhoneByPushName(tenantId, msg.pushName);
                if (realPhone) {
                    const lidNum = rawJid.split("@")[0];
                    let map = tenantLidToPhone.get(tenantId);
                    if (!map) { map = new Map(); tenantLidToPhone.set(tenantId, map); }
                    map.set(lidNum, realPhone);
                    remoteJid = `${realPhone}@s.whatsapp.net`;
                    console.log(`[${tenantId}] 🔗 LID resolved via pushName: ${lidNum} → ${realPhone} (${msg.pushName})`);
                    fixLidConversation(tenantId, lidNum, realPhone).catch(() => {});
                }
            }

            let contactName = msg.pushName ?? null;
            let senderName = msg.pushName ?? null;

            const participantPhone = msg.key.participant ? msg.key.participant.split("@")[0] : null;
            const lookupPhone = participantPhone || remoteJid.split("@")[0];
            const cachedName = getCachedContactName(tenantId, lookupPhone);

            // If it's a group chat, try to fetch the group name (subject)
            if (remoteJid.endsWith("@g.us")) {
                senderName = cachedName || msg.pushName || participantPhone || "Unknown";
                // Use cached group metadata to avoid hitting WhatsApp API on every message
                const cached = groupMetadataCache.get(remoteJid);
                if (cached && Date.now() - cached.fetchedAt < GROUP_CACHE_TTL_MS) {
                    contactName = cached.subject;
                } else {
                    try {
                        const metadata = await socket.groupMetadata(remoteJid);
                        if (metadata.subject) {
                            contactName = metadata.subject;
                            groupMetadataCache.set(remoteJid, { subject: metadata.subject, fetchedAt: Date.now() });
                        }
                    } catch (err) {
                        console.error(`[${tenantId}] Could not fetch group metadata:`, err);
                    }
                }
            } else {
                // 1-to-1 chats: default to phonebook cached name
                contactName = cachedName || msg.pushName || null;
                senderName = cachedName || msg.pushName || lookupPhone;
            }

            let isMentioned = false;
            const botJid = socket.user?.id ? socket.user.id.split(':')[0] + "@s.whatsapp.net" : null;
            if (botJid) {
                const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentionedJidList.includes(botJid)) {
                    isMentioned = true;
                }
            }
            // If still not explicitly mentioned, check if the text contains the bot's phone number
            if (!isMentioned && botJid && remoteJid.endsWith("@g.us")) {
                const rawPhone = botJid.split('@')[0];
                if (textContent.includes(rawPhone)) isMentioned = true;
            }

            try {
                await handleIncomingMessage(
                    tenantId,
                    remoteJid,
                    textContent,
                    isFromMe,
                    contactName,
                    senderName,
                    mediaUrl,
                    mediaType,
                    waMessageId,
                    makeHumanSend(socket),
                    isMentioned
                );

                // On-demand: fetch profile picture for this conversation if missing
                const phoneNumber = remoteJid.split("@")[0];
                const isGroup = remoteJid.endsWith("@g.us");
                const picKey = `${tenantId}:${phoneNumber}`;
                // Only check DB for profile pic once per session per contact
                if (!profilePicChecked.has(picKey)) {
                    profilePicChecked.add(picKey);
                    const { data: conv } = await getSupabase()
                        .from("conversations")
                        .select("id, profile_picture_url")
                        .eq("tenant_id", tenantId)
                        .eq("phone_number", phoneNumber)
                        .maybeSingle();
                    if (conv && !conv.profile_picture_url) {
                        // Fire-and-forget: don't block message processing
                        fetchProfilePicture(tenantId, socket, conv.id, phoneNumber, isGroup);
                    }
                }
            } catch (err) {
                console.error(`[${tenantId}] Message handler error:`, err);
            }
        } } catch (outerErr) {
            console.error(`[${tenantId}] ❌ Unhandled error in messages.upsert handler:`, outerErr);
        }
    });

    // ── Event: messages update (Delivery / Read receipts) ──
    socket.ev.on("messages.update", async (events) => {
        const supabase = getSupabase();

        for (const { key, update } of events) {
            if (!key.id || !update.status) continue;

            const baileyStatus = update.status;
            let finalStatus: string | null = null;

            // Map proto.WebMessageInfo.Status to our DB status
            // ERROR: 0, PENDING: 1, SERVER_ACK: 2, DELIVERY_ACK: 3, READ: 4, PLAYED: 5
            if (baileyStatus === proto.WebMessageInfo.Status.SERVER_ACK) {
                finalStatus = "sent";
            } else if (baileyStatus === proto.WebMessageInfo.Status.DELIVERY_ACK) {
                finalStatus = "delivered";
            } else if (baileyStatus === proto.WebMessageInfo.Status.READ) {
                finalStatus = "read";
            }

            if (finalStatus) {
                // We only really care about outgoing message statuses for ticks
                const { error } = await supabase
                    .from("messages")
                    .update({ status: finalStatus })
                    .eq("wa_message_id", key.id);

                if (error) {
                    console.error(`[${tenantId}] Failed to update status for ${key.id} to ${finalStatus}`, error);
                } else {
                    console.log(`[${tenantId}] 🎫 Message ${key.id} status updated to ${finalStatus}`);
                }
            }
        }
    });

    // ── Event: contacts sync (provides real contact names) ──
    socket.ev.on("contacts.upsert", async (contacts) => {
        const supabase = getSupabase();

        let cache = tenantContactsCache.get(tenantId);
        if (!cache) {
            cache = new Map<string, string>();
            tenantContactsCache.set(tenantId, cache);
        }

        console.log(`[${tenantId}] 📇 contacts.upsert received: ${contacts.length} contacts`);
        let withPhonebook = 0;
        let withPushOnly = 0;
        let noName = 0;

        // Two-pass name correlation:
        // Baileys sends separate entries for phone-JID and LID-JID of the same person.
        // If both arrive in the same batch with the same name, we can cross-map them.
        const batchNameToPhone = new Map<string, string>();
        for (const c of contacts) {
            if (c.id?.endsWith("@s.whatsapp.net")) {
                const name = c.name || c.notify;
                if (name) batchNameToPhone.set(name.toLowerCase(), c.id.split("@")[0]);
            }
        }
        for (const c of contacts) {
            if (!c.id?.endsWith("@lid")) continue;
            const name = c.name || c.notify;
            if (!name) continue;
            const realPhone = batchNameToPhone.get(name.toLowerCase());
            if (realPhone) {
                const lidNum = c.id.split("@")[0];
                let map = tenantLidToPhone.get(tenantId);
                if (!map) { map = new Map(); tenantLidToPhone.set(tenantId, map); }
                if (!map.has(lidNum)) {
                    map.set(lidNum, realPhone);
                    console.log(`[${tenantId}] 🔗 LID resolved via batch name: ${lidNum} → ${realPhone} (${name})`);
                    fixLidConversation(tenantId, lidNum, realPhone).catch(() => {});
                }
            }
        }

        for (const contact of contacts) {
            if (!contact.id) continue;
            if (contact.id === "status@broadcast") continue;

            // Build LID → real phone mapping (when both lid+jid fields are present on one object)
            buildLidMapping(tenantId, contact);

            // Use resolved phone number (LID → real phone if applicable)
            const resolvedId = resolveLidJid(tenantId, contact.id);
            const phoneNumber = resolvedId.split("@")[0];

            // contact.name = device contact name (what's in the phone book) — HIGHEST PRIORITY
            // contact.notify = WhatsApp push name (what the person set) — fallback
            const phonebookName = contact.name || null;
            const pushName = contact.notify || null;
            const bestName = phonebookName || pushName;

            // Debug: log contacts that have phonebook names
            if (phonebookName) {
                withPhonebook++;
            } else if (pushName) {
                withPushOnly++;
            } else {
                noName++;
                continue;
            }

            // Save to RAM dictionary (phonebook name preferred)
            // Don't cache LID-like numbers — only real phone numbers belong in this map
            if (phoneNumber.length < 14) {
                cache.set(phoneNumber, bestName!);
            }

            if (phonebookName) {
                // Phonebook name available — ALWAYS overwrite, it's the highest priority source
                // (even manually-set names get overwritten by phonebook names)
                await supabase
                    .from("conversations")
                    .update({ contact_name: phonebookName, is_saved_contact: true })
                    .eq("tenant_id", tenantId)
                    .eq("phone_number", phoneNumber);
            } else if (pushName) {
                // Only pushName — set it only if no name exists yet AND not manually set
                await supabase
                    .from("conversations")
                    .update({ contact_name: pushName })
                    .eq("tenant_id", tenantId)
                    .eq("phone_number", phoneNumber)
                    .is("contact_name", null)
                    .or("name_manually_set.is.null,name_manually_set.eq.false");
            }
        }
        console.log(`[${tenantId}] 📇 contacts.upsert summary: ${withPhonebook} phonebook, ${withPushOnly} pushName only, ${noName} no name`);
        // Commit RAM dictionary back to database persistent storage
        await saveContactsToDB(tenantId);
    });

    // ── Event: contacts update (e.g. contact renamed in phone book) ──
    socket.ev.on("contacts.update", async (updates) => {
        const supabase = getSupabase();

        let cache = tenantContactsCache.get(tenantId);
        if (!cache) {
            cache = new Map<string, string>();
            tenantContactsCache.set(tenantId, cache);
        }

        for (const update of updates) {
            if (!update.id) continue;
            if (update.id === "status@broadcast") continue;

            buildLidMapping(tenantId, update);
            const resolvedId = resolveLidJid(tenantId, update.id);
            const phoneNumber = resolvedId.split("@")[0];
            const phonebookName = update.name || null;  // Device contact name — HIGH priority
            const pushName = update.notify || null;       // WhatsApp push name — LOW priority

            if (phonebookName) {
                // Phonebook name — ALWAYS overwrite, this is the highest priority source
                cache.set(phoneNumber, phonebookName);
                const { error } = await supabase
                    .from("conversations")
                    .update({ contact_name: phonebookName, is_saved_contact: true })
                    .eq("tenant_id", tenantId)
                    .eq("phone_number", phoneNumber);

                if (error) {
                    console.error(`[${tenantId}] Failed to update contact name:`, error.message);
                } else {
                    console.log(`[${tenantId}] 📇 Contact updated (phonebook): ${phoneNumber} -> ${phonebookName}`);
                }
            } else if (pushName) {
                // Push name — only set if contact_name is currently null AND not manually set
                cache.set(phoneNumber, pushName);
                await supabase
                    .from("conversations")
                    .update({ contact_name: pushName })
                    .eq("tenant_id", tenantId)
                    .eq("phone_number", phoneNumber)
                    .is("contact_name", null)
                    .or("name_manually_set.is.null,name_manually_set.eq.false");
            }
        }
        // Commit RAM dictionary back to database persistent storage
        await saveContactsToDB(tenantId);
    });
}
