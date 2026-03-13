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

// ─── LID resolver (injected by session-manager to avoid circular dep) ─
let _lidResolver: ((tenantId: string, jid: string) => string) | null = null;
export function setLidResolver(fn: (tenantId: string, jid: string) => string): void {
    _lidResolver = fn;
}

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
const MAX_REPLIES_PER_MINUTE = 5;   // Conservative — human agents don't reply 15x/min
const MAX_REPLIES_PER_DAY = 50;     // Safety cap per conversation per day

// Daily counters: { date: "YYYY-MM-DD", count: number }
const dailyReplyCounts = new Map<string, { date: string; count: number }>();

// ─── Debouncing & Concurrency Locks ───────────────────────────────────
const debounceTimers: Record<string, NodeJS.Timeout> = {};
const activeGenerations = new Set<string>();

// Track wa_message_ids sent by the AI agent to prevent Baileys echo from being
// re-stored as an "owner" message (race condition between send and DB insert)
const agentSentIds = new Set<string>();
function markAgentSent(id: string | null | undefined): void {
    if (!id) return;
    agentSentIds.add(id);
    setTimeout(() => agentSentIds.delete(id), 120_000); // auto-cleanup after 2 min
}

// Randomised debounce: 1.5s–4.5s to avoid mechanical fixed-interval fingerprinting
const getDebounceDelay = () => 1_500 + Math.floor(Math.random() * 3_000);

/** Called by server.ts when tenant settings are updated — forces fresh config fetch */
export function invalidateTenantConfigCache(tenantId: string): void {
    tenantConfigCache.delete(tenantId);
    console.log(`[${tenantId}] 🔄 Tenant config cache invalidated`);
}

export function clearPendingAiReply(tenantId: string, conversationId: string): void {
    const key = `${tenantId}_${conversationId}`;
    if (debounceTimers[key]) {
        clearTimeout(debounceTimers[key]);
        delete debounceTimers[key];
        console.log(`[${tenantId}] 🛑 Owner replied — cancelled pending AI debounce reply (via sendMessage).`);
    }
}

function isRateLimited(conversationId: string): boolean {
    const now = Date.now();
    const timestamps = replyTimestamps.get(conversationId) ?? [];
    const recent = timestamps.filter((t) => now - t < 60_000);
    replyTimestamps.set(conversationId, recent);
    if (recent.length >= MAX_REPLIES_PER_MINUTE) return true;
    recent.push(now);
    return false;
}

function isDailyLimitReached(conversationId: string): boolean {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const entry = dailyReplyCounts.get(conversationId);
    if (!entry || entry.date !== today) {
        dailyReplyCounts.set(conversationId, { date: today, count: 1 });
        return false;
    }
    if (entry.count >= MAX_REPLIES_PER_DAY) return true;
    entry.count++;
    return false;
}

/** Convert international Israeli format (972XXXXXXXXX) to local (0XXXXXXXXX) */
function toLocalPhone(phone: string): string {
    if (phone.startsWith("972") && phone.length >= 11 && phone.length <= 12) {
        return "0" + phone.substring(3);
    }
    return phone;
}

// ─── Types ────────────────────────────────────────────────────────────
interface TenantConfig {
    agent_mode: "learning" | "active" | "paused";
    agent_filter_mode: "all" | "whitelist" | "blacklist";
    whatsapp_phone: string | null;
    owner_phone: string | null;
    agent_respond_to_saved_contacts: boolean;
}

