"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Bot, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

function mapAuthError(message: string): string {
    const map: Record<string, string> = {
        "Invalid login credentials": "אימייל או סיסמה שגויים",
        "Email not confirmed": "האימייל טרם אושר — בדוק את תיבת הדואר שלך",
        "User not found": "משתמש לא נמצא",
        "Too many requests": "יותר מדי ניסיונות — נסה שוב בעוד כמה דקות",
        "Email rate limit exceeded": "נשלחו יותר מדי אימיילים — נסה שוב מאוחר יותר",
        "User already registered": "משתמש עם אימייל זה כבר קיים",
    };
    return map[message] || "שגיאה בהתחברות — נסה שוב מאוחר יותר";
}

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

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const supabaseRef = useRef(createClient());

    const handleGoogleCredential = useCallback(async (response: { credential: string }) => {
        const { error: signInError } = await supabaseRef.current.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
        });
        if (signInError) {
            setError(mapAuthError(signInError.message));
        } else {
            window.location.href = "/dashboard";
        }
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlError = params.get("error");
        if (urlError) setError(decodeURIComponent(urlError));

        // Load Google Identity Services
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
            const btnEl = document.getElementById("google-signin-btn");
            if (btnEl) {
                window.google?.accounts.id.renderButton(btnEl, {
                    type: "standard",
                    theme: "filled_black",
                    size: "large",
                    text: "signin_with",
                    width: "400",
                    locale: "he",
                });
            }
        };
        document.head.appendChild(script);
        return () => { script.remove(); };
    }, [handleGoogleCredential]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error: signInError } = await supabaseRef.current.auth.signInWithPassword({
            email,
            password,
        });

        if (signInError) {
            setError(mapAuthError(signInError.message));
            setLoading(false);
        } else {
            window.location.href = "/dashboard";
        }
    };

    return (
        <div className="min-h-screen bg-transparent flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden font-sans selection:bg-emerald-500/30">
            {/* Background effects */}
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-600/20 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-900/20 blur-[120px] pointer-events-none" />

            <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-center"
                >
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 ring-1 ring-white/10">
                        <Bot className="w-10 h-10 text-white" />
                    </div>
                </motion.div>
                <motion.h2
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="mt-6 text-center text-3xl font-extrabold text-white tracking-tight"
                >
                    ברוכים השבים
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="mt-2 text-center text-sm text-neutral-400"
                >
                    התחברו פנימה כדי לנהל את סוכני ה-AI שלכם
                </motion.p>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10"
            >
                <div className="glass-panel py-8 px-4 sm:rounded-[2rem] sm:px-10">
                    <form className="space-y-6" onSubmit={handleLogin}>
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
                            <div className="flex items-center justify-between mb-1.5 px-1">
                                <label htmlFor="password" className="block text-sm font-medium text-neutral-300">
                                    סיסמה
                                </label>
                                <div className="text-sm">
                                    <Link href="/forgot-password" className="font-medium text-emerald-400 hover:text-emerald-300 transition-colors">
                                        שכחת סיסמה?
                                    </Link>
                                </div>
                            </div>
                            <div className="mt-1 relative rounded-xl shadow-sm">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <Lock className="h-5 w-5 text-neutral-500" />
                                </div>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="block w-full pl-4 pr-11 bg-black/40 border border-white/10 rounded-xl py-3 text-white placeholder-neutral-500 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all sm:text-sm"
                                    placeholder="••••••••"

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
                                        מתחבר...
                                    </>
                                ) : (
                                    <>
                                        התחבר
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
                                <span className="px-3 bg-black/60 text-neutral-400 rounded-full border border-white/5 backdrop-blur-sm">או התחבר באמצעות</span>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-center">
                            <div id="google-signin-btn" />
                        </div>
                    </div>
                </div>

                <p className="mt-8 text-center text-sm text-neutral-400">
                    עדיין אין לך חשבון?{" "}
                    <Link href="/register" className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                        הירשם חינם עכשיו
                    </Link>
                </p>
            </motion.div>
        </div>
    );
}
