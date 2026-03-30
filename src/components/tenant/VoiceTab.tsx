"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Phone, PhoneCall, PhoneOff, Mic, Volume2, Save, Loader2, Clock, User, Play, Pause, CheckCircle2 } from "lucide-react";
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
    const [phoneNumber, setPhoneNumber] = useState("");
    const [phoneSaving, setPhoneSaving] = useState(false);

    // Onboarding wizard state (for initial setup flow)
    const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3>(1);
    const [onboardingPhone, setOnboardingPhone] = useState("");
    const [onboardingPhoneSaving, setOnboardingPhoneSaving] = useState(false);
    const [onboardingActivating, setOnboardingActivating] = useState(false);

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
                setPhoneNumber(data.twilio_phone_number || "");
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
            setOnboardingStep(2);
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

    /* ---- Save phone number ---- */
    const handleSavePhone = useCallback(async () => {
        setPhoneSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/voice`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    twilio_phone_number: phoneNumber || null,
                }),
            });
            if (!res.ok) {
                const { error: msg } = await res.json();
                throw new Error(msg || "Save failed");
            }
            const { data } = await res.json();
            setConfig(data);
            setPhoneNumber(data.twilio_phone_number || "");
            setSuccess("מספר הטלפון נשמר בהצלחה!");
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בשמירת מספר טלפון");
        } finally {
            setPhoneSaving(false);
        }
    }, [tenantId, phoneNumber]);

    /* ---- Onboarding: save phone number (step 2) ---- */
    const handleOnboardingPhone = useCallback(async () => {
        setOnboardingPhoneSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/voice`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ twilio_phone_number: onboardingPhone || null }),
            });
            if (!res.ok) {
                const { error: msg } = await res.json();
                throw new Error(msg || "Save failed");
            }
            const { data } = await res.json();
            setConfig(data);
            setPhoneNumber(data.twilio_phone_number || "");
            setSuccess("מספר הטלפון נשמר בהצלחה!");
            setOnboardingStep(3);
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בשמירת מספר טלפון");
        } finally {
            setOnboardingPhoneSaving(false);
        }
    }, [tenantId, onboardingPhone]);

    /* ---- Onboarding: activate voice (step 3) ---- */
    const handleOnboardingActivate = useCallback(async () => {
        setOnboardingActivating(true);
        setError(null);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/voice`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ voice_enabled: true }),
            });
            if (!res.ok) {
                const { error: msg } = await res.json();
                throw new Error(msg || "Activation failed");
            }
            const { data } = await res.json();
            setConfig(data);
            setVoiceEnabled(true);
            setSuccess("הסוכן הקולי הופעל בהצלחה! 🎉");
        } catch (err) {
            setError(err instanceof Error ? err.message : "שגיאה בהפעלת הסוכן");
        } finally {
            setOnboardingActivating(false);
        }
    }, [tenantId]);

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

    // Determine if we should show the onboarding wizard:
    // Show wizard when voice is not fully set up (no agent, or agent exists but not yet enabled).
    // Once voice_enabled is true, the full management UI takes over.
    const showOnboarding = !isSetup || (isSetup && !config?.voice_enabled);

    // Derive the correct onboarding step from current config state
    // (handles page reloads mid-setup)
    const derivedStep: 1 | 2 | 3 = !isSetup ? 1 : !config?.twilio_phone_number ? 2 : 3;
    const effectiveStep = Math.max(onboardingStep, derivedStep) as 1 | 2 | 3;

    // Step completion status
    const step1Done = isSetup;
    const step2Done = !!config?.twilio_phone_number;
    const step3Done = !!config?.voice_enabled;

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

            {/* ─── Onboarding wizard (before voice is fully activated) ─── */}
            {showOnboarding && (
                <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 space-y-5">
                    {/* Header */}
                    <div className="text-center space-y-2">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                            <Phone className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white">הפעלת סוכן קולי</h2>
                        <p className="text-neutral-400 text-sm max-w-md mx-auto">
                            הקם סוכן קולי שיענה ללקוחות בטלפון. הסוכן ישתמש באותו בסיס ידע כמו הוואטסאפ.
                        </p>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-1 px-2">
                        {[1, 2, 3].map((s) => (
                            <div
                                key={s}
                                className={`flex-1 h-1.5 rounded-full transition-colors ${
                                    s <= effectiveStep
                                        ? (s < effectiveStep || (s === 1 && step1Done) || (s === 2 && step2Done) || (s === 3 && step3Done))
                                            ? "bg-emerald-500"
                                            : "bg-emerald-500/40"
                                        : "bg-white/[0.06]"
                                }`}
                            />
                        ))}
                    </div>

                    {/* ── Step 1: הקמת סוכן קולי ── */}
                    <div className={`rounded-xl border p-4 transition-all ${
                        effectiveStep === 1 && !step1Done
                            ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                            : step1Done
                                ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                                : "border-white/[0.04] bg-white/[0.01] opacity-40"
                    }`}>
                        <div className="flex items-center gap-3">
                            {step1Done ? (
                                <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                            ) : (
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                    effectiveStep === 1 ? "border-emerald-400 text-emerald-400" : "border-neutral-600 text-neutral-600"
                                }`}>
                                    1
                                </div>
                            )}
                            <div className="flex-1">
                                <span className={`font-semibold text-sm ${step1Done ? "text-emerald-400" : "text-white"}`}>
                                    הקמת סוכן קולי
                                </span>
                                {step1Done && (
                                    <span className="text-emerald-400/60 text-xs mr-2">הושלם</span>
                                )}
                            </div>
                        </div>
                        {effectiveStep === 1 && !step1Done && (
                            <div className="mt-3 pr-9">
                                <p className="text-neutral-400 text-xs mb-3">
                                    יצירת סוכן קולי חדש ב-ElevenLabs עם בסיס הידע של העסק שלך.
                                </p>
                                <button
                                    onClick={handleSetup}
                                    disabled={setupLoading}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                                >
                                    {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                                    {setupLoading ? "מקים סוכן..." : "הקם סוכן קולי"}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Step 2: חיבור מספר טלפון ── */}
                    <div className={`rounded-xl border p-4 transition-all ${
                        effectiveStep === 2 && !step2Done
                            ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                            : step2Done
                                ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                                : "border-white/[0.04] bg-white/[0.01] opacity-40"
                    }`}>
                        <div className="flex items-center gap-3">
                            {step2Done ? (
                                <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                            ) : (
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                    effectiveStep === 2 ? "border-emerald-400 text-emerald-400" : "border-neutral-600 text-neutral-600"
                                }`}>
                                    2
                                </div>
                            )}
                            <div className="flex-1">
                                <span className={`font-semibold text-sm ${step2Done ? "text-emerald-400" : "text-white"}`}>
                                    חיבור מספר טלפון
                                </span>
                                {step2Done && (
                                    <span className="text-emerald-400/60 text-xs mr-2">הושלם</span>
                                )}
                            </div>
                        </div>
                        {effectiveStep === 2 && !step2Done && (
                            <div className="mt-3 pr-9">
                                <p className="text-neutral-400 text-xs mb-3">
                                    הזן את מספר הטלפון של Twilio שישמש לקבלת שיחות נכנסות.
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="tel"
                                        value={onboardingPhone}
                                        onChange={(e) => setOnboardingPhone(e.target.value)}
                                        placeholder="+972..."
                                        className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50 transition-colors"
                                        dir="ltr"
                                    />
                                    <button
                                        onClick={handleOnboardingPhone}
                                        disabled={onboardingPhoneSaving || !onboardingPhone.trim()}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all"
                                    >
                                        {onboardingPhoneSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        שמור
                                    </button>
                                </div>
                            </div>
                        )}
                        {step2Done && config?.twilio_phone_number && (
                            <p className="text-neutral-400 text-xs mt-1 pr-9 font-mono" dir="ltr">
                                {config.twilio_phone_number}
                            </p>
                        )}
                    </div>

                    {/* ── Step 3: הפעלה ── */}
                    <div className={`rounded-xl border p-4 transition-all ${
                        effectiveStep === 3 && !step3Done
                            ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                            : step3Done
                                ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                                : "border-white/[0.04] bg-white/[0.01] opacity-40"
                    }`}>
                        <div className="flex items-center gap-3">
                            {step3Done ? (
                                <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                            ) : (
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                    effectiveStep === 3 ? "border-emerald-400 text-emerald-400" : "border-neutral-600 text-neutral-600"
                                }`}>
                                    3
                                </div>
                            )}
                            <div className="flex-1">
                                <span className={`font-semibold text-sm ${step3Done ? "text-emerald-400" : "text-white"}`}>
                                    הפעלה
                                </span>
                                {step3Done && (
                                    <span className="text-emerald-400/60 text-xs mr-2">הושלם</span>
                                )}
                            </div>
                        </div>
                        {effectiveStep === 3 && !step3Done && (
                            <div className="mt-3 pr-9">
                                <p className="text-neutral-400 text-xs mb-3">
                                    הפעל את הסוכן הקולי כדי שיתחיל לענות לשיחות.
                                </p>
                                <button
                                    onClick={handleOnboardingActivate}
                                    disabled={onboardingActivating}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                                >
                                    {onboardingActivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                                    {onboardingActivating ? "מפעיל..." : "הפעל סוכן קולי"}
                                </button>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* ─── Voice settings (when fully set up and activated) ─── */}
            {isSetup && !showOnboarding && (
                <>
                    {/* Phone number management */}
                    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-3">
                        <h3 className="text-white font-semibold flex items-center gap-2">
                            <Phone className="w-4 h-4 text-emerald-400" />
                            מספר טלפון
                        </h3>
                        {config?.twilio_phone_number ? (
                            <div className="flex items-center gap-3">
                                <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                                <span className="text-white text-sm font-mono" dir="ltr">{config.twilio_phone_number}</span>
                            </div>
                        ) : (
                            <>
                                <p className="text-neutral-500 text-xs">הזן מספר Twilio לקבלת שיחות נכנסות</p>
                                <div className="flex gap-2">
                                    <input
                                        type="tel"
                                        value={phoneNumber}
                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                        placeholder="+972..."
                                        className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-emerald-500/50 transition-colors"
                                        dir="ltr"
                                    />
                                    <button
                                        onClick={handleSavePhone}
                                        disabled={phoneSaving || !phoneNumber.trim()}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all"
                                    >
                                        {phoneSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        שמור
                                    </button>
                                </div>
                            </>
                        )}
                    </section>

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
                                disabled={!config?.elevenlabs_agent_id || !config?.twilio_phone_number}
                                className={`relative w-12 h-6 rounded-full transition-colors ${voiceEnabled ? "bg-emerald-600" : "bg-neutral-700"} disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${voiceEnabled ? "right-0.5" : "right-[1.625rem]"}`} />
                            </button>
                        </div>
                        {!config?.twilio_phone_number && (
                            <p className="text-amber-400/80 text-xs mt-2">
                                יש להגדיר מספר טלפון כדי להפעיל את הסוכן הקולי
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
