/**
 * WhatsApp Cloud API Webhook Endpoint.
 *
 * GET  — Webhook verification (Meta sends this when you register the webhook URL)
 * POST — Incoming messages and status updates from WhatsApp
 *
 * This is a Next.js serverless API route — no VPS needed.
 * Multi-tenant routing: phone_number_id in the webhook payload maps to a tenant
 * via the whatsapp_cloud_config table.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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

    // Check if the verify_token matches any tenant's config
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
        .from("whatsapp_cloud_config")
        .select("tenant_id")
        .eq("webhook_verify_token", token)
        .limit(1)
        .single();

    if (!data) {
        // Also check global webhook verify token (for single-app multi-tenant setup)
        const globalToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        if (!globalToken || token !== globalToken) {
            console.error("[Webhook] Verification failed: unknown verify_token");
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }

    // Return the challenge to complete verification
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

// ── Incoming Messages (POST) ────────────────────────────────────────

export async function POST(req: Request) {
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

    // 3. Must return 200 quickly — Meta retries on timeout
    // Process messages in the background via waitUntil-style pattern
    const processingPromises: Promise<void>[] = [];

    for (const entry of payload.entry) {
        for (const change of entry.changes) {
            if (change.field !== "messages") continue;

            const { value } = change;
            const phoneNumberId = value.metadata.phone_number_id;

            // Handle incoming messages
            if (value.messages && value.messages.length > 0) {
                const contacts = value.contacts || [];
                for (const message of value.messages) {
                    const senderName = contacts.find(c => c.wa_id === message.from)?.profile?.name || null;
                    processingPromises.push(
                        processIncomingMessage(phoneNumberId, message, senderName)
                    );
                }
            }

            // Handle status updates (delivered, read, failed)
            if (value.statuses && value.statuses.length > 0) {
                for (const status of value.statuses) {
                    processingPromises.push(
                        processStatusUpdate(phoneNumberId, status)
                    );
                }
            }
        }
    }

    // Wait for processing (within serverless timeout)
    await Promise.allSettled(processingPromises);

    return NextResponse.json({ success: true }, { status: 200 });
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

    // Mark as read (send blue checkmarks)
    markMessageRead(config, message.id).catch(() => {});

    // 1. Upsert conversation
    const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .upsert(
            {
                tenant_id: tenantId,
                phone_number: phoneNumber,
                is_group: false, // Cloud API doesn't support groups
                updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id,phone_number" }
        )
        .select("id, is_paused, contact_name")
        .single();

    if (convError || !conversation) {
        console.error(`[${tenantId}] Conversation upsert failed:`, convError);
        return;
    }

    // Update contact name if we got one from the webhook and don't have one yet
    if (senderName && !conversation.contact_name) {
        await supabase
            .from("conversations")
            .update({ contact_name: senderName })
            .eq("id", conversation.id);
    }

    // 2. Store the incoming message
    const { error: msgError } = await supabase.from("messages").insert({
        conversation_id: conversation.id,
        role: "user",
        content: messageText,
        sender_name: senderName,
        is_from_agent: false,
        media_url: mediaUrl,
        media_type: mediaType,
        wa_message_id: message.id,
        status: "delivered",
    });

    if (msgError) {
        console.error(`[${tenantId}] Message insert failed:`, msgError);
        return;
    }

    // 3. Check tenant's agent mode and respond if active
    const { data: tenant } = await supabase
        .from("tenants")
        .select("agent_mode, agent_filter_mode, whatsapp_phone, owner_phone")
        .eq("id", tenantId)
        .single();

    if (!tenant) return;

    // Skip if paused or learning mode
    if (tenant.agent_mode !== "active") {
        if (tenant.agent_mode === "learning") {
            console.log(`[${tenantId}] Learning mode — stored message, no AI reply`);
        }
        return;
    }

    // Skip if conversation is paused (owner is handling)
    if (conversation.is_paused) {
        console.log(`[${tenantId}] Conversation paused — skipping AI reply`);
        return;
    }

    // Skip if rate limited
    if (isRateLimited(conversation.id)) {
        console.log(`[${tenantId}] Rate limited — skipping AI reply`);
        return;
    }

    // Check contact filter rules
    const allowed = await checkContactFilter(supabase, tenantId, phoneNumber, tenant.agent_filter_mode);
    if (!allowed) {
        console.log(`[${tenantId}] Contact filtered — skipping AI reply for ${phoneNumber}`);
        return;
    }

    // 4. Generate AI reply
    await generateAndSendAiReply(config, supabase, tenantId, conversation.id, phoneNumber);
}

// ── AI Reply Generation ─────────────────────────────────────────────

async function generateAndSendAiReply(
    config: CloudConfig,
    supabase: ReturnType<typeof getSupabaseAdmin>,
    tenantId: string,
    conversationId: string,
    phoneNumber: string
): Promise<void> {
    try {
        // Dynamically import ai-agent functions
        // The AI agent module is shared between session-manager and webhook
        const { generateReply } = await import("@/lib/ai-agent");

        // Get recent conversation history
        const { data: messages } = await supabase
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(20);

        if (!messages) return;

        // Reverse to get chronological order
        const history = messages.reverse().map(m => ({
            role: m.role as "user" | "assistant" | "owner",
            content: m.content,
        }));

        // Generate AI reply
        const reply = await generateReply(tenantId, history);
        if (!reply) return;

        // Handle [PAUSE] — handoff to human
        const isPause = reply.includes("[PAUSE]");
        const cleanReply = reply.replace(/\[PAUSE\]/g, "").trim();

        if (cleanReply) {
            // Send via Cloud API
            const result = await sendTextMessage(config, phoneNumber, cleanReply);

            if (result.success) {
                // Store the AI reply in DB
                await supabase.from("messages").insert({
                    conversation_id: conversationId,
                    role: "assistant",
                    content: cleanReply,
                    is_from_agent: true,
                    wa_message_id: result.messageId,
                    status: "sent",
                });

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

            // Notify owner if configured
            if (config) {
                // TODO: Send notification to owner (push notification, email, etc.)
            }
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
        .eq("wa_message_id", status.id);

    if (error) {
        // Not critical — message might not exist yet (race condition)
    }

    if (status.status === "failed" && status.errors) {
        console.error(`[${config.tenant_id}] Message delivery failed:`, status.errors);
    }
}
