/**
 * POST /api/webhooks/calendly
 *
 * Receives Calendly webhook events and syncs them to the meetings table.
 *
 * Events handled:
 *   - invitee.created  → confirm/create meeting record
 *   - invitee.canceled → mark meeting cancelled
 *
 * Security: Calendly signs each request with HMAC-SHA256.
 * Set CALENDLY_WEBHOOK_SECRET in .env.local.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

/**
 * Verify Calendly webhook signature.
 * Calendly sends: `Calendly-Webhook-Signature: t=<timestamp>,v1=<signature>`
 * HMAC is computed over `t.rawBody` (timestamp + "." + body).
 */
function verifySignature(rawBody: string, signature: string | null): boolean {
    const secret = process.env.CALENDLY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;

    // Parse Calendly's `t=...,v1=...` format
    const parts: Record<string, string> = {};
    for (const part of signature.split(",")) {
        const [key, ...rest] = part.split("=");
        if (key && rest.length > 0) {
            parts[key.trim()] = rest.join("=").trim();
        }
    }

    const timestamp = parts["t"];
    const v1Signature = parts["v1"];
    if (!timestamp || !v1Signature) return false;

    // Compute HMAC on "timestamp.rawBody"
    const payload = `${timestamp}.${rawBody}`;
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const signatureBuf = Buffer.from(v1Signature, "hex");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(expectedBuf, signatureBuf);
}

/** Resolve tenant_id from a Calendly user URI — strict match only */
async function resolveTenant(calendlyUserUri: string): Promise<string | null> {
    if (!calendlyUserUri) return null;

    const supabase = getSupabase();
    // Strict lookup: match by calendar_id (organizer URI) stored during integration setup.
    // Never fall back to "only one tenant" — that's a security risk in multi-tenant.
    const { data } = await supabase
        .from("calendar_integrations")
        .select("tenant_id")
        .eq("provider", "calendly")
        .eq("is_active", true)
        .eq("calendar_id", calendlyUserUri)
        .single();

    return data?.tenant_id ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const rawBody = await req.text();
    const signature = req.headers.get("calendly-webhook-signature");

    if (!verifySignature(rawBody, signature)) {
        console.warn("[calendly-webhook] Invalid signature — request rejected");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: any;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const event = payload?.event as string;
    const resource = payload?.payload as any;

    console.log(`[calendly-webhook] Event: ${event}`);

    const supabase = getSupabase();

    if (event === "invitee.created") {
        // A new booking was made via Calendly
        const scheduledEventUri: string = resource?.scheduled_event?.uri ?? "";
        const inviteeUri: string        = resource?.uri ?? "";
        const startTime: string         = resource?.scheduled_event?.start_time ?? "";
        const endTime: string           = resource?.scheduled_event?.end_time ?? "";
        const inviteeName: string       = resource?.name ?? "";
        const inviteeEmail: string      = resource?.email ?? "";

        // Extract event UUID from URI
        const eventId = scheduledEventUri.split("/").pop() ?? scheduledEventUri;
        const organizerUri: string = resource?.scheduled_event?.event_memberships?.[0]?.user ?? "";

        const tenantId = await resolveTenant(organizerUri);
        if (!tenantId) {
            console.warn(`[calendly-webhook] Could not resolve tenant for organizer: ${organizerUri}`);
            return NextResponse.json({ ok: true }); // Don't error — Calendly retries on non-200
        }

        // Upsert meeting (calendar_event_id = Calendly event UUID)
        const { error } = await supabase.from("meetings").upsert(
            {
                tenant_id:         tenantId,
                calendar_event_id: eventId,
                calendar_provider: "calendly",
                customer_name:     inviteeName,
                customer_email:    inviteeEmail, // Calendly provides email, not phone
                customer_phone:    null,
                start_time:        startTime,
                end_time:          endTime,
                status:            "confirmed",
            },
            { onConflict: "tenant_id,calendar_event_id", ignoreDuplicates: false }
        );

        if (error) {
            console.error(`[calendly-webhook] Failed to upsert meeting:`, error);
        } else {
            console.log(`[calendly-webhook] Meeting synced for tenant ${tenantId}: ${startTime}`);
        }
    }

    if (event === "invitee.canceled") {
        const scheduledEventUri: string = resource?.scheduled_event?.uri ?? "";
        const eventId = scheduledEventUri.split("/").pop() ?? scheduledEventUri;
        const organizerUri: string = resource?.scheduled_event?.event_memberships?.[0]?.user ?? "";

        const tenantId = await resolveTenant(organizerUri);
        if (!tenantId) {
            return NextResponse.json({ ok: true });
        }

        const { error } = await supabase
            .from("meetings")
            .update({ status: "cancelled" })
            .eq("tenant_id", tenantId)
            .eq("calendar_event_id", eventId);

        if (error) {
            console.error(`[calendly-webhook] Failed to cancel meeting ${eventId}:`, error);
        } else {
            console.log(`[calendly-webhook] Meeting ${eventId} marked cancelled for tenant ${tenantId}`);
        }
    }

    return NextResponse.json({ ok: true });
}
