/**
 * Scheduling helpers for the WhatsApp AI agent.
 * Provides:
 *  - getSchedulingContext()  — formatted string injected into the AI system prompt
 *  - getAvailableSlots()     — computes free time slots for a given date (2-layer check)
 *  - bookMeeting()           — creates meeting in DB + calendar provider
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { buildTzDate, buildSlotTimestamp, toDateString } from "./date-utils";

// ─── Supabase singleton ──────────────────────────────────────────────────────
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (!_supabase)
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    return _supabase;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeetingSettings {
    scheduling_enabled: boolean;
    duration_minutes: number;
    buffer_minutes: number | null;
    booking_notice_hours: number | null;
    booking_window_days: number | null; // 0 = no limit
    timezone: string | null;
}

interface AvailabilityRule {
    day_of_week: number; // 0 = Sunday … 6 = Saturday
    start_time: string;  // "HH:MM:SS" or "HH:MM"
    end_time: string;
}

interface ExistingMeeting {
    start_time: string;
    end_time: string;
}

// ─── Day names (Hebrew) ───────────────────────────────────────────────────────
const DAY_NAMES_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ─── getSchedulingContext ─────────────────────────────────────────────────────
/**
 * Returns a Hebrew scheduling instructions block to inject into the AI system
 * prompt, or an empty string if scheduling is disabled / not configured.
 */
export async function getSchedulingContext(tenantId: string): Promise<string> {
    const supabase = getSupabase();

    const { data: settings } = await supabase
        .from("meeting_settings")
        .select("scheduling_enabled, duration_minutes, buffer_minutes, booking_notice_hours, booking_window_days, timezone")
        .eq("tenant_id", tenantId)
        .single();

    if (!settings?.scheduling_enabled) return "";

    const { data: rules } = await supabase
        .from("availability_rules")
        .select("day_of_week, start_time, end_time")
        .eq("tenant_id", tenantId)
        .order("day_of_week")
        .order("start_time");

    const ruleList = (rules ?? []) as AvailabilityRule[];

    // Group rules by day_of_week → "ראשון: 09:00-12:00, 14:00-18:00"
    const grouped = new Map<number, string[]>();
    for (const rule of ruleList) {
        const start = rule.start_time.substring(0, 5);
        const end   = rule.end_time.substring(0, 5);
        const existing = grouped.get(rule.day_of_week) ?? [];
        existing.push(`${start}-${end}`);
        grouped.set(rule.day_of_week, existing);
    }

    const daysLine = [...grouped.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([day, ranges]) => `${DAY_NAMES_HE[day]}: ${ranges.join(", ")}`)
        .join(" | ");

    const s = settings as MeetingSettings;
    const durationNote = `משך כל פגישה: ${s.duration_minutes} דקות`;
    const windowNote = !s.booking_window_days
        ? "ניתן לקבוע פגישה בכל תאריך עתידי (ללא הגבלת זמן)"
        : `ניתן לקבוע עד ${s.booking_window_days} ימים קדימה`;

    return `
=== מערכת קביעת פגישות ===
${daysLine ? `שעות זמינות: ${daysLine}` : ""}
${durationNote}
${windowNote}

כאשר לקוח מבקש לקבוע פגישה:

1. שאל אותו איזה יום מתאים לו (אם לא אמר)
2. כשיש לך תאריך, השתמש במרקר: [CHECK_SLOTS: date=YYYY-MM-DD]
   המערכת תחזיר לך את השעות הפנויות ותוכל להציע אותן ללקוח
3. כשהלקוח בחר שעה, אשר איתו ואז השתמש במרקר: [BOOK_MEETING: date=YYYY-MM-DD, time=HH:MM, name=CUSTOMER_NAME]
4. לאחר קביעת הפגישה - שלח הודעת אישור עם הפרטים
5. אם לקוח מבקש לבטל פגישה - השתמש במרקר: [CANCEL_MEETING]

חוקים:
- אסור לקבוע פגישות מחוץ לשעות הזמינות
- תמיד לאשר עם הלקוח לפני קביעה
- אם אין שעות פנויות ביום המבוקש - הצע ימים חלופיים
- תאריכים תמיד בפורמט YYYY-MM-DD (לדוגמה: 2026-03-25)
`.trim();
}

