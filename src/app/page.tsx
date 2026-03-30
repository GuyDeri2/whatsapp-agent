"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { PhoneMockup } from "@/components/PhoneMockup";
import { PhoneCallSimulation } from "@/components/PhoneCallSimulation";
import { BrainCircuit, Zap, ShieldCheck, Bell, Bot, ArrowRight, Sparkles, MessageSquare, Phone, Play, Pause, Volume2 } from "lucide-react";

export default function LandingPage() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [activeChannel, setActiveChannel] = useState<"whatsapp" | "voice">("whatsapp");
    const { scrollY } = useScroll();
    const y1 = useTransform(scrollY, [0, 1000], [0, 200]);
    const y2 = useTransform(scrollY, [0, 1000], [0, -200]);

    // Auto-toggle between channels
    useEffect(() => {
        const interval = setInterval(() => {
            setActiveChannel(prev => prev === "whatsapp" ? "voice" : "whatsapp");
        }, 8000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data: { user } }) => {
            setIsLoggedIn(!!user);
        });
    }, []);

    return (
        <div className="min-h-screen bg-transparent text-white selection:bg-accent/30 selection:text-white overflow-hidden" dir="rtl">
            {/* Animated Ambient Background */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 bg-[#06080D]" />
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0wIDEwaDQwaC00MFYwaDQwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMSkiIGZpbGw9Im5vbmUiLz4KPC9zdmc+')] [mask-image:radial-gradient(ellipse_at_center,white_10%,transparent_70%)] opacity-40" />
                <motion.div style={{ y: y1 }} className="absolute -top-[20%] right-[-10%] w-[800px] h-[800px] rounded-full bg-accent/10 blur-[150px] opacity-70 mix-blend-screen" />
                <motion.div style={{ y: y2 }} className="absolute -bottom-[20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-[150px] opacity-50 mix-blend-screen" />
                <div className="absolute top-[30%] left-[40%] w-[400px] h-[400px] rounded-full bg-emerald-500/5 blur-[120px] opacity-40 mix-blend-screen" />
            </div>

            {/* Navigation */}
            <motion.nav
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="relative z-50 flex justify-between items-center py-6 px-8 lg:px-16"
            >
                <div className="flex items-center gap-3 text-2xl font-bold tracking-tight">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-white/10 flex items-center justify-center shadow-lg shadow-black/50 relative overflow-hidden group">
                        <div className="absolute inset-0 bg-accent-glow opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        <Bot className="w-6 h-6 text-accent relative z-10" />
                    </div>
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-white/90 to-white/70">
                        סוכן AI
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    {isLoggedIn ? (
                        <Link href="/dashboard" className="px-6 py-2.5 rounded-full bg-white text-black font-semibold hover:bg-neutral-200 transition-all hover:scale-105 active:scale-95 text-sm ring-1 ring-white/10 shadow-xl shadow-white/10">
                            המשך לדשבורד
                        </Link>
                    ) : (
                        <>
                            <Link href="/login" className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors">
                                התחברות
                            </Link>
                            <Link href="/register" className="px-6 py-2.5 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 hover:-translate-y-0.5 transition-all outline-none active:scale-95 text-sm ring-1 ring-white/10">
                                הרשמה חינם
                            </Link>
                        </>
                    )}
                </div>
            </motion.nav>

            {/* Hero Section */}
            <main className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-16 pt-20 lg:pt-32 pb-20">
                <div className="grid lg:grid-cols-2 gap-16 lg:gap-8 items-center">

                    {/* Left Copy */}
                    <motion.div
                        className="flex flex-col gap-8 text-center lg:text-right relative lg:pr-4"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.2 }}
                        >
                            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent-hover text-sm font-semibold mb-8 backdrop-blur-md shadow-[0_0_30px_rgba(59,130,246,0.15)] ring-1 ring-white/5">
                                <Sparkles className="w-4 h-4" />
                                חדש: סוכני קול בינה מלאכותית
                            </div>
                            <h1 className="text-5xl lg:text-[5.5rem] font-extrabold tracking-tight leading-[1.05] drop-shadow-2xl">
                                שירות לקוחות,<br />
                                קולי והודעות <br />
                                <span className="relative inline-block mt-2">
                                    <span className="absolute -inset-4 bg-accent/20 blur-3xl opacity-50"></span>
                                    <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-white">
                                        על טייס אוטומטי.
                                    </span>
                                </span>
                            </h1>
                        </motion.div>

                        <motion.p
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.4 }}
                            className="text-lg lg:text-xl text-neutral-400 max-w-xl mx-auto lg:mx-0 leading-relaxed font-light"
                        >
                            מערכת ה-AI המקיפה לעסק שלך. סוכנים וירטואליים שלומדים את העסק, משיבים בוואטסאפ ואפילו מנהלים שיחות טלפון קוליות עם הלקוחות שלך 24/7.
                        </motion.p>

                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.6 }}
                            className="flex flex-col sm:flex-row gap-5 justify-center lg:justify-start mt-4"
                        >
                            {!isLoggedIn && (
                                <Link href="/register" className="group relative flex items-center justify-center gap-3 px-8 py-4 bg-white text-black rounded-full font-bold text-lg overflow-hidden transition-all hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(255,255,255,0.2)]">
                                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                                    התחל ניסיון חינם
                                    <ArrowRight className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                                </Link>
                            )}
                            <a href="#demo" className="glass-panel flex items-center justify-center gap-2 px-8 py-4 rounded-full font-medium text-lg text-white hover:bg-white/10 transition-colors border border-white/10 shadow-lg">
                                <Volume2 className="w-5 h-5 text-accent" />
                                שמע הדגמה
                            </a>
                        </motion.div>
                    </motion.div>

                    {/* Right — Single Phone with Channel Toggle */}
                    <div className="relative flex flex-col items-center lg:items-end mt-8 lg:mt-0">
                        {/* Channel Toggle */}
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.8 }}
                            className="flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-6 relative z-20"
                        >
                            <button
                                onClick={() => setActiveChannel("whatsapp")}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                                    activeChannel === "whatsapp"
                                        ? "bg-[#25D366] text-white shadow-lg shadow-emerald-500/20"
                                        : "text-neutral-400 hover:text-white"
                                }`}
                            >
                                <MessageSquare className="w-4 h-4" />
                                וואטסאפ
                            </button>
                            <button
                                onClick={() => setActiveChannel("voice")}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                                    activeChannel === "voice"
                                        ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                                        : "text-neutral-400 hover:text-white"
                                }`}
                            >
                                <Phone className="w-4 h-4" />
                                שיחה קולית
                            </button>
                        </motion.div>

                        {/* Phone Frame */}
                        <motion.div
                            initial={{ opacity: 0, y: 40, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 1.2, type: "spring", bounce: 0.3 }}
                            className="relative w-full max-w-[300px] sm:max-w-[320px]"
                        >
                            {/* Glow behind phone */}
                            <div className={`absolute -inset-8 rounded-[4rem] blur-[80px] opacity-30 transition-colors duration-1000 ${
                                activeChannel === "whatsapp" ? "bg-emerald-500" : "bg-indigo-500"
                            }`} />

                            {/* Phone shell */}
                            <div className="relative mx-auto w-full aspect-[1/2.05] bg-[#0A0A0A] rounded-[2.8rem] sm:rounded-[3rem] border-[8px] border-neutral-800 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] overflow-hidden ring-1 ring-white/10">
                                {/* Bezel shine */}
                                <div className="absolute inset-0 rounded-[2.5rem] border border-white/5 pointer-events-none z-50" />
                                {/* Notch */}
                                <div className="absolute top-0 inset-x-0 w-[45%] h-6 bg-[#0A0A0A] rounded-b-2xl mx-auto z-40 flex justify-center items-end pb-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                                    <div className="w-14 h-1.5 bg-neutral-900 rounded-full flex gap-2 items-center justify-end px-1">
                                        <div className="w-1 h-1 bg-blue-900/50 rounded-full" />
                                    </div>
                                </div>

                                {/* Screen content — animated switch */}
                                <AnimatePresence mode="wait">
                                    {activeChannel === "whatsapp" ? (
                                        <motion.div
                                            key="whatsapp"
                                            initial={{ opacity: 0, x: -30 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 30 }}
                                            transition={{ duration: 0.4 }}
                                            className="absolute inset-0"
                                        >
                                            <PhoneMockup embedded />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="voice"
                                            initial={{ opacity: 0, x: 30 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -30 }}
                                            transition={{ duration: 0.4 }}
                                            className="absolute inset-0"
                                        >
                                            <PhoneCallSimulation />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    </div>

                </div>

                {/* Voice Demo / Audio Section */}
                <div id="demo" className="mt-32 lg:mt-48 relative z-20">
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.8 }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl lg:text-5xl font-extrabold mb-6 tracking-tight">שמע איך זה נשמע</h2>
                        <p className="text-neutral-400 text-lg lg:text-xl font-light">שיחת הדגמה אמיתית בין לקוח לסוכן AI שלנו</p>
                    </motion.div>

                    <AudioDemo />
                </div>

                {/* Features Grid */}
                <div className="mt-32 lg:mt-48 relative z-20">
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.8 }}
                        className="text-center mb-20"
                    >
                        <h2 className="text-3xl lg:text-5xl font-extrabold mb-6 tracking-tight">למה לבחור בסוכן שלנו?</h2>
                        <p className="text-neutral-400 text-lg lg:text-xl font-light">טכנולוגיית קצה שנותנת לעסק שלך יתרון לא הוגן.</p>
                    </motion.div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <FeatureCard
                            icon={<BrainCircuit className="w-7 h-7 text-accent" />}
                            title="לומד מכל שיחה"
                            description="מודל AI מתקדם שמנתח את היסטוריית השיחות, סגנון הדיבור והמחירון שלך בזמן אמת."
                            delay={0.1}
                        />
                        <FeatureCard
                            icon={<Zap className="w-7 h-7 text-emerald-400" />}
                            title="תגובה במילישניות"
                            description="הלקוח שלח הודעה? תוך שניות בודדות הוא מקבל מענה טבעי ומקצועי. בלי לאבד לידים לעולם."
                            delay={0.2}
                        />
                        <FeatureCard
                            icon={<Bell className="w-7 h-7 text-amber-400" />}
                            title="התראות חכמות"
                            description="כשהבוט מזהה צורך בניואנס אנושי, תגיע אליך התראה לווטסאפ במיידי להמשך טיפול חלק."
                            delay={0.3}
                        />
                        <FeatureCard
                            icon={<ShieldCheck className="w-7 h-7 text-indigo-400" />}
                            title="שליטה מלאה תמיד"
                            description="דשבורד חדשני המאפשר לך לצפות בשיחות בזמן אמת, לעוצר את הבוט ולהתערב בלחיצה."
                            delay={0.4}
                        />
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 border-t border-white/10 py-8 px-8 lg:px-16">
                <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-neutral-400">
                    <div className="font-semibold text-white text-base">סוכן AI</div>
                    <div className="flex items-center gap-6">
                        <Link href="/privacy" className="hover:text-white transition-colors">מדיניות פרטיות</Link>
                        <Link href="/terms" className="hover:text-white transition-colors">תנאי שימוש</Link>
                    </div>
                    <div>© {new Date().getFullYear()} סוכן AI. כל הזכויות שמורות.</div>
                </div>
            </footer>
        </div>
    );
}

