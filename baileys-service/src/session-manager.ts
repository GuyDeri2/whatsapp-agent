/**
 * Baileys Session Manager — Core session lifecycle.
 *
 * Manages per-tenant WhatsApp sessions:
 * - createSession: restore from saved auth (no QR needed)
 * - startSession: fresh session (QR code flow)
 * - stopSession: graceful disconnect
 * - Disconnect handlers for every known code
 * - Watchdog health checks
 * - Auto-reconnect on server restart
 */

import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    BaileysEventMap,
    ConnectionState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { useSupabaseAuthState } from "./session-store";
import { PresencePauseScheduler } from "./antiban";
import { handleMessage } from "./message-handler";
import { broadcastQR, clearQR } from "./qr-manager";
import { resolveLidPhone, registerLidMapping } from "./lid-resolver";
import { fetchAndStoreProfilePicture, bulkFetchProfilePictures } from "./profile-pictures";
import type { TenantSession, SessionHealth } from "./types";

// ── Globals ────────────────────────────────────────────────────────

const sessions = new Map<string, TenantSession>();
const healthStates = new Map<string, SessionHealth>();
const reconnecting = new Set<string>();
const sessionCleanup = new Map<string, { saveCreds: () => Promise<void>; clearState: () => Promise<void>; stopSync: () => void; forceFlush: () => Promise<void> }>();

const presencePauser = new PresencePauseScheduler();

// Reconnect cooldown — minimum 30s between reconnect attempts
const lastReconnectAt = new Map<string, number>();
const RECONNECT_COOLDOWN_MS = 30_000;

// Browser fingerprints — deterministic per tenant
const BROWSERS: [string, string, string][] = [
    ["Chrome", "Windows", "10"],
    ["Firefox", "Windows", "10"],
    ["Safari", "macOS", "14"],
    ["Edge", "Windows", "11"],
    ["Chrome", "macOS", "14"],
];

function getBrowserForTenant(tenantId: string): [string, string, string] {
    let hash = 0;
    for (let i = 0; i < tenantId.length; i++) {
        hash = ((hash << 5) - hash + tenantId.charCodeAt(i)) | 0;
    }
    return BROWSERS[Math.abs(hash) % BROWSERS.length];
}

// ── Supabase singleton ─────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (!_supabase) {
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    }
    return _supabase;
}

// ── Public API ─────────────────────────────────────────────────────

export function getSession(tenantId: string): TenantSession | undefined {
    return sessions.get(tenantId);
}

export function getAllSessions(): Map<string, TenantSession> {
    return sessions;
}

/**
 * Create a session from saved auth state (no QR needed).
 * Used for auto-reconnect on server restart.
 */
export async function createSession(tenantId: string): Promise<void> {
    if (sessions.has(tenantId) || reconnecting.has(tenantId)) return;
    await _initSocket(tenantId, false);
}

/**
 * Start a fresh session (generates QR code).
 * Used when user clicks "Connect WhatsApp" for the first time.
 */
export async function startSession(tenantId: string): Promise<void> {
    // Stop existing session if any
    await stopSession(tenantId, true);
    await _initSocket(tenantId, true);
}

/**
 * Stop a session gracefully.
 */
export async function stopSession(tenantId: string, clearData = false): Promise<void> {
    presencePauser.stop(tenantId);

    const cleanup = sessionCleanup.get(tenantId);
    if (cleanup) {
        cleanup.stopSync();
        if (clearData) {
            await cleanup.clearState();
        }
        sessionCleanup.delete(tenantId);
    }

    const session = sessions.get(tenantId);
    if (session) {
        try {
            session.socket.end(undefined);
        } catch {
            // Already closed
        }
        sessions.delete(tenantId);
    }

    healthStates.delete(tenantId);
    reconnecting.delete(tenantId);

    if (clearData) {
        const supabase = getSupabase();

        // Update tenant status in DB
        await supabase
            .from("tenants")
            .update({ whatsapp_connected: false, whatsapp_phone: null, connection_type: "none" })
            .eq("id", tenantId);

        await supabase
            .from("baileys_config")
            .delete()
            .eq("tenant_id", tenantId);

        // Delete all conversations (messages cascade via FK)
        await supabase
            .from("conversations")
            .delete()
            .eq("tenant_id", tenantId);
    }
}

// ── Socket initialization ──────────────────────────────────────────

