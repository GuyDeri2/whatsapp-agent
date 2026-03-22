/**
 * WhatsApp Cloud API Webhook Endpoint.
 *
 * GET  — Webhook verification (Meta sends this when you register the webhook URL)
 * POST — Incoming messages and status updates from WhatsApp
 *
 * Uses Next.js `after()` to return 200 instantly and process in the background.
 * Multi-tenant routing: phone_number_id in the webhook payload maps to a tenant
 * via the whatsapp_cloud_config table.
 */

import { NextResponse, after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateReply, summarizeConversationForHandoff } from "@/lib/ai-agent";
import {
    verifyWebhookSignature,
    getCloudConfigByPhoneId,
    sendTextMessage,
    markMessageRead,
    type WebhookPayload,
    type IncomingWhatsAppMessage,
    type CloudConfig,
} from "@/lib/whatsapp-cloud";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // Vercel function timeout

// ── Webhook Verification (GET) ──────────────────────────────────────

export async function GET(req: Request) {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token || !challenge) {
        return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
    }

    // Check global webhook verify token first (fastest path)
    const globalToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (globalToken && token === globalToken) {
        // Global token matches — proceed
    } else {
        // Check if the verify_token matches any tenant's config
        const supabase = getSupabaseAdmin();
        const { data } = await supabase
            .from("whatsapp_cloud_config")
            .select("tenant_id")
            .eq("webhook_verify_token", token)
            .limit(1);

        if (!data || data.length === 0) {
            console.error("[Webhook] Verification failed: unknown verify_token");
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }

    // Return the challenge to complete verification
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

// ── Incoming Messages (POST) ────────────────────────────────────────

export async function POST(req: Request) {
    try {
        // 1. Verify webhook signature
        const rawBody = await req.text();
        const signature = req.headers.get("x-hub-signature-256") || "";

        if (!verifyWebhookSignature(rawBody, signature)) {
            console.error("[Webhook] Invalid signature — rejecting");
            return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        }

        // 2. Parse the payload
        let payload: WebhookPayload;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (payload.object !== "whatsapp_business_account") {
            return NextResponse.json({ error: "Unsupported object type" }, { status: 400 });
        }

        // 3. Return 200 immediately — process in background via after()
        // Meta requires 200 within ~5 seconds, DeepSeek can take 10s+
        after(async () => {
            for (const entry of payload.entry) {
                for (const change of entry.changes) {
                    if (change.field !== "messages") continue;

                    const { value } = change;
                    const phoneNumberId = value.metadata.phone_number_id;

                    // Handle incoming messages (parallel per message)
                    if (value.messages && value.messages.length > 0) {
                        const contacts = value.contacts || [];
                        await Promise.allSettled(
                            value.messages.map(message => {
                                const senderName = contacts.find(c => c.wa_id === message.from)?.profile?.name || null;
                                return processIncomingMessage(phoneNumberId, message, senderName);
                            })
                        );
                    }

                    // Handle status updates (parallel)
                    if (value.statuses && value.statuses.length > 0) {
                        await Promise.allSettled(
                            value.statuses.map(status => processStatusUpdate(phoneNumberId, status))
                        );
                    }
                }
            }
        });

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (err) {
        console.error("[Webhook] Unhandled error:", err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

// ── Message Processing ──────────────────────────────────────────────

// Deduplication: track recently processed message IDs
const processedMessages = new Map<string, number>();
setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
    for (const [id, ts] of processedMessages) {
        if (ts < cutoff) processedMessages.delete(id);
    }
}, 60_000);

// Rate limiting per conversation
const replyTimestamps = new Map<string, number[]>();
const MAX_REPLIES_PER_MINUTE = 5;

// Cleanup stale replyTimestamps entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of replyTimestamps) {
        const recent = timestamps.filter(t => now - t < 60_000);
        if (recent.length === 0) {
            replyTimestamps.delete(key);
        } else {
            replyTimestamps.set(key, recent);
        }
    }
}, 5 * 60_000);

function isRateLimited(conversationId: string): boolean {
    const now = Date.now();
    const timestamps = replyTimestamps.get(conversationId) ?? [];
    const recent = timestamps.filter(t => now - t < 60_000);
    replyTimestamps.set(conversationId, recent);
    if (recent.length >= MAX_REPLIES_PER_MINUTE) return true;
    recent.push(now);
    return false;
}