/* ─── Audio Demo Component ─── */

const demoTranscript = [
    { speaker: "agent", text: "שלום! תודה שהתקשרת לסטודיו לנייל ארט. אני שירה, העוזרת הוירטואלית. במה אוכל לעזור?" },
    { speaker: "customer", text: "היי, רציתי לקבוע תור למניקור ג׳ל" },
    { speaker: "agent", text: "בשמחה! יש לנו פנוי ביום שלישי בשעה 14:00 או ביום חמישי בשעה 10:00. מה מתאים לך?" },
    { speaker: "customer", text: "שלישי ב-14:00 מעולה" },
    { speaker: "agent", text: "מצוין, קבעתי לך תור ליום שלישי ב-14:00 למניקור ג׳ל. אשלח לך אישור ב-SMS עם כל הפרטים. יום נעים!" },
];

function AudioDemo() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [activeLineIndex, setActiveLineIndex] = useState(-1);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Timestamps for each transcript line (in seconds) — approximate
    const lineTimestamps = [0, 7, 10, 18, 21];

    useEffect(() => {
        const audio = new Audio("/audio/agent-call.mp3");
        audioRef.current = audio;

        audio.addEventListener("loadedmetadata", () => {
            setDuration(audio.duration);
        });

        audio.addEventListener("timeupdate", () => {
            setCurrentTime(audio.currentTime);
            // Find active transcript line
            for (let i = lineTimestamps.length - 1; i >= 0; i--) {
                if (audio.currentTime >= lineTimestamps[i]) {
                    setActiveLineIndex(i);
                    break;
                }
            }
        });

        audio.addEventListener("ended", () => {
            setIsPlaying(false);
            setActiveLineIndex(-1);
            setCurrentTime(0);
        });

        // If no audio file exists, simulate with a timer
        audio.addEventListener("error", () => {
            setDuration(30); // simulated duration
        });

        return () => {
            audio.pause();
            audio.removeEventListener("loadedmetadata", () => {});
            audio.removeEventListener("timeupdate", () => {});
            audio.removeEventListener("ended", () => {});
        };
    }, []);

    const togglePlay = () => {
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play().catch(() => {
                // No audio file — run simulated playback
                simulatePlayback();
            });
            setIsPlaying(true);
        }
    };

    const simulatePlayback = () => {
        let time = 0;
        const interval = setInterval(() => {
            time += 0.1;
            setCurrentTime(time);
            for (let i = lineTimestamps.length - 1; i >= 0; i--) {
                if (time >= lineTimestamps[i]) {
                    setActiveLineIndex(i);
                    break;
                }
            }
            if (time >= 30) {
                clearInterval(interval);
                setIsPlaying(false);
                setActiveLineIndex(-1);
                setCurrentTime(0);
            }
        }, 100);
    };

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl mx-auto"
        >
            {/* Audio Player Card */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] backdrop-blur-xl p-8 shadow-2xl">
                {/* Background glow */}
                <div className="absolute -top-20 -right-20 w-60 h-60 bg-indigo-500/10 rounded-full blur-[80px]" />
                <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-emerald-500/10 rounded-full blur-[80px]" />

                <div className="relative z-10">
                    {/* Player Controls */}
                    <div className="flex items-center gap-6 mb-8">
                        <button
                            onClick={togglePlay}
                            className="w-16 h-16 rounded-full bg-indigo-500 hover:bg-indigo-400 transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-lg shadow-indigo-500/30 shrink-0"
                        >
                            {isPlaying ? (
                                <Pause className="w-7 h-7 text-white" />
                            ) : (
                                <Play className="w-7 h-7 text-white mr-[-2px]" />
                            )}
                        </button>

                        <div className="flex-1 min-w-0">
                            <h3 className="text-white font-semibold text-lg mb-1">שיחת הדגמה — סטודיו לנייל ארט</h3>
                            <p className="text-neutral-400 text-sm">סוכנית AI: שירה | לקוחה: נועה</p>

                            {/* Progress bar */}
                            <div className="mt-3 flex items-center gap-3">
                                <span className="text-xs text-neutral-500 font-mono w-8">{formatTime(currentTime)}</span>
                                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                    <motion.div
                                        className="h-full bg-indigo-400 rounded-full"
                                        style={{ width: `${progress}%` }}
                                        transition={{ duration: 0.1 }}
                                    />
                                </div>
                                <span className="text-xs text-neutral-500 font-mono w-8">{formatTime(duration)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Transcript */}
                    <div className="space-y-3">
                        {demoTranscript.map((line, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0.4 }}
                                animate={{
                                    opacity: activeLineIndex >= i ? 1 : 0.4,
                                    x: activeLineIndex === i ? 0 : 0,
                                }}
                                transition={{ duration: 0.3 }}
                                className={`flex items-start gap-3 p-3 rounded-xl transition-colors duration-300 ${
                                    activeLineIndex === i ? "bg-white/[0.06]" : ""
                                }`}
                            >
                                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                                    line.speaker === "agent"
                                        ? "bg-indigo-500/20 text-indigo-300"
                                        : "bg-emerald-500/20 text-emerald-300"
                                }`}>
                                    {line.speaker === "agent" ? "AI" : "👤"}
                                </div>
                                <div>
                                    <span className={`text-xs font-medium mb-0.5 block ${
                                        line.speaker === "agent" ? "text-indigo-400" : "text-emerald-400"
                                    }`}>
                                        {line.speaker === "agent" ? "שירה (AI)" : "נועה (לקוחה)"}
                                    </span>
                                    <p className="text-neutral-200 text-[15px] leading-relaxed">{line.text}</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

/* ─── Feature Card ─── */

function FeatureCard({ icon, title, description, delay }: { icon: React.ReactNode, title: string, description: string, delay: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            whileHover={{ y: -8, scale: 1.02 }}
            transition={{ duration: 0.5, delay, type: "spring" }}
            className="group relative glass-panel p-8 rounded-3xl overflow-hidden"
        >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center mb-6 shadow-inner relative overflow-hidden">
                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {icon}
                </div>
                <h3 className="text-xl font-bold text-white mb-3 tracking-tight">{title}</h3>
                <p className="text-neutral-400 leading-relaxed text-[15px] font-light">{description}</p>
            </div>
        </motion.div>
    );
}
