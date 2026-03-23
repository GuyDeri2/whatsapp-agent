/**
 * Message Handler — processes incoming WhatsApp messages.
 *
 * Flow: incoming message → save to DB → check filters → generate AI reply → human-like send
 */

import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { getSupabase } from "./session-manager";
import { humanSend, RateLimiter } from "./antiban";
import { generateReply, summarizeConversationForHandoff } from "./ai-agent";
import { resolveLidPhone } from "./lid-resolver";
import { fetchAndStoreProfilePicture } from "./profile-pictures";

// META_API constants removed — Baileys sends via socket, not Cloud API

export const rateLimiter = new RateLimiter();

// Per-conversation generation lock — prevents concurrent AI replies
const generationLocks = new Map<string, Promise<void>>();

function tryAcquireGenerationLock(conversationId: string): boolean {
    if (generationLocks.has(conversationId)) return false;
    return true;
}

function setGenerationLock(conversationId: string, promise: Promise<void>): void {
    generationLocks.set(conversationId, promise);
    promise.finally(() => generationLocks.delete(conversationId));
}

// Per-conversation cooldown — prevent rapid-fire AI replies (parity with Cloud API)
const lastAiReplyAt = new Map<string, number>();
const AI_REPLY_COOLDOWN_MS = 5_000;

function isConversationCoolingDown(conversationId: string): boolean {
    const lastReply = lastAiReplyAt.get(conversationId);
    if (!lastReply) return false;
    return Date.now() - lastReply < AI_REPLY_COOLDOWN_MS;
}

// Deduplication: track processed message IDs (last 1000)
const processedMessages = new Set<string>();
const MAX_PROCESSED = 1000;

function addProcessed(id: string) {
    processedMessages.add(id);
    if (processedMessages.size > MAX_PROCESSED) {
        const first = processedMessages.values().next().value;
        if (first) processedMessages.delete(first);
    }
}

/**
 * Extract human-readable content from a WAMessage.
 * Returns null if the message has no meaningful content to store.
 */
export function extractMessageContent(msg: WAMessage): string | null {
    const m = msg.message;
    if (!m) return null;

    // Text messages
    const text =
        m.conversation ??
        m.extendedTextMessage?.text ??
        m.imageMessage?.caption ??
        m.videoMessage?.caption ??
        null;

    if (text) {
        // Append quoted context if replying to a message
        const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quoted) {
            const quotedText =
                quoted.conversation ??
                quoted.extendedTextMessage?.text ??
                quoted.imageMessage?.caption ??
                null;
            if (quotedText) {
                return `[בתגובה ל: "${quotedText.substring(0, 80)}"]\n${text}`;
            }
        }
        return text;
    }

    // Reaction
    if (m.reactionMessage) {
        const emoji = m.reactionMessage.text;
        return emoji ? `[ריאקציה: ${emoji}]` : null;
    }

    // Location
    if (m.locationMessage) {
        const loc = m.locationMessage;
        const name = loc.name || loc.address || "";
        return `[מיקום${name ? `: ${name}` : ""}]`;
    }
    if (m.liveLocationMessage) {
        return "[מיקום חי]";
    }

    // Contact card
    if (m.contactMessage) {
        const displayName = m.contactMessage.displayName ?? "";
        return `[כרטיס איש קשר: ${displayName}]`;
    }
    if (m.contactsArrayMessage) {
        const names = m.contactsArrayMessage.contacts?.map(c => c.displayName).join(", ") ?? "";
        return `[כרטיסי אנשי קשר: ${names}]`;
    }

    // Poll
    if (m.pollCreationMessage) {
        const q = m.pollCreationMessage.name ?? "";
        const opts = m.pollCreationMessage.options?.map(o => o.optionName).join(", ") ?? "";
        return `[סקר: ${q} | אפשרויות: ${opts}]`;
    }

    // Media with descriptive labels
    if (m.imageMessage) return "[תמונה]";
    if (m.videoMessage) return "[סרטון]";
    if (m.audioMessage) {
        return m.audioMessage.ptt ? "[הודעה קולית]" : "[קובץ שמע]";
    }
    if (m.documentMessage) {
        const fileName = m.documentMessage.fileName ?? "מסמך";
        return `[מסמך: ${fileName}]`;
    }
    if (m.stickerMessage) return "[סטיקר]";

    return null;
}

