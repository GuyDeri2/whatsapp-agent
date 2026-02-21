/**
 * WhatsApp Session Manager.
 * Manages the lifecycle of Baileys WhatsApp sessions per tenant:
 *   - Start/stop sessions
 *   - QR code generation
 *   - Auto-reconnection
 *   - Message routing to the handler
 */

import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    BaileysEventMap,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import { useSupabaseAuthState, clearSessionData } from "./session-store";
import { handleIncomingMessage } from "./message-handler";
import QRCode from "qrcode";

// ─── Types ────────────────────────────────────────────────────────────
interface SessionInfo {
    socket: WASocket;
    qrCode: string | null;
    status: "connecting" | "connected" | "disconnected";
    tenantId: string;
    retryCount: number;
}

type QRUpdateCallback = (tenantId: string, qrDataUrl: string | null) => void;

// ─── State ────────────────────────────────────────────────────────────
const sessions = new Map<string, SessionInfo>();
const MAX_RETRIES = 5;

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
    if (!_supabase)
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    return _supabase;
}

// Global QR update callback (used by SSE)
let _qrCallback: QRUpdateCallback | null = null;
export function setQRUpdateCallback(cb: QRUpdateCallback) {
    _qrCallback = cb;
}

// ─── Logger ───────────────────────────────────────────────────────────
const logger = pino({ level: "warn" });

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
        try {
            await session.socket.logout();
        } catch {
            try { session.socket.end(undefined); } catch { /* ignore */ }
        }
        sessions.delete(tenantId);
    }

    if (clearData) {
        await clearSessionData(tenantId);
    }

    // Update tenant status
    await getSupabase()
        .from("tenants")
        .update({ whatsapp_connected: false })
        .eq("id", tenantId);

    console.log(`[${tenantId}] Session stopped`);
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

/**
 * Get all active session IDs.
 */
export function getActiveSessions(): string[] {
    return Array.from(sessions.keys());
}

/**
 * Restore all previously connected sessions on server start.
 */
export async function restoreAllSessions(): Promise<void> {
    const { data: tenants } = await getSupabase()
        .from("tenants")
        .select("id")
        .eq("whatsapp_connected", true);

    if (!tenants || tenants.length === 0) {
        console.log("No sessions to restore");
        return;
    }

    console.log(`Restoring ${tenants.length} session(s)...`);
    for (const tenant of tenants) {
        try {
            await startSession(tenant.id);
            // small delay between starts to avoid rate-limiting
            await new Promise((r) => setTimeout(r, 2000));
        } catch (err) {
            console.error(`Failed to restore session for tenant ${tenant.id}:`, err);
        }
    }
}

// ─── Internal: create Baileys socket ──────────────────────────────────
async function createSession(tenantId: string): Promise<void> {
    const { state, saveCreds } = await useSupabaseAuthState(tenantId);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: false,
    });

    const sessionInfo: SessionInfo = {
        socket,
        qrCode: null,
        status: "connecting",
        tenantId,
        retryCount: 0,
    };
    sessions.set(tenantId, sessionInfo);

    // ── Event: connection update ──
    socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code received
        if (qr) {
            const qrDataUrl = await QRCode.toDataURL(qr);
            sessionInfo.qrCode = qrDataUrl;
            sessionInfo.status = "connecting";
            console.log(`[${tenantId}] 📱 QR code generated — waiting for scan...`);
            if (_qrCallback) _qrCallback(tenantId, qrDataUrl);
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
            if (_qrCallback) _qrCallback(tenantId, null);
        }

        // Disconnected
        if (connection === "close") {
            sessionInfo.status = "disconnected";
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect =
                statusCode !== DisconnectReason.loggedOut &&
                sessionInfo.retryCount < MAX_RETRIES;

            console.log(
                `[${tenantId}] ❌ Connection closed (code: ${statusCode}). Reconnect: ${shouldReconnect}`
            );

            if (shouldReconnect) {
                sessionInfo.retryCount++;
                const delay = Math.min(5000 * sessionInfo.retryCount, 30000);
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
                }
            }
        }
    });

    // ── Event: save credentials ──
    socket.ev.on("creds.update", saveCreds);

    // ── Event: incoming messages ──
    socket.ev.on("messages.upsert", async (upsert) => {
        for (const msg of upsert.messages) {
            // Skip non-text, status broadcasts, and protocol messages
            if (!msg.message) continue;
            if (msg.key.remoteJid === "status@broadcast") continue;
            if (msg.message.protocolMessage) continue;

            // Extract text content
            const textContent =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                null;

            if (!textContent) continue;

            const remoteJid = msg.key.remoteJid!;
            const isFromMe = msg.key.fromMe ?? false;
            const pushName = msg.pushName ?? null;

            try {
                await handleIncomingMessage(
                    tenantId,
                    remoteJid,
                    textContent,
                    isFromMe,
                    pushName,
                    socket.sendMessage.bind(socket)
                );
            } catch (err) {
                console.error(`[${tenantId}] Message handler error:`, err);
            }
        }
    });
}
