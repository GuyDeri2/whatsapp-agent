/**
 * reminders.ts
 * Meeting reminder system — runs via cron jobs in server.ts.
 *
 * Sends WhatsApp reminders for upcoming meetings:
 *   - Day before  (23–25h ahead): customer gets a reminder + cancellation offer
 *   - 2h before   (1h45m–2h15m):  customer gets a reminder; owner also gets one
 *
 * Uses meetings.reminder_day_sent / reminder_2h_sent / owner_reminder_2h_sent
 * boolean flags to ensure each reminder is sent exactly once.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { formatDateHebrew, formatTimeHebrew } from "./date-utils";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
    if (!_supabase) {
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    }
    return _supabase;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReminderMeeting {
    id: string;
    tenant_id: string;
    customer_phone: string;
    customer_name: string | null;
    start_time: string;
    end_time: string;
    reminder_day_sent: boolean;
    reminder_2h_sent: boolean;
    owner_reminder_2h_sent: boolean;
}

interface ReminderTenant {
    id: string;
    owner_phone: string | null;
    timezone: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeToJid(phone: string): string {
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("0") && digits.length === 10) {
        digits = "972" + digits.substring(1);
    }
    return `${digits}@s.whatsapp.net`;
}

// ─── Day-before reminders ─────────────────────────────────────────────────────

/**
 * Run every hour. Finds meetings 23–25 hours from now that haven't had
 * their day-before reminder sent yet.
 * Sends the customer a reminder + cancellation offer.
 */
export async function sendDayBeforeReminders(
    activeTenantIds: string[],
    sendMessage: (tenantId: string, jid: string, text: string) => Promise<void>
): Promise<void> {
    if (activeTenantIds.length === 0) return;

    const supabase = getSupabase();
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 3_600_000).toISOString();
    const windowEnd   = new Date(now.getTime() + 25 * 3_600_000).toISOString();

    for (const tenantId of activeTenantIds) {
        try {
            const { data: meetings } = await supabase
                .from("meetings")
                .select("id, tenant_id, customer_phone, customer_name, start_time, end_time, reminder_day_sent, reminder_2h_sent, owner_reminder_2h_sent")
                .eq("tenant_id", tenantId)
                .eq("status", "confirmed")
                .eq("reminder_day_sent", false)
                .gte("start_time", windowStart)
                .lte("start_time", windowEnd);

            if (!meetings || meetings.length === 0) continue;

            const { data: tenant } = await supabase
                .from("tenants")
                .select("id, owner_phone, timezone")
                .eq("id", tenantId)
                .single();

            const tz = (tenant as ReminderTenant | null)?.timezone ?? "Asia/Jerusalem";

            for (const meeting of meetings as ReminderMeeting[]) {
                try {
                    const customerJid = normalizeToJid(meeting.customer_phone);
                    const startDate = new Date(meeting.start_time);
                    const timeStr = formatTimeHebrew(startDate, tz);
                    const dateStr = startDate.toLocaleDateString("he-IL", {
                        timeZone: tz, weekday: "long", day: "numeric", month: "long",
                    });

                    const msg =
                        `📅 תזכורת: יש לך פגישה מחר!\n\n` +
                        `📆 ${dateStr}\n` +
                        `⏰ שעה: ${timeStr}\n\n` +
                        `כדי לבטל את הפגישה, השב: *ביטול פגישה*`;

                    // Mark flag before sending to prevent duplicate sends (race condition)
                    await supabase
                        .from("meetings")
                        .update({ reminder_day_sent: true })
                        .eq("id", meeting.id);

                    try {
                        await sendMessage(tenantId, customerJid, msg);
                    } catch (sendErr: any) {
                        // Rollback flag on send failure so we retry next cycle
                        await supabase
                            .from("meetings")
                            .update({ reminder_day_sent: false })
                            .eq("id", meeting.id);
                        throw sendErr;
                    }

                    console.log(`[${tenantId}] 📅 Day-before reminder sent to ${meeting.customer_phone} for meeting ${meeting.id}`);
                } catch (err: any) {
                    console.error(`[${tenantId}] ❌ Day-before reminder failed for meeting ${meeting.id}:`, err.message);
                }
            }
        } catch (err: any) {
            console.error(`[${tenantId}] Day-before reminder cron error:`, err.message);
        }
    }
}

// ─── 2h-before reminders ─────────────────────────────────────────────────────

/**
 * Run every 15 minutes. Finds meetings 1h45m–2h15m from now that haven't
 * had their 2h reminder sent yet.
 * Sends the customer a reminder; also notifies the owner.
 */
