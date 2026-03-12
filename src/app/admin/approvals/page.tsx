"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ArrowRight, ShieldCheck } from "lucide-react";

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

    if (loading) return (
        <div className="min-h-screen bg-black flex items-center justify-center" dir="rtl">
            <div className="flex flex-col items-center gap-4 text-emerald-500">
                <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <p>טוען משתמשים...</p>
            </div>
        </div>
    );
    if (error) return (
        <div className="min-h-screen bg-black flex items-center justify-center" dir="rtl">
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl max-w-md text-center">
                <p className="font-semibold mb-1">שגיאה בטעינת הנתונים</p>
                <p className="text-sm opacity-80">{error}</p>
            </div>
        </div>
    );

    const pendingProfiles = profiles.filter(p => p.approval_status === "pending");
    const passedProfiles = profiles.filter(p => p.approval_status !== "pending");

    return (
        <div className="min-h-screen bg-neutral-950 font-sans selection:bg-emerald-500/30 text-neutral-200" dir="rtl">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10 pb-6 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">אישורי משתמשים</h1>
                            <p className="text-sm text-neutral-400">ניהול גישה לנרשמים חדשים במערכת</p>
                        </div>
                    </div>
                    <button
                        onClick={() => router.push("/dashboard")}
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-sm font-medium transition-all"
                    >
                        חזרה לדשבורד
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </button>
                </div>

                <div className="space-y-10">
                    {/* Pending Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <h2 className="text-lg font-semibold text-white">ממתינים לאישור</h2>
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold">
                                {pendingProfiles.length}
                            </span>
                        </div>

                        {pendingProfiles.length === 0 ? (
                            <div className="bg-white/5 border border-white/5 rounded-2xl p-8 text-center">
                                <p className="text-neutral-400">אין משתמשים הממתינים לאישור כרגע.</p>
                            </div>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {pendingProfiles.map(p => (
                                    <div key={p.id} className="bg-neutral-900 border border-white/10 rounded-2xl p-5 hover:border-emerald-500/30 transition-all group">
                                        <div className="mb-4">
                                            <div className="text-base font-medium text-white mb-1 truncate" title={p.email}>{p.email}</div>
                                            <div className="text-xs text-neutral-500">נרשם: {new Date(p.created_at).toLocaleDateString('he-IL')}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleUpdateStatus(p.id, "approved")}
                                                className="flex-1 flex items-center justify-center gap-2 py-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white border border-emerald-500/20 rounded-xl text-sm font-medium transition-all"
                                            >
                                                <Check className="w-4 h-4" />
                                                אשר
                                            </button>
                                            <button
                                                onClick={() => handleUpdateStatus(p.id, "rejected")}
                                                className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white border border-red-500/20 rounded-xl text-sm font-medium transition-all"
                                            >
                                                <X className="w-4 h-4" />
                                                דחה
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* History Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <h2 className="text-lg font-semibold text-white">היסטוריית אישורים</h2>
                            <span className="text-sm text-neutral-500 border border-white/10 px-2 py-0.5 rounded-full">
                                {passedProfiles.length} טופלו
                            </span>
                        </div>

                        <div className="bg-neutral-900 border border-white/10 rounded-2xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-right text-sm">
                                    <thead className="bg-neutral-950 border-b border-white/10 text-neutral-400 font-medium">
                                        <tr>
                                            <th className="px-6 py-4 whitespace-nowrap">אימייל</th>
                                            <th className="px-6 py-4 whitespace-nowrap">תאריך הרשמה</th>
                                            <th className="px-6 py-4 whitespace-nowrap">הרשאה</th>
                                            <th className="px-6 py-4 whitespace-nowrap">סטטוס</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {passedProfiles.map(p => (
                                            <tr key={p.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 text-white font-medium">{p.email}</td>
                                                <td className="px-6 py-4 text-neutral-400">{new Date(p.created_at).toLocaleDateString('he-IL')}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${p.role === 'admin'
                                                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                                            : 'bg-white/5 text-neutral-300 border-white/10'
                                                        }`}>
                                                        {p.role === 'admin' ? 'מנהל מערכת' : 'לקוח'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${p.approval_status === 'approved'
                                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                                        }`}>
                                                        {p.approval_status === 'approved' ? 'מאושר' : 'נדחה'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
