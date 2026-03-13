"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Rocket, Mail, Lock, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

export default function RegisterPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [emailSent, setEmailSent] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { data: { session }, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${window.location.origin}/api/auth/callback`,
            }
        });

        if (signUpError) {
            setError(signUpError.message);
            setLoading(false);
        } else if (!session) {
            // Email confirmation required — session is null until user clicks the link
            setEmailSent(true);
            setLoading(false);
        } else {
            window.location.href = "/dashboard";
        }
    };

    const handleGoogleLogin = async () => {
        const { error: googleError } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/api/auth/callback`,
            }
        });
        if (googleError) setError(googleError.message);
    };

    if (emailSent) {
        return (
            <div className="min-h-screen bg-black flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden font-sans" dir="rtl">
                <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-600/20 blur-[120px] pointer-events-none" />
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="sm:mx-auto sm:w-full sm:max-w-md relative z-10"
                >
                    <div className="bg-white/[0.03] backdrop-blur-xl py-10 px-6 shadow-2xl sm:rounded-3xl border border-white/10 sm:px-10 text-center flex flex-col items-center">
                        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-6 border border-emerald-500/20">
                            <CheckCircle2 className="w-9 h-9 text-emerald-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-3">בדוק את המייל שלך</h2>
                        <p className="text-neutral-400 text-sm leading-relaxed mb-2">
                            שלחנו קישור אישור לכתובת
                        </p>
                        <p className="text-emerald-400 font-medium mb-6">{email}</p>
                        <p className="text-neutral-500 text-sm">
                            לחץ על הקישור במייל כדי לאשר את החשבון ולהמשיך להרשמה.
                        </p>
                    </div>
                </motion.div>
            </div>
        );
    }

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
                        <Rocket className="w-10 h-10 text-white" />
                    </div>
                </motion.div>
                <motion.h2
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="mt-6 text-center text-3xl font-extrabold text-white tracking-tight"
                >
                    הרשמה חינם
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="mt-2 text-center text-sm text-neutral-400"
                >
                    הצטרף והתחל לבנות את הסוכנים שלך
                </motion.p>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10"
            >
                <div className="bg-white/[0.03] backdrop-blur-xl py-8 px-4 shadow-2xl sm:rounded-3xl border border-white/10 sm:px-10">
                    <form className="space-y-6" onSubmit={handleRegister}>
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm text-center">
                                {error}
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
                            <label htmlFor="password" className="block text-sm font-medium text-neutral-300 mb-1.5 px-1">
                                סיסמה
                            </label>
                            <div className="mt-1 relative rounded-xl shadow-sm">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <Lock className="h-5 w-5 text-neutral-500" />
                                </div>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    minLength={6}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="block w-full pl-4 pr-11 bg-black/40 border border-white/10 rounded-xl py-3 text-white placeholder-neutral-500 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all sm:text-sm"
                                    placeholder="מינימום 6 תווים"
                                    
                                />
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin ml-2" />
                                        נרשם...
                                    </>
                                ) : (
                                    <>
                                        הירשם עכשיו
                                        <ArrowRight className="w-4 h-4 mr-2" />
                                    </>
                                )}
                            </button>
                        </div>
                    </form>

                    <div className="mt-8">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-white/10" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-3 bg-black/60 text-neutral-400 rounded-full border border-white/5 backdrop-blur-sm">או המשך באמצעות</span>
                            </div>
                        </div>

                        <div className="mt-6">
                            <button
                                onClick={handleGoogleLogin}
                                className="w-full inline-flex justify-center items-center py-3 px-4 border borders-neutral-700 rounded-xl shadow-sm bg-white/5 hover:bg-white/10 text-sm font-medium text-white transition-all"
                            >
                                <svg className="h-5 w-5 ml-2" aria-hidden="true" viewBox="0 0 24 24">
                                    <path
                                        d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z"
                                        fill="#EA4335"
                                    />
                                    <path
                                        d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z"
                                        fill="#4285F4"
                                    />
                                    <path
                                        d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z"
                                        fill="#FBBC05"
                                    />
                                    <path
                                        d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.26538 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z"
                                        fill="#34A853"
                                    />
                                </svg>
                                המשך עם Google
                            </button>
                        </div>
                    </div>
                </div>

                <p className="mt-8 text-center text-sm text-neutral-400">
                    כבר יש לך חשבון?{" "}
                    <Link href="/login" className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                        התחבר כאן
                    </Link>
                </p>
            </motion.div>
        </div>
    );
}
