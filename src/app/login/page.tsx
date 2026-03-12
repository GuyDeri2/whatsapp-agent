"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            window.location.href = "/dashboard";
        }
    };

    const handleGoogleLogin = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/api/auth/callback`,
            }
        });
        if (error) setError(error.message);
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-icon">💬</div>
                    <h1>סוכן ווטסאפ</h1>
                    <p>התחבר לדשבורד העסקי שלך</p>
                </div>

                <form onSubmit={handleLogin} className="login-form">
                    {error && <div className="login-error">{error}</div>}

                    <div className="form-group">
                        <label htmlFor="email">אימייל</label>
                        <input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <label htmlFor="password">סיסמה</label>
                            <Link href="/forgot-password" style={{ fontSize: "0.85rem", color: "#2563eb", textDecoration: "none" }}>שכחת סיסמה?</Link>
                        </div>
                        <input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    <button type="submit" className="login-button" disabled={loading}>
                        {loading ? "מתחבר…" : "התחבר"}
                    </button>

                    <div style={{ margin: "1.5rem 0", display: "flex", alignItems: "center", textAlign: "center", color: "#94a3b8" }}>
                        <div style={{ flex: 1, borderTop: "1px solid #e2e8f0" }}></div>
                        <span style={{ padding: "0 10px", fontSize: "0.9rem" }}>או</span>
                        <div style={{ flex: 1, borderTop: "1px solid #e2e8f0" }}></div>
                    </div>
                    
                    <button 
                        type="button" 
                        onClick={handleGoogleLogin}
                        style={{
                            width: "100%",
                            padding: "0.75rem",
                            backgroundColor: "white",
                            border: "1px solid #cbd5e1",
                            borderRadius: "8px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "10px",
                            fontWeight: "500",
                            color: "#334155",
                            cursor: "pointer",
                            transition: "background 0.2s"
                        }}
                    >
                        <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" width={20} height={20} />
                        המשך עם Google
                    </button>
                </form>

                <div style={{ marginTop: "2rem", textAlign: "center", fontSize: "0.95rem", color: "#64748b" }}>
                    אין לך חשבון? <Link href="/register" style={{ color: "#2563eb", textDecoration: "none", fontWeight: "600" }}>הירשם חינם</Link>
                </div>
            </div>
        </div>
    );
}
