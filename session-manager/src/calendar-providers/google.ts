/**
 * calendar-providers/google.ts
 * Google Calendar API v3 integration.
 * Uses raw fetch (no googleapis package) for minimal dependencies.
 *
 * Env vars required (in .env.local):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 */

import { createClient } from "@supabase/supabase-js";
import type { BusyBlock, CalendarProvider, CreatedEvent } from "./types";

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

// ── Token Management ─────────────────────────────────────────────────────────

async function getIntegration(tenantId: string) {
    const { data, error } = await getSupabase()
        .from("calendar_integrations")
        .select("access_token, refresh_token, token_expires_at, calendar_id")
        .eq("tenant_id", tenantId)
        .eq("provider", "google")
        .eq("is_active", true)
        .single();
    if (error || !data) return null;
    return data as {
        access_token: string;
        refresh_token: string;
        token_expires_at: string | null;
        calendar_id: string | null;
    };
}

async function refreshTokenIfNeeded(tenantId: string): Promise<string> {
    const integration = await getIntegration(tenantId);
    if (!integration) throw new Error(`No active Google Calendar integration for tenant ${tenantId}`);

    // Check if token expires within 5 minutes
    const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at) : null;
    const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60_000;

    if (!needsRefresh) return integration.access_token;

    if (!integration.refresh_token) {
        throw new Error(
            `Google Calendar refresh_token is missing for tenant ${tenantId}. ` +
            `The user must re-authorize the Google Calendar integration.`
        );
    }

    // Refresh using refresh_token
    const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: integration.refresh_token,
            grant_type: "refresh_token",
        }),
    });

    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Google token refresh failed: ${resp.status} ${body}`);
    }

    const json = await resp.json() as { access_token: string; expires_in: number };
    const newExpiry = new Date(Date.now() + json.expires_in * 1000).toISOString();

    await getSupabase()
        .from("calendar_integrations")
        .update({ access_token: json.access_token, token_expires_at: newExpiry, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("provider", "google");

    return json.access_token;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function googleApiGet(url: string, accessToken: string) {
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Google API GET ${url} failed: ${resp.status} ${body}`);
    }
    return resp.json();
}

async function googleApiPost(url: string, body: unknown, accessToken: string) {
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Google API POST ${url} failed: ${resp.status} ${text}`);
    }
    return resp.json();
}

async function googleApiDelete(url: string, accessToken: string) {
    const resp = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 = already deleted (idempotent)
    if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
        const text = await resp.text();
        throw new Error(`Google API DELETE ${url} failed: ${resp.status} ${text}`);
    }
}

// ── CalendarProvider implementation ──────────────────────────────────────────

export const googleCalendarProvider: CalendarProvider = {

    async refreshTokenIfNeeded(tenantId: string): Promise<string> {
        return refreshTokenIfNeeded(tenantId);
    },

    async getFreeBusy(tenantId: string, rangeStart: Date, rangeEnd: Date): Promise<BusyBlock[]> {
        const accessToken = await refreshTokenIfNeeded(tenantId);
        const integration = await getIntegration(tenantId);
        const calendarId = integration?.calendar_id ?? "primary";

        const body = {
            timeMin: rangeStart.toISOString(),
            timeMax: rangeEnd.toISOString(),
            items: [{ id: calendarId }],
        };

        const result = await googleApiPost(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            body,
            accessToken
        ) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };

        const busyList = result.calendars?.[calendarId]?.busy ?? [];
        return busyList.map((b) => ({
            start: new Date(b.start),
            end: new Date(b.end),
        }));
    },

    async createEvent(tenantId: string, params): Promise<CreatedEvent> {
        const accessToken = await refreshTokenIfNeeded(tenantId);
        const integration = await getIntegration(tenantId);
        const calendarId = integration?.calendar_id ?? "primary";

        const event = {
            summary: params.title,
            description: params.description ?? `פגישה עם ${params.customerName} (${params.customerPhone})`,
            start: { dateTime: params.start.toISOString(), timeZone: "UTC" },
            end:   { dateTime: params.end.toISOString(),   timeZone: "UTC" },
            attendees: [],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: "popup", minutes: 120 },
                    { method: "popup", minutes: 1440 },
                ],
            },
        };

        const result = await googleApiPost(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
            event,
            accessToken
        ) as { id: string; htmlLink?: string };

        return { eventId: result.id, htmlLink: result.htmlLink };
    },

    async deleteEvent(tenantId: string, eventId: string): Promise<void> {
        const accessToken = await refreshTokenIfNeeded(tenantId);
        const integration = await getIntegration(tenantId);
        const calendarId = integration?.calendar_id ?? "primary";

        await googleApiDelete(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            accessToken
        );
    },
};
