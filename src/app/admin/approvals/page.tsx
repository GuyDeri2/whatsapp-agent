"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Profile {
    id: string;
    email: string;
    role: "admin" | "client";
    subscription_status: string;
    approval_status: "pending" | "approved" | "rejected";
    created_at: string;
}

export default function ApprovalsPage() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const fetchProfiles = async () => {
        try {
            const res = await fetch("/api/admin/profiles");
            if (!res.ok) throw new Error("Failed to load profiles");
            const data = await res.json();
            setProfiles(data.profiles || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProfiles();
    }, []);

    const handleUpdateStatus = async (profileId: string, newStatus: "approved" | "rejected") => {
        try {
            const res = await fetch("/api/admin/profiles", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profileId, approval_status: newStatus })
            });
            if (!res.ok) throw new Error("Failed to update status");
            
            // Refresh local state to reflect change instantly
            setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, approval_status: newStatus } : p));
        } catch (err: any) {
            alert(err.message);
        }
    };

    if (loading) return <div style={{ padding: "2rem", textAlign: "center", direction: "rtl" }}>טוען משתמשים...</div>;
    if (error) return <div style={{ padding: "2rem", color: "red", textAlign: "center", direction: "rtl" }}>שגיאה: {error}</div>;

    const pendingProfiles = profiles.filter(p => p.approval_status === "pending");
    const passedProfiles = profiles.filter(p => p.approval_status !== "pending");

    return (
        <div style={{ padding: "2rem", fontFamily: "System-ui, sans-serif", direction: "rtl", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
                <h1 style={{ fontSize: "2rem", color: "#1e293b", margin: 0 }}>ניהול אישורי משתמשים</h1>
                <button 
                    onClick={() => router.push("/dashboard")}
                    style={{ padding: "0.5rem 1rem", backgroundColor: "#e2e8f0", color: "#475569", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "500" }}
                >
                    חזרה לדשבורד
                </button>
            </div>

            <section style={{ marginBottom: "3rem" }}>
                <h2 style={{ fontSize: "1.25rem", color: "#f59e0b", marginBottom: "1rem" }}>
                    ממתינים לאישור ({pendingProfiles.length})
                </h2>
                {pendingProfiles.length === 0 ? (
                    <div style={{ padding: "2rem", backgroundColor: "#f8fafc", borderRadius: "12px", textAlign: "center", color: "#64748b" }}>
                        אין משתמשים שממתינים לאישור כרגע. איזה שקט.
                    </div>
                ) : (
                    <div style={{ display: "grid", gap: "1rem" }}>
                        {pendingProfiles.map(p => (
                            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.5rem", backgroundColor: "white", border: "1px solid #fcd34d", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                                <div>
                                    <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem" }}>{p.email}</h3>
                                    <div style={{ fontSize: "0.9rem", color: "#64748b" }}>נרשם בתאריך: {new Date(p.created_at).toLocaleDateString('he-IL')}</div>
                                </div>
                                <div style={{ display: "flex", gap: "1rem" }}>
                                    <button 
                                        onClick={() => handleUpdateStatus(p.id, "approved")}
                                        style={{ padding: "0.5rem 1.5rem", backgroundColor: "#10b981", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                                    >
                                        אשר משתמש
                                    </button>
                                    <button 
                                        onClick={() => handleUpdateStatus(p.id, "rejected")}
                                        style={{ padding: "0.5rem 1.5rem", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                                    >
                                        דחה משתמש
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <h2 style={{ fontSize: "1.25rem", color: "#10b981", marginBottom: "1rem" }}>
                    משתמשים שטופלו ({passedProfiles.length})
                </h2>
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "white", border: "1px solid #e2e8f0", borderRadius: "12px", overflow: "hidden" }}>
                        <thead>
                            <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                                <th style={{ textAlign: "right", padding: "1rem", color: "#475569" }}>אימייל</th>
                                <th style={{ textAlign: "right", padding: "1rem", color: "#475569" }}>תאריך יצירה</th>
                                <th style={{ textAlign: "right", padding: "1rem", color: "#475569" }}>הרשאות</th>
                                <th style={{ textAlign: "right", padding: "1rem", color: "#475569" }}>סטטוס</th>
                            </tr>
                        </thead>
                        <tbody>
                            {passedProfiles.map(p => (
                                <tr key={p.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                                    <td style={{ padding: "1rem" }}>{p.email}</td>
                                    <td style={{ padding: "1rem", color: "#64748b" }}>{new Date(p.created_at).toLocaleDateString('he-IL')}</td>
                                    <td style={{ padding: "1rem" }}>
                                        <span style={{ padding: "0.25rem 0.5rem", backgroundColor: p.role === 'admin' ? '#e0e7ff' : '#f1f5f9', color: p.role === 'admin' ? '#4f46e5' : '#475569', borderRadius: "4px", fontSize: "0.85rem" }}>
                                            {p.role === 'admin' ? 'מנהל מחירון' : 'לקוח'}
                                        </span>
                                    </td>
                                    <td style={{ padding: "1rem" }}>
                                        <span style={{ padding: "0.25rem 0.5rem", backgroundColor: p.approval_status === 'approved' ? '#dcfce7' : '#fee2e2', color: p.approval_status === 'approved' ? '#166534' : '#991b1b', borderRadius: "4px", fontSize: "0.85rem", fontWeight: "500" }}>
                                            {p.approval_status === 'approved' ? 'מאושר' : 'נדחה'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
