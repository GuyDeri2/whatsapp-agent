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
import { handleIncomingMessage, clearPendingAiReply } from "./message-handler";
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
const MAX_PREKEY_ERRORS = 10; // after this many PreKeyErrors, clear session and reconnect

/** Track periodic intervals per tenant so we can clean them up on reconnect */
const profilePicIntervals = new Map<string, NodeJS.Timeout>();

/** Cache group metadata to avoid fetching from WhatsApp on every message */
const groupMetadataCache = new Map<string, { subject: string; fetchedAt: number }>();
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Track which conversations we've already checked for profile pics this session */
const profilePicChecked = new Set<string>();

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
            const words = content.text.trim().split(/\s+/).length;
            // ~40 wpm typing speed, capped at 5s, plus 0-1.5s random jitter
            const typingMs = Math.min(Math.ceil((words / 40) * 60_000), 5_000)
                + Math.floor(Math.random() * 1_500);
            await socket.sendPresenceUpdate("composing", jid);
            await new Promise((r) => setTimeout(r, typingMs));
            await socket.sendPresenceUpdate("paused", jid);
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

export async function sendMessage(tenantId: string, jid: string, text: string): Promise<string> {
    const session = sessions.get(tenantId);
    if (!session || session.status !== "connected") {
        throw new Error("Session not connected");
    }

    // 1. Send via Baileys
    const sentMsg = await session.socket.sendMessage(jid, { text });
    const waMessageId = sentMsg?.key?.id || "unknown";

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
async function resolveGroupNames(tenantId: string, socket: WASocket): Promise<void> {
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

        console.log(`[${tenantId}] 🏷️ Resolving names for ${namelessGroups.length} groups...`);
        let resolved = 0;

        for (const group of namelessGroups) {
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
        }

        console.log(`[${tenantId}] ✅ Resolved ${resolved}/${namelessGroups.length} group names`);
    } catch (err) {
        console.error(`[${tenantId}] Error resolving group names:`, err);
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
async function resolveProfilePictures(
    tenantId: string,
    socket: WASocket,
    refreshStale = false
): Promise<void> {
    try {
        const supabase = getSupabase();
        let query = supabase
            .from("conversations")
            .select("id, phone_number, is_group")
            .eq("tenant_id", tenantId);

        if (refreshStale) {
            // Refresh mode: re-fetch ALL pictures (URLs expire over time)
            console.log(`[${tenantId}] 📸 Refreshing ALL profile pictures...`);
        } else {
            // Initial mode: only fetch missing pictures
            query = query.is("profile_picture_url", null);
        }

        const { data: conversations } = await query;

        if (!conversations || conversations.length === 0) return;

        console.log(`[${tenantId}] 📸 Fetching profile pictures for ${conversations.length} contacts...`);
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
            // Small delay between calls to avoid WhatsApp rate-limiting
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`[${tenantId}] ✅ Profile pictures: ${resolved} resolved, ${failed} failed (of ${conversations.length})`);
    } catch (err) {
        console.error(`[${tenantId}] Error resolving profile pictures:`, err);
    }
}

// ─── Internal: create Baileys socket ──────────────────────────────────
async function createSession(tenantId: string): Promise<void> {
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
        keepAliveIntervalMs: 15_000,
        getMessage: async () => ({ conversation: "hello" }),
    });

    // Preserve retry count from previous session if it exists
    const prevSession = sessions.get(tenantId);
    const sessionInfo: SessionInfo = {
        socket,
        qrCode: null,
        status: "connecting",
        tenantId,
        retryCount: prevSession?.retryCount ?? 0,
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

            // After a short delay, resolve any group names and profile pictures
            setTimeout(() => resolveGroupNames(tenantId, socket), 10000);
            setTimeout(() => syncCachedContactsToDB(tenantId), 12000); // Retroactively fix missing names
            setTimeout(() => resolveProfilePictures(tenantId, socket), 15000);

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
            const shouldReconnect =
                statusCode !== DisconnectReason.loggedOut &&
                sessionInfo.retryCount < MAX_RETRIES;

            console.log(
                `[${tenantId}] ❌ Connection closed (code: ${statusCode}, msg: ${errorMessage}). Reconnect: ${shouldReconnect}`
            );

            if (shouldReconnect) {
                sessionInfo.retryCount++;
                // Flush cache before reconnect to prevent data loss
                await flushCacheToDB(tenantId);
                // Use exponential backoff: 5s, 10s, 20s, 40s, 60s (capped)
                const delay = Math.min(5000 * Math.pow(2, sessionInfo.retryCount - 1), 60000);
                console.log(
                    `[${tenantId}] ♻️ Reconnecting in ${delay / 1000}s (attempt ${sessionInfo.retryCount}/${MAX_RETRIES})...`
                );
                setTimeout(() => createSession(tenantId), delay);
            } else {
                sessions.delete(tenantId);
                await getSupabase()
                    .from("tenants")
                    .update({ whatsapp_connected: false })
                    .eq("id", tenantId);

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(`[${tenantId}] 🚪 Logged out — clearing session data`);
                    await clearSessionData(tenantId);
                } else {
                    console.log(`[${tenantId}] ⚠️ Max retries reached. Manual reconnect required.`);
                }
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

            // Fetch actual group names for groups that don't have one yet
            await resolveGroupNames(tenantId, socket);
        } catch (err) {
            console.error(`[${tenantId}] History sync error:`, err);
        }
    });

    // ── Event: incoming messages ──
    socket.ev.on("messages.upsert", async (upsert) => {
        const sessionInfo = sessions.get(tenantId);

        for (const msg of upsert.messages) {
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
                try {
                    console.log(`[${tenantId}] Downloading media message...`);
                    const buffer = await downloadMediaMessage(
                        msg,
                        "buffer",
                        {},
                        { logger, reuploadRequest: socket.updateMediaMessage }
                    );

                    // Determine type and extension
                    let extension = "bin";
                    if (msg.message?.imageMessage) { mediaType = "image"; extension = "jpeg"; }
                    else if (msg.message?.videoMessage) { mediaType = "video"; extension = "mp4"; }
                    else if (msg.message?.audioMessage) { mediaType = "audio"; extension = "ogg"; }
                    else if (msg.message?.documentMessage) {
                        mediaType = "document";
                        // Extract real extension from filename or mimetype
                        const docName = msg.message.documentMessage.fileName || "";
                        const docMime = msg.message.documentMessage.mimetype || "";
                        if (docName.endsWith(".pdf") || docMime.includes("pdf")) extension = "pdf";
                        else if (docName.endsWith(".docx") || docMime.includes("wordprocessingml")) extension = "docx";
                        else if (docName.endsWith(".doc") || docMime.includes("msword")) extension = "doc";
                        else if (docName.endsWith(".xlsx") || docMime.includes("spreadsheetml")) extension = "xlsx";
                        else if (docName.endsWith(".xls") || docMime.includes("ms-excel")) extension = "xls";
                        else if (docName.endsWith(".pptx") || docMime.includes("presentationml")) extension = "pptx";
                        else if (docName.endsWith(".csv")) extension = "csv";
                        else if (docName.endsWith(".txt")) extension = "txt";
                        else if (docName.endsWith(".zip")) extension = "zip";
                        else {
                            // Try to get extension from filename
                            const parts = docName.split(".");
                            if (parts.length > 1) extension = parts.pop()!;
                        }
                    }
                    else if (msg.message?.stickerMessage) { mediaType = "sticker"; extension = "webp"; }

                    // Upload to Supabase Storage
                    const supabase = getSupabase();
                    const fileName = `${tenantId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;

                    const { data, error } = await supabase
                        .storage
                        .from("whatsapp_media")
                        .upload(fileName, buffer as Buffer, {
                            contentType: msg.message?.imageMessage?.mimetype ||
                                msg.message?.videoMessage?.mimetype ||
                                msg.message?.audioMessage?.mimetype ||
                                msg.message?.documentMessage?.mimetype ||
                                msg.message?.stickerMessage?.mimetype || "application/octet-stream"
                        });

                    if (error) {
                        console.error(`[${tenantId}] Failed to upload media:`, error);
                    } else if (data) {
                        const { data: publicUrlData } = supabase.storage.from("whatsapp_media").getPublicUrl(data.path);
                        mediaUrl = publicUrlData.publicUrl;
                        console.log(`[${tenantId}] Media uploaded: ${mediaUrl}`);

                        if (!textContent) {
                            textContent = `[${mediaType} received]`;
                        }

                        // If it's an audio message, try to transcribe it with Whisper API
                        if (mediaType === "audio") {
                            console.log(`[${tenantId}] 🎙️ Attempting to transcribe audio message...`);
                            const transcription = await transcribeAudioBuffer(buffer as Buffer, msg.message?.audioMessage?.mimetype || undefined);
                            if (transcription) {
                                console.log(`[${tenantId}] 📝 Transcription success: "${transcription.substring(0, 50)}..."`);
                                // Append transcription to whatever caption existed (if any)
                                textContent = textContent === `[${mediaType} received]`
                                    ? `[🎤 Voice Note]: ${transcription}`
                                    : `${textContent}\n\n[🎤 Voice Note]: ${transcription}`;
                            } else {
                                console.log(`[${tenantId}] ⚠️ Transcription returned empty or failed.`);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[${tenantId}] Media processing error:`, err);
                }
            }

            if (!textContent && !mediaUrl) continue;

            const rawJid = msg.key.remoteJid!;
            // Resolve LID JID (e.g. 240213326622964@lid) to real phone JID
            const remoteJid = resolveLidJid(tenantId, rawJid);
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

        for (const contact of contacts) {
            if (!contact.id) continue;
            if (contact.id === "status@broadcast") continue;

            // Build LID → real phone mapping so LID-based messages resolve correctly
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
            cache.set(phoneNumber, bestName!);

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
