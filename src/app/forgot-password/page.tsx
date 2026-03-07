"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState<{ type: "error" | "success" | null; message: string }>({ type: null, message: "" });
    const [loading, setLoading] = useState(false);
    const supabase = createClient();

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus({ type: null, message: "" });

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
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
        <div className="login-container" style={{ direction: "rtl" }}>
            <div className="login-card">
                <div className="login-header">
                    <div className="login-icon">🔑</div>
                    <h1>שחזור סיסמה</h1>
                    <p>הכנס את האימייל שאיתו נרשמת למערכת</p>
                </div>

                <form onSubmit={handleReset} className="login-form">
                    {status.type === "error" && <div className="login-error">{status.message}</div>}
                    {status.type === "success" && (
                        <div style={{ padding: "0.75rem", backgroundColor: "#dcfce7", color: "#166534", borderRadius: "8px", marginBottom: "1.5rem", fontSize: "0.95rem", border: "1px solid #bbf7d0" }}>
                            {status.message}
                        </div>
                    )}

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

                    <button type="submit" className="login-button" disabled={loading || status.type === "success"}>
                        {loading ? "שולח…" : "שלח קישור לאיפוס"}
                    </button>
                    
                    <div style={{ marginTop: "2rem", textAlign: "center", fontSize: "0.95rem", color: "#64748b" }}>
                        חזרה לעמוד <Link href="/login" style={{ color: "#2563eb", textDecoration: "none", fontWeight: "600" }}>התחברות</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
