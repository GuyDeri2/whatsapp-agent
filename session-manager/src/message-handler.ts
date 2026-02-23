/**
 * Message handler for incoming WhatsApp messages.
 * Routes messages based on the tenant's agent mode:
 *   - learning: store messages and learn from owner replies
 *   - active:   auto-reply using AI
 *   - paused:   store messages silently
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { proto } from "@whiskeysockets/baileys";
import { generateReply } from "./ai-agent";

// ─── Supabase singleton ───────────────────────────────────────────────
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
    if (!_supabase)
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    return _supabase;
}

// ─── Types ────────────────────────────────────────────────────────────
interface TenantConfig {
    agent_mode: "learning" | "active" | "paused";
    agent_filter_mode: "all" | "whitelist" | "blacklist";
    whatsapp_phone: string | null;
}

type SendMessageFn = (
    jid: string,
    content: { text: string }
) => Promise<proto.WebMessageInfo | undefined>;

// ─── Main handler ─────────────────────────────────────────────────────
export async function handleIncomingMessage(
    tenantId: string,
    remoteJid: string,
    messageText: string,
    isFromMe: boolean,
    pushName: string | null,
    senderName: string | null,
    mediaUrl: string | null,
    mediaType: string | null,
    sendMessage: SendMessageFn
): Promise<void> {
    const supabase = getSupabase();

    // 1. Get tenant config
    const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .select("agent_mode, agent_filter_mode, whatsapp_phone")
        .eq("id", tenantId)
        .single();

    if (tenantError || !tenant) {
        console.error(`[${tenantId}] Tenant not found:`, tenantError);
        return;
    }

    const config = tenant as TenantConfig;

    // Extract clean phone number from JID (e.g., "972501234567@s.whatsapp.net" → "972501234567")
    const phoneNumber = remoteJid.split("@")[0];
    const isGroupChat = remoteJid.endsWith("@g.us");

    // 2. Upsert conversation (without contact_name to avoid overwriting existing names)
    const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .upsert(
            {
                tenant_id: tenantId,
                phone_number: phoneNumber,
                is_group: isGroupChat,
            },
            { onConflict: "tenant_id,phone_number", ignoreDuplicates: false }
        )
        .select("id, contact_name")
        .single();

    if (convError || !conversation) {
        console.error(`[${tenantId}] Conversation upsert error:`, convError);
        return;
    }

    // Update contact_name only if we have a new name and current is empty
    if (pushName && !conversation.contact_name) {
        await supabase
            .from("conversations")
            .update({ contact_name: pushName })
            .eq("id", conversation.id);
    }

    const conversationId = conversation.id;

    // 3. Determine role
    const role = isFromMe ? "owner" : "user";

    // 4. Store the message
    const { error: msgError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        role,
        content: messageText,
        sender_name: senderName,
        is_from_agent: false,
        media_url: mediaUrl,
        media_type: mediaType,
    });

    if (msgError) {
        console.error(`[${tenantId}] Message insert error:`, msgError);
    }

    // Touch conversation's updated_at so it sorts to the top
    await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

    console.log(
        `[${tenantId}] ${role === "owner" ? "📤" : "📥"} ${phoneNumber}: ${messageText.substring(0, 80)}...`
    );

    // 5. Route based on agent mode
    if (isFromMe) {
        // Owner is replying — use this as a learning opportunity
        await learnFromOwnerReply(tenantId, conversationId, messageText);
        return;
    }

    // 5b. Check contact filtering rules
    if (config.agent_mode === "active" && config.agent_filter_mode !== "all") {
        const shouldRespond = await checkContactFilter(
            tenantId,
            phoneNumber,
            config.agent_filter_mode
        );
        if (!shouldRespond) {
            console.log(
                `[${tenantId}] 🚫 Contact filtered out (${config.agent_filter_mode}): ${phoneNumber}`
            );
            return; // message is stored but agent won't respond
        }
    }

    switch (config.agent_mode) {
        case "active":
            await handleActiveMode(
                tenantId,
                conversationId,
                remoteJid,
                messageText,
                sendMessage
            );
            break;

        case "learning":
            // Just store — the owner handles replies, and we learn from them
            console.log(`[${tenantId}] 📚 Learning mode — stored message, waiting for owner reply`);
            break;

        case "paused":
            console.log(`[${tenantId}] ⏸️ Paused mode — message stored silently`);
            break;
    }
}

// ─── Contact filtering ────────────────────────────────────────────────
async function checkContactFilter(
    tenantId: string,
    phoneNumber: string,
    filterMode: "whitelist" | "blacklist"
): Promise<boolean> {
    const supabase = getSupabase();

    // WhatsApp gives "972...", but user might have typed "0..." in UI
    let localNumber = phoneNumber;
    if (phoneNumber.startsWith("972")) {
        localNumber = "0" + phoneNumber.substring(3);
    }

    // Use .in() to check both formats, and .limit(1) to avoid .single() crashing on duplicates
    const { data: rules, error } = await supabase
        .from("contact_rules")
        .select("rule_type")
        .eq("tenant_id", tenantId)
        .in("phone_number", [phoneNumber, localNumber])
        .limit(1);

    if (error) {
        console.error(`[${tenantId}] Error checking contact filter:`, error);
    }

    const rule = rules && rules.length > 0 ? rules[0] : null;

    if (filterMode === "whitelist") {
        // Only respond if the contact is explicitly allowed
        return rule?.rule_type === "allow";
    } else {
        // Respond to everyone UNLESS explicitly blocked
        return rule?.rule_type !== "block";
    }
}

// ─── Active mode: AI auto-reply ───────────────────────────────────────
async function handleActiveMode(
    tenantId: string,
    conversationId: string,
    remoteJid: string,
    messageText: string,
    sendMessage: SendMessageFn
): Promise<void> {
    try {
        console.log(`[${tenantId}] 🤖 Active mode — generating AI reply...`);

        const aiReply = await generateReply(tenantId, conversationId, messageText);

        // Store AI reply
        await getSupabase().from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: aiReply,
            is_from_agent: true,
        });

        // Send via WhatsApp
        await sendMessage(remoteJid, { text: aiReply });

        console.log(
            `[${tenantId}] ✅ AI reply sent: ${aiReply.substring(0, 80)}...`
        );
    } catch (error) {
        console.error(`[${tenantId}] ❌ Error in active mode:`, error);
    }
}

// ─── Learn from owner reply ───────────────────────────────────────────
async function learnFromOwnerReply(
    tenantId: string,
    conversationId: string,
    ownerReply: string
): Promise<void> {
    const supabase = getSupabase();

    // Find the most recent customer message in this conversation
    const { data: lastCustomerMsg } = await supabase
        .from("messages")
        .select("content")
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    if (!lastCustomerMsg) return;

    // Store as a learning pair
    const { error } = await supabase.from("agent_learnings").insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        customer_message: lastCustomerMsg.content,
        owner_reply: ownerReply,
        approved: false, // owner needs to approve before AI uses it
    });

    if (error) {
        console.error(`[${tenantId}] Learning insert error:`, error);
    } else {
        console.log(`[${tenantId}] 📝 Learned from owner reply`);
    }
}