/**
 * Handle an incoming WhatsApp message.
 */
export async function handleMessage(
    tenantId: string,
    socket: WASocket,
    msg: WAMessage
): Promise<void> {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    // Skip groups
    if (jid.endsWith("@g.us")) {
        console.log(`[${tenantId}] Skipping group message: ${jid}`);
        return;
    }

    // Dedup
    const msgId = msg.key.id;
    if (!msgId || processedMessages.has(msgId)) {
        console.log(`[${tenantId}] Skipping duplicate: ${msgId}`);
        return;
    }
    addProcessed(msgId);

    // Extract text content
    const content = extractMessageContent(msg);
    if (!content) {
        console.log(`[${tenantId}] Skipping message with no content from ${jid}`);
        return;
    }

    // Extract phone number from JID (resolve LID → real phone if available)
    const phoneNumber = await resolveLidPhone(jid, msg, tenantId);
    console.log(`[${tenantId}] Processing message from ${phoneNumber}: "${content.substring(0, 50)}"`);

    const supabase = getSupabase();

    try {
        // ── Get or create conversation ──

        let conversationId: string;

        const { data: existingConv } = await supabase
            .from("conversations")
            .select("id, is_paused, contact_name")
            .eq("tenant_id", tenantId)
            .eq("phone_number", phoneNumber)
            .eq("is_group", false)
            .maybeSingle();

        if (existingConv) {
            conversationId = existingConv.id;

            // Update timestamp + fill missing contact name from pushName
            const updateFields: Record<string, string> = { updated_at: new Date().toISOString() };
            if (!existingConv.contact_name && msg.pushName) {
                updateFields.contact_name = msg.pushName;
            }
            await supabase
                .from("conversations")
                .update(updateFields)
                .eq("id", conversationId)
                .eq("tenant_id", tenantId);

            // If paused, don't respond (owner is handling)
            if (existingConv.is_paused) {
                // Still save the message
                await _saveMessage(tenantId, conversationId, "user", content, msgId);
                return;
            }
        } else {
            // Create new conversation
            const contactName = msg.pushName ?? null;

            const { data: newConv, error } = await supabase
                .from("conversations")
                .insert({
                    tenant_id: tenantId,
                    phone_number: phoneNumber,
                    contact_name: contactName,
                    is_group: false,
                    is_paused: false,
                })
                .select("id")
                .single();

            if (error || !newConv) {
                console.error(`[${tenantId}] Failed to create conversation:`, error?.message);
                return;
            }

            conversationId = newConv.id;

            // Fetch profile picture (fire-and-forget)
            fetchAndStoreProfilePicture(socket, jid, tenantId, phoneNumber)
                .catch((err) => console.error(`[${tenantId}] Profile pic fetch error:`, err));
        }

        // ── Save incoming message ──

        await _saveMessage(tenantId, conversationId, "user", content, msgId);

        // ── Check contact filters ──

        const { data: tenant } = await supabase
            .from("tenants")
            .select("agent_mode, agent_filter_mode")
            .eq("id", tenantId)
            .single();

        if (!tenant) return;

        // Only respond when agent is active (parity with Cloud API)
        if (tenant.agent_mode !== "active") return;

        // Check whitelist/blacklist
        if (tenant.agent_filter_mode !== "all") {
            const { data: rules } = await supabase
                .from("contact_rules")
                .select("phone_number, rule_type")
                .eq("tenant_id", tenantId);

            const phoneDigits = phoneNumber.replace(/\D/g, "");

            const matched = (rules ?? []).find((r) => {
                const ruleDigits = r.phone_number.replace(/\D/g, "");
                return phoneDigits === ruleDigits || phoneDigits.endsWith(ruleDigits.slice(-9));
            });

            if (tenant.agent_filter_mode === "whitelist" && matched?.rule_type !== "allow") return;
            if (tenant.agent_filter_mode === "blacklist" && matched?.rule_type === "block") return;
        }

        // ── Rate limit check ──

        if (!rateLimiter.canSend(tenantId, conversationId)) {
            console.warn(`[${tenantId}] Rate limit hit for conversation ${conversationId}`);
            return;
        }

        // ── Per-conversation cooldown (parity with Cloud API) ──
        if (isConversationCoolingDown(conversationId)) {
            console.log(`[${tenantId}] Conversation ${conversationId} cooling down — skipping AI`);
            return;
        }

        // ── Generation lock — prevent concurrent AI calls for same conversation ──
        if (!tryAcquireGenerationLock(conversationId)) {
            console.log(`[${tenantId}] Generation already in progress for ${conversationId} — skipping`);
            return;
        }

        // Wrap the generation in a promise so the lock is held until completion
        const generationPromise = (async () => {
        // ── Generate AI reply ──

        // Fetch recent history (last 60 min, with created_at for gap detection)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: history } = await supabase
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversationId)
            .eq("tenant_id", tenantId)
            .in("role", ["user", "assistant"])
            .gte("created_at", oneHourAgo)
            .order("created_at", { ascending: true })
            .limit(20);

        const chatHistory = (history ?? []).map((m) => ({
            role: m.role as "user" | "assistant" | "owner",
            content: m.content,
            created_at: m.created_at,
        }));

        const reply = await generateReply(tenantId, chatHistory);
        if (!reply) return;

        // Check for [PAUSE] — handoff to owner
        const shouldPause = reply.includes("[PAUSE]");
        const cleanReply = reply.replace(/\[PAUSE\]/g, "").trim();

        if (cleanReply) {
            // Anti-repetition: check if last 3 assistant messages are similar
            const recentAssistant = chatHistory
                .filter(m => m.role === "assistant")
                .slice(-3)
                .map(m => m.content.substring(0, 80).replace(/\s+/g, " ").trim());
            const replyFingerprint = cleanReply.substring(0, 80).replace(/\s+/g, " ").trim();
            const duplicateCount = recentAssistant.filter(m => m === replyFingerprint).length;
            if (duplicateCount >= 2) {
                console.warn(`[${tenantId}] Anti-repetition: reply too similar to last ${duplicateCount} messages — auto-escalating`);
                // Auto-escalate instead of repeating
                const escalationMsg = "מעביר אותך לנציג שלנו שיוכל לעזור לך טוב יותר.";
                await humanSend(socket, jid, escalationMsg);
                await _saveMessage(tenantId, conversationId, "assistant", escalationMsg, null, true);
                lastAiReplyAt.set(conversationId, Date.now());
                // Pause the conversation
                await supabase
                    .from("conversations")
                    .update({ is_paused: true, updated_at: new Date().toISOString() })
                    .eq("id", conversationId)
                    .eq("tenant_id", tenantId);
                notifyOwnerOfEscalation(supabase, socket, tenantId, conversationId, phoneNumber)
                    .catch((err) => console.error(`[${tenantId}] Escalation notification error:`, err));
                return;
            }

            // Anti-ban: block identical messages sent to too many different contacts
            if (!rateLimiter.canSendContent(tenantId, conversationId, cleanReply)) {
                console.warn(`[${tenantId}] Identical content blocked for conversation ${conversationId}`);
                return;
            }

            // Mark incoming message as read (anti-ban: humans always read before replying)
            try {
                await socket.readMessages([msg.key]);
            } catch {
                // Non-fatal — some messages may not support read receipts
            }

            // Send with human-like behavior
            await humanSend(socket, jid, cleanReply);

            // Save assistant message
            await _saveMessage(tenantId, conversationId, "assistant", cleanReply, null, true);

            // Record cooldown + rate limit
            lastAiReplyAt.set(conversationId, Date.now());
            rateLimiter.recordSend(tenantId, conversationId, cleanReply);
        }

        // Pause conversation if handoff + notify owner
        if (shouldPause) {
            await supabase
                .from("conversations")
                .update({ is_paused: true, updated_at: new Date().toISOString() })
                .eq("id", conversationId)
                .eq("tenant_id", tenantId);

            // Notify business owner via Baileys socket (best-effort, non-blocking)
            notifyOwnerOfEscalation(supabase, socket, tenantId, conversationId, phoneNumber)
                .catch((err) => console.error(`[${tenantId}] Escalation notification error:`, err));
        }
        })(); // end generation promise
        setGenerationLock(conversationId, generationPromise);
        await generationPromise;
    } catch (err) {
        console.error(`[${tenantId}] Error processing message from ${phoneNumber}:`, err);
    }
}

