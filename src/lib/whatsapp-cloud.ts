/**
 * WhatsApp Cloud API client.
 * Handles sending messages and webhook signature verification.
 */

import crypto from "crypto";
import { getSupabaseAdmin } from "./supabase/admin";

const META_API_VERSION = process.env.META_API_VERSION || "v21.0";
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ── Types ────────────────────────────────────────────────────────────

export interface CloudConfig {
    tenant_id: string;
    access_token: string;
    phone_number_id: string;
    waba_id: string;
    webhook_verify_token: string;
}

export interface IncomingWhatsAppMessage {
    from: string;           // sender phone number (e.g. "972501234567")
    id: string;             // message ID from Meta
    timestamp: string;      // Unix timestamp
    type: string;           // "text" | "image" | "audio" | "video" | "document" | "reaction" | "interactive" | ...
    text?: { body: string };
    image?: { id: string; mime_type: string; sha256: string; caption?: string };
    audio?: { id: string; mime_type: string };
    video?: { id: string; mime_type: string; caption?: string };
    document?: { id: string; mime_type: string; filename?: string; caption?: string };
    contacts?: Array<{ name: { formatted_name: string } }>;
}

export interface WebhookEntry {
    id: string;  // WABA ID
    changes: Array<{
        value: {
            messaging_product: string;
            metadata: {
                display_phone_number: string;
                phone_number_id: string;
            };
            contacts?: Array<{
                profile: { name: string };
                wa_id: string;
            }>;
            messages?: IncomingWhatsAppMessage[];
            statuses?: Array<{
                id: string;
                status: "sent" | "delivered" | "read" | "failed";
                timestamp: string;
                recipient_id: string;
                errors?: Array<{ code: number; title: string }>;
            }>;
        };
        field: string;
    }>;
}

export interface WebhookPayload {
    object: string;
    entry: WebhookEntry[];
}

// ── Config cache (per phone_number_id → tenant config) ──────────────

const configCache = new Map<string, { config: CloudConfig; fetchedAt: number }>();
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Look up tenant cloud config by phone_number_id.
 * This is the multi-tenant routing key — each webhook message includes the
 * phone_number_id, which maps 1:1 to a tenant.
 */
export async function getCloudConfigByPhoneId(phoneNumberId: string): Promise<CloudConfig | null> {
    const cached = configCache.get(phoneNumberId);
    if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
        return cached.config;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from("whatsapp_cloud_config")
        .select("tenant_id, access_token, phone_number_id, waba_id, webhook_verify_token")
        .eq("phone_number_id", phoneNumberId)
        .single();

    if (error || !data) return null;

    const config = data as CloudConfig;
    configCache.set(phoneNumberId, { config, fetchedAt: Date.now() });
    return config;
}

/**
 * Get cloud config for a specific tenant.
 */
export async function getCloudConfigByTenantId(tenantId: string): Promise<CloudConfig | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from("whatsapp_cloud_config")
        .select("tenant_id, access_token, phone_number_id, waba_id, webhook_verify_token")
        .eq("tenant_id", tenantId)
        .single();

    if (error || !data) return null;
    return data as CloudConfig;
}

/** Invalidate cached config (e.g. after token refresh). */
export function invalidateConfigCache(phoneNumberId: string): void {
    configCache.delete(phoneNumberId);
}

// ── Webhook signature verification ──────────────────────────────────

/**
 * Verify the X-Hub-Signature-256 header from Meta.
 * Returns true if the payload is authentic.
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
        console.error("[WhatsApp Cloud] META_APP_SECRET not set — cannot verify webhook signature");
        return false;
    }

    const expectedSig = "sha256=" + crypto
        .createHmac("sha256", appSecret)
        .update(payload)
        .digest("hex");

    // timingSafeEqual requires same-length buffers
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// ── Token management ────────────────────────────────────────────────

/**
 * Exchange a short-lived user access token for a long-lived one (~60 days).
 * Returns { token, expiresAt } or null on failure.
 */
export async function exchangeForLongLivedToken(
    shortLivedToken: string
): Promise<{ token: string; expiresAt: Date } | null> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return null;

    try {
        const res = await fetch(
            `${META_API_BASE}/oauth/access_token?` +
            new URLSearchParams({
                grant_type: "fb_exchange_token",
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: shortLivedToken,
            })
        );

        if (!res.ok) {
            console.error("[WhatsApp Cloud] Long-lived token exchange failed:", await res.text());
            return null;
        }

        const data = await res.json();
        if (!data.access_token) return null;

        // Meta returns expires_in in seconds (typically ~5184000 = 60 days)
        const expiresInMs = (data.expires_in ?? 5184000) * 1000;
        return {
            token: data.access_token,
            expiresAt: new Date(Date.now() + expiresInMs),
        };
    } catch (err) {
        console.error("[WhatsApp Cloud] Long-lived token exchange error:", err);
        return null;
    }
}

/**
 * Refresh a long-lived token before it expires.
 * Returns new { token, expiresAt } or null on failure.
 */
export async function refreshLongLivedToken(
    currentToken: string
): Promise<{ token: string; expiresAt: Date } | null> {
    // Refreshing a long-lived token uses the same endpoint as exchanging
    return exchangeForLongLivedToken(currentToken);
}

// ── Send messages ───────────────────────────────────────────────────

interface SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Send a text message via the WhatsApp Cloud API.
 */
export async function sendTextMessage(
    config: CloudConfig,
    to: string,
    text: string
): Promise<SendResult> {
    try {
        const res = await fetch(`${META_API_BASE}/${config.phone_number_id}/messages`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${config.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to,
                type: "text",
                text: { body: text },
            }),
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.error(`[WhatsApp Cloud] Send failed (${res.status}):`, errBody);
            return { success: false, error: errBody };
        }

        const data = await res.json();
        const messageId = data.messages?.[0]?.id;
        return { success: true, messageId };
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[WhatsApp Cloud] Send error:", msg);
        return { success: false, error: msg };
    }
}

/**
 * Mark a message as read (sends blue checkmarks).
 */
export async function markMessageRead(config: CloudConfig, messageId: string): Promise<void> {
    try {
        await fetch(`${META_API_BASE}/${config.phone_number_id}/messages`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${config.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                status: "read",
                message_id: messageId,
            }),
        });
    } catch {
        // Non-critical — don't fail on read receipt errors
    }
}

/**
 * Download media from WhatsApp Cloud API.
 * Returns the media URL that can be fetched with the access token.
 */
export async function getMediaUrl(config: CloudConfig, mediaId: string): Promise<string | null> {
    // Validate mediaId to prevent SSRF — must be alphanumeric/underscore only
    if (!/^[a-zA-Z0-9_]+$/.test(mediaId)) {
        console.error("[WhatsApp Cloud] Invalid mediaId — rejecting to prevent SSRF");
        return null;
    }

    try {
        const res = await fetch(`${META_API_BASE}/${mediaId}`, {
            headers: { "Authorization": `Bearer ${config.access_token}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.url || null;
    } catch {
        return null;
    }
}
