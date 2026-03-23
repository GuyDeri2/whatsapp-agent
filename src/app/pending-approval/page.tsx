"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Clock, LogOut } from "lucide-react";
import { motion } from "framer-motion";

export default function PendingApprovalPage() {
    const supabaseRef = useRef(createClient());
    const supabase = supabaseRef.current;
    const router = useRouter();
    const [userEmail, setUserEmail] = useState<string | null>(null);

    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setUserEmail(user.email ?? null);

            // If profile is already approved, redirect to dashboard
            const { data: profile } = await supabase
                .from("profiles")
                .select("status")
                .eq("id", user.id)
                .single();
            if (profile?.status === "approved") {
                router.replace("/dashboard");
            }
        };
        checkUser();
    }, [supabase, router]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push("/");
        router.refresh();
    };

    return (
        <div className="min-h-screen bg-black flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden font-sans selection:bg-emerald-500/30">
            {/* Background effects */}
            <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-600/20 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-900/20 blur-[120px] pointer-events-none" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="sm:mx-auto sm:w-full sm:max-w-md relative z-10"
                dir="rtl"
            >
                <div className="bg-white/[0.03] backdrop-blur-xl py-10 px-6 shadow-2xl sm:rounded-3xl border border-white/10 sm:px-10 text-center flex flex-col items-center">

                    <motion.div
                        initial={{ scale: 0.8 }}
                        animate={{ scale: 1 }}
                        transition={{
                            type: "spring",
                            stiffness: 260,
                            damping: 20,
                            delay: 0.1
                        }}
                        className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center mb-6 border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.15)]"
                    >
                        <Clock className="w-10 h-10 text-emerald-400" strokeWidth={1.5} />
                    </motion.div>

                    <motion.h2
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-2xl font-bold text-white mb-3"
                    >
                        החשבון שלך ממתין לאישור
                    </motion.h2>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="space-y-4 text-neutral-400 text-sm leading-relaxed"
                    >
                        <p>
                            שמחים שהצטרפת! המערכת זיהתה את ההרשמה של <br />
                            <strong className="text-emerald-400 font-medium">{userEmail}</strong>.
                        </p>
                        <p>
                            כדי לשמור על אבטחת הפלטפורמה, מנהל המערכת צריך לאשר את החשבון שלך לפני שתוכל לגשת לדשבורד ולחבר בוטים.
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="mt-8 mb-8 pt-6 border-t border-white/10 w-full"
                    >
                        <p className="text-neutral-500 text-sm">
                            נשלח לך עדכון כשהחשבון יאושר.
                        </p>
                    </motion.div>

                    <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        onClick={handleLogout}
                        className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-sm font-medium text-neutral-300 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all focus:outline-none focus:ring-2 focus:ring-neutral-500/50"
                    >
                        <LogOut className="w-4 h-4" />
                        התנתק בינתיים
                    </motion.button>
                </div>
            </motion.div>
        </div>
    );
}
