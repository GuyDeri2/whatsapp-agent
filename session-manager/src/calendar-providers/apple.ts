/**
 * calendar-providers/apple.ts
 * Apple Calendar (iCloud) integration via CalDAV protocol using tsdav.
 *
 * Authentication: Basic auth with Apple ID email + app-specific password.
 * Stored in calendar_integrations:
 *   - access_token = app-specific password
 *   - calendar_id  = Apple ID email
 *   - calendar_name = 'Apple Calendar'
 *
 * No OAuth refresh needed — app-specific passwords don't expire.
 */

import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { DAVClient } from "tsdav";
import type { BusyBlock, CalendarProvider, CreatedEvent, CreateEventParams } from "./types";

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

/**
 * Decrypt an AES-256-GCM encrypted string (format: "iv:authTag:ciphertext", all hex).
 * Falls back to returning the raw value if it doesn't match encrypted format
 * (backwards compatibility with previously stored plain-text passwords).
 */
function decryptSecret(encrypted: string): string {
    const parts = encrypted.split(":");
    if (parts.length !== 3) return encrypted; // not encrypted (legacy)

    const key = process.env.SESSION_ENCRYPTION_KEY;
    if (!key) throw new Error("SESSION_ENCRYPTION_KEY is not configured — cannot decrypt Apple credentials");

    const keyBuf = key.length === 64 ? Buffer.from(key, "hex") : Buffer.from(key.padEnd(32, "0").slice(0, 32));
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const ciphertext = parts[2];

    const decipher = createDecipheriv("aes-256-gcm", keyBuf, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

interface AppleIntegration {
    access_token: string; // encrypted app-specific password
    calendar_id: string;  // Apple ID email
}

async function getIntegration(tenantId: string): Promise<AppleIntegration | null> {
    const { data, error } = await getSupabase()
        .from("calendar_integrations")
        .select("access_token, calendar_id")
        .eq("tenant_id", tenantId)
        .eq("provider", "apple")
        .eq("is_active", true)
        .single();
    if (error || !data) return null;
    return data as AppleIntegration;
}

/**
 * Create a connected DAVClient for iCloud CalDAV.
 */
async function createDavClient(integration: AppleIntegration): Promise<DAVClient> {
    const password = decryptSecret(integration.access_token);
    const client = new DAVClient({
        serverUrl: "https://caldav.icloud.com",
        credentials: {
            username: integration.calendar_id,
            password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
    });
    await client.login();
    return client;
}

/**
 * Get the first (default) calendar from iCloud.
 * Most users have a single "Home" or "Calendar" calendar.
 */
async function getDefaultCalendar(client: DAVClient) {
    const calendars = await client.fetchCalendars();
    if (!calendars || calendars.length === 0) {
        throw new Error("No calendars found on iCloud account");
    }
    // Prefer a calendar named "Calendar" or "Home", otherwise take the first
    const preferred = calendars.find(
        (c) => c.displayName === "Calendar" || c.displayName === "Home"
    );
    return preferred ?? calendars[0];
}

/**
 * Generate an iCalendar VEVENT string.
 */
function buildVEvent(params: {
    uid: string;
    title: string;
    start: Date;
    end: Date;
    description?: string;
}): string {
    const formatDate = (d: Date) =>
        d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//WhatsApp Agent//Apple CalDAV//EN",
        "BEGIN:VEVENT",
        `UID:${params.uid}`,
        `DTSTART:${formatDate(params.start)}`,
        `DTEND:${formatDate(params.end)}`,
        `SUMMARY:${params.title}`,
        `DESCRIPTION:${params.description ?? ""}`,
        `DTSTAMP:${formatDate(new Date())}`,
        "END:VEVENT",
        "END:VCALENDAR",
    ].join("\r\n");
}

/**
 * Parse DTSTART/DTEND from iCalendar data into a Date.
 * Handles both "20260323T100000Z" and "20260323T100000" formats.
 */
function parseICalDate(value: string): Date | null {
    if (!value) return null;
    // Remove TZID parameter if present (e.g., "TZID=Asia/Jerusalem:20260323T100000")
    const clean = value.includes(":") ? value.split(":").pop()! : value;

    // Try DATETIME format first: YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
    const dtMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (dtMatch) {
        const [, y, m, d, h, min, s] = dtMatch;
        return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
    }

    // Handle DATE-only format (all-day events): YYYYMMDD — treat as midnight UTC
    const dateMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateMatch) {
        const [, y, m, d] = dateMatch;
        return new Date(`${y}-${m}-${d}T00:00:00Z`);
    }

    return null;
}

/**
 * Extract busy blocks from CalDAV calendar objects.
 */
function extractBusyBlocks(objects: Array<{ data?: string }>): BusyBlock[] {
    const blocks: BusyBlock[] = [];
    for (const obj of objects) {
        if (!obj.data) continue;
        const dtStartMatch = obj.data.match(/DTSTART[^:]*:([^\r\n]+)/);
        const dtEndMatch = obj.data.match(/DTEND[^:]*:([^\r\n]+)/);
        if (!dtStartMatch || !dtEndMatch) continue;

        const start = parseICalDate(dtStartMatch[1]);
        const end = parseICalDate(dtEndMatch[1]);
        if (start && end) {
            blocks.push({ start, end });
        }
    }
    return blocks;
}

export const appleCalendarProvider: CalendarProvider = {

    // App-specific passwords don't expire — no refresh needed
    async refreshTokenIfNeeded(tenantId: string): Promise<string> {
        const integration = await getIntegration(tenantId);
        if (!integration?.access_token) {
            throw new Error(`No Apple Calendar credentials for tenant ${tenantId}`);
        }
        return integration.access_token;
    },

    async getFreeBusy(tenantId: string, rangeStart: Date, rangeEnd: Date): Promise<BusyBlock[]> {
        const integration = await getIntegration(tenantId);
        if (!integration) return [];

        let client: DAVClient;
        try {
            client = await createDavClient(integration);
        } catch (err) {
            console.error(`[Apple Calendar] Failed to connect for tenant ${tenantId}:`, err);
            return [];
        }

        try {
            const calendar = await getDefaultCalendar(client);

            const objects = await client.fetchCalendarObjects({
                calendar,
                timeRange: {
                    start: rangeStart.toISOString(),
                    end: rangeEnd.toISOString(),
                },
            });

            return extractBusyBlocks(objects);
        } catch (err) {
            console.error(`[Apple Calendar] getFreeBusy failed for tenant ${tenantId}:`, err);
            return [];
        }
    },

    async createEvent(tenantId: string, params: CreateEventParams): Promise<CreatedEvent> {
        const integration = await getIntegration(tenantId);
        if (!integration) {
            throw new Error(`No Apple Calendar integration for tenant ${tenantId}`);
        }

        const client = await createDavClient(integration);
        const calendar = await getDefaultCalendar(client);

        const uid = `wa-${tenantId}-${Date.now()}@whatsapp-agent`;
        const description = params.description ??
            `פגישה עם ${params.customerName} (${params.customerPhone})`;

        const icalData = buildVEvent({
            uid,
            title: params.title,
            start: params.start,
            end: params.end,
            description,
        });

        const filename = `${uid}.ics`;

        await client.createCalendarObject({
            calendar,
            filename,
            iCalString: icalData,
        });

        return { eventId: uid };
    },

    async deleteEvent(tenantId: string, eventId: string): Promise<void> {
        const integration = await getIntegration(tenantId);
        if (!integration) return;

        let client: DAVClient;
        try {
            client = await createDavClient(integration);
        } catch (err) {
            console.error(`[Apple Calendar] Failed to connect for delete, tenant ${tenantId}:`, err);
            return;
        }

        try {
            const calendar = await getDefaultCalendar(client);

            // Fetch all objects and find the one matching the UID
            const objects = await client.fetchCalendarObjects({ calendar });
            const target = objects.find((obj) =>
                obj.data?.includes(`UID:${eventId}`)
            );

            if (target?.url) {
                await client.deleteCalendarObject({
                    calendarObject: {
                        url: target.url,
                        etag: target.etag ?? "",
                    },
                });
            }
            // If not found, treat as already deleted (idempotent)
        } catch (err) {
            console.error(`[Apple Calendar] deleteEvent failed for tenant ${tenantId}:`, err);
            // Idempotent — don't throw
        }
    },
};
