"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Calendar, Clock, Globe, Plus, X, CheckCircle2, Trash2, Save, Link2, Link2Off } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type DaySlot = { id: string; start_time: string; end_time: string };
type WeeklyAvailability = Record<number, DaySlot[]>;

interface MeetingSettings {
    scheduling_enabled: boolean;
    meeting_duration: number;
    buffer_between: number;
    timezone: string;
    min_notice_hours: number;
    booking_window_days: number;
    meeting_label: string;
}

interface Meeting {
    id: string;
    customer_name: string | null;
    customer_phone: string;
    start_time: string;
    meeting_type: string | null;
    status: string;
}

interface ProviderIntegration {
    connected: boolean;
    calendar_name: string | null;
}

type CalendarIntegrations = Record<string, ProviderIntegration>;

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const DAY_LABELS: Record<number, string> = {
    0: "ראשון",
    1: "שני",
    2: "שלישי",
    3: "רביעי",
    4: "חמישי",
    5: "שישי",
    6: "שבת",
};

const TIMEZONES = ["Asia/Jerusalem", "UTC", "Europe/London", "America/New_York"];

const DEFAULT_SETTINGS: MeetingSettings = {
    scheduling_enabled: false,
    meeting_duration: 30,
    buffer_between: 10,
    timezone: "Asia/Jerusalem",
    min_notice_hours: 2,
    booking_window_days: 14,
    meeting_label: "פגישה",
};

/* ------------------------------------------------------------------ */
/* Helper: generate a stable local id                                 */
/* ------------------------------------------------------------------ */
function uid() {
    return `local-${crypto.randomUUID()}`;
}

/* ------------------------------------------------------------------ */
/* CalendarTab                                                         */
/* ------------------------------------------------------------------ */