async function _initSocket(tenantId: string, fresh: boolean): Promise<void> {
    const supabase = getSupabase();

    const { state, saveCreds, clearState, stopSync, forceFlush } = await useSupabaseAuthState(supabase, tenantId);
    sessionCleanup.set(tenantId, { saveCreds, clearState, stopSync, forceFlush });

    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
        },
        browser: getBrowserForTenant(tenantId),
        printQRInTerminal: false,
        keepAliveIntervalMs: 25_000,
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs: 60_000,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
    });

    const session: TenantSession = {
        socket,
        tenantId,
        phoneNumber: null,
        connectedAt: null,
        retryCount: 0,
        lastDisconnect: null,
        reconnecting: false,
    };

    sessions.set(tenantId, session);
    healthStates.set(tenantId, {
        tenantId,
        riskScore: 0,
        lastProbeAt: null,
        lastProbeOk: true,
        consecutiveFailures: 0,
        disconnectHistory: [],
    });

    // ── Connection updates ──

    socket.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code — broadcast to frontend via Supabase Realtime
        if (qr) {
            await broadcastQR(tenantId, qr);
        }

        if (connection === "open") {
            console.log(`[${tenantId}] Connected`);
            session.connectedAt = new Date();
            session.retryCount = 0;
            session.reconnecting = false;
            reconnecting.delete(tenantId);

            // Clear QR code
            await clearQR(tenantId);

            // Get phone number from creds
            const phoneNumber = state.creds.me?.id?.split(":")[0] ?? null;
            session.phoneNumber = phoneNumber;

            // Update DB
            await supabase
                .from("tenants")
                .update({
                    whatsapp_connected: true,
                    whatsapp_phone: phoneNumber,
                    connection_type: "baileys",
                })
                .eq("id", tenantId);

            // Upsert baileys_config
            await supabase.from("baileys_config").upsert(
                {
                    tenant_id: tenantId,
                    phone_number: phoneNumber,
                    connected_at: new Date().toISOString(),
                    warmup_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                    risk_level: "low",
                },
                { onConflict: "tenant_id" }
            );

            // Start presence pause scheduler
            presencePauser.start(tenantId, socket);

            // Bulk-fetch profile pictures for conversations without one (fire-and-forget)
            bulkFetchProfilePictures(socket, tenantId)
                .catch((err) => console.error(`[${tenantId}] Bulk profile pic error:`, err));
        }

        if (connection === "close") {
            const boom = lastDisconnect?.error as Boom | undefined;
            const statusCode = boom?.output?.statusCode ?? 0;
            const reason = boom?.message ?? "unknown";

            console.log(`[${tenantId}] Disconnected: ${statusCode} (${reason})`);
            session.lastDisconnect = new Date();
            presencePauser.stop(tenantId);

            // Track disconnect in health state
            const health = healthStates.get(tenantId);
            if (health) {
                health.disconnectHistory.push({ code: statusCode, at: new Date() });
                // Keep only last 20 disconnects
                if (health.disconnectHistory.length > 20) {
                    health.disconnectHistory = health.disconnectHistory.slice(-20);
                }
            }

            await _handleDisconnect(tenantId, statusCode, reason);
        }
    });

    // ── Credential updates ──

    socket.ev.on("creds.update", saveCreds);

    // ── Message events ──

    socket.ev.on("messages.upsert", async (m) => {
        console.log(`[${tenantId}] messages.upsert: type=${m.type}, count=${m.messages.length}`);

        if (m.type !== "notify") return;

        for (const msg of m.messages) {
            const jid = msg.key.remoteJid ?? "unknown";
            const fromMe = msg.key.fromMe ?? false;
            const hasMessage = !!msg.message;
            const isGroup = jid.endsWith("@g.us");
            const isBroadcast = jid === "status@broadcast";

            // Log every message for debugging
            console.log(`[${tenantId}] MSG: jid=${jid} fromMe=${fromMe} hasMsg=${hasMessage} group=${isGroup} broadcast=${isBroadcast} pushName=${msg.pushName ?? "none"}`);

            if (!hasMessage) continue;
            if (isBroadcast) continue;

            // Owner's outgoing messages — save to DB (for dashboard + learning engine)
            if (fromMe) {
                try {
                    await _saveOwnerOutgoing(tenantId, msg);
                } catch (err) {
                    console.error(`[${tenantId}] Owner message save error:`, err);
                }
                continue;
            }

            try {
                await handleMessage(tenantId, socket, msg);
                console.log(`[${tenantId}] ✓ Handled message from ${jid}`);
            } catch (err) {
                console.error(`[${tenantId}] Message handler error:`, err);
            }
        }
    });

    // ── LID → phone number resolution ──

    socket.ev.on("chats.phoneNumberShare", async ({ lid, jid: phoneJid }) => {
        console.log(`[${tenantId}] phoneNumberShare: ${lid} → ${phoneJid}`);
        try {
            await registerLidMapping(lid, phoneJid, tenantId);
        } catch (err) {
            console.error(`[${tenantId}] LID mapping error:`, err);
        }
    });
}

