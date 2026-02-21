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
    preKeyErrors: number; // track PreKey errors to decide when to reset
}

type QRUpdateCallback = (tenantId: string, qrDataUrl: string | null) => void;

// ─── State ────────────────────────────────────────────────────────────
const sessions = new Map<string, SessionInfo>();
const MAX_RETRIES = 5;
const MAX_PREKEY_ERRORS = 10; // after this many PreKeyErrors, clear session and reconnect

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
 * Force-reconnect: stop session, optionally clear auth, and restart.
 */
export async function reconnectSession(
    tenantId: string,
    clearAuth = false
): Promise<void> {
    console.log(`[${tenantId}] 🔄 Force reconnecting (clearAuth: ${clearAuth})...`);
    const session = sessions.get(tenantId);
    if (session) {
        try { session.socket.end(undefined); } catch { /* ignore */ }
        sessions.delete(tenantId);
    }
    if (clearAuth) {
        await clearSessionData(tenantId);
    }
    await getSupabase()
        .from("tenants")
        .update({ whatsapp_connected: false })
        .eq("id", tenantId);
    await new Promise((r) => setTimeout(r, 2000));
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
        syncFullHistory: true, // Sync ALL past conversations on connect
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

            // After a short delay, resolve any group names that are missing
            setTimeout(() => resolveGroupNames(tenantId, socket), 10000);
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
                // Use exponential backoff: 3s, 6s, 12s, 24s, 30s (capped)
                const delay = Math.min(3000 * Math.pow(2, sessionInfo.retryCount - 1), 30000);
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
                const phoneNumber = chat.id.split("@")[0];
                const isGroup = chat.id.endsWith("@g.us");
                let contactName = chat.name || null;

                const { data: conversation, error: convError } = await supabase
                    .from("conversations")
                    .upsert(
                        {
                            tenant_id: tenantId,
                            phone_number: phoneNumber,
                            contact_name: contactName,
                            is_group: isGroup,
                        },
                        { onConflict: "tenant_id,phone_number" }
                    )
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

                const remoteJid = msg.key.remoteJid!;
                const phoneNumber = remoteJid.split("@")[0];
                const isGroup = remoteJid.endsWith("@g.us");

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
                    role,
                    content: textContent,
                    sender_name: senderName,
                    is_from_agent: false,
                    created_at: createdAt,
                    wa_message_id: waMessageId,
                });

                if (!insertErr) messagesSynced++;
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
        for (const msg of upsert.messages) {
            // Skip status broadcasts and protocol messages
            if (msg.key.remoteJid === "status@broadcast") continue;
            if (msg.message?.protocolMessage) continue;
            // Skip messages with no content (failed decryption produces empty msg)
            if (msg.messageStubType && !msg.message) continue;

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