// ─── Tenant config cache (30s TTL) to avoid DB hit on every message ───
const tenantConfigCache = new Map<string, { config: TenantConfig; fetchedAt: number }>();
const CONFIG_CACHE_TTL_MS = 30_000; // 30 seconds

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

    // 1. Get tenant config (with cache to avoid DB hit on every message)
    const cached = tenantConfigCache.get(tenantId);
    let config: TenantConfig;
    if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
        config = cached.config;
    } else {
        const { data: tenant, error: tenantError } = await supabase
            .from("tenants")
            .select("agent_mode, agent_filter_mode, whatsapp_phone, owner_phone, agent_respond_to_saved_contacts")
            .eq("id", tenantId)
            .single();

        if (tenantError || !tenant) {
            console.error(`[${tenantId}] Tenant not found:`, tenantError);
            return;
        }
        config = tenant as TenantConfig;
        tenantConfigCache.set(tenantId, { config, fetchedAt: Date.now() });
    }

    // Extract clean phone number from JID (e.g., "972501234567@s.whatsapp.net" → "972501234567")
    const phoneNumber = remoteJid.split("@")[0];
    const isGroupChat = remoteJid.endsWith("@g.us");

    // ── Ignore Baileys echo of messages sent by the AI agent ──────────────
    // When we send a message via socket.sendMessage, Baileys fires messages.upsert
    // with fromMe=true almost immediately — before our DB insert completes.
    // Without this check the message gets stored again as role "owner".
    if (waMessageId && agentSentIds.has(waMessageId)) {
        console.log(`[${tenantId}] ⏭️ Skipping agent-sent echo: ${waMessageId}`);
        return;
    }

    // ── Silently ignore Meta/WhatsApp system and probe JIDs ──────────────
    const isSystemJid =
        // Broadcast / newsletter / channel — never reply
        remoteJid.endsWith("@broadcast") ||
        remoteJid.endsWith("@newsletter") ||
        // Known WhatsApp internal numbers
        remoteJid === "0@s.whatsapp.net" ||
        remoteJid === "status@broadcast" ||
        // WhatsApp helpdesk / support numbers
        remoteJid === "16315555555@s.whatsapp.net" ||
        remoteJid === "18005550001@s.whatsapp.net" ||
        // Meta automated probe ranges
        /^1203631\d{4}@s\.whatsapp\.net$/.test(remoteJid) ||  // 1203631XXXX
        /^1650\d{7}@s\.whatsapp\.net$/.test(remoteJid) ||      // 1650XXXXXXX (Meta HQ range)
        // Numeric-only JIDs with ≤ 3 digits — always system accounts
        /^\d{1,3}@s\.whatsapp\.net$/.test(remoteJid);

    if (isSystemJid) {
        console.log(`[${tenantId}] 🛡️ Ignored system/probe JID: ${remoteJid}`);
        return;
    }

    // 2. Upsert conversation (without contact_name to avoid overwriting existing names)
    // We fetch updated_at as well so we can check for the 40-minute timeout
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
        .select("id, contact_name, is_paused, is_saved_contact, updated_at")
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

    // Auto-unpause if it's been > 40 minutes since the last message
    if (conversation.is_paused) {
        const FORTY_MINUTES_MS = 40 * 60 * 1000;
        const lastUpdated = new Date(conversation.updated_at || Date.now()).getTime();
        const now = Date.now();

        if (now - lastUpdated > FORTY_MINUTES_MS) {
            console.log(`[${tenantId}] ⏱️ $> 40 mins passed. Auto-unpausing conversation ${conversationId}`);
            conversation.is_paused = false;
            await supabase
                .from("conversations")
                .update({ is_paused: false })
                .eq("id", conversationId);
        }
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

            // Rate limits
            if (isRateLimited(conversationId)) {
                console.log(`[${tenantId}] ⏱️ Per-minute rate limit — skipping AI reply for ${phoneNumber}`);
                return;
            }
            if (isDailyLimitReached(conversationId)) {
                console.log(`[${tenantId}] 📅 Daily limit reached — skipping AI reply for ${phoneNumber}`);
                return;
            }

            // Debounce with randomised delay (1.5s–4.5s) to avoid mechanical patterns
            if (debounceTimers[debounceKey]) {
                clearTimeout(debounceTimers[debounceKey]);
                console.log(`[${tenantId}] ⏳ Debouncing rapid message from ${phoneNumber}...`);
            }

            debounceTimers[debounceKey] = setTimeout(async () => {
                delete debounceTimers[debounceKey];

                // Re-check is_paused from DB — handoff may have been triggered
                // between when this message arrived and when the debounce fired.
                const { data: freshConv } = await getSupabase()
                    .from("conversations")
                    .select("is_paused")
                    .eq("id", conversationId)
                    .single();
                if (freshConv?.is_paused) {
                    console.log(`[${tenantId}] ⏸️ Conversation paused (re-check) — skipping AI reply: ${phoneNumber}`);
                    return;
                }

                // If AI is already actively typing/generating for this chat, don't start a second parallel generation.
                // The current generation will pick up the context anyway.
                if (activeGenerations.has(debounceKey)) {
                    console.log(`[${tenantId}] 🔒 AI is already generating a reply for ${phoneNumber}, dropping duplicate trigger.`);
                    return;
                }

                activeGenerations.add(debounceKey);
                try {
                    await handleActiveMode(
                        tenantId,
                        conversationId,
                        remoteJid,
                        messageText, // this messageText is just the latest trigger, history will contain all
                        sendMessage,
                        config.owner_phone
                    );
                } finally {
                    activeGenerations.delete(debounceKey);
                }
            }, getDebounceDelay());

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

    // Normalize: check all possible formats of the same number
    // WhatsApp gives "972...", user might have stored "05..." or "+972..." before normalization fix
    const formats = new Set<string>([phoneNumber]);
    if (phoneNumber.startsWith("972")) {
        formats.add("0" + phoneNumber.substring(3)); // 972526991415 → 0526991415
    } else if (phoneNumber.startsWith("0") && phoneNumber.length === 10) {
        formats.add("972" + phoneNumber.substring(1)); // 0526991415 → 972526991415
    }

    const { data: rules, error } = await supabase
        .from("contact_rules")
        .select("rule_type")
        .eq("tenant_id", tenantId)
        .in("phone_number", Array.from(formats))
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
    sendMessage: SendMessageFn,
    ownerPhone: string | null
): Promise<void> {
    try {
        console.log(`[${tenantId}] 🤖 Active mode — generating AI reply...`);

        let aiReply = await generateReply(tenantId, conversationId, messageText);
        let shouldPause = false;

        // Auto-pause if AI decides to handoff using the secret [PAUSE] marker
        if (aiReply.includes("[PAUSE]")) {
            console.log(`[${tenantId}] 🛑 Handoff marker [PAUSE] detected! Auto-pausing conversation ${conversationId}`);
            shouldPause = true;
            // Strip the marker so the user doesn't see it
            aiReply = aiReply.replace(/\[PAUSE\]/g, "").trim();
        }

        if (shouldPause) {
            await getSupabase()
                .from("conversations")
                .update({ is_paused: true })
                .eq("id", conversationId);
        }

        // If AI reply is empty after stripping [PAUSE], use a fallback handoff message
        if (aiReply.length === 0 && shouldPause) {
            const HANDOFF_FALLBACKS = [
                "תודה על פנייתך. שיחה זו מועברת לנציג אנושי שיחזור אליך בהקדם. 🙏",
                "תודה שפנית אלינו! נציג מטעמנו יצור איתך קשר בהקדם האפשרי. 🙏",
                "קיבלנו את פנייתך ✅ אחד מהנציגים שלנו יחזור אליך בהקדם.",
            ];
            aiReply = HANDOFF_FALLBACKS[Math.floor(Math.random() * HANDOFF_FALLBACKS.length)];
        }

        // Re-resolve LID JID at send time — the map may have been built after message arrived
        let sendJid = remoteJid;
        if (sendJid.endsWith("@lid") && _lidResolver) {
            const resolved = _lidResolver(tenantId, sendJid);
            if (!resolved.endsWith("@lid")) {
                console.log(`[${tenantId}] 🔗 Late LID resolution before send: ${sendJid} → ${resolved}`);
                sendJid = resolved;
            } else {
                console.warn(`[${tenantId}] ⚠️ Cannot resolve LID ${sendJid} — AI reply will NOT be delivered on WhatsApp`);
            }
        }

        // Send the single message to the customer and register its ID to suppress Baileys echo
        let aiWaMessageId: string | null = null;
        if (aiReply.length > 0) {
            const sentMsg = await sendMessage(sendJid, { text: aiReply });
            aiWaMessageId = sentMsg?.key?.id || null;
            markAgentSent(aiWaMessageId); // prevent echo re-storage as "owner"

            // Store in DB immediately after send
            await getSupabase().from("messages").insert({
                conversation_id: conversationId,
                tenant_id: tenantId,
                role: "assistant",
                content: aiReply,
                is_from_agent: true,
                wa_message_id: aiWaMessageId,
                status: "sent",
            });
        }

        // Notify the business owner on their personal WhatsApp number
        if (shouldPause) {
            if (ownerPhone) {
                const customerPhone = toLocalPhone(remoteJid.split("@")[0]);
                const { data: conv } = await getSupabase()
                    .from("conversations")
                    .select("contact_name")
                    .eq("id", conversationId)
                    .single();
                const contactDisplay = conv?.contact_name
                    ? `${conv.contact_name} (${customerPhone})`
                    : customerPhone;
                const ownerNotification = `🔔 לקוח ממתין למענה אנושי!\n\nשם: ${contactDisplay}\nטלפון: ${customerPhone}\n\nהלקוח פנה לוואטסאפ העסקי שלך וסוכן ה-AI הפנה אותו לטיפול ידני.`;

                // Normalize to international format (972XXXXXXXXX)
                let ownerDigits = ownerPhone.replace(/\D/g, "");
                if (ownerDigits.startsWith("0") && ownerDigits.length === 10) {
                    ownerDigits = "972" + ownerDigits.substring(1);
                }
                const ownerJid = `${ownerDigits}@s.whatsapp.net`;

                try {
                    const ownerSent = await sendMessage(ownerJid, { text: ownerNotification });
                    markAgentSent(ownerSent?.key?.id);
                    console.log(`[${tenantId}] 📱 Owner notified at ${ownerJid} — customer: ${customerPhone}`);
                } catch (notifyErr: any) {
                    console.error(`[${tenantId}] ❌ Failed to notify owner at ${ownerJid}:`, notifyErr.message);
                }
            } else {
                console.warn(`[${tenantId}] ⚠️ No owner_phone configured — skipping owner notification`);
            }
        }

        console.log(
            `[${tenantId}] ✅ AI reply sent: ${aiReply.substring(0, 80)}...`
        );
    } catch (error) {
        console.error(`[${tenantId}] ❌ Error in active mode:`, error);
    }
}

