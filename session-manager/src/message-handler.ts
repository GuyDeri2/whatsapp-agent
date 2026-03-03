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

// ─── Rate limiting ────────────────────────────────────────────────────
const replyTimestamps = new Map<string, number[]>();
const MAX_REPLIES_PER_MINUTE = 15;

// ─── Debouncing ───────────────────────────────────────────────────────
const debounceTimers: Record<string, NodeJS.Timeout> = {};
const DEBOUNCE_DELAY_MS = 3500; // 3.5 seconds

function isRateLimited(conversationId: string): boolean {
    const now = Date.now();
    const timestamps = replyTimestamps.get(conversationId) ?? [];
    // Keep only timestamps from the last 60 seconds
    const recent = timestamps.filter((t) => now - t < 60000);
    replyTimestamps.set(conversationId, recent);
    if (recent.length >= MAX_REPLIES_PER_MINUTE) return true;
    recent.push(now);
    return false;
}

// ─── Types ────────────────────────────────────────────────────────────
interface TenantConfig {
    agent_mode: "learning" | "active" | "paused";
    agent_filter_mode: "all" | "whitelist" | "blacklist";
    whatsapp_phone: string | null;
    agent_respond_to_saved_contacts: boolean;
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
    waMessageId: string | null,
    sendMessage: SendMessageFn,
    isMentioned: boolean = false
): Promise<void> {
    const supabase = getSupabase();

    // 1. Get tenant config
    const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .select("agent_mode, agent_filter_mode, whatsapp_phone, agent_respond_to_saved_contacts")
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
        .select("id, contact_name, is_paused, is_saved_contact")
        .single();

    if (convError || !conversation) {
        console.error(`[${tenantId}] Conversation upsert error:`, convError);
        return;
    }

    // Only set contact_name from pushName if no name exists yet.
    // Phonebook names (set by contacts.upsert) take priority — we never
    // overwrite them with a pushName (the user's self-chosen WA name).
    if (pushName && !conversation.contact_name) {
        await supabase
            .from("conversations")
            .update({ contact_name: pushName })
            .eq("id", conversation.id);
    }

    const conversationId = conversation.id;

    // 3. Determine role
    const role = isFromMe ? "owner" : "user";

    // 4. Dedup check — skip if a message with this wa_message_id already exists
    if (waMessageId) {
        const { data: existing } = await supabase
            .from("messages")
            .select("id")
            .eq("conversation_id", conversationId)
            .eq("wa_message_id", waMessageId)
            .maybeSingle();
        if (existing) {
            console.log(`[${tenantId}] ⏭️ Skipping duplicate message (wa_message_id: ${waMessageId})`);
            return;
        }
    }

    // 5. Store the message
    const { error: msgError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        tenant_id: tenantId,
        role,
        content: messageText,
        sender_name: senderName,
        is_from_agent: false,
        media_url: mediaUrl,
        media_type: mediaType,
        wa_message_id: waMessageId,
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

    const debounceKey = `${tenantId}_${conversationId}`;

    // 6. Route based on agent mode (only for incoming user messages)
    if (isFromMe) {
        // Owner is replying — clear any pending AI logic for this conversation
        if (debounceTimers[debounceKey]) {
            clearTimeout(debounceTimers[debounceKey]);
            delete debounceTimers[debounceKey];
            console.log(`[${tenantId}] 🛑 Owner replied — cancelled pending AI debounce reply.`);
        }
        return;
    }

    if (conversation.is_paused) {
        if (debounceTimers[debounceKey]) {
            clearTimeout(debounceTimers[debounceKey]);
            delete debounceTimers[debounceKey];
        }
        console.log(`[${tenantId}] ⏸️ Conversation is paused (handoff) — skipping AI reply: ${phoneNumber}`);
        return;
    }

    if (conversation.is_saved_contact && config.agent_respond_to_saved_contacts === false) {
        if (debounceTimers[debounceKey]) {
            clearTimeout(debounceTimers[debounceKey]);
            delete debounceTimers[debounceKey];
        }
        console.log(`[${tenantId}] 📇 Saved contact filter active — skipping AI reply: ${phoneNumber}`);
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
            // Group chat protection: only reply if explicitly mentioned
            const isGroupChat = remoteJid.endsWith("@g.us");
            if (isGroupChat && !isMentioned) {
                console.log(`[${tenantId}] 🔇 Ignored group message (bot not explicitly mentioned): ${phoneNumber}`);
                return;
            }

            // Rate limit: max 15 AI replies per minute per conversation
            if (isRateLimited(conversationId)) {
                console.log(`[${tenantId}] ⏱️ Rate limited — skipping AI reply for ${phoneNumber}`);
                return;
            }

            // --- DEBOUNCE LOGIC ---
            if (debounceTimers[debounceKey]) {
                clearTimeout(debounceTimers[debounceKey]);
                console.log(`[${tenantId}] ⏳ Debouncing rapid message from ${phoneNumber}...`);
            }

            debounceTimers[debounceKey] = setTimeout(async () => {
                delete debounceTimers[debounceKey];
                await handleActiveMode(
                    tenantId,
                    conversationId,
                    remoteJid,
                    messageText, // this messageText is just the latest trigger, history will contain all
                    sendMessage
                );
            }, DEBOUNCE_DELAY_MS);

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

        // Auto-pause if AI decides to handoff
        if (
            aiReply.includes("אעביר את השיחה לצוות שלנו") ||
            aiReply.includes("אעביר לטיפול אנושי") ||
            aiReply.includes("יחזרו אליך בהקדם")
        ) {
            console.log(`[${tenantId}] 🛑 Handoff detected! Auto-pausing conversation ${conversationId}`);
            await getSupabase()
                .from("conversations")
                .update({ is_paused: true })
                .eq("id", conversationId);
        }

        // Send via WhatsApp first to get the wa_message_id
        const sentMsg = await sendMessage(remoteJid, { text: aiReply });
        const aiWaMessageId = sentMsg?.key?.id || null;

        // Store AI reply with wa_message_id so the echo-back from Baileys is deduped
        await getSupabase().from("messages").insert({
            conversation_id: conversationId,
            tenant_id: tenantId,
            role: "assistant",
            content: aiReply,
            is_from_agent: true,
            wa_message_id: aiWaMessageId,
            status: "sent",
        });

        console.log(
            `[${tenantId}] ✅ AI reply sent: ${aiReply.substring(0, 80)}...`
        );
    } catch (error) {
        console.error(`[${tenantId}] ❌ Error in active mode:`, error);
    }
}

