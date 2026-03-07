"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LandingPage() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setIsLoggedIn(!!session);
        });
    }, [supabase.auth]);

    return (
        <div style={{ fontFamily: "System-ui, sans-serif", backgroundColor: "#f8fafc", minHeight: "100vh", direction: "rtl" }}>
            {/* Navigation */}
            <nav style={{ display: "flex", justifyContent: "space-between", padding: "1.5rem 2rem", alignItems: "center", backgroundColor: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#2563eb" }}>🤖 סוכן ווטסאפ AI</div>
                <div style={{ display: "flex", gap: "1rem" }}>
                    {isLoggedIn ? (
                        <Link href="/dashboard" style={{ padding: "0.5rem 1.2rem", backgroundColor: "#2563eb", color: "white", borderRadius: "6px", textDecoration: "none", fontWeight: "500" }}>
                            המשך לדשבורד
                        </Link>
                    ) : (
                        <>
                            <Link href="/login" style={{ padding: "0.5rem 1.2rem", color: "#475569", textDecoration: "none", fontWeight: "500" }}>
                                התחברות
                            </Link>
                            <Link href="/register" style={{ padding: "0.5rem 1.2rem", backgroundColor: "#2563eb", color: "white", borderRadius: "6px", textDecoration: "none", fontWeight: "500" }}>
                                הרשמה חינם
                            </Link>
                        </>
                    )}
                </div>
            </nav>

            {/* Hero Section */}
            <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "4rem 2rem", textAlign: "center" }}>
                <h1 style={{ fontSize: "3.5rem", color: "#1e293b", marginBottom: "1.5rem", lineHeight: "1.2" }}>
                    שירות הלקוחות שלך,<br />
                    <span style={{ color: "#2563eb" }}>על טייס אוטומטי.</span>
                </h1>
                <p style={{ fontSize: "1.25rem", color: "#475569", maxWidth: "600px", margin: "0 auto 2.5rem", lineHeight: "1.6" }}>
                    סוכן AI חכם שלומד את העסק שלך ועונה ללקוחות בווטסאפ 24/7.
                    תן לבינה המלאכותית שלנו לסגור עסקאות בשבילך בזמן שאתה ישן.
                </p>
                <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
                    {!isLoggedIn && (
                        <Link href="/register" style={{ padding: "0.75rem 2rem", fontSize: "1.1rem", backgroundColor: "#2563eb", color: "white", borderRadius: "8px", textDecoration: "none", fontWeight: "600", boxShadow: "0 4px 6px rgba(37, 99, 235, 0.2)" }}>
                            התחל עכשיו
                        </Link>
                    )}
                </div>

                {/* Features Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem", marginTop: "5rem", textAlign: "right" }}>
                    <div style={{ backgroundColor: "white", padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}>
                        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🧠</div>
                        <h3 style={{ fontSize: "1.25rem", color: "#1e293b", marginBottom: "0.5rem" }}>לומד באופן אוטומטי</h3>
                        <p style={{ color: "#64748b", lineHeight: "1.5" }}>הבוט קורא את התשובות שאתה שולח ללקוחות ולומד מהן איך לענות בעצמו לפניות דומות בעתיד.</p>
                    </div>
                    <div style={{ backgroundColor: "white", padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}>
                        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚡</div>
                        <h3 style={{ fontSize: "1.25rem", color: "#1e293b", marginBottom: "0.5rem" }}>תגובות מיידיות</h3>
                        <p style={{ color: "#64748b", lineHeight: "1.5" }}>לקוחות מעריכים מהירות. הבוט עונה לפנייה תוך שניות בודדות, מה שמעלה את אחוזי ההמרה.</p>
                    </div>
                    <div style={{ backgroundColor: "white", padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}>
                        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🔒</div>
                        <h3 style={{ fontSize: "1.25rem", color: "#1e293b", marginBottom: "0.5rem" }}>שליטה מלאה</h3>
                        <p style={{ color: "#64748b", lineHeight: "1.5" }}>יכולת להתערב בכל רגע בשיחה. הבוט יודע מתי להפנות לקוח מורכב ישירות אליך לעזרה אנושית.</p>
                    </div>
                </div>
            </main>
        </div>
    );
}
