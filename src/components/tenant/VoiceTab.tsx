"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Phone, PhoneCall, PhoneOff, Mic, Volume2, Save, Loader2, Clock, User, Play, Pause } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface VoiceConfig {
    elevenlabs_agent_id: string | null;
    elevenlabs_voice_id: string | null;
    voice_settings: { stability: number; similarity_boost: number; speed: number } | null;
    voice_first_message: string | null;
    voice_custom_instructions: string | null;
    twilio_phone_number: string | null;
    voice_enabled: boolean;
}

interface VoiceCatalogEntry {
    id: string;
    elevenlabs_voice_id: string;
    name: string;
    display_name_he: string;
    gender: string;
    preview_url: string | null;
    is_default: boolean;
}

interface CallLog {
    id: string;
    caller_phone: string | null;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    status: string;
    summary: string | null;
}

/* ------------------------------------------------------------------ */
/* VoiceTab                                                            */
/* ------------------------------------------------------------------ */

const VoiceTab = React.memo(function VoiceTab({ tenantId }: { tenantId: string }) {
    const [config, setConfig] = useState<VoiceConfig | null>(null);
    const [voices, setVoices] = useState<VoiceCatalogEntry[]>([]);
    const [callLogs, setCallLogs] = useState<CallLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [setupLoading, setSetupLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Editable fields
    const [voiceId, setVoiceId] = useState<string>("");
    const [firstMessage, setFirstMessage] = useState("");
    const [customInstructions, setCustomInstructions] = useState("");
    const [voiceEnabled, setVoiceEnabled] = useState(false);

    // Audio preview
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

    /* ---- Fetch config + catalog + call logs ---- */
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [configRes, catalogRes] = await Promise.all([
                fetch(`/api/tenants/${tenantId}/voice`),
                fetch(`/api/tenants/${tenantId}/voice/catalog`),
            ]);

            if (configRes.ok) {
                const { data } = await configRes.json();
                setConfig(data);
                setVoiceId(data.elevenlabs_voice_id || "");
                setFirstMessage(data.voice_first_message || "");
                setCustomInstructions(data.voice_custom_instructions || "");
                setVoiceEnabled(data.voice_enabled || false);
            }

            if (catalogRes.ok) {
                const { data } = await catalogRes.json();
                setVoices(data || []);
            }

            // Fetch call logs
            const supabase = createClient();
            const { data: logs } = await supabase
                .from("call_logs")
                .select("*")
                .eq("tenant_id", tenantId)
                .order("started_at", { ascending: false })
                .limit(20);
            setCallLogs(logs || []);
        } catch {
            setError("שגיאה בטעינת נתונים");
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    /* ---- Setup agent ---- */
    const handleSetup = useCallback(async () => {
        setSetupLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/voice/setup`, {
                method: "POST",
            });
            if (!res.ok) {
                const { error: msg } = await res.json();
                throw new Error(msg || "Setup failed");
            }
            setSuccess("הסוכן הקולי הוקם בהצלחה!");
            await fetchData();
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בהקמת הסוכן");
        } finally {
            setSetupLoading(false);
        }
    }, [tenantId, fetchData]);

    /* ---- Save settings ---- */
    const handleSave = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/voice`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    elevenlabs_voice_id: voiceId || null,
                    voice_first_message: firstMessage || null,
                    voice_custom_instructions: customInstructions || null,
                    voice_enabled: voiceEnabled,
                }),
            });
            if (!res.ok) {
                const { error: msg } = await res.json();
                throw new Error(msg || "Save failed");
            }
            const { data } = await res.json();
            setConfig(data);
            setSuccess("ההגדרות נשמרו בהצלחה!");
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    }, [tenantId, voiceId, firstMessage, customInstructions, voiceEnabled]);

    /* ---- Voice preview ---- */
    const playPreview = useCallback((voice: VoiceCatalogEntry) => {
        if (!voice.preview_url) return;
        if (playingVoiceId === voice.elevenlabs_voice_id) {
            audioRef.current?.pause();
            setPlayingVoiceId(null);
            return;
        }
        if (audioRef.current) audioRef.current.pause();
        const audio = new Audio(voice.preview_url);
        audio.onended = () => setPlayingVoiceId(null);
        audio.play();
        audioRef.current = audio;
        setPlayingVoiceId(voice.elevenlabs_voice_id);
    }, [playingVoiceId]);

    /* ---- Clear messages ---- */
    useEffect(() => {
        if (!success && !error) return;
        const timer = setTimeout(() => { setSuccess(null); setError(null); }, 4000);
        return () => clearTimeout(timer);
    }, [success, error]);

    /* ---- Helpers ---- */
    const formatDuration = (seconds: number | null) => {
        if (!seconds) return "—";
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    const formatDate = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    };

    const statusLabel: Record<string, string> = {
        completed: "הושלמה",
        missed: "לא נענתה",
        in_progress: "בתהליך",
        failed: "נכשלה",
    };

    /* ---------------------------------------------------------------- */
    /* Render                                                           */
    /* ---------------------------------------------------------------- */

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-neutral-400">
                <Loader2 className="w-5 h-5 animate-spin ml-2" />
                <span>טוען הגדרות קול...</span>
            </div>
        );
    }

    const isSetup = !!config?.elevenlabs_agent_id;

    return (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6" dir="rtl">
            {/* Toast messages */}
            {(success || error) && (
                <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-xl text-sm font-medium transition-all ${
                    success
                        ? "bg-emerald-900/90 border-emerald-500/40 text-emerald-100"
                        : "bg-red-900/90 border-red-500/40 text-red-100"
                }`}>
                    <span>{success ? "✅" : "❌"}</span>
                    <span>{success || error}</span>
                </div>
            )}

            {/* ─── Setup section (if not set up yet) ─── */}
            {!isSetup && (
                <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                        <Phone className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h2 className="text-xl font-bold text-white">הפעלת סוכן קולי</h2>
                    <p className="text-neutral-400 text-sm max-w-md mx-auto">
                        הקם סוכן קולי שיענה ללקוחות בטלפון. הסוכן ישתמש באותו בסיס ידע כמו הוואטסאפ.
                    </p>
                    <button
                        onClick={handleSetup}
                        disabled={setupLoading}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                    >
                        {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                        {setupLoading ? "מקים..." : "הקם סוכן קולי"}
                    </button>
                </section>
            )}

            {/* ─── Voice settings (when set up) ─── */}
            {isSetup && (
                <>
                    {/* Status + toggle */}
                    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${voiceEnabled ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-neutral-600"}`} />
                                <span className="text-white font-medium">
                                    {voiceEnabled ? "סוכן קולי פעיל" : "סוכן קולי מושהה"}
                                </span>
                            </div>
                            <button
                                onClick={() => setVoiceEnabled(!voiceEnabled)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${voiceEnabled ? "bg-emerald-600" : "bg-neutral-700"}`}
                            >
                                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${voiceEnabled ? "right-0.5" : "right-[1.625rem]"}`} />
                            </button>
                        </div>
                        {config?.twilio_phone_number && (
                            <p className="text-neutral-400 text-sm mt-2">
                                <Phone className="w-3.5 h-3.5 inline ml-1" />
                                {config.twilio_phone_number}
                            </p>
                        )}
                    </section>

                    {/* Voice selection */}
                    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                        <h3 className="text-white font-semibold flex items-center gap-2">
                            <Volume2 className="w-4 h-4 text-emerald-400" />
                            בחירת קול
                        </h3>
                        <div className="grid gap-2">
                            {voices.map((voice) => (
                                <div
                                    key={voice.id}
                                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                        voiceId === voice.elevenlabs_voice_id
                                            ? "border-emerald-500/50 bg-emerald-500/10"
                                            : "border-white/[0.06] hover:border-white/10 bg-white/[0.02]"
                                    }`}
                                    onClick={() => setVoiceId(voice.elevenlabs_voice_id)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                                            voice.gender === "female" ? "bg-pink-500/20 text-pink-400" : "bg-blue-500/20 text-blue-400"
                                        }`}>
                                            <Mic className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <span className="text-white text-sm font-medium">{voice.display_name_he}</span>
                                            {voice.is_default && (
                                                <span className="text-emerald-400 text-xs mr-2">(ברירת מחדל)</span>
                                            )}
                                        </div>
                                    </div>
                                    {voice.preview_url && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); playPreview(voice); }}
                                            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-neutral-400 hover:text-white"
                                        >
                                            {playingVoiceId === voice.elevenlabs_voice_id
                                                ? <Pause className="w-4 h-4" />
                                                : <Play className="w-4 h-4" />
                                            }
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Greeting */}
                    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-3">
                        <h3 className="text-white font-semibold flex items-center gap-2">
                            <PhoneCall className="w-4 h-4 text-emerald-400" />
                            הודעת פתיחה
                        </h3>
                        <p className="text-neutral-500 text-xs">המשפט הראשון שהסוכן אומר כשלקוח מתקשר</p>
                        <textarea
                            value={firstMessage}
                            onChange={(e) => setFirstMessage(e.target.value)}
                            placeholder="היי, איך אפשר לעזור?"
                            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:border-emerald-500/50 transition-colors"
                            rows={2}
                            dir="rtl"
                            maxLength={2000}
                        />
                    </section>

                    {/* Custom instructions */}
                    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-3">
                        <h3 className="text-white font-semibold flex items-center gap-2">
                            <Mic className="w-4 h-4 text-emerald-400" />
                            הוראות מותאמות לקול
                        </h3>
                        <p className="text-neutral-500 text-xs">
                            הוראות ספציפיות לסוכן הקולי (נפרד מהוראות הוואטסאפ). לא יכולות לעקוף את כללי המערכת.
                        </p>
                        <textarea
                            value={customInstructions}
                            onChange={(e) => setCustomInstructions(e.target.value)}
                            placeholder="לדוגמה: כשמבקשים כתובת, תאר את הדרך במילים במקום לתת רחוב ומספר"
                            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:border-emerald-500/50 transition-colors"
                            rows={4}
                            dir="rtl"
                            maxLength={10000}
                        />
                    </section>

                    {/* Save button */}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {saving ? "שומר..." : "שמור הגדרות"}
                    </button>

                    {/* Call history */}
                    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                        <h3 className="text-white font-semibold flex items-center gap-2">
                            <Clock className="w-4 h-4 text-emerald-400" />
                            היסטוריית שיחות
                        </h3>
                        {callLogs.length === 0 ? (
                            <p className="text-neutral-500 text-sm text-center py-8">
                                <PhoneOff className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                אין עדיין שיחות
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {callLogs.map((log) => (
                                    <div
                                        key={log.id}
                                        className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                                <User className="w-4 h-4 text-neutral-500" />
                                            </div>
                                            <div>
                                                <p className="text-white text-sm">{log.caller_phone || "מספר לא ידוע"}</p>
                                                <p className="text-neutral-500 text-xs">{formatDate(log.started_at)}</p>
                                            </div>
                                        </div>
                                        <div className="text-left">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                log.status === "completed"
                                                    ? "bg-emerald-500/20 text-emerald-400"
                                                    : log.status === "missed"
                                                        ? "bg-red-500/20 text-red-400"
                                                        : "bg-neutral-500/20 text-neutral-400"
                                            }`}>
                                                {statusLabel[log.status] || log.status}
                                            </span>
                                            <p className="text-neutral-500 text-xs mt-0.5">
                                                {formatDuration(log.duration_seconds)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
});

export { VoiceTab };