// ── Disconnect handler ─────────────────────────────────────────────

/** Flush credentials to DB before destroying session for reconnect */
async function _flushAndCleanup(tenantId: string): Promise<void> {
    const cleanup = sessionCleanup.get(tenantId);
    if (cleanup) {
        try {
            await cleanup.forceFlush();
        } catch (err) {
            console.error(`[${tenantId}] Flush before reconnect failed:`, err);
        }
        cleanup.stopSync();
        sessionCleanup.delete(tenantId);
    }
    sessions.delete(tenantId);
}

async function _handleDisconnect(tenantId: string, statusCode: number, reason: string): Promise<void> {
    const session = sessions.get(tenantId);
    if (!session) return;

    switch (statusCode) {
        case DisconnectReason.connectionLost: // 408
        case DisconnectReason.timedOut: // 408
            // Network issue — reconnect immediately, keep auth
            console.log(`[${tenantId}] Connection lost — reconnecting...`);
            await _flushAndCleanup(tenantId);
            await _reconnectWithCooldown(tenantId);
            break;

        case DisconnectReason.restartRequired: // 515
            // WhatsApp server restart — reconnect in 3s
            console.log(`[${tenantId}] Restart required — reconnecting in 3s...`);
            reconnecting.add(tenantId); // Prevent parallel reconnects during delay
            await _flushAndCleanup(tenantId);
            setTimeout(() => { reconnecting.delete(tenantId); _reconnectWithCooldown(tenantId); }, 3000);
            break;

        case DisconnectReason.loggedOut: // 401
            // Session expired — clear auth, require QR rescan
            console.log(`[${tenantId}] Logged out — session cleared`);
            await stopSession(tenantId, true);
            break;

        case DisconnectReason.connectionReplaced: // 440
            // Another instance (e.g. new deploy) took over — just stop socket.
            // Do NOT clear data: the new instance uses the same credentials
            // and conversations should be preserved.
            console.log(`[${tenantId}] Connection replaced — stopping local socket (data preserved)`);
            await stopSession(tenantId, false);
            break;

        case DisconnectReason.forbidden: // 403
            // Number banned — terminal state
            console.error(`[${tenantId}] BANNED — stopping session`);
            await stopSession(tenantId, false);

            // Update risk level
            await getSupabase()
                .from("baileys_config")
                .update({ risk_level: "critical", last_disconnect_reason: "banned" })
                .eq("tenant_id", tenantId);

            await getSupabase()
                .from("tenants")
                .update({ whatsapp_connected: false })
                .eq("id", tenantId);
            break;

        case DisconnectReason.multideviceMismatch: // 411
        case DisconnectReason.badSession:
            // Corrupted crypto — clear keys only (not creds), reconnect
            console.log(`[${tenantId}] Bad session/multidevice mismatch — clearing keys and reconnecting`);
            await _flushAndCleanup(tenantId);
            await _reconnectWithCooldown(tenantId);
            break;

        case 503: // Service unavailable
            // WhatsApp servers down — wait 60s
            console.log(`[${tenantId}] WhatsApp unavailable — retrying in 60s`);
            await _flushAndCleanup(tenantId);
            setTimeout(() => _reconnectWithCooldown(tenantId), 60_000);
            break;

        default:
            // Unknown — exponential backoff
            session.retryCount++;
            if (session.retryCount > 5) {
                console.error(`[${tenantId}] Max retries reached — stopping`);
                await stopSession(tenantId, false);
                await getSupabase()
                    .from("tenants")
                    .update({ whatsapp_connected: false })
                    .eq("id", tenantId);
                return;
            }

            const delays = [5000, 15000, 30000, 60000, 120000];
            const delay = delays[Math.min(session.retryCount - 1, delays.length - 1)];
            console.log(`[${tenantId}] Unknown disconnect (${statusCode}) — retry ${session.retryCount}/5 in ${delay / 1000}s`);
            await _flushAndCleanup(tenantId);
            setTimeout(() => _reconnectWithCooldown(tenantId), delay);
            break;
    }
}