// ─── getAvailableSlots ────────────────────────────────────────────────────────
/**
 * Returns a list of available HH:MM slot strings for the given tenant + date.
 *
 * TWO-LAYER CHECK:
 *   Layer 1 — availability_rules (configured business hours)
 *   Layer 2 — calendar provider freeBusy (real calendar conflicts)
 *
 * Returns [] when scheduling is disabled, no rules exist, or date is out of window.
 */
export async function getAvailableSlots(
    tenantId: string,
    dateStr: string // "YYYY-MM-DD"
): Promise<string[]> {
    const supabase = getSupabase();

    // Fetch tenant timezone
    const { data: tenantRow } = await supabase
        .from("tenants")
        .select("timezone")
        .eq("id", tenantId)
        .single();
    const tz = (tenantRow as { timezone?: string } | null)?.timezone ?? "Asia/Jerusalem";

    // Build start-of-day in tenant's timezone
    const [y, mo, d] = dateStr.split("-").map(Number);
    const dateInTz = buildTzDate(tz, y, mo, d);
    const dayOfWeek = new Date(dateStr + "T12:00:00Z").getUTCDay();
    // Use noon UTC to get stable day-of-week regardless of timezone

    const [settingsResult, rulesResult, meetingsResult] = await Promise.all([
        supabase
            .from("meeting_settings")
            .select("*")
            .eq("tenant_id", tenantId)
            .single(),
        supabase
            .from("availability_rules")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("day_of_week", dayOfWeek)
            .order("start_time"),
        supabase
            .from("meetings")
            .select("start_time, end_time")
            .eq("tenant_id", tenantId)
            .eq("status", "confirmed")
            .gte("start_time", buildTzDate(tz, y, mo, d, 0, 0, 0).toISOString())
            .lte("start_time", buildTzDate(tz, y, mo, d, 23, 59, 59).toISOString()),
    ]);

    const settings = settingsResult.data as MeetingSettings | null;
    const rules = (rulesResult.data ?? []) as AvailabilityRule[];
    const existingMeetings = (meetingsResult.data ?? []) as ExistingMeeting[];

    if (!settings?.scheduling_enabled || !rules.length) return [];

    // Enforce booking window (0 = no limit)
    // Compare date strings in tenant timezone — avoids UTC vs. local midnight boundary bugs.
    const windowDays = settings.booking_window_days ?? 14;
    if (windowDays > 0) {
        const todayInTz = new Date().toLocaleDateString("en-CA", { timeZone: tz }); // "YYYY-MM-DD"
        const maxDateInTz = new Date(Date.now() + windowDays * 86_400_000)
            .toLocaleDateString("en-CA", { timeZone: tz });
        if (dateStr > maxDateInTz) return [];
        if (dateStr < todayInTz) return []; // also reject past dates
    }

    const duration   = settings.duration_minutes;
    const buffer     = settings.buffer_minutes ?? 0;
    const minNoticeMs = (settings.booking_notice_hours ?? 2) * 3_600_000;
    const now = Date.now();

    // ── Layer 2: fetch real calendar busy blocks ──────────────────────────────
    let calendarBusyBlocks: { start: Date; end: Date }[] = [];
    try {
        const { getCalendarProvider } = await import("./calendar-providers/index");
        const providerResult = await getCalendarProvider(tenantId);
        if (providerResult) {
            const dayStart = buildTzDate(tz, y, mo, d, 0, 0, 0);
            const dayEnd   = buildTzDate(tz, y, mo, d, 23, 59, 59);
            calendarBusyBlocks = await providerResult.provider.getFreeBusy(tenantId, dayStart, dayEnd);
            console.log(`[${tenantId}] 🗓️ Layer 2 (${providerResult.name}): ${calendarBusyBlocks.length} busy block(s) on ${dateStr}`);
        }
    } catch (err: any) {
        // Non-fatal: if calendar API fails, fall back to Layer 1 only
        console.error(`[${tenantId}] ⚠️ Calendar freeBusy failed, falling back to Layer 1 only:`, err.message);
    }

    const slots: string[] = [];

    for (const rule of rules) {
        const [sh, sm] = rule.start_time.split(":").map(Number);
        const [eh, em] = rule.end_time.split(":").map(Number);

        let slotStart = buildTzDate(tz, y, mo, d, sh, sm, 0);
        const windowEnd = buildTzDate(tz, y, mo, d, eh, em, 0);

        while (true) {
            const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
            if (slotEnd > windowEnd) break;

            // Enforce minimum booking notice
            if (slotStart.getTime() - now < minNoticeMs) {
                slotStart = new Date(slotStart.getTime() + (duration + buffer) * 60_000);
                continue;
            }

            // ── Layer 1: check DB meetings ────────────────────────────────────
            const dbConflict = existingMeetings.some((m) => {
                const ms = new Date(m.start_time);
                const me = new Date(m.end_time);
                return slotStart < me && slotEnd > ms;
            });

            // ── Layer 2: check calendar busy blocks ───────────────────────────
            const calConflict = calendarBusyBlocks.some((b) => {
                return slotStart < b.end && slotEnd > b.start;
            });

            if (!dbConflict && !calConflict) {
                const hh = String(
                    new Date(slotStart).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).split(":")[0]
                ).padStart(2, "0");
                const mm = String(
                    new Date(slotStart).toLocaleTimeString("en-GB", { timeZone: tz, minute: "2-digit" }).split(":").pop()
                ).padStart(2, "0");
                slots.push(`${hh}:${mm}`);
            }

            slotStart = new Date(slotStart.getTime() + (duration + buffer) * 60_000);
        }
    }

    return slots;
}