async function processIncomingMessage(
    phoneNumberId: string,
    message: IncomingWhatsAppMessage,
    senderName: string | null
): Promise<void> {
    // Deduplication
    if (processedMessages.has(message.id)) return;
    processedMessages.set(message.id, Date.now());

    // Get tenant config
    const config = await getCloudConfigByPhoneId(phoneNumberId);
    if (!config) {
        console.error(`[Webhook] No tenant config for phone_number_id: ${phoneNumberId}`);
        return;
    }

    const tenantId = config.tenant_id;
    const phoneNumber = message.from; // Already in international format without +

    // Extract message content
    let messageText = "";
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;

    switch (message.type) {
        case "text":
            messageText = message.text?.body || "";
            break;
        case "image":
            mediaType = "image";
            messageText = message.image?.caption || "[תמונה]";
            break;
        case "audio":
            mediaType = "audio";
            messageText = "[הודעה קולית]";
            break;
        case "video":
            mediaType = "video";
            messageText = message.video?.caption || "[וידאו]";
            break;
        case "document":
            mediaType = "document";
            messageText = message.document?.caption || `[מסמך: ${message.document?.filename || ""}]`;
            break;
        default:
            // Unsupported message type — store raw type
            messageText = `[${message.type}]`;
            break;
    }

    if (!messageText && !mediaType) return;

    const supabase = getSupabaseAdmin();

    // Mark as read + upsert conversation + fetch tenant in parallel
    const [, convResult, tenantResult] = await Promise.all([
        markMessageRead(config, message.id).catch(() => {}),
        supabase
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
            .select("id, is_paused, contact_name")
            .single(),
        supabase
            .from("tenants")
            .select("agent_mode, agent_filter_mode")
            .eq("id", tenantId)
            .single(),
    ]);

    if (convResult.error || !convResult.data) {
        console.error(`[${tenantId}] Conversation upsert failed:`, convResult.error);
        return;
    }
    const conversation = convResult.data;

    // Update contact name (fire-and-forget)
    if (senderName && !conversation.contact_name) {
        supabase.from("conversations").update({ contact_name: senderName }).eq("id", conversation.id).then(() => {});
    }

    // Store the incoming message (don't await — start AI generation in parallel)
    const msgInsertPromise = supabase.from("messages").insert({
        conversation_id: conversation.id,
        tenant_id: tenantId,
        role: "user",
        content: messageText,
        sender_name: senderName,
        is_from_agent: false,
        media_url: mediaUrl,
        media_type: mediaType,
        wa_message_id: message.id,
        status: "delivered",
    });

    // Check if we should generate AI reply
    const tenant = tenantResult.data;
    if (!tenant || tenant.agent_mode !== "active" || conversation.is_paused || isRateLimited(conversation.id)) {
        await msgInsertPromise; // Still need to store the message
        return;
    }

    // Check contact filter (skip DB call for "all" mode)
    if (tenant.agent_filter_mode !== "all") {
        const allowed = await checkContactFilter(supabase, tenantId, phoneNumber, tenant.agent_filter_mode);
        if (!allowed) {
            await msgInsertPromise;
            return;
        }
    }

    // Start AI generation in parallel with message storage
    const [msgResult] = await Promise.all([
        msgInsertPromise,
        generateAndSendAiReply(config, supabase, tenantId, conversation.id, phoneNumber, messageText),
    ]);

    if (msgResult.error) {
        console.error(`[${tenantId}] Message insert failed:`, msgResult.error);
    }
}

// ── AI Reply Generation ─────────────────────────────────────────────

async function generateAndSendAiReply(
    config: CloudConfig,
    supabase: ReturnType<typeof getSupabaseAdmin>,
    tenantId: string,
    conversationId: string,
    phoneNumber: string,
    latestMessage: string
): Promise<void> {
    try {
        // Fetch conversation history
        const { data: messages } = await supabase
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversationId)
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false })
            .limit(20);

        // Build history with created_at for gap detection
        let history = (messages ?? []).reverse().map(m => ({
            role: m.role as "user" | "assistant" | "owner",
            content: m.content,
            created_at: m.created_at,
        }));

        // If the latest message isn't in history yet (parallel insert), append it
        const lastMsg = history[history.length - 1];
        if (!lastMsg || lastMsg.content !== latestMessage || lastMsg.role !== "user") {
            history.push({ role: "user", content: latestMessage, created_at: new Date().toISOString() });
        }

        // Generate AI reply
        const reply = await generateReply(tenantId, history);
        if (!reply) return;

        // Handle [PAUSE] — handoff to human
        const isPause = reply.includes("[PAUSE]");
        const cleanReply = reply.replace(/\[PAUSE\]/g, "").trim();

        if (cleanReply) {
            // Send via Cloud API
            const result = await sendTextMessage(config, phoneNumber, cleanReply);

            // Store the AI reply in DB regardless of send success
            const { error: replyInsertError } = await supabase.from("messages").insert({
                conversation_id: conversationId,
                tenant_id: tenantId,
                role: "assistant",
                content: cleanReply,
                is_from_agent: true,
                wa_message_id: result.messageId ?? null,
                status: result.success ? "sent" : "failed",
            });

            if (replyInsertError) {
                console.error(`[${tenantId}] AI reply insert failed:`, replyInsertError);
            }

            if (result.success) {
                console.log(`[${tenantId}] AI replied to ${phoneNumber}`);
            } else {
                console.error(`[${tenantId}] Failed to send AI reply:`, result.error);
            }
        }

        // Pause conversation if [PAUSE] detected (handoff to human)
        if (isPause) {
            await supabase
                .from("conversations")
                .update({ is_paused: true })
                .eq("id", conversationId);
            console.log(`[${tenantId}] Conversation paused — handed off to human`);

            // Notify the business owner immediately via WhatsApp
            await notifyOwnerOfEscalation(config, supabase, tenantId, conversationId, phoneNumber);
        }
    } catch (err) {
        console.error(`[${tenantId}] AI reply generation failed:`, err);
    }
}

