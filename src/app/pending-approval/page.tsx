"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function PendingApprovalPage() {
    const supabase = createClient();
    const router = useRouter();
    const [userEmail, setUserEmail] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) {
                setUserEmail(user.email ?? null);
            }
        });
    }, [supabase.auth]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push("/");
        router.refresh();
    };

    return (
        <div style={{
            fontFamily: "System-ui, sans-serif",
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#f8fafc",
            direction: "rtl"
        }}>
            <div style={{
                backgroundColor: "white",
                padding: "3rem",
                borderRadius: "16px",
                boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                textAlign: "center",
                maxWidth: "500px",
                width: "90%"
            }}>
                <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>⏳</div>
                <h1 style={{ color: "#1e293b", fontSize: "1.8rem", marginBottom: "1rem" }}>
                    החשבון שלך ממתין לאישור
                </h1>
                <p style={{ color: "#475569", lineHeight: "1.6", marginBottom: "2rem", fontSize: "1.1rem" }}>
                    שמחים שהצטרפת! המערכת זיהתה את ההרשמה של <strong>{userEmail}</strong>. 
                    כדי לשמור על אבטחת הפלטפורמה, מנהל המערכת צריך לאשר את החשבון שלך לפני שתוכל לגשת לדשבורד ולחבר בוטים.
                </p>
                <p style={{ color: "#64748b", fontSize: "0.95rem", marginBottom: "3rem" }}>
                    נשלח לך עדכון כשהחשבון יאושר.
                </p>
                
                <button 
                    onClick={handleLogout}
                    style={{
                        padding: "0.75rem 1.5rem",
                        backgroundColor: "#f1f5f9",
                        color: "#475569",
                        border: "none",
                        borderRadius: "8px",
                        fontWeight: "500",
                        cursor: "pointer",
                        transition: "background 0.2s"
                    }}
                >
                    התנתק בינתיים
                </button>
            </div>
        </div>
    );
}
