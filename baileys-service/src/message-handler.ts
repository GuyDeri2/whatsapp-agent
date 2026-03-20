/**
 * Message Handler — processes incoming WhatsApp messages.
 *
 * Flow: incoming message → save to DB → check filters → generate AI reply → human-like send
 */

import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { getSupabase } from "./session-manager";
import { humanSend, RateLimiter } from "./antiban";
import { generateReply } from "./ai-agent";

export const rateLimiter = new RateLimiter();

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
    const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        null;

    // Handle media without text
    const hasMedia = !!(
        msg.message?.imageMessage ??
        msg.message?.videoMessage ??
        msg.message?.audioMessage ??
        msg.message?.documentMessage ??
        msg.message?.stickerMessage
    );

    const content = text ?? (hasMedia ? "[מדיה ללא טקסט]" : null);
    if (!content) {
        console.log(`[${tenantId}] Skipping message with no content from ${jid}`);
        return;
    }

    // Extract phone number from JID
    const phoneNumber = jid.replace("@s.whatsapp.net", "");
    console.log(`[${tenantId}] Processing message from ${phoneNumber}: "${content.substring(0, 50)}"`);

    const supabase = getSupabase();

    try {
        // ── Get or create conversation ──

        let conversationId: string;

        const { data: existingConv } = await supabase
            .from("conversations")
            .select("id, is_paused")
            .eq("tenant_id", tenantId)
            .eq("phone_number", phoneNumber)
            .eq("is_group", false)
            .maybeSingle();

        if (existingConv) {
            conversationId = existingConv.id;

            // Update timestamp
            await supabase
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
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

        // Skip if agent is paused
        if (tenant.agent_mode === "paused") return;

        // Check whitelist/blacklist
        if (tenant.agent_filter_mode !== "all") {
            const { data: rules } = await supabase
                .from("contact_rules")
                .select("phone_number, rule_type")
                .eq("tenant_id", tenantId);

            const normalize = (p: string) => p.replace(/^\+/, "");
            const intl = normalize(phoneNumber);
            const local = intl.startsWith("972") && intl.length >= 11
                ? "0" + intl.substring(3)
                : null;

            const matched = (rules ?? []).find(
                (r) =>
                    normalize(r.phone_number) === intl ||
                    (local !== null && normalize(r.phone_number) === local)
            );

            if (tenant.agent_filter_mode === "whitelist" && matched?.rule_type !== "allow") return;
            if (tenant.agent_filter_mode === "blacklist" && matched?.rule_type === "block") return;
        }

        // ── Rate limit check ──

        if (!rateLimiter.canSend(tenantId, conversationId)) {
            console.warn(`[${tenantId}] Rate limit hit for conversation ${conversationId}`);
            return;
        }

        // ── Generate AI reply ──

        // Fetch recent history
        const { data: history } = await supabase
            .from("messages")
            .select("role, content")
            .eq("conversation_id", conversationId)
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: true })
            .limit(20);

        const chatHistory = (history ?? []).map((m) => ({
            role: m.role as "user" | "assistant" | "owner",
            content: m.content,
        }));

        const reply = await generateReply(tenantId, chatHistory);
        if (!reply) return;

        // Check for [PAUSE] — handoff to owner
        const shouldPause = reply.includes("[PAUSE]");
        const cleanReply = reply.replace(/\[PAUSE\]/g, "").trim();

        if (cleanReply) {
            // Send with human-like behavior
            await humanSend(socket, jid, cleanReply);

            // Save assistant message
            await _saveMessage(tenantId, conversationId, "assistant", cleanReply, null, true);

            // Record rate limit
            rateLimiter.recordSend(tenantId, conversationId);
        }

        // Pause conversation if handoff
        if (shouldPause) {
            await supabase
                .from("conversations")
                .update({ is_paused: true, updated_at: new Date().toISOString() })
                .eq("id", conversationId)
                .eq("tenant_id", tenantId);
        }
    } catch (err) {
        console.error(`[${tenantId}] Error processing message from ${phoneNumber}:`, err);
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
