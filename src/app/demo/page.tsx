"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Bot, QrCode, FileText, CheckCircle2, ArrowRight, ChevronRight, Wifi, Bell, MessageCircle, User } from "lucide-react";

const STEPS = [
    {
        id: 1,
        icon: <QrCode className="w-7 h-7" />,
        label: "סרוק QR",
        title: "סרוק קוד QR בוואטסאפ",
        subtitle: "30 שניות",
    },
    {
        id: 2,
        icon: <FileText className="w-7 h-7" />,
        label: "תאר את העסק",
        title: "ספר לסוכן על העסק שלך",
        subtitle: "5 דקות",
    },
    {
        id: 3,
        icon: <CheckCircle2 className="w-7 h-7" />,
        label: "מוכן!",
        title: "הסוכן שלך פעיל",
        subtitle: "עכשיו",
    },
];

export default function DemoPage() {
    const [active, setActive] = useState(0);
    const [qrScanned, setQrScanned] = useState(false);
    const [typed, setTyped] = useState("");

    const businessDesc = "מסעדה איטלקית במרכז תל אביב. מגישים פסטה טרייה, פיצות מהתנור ויינות נבחרים. פתוחים כל יום 12:00–23:00.";

    // Auto-advance QR step
    useEffect(() => {
        if (active !== 0) return;
        const t = setTimeout(() => setQrScanned(true), 2200);
        return () => clearTimeout(t);
    }, [active]);

    useEffect(() => {
        if (active !== 1) return;
        setTyped("");
        let i = 0;
        const interval = setInterval(() => {
            i++;
            setTyped(businessDesc.slice(0, i));
            if (i >= businessDesc.length) clearInterval(interval);
        }, 30);
        return () => clearInterval(interval);
    }, [active]);

    const next = () => {
        if (active < STEPS.length - 1) setActive(active + 1);
    };

    const reset = () => {
        setActive(0);
        setQrScanned(false);
        setTyped("");
    };

    return (
        <div className="min-h-screen bg-black text-white font-sans overflow-hidden" dir="rtl">
            {/* Background */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-600/15 blur-[130px]" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full bg-purple-700/10 blur-[150px]" />
            </div>

            {/* Nav */}
            <nav className="relative z-50 flex justify-between items-center py-5 px-8 lg:px-16 border-b border-white/[0.06]">
                <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <Bot className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-white/80">סוכן AI</span>
                </Link>
                <Link href="/register" className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:shadow-lg hover:shadow-indigo-500/25 transition-all">
                    התחל עכשיו
                    <ArrowRight className="w-4 h-4" />
                </Link>
            </nav>

            <main className="relative z-10 max-w-4xl mx-auto px-6 pt-14 pb-24">
                {/* Header */}
                <div className="text-center mb-14">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-indigo-300 text-sm font-medium mb-5">
                        <span className="text-base">⚡</span>
                        עניין של 10 דקות
                    </div>
                    <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-4">
                        כל כך פשוט
                    </h1>
                    <p className="text-neutral-400 text-lg max-w-md mx-auto">
                        שלושה צעדים. לא צריך טכנאי, לא צריך קוד.
                    </p>
                </div>

                {/* Step indicators */}
                <div className="flex items-center justify-center gap-0 mb-14">
                    {STEPS.map((step, i) => (
                        <div key={step.id} className="flex items-center">
                            <button
                                onClick={() => setActive(i)}
                                className={`flex items-center gap-2.5 px-4 py-2 rounded-full transition-all ${
                                    i === active
                                        ? "bg-indigo-600/20 border border-indigo-500/40 text-indigo-300"
                                        : i < active
                                        ? "text-emerald-400"
                                        : "text-neutral-600"
                                }`}
                            >
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border ${
                                    i < active
                                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                        : i === active
                                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                                        : "bg-white/5 border-white/10 text-neutral-600"
                                }`}>
                                    {i < active ? "✓" : i + 1}
                                </span>
                                <span className="text-sm font-medium hidden sm:block">{step.label}</span>
                            </button>
                            {i < STEPS.length - 1 && (
                                <ChevronRight className={`w-4 h-4 mx-1 ${i < active ? "text-emerald-500/50" : "text-white/10"}`} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Step content */}
                <AnimatePresence mode="wait">
                    {active === 0 && (
                        <motion.div
                            key="step1"
                            initial={{ opacity: 0, x: 30 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -30 }}
                            transition={{ duration: 0.35 }}
                            className="flex flex-col items-center gap-10"
                        >
                            <StepHeader step={STEPS[0]} />

                            <div className="relative">
                                {/* QR box */}
                                <div className={`relative w-56 h-56 rounded-3xl border-2 flex items-center justify-center transition-all duration-700 ${
                                    qrScanned
                                        ? "border-emerald-500/60 bg-emerald-500/5 shadow-[0_0_40px_rgba(16,185,129,0.2)]"
                                        : "border-white/15 bg-white/[0.03]"
                                }`}>
                                    {/* QR pattern (decorative) */}
                                    <AnimatePresence mode="wait">
                                        {!qrScanned ? (
                                            <motion.div
                                                key="qr"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                className="w-36 h-36"
                                            >
                                                <QrPattern />
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="check"
                                                initial={{ scale: 0, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                transition={{ type: "spring", bounce: 0.5 }}
                                                className="flex flex-col items-center gap-3"
                                            >
                                                <CheckCircle2 className="w-16 h-16 text-emerald-400" />
                                                <span className="text-emerald-400 font-semibold text-sm">וואטסאפ מחובר!</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Scanning line */}
                                    {!qrScanned && (
                                        <motion.div
                                            className="absolute inset-x-4 h-0.5 bg-indigo-500/70 rounded-full"
                                            animate={{ top: ["15%", "85%", "15%"] }}
                                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                        />
                                    )}
                                </div>

                                {/* Corner brackets */}
                                {["top-0 right-0 border-t-2 border-r-2 rounded-tr-xl",
                                  "top-0 left-0 border-t-2 border-l-2 rounded-tl-xl",
                                  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl",
                                  "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl"].map((cls, i) => (
                                    <div key={i} className={`absolute w-5 h-5 ${cls} ${qrScanned ? "border-emerald-500" : "border-indigo-500"} transition-colors duration-500`} />
                                ))}
                            </div>

                            <p className="text-neutral-500 text-sm text-center max-w-xs">
                                פתח את וואטסאפ בטלפון ← תפריט ← מכשירים מקושרים ← קשר מכשיר
                            </p>

                            <NextButton onClick={next} disabled={!qrScanned} label="המשך לשלב הבא" />
                        </motion.div>
                    )}

                    {active === 1 && (
                        <motion.div
                            key="step2"
                            initial={{ opacity: 0, x: 30 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -30 }}
                            transition={{ duration: 0.35 }}
                            className="flex flex-col items-center gap-10"
                        >
                            <StepHeader step={STEPS[1]} />

                            <div className="w-full max-w-lg bg-white/[0.03] border border-white/10 rounded-3xl p-8 shadow-2xl">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
                                        <Bot className="w-5 h-5 text-indigo-400" />
                                    </div>
                                    <div>
                                        <p className="text-white font-semibold text-sm">סוכן AI</p>
                                        <p className="text-neutral-500 text-xs">מחכה לתיאור...</p>
                                    </div>
                                </div>

                                <p className="text-neutral-400 text-sm mb-3">שם העסק ומה אתם עושים:</p>

                                <div className="relative bg-black/40 border border-white/10 rounded-2xl px-4 py-3 min-h-[110px] text-[15px] text-white/90 leading-relaxed font-mono">
                                    {typed}
                                    {typed.length > 0 && typed.length < businessDesc.length && (
                                        <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
                                    )}
                                </div>

                                <div className="mt-5 flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <motion.div
                                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                                            initial={{ width: "0%" }}
                                            animate={{ width: `${(typed.length / businessDesc.length) * 100}%` }}
                                            transition={{ duration: 0.1 }}
                                        />
                                    </div>
                                    <span className="text-neutral-500 text-xs shrink-0">
                                        {typed.length}/{businessDesc.length}
                                    </span>
                                </div>
                            </div>

                            <NextButton
                                onClick={next}
                                disabled={typed.length < businessDesc.length}
                                label="הסוכן מוכן — המשך"
                            />
                        </motion.div>
                    )}

                    {active === 2 && (
                        <motion.div
                            key="step3"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.4 }}
                            className="flex flex-col items-center gap-10"
                        >
                            <StepHeader step={STEPS[2]} />

                            {/* Simulated chat + notification */}
                            <div className="w-full max-w-lg space-y-4">
                                {/* Chat simulation */}
                                <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-5 shadow-2xl">
                                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.06]">
                                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                            <MessageCircle className="w-4 h-4 text-emerald-400" />
                                        </div>
                                        <div>
                                            <p className="text-white text-sm font-semibold">לקוח חדש</p>
                                            <p className="text-neutral-500 text-xs">וואטסאפ</p>
                                        </div>
                                        <div className="mr-auto flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                            <span className="text-emerald-400 text-xs font-medium">חי</span>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <ChatBubble text="היי, מה שעות הפתיחה שלכם?" isUser delay={0.3} />
                                        <ChatBubble text="שלום! 😊 אנחנו פתוחים כל יום מ-12:00 עד 23:00. רוצה לשריין שולחן?" isBot delay={1.2} />
                                        <ChatBubble text="כן, מחר בערב ל-4 אנשים" isUser delay={2.4} />
                                        <ChatBubble text="מעולה! שריינתי לך שולחן ל-4 מחר ב-20:00. נשלח תזכורת שעה לפני. אם יש שינוי — פשוט תכתוב 🙌" isBot delay={3.6} />
                                        <ChatBubble text="תודה! אפשר לדבר עם מישהו על תפריט ללא גלוטן?" isUser delay={5.0} />
                                        <ChatBubble text="בטח! מעביר אותך לצוות שלנו שיוכל לעזור עם זה. רגע אחד..." isBot delay={6.2} />
                                    </div>
                                </div>

                                {/* Owner notification */}
                                <OwnerNotification delay={7.5} />

                                {/* Status items */}
                                <div className="space-y-2.5 pt-2">
                                    {[
                                        { icon: <Wifi className="w-4 h-4 text-emerald-400" />, text: "וואטסאפ מחובר" },
                                        { icon: <Bot className="w-4 h-4 text-indigo-400" />, text: "סוכן AI עונה ללקוחות 24/7" },
                                        { icon: <Bell className="w-4 h-4 text-amber-400" />, text: "אתה מקבל התראה כשלקוח צריך נציג אנושי" },
                                    ].map((item, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 8.5 + i * 0.2 }}
                                            className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-2.5"
                                        >
                                            {item.icon}
                                            <span className="text-neutral-300 text-sm">{item.text}</span>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>

                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 9.5 }}
                                className="text-center"
                            >
                                <p className="text-neutral-400 text-lg mb-6">לוקח פחות מ-10 דקות. זהו.</p>
                                <div className="flex gap-3 flex-wrap justify-center">
                                    <Link
                                        href="/register"
                                        className="flex items-center gap-2 px-7 py-3.5 bg-white text-black rounded-full font-bold text-base hover:bg-neutral-100 transition-all hover:scale-105 active:scale-95"
                                    >
                                        התחל עכשיו — חינם
                                        <ArrowRight className="w-5 h-5" />
                                    </Link>
                                    <button
                                        onClick={reset}
                                        className="px-6 py-3.5 rounded-full border border-white/10 text-neutral-400 text-base hover:bg-white/5 transition-colors"
                                    >
                                        הצג שוב
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>
        </div>
    );
}

function StepHeader({ step }: { step: typeof STEPS[0] }) {
    return (
        <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-neutral-400 text-xs font-medium mb-4">
                שלב {step.id} מתוך 3 · {step.subtitle}
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold text-white">{step.title}</h2>
        </div>
    );
}

function NextButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-2 px-8 py-3.5 rounded-full font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 active:scale-95"
        >
            {label}
            <ArrowRight className="w-4 h-4" />
        </button>
    );
}

function ChatBubble({ text, isUser, isBot, delay }: { text: string; isUser?: boolean; isBot?: boolean; delay: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay, duration: 0.4, ease: "easeOut" }}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
        >
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                isUser
                    ? "bg-emerald-600/20 border border-emerald-500/20 text-emerald-100 rounded-bl-sm"
                    : "bg-indigo-600/15 border border-indigo-500/20 text-indigo-100 rounded-br-sm"
            }`}>
                {isBot && (
                    <div className="flex items-center gap-1.5 mb-1">
                        <Bot className="w-3 h-3 text-indigo-400" />
                        <span className="text-indigo-400 text-[10px] font-semibold">סוכן AI</span>
                    </div>
                )}
                {text}
            </div>
        </motion.div>
    );
}

function OwnerNotification({ delay }: { delay: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay, duration: 0.5, type: "spring", bounce: 0.3 }}
            className="relative bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/25 rounded-3xl p-5 shadow-lg shadow-amber-500/5"
        >
            <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-[10px] font-bold text-white animate-bounce">
                1
            </div>
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <Bell className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-amber-200 font-semibold text-sm">לקוח מבקש נציג אנושי</p>
                    <p className="text-neutral-400 text-xs mt-0.5 truncate">
                        "אפשר לדבר עם מישהו על תפריט ללא גלוטן?"
                    </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <User className="w-3.5 h-3.5 text-neutral-500" />
                    <span className="text-neutral-500 text-xs">לקוח חדש</span>
                </div>
            </div>
        </motion.div>
    );
}

// Simple decorative QR pattern
function QrPattern() {
    return (
        <svg viewBox="0 0 100 100" className="w-full h-full opacity-60">
            {/* Top-left finder */}
            <rect x="5" y="5" width="25" height="25" rx="3" fill="none" stroke="white" strokeWidth="4" />
            <rect x="12" y="12" width="11" height="11" rx="1" fill="white" />
            {/* Top-right finder */}
            <rect x="70" y="5" width="25" height="25" rx="3" fill="none" stroke="white" strokeWidth="4" />
            <rect x="77" y="12" width="11" height="11" rx="1" fill="white" />
            {/* Bottom-left finder */}
            <rect x="5" y="70" width="25" height="25" rx="3" fill="none" stroke="white" strokeWidth="4" />
            <rect x="12" y="77" width="11" height="11" rx="1" fill="white" />
            {/* Data dots */}
            {[
                [38,8],[42,8],[46,8],[50,8],[54,8],[58,8],
                [38,14],[46,14],[54,14],[62,14],
                [38,20],[42,20],[50,20],[58,20],[62,20],
                [38,26],[46,26],[54,26],
                [38,32],[42,32],[50,32],[58,32],[62,32],
                [8,38],[14,38],[20,38],[26,38],[32,38],[38,38],[44,38],[50,38],[56,38],[62,38],[68,38],[74,38],[80,38],[86,38],[92,38],
                [8,44],[20,44],[32,44],[44,44],[56,44],[68,44],[80,44],[92,44],
                [8,50],[14,50],[26,50],[38,50],[44,50],[56,50],[62,50],[74,50],[86,50],
                [8,56],[20,56],[32,56],[50,56],[62,56],[74,56],[92,56],
                [8,62],[14,62],[20,62],[38,62],[50,62],[56,62],[68,62],[80,62],[86,62],[92,62],
                [44,70],[50,70],[62,70],[74,70],[86,70],
                [38,76],[44,76],[56,76],[68,76],[92,76],
                [38,82],[50,82],[56,82],[68,82],[74,82],[86,82],
                [44,88],[50,88],[62,88],[74,88],[80,88],
                [38,94],[44,94],[56,94],[68,94],[80,94],[92,94],
            ].map(([cx, cy], i) => (
                <rect key={i} x={cx} y={cy} width="4" height="4" rx="0.5" fill="white" />
            ))}
        </svg>
    );
}
