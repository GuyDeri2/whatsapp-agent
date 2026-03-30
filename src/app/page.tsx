"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { motion, useScroll, useTransform } from "framer-motion";
import { PhoneMockup } from "@/components/PhoneMockup";
import { PhoneCallSimulation } from "@/components/PhoneCallSimulation";
import { BrainCircuit, Zap, ShieldCheck, Bell, Bot, ArrowRight, Sparkles, Mic } from "lucide-react";

export default function LandingPage() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const { scrollY } = useScroll();
    const y1 = useTransform(scrollY, [0, 1000], [0, 200]);
    const y2 = useTransform(scrollY, [0, 1000], [0, -200]);

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
                {/* Premium Grid Overlay */}
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0wIDEwaDQwaC00MFYwaDQwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMSkiIGZpbGw9Im5vbmUiLz4KPC9zdmc+')] [mask-image:radial-gradient(ellipse_at_center,white_10%,transparent_70%)] opacity-40" />

                {/* Glowing Orbs */}
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
                            <Link href="/demo" className="glass-panel flex items-center justify-center gap-2 px-8 py-4 rounded-full font-medium text-lg text-white hover:bg-white/10 transition-colors border border-white/10 shadow-lg">
                                <Mic className="w-5 h-5 text-accent" />
                                שמע הדגמה
                            </Link>
                        </motion.div>
                    </motion.div>

                    {/* Right iPhones Mockups */}
                    <div className="relative flex justify-center lg:justify-end perspective-1000 mt-16 lg:mt-0 h-[600px] sm:h-[700px] w-full items-center">
                        <motion.div
                            initial={{ opacity: 0, x: -60, scale: 0.85, rotateY: -20, rotateX: 10 }}
                            animate={{ opacity: 1, x: 0, scale: 1, rotateY: -15, rotateX: 5 }}
                            transition={{ duration: 1.5, type: "spring", bounce: 0.3 }}
                            className="absolute lg:right-4 z-10 w-full max-w-[280px] sm:max-w-[320px] drop-shadow-2xl"
                        >
                            <PhoneMockup />
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, x: 60, scale: 0.85, rotateY: 20, rotateX: 10 }}
                            animate={{ opacity: 1, x: -80, y: 40, scale: 1.05, rotateY: 5, rotateX: -5 }}
                            transition={{ duration: 1.5, delay: 0.3, type: "spring", bounce: 0.4 }}
                            className="absolute lg:left-0 z-20 w-full max-w-[280px] sm:max-w-[320px] drop-shadow-[0_30px_60px_rgba(0,0,0,0.8)]"
                        >
                            <PhoneCallSimulation />
                        </motion.div>
                    </div>

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
                    <div className="font-semibold text-white text-base">סוכן ווטסאפ</div>
                    <div className="flex items-center gap-6">
                        <Link href="/privacy" className="hover:text-white transition-colors">מדיניות פרטיות</Link>
                        <Link href="/terms" className="hover:text-white transition-colors">תנאי שימוש</Link>
                    </div>
                    <div>© {new Date().getFullYear()} סוכן ווטסאפ. כל הזכויות שמורות.</div>
                </div>
            </footer>
        </div>
    );
}

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
