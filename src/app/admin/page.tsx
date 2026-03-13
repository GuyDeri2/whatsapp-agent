import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import Link from "next/link";
import { Users, Building2, Zap, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
    // Use service-role client for data — RLS would otherwise filter out other users' profiles
    const admin = getSupabaseAdmin();

    const { data: profiles } = await admin
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

    const { data: tenants } = await admin
        .from("tenants")
        .select("id, owner_id, business_name, agent_mode, whatsapp_connected");

    const clients = (profiles ?? []).map((profile) => {
        const clientTenants = (tenants ?? []).filter((t) => t.owner_id === profile.id);
        return { ...profile, businessCount: clientTenants.length, businesses: clientTenants };
    });

    const totalClients = clients.filter(c => c.role === "client").length;
    const activeSubscriptions = clients.filter(c => c.subscription_status === "active").length;
    const totalBusinesses = tenants?.length ?? 0;
    const pendingCount = clients.filter(c => c.approval_status === "pending").length;

    const stats = [
        { label: "לקוחות רשומים", value: totalClients, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
        { label: "מנויים פעילים", value: activeSubscriptions, icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
        { label: "עסקים במערכת", value: totalBusinesses, icon: Building2, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
        { label: "ממתינים לאישור", value: pendingCount, icon: Clock, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
    ];

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white">סקירה כללית</h1>
                <p className="text-neutral-500 text-sm mt-1">ניהול לקוחות ועסקים בפלטפורמה</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
                {stats.map((s) => (
                    <div key={s.label} className="bg-neutral-900 border border-white/5 rounded-2xl p-5">
                        <div className={`w-10 h-10 rounded-xl ${s.bg} border flex items-center justify-center mb-4`}>
                            <s.icon className={`w-5 h-5 ${s.color}`} />
                        </div>
                        <div className={`text-3xl font-bold ${s.color} mb-1`}>{s.value}</div>
                        <div className="text-sm text-neutral-500">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Clients table */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">ניהול לקוחות</h2>
                <Link
                    href="/admin/approvals"
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-sm font-medium rounded-xl transition-all"
                >
                    {pendingCount > 0 && (
                        <span className="w-5 h-5 flex items-center justify-center rounded-full bg-orange-500 text-white text-xs font-bold">
                            {pendingCount}
                        </span>
                    )}
                    אישור משתמשים חדשים ←
                </Link>
            </div>

            <div className="bg-neutral-900 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                        <thead className="bg-neutral-950 border-b border-white/5 text-neutral-400 font-medium">
                            <tr>
                                <th className="px-6 py-4 whitespace-nowrap">לקוח</th>
                                <th className="px-6 py-4 whitespace-nowrap">תפקיד</th>
                                <th className="px-6 py-4 whitespace-nowrap">סטטוס</th>
                                <th className="px-6 py-4 whitespace-nowrap">אישור</th>
                                <th className="px-6 py-4 whitespace-nowrap">עסקים</th>
                                <th className="px-6 py-4 whitespace-nowrap">הצטרף</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {clients.map((client) => (
                                <tr key={client.id} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-white">{client.email}</div>
                                        {client.businesses.length > 0 && (
                                            <div className="text-xs text-neutral-500 mt-0.5">
                                                {client.businesses.map((b: any) => b.business_name).join(", ")}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                                            client.role === "admin"
                                                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                : "bg-white/5 text-neutral-400 border-white/10"
                                        }`}>
                                            {client.role === "admin" ? "מנהל" : "לקוח"}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                                            client.subscription_status === "active"
                                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                : "bg-white/5 text-neutral-400 border-white/10"
                                        }`}>
                                            {client.subscription_status === "trial" && "ניסיון"}
                                            {client.subscription_status === "active" && "פעיל"}
                                            {client.subscription_status === "past_due" && "בפיגור"}
                                            {client.subscription_status === "canceled" && "בוטל"}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                                            client.approval_status === "approved"
                                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                : client.approval_status === "pending"
                                                ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                                : "bg-red-500/10 text-red-400 border-red-500/20"
                                        }`}>
                                            {client.approval_status === "approved" && "מאושר"}
                                            {client.approval_status === "pending" && "ממתין"}
                                            {client.approval_status === "rejected" && "נדחה"}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-neutral-400">{client.businessCount}</td>
                                    <td className="px-6 py-4 text-neutral-400 whitespace-nowrap">
                                        {new Date(client.created_at).toLocaleDateString("he-IL")}
                                    </td>
                                </tr>
                            ))}
                            {clients.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-neutral-500">
                                        אין משתמשים במערכת עדיין.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
