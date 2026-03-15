/**
 * calendar-providers/calendly.ts
 * Calendly v2 API integration.
 *
 * Calendly is event-driven (webhook-first), unlike Google/Outlook which are
 * polling-based. The flow is:
 *
 *  Booking:
 *    1. Bot calls getAvailableSlots() → uses Calendly API to fetch available times
 *       for the tenant's event type.
 *    2. Customer picks a time → bot calls createEvent() → schedules via Calendly API
 *       (creates a "one-off event" or "scheduled event" on behalf of the customer).
 *    3. Calendly sends a webhook → /api/webhooks/calendly syncs to meetings table.
 *
 *  Cancellation:
 *    1. Bot/customer cancels → deleteEvent() calls Calendly cancel endpoint.
 *    2. Calendly sends invitee.canceled webhook → syncs to DB.
 *
 * Required in calendar_integrations:
 *   - access_token: Calendly Personal Access Token (PAT) or OAuth token
 *   - calendar_id:  Calendly event type UUID (the scheduling link to use)
 *
 * Env vars:
 *   CALENDLY_WEBHOOK_SECRET — used by the webhook receiver to verify signatures
 */

import { createClient } from "@supabase/supabase-js";
import type { BusyBlock, CalendarProvider, CreatedEvent, CreateEventParams } from "./types";

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

async function getIntegration(tenantId: string) {
    const { data } = await getSupabase()
        .from("calendar_integrations")
        .select("access_token, calendar_id")
        .eq("tenant_id", tenantId)
        .eq("provider", "calendly")
        .eq("is_active", true)
        .single();
    return data as { access_token: string; calendar_id: string | null } | null;
}

async function calendlyGet(path: string, token: string) {
    const resp = await fetch(`https://api.calendly.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) throw new Error(`Calendly GET ${path}: ${resp.status} ${await resp.text()}`);
    return resp.json();
}

async function calendlyPost(path: string, body: unknown, token: string) {
    const resp = await fetch(`https://api.calendly.com${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Calendly POST ${path}: ${resp.status} ${await resp.text()}`);
    return resp.json();
}

/**
 * Get the current user's URI (needed for most Calendly API calls).
 * Cached per token to avoid repeated calls.
 */
const _userUriCache = new Map<string, string>();
async function getUserUri(token: string): Promise<string> {
    if (_userUriCache.has(token)) return _userUriCache.get(token)!;
    const data = await calendlyGet("/users/me", token) as { resource: { uri: string } };
    const uri = data.resource.uri;
    _userUriCache.set(token, uri);
    return uri;
}

export const calendlyProvider: CalendarProvider = {

    // Calendly uses PAT — no OAuth refresh needed
    async refreshTokenIfNeeded(tenantId: string): Promise<string> {
        const integration = await getIntegration(tenantId);
        if (!integration?.access_token) throw new Error(`No Calendly token for tenant ${tenantId}`);
        return integration.access_token;
    },

    /**
     * Fetch busy blocks from Calendly by looking at scheduled events in the window.
     * Unlike Google, Calendly doesn't have a freeBusy endpoint — we query
     * scheduled_events and treat each confirmed event as a busy block.
     */
    async getFreeBusy(tenantId: string, rangeStart: Date, rangeEnd: Date): Promise<BusyBlock[]> {
        const integration = await getIntegration(tenantId);
        if (!integration) return [];

        const token = integration.access_token;
        const userUri = await getUserUri(token);

        // Fetch all scheduled events in the window
        const params = new URLSearchParams({
            user: userUri,
            min_start_time: rangeStart.toISOString(),
            max_start_time: rangeEnd.toISOString(),
            status: "active",
            count: "100",
        });

        const data = await calendlyGet(`/scheduled_events?${params}`, token) as {
            collection: { start_time: string; end_time: string }[];
        };

        return (data.collection ?? []).map((e) => ({
            start: new Date(e.start_time),
            end:   new Date(e.end_time),
        }));
    },

    /**
     * Book a one-off meeting via Calendly.
     * Uses Calendly's "one-off event type" API to create a scheduling page
     * for a specific time slot, then immediately books it.
     */
    async createEvent(tenantId: string, params: CreateEventParams): Promise<CreatedEvent> {
        const integration = await getIntegration(tenantId);
        if (!integration) throw new Error(`No Calendly integration for tenant ${tenantId}`);

        const token = integration.access_token;

        // Create a one-time event directly (Calendly v2 "one_off_event_types")
        const body = {
            name: params.title,
            host: await getUserUri(token),
            duration: Math.round((params.end.getTime() - params.start.getTime()) / 60_000),
            date_setting: {
                type: "date_range",
                start_date: params.start.toISOString().slice(0, 10),
                end_date:   params.end.toISOString().slice(0, 10),
            },
            timezone: "Asia/Jerusalem",
        };

        const oneOffType = await calendlyPost("/one_off_event_types", body, token) as {
            resource: { scheduling_url: string; uri: string };
        };

        // Now book the specific time slot for the customer
        const bookingBody = {
            start_time: params.start.toISOString(),
            event_type: oneOffType.resource.uri,
            invitee: {
                email: `${params.customerPhone.replace(/\D/g, "")}@whatsapp-placeholder.local`,
                name:  params.customerName,
            },
        };

        const scheduled = await calendlyPost("/scheduled_events", bookingBody, token) as {
            resource: { uri: string; event_memberships?: { user: string }[] };
        };

        const eventUri = scheduled.resource.uri;
        // Calendly event ID is the UUID at the end of the URI
        const eventId = eventUri.split("/").pop() ?? eventUri;

        return { eventId, htmlLink: oneOffType.resource.scheduling_url };
    },

    /**
     * Cancel a Calendly event by its event UUID.
     */
    async deleteEvent(tenantId: string, eventId: string): Promise<void> {
        const integration = await getIntegration(tenantId);
        if (!integration) return;

        const token = integration.access_token;

        // Calendly cancel requires a POST to /scheduled_events/{uuid}/cancellation
        try {
            await calendlyPost(
                `/scheduled_events/${eventId}/cancellation`,
                { reason: "ביטול על ידי לקוח דרך WhatsApp" },
                token
            );
        } catch (err: any) {
            // 404 = already cancelled
            if (!err.message?.includes("404")) throw err;
        }
    },
};