export async function sendTwoHourReminders(
    activeTenantIds: string[],
    sendMessage: (tenantId: string, jid: string, text: string) => Promise<void>
): Promise<void> {
    if (activeTenantIds.length === 0) return;

    const supabase = getSupabase();
    const now = new Date();
    const windowStart = new Date(now.getTime() + 105 * 60_000).toISOString(); // 1h45m
    const windowEnd   = new Date(now.getTime() + 135 * 60_000).toISOString(); // 2h15m

    for (const tenantId of activeTenantIds) {
        try {
            const { data: meetings } = await supabase
                .from("meetings")
                .select("id, tenant_id, customer_phone, customer_name, start_time, end_time, reminder_day_sent, reminder_2h_sent, owner_reminder_2h_sent")
                .eq("tenant_id", tenantId)
                .eq("status", "confirmed")
                .or("reminder_2h_sent.eq.false,owner_reminder_2h_sent.eq.false")
                .gte("start_time", windowStart)
                .lte("start_time", windowEnd);

            if (!meetings || meetings.length === 0) continue;

            const { data: tenant } = await supabase
                .from("tenants")
                .select("id, owner_phone, timezone")
                .eq("id", tenantId)
                .single();

            const tenantData = tenant as ReminderTenant | null;
            const tz = tenantData?.timezone ?? "Asia/Jerusalem";

            for (const meeting of meetings as ReminderMeeting[]) {
                const startDate = new Date(meeting.start_time);
                const timeStr = formatTimeHebrew(startDate, tz);

                // ── Customer reminder ──
                if (!meeting.reminder_2h_sent) {
                    try {
                        const customerJid = normalizeToJid(meeting.customer_phone);
                        const msg =
                            `⏰ תזכורת: יש לך פגישה בעוד שעתיים!\n\n` +
                            `🕐 שעה: ${timeStr}\n\n` +
                            `נתראה בקרוב! 😊`;

                        // Mark flag before sending to prevent duplicate sends
                        await supabase
                            .from("meetings")
                            .update({ reminder_2h_sent: true })
                            .eq("id", meeting.id);

                        try {
                            await sendMessage(tenantId, customerJid, msg);
                        } catch (sendErr: any) {
                            await supabase
                                .from("meetings")
                                .update({ reminder_2h_sent: false })
                                .eq("id", meeting.id);
                            throw sendErr;
                        }

                        console.log(`[${tenantId}] ⏰ 2h-before reminder sent to customer ${meeting.customer_phone}`);
                    } catch (err: any) {
                        console.error(`[${tenantId}] ❌ 2h customer reminder failed for ${meeting.id}:`, err.message);
                    }
                }

                // ── Owner reminder ──
                if (!meeting.owner_reminder_2h_sent && tenantData?.owner_phone) {
                    try {
                        const ownerJid = normalizeToJid(tenantData.owner_phone);
                        const customerName = meeting.customer_name || meeting.customer_phone;
                        const msg =
                            `⏰ תזכורת: פגישה בעוד שעתיים!\n\n` +
                            `👤 ${customerName}\n` +
                            `📞 ${meeting.customer_phone}\n` +
                            `🕐 שעה: ${timeStr}`;

                        // Mark flag before sending to prevent duplicate sends
                        await supabase
                            .from("meetings")
                            .update({ owner_reminder_2h_sent: true })
                            .eq("id", meeting.id);

                        try {
                            await sendMessage(tenantId, ownerJid, msg);
                        } catch (sendErr: any) {
                            await supabase
                                .from("meetings")
                                .update({ owner_reminder_2h_sent: false })
                                .eq("id", meeting.id);
                            throw sendErr;
                        }

                        console.log(`[${tenantId}] ⏰ 2h-before reminder sent to owner for meeting with ${customerName}`);
                    } catch (err: any) {
                        console.error(`[${tenantId}] ❌ 2h owner reminder failed for ${meeting.id}:`, err.message);
                    }
                }
            }
        } catch (err: any) {
            console.error(`[${tenantId}] 2h-reminder cron error:`, err.message);
        }
    }
}

// ─── Cancel meeting ───────────────────────────────────────────────────────────

/**
 * Cancel a meeting: mark it cancelled in DB + delete from calendar provider.
 * Returns true on success, false if meeting not found or already cancelled.
 */
export async function cancelMeeting(
    tenantId: string,
    meetingId: string,
    sendMessage: (tenantId: string, jid: string, text: string) => Promise<void>,
    ownerPhone: string | null,
    timezone = "Asia/Jerusalem"
): Promise<boolean> {
    const supabase = getSupabase();

    // Fetch the meeting
    const { data: meeting } = await supabase
        .from("meetings")
        .select("id, status, start_time, customer_name, customer_phone, calendar_event_id, calendar_provider")
        .eq("id", meetingId)
        .eq("tenant_id", tenantId)
        .single();

    if (!meeting || meeting.status !== "confirmed") return false;

    // Mark cancelled
    const { error: cancelError } = await supabase
        .from("meetings")
        .update({ status: "cancelled" })
        .eq("id", meetingId);

    if (cancelError) {
        console.error(`[${tenantId}] ❌ Failed to cancel meeting ${meetingId}:`, cancelError.message);
        return false;
    }

    console.log(`[${tenantId}] 🗑️ Meeting ${meetingId} cancelled`);

    // Delete from calendar provider if linked
    if (meeting.calendar_event_id && meeting.calendar_provider) {
        try {
            const { getCalendarProvider } = await import("./calendar-providers/index");
            const providerResult = await getCalendarProvider(tenantId);
            if (providerResult) {
                await providerResult.provider.deleteEvent(tenantId, meeting.calendar_event_id);
                console.log(`[${tenantId}] 🗓️ Calendar event ${meeting.calendar_event_id} deleted from ${meeting.calendar_provider}`);
            }
        } catch (err: any) {
            // Non-fatal — meeting is already cancelled in DB
            console.error(`[${tenantId}] ⚠️ Calendar delete failed (non-fatal):`, err.message);
        }
    }

    // Notify owner
    if (ownerPhone) {
        try {
            const ownerJid = normalizeToJid(ownerPhone);
            const startDate = new Date(meeting.start_time);
            const timeStr = formatTimeHebrew(startDate, timezone);
            const customerName = meeting.customer_name || meeting.customer_phone;
            await sendMessage(
                tenantId,
                ownerJid,
                `🗑️ פגישה בוטלה\n\n👤 ${customerName}\n🕐 ${timeStr}\n\nהלקוח ביטל את הפגישה.`
            );
        } catch (err: any) {
            console.error(`[${tenantId}] ❌ Failed to notify owner of cancellation:`, err.message);
        }
    }

    return true;
}