// ─── bookMeeting ──────────────────────────────────────────────────────────────

export interface BookingResult {
    success: boolean;
    meetingId?: string;
    conflictError?: boolean; // true if the slot was taken (race condition)
    error?: string;
}

/**
 * Book a meeting: insert into DB (with unique constraint protection) +
 * create calendar event if a provider is connected.
 */
export async function bookMeeting(
    tenantId: string,
    conversationId: string,
    dateStr: string,   // YYYY-MM-DD
    timeStr: string,   // HH:MM
    customerName: string,
    customerPhone: string
): Promise<BookingResult> {
    const supabase = getSupabase();

    // Fetch timezone + duration
    const [tenantRow, settingsRow] = await Promise.all([
        supabase.from("tenants").select("timezone").eq("id", tenantId).single(),
        supabase.from("meeting_settings").select("duration_minutes").eq("tenant_id", tenantId).single(),
    ]);

    const tz = (tenantRow.data as { timezone?: string } | null)?.timezone ?? "Asia/Jerusalem";
    const durationMin = (settingsRow.data as { duration_minutes?: number } | null)?.duration_minutes ?? 30;

    const startIso = buildSlotTimestamp(dateStr, timeStr, tz);
    const startDate = new Date(startIso);
    const endDate   = new Date(startDate.getTime() + durationMin * 60_000);

    // Insert meeting — unique constraint on (tenant_id, start_time) WHERE status='confirmed'
    // will raise a conflict if someone else booked the same slot
    const { data: meeting, error: insertError } = await supabase
        .from("meetings")
        .insert({
            tenant_id:       tenantId,
            conversation_id: conversationId,
            customer_name:   customerName,
            customer_phone:  customerPhone,
            start_time:      startDate.toISOString(),
            end_time:        endDate.toISOString(),
            status:          "confirmed",
        })
        .select("id")
        .single();

    if (insertError) {
        // Unique violation = race condition (slot taken)
        if (insertError.code === "23505") {
            return { success: false, conflictError: true };
        }
        return { success: false, error: insertError.message };
    }

    const meetingId = meeting.id as string;

    // Try to create calendar event (non-fatal if it fails)
    try {
        const { getCalendarProvider } = await import("./calendar-providers/index");
        const providerResult = await getCalendarProvider(tenantId);
        if (providerResult) {
            const { eventId } = await providerResult.provider.createEvent(tenantId, {
                title:        `פגישה עם ${customerName}`,
                description:  `לקוח: ${customerName}\nטלפון: ${customerPhone}`,
                start:        startDate,
                end:          endDate,
                customerName,
                customerPhone,
            });

            await supabase
                .from("meetings")
                .update({
                    calendar_event_id: eventId,
                    calendar_provider: providerResult.name,
                })
                .eq("id", meetingId);

            console.log(`[${tenantId}] 🗓️ Calendar event created (${providerResult.name}): ${eventId}`);
        }
    } catch (err: any) {
        console.error(`[${tenantId}] ⚠️ Calendar event creation failed (non-fatal):`, err.message);
    }

    return { success: true, meetingId };
}
