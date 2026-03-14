/**
 * Scheduling helpers for the WhatsApp AI agent.
 * Provides:
 *  - getSchedulingContext()  — formatted string injected into the AI system prompt
 *  - getAvailableSlots()     — computes free time slots for a given date
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Supabase singleton (separate from the ones in ai-agent / message-handler) ─
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (!_supabase)
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    return _supabase;
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface MeetingSettings {
    scheduling_enabled: boolean;
    duration_minutes: number;
    buffer_minutes: number | null;
    booking_notice_hours: number | null;
    booking_window_days: number | null; // 0 = no limit
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

// ─── Day names (Hebrew) ─────────────────────────────────────────────────────
const DAY_NAMES_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ─── getSchedulingContext ───────────────────────────────────────────────────
/**
 * Returns a Hebrew scheduling instructions block to inject into the AI system
 * prompt, or an empty string if scheduling is disabled / not configured.
 */
export async function getSchedulingContext(tenantId: string): Promise<string> {
    const supabase = getSupabase();

    const { data: settings } = await supabase
        .from("meeting_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .single();

    if (!settings?.scheduling_enabled) return "";

    const { data: rules } = await supabase
        .from("availability_rules")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("day_of_week")
        .order("start_time");

    const ruleList = (rules ?? []) as AvailabilityRule[];

    // Group rules by day_of_week → "ראשון: 09:00-12:00, 14:00-18:00"
    const grouped = new Map<number, string[]>();
    for (const rule of ruleList) {
        const start = rule.start_time.substring(0, 5); // "HH:MM"
        const end = rule.end_time.substring(0, 5);
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

חוקים:
- אסור לקבוע פגישות מחוץ לשעות הזמינות
- תמיד לאשר עם הלקוח לפני קביעה
- אם אין שעות פנויות ביום המבוקש - הצע ימים חלופיים
`.trim();
}

// ─── getAvailableSlots ─────────────────────────────────────────────────────
/**
 * Returns a list of available HH:MM slot strings for the given tenant + date.
 * Returns an empty array when scheduling is disabled or no rules exist.
 */
export async function getAvailableSlots(
    tenantId: string,
    dateStr: string // "YYYY-MM-DD"
): Promise<string[]> {
    const supabase = getSupabase();

    const date = new Date(`${dateStr}T00:00:00`);
    const dayOfWeek = date.getDay();

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
            .gte("start_time", `${dateStr}T00:00:00`)
            .lte("start_time", `${dateStr}T23:59:59`),
    ]);

    const settings = settingsResult.data as MeetingSettings | null;
    const rules = (rulesResult.data ?? []) as AvailabilityRule[];
    const existingMeetings = (meetingsResult.data ?? []) as ExistingMeeting[];

    if (!settings?.scheduling_enabled || !rules.length) return [];

    // Enforce booking window (0 = no limit)
    const windowDays = settings.booking_window_days ?? 14;
    if (windowDays > 0) {
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + windowDays);
        if (date > maxDate) return [];
    }

    const duration = settings.duration_minutes;
    const buffer = settings.buffer_minutes ?? 0;
    const minNoticeMs = (settings.booking_notice_hours ?? 2) * 3_600_000;
    const now = Date.now();

    const slots: string[] = [];

    for (const rule of rules) {
        const [sh, sm] = rule.start_time.split(":").map(Number);
        const [eh, em] = rule.end_time.split(":").map(Number);

        let slotStart = new Date(date);
        slotStart.setHours(sh, sm, 0, 0);
        const windowEnd = new Date(date);
        windowEnd.setHours(eh, em, 0, 0);

        while (true) {
            const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
            if (slotEnd > windowEnd) break;

            // Enforce minimum booking notice
            if (slotStart.getTime() - now < minNoticeMs) {
                slotStart = new Date(slotStart.getTime() + (duration + buffer) * 60_000);
                continue;
            }

            // Check for conflicts with existing confirmed meetings
            const conflict = existingMeetings.some((m) => {
                const ms = new Date(m.start_time);
                const me = new Date(m.end_time);
                return slotStart < me && slotEnd > ms;
            });

            if (!conflict) {
                const hh = String(slotStart.getHours()).padStart(2, "0");
                const mm = String(slotStart.getMinutes()).padStart(2, "0");
                slots.push(`${hh}:${mm}`);
            }

            slotStart = new Date(slotStart.getTime() + (duration + buffer) * 60_000);
        }
    }

    return slots;
}
