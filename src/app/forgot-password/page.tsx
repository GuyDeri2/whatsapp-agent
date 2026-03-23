"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { KeyRound, Mail, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState<{ type: "error" | "success" | null; message: string }>({ type: null, message: "" });
    const [loading, setLoading] = useState(false);
    const supabaseRef = useRef(createClient());

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus({ type: null, message: "" });

        const { error } = await supabaseRef.current.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });

        if (error) {
            setStatus({ type: "error", message: error.message });
        } else {
            setStatus({ type: "success", message: "נשלח אליך אימייל עם קישור לאיפוס הסיסמה. אנא בדוק את תיבת הדואר הנכנס שלך." });
            setEmail("");
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-black flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden font-sans selection:bg-emerald-500/30">
            {/* Background effects */}
            <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-600/20 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-900/20 blur-[120px] pointer-events-none" />

            <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-center"
                >
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 ring-1 ring-white/10">
                        <KeyRound className="w-10 h-10 text-white" />
                    </div>
                </motion.div>
                <motion.h2
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="mt-6 text-center text-3xl font-extrabold text-white tracking-tight"
                >
                    שחזור סיסמה
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="mt-2 text-center text-sm text-neutral-400"
                >
                    הכנס את האימייל שאיתו נרשמת למערכת
                </motion.p>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10"
            >
                <div className="bg-white/[0.03] backdrop-blur-xl py-8 px-4 shadow-2xl sm:rounded-3xl border border-white/10 sm:px-10">
                    <form className="space-y-6" onSubmit={handleReset}>
                        {status.type === "error" && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm text-center">
                                {status.message}
                            </div>
                        )}
                        {status.type === "success" && (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-sm text-center">
                                {status.message}
                            </div>
                        )}

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-neutral-300 mb-1.5 px-1">
                                כתובת אימייל
                            </label>
                            <div className="mt-1 relative rounded-xl shadow-sm">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <Mail className="h-5 w-5 text-neutral-500" />
                                </div>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="block w-full pl-4 pr-11 bg-black/40 border border-white/10 rounded-xl py-3 text-white placeholder-neutral-500 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all sm:text-sm"
                                    placeholder="you@example.com"
                                    
                                />
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading || status.type === "success"}
                                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin ml-2" />
                                        שולח...
                                    </>
                                ) : (
                                    <>
                                        שלח קישור לאיפוס
                                        <ArrowRight className="w-4 h-4 mr-2" />
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>

                <p className="mt-8 text-center text-sm text-neutral-400">
                    חזרה לעמוד{" "}
                    <Link href="/login" className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                        התחברות
                    </Link>
                </p>
            </motion.div>
        </div>
    );
}