async function _reconnectWithCooldown(tenantId: string): Promise<void> {
    // Cooldown check
    const last = lastReconnectAt.get(tenantId) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < RECONNECT_COOLDOWN_MS) {
        const wait = RECONNECT_COOLDOWN_MS - elapsed;
        console.log(`[${tenantId}] Reconnect cooldown — waiting ${Math.round(wait / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, wait));
    }

    if (reconnecting.has(tenantId) || sessions.has(tenantId)) return;

    reconnecting.add(tenantId);
    lastReconnectAt.set(tenantId, Date.now());

    try {
        // Call _initSocket directly — createSession checks reconnecting set
        // which would cause a deadlock since we just added tenantId above.
        await _initSocket(tenantId, false);
    } catch (err) {
        console.error(`[${tenantId}] Reconnect failed:`, err);
    } finally {
        reconnecting.delete(tenantId);
    }
}

// ── Watchdog ───────────────────────────────────────────────────────

/**
 * Probe all connected sessions. Called by cron every 2 minutes.
 * Detects zombie sessions and force-reconnects them.
 */
export async function runWatchdog(): Promise<void> {
    for (const [tenantId, session] of sessions) {
        if (session.reconnecting) continue;

        const health = healthStates.get(tenantId);
        if (!health) continue;

        try {
            // Probe: send presence update with timeout
            await Promise.race([
                session.socket.sendPresenceUpdate("available"),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("probe timeout")), 10_000)
                ),
            ]);

            health.lastProbeAt = new Date();
            health.lastProbeOk = true;
            health.consecutiveFailures = 0;
        } catch {
            health.lastProbeOk = false;
            health.consecutiveFailures++;

            console.warn(`[${tenantId}] Watchdog probe failed (${health.consecutiveFailures}x)`);

            if (health.consecutiveFailures >= 3) {
                console.error(`[${tenantId}] Zombie session detected — force reconnecting`);
                presencePauser.stop(tenantId);
                try { session.socket.end(undefined); } catch { /* already closed */ }
                await _flushAndCleanup(tenantId);
                await _reconnectWithCooldown(tenantId);
            }
        }
    }
}

// ── Auto-reconnect on startup ──────────────────────────────────────

/**
 * Restore all Baileys sessions on server startup.
 * Staggered: 2s delay between each to avoid connection storms.
 */
export async function autoReconnectAll(): Promise<void> {
    const supabase = getSupabase();

    const { data: tenants } = await supabase
        .from("tenants")
        .select("id")
        .eq("whatsapp_connected", true)
        .eq("connection_type", "baileys");

    if (!tenants || tenants.length === 0) {
        console.log("No Baileys sessions to restore");
        return;
    }

    console.log(`Restoring ${tenants.length} Baileys session(s)...`);

    for (let i = 0; i < tenants.length; i++) {
        const tenantId = tenants[i].id;
        try {
            await createSession(tenantId);
            console.log(`[${tenantId}] Session restored (${i + 1}/${tenants.length})`);
        } catch (err) {
            console.error(`[${tenantId}] Failed to restore session:`, err);
        }

        // Stagger: 2s delay between sessions
        if (i < tenants.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
}

// ── Save owner outgoing messages ────────────────────────────────────

import type { WAMessage } from "@whiskeysockets/baileys";

async function _saveOwnerOutgoing(tenantId: string, msg: WAMessage): Promise<void> {
    const jid = msg.key.remoteJid;
    if (!jid || jid.endsWith("@g.us")) return; // Skip groups

    const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        null;

    if (!text) return; // Skip media-only outgoing messages

    const phoneNumber = await resolveLidPhone(jid, msg, tenantId);
    const supabase = getSupabase();

    // Find or create conversation
    const { data: conv } = await supabase
        .from("conversations")
        .upsert(
            {
                tenant_id: tenantId,
                phone_number: phoneNumber,
                is_group: false,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id,phone_number" }
        )
        .select("id")
        .single();

    if (!conv) return;

    // Save as owner message
    await supabase.from("messages").insert({
        tenant_id: tenantId,
        conversation_id: conv.id,
        role: "owner",
        content: text,
        wa_message_id: msg.key.id ?? null,
        is_from_agent: false,
    });

    // Auto-pause — owner is handling this conversation
    await supabase
        .from("conversations")
        .update({ is_paused: true, updated_at: new Date().toISOString() })
        .eq("id", conv.id)
        .eq("tenant_id", tenantId);

    console.log(`[${tenantId}] Owner message saved for ${phoneNumber}`);
}