// ── Save message to DB ─────────────────────────────────────────────

// ── Normalize owner phone to international format ─────────────────

function normalizeOwnerPhone(phone: string): string | null {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return null;

    // Israeli local format: 05x, 07x, etc.
    if (digits.startsWith("0") && digits.length === 10) {
        return "972" + digits.substring(1);
    }

    // Already international with 972
    if (digits.startsWith("972") && digits.length >= 11) {
        return digits;
    }

    // Some other international format — return as-is if valid (8+ digits)
    if (digits.length >= 8) {
        return digits;
    }

    return null;
}

// ── Notify owner of escalation via Baileys socket ─────────────────

async function notifyOwnerOfEscalation(
    supabase: ReturnType<typeof getSupabase>,
    socket: WASocket,
    tenantId: string,
    conversationId: string,
    customerPhone: string
): Promise<void> {
    try {
        // 1. Fetch owner_phone from tenant
        const { data: tenant } = await supabase
            .from("tenants")
            .select("owner_phone")
            .eq("id", tenantId)
            .single();

        if (!tenant?.owner_phone) {
            console.warn(`[${tenantId}] Escalation: no owner_phone configured — skipping notification`);
            return;
        }

        const ownerPhoneNormalized = normalizeOwnerPhone(tenant.owner_phone);
        if (!ownerPhoneNormalized) {
            console.warn(`[${tenantId}] Escalation: invalid owner_phone "${tenant.owner_phone}" — skipping`);
            return;
        }

        // Don't send escalation to the customer themselves
        if (ownerPhoneNormalized === customerPhone) {
            console.log(`[${tenantId}] Escalation: owner is the customer — skipping notification`);
            return;
        }

        // 2. Get conversation details
        const { data: conv } = await supabase
            .from("conversations")
            .select("contact_name")
            .eq("id", conversationId)
            .eq("tenant_id", tenantId)
            .single();

        const contactName = conv?.contact_name || null;

        // 3. Format display phone
        const displayPhone = customerPhone.startsWith("972") && customerPhone.length >= 11
            ? "0" + customerPhone.substring(3)
            : customerPhone;

        // 4. Generate AI summary (best-effort)
        let summary = "";
        try {
            summary = await summarizeConversationForHandoff(tenantId, conversationId);
        } catch {
            // Non-fatal
        }

        // 5. Build notification message
        const summaryLine = summary ? `\n\n${summary}` : "";
        const notificationMsg = [
            `🔔 העברה לנציג`,
            ``,
            `👤 ${contactName || "לקוח"}`,
            `📞 ${displayPhone}`,
            summaryLine.trim() || null,
            ``,
            `הלקוח מחכה לתשובה שלך בוואטסאפ.`,
        ]
            .filter((line) => line !== null)
            .join("\n");

        // 6. Send via Baileys socket (direct WhatsApp message to owner)
        const ownerJid = `${ownerPhoneNormalized}@s.whatsapp.net`;
        await socket.sendMessage(ownerJid, { text: notificationMsg });

        console.log(`[${tenantId}] Escalation notification sent to owner (${ownerPhoneNormalized}) via Baileys`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[${tenantId}] Escalation notification error:`, msg);
    }
}

// ── Save message to DB ─────────────────────────────────────────────

async function _saveMessage(
    tenantId: string,
    conversationId: string,
    role: "user" | "assistant" | "owner",
    content: string,
    waMessageId: string | null = null,
    isFromAgent = false
): Promise<void> {
    const { error } = await getSupabase()
        .from("messages")
        .insert({
            tenant_id: tenantId,
            conversation_id: conversationId,
            role,
            content,
            wa_message_id: waMessageId,
            is_from_agent: isFromAgent,
        });

    if (error) {
        console.error(`Message save error:`, error.message);
    }
}
