/**
 * calendar-providers/outlook.ts
 * Microsoft Outlook Calendar integration via Microsoft Graph API.
 * Uses raw fetch (no @microsoft/microsoft-graph-client) for minimal dependencies.
 *
 * Env vars required (in .env.local / Render env):
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 */

import type { BusyBlock, CalendarProvider, CreatedEvent } from "./types";
import { getSupabase } from "./index";

// ── Token Management ──────────────────────────────────────────────────────────

async function getIntegration(tenantId: string) {
    const { data, error } = await getSupabase()
        .from("calendar_integrations")
        .select("access_token, refresh_token, token_expires_at, calendar_id")
        .eq("tenant_id", tenantId)
        .eq("provider", "outlook")
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
    if (!integration) throw new Error(`No active Outlook Calendar integration for tenant ${tenantId}`);

    // Check if token expires within 5 minutes
    const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at) : null;
    const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60_000;

    if (!needsRefresh) return integration.access_token;

    if (!integration.refresh_token) {
        throw new Error(
            `Outlook Calendar refresh_token is missing for tenant ${tenantId}. ` +
            `The user must re-authorize the Outlook Calendar integration.`
        );
    }

    const resp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID!,
            client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
            refresh_token: integration.refresh_token,
            grant_type: "refresh_token",
            scope: "https://graph.microsoft.com/Calendars.ReadWrite offline_access",
        }),
    });

    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Outlook token refresh failed: ${resp.status} ${body}`);
    }

    const json = await resp.json() as { access_token: string; expires_in: number; refresh_token?: string };
    const newExpiry = new Date(Date.now() + json.expires_in * 1000).toISOString();

    // Save new access_token + refresh_token (Microsoft may rotate the refresh token)
    const updatePayload: Record<string, string> = {
        access_token: json.access_token,
        token_expires_at: newExpiry,
        updated_at: new Date().toISOString(),
    };
    if (json.refresh_token) {
        updatePayload.refresh_token = json.refresh_token;
    }

    await getSupabase()
        .from("calendar_integrations")
        .update(updatePayload)
        .eq("tenant_id", tenantId)
        .eq("provider", "outlook");

    return json.access_token;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function graphGet(path: string, accessToken: string) {
    const resp = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Graph API GET ${path} failed: ${resp.status} ${body}`);
    }
    return resp.json();
}

async function graphPost(path: string, body: unknown, accessToken: string) {
    const resp = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Graph API POST ${path} failed: ${resp.status} ${text}`);
    }
    return resp.json();
}

async function graphDelete(path: string, accessToken: string) {
    const resp = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 = already deleted (idempotent)
    if (!resp.ok && resp.status !== 404) {
        const text = await resp.text();
        throw new Error(`Graph API DELETE ${path} failed: ${resp.status} ${text}`);
    }
}

// ── CalendarProvider implementation ──────────────────────────────────────────

export const outlookCalendarProvider: CalendarProvider = {

    async refreshTokenIfNeeded(tenantId: string): Promise<string> {
        return refreshTokenIfNeeded(tenantId);
    },

    async getFreeBusy(tenantId: string, rangeStart: Date, rangeEnd: Date): Promise<BusyBlock[]> {
        const accessToken = await refreshTokenIfNeeded(tenantId);

        // Get the user's email (needed for getSchedule API)
        const me = await graphGet("/me", accessToken) as { mail?: string; userPrincipalName?: string };
        const email = me.mail ?? me.userPrincipalName ?? "";

        // Microsoft Graph getSchedule endpoint
        // Always use /me/calendar/getSchedule — per-calendar endpoint doesn't support getSchedule
        const body = {
            schedules: [email],
            startTime: { dateTime: rangeStart.toISOString(), timeZone: "UTC" },
            endTime:   { dateTime: rangeEnd.toISOString(),   timeZone: "UTC" },
            availabilityViewInterval: 15,
        };

        const result = await graphPost("/me/calendar/getSchedule", body, accessToken) as {
            value: { scheduleItems: { start: { dateTime: string }; end: { dateTime: string }; status: string }[] }[];
        };

        const items = result.value?.[0]?.scheduleItems ?? [];
        return items
            .filter((item) => item.status === "busy" || item.status === "tentative")
            .map((item) => ({
                start: new Date(item.start.dateTime + "Z"),
                end:   new Date(item.end.dateTime + "Z"),
            }));
    },

    async createEvent(tenantId: string, params): Promise<CreatedEvent> {
        const accessToken = await refreshTokenIfNeeded(tenantId);
        const integration = await getIntegration(tenantId);
        const calendarId = integration?.calendar_id;

        const event = {
            subject: params.title,
            body: {
                contentType: "text",
                content: params.description ?? `פגישה עם ${params.customerName} (${params.customerPhone})`,
            },
            start: { dateTime: params.start.toISOString(), timeZone: "UTC" },
            end:   { dateTime: params.end.toISOString(),   timeZone: "UTC" },
            isReminderOn: true,
            reminderMinutesBeforeStart: 120,
        };

        const path = calendarId && calendarId !== "primary"
            ? `/me/calendars/${calendarId}/events`
            : "/me/events";

        const result = await graphPost(path, event, accessToken) as {
            id: string;
            webLink?: string;
        };

        return { eventId: result.id, htmlLink: result.webLink };
    },

    async deleteEvent(tenantId: string, eventId: string): Promise<void> {
        const accessToken = await refreshTokenIfNeeded(tenantId);
        await graphDelete(`/me/events/${encodeURIComponent(eventId)}`, accessToken);
    },
};
