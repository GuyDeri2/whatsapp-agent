"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Users, Webhook, Trash2, Save, CheckCircle2, Send, ExternalLink } from "lucide-react";

interface Lead {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    summary: string | null;
    created_at: string;
    conversation_id: string;
}

const LeadsTab = React.memo(function LeadsTab({ tenant }: { tenant: { id: string; lead_webhook_url?: string | null } }) {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [webhookUrl, setWebhookUrl] = useState<string>(tenant?.lead_webhook_url ?? "");
    const [webhookSaving, setWebhookSaving] = useState(false);
    const [webhookSaved, setWebhookSaved] = useState(false);

    const [exporting, setExporting] = useState(false);
    const [exportToast, setExportToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

    // Sync webhook URL when tenant prop changes
    useEffect(() => {
        setWebhookUrl(tenant?.lead_webhook_url ?? "");
    }, [tenant?.lead_webhook_url]);

    const fetchLeads = useCallback(async () => {
        if (!tenant?.id) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/leads`);
            if (!res.ok) throw new Error("Failed to fetch leads");
            const data = await res.json();
            setLeads(data);
        } catch (err) {
            setError("שגיאה בטעינת הלידים");
        } finally {
            setLoading(false);
        }
    }, [tenant?.id]);

    useEffect(() => {
        fetchLeads();
    }, [fetchLeads]);

    const showToast = (message: string, type: "success" | "error") => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleSaveWebhook = async () => {
        // Fix #9: Client-side URL validation
        if (webhookUrl) {
            try {
                const parsed = new URL(webhookUrl);
                if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
            } catch {
                showToast("כתובת Webhook לא תקינה", "error");
                return;
            }
        }

        setWebhookSaving(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lead_webhook_url: webhookUrl || null }),
            });
            if (!res.ok) throw new Error("Save failed");
            setWebhookSaved(true);
            setTimeout(() => setWebhookSaved(false), 2500);
        } catch {
            // Fix #8: Replace alert() with toast
            showToast("שגיאה בשמירת ה-Webhook URL", "error");
        }
        setWebhookSaving(false);
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/leads/export`, { method: "POST" });
            if (!res.ok) throw new Error("Export failed");
            setExportToast({ message: "הלידים נשלחו בהצלחה ל-Webhook!", type: "success" });
        } catch {
            setExportToast({ message: "שגיאה בשליחה ל-Webhook", type: "error" });
        } finally {
            setExporting(false);
            setTimeout(() => setExportToast(null), 3000);
        }
    };

    const handleDelete = async (id: string) => {
        // Fix #6: Confirmation before delete
        if (!window.confirm("למחוק את הליד הזה?")) return;

        // Optimistic delete
        const prev = leads;
        setLeads(leads.filter(l => l.id !== id));
        try {
            const res = await fetch(`/api/tenants/${tenant.id}/leads/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Delete failed");
        } catch {
            setLeads(prev); // Revert
        }
    };

    const truncate = (text: string | null, max: number) => {
        if (!text) return null;
        return text.length > max ? text.substring(0, max) + "…" : text;
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto" dir="rtl">

            {/* General toast */}
            {toast && (
                <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-xl border transition-all ${
                    toast.type === "success"
                        ? "bg-emerald-600/90 text-white border-emerald-500/50"
                        : "bg-red-600/90 text-white border-red-500/50"
                }`}>
                    {toast.message}
                </div>
            )}

            {/* Export toast */}
            {exportToast && (
                <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-xl border transition-all ${
                    exportToast.type === "success"
                        ? "bg-emerald-600/90 text-white border-emerald-500/50"
                        : "bg-red-600/90 text-white border-red-500/50"
                }`}>
                    {exportToast.message}
                </div>
            )}

            {/* Header */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>

                <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0 ring-1 ring-violet-500/30">
                        <Users className="w-6 h-6 text-violet-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white tracking-tight">לידים</h2>
                </div>

                <p className="text-neutral-400 text-sm max-w-3xl leading-relaxed pr-16 bg-white/5 inline-block px-4 py-2 rounded-lg border border-white/5">
                    כאן נשמרים הלידים שנאספו על ידי הסוכן. כשלקוח מועבר לנציג אנושי, פרטיו נשמרים אוטומטית.
                </p>
            </div>

            {/* Webhook URL Section */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-64 h-64 bg-violet-500/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>

                <div className="flex items-center gap-4 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0 ring-1 ring-violet-500/30">
                        <Webhook className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Webhook לידים</h3>
                        <p className="text-sm text-neutral-400">הכנס כתובת Webhook מ-Make.com, Zapier, או כל שירות אחר</p>
                    </div>
                </div>

                <p className="text-sm text-neutral-500 mb-5 pr-14">
                    כשלקוח מועבר לנציג, פרטיו יישלחו אוטומטית לכתובת זו
                </p>

                {/* Data fields info */}
                <div className="mt-4 bg-black/30 border border-white/5 rounded-2xl p-4 text-xs text-neutral-400 mb-5 space-y-1">
                    <p className="font-semibold text-neutral-300 mb-2">המידע שיישלח ב-POST:</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                            ["👤 name", "שם"],
                            ["📞 phone", "טלפון"],
                            ["📧 email", "מייל"],
                            ["📋 summary", "סיכום שיחה"],
                        ].map(([field, label]) => (
                            <div key={field} className="bg-white/5 rounded-xl px-3 py-2 border border-white/5">
                                <div className="font-mono text-violet-400 font-semibold">{field}</div>
                                <div className="text-neutral-500 text-[11px]">{label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* URL input + save */}
                <div className="flex gap-3 items-center mb-6">
                    <input
                        type="url"
                        placeholder="https://hook.eu1.make.com/..."
                        value={webhookUrl}
                        onChange={e => setWebhookUrl(e.target.value)}
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm transition-all placeholder:text-neutral-600"
                        dir="ltr"
                    />
                    <button
                        onClick={handleSaveWebhook}
                        disabled={webhookSaving}
                        className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all shrink-0 ${
                            webhookSaved
                                ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-violet-600 hover:bg-violet-500 text-white"
                        }`}
                    >
                        {webhookSaved ? (
                            <><CheckCircle2 className="w-4 h-4" /> נשמר!</>
                        ) : (
                            <><Save className="w-4 h-4" /> שמור</>
                        )}
                    </button>
                </div>

                {/* Make.com guide */}
                <div className="bg-black/30 border border-violet-500/10 rounded-2xl p-4 text-xs text-neutral-400">
                    <p className="font-semibold text-violet-300 mb-2 flex items-center gap-2">
                        <ExternalLink className="w-3.5 h-3.5" />
                        איך מחברים ל-Make:
                    </p>
                    <ol className="space-y-1 list-decimal list-inside">
                        <li>צור Scenario חדש</li>
                        <li>הוסף מודול <span className="text-violet-400 font-medium">Webhooks &gt; Custom webhook</span></li>
                        <li>העתק את הכתובת והדבק כאן</li>
                        <li>הפעל את ה-Scenario</li>
                    </ol>
                </div>

                {/* Export button */}
                {tenant?.lead_webhook_url && (
                    <div className="mt-5">
                        <button
                            onClick={handleExport}
                            disabled={exporting}
                            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-60"
                        >
                            <Send className="w-4 h-4" />
                            {exporting ? "שולח..." : "שלח לידים ל-Webhook"}
                        </button>
                    </div>
                )}
            </div>

            {/* Leads Table */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-violet-500/5 rounded-full blur-[100px] pointer-events-none -z-10"></div>

                <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
                    <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0 border border-violet-500/30">
                        <Users className="w-5 h-5 text-violet-400" />
                    </div>
                    <h3 className="text-xl font-bold text-white">רשימת לידים</h3>
                    {!loading && (
                        <span className="text-xs px-2 py-0.5 bg-white/5 rounded-full text-neutral-400 font-normal">
                            {leads.length}
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center text-neutral-500 py-16">
                        <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mb-4"></div>
                        <p>טוען לידים...</p>
                    </div>
                ) : error ? (
                    <div className="text-center py-12 text-red-400">{error}</div>
                ) : leads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 bg-black/20 border-2 border-dashed border-white/5 rounded-2xl">
                        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                            <Users className="w-8 h-8 text-neutral-500" />
                        </div>
                        <h3 className="text-lg font-medium text-neutral-300 mb-2">אין לידים עדיין</h3>
                        <p className="text-neutral-500 max-w-sm">
                            כשלקוח יועבר לנציג, הפרטים שלו יופיעו כאן
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-neutral-400 font-medium border-b border-white/5">
                                    <th className="text-right pb-3 px-2">שם</th>
                                    <th className="text-right pb-3 px-2">טלפון</th>
                                    <th className="text-right pb-3 px-2">מייל</th>
                                    <th className="text-right pb-3 px-2">סיכום</th>
                                    <th className="text-right pb-3 px-2">תאריך</th>
                                    <th className="text-right pb-3 px-2">פעולות</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leads.map(lead => (
                                    <tr key={lead.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                        <td className="py-3 px-2 text-white">
                                            {lead.name ?? <span className="text-neutral-600">—</span>}
                                        </td>
                                        <td className="py-3 px-2">
                                            <span className="font-mono text-neutral-300 text-xs">{lead.phone}</span>
                                        </td>
                                        <td className="py-3 px-2 text-neutral-300">
                                            {lead.email ?? <span className="text-neutral-600">—</span>}
                                        </td>
                                        <td className="py-3 px-2 text-neutral-400 max-w-[200px]">
                                            {lead.summary ? (
                                                <span title={lead.summary}>{truncate(lead.summary, 60)}</span>
                                            ) : (
                                                <span className="text-neutral-600">—</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-2 text-neutral-500 whitespace-nowrap text-xs">
                                            {new Date(lead.created_at).toLocaleDateString("he-IL")}
                                        </td>
                                        <td className="py-3 px-2">
                                            <button
                                                onClick={() => handleDelete(lead.id)}
                                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-2 rounded-lg transition-all"
                                                title="מחק ליד"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
});

export { LeadsTab };
