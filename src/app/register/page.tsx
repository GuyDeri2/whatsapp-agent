"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Rocket, Mail, Lock, ArrowRight, Loader2, CheckCircle2, User } from "lucide-react";
import { motion } from "framer-motion";

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (config: Record<string, unknown>) => void;
                    renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
                };
            };
        };
    }
}

export default function RegisterPage() {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [emailSent, setEmailSent] = useState(false);
    const router = useRouter();
    const supabaseRef = useRef(createClient());

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { data: { session }, error: signUpError } = await supabaseRef.current.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${window.location.origin}/api/auth/callback`,
                data: { first_name: firstName, last_name: lastName },
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

    const handleGoogleCredential = useCallback(async (response: { credential: string }) => {
        const { error: signInError } = await supabaseRef.current.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
        });
        if (signInError) {
            setError(signInError.message);
        } else {
            window.location.href = "/dashboard";
        }
    }, []);

    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => {
            window.google?.accounts.id.initialize({
                client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
                callback: handleGoogleCredential,
                use_fedcm_for_prompt: false,
            });
            const btnEl = document.getElementById("google-signup-btn");
            if (btnEl) {
                window.google?.accounts.id.renderButton(btnEl, {
                    type: "standard",
                    theme: "filled_black",
                    size: "large",
                    text: "signup_with",
                    width: "400",
                    locale: "he",
                });
            }
        };
        document.head.appendChild(script);
        return () => { script.remove(); };
    }, [handleGoogleCredential]);

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

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="firstName" className="block text-sm font-medium text-neutral-300 mb-1.5 px-1">
                                    שם פרטי
                                </label>
                                <div className="relative rounded-xl shadow-sm">
                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <User className="h-4 w-4 text-neutral-500" />
                                    </div>
                                    <input
                                        id="firstName"
                                        name="firstName"
                                        type="text"
                                        autoComplete="given-name"
                                        required
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        className="block w-full pl-4 pr-10 bg-black/40 border border-white/10 rounded-xl py-3 text-white placeholder-neutral-500 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all sm:text-sm"
                                        placeholder="ישראל"
                                    />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="lastName" className="block text-sm font-medium text-neutral-300 mb-1.5 px-1">
                                    שם משפחה
                                </label>
                                <div className="relative rounded-xl shadow-sm">
                                    <input
                                        id="lastName"
                                        name="lastName"
                                        type="text"
                                        autoComplete="family-name"
                                        required
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        className="block w-full px-4 bg-black/40 border border-white/10 rounded-xl py-3 text-white placeholder-neutral-500 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all sm:text-sm"
                                        placeholder="ישראלי"
                                    />
                                </div>
                            </div>
                        </div>

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

                        <div className="mt-6 flex justify-center">
                            <div id="google-signup-btn" />
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