const CalendarTab = React.memo(function CalendarTab({ tenant }: { tenant: { id: string } }) {
    /* ---- Meeting settings ---- */
    const [settings, setSettings] = useState<MeetingSettings>(DEFAULT_SETTINGS);
    const [settingsLoading, setSettingsLoading] = useState(true);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);

    /* ---- Availability ---- */
    const [availability, setAvailability] = useState<WeeklyAvailability>({});
    const [availLoading, setAvailLoading] = useState(true);
    const [weekOffset, setWeekOffset] = useState(0); // 0=current week, max 3

    // Which day's inline form is open { dayIndex -> { start, end } }
    const [addingDay, setAddingDay] = useState<Record<number, { start: string; end: string }>>({});

    /* ---- Calendar integrations (multi-provider) ---- */
    const defaultIntegrations: CalendarIntegrations = {
        google: { connected: false, calendar_name: null },
        outlook: { connected: false, calendar_name: null },
        calendly: { connected: false, calendar_name: null },
        apple: { connected: false, calendar_name: null },
    };
    const [calIntegrations, setCalIntegrations] = useState<CalendarIntegrations>(defaultIntegrations);
    const [calLoading, setCalLoading] = useState(true);
    const [calendlyUrl, setCalendlyUrl] = useState("");
    const [calendlySaving, setCalendlySaving] = useState(false);

    /* ---- Apple Calendar ---- */
    const [appleId, setAppleId] = useState("");
    const [appleAppPassword, setAppleAppPassword] = useState("");
    const [appleSaving, setAppleSaving] = useState(false);

    /* ---- Upcoming meetings ---- */
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [meetingsLoading, setMeetingsLoading] = useState(true);
    const [meetingsError, setMeetingsError] = useState<string | null>(null);

    /* ---- Toast ---- */
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

    const showToast = (message: string, type: "success" | "error") => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    /* ---------------------------------------------------------------- */
    /* Fetch: meeting settings                                           */
    /* ---------------------------------------------------------------- */
    const fetchSettings = useCallback(async () => {
        if (!tenant?.id) return;
        setSettingsLoading(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/meeting-settings`);
            if (res.ok) {
                const data = await res.json();
                setSettings({ ...DEFAULT_SETTINGS, ...data });
            }
        } catch {
            // silently fall back to defaults
        } finally {
            setSettingsLoading(false);
        }
    }, [tenant?.id]);

    /* ---------------------------------------------------------------- */
    /* Fetch: weekly availability                                        */
    /* ---------------------------------------------------------------- */
    const fetchAvailability = useCallback(async () => {
        if (!tenant?.id) return;
        setAvailLoading(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/availability`);
            if (res.ok) {
                const data = await res.json();
                // data.rules: { "0": [...], "1": [...], ... }
                const parsed: WeeklyAvailability = {};
                for (let d = 0; d <= 6; d++) {
                    parsed[d] = (data.rules?.[String(d)] ?? []).map((s: any) => ({
                        id: s.id ?? uid(),
                        start_time: s.start_time,
                        end_time: s.end_time,
                    }));
                }
                setAvailability(parsed);
            }
        } catch {
            // silently fall back to empty
        } finally {
            setAvailLoading(false);
        }
    }, [tenant?.id]);

    /* ---------------------------------------------------------------- */
    /* Fetch: Calendar integrations (all providers)                      */
    /* ---------------------------------------------------------------- */
    const fetchCalIntegration = useCallback(async () => {
        if (!tenant?.id) return;
        setCalLoading(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/calendar-integration`);
            if (res.ok) {
                const data = await res.json();
                // Support both legacy single-provider and new multi-provider response
                if (data && typeof data.google !== "undefined") {
                    setCalIntegrations(prev => ({ ...prev, ...data }));
                } else if (data && typeof data.connected === "boolean") {
                    // Legacy: single google integration
                    setCalIntegrations(prev => ({ ...prev, google: { connected: data.connected, calendar_name: data.calendar_name } }));
                }
            }
        } catch {
            // silently ignore
        } finally {
            setCalLoading(false);
        }
    }, [tenant?.id]);

    /* ---------------------------------------------------------------- */
    /* Fetch: upcoming meetings                                          */
    /* ---------------------------------------------------------------- */
    const fetchMeetings = useCallback(async () => {
        if (!tenant?.id) return;
        setMeetingsLoading(true);
        setMeetingsError(null);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/meetings?status=confirmed&limit=20`);
            if (!res.ok) throw new Error("שגיאה בטעינת הפגישות");
            const data = await res.json();
            setMeetings(Array.isArray(data) ? data : data.meetings ?? []);
        } catch {
            setMeetingsError("שגיאה בטעינת הפגישות");
        } finally {
            setMeetingsLoading(false);
        }
    }, [tenant?.id]);

    /* ---------------------------------------------------------------- */
    /* Mount                                                             */
    /* ---------------------------------------------------------------- */
    useEffect(() => {
        fetchSettings();
        fetchAvailability();
        fetchCalIntegration();
        fetchMeetings();
    }, [fetchSettings, fetchAvailability, fetchCalIntegration, fetchMeetings]);

    /* ---------------------------------------------------------------- */
    /* Save: scheduling toggle                                           */
    /* ---------------------------------------------------------------- */
    const handleToggleScheduling = async () => {
        const next = !settings.scheduling_enabled;
        setSettings(prev => ({ ...prev, scheduling_enabled: next }));
        try {
            await fetch(`/api/tenants/${tenant.id}/meeting-settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scheduling_enabled: next }),
            });
        } catch {
            setSettings(prev => ({ ...prev, scheduling_enabled: !next }));
            showToast("שגיאה בשמירה", "error");
        }
    };

    /* ---------------------------------------------------------------- */
    /* Save: meeting settings                                            */
    /* ---------------------------------------------------------------- */
    const handleSaveSettings = async () => {
        setSettingsSaving(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/meeting-settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings),
            });
            if (!res.ok) throw new Error();
            setSettingsSaved(true);
            setTimeout(() => setSettingsSaved(false), 2500);
        } catch {
            showToast("שגיאה בשמירת ההגדרות", "error");
        } finally {
            setSettingsSaving(false);
        }
    };

    /* ---------------------------------------------------------------- */
    /* Availability: save day slots to API                              */
    /* ---------------------------------------------------------------- */
    const saveAvailabilityDay = async (day: number, slots: DaySlot[]) => {
        const res = await fetch(`/api/tenants/${tenant.id}/availability`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ day_of_week: day, slots }),
        });
        if (!res.ok) throw new Error("Failed to save availability");
    };

    /* ---------------------------------------------------------------- */
    /* Availability: add slot                                            */
    /* ---------------------------------------------------------------- */
    const handleAddSlot = async (day: number) => {
        const form = addingDay[day];
        if (!form || !form.start || !form.end) return;

        const newSlot: DaySlot = { id: uid(), start_time: form.start, end_time: form.end };
        const previousSlots = availability[day] ?? [];
        const updatedSlots = [...previousSlots, newSlot];

        // Optimistic update
        setAvailability(prev => ({ ...prev, [day]: updatedSlots }));
        setAddingDay(prev => {
            const next = { ...prev };
            delete next[day];
            return next;
        });

        try {
            await saveAvailabilityDay(day, updatedSlots);
        } catch {
            // Revert using captured previousSlots to avoid stale closure
            setAvailability(prev => ({ ...prev, [day]: previousSlots }));
            showToast("שגיאה בשמירת שעות הזמינות", "error");
        }
    };

    /* ---------------------------------------------------------------- */
    /* Availability: delete slot                                         */
    /* ---------------------------------------------------------------- */
    const handleDeleteSlot = async (day: number, slotId: string) => {
        const prevSlots = availability[day] ?? [];
        const updatedSlots = prevSlots.filter(s => s.id !== slotId);

        // Optimistic update
        setAvailability(prev => ({ ...prev, [day]: updatedSlots }));

        try {
            await saveAvailabilityDay(day, updatedSlots);
        } catch {
            setAvailability(prev => ({ ...prev, [day]: prevSlots }));
            showToast("שגיאה במחיקת שעה", "error");
        }
    };

    /* ---------------------------------------------------------------- */
    /* Calendar: disconnect provider                                     */
    /* ---------------------------------------------------------------- */
    const handleDisconnectCalendar = async (provider: string) => {
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/calendar-integration?provider=${provider}`, { method: "DELETE" });
            if (!res.ok) throw new Error();
            setCalIntegrations(prev => ({ ...prev, [provider]: { connected: false, calendar_name: null } }));
            showToast(`${provider} נותק`, "success");
        } catch {
            showToast(`שגיאה בניתוק ${provider}`, "error");
        }
    };

    /* ---------------------------------------------------------------- */
    /* Calendar: save Calendly webhook URL                               */
    /* ---------------------------------------------------------------- */
    const handleSaveCalendly = async () => {
        if (!calendlyUrl.trim()) return;
        setCalendlySaving(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/calendar-integration/calendly`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ webhook_url: calendlyUrl.trim() }),
            });
            if (!res.ok) throw new Error();
            setCalIntegrations(prev => ({ ...prev, calendly: { connected: true, calendar_name: "Calendly Webhook" } }));
            setCalendlyUrl("");
            showToast("Calendly חובר בהצלחה", "success");
        } catch {
            showToast("שגיאה בחיבור Calendly", "error");
        } finally {
            setCalendlySaving(false);
        }
    };

    /* ---------------------------------------------------------------- */
    /* Calendar: connect Apple Calendar (CalDAV)                         */
    /* ---------------------------------------------------------------- */
    const handleConnectApple = async () => {
        if (!appleId.trim() || !appleAppPassword.trim()) return;
        setAppleSaving(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/calendar-integration/apple`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apple_id: appleId.trim(), app_password: appleAppPassword.trim() }),
            });
            if (!res.ok) throw new Error();
            setCalIntegrations(prev => ({ ...prev, apple: { connected: true, calendar_name: appleId.trim() } }));
            setAppleId("");
            setAppleAppPassword("");
            showToast("Apple Calendar חובר בהצלחה", "success");
        } catch {
            showToast("שגיאה בחיבור Apple Calendar — בדוק את הפרטים", "error");
        } finally {
            setAppleSaving(false);
        }
    };

    /* ---------------------------------------------------------------- */
    /* Meeting: cancel                                                   */
    /* ---------------------------------------------------------------- */
    const handleCancelMeeting = async (meetingId: string) => {
        // Optimistic remove from list
        setMeetings(prev => prev.filter(m => m.id !== meetingId));
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/meetings/${meetingId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "cancelled" }),
            });
            if (!res.ok) throw new Error();
            showToast("הפגישה בוטלה", "success");
        } catch {
            fetchMeetings(); // Revert
            showToast("שגיאה בביטול הפגישה", "error");
        }
    };

    /* ---------------------------------------------------------------- */
    /* Compute dates for the selected week (weekOffset 0=current week) */
    /* ---------------------------------------------------------------- */
    const { nextDates, weekLabel } = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Start of current week (Sunday)
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);

        const result: Record<number, string> = {};
        for (let d = 0; d <= 6; d++) {
            const target = new Date(startOfWeek);
            target.setDate(startOfWeek.getDate() + d);
            const dd = String(target.getDate()).padStart(2, "0");
            const mm = String(target.getMonth() + 1).padStart(2, "0");
            result[d] = `${dd}/${mm}`;
        }

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
        const label = weekOffset === 0 ? `השבוע (${fmt(startOfWeek)}–${fmt(endOfWeek)})` : `${fmt(startOfWeek)}–${fmt(endOfWeek)}`;

        return { nextDates: result, weekLabel: label };
    }, [weekOffset]);

    /* ---------------------------------------------------------------- */
    /* Render                                                            */
    /* ---------------------------------------------------------------- */
    return (
        <div className="w-full max-w-5xl mx-auto space-y-6 pb-10" dir="rtl">
            {/* Toast */}
            {toast && (
                <div
                    className={`fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-xl text-sm font-medium transition-all ${
                        toast.type === "success"
                            ? "bg-emerald-900/90 border-emerald-500/40 text-emerald-100"
                            : "bg-red-900/90 border-red-500/40 text-red-100"
                    }`}
                >
                    <span>{toast.type === "success" ? "✅" : "❌"}</span>
                    <span>{toast.message}</span>
                </div>
            )}

            {/* ── Section 1: Header ── */}
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-violet-600/20 border border-violet-500/30">
                    <Calendar className="w-6 h-6 text-violet-400" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-white">לוח שנה ופגישות</h2>
                    <p className="text-sm text-neutral-400 mt-0.5">
                        הגדר שעות זמינות, חבר יומן חיצוני, וקבע פגישות אוטומטית דרך הבוט
                    </p>
                </div>
            </div>

            {/* ── Section 2: Scheduling Toggle ── */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <p className="text-white font-semibold text-base">קביעת פגישות אוטומטית</p>
                        <p className="text-sm text-neutral-400 mt-0.5">
                            {settings.scheduling_enabled ? "הבוט יציע ויקבע פגישות בשיחות" : "תכונת הפגישות כבויה כרגע"}
                        </p>
                    </div>
                    <button
                        onClick={handleToggleScheduling}
                        disabled={settingsLoading}
                        className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 ${
                            settings.scheduling_enabled ? "bg-violet-600" : "bg-white/10"
                        }`}
                        aria-checked={settings.scheduling_enabled}
                        role="switch"
                    >
                        <span
                            className={`inline-block h-6 w-6 rounded-full bg-white shadow-lg transform transition-transform duration-200 ${
                                settings.scheduling_enabled ? "translate-x-0" : "-translate-x-6"
                            }`}
                        />
                    </button>
                </div>
            </div>

            {/* ── Section 3: Meeting Settings ── */}
            {settings.scheduling_enabled && (
                <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                    <h3 className="text-white font-semibold mb-5 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-violet-400" />
                        הגדרות פגישה
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Meeting duration */}
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1.5">משך פגישה</label>
                            <select
                                value={settings.meeting_duration}
                                onChange={e => setSettings(prev => ({ ...prev, meeting_duration: Number(e.target.value) }))}
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm"
                            >
                                {[15, 30, 45, 60, 90].map(v => (
                                    <option key={v} value={v}>{v} דקות</option>
                                ))}
                            </select>
                        </div>

                        {/* Buffer between */}
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1.5">באפר בין פגישות</label>
                            <select
                                value={settings.buffer_between}
                                onChange={e => setSettings(prev => ({ ...prev, buffer_between: Number(e.target.value) }))}
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm"
                            >
                                {[0, 5, 10, 15].map(v => (
                                    <option key={v} value={v}>{v} דקות</option>
                                ))}
                            </select>
                        </div>

                        {/* Timezone */}
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1.5">אזור זמן</label>
                            <select
                                value={settings.timezone}
                                onChange={e => setSettings(prev => ({ ...prev, timezone: e.target.value }))}
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm"
                            >
                                {TIMEZONES.map(tz => (
                                    <option key={tz} value={tz}>{tz}</option>
                                ))}
                            </select>
                        </div>

                        {/* Min notice */}
                        <div>
                            <label className="block text-xs text-neutral-400 mb-0.5">זמן מינימלי לפני פגישה</label>
                            <p className="text-xs text-neutral-600 mb-1.5">כמה שעות מראש לכל הפחות ניתן לקבוע</p>
                            <select
                                value={settings.min_notice_hours}
                                onChange={e => setSettings(prev => ({ ...prev, min_notice_hours: Number(e.target.value) }))}
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm"
                            >
                                {[1, 2, 4, 6, 12, 24].map(v => (
                                    <option key={v} value={v}>{v} שעות לפני</option>
                                ))}
                            </select>
                        </div>

                        {/* Booking window */}
                        <div>
                            <label className="block text-xs text-neutral-400 mb-0.5">טווח הזמנה מראש</label>
                            <p className="text-xs text-neutral-600 mb-1.5">עד כמה קדימה ניתן לקבוע</p>
                            <select
                                value={settings.booking_window_days}
                                onChange={e => setSettings(prev => ({ ...prev, booking_window_days: Number(e.target.value) }))}
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm"
                            >
                                <option value={0}>ללא הגבלה (כל עוד יש מקום)</option>
                                {[7, 14, 30, 60].map(v => (
                                    <option key={v} value={v}>{v} יום קדימה</option>
                                ))}
                            </select>
                        </div>

                        {/* Meeting label */}
                        <div>
                            <label className="block text-xs text-neutral-400 mb-0.5">שם הפגישה ביומן</label>
                            <p className="text-xs text-neutral-600 mb-1.5">יופיע ביומן כ: &quot;{settings.meeting_label} - שם הלקוח&quot;</p>
                            <input
                                type="text"
                                value={settings.meeting_label}
                                onChange={e => setSettings(prev => ({ ...prev, meeting_label: e.target.value }))}
                                placeholder="פגישה"
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm"
                            />
                        </div>
                    </div>

                    <div className="mt-5 flex justify-start">
                        <button
                            onClick={handleSaveSettings}
                            disabled={settingsSaving}
                            className="bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 disabled:opacity-60 transition-colors"
                        >
                            {settingsSaved ? (
                                <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    נשמר!
                                </>
                            ) : (
                                <>
                                    <Save className="w-4 h-4" />
                                    {settingsSaving ? "שומר..." : "שמור הגדרות"}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Section 4: Weekly Availability Scheduler ── */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                    <h3 className="text-white font-semibold flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-violet-400" />
                        שעות זמינות שבועיות
                    </h3>
                    {/* Week navigation */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setWeekOffset(prev => Math.max(0, prev - 1))}
                            disabled={weekOffset === 0}
                            className="p-1.5 rounded-lg border border-white/10 text-neutral-400 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            aria-label="שבוע קודם"
                        >
                            <span className="text-sm">›</span>
                        </button>
                        <span className="text-xs text-neutral-400 min-w-36 text-center">{weekLabel}</span>
                        <button
                            onClick={() => setWeekOffset(prev => Math.min(3, prev + 1))}
                            disabled={weekOffset === 3}
                            className="p-1.5 rounded-lg border border-white/10 text-neutral-400 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            aria-label="שבוע הבא"
                        >
                            <span className="text-sm">‹</span>
                        </button>
                    </div>
                </div>

                {availLoading ? (
                    <div className="flex items-center gap-2 text-neutral-400 text-sm py-4">
                        <div className="w-4 h-4 border-2 border-violet-500/40 border-t-violet-500 rounded-full animate-spin" />
                        טוען שעות זמינות...
                    </div>
                ) : (
                    <div className="space-y-3">
                        {[0, 1, 2, 3, 4, 5, 6].map(day => {
                            const slots = availability[day] ?? [];
                            const isAdding = !!addingDay[day];
                            const form = addingDay[day] ?? { start: "09:00", end: "17:00" };

                            return (
                                <div
                                    key={day}
                                    className="flex flex-col sm:flex-row sm:items-start gap-3 py-3 border-b border-white/5 last:border-0"
                                >
                                    {/* Day label */}
                                    <div className="w-16 shrink-0 pt-1 flex flex-col gap-0.5">
                                        <span className="text-sm font-medium text-neutral-300">{DAY_LABELS[day]}</span>
                                        <span className="text-xs text-neutral-500">{nextDates[day]}</span>
                                    </div>

                                    {/* Slots + controls */}
                                    <div className="flex-1 flex flex-wrap gap-2 items-start">
                                        {slots.length === 0 && !isAdding && (
                                            <span className="text-xs text-neutral-500 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
                                                לא פעיל
                                            </span>
                                        )}

                                        {slots.map(slot => (
                                            <div
                                                key={slot.id}
                                                className="flex items-center gap-1.5 bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs px-3 py-1.5 rounded-full"
                                            >
                                                <span>{slot.start_time}–{slot.end_time}</span>
                                                <button
                                                    onClick={() => handleDeleteSlot(day, slot.id)}
                                                    className="text-violet-400 hover:text-red-400 transition-colors ml-0.5"
                                                    aria-label="מחק שעה"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}

                                        {/* Inline time picker */}
                                        {isAdding && (
                                            <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
                                                <input
                                                    type="time"
                                                    value={form.start}
                                                    onChange={e =>
                                                        setAddingDay(prev => ({
                                                            ...prev,
                                                            [day]: { ...form, start: e.target.value },
                                                        }))
                                                    }
                                                    className="bg-transparent text-white text-xs focus:outline-none w-20"
                                                />
                                                <span className="text-neutral-500 text-xs">–</span>
                                                <input
                                                    type="time"
                                                    value={form.end}
                                                    onChange={e =>
                                                        setAddingDay(prev => ({
                                                            ...prev,
                                                            [day]: { ...form, end: e.target.value },
                                                        }))
                                                    }
                                                    className="bg-transparent text-white text-xs focus:outline-none w-20"
                                                />
                                                <button
                                                    onClick={() => handleAddSlot(day)}
                                                    className="bg-violet-600 hover:bg-violet-500 text-white text-xs px-2.5 py-1 rounded-lg transition-colors"
                                                >
                                                    הוסף
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        setAddingDay(prev => {
                                                            const next = { ...prev };
                                                            delete next[day];
                                                            return next;
                                                        })
                                                    }
                                                    className="text-neutral-500 hover:text-neutral-300 transition-colors"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}

                                        {!isAdding && (
                                            <button
                                                onClick={() =>
                                                    setAddingDay(prev => ({
                                                        ...prev,
                                                        [day]: { start: "09:00", end: "17:00" },
                                                    }))
                                                }
                                                className="flex items-center gap-1 text-xs text-neutral-400 hover:text-violet-400 border border-white/10 hover:border-violet-500/30 px-2.5 py-1 rounded-full transition-colors"
                                            >
                                                <Plus className="w-3 h-3" />
                                                הוסף שעות
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Section 5: Calendar Integrations ── */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-violet-400" />
                    חיבור יומנים חיצוניים
                </h3>
                <p className="text-xs text-neutral-500 mb-5">
                    חבר יומן חיצוני כדי לסנכרן פגישות אוטומטית
                </p>

                {calLoading ? (
                    <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <div className="w-4 h-4 border-2 border-violet-500/40 border-t-violet-500 rounded-full animate-spin" />
                        בודק חיבורים...
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* Google */}
                        <div className="flex items-center gap-4 flex-wrap py-3 border-b border-white/5">
                            <div className="flex items-center gap-2.5 w-36 shrink-0">
                                <span className="text-xl leading-none">🔵</span>
                                <span className="text-sm font-medium text-neutral-200">Google Calendar</span>
                            </div>
                            {calIntegrations.google?.connected ? (
                                <>
                                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-xl text-xs">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {calIntegrations.google.calendar_name ?? "My Calendar"}
                                    </div>
                                    <button
                                        onClick={() => handleDisconnectCalendar("google")}
                                        className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-xl transition-colors"
                                    >
                                        <Link2Off className="w-3.5 h-3.5" />
                                        נתק
                                    </button>
                                </>
                            ) : (
                                <a
                                    href={`/api/oauth/google?tenantId=${tenant.id}`}
                                    className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 rounded-xl font-medium text-xs transition-colors"
                                >
                                    <Link2 className="w-3.5 h-3.5" />
                                    חבר
                                </a>
                            )}
                        </div>

                        {/* Outlook */}
                        <div className="flex items-center gap-4 flex-wrap py-3 border-b border-white/5">
                            <div className="flex items-center gap-2.5 w-36 shrink-0">
                                <span className="text-xl leading-none">🟦</span>
                                <span className="text-sm font-medium text-neutral-200">Outlook Calendar</span>
                            </div>
                            {calIntegrations.outlook?.connected ? (
                                <>
                                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-xl text-xs">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {calIntegrations.outlook.calendar_name ?? "Outlook Calendar"}
                                    </div>
                                    <button
                                        onClick={() => handleDisconnectCalendar("outlook")}
                                        className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-xl transition-colors"
                                    >
                                        <Link2Off className="w-3.5 h-3.5" />
                                        נתק
                                    </button>
                                </>
                            ) : (
                                <a
                                    href={`/api/oauth/outlook?tenantId=${tenant.id}`}
                                    className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 rounded-xl font-medium text-xs transition-colors"
                                >
                                    <Link2 className="w-3.5 h-3.5" />
                                    חבר
                                </a>
                            )}
                        </div>

                        {/* Calendly */}
                        <div className="flex items-start gap-4 flex-wrap py-3 border-b border-white/5">
                            <div className="flex items-center gap-2.5 w-36 shrink-0 pt-1">
                                <span className="text-xl leading-none">🟢</span>
                                <span className="text-sm font-medium text-neutral-200">Calendly</span>
                            </div>
                            {calIntegrations.calendly?.connected ? (
                                <div className="flex items-center gap-3 flex-wrap">
                                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-xl text-xs">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {calIntegrations.calendly.calendar_name ?? "Calendly Webhook"}
                                    </div>
                                    <button
                                        onClick={() => handleDisconnectCalendar("calendly")}
                                        className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-xl transition-colors"
                                    >
                                        <Link2Off className="w-3.5 h-3.5" />
                                        נתק
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                                    <input
                                        type="url"
                                        value={calendlyUrl}
                                        onChange={e => setCalendlyUrl(e.target.value)}
                                        placeholder="הדבק Calendly Webhook URL..."
                                        dir="ltr"
                                        className="flex-1 min-w-48 bg-black/40 border border-white/10 rounded-xl py-1.5 px-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-xs placeholder:text-neutral-600"
                                    />
                                    <button
                                        onClick={handleSaveCalendly}
                                        disabled={calendlySaving || !calendlyUrl.trim()}
                                        className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-xl font-medium text-xs transition-colors"
                                    >
                                        <Save className="w-3.5 h-3.5" />
                                        {calendlySaving ? "שומר..." : "שמור"}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Apple */}
                        <div className="flex items-start gap-4 flex-wrap py-3">
                            <div className="flex items-center gap-2.5 w-36 shrink-0 pt-1">
                                <span className="text-xl leading-none">🍎</span>
                                <span className="text-sm font-medium text-neutral-200">Apple Calendar</span>
                            </div>
                            {calIntegrations.apple?.connected ? (
                                <div className="flex items-center gap-3 flex-wrap">
                                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-xl text-xs">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {calIntegrations.apple.calendar_name ?? "Apple Calendar"}
                                    </div>
                                    <button
                                        onClick={() => handleDisconnectCalendar("apple")}
                                        className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-xl transition-colors"
                                    >
                                        <Link2Off className="w-3.5 h-3.5" />
                                        נתק
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3 flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <input
                                            type="email"
                                            value={appleId}
                                            onChange={e => setAppleId(e.target.value)}
                                            placeholder="Apple ID (אימייל)"
                                            dir="ltr"
                                            className="flex-1 min-w-48 bg-black/40 border border-white/10 rounded-xl py-1.5 px-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-xs placeholder:text-neutral-600"
                                        />
                                        <input
                                            type="password"
                                            value={appleAppPassword}
                                            onChange={e => setAppleAppPassword(e.target.value)}
                                            placeholder="סיסמה ייעודית לאפליקציה"
                                            dir="ltr"
                                            className="flex-1 min-w-48 bg-black/40 border border-white/10 rounded-xl py-1.5 px-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-xs placeholder:text-neutral-600"
                                        />
                                        <button
                                            onClick={handleConnectApple}
                                            disabled={appleSaving || !appleId.trim() || !appleAppPassword.trim()}
                                            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-xl font-medium text-xs transition-colors"
                                        >
                                            <Link2 className="w-3.5 h-3.5" />
                                            {appleSaving ? "מחבר..." : "חבר"}
                                        </button>
                                    </div>
                                    <div className="text-[11px] text-neutral-500 leading-relaxed bg-white/[0.02] border border-white/5 rounded-xl p-3" dir="rtl">
                                        <p className="font-medium text-neutral-400 mb-1">כדי לחבר את יומן Apple, צריך ליצור סיסמה ייעודית לאפליקציה:</p>
                                        <ol className="list-decimal list-inside space-y-0.5 mr-1">
                                            <li>היכנס ל-<span dir="ltr" className="text-violet-400">account.apple.com</span></li>
                                            <li>{`לחץ על 'כניסה ואבטחה' ← 'סיסמאות ייעודיות לאפליקציות'`}</li>
                                            <li>צור סיסמה חדשה והעתק אותה לכאן</li>
                                        </ol>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Section 6: Upcoming Meetings ── */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <h3 className="text-white font-semibold mb-5 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-violet-400" />
                    פגישות קרובות
                </h3>

                {meetingsLoading ? (
                    <div className="flex items-center gap-2 text-neutral-400 text-sm py-4">
                        <div className="w-4 h-4 border-2 border-violet-500/40 border-t-violet-500 rounded-full animate-spin" />
                        טוען פגישות...
                    </div>
                ) : meetingsError ? (
                    <p className="text-red-400 text-sm">{meetingsError}</p>
                ) : meetings.length === 0 ? (
                    <div className="text-center py-10 text-neutral-500 text-sm">
                        <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p>אין פגישות קרובות — הבוט יוסיף פגישות כאן אוטומטית</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-sm min-w-[540px]">
                            <thead>
                                <tr className="text-right text-xs text-neutral-500 border-b border-white/5">
                                    <th className="pb-3 pr-2 font-medium">שם לקוח</th>
                                    <th className="pb-3 pr-2 font-medium">טלפון</th>
                                    <th className="pb-3 pr-2 font-medium">תאריך ושעה</th>
                                    <th className="pb-3 pr-2 font-medium">סוג</th>
                                    <th className="pb-3 font-medium">פעולות</th>
                                </tr>
                            </thead>
                            <tbody>
                                {meetings.map(meeting => (
                                    <tr
                                        key={meeting.id}
                                        className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                                    >
                                        <td className="py-3 pr-2 text-neutral-200">
                                            {meeting.customer_name ?? "—"}
                                        </td>
                                        <td className="py-3 pr-2 text-neutral-400 font-mono text-xs">
                                            {meeting.customer_phone}
                                        </td>
                                        <td className="py-3 pr-2 text-neutral-300">
                                            {new Date(meeting.start_time).toLocaleString("he-IL")}
                                        </td>
                                        <td className="py-3 pr-2 text-neutral-400">
                                            {meeting.meeting_type ?? settings.meeting_label}
                                        </td>
                                        <td className="py-3">
                                            <button
                                                onClick={() => handleCancelMeeting(meeting.id)}
                                                className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-2.5 py-1 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                ביטול
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
});

export { CalendarTab };
