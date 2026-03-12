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
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", direction: "rtl", maxWidth: "1200px", margin: "0 auto", color: "#1e293b" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
                <h1 style={{ fontSize: "1.75rem", fontWeight: "700", color: "#0f172a", margin: 0 }}>ניהול אישורי משתמשים</h1>
                <button 
                    onClick={() => router.push("/dashboard")}
                    style={{ padding: "0.5rem 1rem", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
                >
                    חזרה לדשבורד
                </button>
            </div>

            <section style={{ marginBottom: "3rem" }}>
                <h2 style={{ fontSize: "1.15rem", fontWeight: "600", color: "#b45309", marginBottom: "0.75rem" }}>
                    ממתינים לאישור ({pendingProfiles.length})
                </h2>
                {pendingProfiles.length === 0 ? (
                    <div style={{ padding: "2rem", backgroundColor: "#fffbeb", border: "1px solid #fde68a", borderRadius: "12px", textAlign: "center", color: "#92400e" }}>
                        אין משתמשים שממתינים לאישור כרגע.
                    </div>
                ) : (
                    <div style={{ display: "grid", gap: "1rem" }}>
                        {pendingProfiles.map(p => (
                            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 1.5rem", backgroundColor: "#fff", border: "1px solid #fcd34d", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                                <div>
                                    <div style={{ fontSize: "1rem", fontWeight: "600", color: "#0f172a", marginBottom: "0.25rem" }}>{p.email}</div>
                                    <div style={{ fontSize: "0.875rem", color: "#64748b" }}>נרשם: {new Date(p.created_at).toLocaleDateString('he-IL')}</div>
                                </div>
                                <div style={{ display: "flex", gap: "0.75rem" }}>
                                    <button 
                                        onClick={() => handleUpdateStatus(p.id, "approved")}
                                        style={{ padding: "0.5rem 1.25rem", backgroundColor: "#10b981", color: "white", border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer" }}
                                    >
                                        אשר
                                    </button>
                                    <button 
                                        onClick={() => handleUpdateStatus(p.id, "rejected")}
                                        style={{ padding: "0.5rem 1.25rem", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer" }}
                                    >
                                        דחה
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <h2 style={{ fontSize: "1.15rem", fontWeight: "600", color: "#15803d", marginBottom: "0.75rem" }}>
                    משתמשים שטופלו ({passedProfiles.length})
                </h2>
                <div style={{ overflowX: "auto", backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ backgroundColor: "#f1f5f9", borderBottom: "2px solid #e2e8f0" }}>
                                <th style={{ textAlign: "right", padding: "0.875rem 1rem", fontSize: "0.875rem", fontWeight: "600", color: "#475569" }}>אימייל</th>
                                <th style={{ textAlign: "right", padding: "0.875rem 1rem", fontSize: "0.875rem", fontWeight: "600", color: "#475569" }}>תאריך יצירה</th>
                                <th style={{ textAlign: "right", padding: "0.875rem 1rem", fontSize: "0.875rem", fontWeight: "600", color: "#475569" }}>הרשאות</th>
                                <th style={{ textAlign: "right", padding: "0.875rem 1rem", fontSize: "0.875rem", fontWeight: "600", color: "#475569" }}>סטטוס</th>
                            </tr>
                        </thead>
                        <tbody>
                            {passedProfiles.map(p => (
                                <tr key={p.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                                    <td style={{ padding: "0.875rem 1rem", fontSize: "0.9375rem", fontWeight: "600", color: "#0f172a" }}>{p.email}</td>
                                    <td style={{ padding: "0.875rem 1rem", fontSize: "0.9375rem", color: "#475569" }}>{new Date(p.created_at).toLocaleDateString('he-IL')}</td>
                                    <td style={{ padding: "0.875rem 1rem" }}>
                                        <span style={{ padding: "0.25rem 0.625rem", backgroundColor: p.role === 'admin' ? '#e0e7ff' : '#f1f5f9', color: p.role === 'admin' ? '#4338ca' : '#334155', borderRadius: "6px", fontSize: "0.8125rem", fontWeight: "500" }}>
                                            {p.role === 'admin' ? 'מנהל מערכת' : 'לקוח'}
                                        </span>
                                    </td>
                                    <td style={{ padding: "0.875rem 1rem" }}>
                                        <span style={{ padding: "0.25rem 0.625rem", backgroundColor: p.approval_status === 'approved' ? '#dcfce7' : '#fee2e2', color: p.approval_status === 'approved' ? '#166534' : '#991b1b', borderRadius: "6px", fontSize: "0.8125rem", fontWeight: "600" }}>
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
