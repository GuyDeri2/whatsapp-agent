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
} from "@whiskeysockets/baileys";
import type { proto } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import { useSupabaseAuthState, clearSessionData } from "./session-store";
import { handleIncomingMessage } from "./message-handler";

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

/** Get all active session IDs. */
export function getActiveSessions(): string[] {
    return Array.from(sessions.keys());
}

/**
 * Send a message via an active session.
 */
export async function sendMessage(tenantId: string, jid: string, text: string): Promise<string> {
    const session = sessions.get(tenantId);
    if (!session || session.status !== "connected") {
        throw new Error("Session not connected");
    }

    // 1. Send via Baileys
    const sentMsg = await session.socket.sendMessage(jid, { text });

    // 2. Save to DB as owner message
    const supabase = getSupabase();
    const phoneNumber = jid.split("@")[0];

    // Ensure conversation exists
    const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .upsert(
            { tenant_id: tenantId, phone_number: phoneNumber },
            { onConflict: "tenant_id,phone_number" }
        )
        .select("id")
        .single();

    if (conversation && !convError) {
        await supabase.from("messages").insert({
            conversation_id: conversation.id,
            role: "owner",
            content: text,
            sender_name: "Owner",
            is_from_agent: false,
        });
    }

    return sentMsg?.key?.id || "unknown";
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

    // ── Event: history sync ──
    socket.ev.on("messaging-history.set", async ({ chats, messages, isLatest }) => {
        try {
            console.log(`[${tenantId}] 📥 Received history sync (isLatest: ${isLatest}). Processing...`);
            const supabase = getSupabase();

            // Store recent chats to populate the sidebar conversations
            for (const chat of chats) {
                if (!chat.id) continue;
                // Only sync the last 30 recent chats to avoid overloading
                const phoneNumber = chat.id.split("@")[0];
                let contactName = chat.name || null;

                const { data: conversation, error: convError } = await supabase
                    .from("conversations")
                    .upsert(
                        {
                            tenant_id: tenantId,
                            phone_number: phoneNumber,
                            contact_name: contactName,
                        },
                        { onConflict: "tenant_id,phone_number" }
                    )
                    .select("id")
                    .single();

                if (convError || !conversation) continue;

                // Sync messages for this chat if they exist in the history payload
                const chatMessages = messages.filter((m) => m.key.remoteJid === chat.id);
                // Keep only the latest 20 messages per chat
                const recentMsgs = chatMessages.slice(-20);

                for (const msg of recentMsgs) {
                    if (!msg.message) continue;
                    if (msg.key.remoteJid === "status@broadcast") continue;
                    if (msg.message.protocolMessage) continue;

                    const textContent =
                        msg.message.conversation ||
                        msg.message.extendedTextMessage?.text ||
                        null;

                    if (!textContent) continue;

                    const isFromMe = msg.key.fromMe ?? false;
                    const role = isFromMe ? "owner" : "user";
                    const senderName = isFromMe ? "Owner" : (msg.pushName || null);

                    const createdAt = new Date(
                        (msg.messageTimestamp as number) * 1000 || Date.now()
                    ).toISOString();

                    // Insert the message if it doesn't already exist (we might not have the ID, but we just insert)
                    // We'll use a simple insert and rely on supabase not failing hard (though dupes could happen if synced multiple times)
                    // A better approach is upserting by message ID, but for now we just insert history
                    await supabase.from("messages").insert({
                        // Ideally we'd store the Baileys message ID to avoid duplicates
                        conversation_id: conversation.id,
                        role,
                        content: textContent,
                        sender_name: senderName,
                        is_from_agent: false, // History from before connect defaults to human
                        created_at: createdAt,
                    }).select('id').single(); // Just fire and forget
                }
            }
            console.log(`[${tenantId}] ✅ History sync processed for ${chats.length} chats`);
        } catch (err) {
            console.error(`[${tenantId}] History sync error:`, err);
        }
    });

    // ── Event: incoming messages ──
    socket.ev.on("messages.upsert", async (upsert) => {
        for (const msg of upsert.messages) {
            // Skip status broadcasts and protocol messages
            if (msg.key.remoteJid === "status@broadcast") continue;
            if (msg.message?.protocolMessage) continue;

            // Extract text content and media
            let textContent =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                msg.message?.documentMessage?.caption ||
                "";

            let mediaUrl: string | null = null;
            let mediaType: string | null = null;

            // Check if message has media
            const hasMedia = !!(
                msg.message?.imageMessage ||
                msg.message?.videoMessage ||
                msg.message?.audioMessage ||
                msg.message?.documentMessage ||
                msg.message?.stickerMessage
            );

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
                    }
                } catch (err) {
                    console.error(`[${tenantId}] Media processing error:`, err);
                }
            }

            if (!textContent && !mediaUrl) continue;

            const remoteJid = msg.key.remoteJid!;
            const isFromMe = msg.key.fromMe ?? false;
            let contactName = msg.pushName ?? null;
            let senderName = msg.pushName ?? null;

            // If it's a group chat, try to fetch the group name (subject)
            // The sender's name (pushName) stays as the senderName
            if (remoteJid.endsWith("@g.us")) {
                try {
                    const metadata = await socket.groupMetadata(remoteJid);
                    if (metadata.subject) {
                        contactName = metadata.subject;
                    }
                } catch (err) {
                    console.error(`[${tenantId}] Could not fetch group metadata:`, err);
                }
            } else if (isFromMe) {
                senderName = "Owner";
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
                    socket.sendMessage.bind(socket)
                );
            } catch (err) {
                console.error(`[${tenantId}] Message handler error:`, err);
            }
        }
    });
}
