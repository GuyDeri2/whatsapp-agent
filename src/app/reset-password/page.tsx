"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ResetPasswordPage() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [status, setStatus] = useState<{ type: "error" | "success" | null; message: string }>({ type: null, message: "" });
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        // If the user isn't holding a recovery session, they shouldn't be here in theory
        // but we'll let supabase handle the validation during updateUser
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) {
                // Not strictly an error here as the session might be established in the query params implicitly
                // but good to check.
            }
        });
    }, [supabase.auth]);

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus({ type: null, message: "" });

        if (password !== confirmPassword) {
            setStatus({ type: "error", message: "הסיסמאות אינן תואמות" });
            setLoading(false);
            return;
        }

        const { error } = await supabase.auth.updateUser({
            password: password
        });

        if (error) {
            setStatus({ type: "error", message: error.message });
            setLoading(false);
        } else {
            setStatus({ type: "success", message: "הסיסמה עודכנה בהצלחה!" });
            setTimeout(() => {
                router.push("/dashboard");
                router.refresh();
            }, 2000);
        }
    };

    return (
        <div className="login-container" style={{ direction: "rtl" }}>
            <div className="login-card">
                <div className="login-header">
                    <div className="login-icon">🔒</div>
                    <h1>סיסמה חדשה</h1>
                    <p>בחר סיסמה חדשה עבור החשבון שלך</p>
                </div>

                <form onSubmit={handleUpdate} className="login-form">
                    {status.type === "error" && <div className="login-error">{status.message}</div>}
                    {status.type === "success" && (
                        <div style={{ padding: "0.75rem", backgroundColor: "#dcfce7", color: "#166534", borderRadius: "8px", marginBottom: "1.5rem", fontSize: "0.95rem", border: "1px solid #bbf7d0" }}>
                            {status.message}
                        </div>
                    )}

                    <div className="form-group">
                        <label htmlFor="password">סיסמה חדשה</label>
                        <input
                            id="password"
                            type="password"
                            placeholder="מינימום 6 תווים"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                        />
                    </div>
                    
                    <div className="form-group">
                        <label htmlFor="confirmPassword">אימות סיסמה</label>
                        <input
                            id="confirmPassword"
                            type="password"
                            placeholder="הקלד שוב את הסיסמה"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            minLength={6}
                        />
                    </div>

                    <button type="submit" className="login-button" disabled={loading || status.type === "success"}>
                        {loading ? "מעדכן…" : "עדכן סיסמה"}
                    </button>
                    
                    <div style={{ marginTop: "2rem", textAlign: "center", fontSize: "0.95rem", color: "#64748b" }}>
                        חזרה לעמוד <Link href="/login" style={{ color: "#2563eb", textDecoration: "none", fontWeight: "600" }}>התחברות</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
