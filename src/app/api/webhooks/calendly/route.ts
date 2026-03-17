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

/** Verify Calendly webhook signature */
function verifySignature(rawBody: string, signature: string | null): boolean {
    const secret = process.env.CALENDLY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const signatureBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(expectedBuf, signatureBuf);
}

/** Resolve tenant_id from a Calendly user URI */
async function resolveTenant(calendlyUserUri: string): Promise<string | null> {
    const supabase = getSupabase();
    // The calendar_integrations.access_token belongs to this user — we match
    // by finding the integration whose user matches the webhook event's organizer URI.
    // Since we store the token per-tenant, we check which tenant has a Calendly integration.
    // Best match: the calendar_id or access_token owner — for now use a broad lookup
    // and let the caller narrow by event_type URI if needed.
    const { data } = await supabase
        .from("calendar_integrations")
        .select("tenant_id")
        .eq("provider", "calendly")
        .eq("is_active", true)
        .limit(20);

    if (!data || data.length === 0) return null;
    // If there's only one Calendly tenant, return it directly
    if (data.length === 1) return data[0].tenant_id;
    // Multiple tenants — can't determine without more context; return null
    return null;
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
                customer_phone:    inviteeEmail, // best we have from Calendly webhook
                start_time:        startTime,
                end_time:          endTime,
                status:            "confirmed",
            },
            { onConflict: "tenant_id,start_time", ignoreDuplicates: false }
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
