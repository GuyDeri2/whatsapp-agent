"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import { PhoneMockup } from "@/components/PhoneMockup";
import { BrainCircuit, Zap, ShieldCheck, ChevronRight, Bot, ArrowRight } from "lucide-react";

export default function LandingPage() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setIsLoggedIn(!!session);
        });
    }, [supabase.auth]);

    return (
        <div className="min-h-screen bg-black text-white selection:bg-indigo-500/30 overflow-hidden font-sans" dir="rtl">
            {/* Background Gradients */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-600/20 blur-[120px]" />
                <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-purple-600/10 blur-[150px]" />
            </div>

            {/* Navigation */}
            <motion.nav
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="relative z-50 flex justify-between items-center py-6 px-8 lg:px-16"
            >
                <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <Bot className="w-6 h-6 text-white" />
                    </div>
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
                        סוכן AI
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    {isLoggedIn ? (
                        <Link href="/dashboard" className="px-5 py-2.5 rounded-full bg-white text-black font-semibold hover:bg-neutral-200 hover:scale-105 transition-all active:scale-95 text-sm ring-1 ring-white/10 shadow-xl">
                            המשך לדשבורד
                        </Link>
                    ) : (
                        <>
                            <Link href="/login" className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors">
                                התחברות
                            </Link>
                            <Link href="/register" className="px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5 transition-all active:scale-95 text-sm">
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
                        className="flex flex-col gap-8 text-center lg:text-right"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.2 }}
                        >
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-indigo-300 text-sm font-medium mb-6">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                                </span>
                                המהפכה בשירות הלקוחות
                            </div>
                            <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]">
                                שירות הלקוחות שלך,<br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-200 to-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                                    על טייס אוטומטי.
                                </span>
                            </h1>
                        </motion.div>

                        <motion.p
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.4 }}
                            className="text-lg lg:text-xl text-neutral-400 max-w-xl mx-auto lg:mx-0 leading-relaxed"
                        >
                            סוכן AI חכם שלומד את העסק שלך ועונה ללקוחות בווטסאפ 24/7.
                            תן לבינה המלאכותית שלנו לסגור עסקאות בשבילך בזמן שאתה ישן.
                        </motion.p>

                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.6 }}
                            className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start"
                        >
                            {!isLoggedIn && (
                                <Link href="/register" className="group relative flex items-center justify-center gap-2 px-8 py-4 bg-white text-black rounded-full font-bold text-lg overflow-hidden transition-transform hover:scale-105 active:scale-95">
                                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                                    התחל ניסיון חינם
                                    <ArrowRight className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                                </Link>
                            )}
                            <Link href="/demo" className="flex items-center justify-center gap-2 px-8 py-4 rounded-full font-medium text-lg text-white border border-white/10 hover:bg-white/5 transition-colors">
                                צפה בהדגמה
                            </Link>
                        </motion.div>
                    </motion.div>

                    {/* Right iPhone PhoneMockup */}
                    <div className="relative flex justify-center lg:justify-end perspective-1000">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8, rotateY: -15, rotateX: 5 }}
                            animate={{ opacity: 1, scale: 1, rotateY: 0, rotateX: 0 }}
                            transition={{ duration: 1.2, type: "spring", bounce: 0.4 }}
                            className="relative z-10"
                        >
                            {/* Decorative glow behind phone */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 blur-3xl opacity-20 transform scale-110 -z-10 rounded-full animate-pulse" />
                            <PhoneMockup />
                        </motion.div>
                    </div>

                </div>

                {/* Features Grid */}
                <div className="mt-32 lg:mt-48">
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.8 }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl lg:text-4xl font-bold mb-4">למה לבחור בסוכן שלנו?</h2>
                        <p className="text-neutral-400 text-lg">טכנולוגיה מתקדמת שנותנת לך שקט נפשי.</p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-6">
                        <FeatureCard
                            icon={<BrainCircuit className="w-8 h-8 text-indigo-400" />}
                            title="לומד מכל שיחה"
                            description="הבוט מנתח את כל היסטוריית השיחות שלך ולומד את סגנון הדיבור, המחירון והשירותים שלך."
                            delay={0.1}
                        />
                        <FeatureCard
                            icon={<Zap className="w-8 h-8 text-indigo-400" />}
                            title="100% אוטומציה מגנטית"
                            description="הלקוח הקליד הודעה? תוך 3 שניות הוא מקבל תשובה שמניעה לפעולה. בלי לחכות, בלי לאבד לידים."
                            delay={0.3}
                        />
                        <FeatureCard
                            icon={<ShieldCheck className="w-8 h-8 text-indigo-400" />}
                            title="שליטה היברידית"
                            description="הבוט יודע מתי לעצור ולהעביר אליך שיחות מורכבות. אתה תמיד שולט, מתערב ועוצר כשצריך."
                            delay={0.5}
                        />
                    </div>
                </div>
            </main>
        </div>
    );
}

function FeatureCard({ icon, title, description, delay }: { icon: React.ReactNode, title: string, description: string, delay: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.6, delay }}
            className="group relative bg-white/[0.03] border border-white/[0.05] p-8 rounded-3xl hover:bg-white/[0.05] transition-colors"
        >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl" />
            <div className="relative z-10">
                <div className="bg-white/5 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-white/10">
                    {icon}
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
                <p className="text-neutral-400 leading-relaxed text-[15px]">{description}</p>
            </div>
        </motion.div>
    );
}