// ── Contact Filter Check ────────────────────────────────────────────

async function checkContactFilter(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    tenantId: string,
    phoneNumber: string,
    filterMode: string
): Promise<boolean> {
    if (filterMode === "all") return true;

    const { data: rules } = await supabase
        .from("contact_rules")
        .select("phone_number, rule_type")
        .eq("tenant_id", tenantId);

    if (!rules || rules.length === 0) {
        return filterMode === "blacklist"; // No rules = allow for blacklist, block for whitelist
    }

    const phoneDigits = phoneNumber.replace(/\D/g, "");
    const matchingRule = rules.find(r => {
        const ruleDigits = r.phone_number.replace(/\D/g, "");
        return phoneDigits === ruleDigits || phoneDigits.endsWith(ruleDigits.slice(-9));
    });

    if (filterMode === "whitelist") {
        return matchingRule?.rule_type === "allow";
    }
    // blacklist
    return !matchingRule || matchingRule.rule_type !== "block";
}

// ── Owner Escalation Notification ────────────────────────────────────

/**
 * Normalize a phone number to international format (digits only, 972 prefix).
 * Handles: "0501234567" → "972501234567", "+972501234567" → "972501234567",
 * "972501234567" → "972501234567", and other formats.
 */
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

    // Some other international format — return as-is if it looks valid (8+ digits)
    if (digits.length >= 8) {
        return digits;
    }

    return null;
}

/**
 * Send an immediate WhatsApp notification to the business owner when
 * the AI bot escalates a conversation to a human ([PAUSE]).
 *
 * Includes: customer name/phone, wait time, and AI-generated summary.
 * Fails silently — escalation notification is best-effort, must not
 * break the main message flow.
 */
async function notifyOwnerOfEscalation(
    config: CloudConfig,
    supabase: ReturnType<typeof getSupabaseAdmin>,
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

        // Don't send escalation to the customer themselves (owner is the one chatting)
        if (ownerPhoneNormalized === customerPhone) {
            console.log(`[${tenantId}] Escalation: owner is the customer — skipping notification`);
            return;
        }

        // 2. Get conversation details (contact name)
        const { data: conv } = await supabase
            .from("conversations")
            .select("contact_name")
            .eq("id", conversationId)
            .eq("tenant_id", tenantId)
            .single();

        const contactName = conv?.contact_name || null;

        // 3. Format the customer phone for display (0xx local format for Israeli numbers)
        const displayPhone = customerPhone.startsWith("972") && customerPhone.length >= 11
            ? "0" + customerPhone.substring(3)
            : customerPhone;

        // 4. Generate AI summary (best-effort, non-blocking timeout)
        let summary = "";
        try {
            summary = await summarizeConversationForHandoff(tenantId, conversationId);
        } catch {
            // Non-fatal — send notification without summary
        }

        // 5. Build the notification message
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

        // 6. Send via Cloud API
        const result = await sendTextMessage(config, ownerPhoneNormalized, notificationMsg);

        if (result.success) {
            console.log(`[${tenantId}] Escalation notification sent to owner (${ownerPhoneNormalized})`);
        } else {
            console.error(`[${tenantId}] Escalation notification failed:`, result.error);
        }
    } catch (err) {
        // Fail silently — this is a best-effort notification
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[${tenantId}] Escalation notification error:`, msg);
    }
}

// ── Status Update Processing ────────────────────────────────────────

async function processStatusUpdate(
    phoneNumberId: string,
    status: { id: string; status: string; timestamp: string; recipient_id: string; errors?: Array<{ code: number; title: string }> }
): Promise<void> {
    const config = await getCloudConfigByPhoneId(phoneNumberId);
    if (!config) return;

    const supabase = getSupabaseAdmin();

    // Update message status in DB
    const validStatuses = ["sent", "delivered", "read", "failed"];
    if (!validStatuses.includes(status.status)) return;

    const { error } = await supabase
        .from("messages")
        .update({ status: status.status })
        .eq("wa_message_id", status.id)
        .eq("tenant_id", config.tenant_id);

    if (error) {
        // Not critical — message might not exist yet (race condition)
    }

    if (status.status === "failed" && status.errors) {
        console.error(`[${config.tenant_id}] Message delivery failed:`, status.errors);
    }
}
