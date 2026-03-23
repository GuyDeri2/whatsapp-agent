/**
 * calendar-providers/google.ts
 * Google Calendar API v3 integration.
 * Uses raw fetch (no googleapis package) for minimal dependencies.
 *
 * Env vars required (in .env.local):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 */

import type { BusyBlock, CalendarProvider, CreatedEvent } from "./types";
import { getSupabase } from "./index";

// ── Token Management ─────────────────────────────────────────────────────────

interface GoogleIntegration {
    access_token: string;
    refresh_token: string;
    token_expires_at: string | null;
    calendar_id: string | null;
}

async function getIntegration(tenantId: string): Promise<GoogleIntegration | null> {
    const { data, error } = await getSupabase()
        .from("calendar_integrations")
        .select("access_token, refresh_token, token_expires_at, calendar_id")
        .eq("tenant_id", tenantId)
        .eq("provider", "google")
        .eq("is_active", true)
        .single();
    if (error || !data) return null;
    return data as GoogleIntegration;
}

/**
 * Refreshes the token if needed and returns BOTH the access token and the full integration object.
 * This avoids double getIntegration calls in callers.
 */
async function refreshTokenIfNeeded(tenantId: string): Promise<{ accessToken: string; integration: GoogleIntegration }> {
    const integration = await getIntegration(tenantId);
    if (!integration) throw new Error(`No active Google Calendar integration for tenant ${tenantId}`);

    // Check if token expires within 5 minutes
    const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at) : null;
    const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60_000;

    if (!needsRefresh) return { accessToken: integration.access_token, integration };

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

    const updatedIntegration: GoogleIntegration = {
        ...integration,
        access_token: json.access_token,
        token_expires_at: newExpiry,
    };

    return { accessToken: json.access_token, integration: updatedIntegration };
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

/**
 * Resolve the tenant's timezone from the DB (defaults to Asia/Jerusalem).
 */
async function getTenantTimezone(tenantId: string): Promise<string> {
    const { data } = await getSupabase()
        .from("tenants")
        .select("timezone")
        .eq("id", tenantId)
        .single();
    return (data as { timezone?: string } | null)?.timezone ?? "Asia/Jerusalem";
}

export const googleCalendarProvider: CalendarProvider = {

    async refreshTokenIfNeeded(tenantId: string): Promise<string> {
        const { accessToken } = await refreshTokenIfNeeded(tenantId);
        return accessToken;
    },

    async getFreeBusy(tenantId: string, rangeStart: Date, rangeEnd: Date): Promise<BusyBlock[]> {
        const { accessToken, integration } = await refreshTokenIfNeeded(tenantId);
        const calendarId = integration.calendar_id ?? "primary";

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

    // Fix #5: Use tenant timezone instead of "UTC" for event creation
    async createEvent(tenantId: string, params): Promise<CreatedEvent> {
        const { accessToken, integration } = await refreshTokenIfNeeded(tenantId);
        const calendarId = integration.calendar_id ?? "primary";
        const tz = await getTenantTimezone(tenantId);

        const event = {
            summary: params.title,
            description: params.description ?? `פגישה עם ${params.customerName} (${params.customerPhone})`,
            start: { dateTime: params.start.toISOString(), timeZone: tz },
            end:   { dateTime: params.end.toISOString(),   timeZone: tz },
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
        const { accessToken, integration } = await refreshTokenIfNeeded(tenantId);
        const calendarId = integration.calendar_id ?? "primary";

        await googleApiDelete(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            accessToken
        );
    },
};
