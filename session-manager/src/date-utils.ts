/**
 * date-utils.ts
 * Centralised, timezone-aware date parsing and formatting for the scheduling system.
 *
 * All incoming date strings from the AI (YYYY-MM-DD) are treated as dates in the
 * tenant's configured timezone (default: Asia/Jerusalem).  All DB writes use ISO 8601
 * with an explicit UTC offset so Postgres stores the correct instant.
 */

/** Map of Hebrew day names → 0-based day-of-week (Sunday = 0) */
const HEBREW_DAYS: Record<string, number> = {
    ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6,
};

/** Map of Hebrew month names → 1-based month number */
const HEBREW_MONTHS: Record<string, number> = {
    ינואר: 1, פברואר: 2, מרץ: 3, אפריל: 4, מאי: 5, יוני: 6,
    יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
};

/**
 * Get the UTC offset in minutes for a given timezone and date.
 * Uses Intl.DateTimeFormat internals to determine the actual offset (DST-aware).
 */
function getUtcOffsetMinutes(timezone: string, date: Date = new Date()): number {
    const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate  = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
    return (tzDate.getTime() - utcDate.getTime()) / 60_000;
}

/**
 * Build a Date that represents a specific calendar date + time in the given timezone.
 * e.g. buildTzDate("Asia/Jerusalem", 2026, 3, 20, 9, 30) → "2026-03-20T07:30:00Z"
 */
export function buildTzDate(
    timezone: string,
    year: number, month: number, day: number,
    hour = 0, minute = 0, second = 0
): Date {
    // Start with a rough UTC candidate
    const rough = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const offsetMin = getUtcOffsetMinutes(timezone, rough);
    return new Date(rough.getTime() - offsetMin * 60_000);
}

/**
 * Parse a YYYY-MM-DD string as a date in the tenant's timezone.
 * Returns null if the string is not a valid date.
 */
export function parseDateString(dateStr: string, timezone = "Asia/Jerusalem"): Date | null {
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const [, y, mo, d] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return buildTzDate(timezone, y, mo, d);
}

/**
 * Given a date in the tenant's timezone, return the YYYY-MM-DD string for that date.
 */
export function toDateString(date: Date, timezone = "Asia/Jerusalem"): string {
    return date.toLocaleDateString("en-CA", { timeZone: timezone }); // en-CA → YYYY-MM-DD
}

/**
 * Build a full ISO timestamp string for a date + HH:MM time in the tenant's timezone.
 * This is what we store in the DB (timestamptz).
 */
export function buildSlotTimestamp(
    dateStr: string, // YYYY-MM-DD
    timeStr: string, // HH:MM
    timezone = "Asia/Jerusalem"
): string {
    const [h, m] = timeStr.split(":").map(Number);
    const [y, mo, d] = dateStr.split("-").map(Number);
    return buildTzDate(timezone, y, mo, d, h, m, 0).toISOString();
}

/**
 * Format a Date for display in a WhatsApp message (Hebrew).
 * e.g. "שישי, 20 במרץ, 2026 בשעה 09:30"
 */
export function formatDateHebrew(date: Date, timezone = "Asia/Jerusalem"): string {
    const datePart = date.toLocaleDateString("he-IL", {
        timeZone: timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
    const timePart = date.toLocaleTimeString("he-IL", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    return `${datePart} בשעה ${timePart}`;
}

/**
 * Format just the time part (HH:MM) in the tenant's timezone.
 */
export function formatTimeHebrew(date: Date, timezone = "Asia/Jerusalem"): string {
    return date.toLocaleTimeString("he-IL", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

/**
 * Try to extract a YYYY-MM-DD date from an AI reply that might say things like:
 *   - "2026-03-20" (already ISO)
 *   - "20/03/2026"
 *   - "20.3.2026"
 * Returns null if no valid date found.
 */
export function extractDateFromAiReply(text: string): string | null {
    // ISO format: YYYY-MM-DD
    const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) {
        const m = isoMatch[1].match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
            const [,y,mo,d] = m.map(Number);
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return isoMatch[1];
        }
    }
    // DD/MM/YYYY or DD.MM.YYYY
    const dmyMatch = text.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
    if (dmyMatch) {
        const [, d, mo, y] = dmyMatch.map(Number);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
            return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        }
    }
    return null;
}

/**
 * Validate that a YYYY-MM-DD string is a real calendar date and not in the past.
 * Returns an error string (Hebrew) or null if valid.
 */
export function validateBookingDate(
    dateStr: string,
    timezone = "Asia/Jerusalem",
    bookingNoticehours = 2
): string | null {
    const date = parseDateString(dateStr, timezone);
    if (!date) return "התאריך שהוזן אינו תקין.";
    const minAllowed = new Date(Date.now() + bookingNoticehours * 3_600_000);
    if (date < minAllowed) return "לא ניתן לקבוע פגישה בתאריך שעבר או ללא הודעה מוקדמת מספקת.";
    return null;
}
