import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, MessageSquare, Wifi, WifiOff } from "lucide-react";
import { GrantScansButton } from "./GrantScansButton";

export const dynamic = "force-dynamic";

async function verifyAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return profile?.role === "admin";
}

export default async function CustomerDetailPage({
    params,
}: {
    params: Promise<{ userId: string }>;
}) {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) redirect("/");

    const { userId } = await params;
    const admin = getSupabaseAdmin();

    const [profileResult, tenantsResult] = await Promise.all([
        admin.from("profiles").select("*").eq("id", userId).single(),
        admin.from("tenants").select("*").eq("owner_id", userId),
    ]);

    const profile = profileResult.data;
    const userTenants = tenantsResult.data ?? [];

    if (!profile) redirect("/admin");

    const tenantIds = userTenants.map((t) => t.id);

    // Fetch bot message counts per tenant using count queries (avoids 1000 row limit)
    const messageCountByTenant: Record<string, number> = {};
    let totalBotMessages = 0;

    if (tenantIds.length > 0) {
        const countResults = await Promise.all(
            tenantIds.map(tid =>
                admin.from("messages")
                    .select("id", { count: "exact", head: true })
                    .eq("is_from_agent", true)
                    .eq("tenant_id", tid)
            )
        );
        for (let i = 0; i < tenantIds.length; i++) {
            const count = countResults[i].count ?? 0;
            messageCountByTenant[tenantIds[i]] = count;
            totalBotMessages += count;
        }
    }

    const agentModeLabel: Record<string, { label: string; cls: string }> = {
        active: { label: "פעיל", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
        learning: { label: "לומד", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
        paused: { label: "מושהה", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <Link
                    href="/admin"
                    className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm text-neutral-400 hover:text-white transition-all"
                >
                    <ArrowRight className="w-4 h-4" />
                    חזרה
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-white">{profile.email}</h1>
                    <p className="text-neutral-500 text-sm mt-0.5">
                        הצטרף ב-{new Date(profile.created_at).toLocaleDateString("he-IL")}
                    </p>
                </div>
                <div className="flex items-center gap-2 mr-auto">
                    <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium border ${
                        profile.role === "admin"
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                            : "bg-white/5 text-neutral-400 border-white/10"
                    }`}>
                        {profile.role === "admin" ? "מנהל" : "לקוח"}
                    </span>
                    <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium border ${
                        profile.approval_status === "approved"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : profile.approval_status === "pending"
                            ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                    }`}>
                        {profile.approval_status === "approved" && "מאושר"}
                        {profile.approval_status === "pending" && "ממתין"}
                        {profile.approval_status === "rejected" && "נדחה"}
                    </span>
                    <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium border ${
                        profile.subscription_status === "active"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-white/5 text-neutral-400 border-white/10"
                    }`}>
                        {profile.subscription_status === "trial" && "ניסיון"}
                        {profile.subscription_status === "active" && "מנוי פעיל"}
                        {profile.subscription_status === "past_due" && "בפיגור"}
                        {profile.subscription_status === "canceled" && "בוטל"}
                    </span>
                </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-neutral-900 border border-white/5 rounded-2xl p-5">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                        <Building2 className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="text-3xl font-bold text-purple-400 mb-1">{userTenants.length}</div>
                    <div className="text-sm text-neutral-500">עסקים רשומים</div>
                </div>
                <div className="bg-neutral-900 border border-white/5 rounded-2xl p-5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                        <MessageSquare className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div className="text-3xl font-bold text-emerald-400 mb-1">{totalBotMessages}</div>
                    <div className="text-sm text-neutral-500">הודעות שנשלחו על ידי הבוט</div>
                </div>
            </div>

            {/* Businesses table */}
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">עסקים</h2>
            </div>

            {userTenants.length === 0 ? (
                <div className="bg-neutral-900 border border-white/5 rounded-2xl p-12 text-center text-neutral-500">
                    אין עסקים רשומים ללקוח זה.
                </div>
            ) : (
                <div className="bg-neutral-900 border border-white/5 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-right text-sm">
                            <thead className="bg-neutral-950 border-b border-white/5 text-neutral-400 font-medium">
                                <tr>
                                    <th className="px-6 py-4 whitespace-nowrap">שם העסק</th>
                                    <th className="px-6 py-4 whitespace-nowrap">מצב סוכן</th>
                                    <th className="px-6 py-4 whitespace-nowrap">WhatsApp</th>
                                    <th className="px-6 py-4 whitespace-nowrap">הודעות</th>
                                    <th className="px-6 py-4 whitespace-nowrap">סריקות אתר</th>
                                    <th className="px-6 py-4 whitespace-nowrap">פתח</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {userTenants.map((tenant) => {
                                    const modeInfo = agentModeLabel[tenant.agent_mode] ?? {
                                        label: tenant.agent_mode,
                                        cls: "bg-white/5 text-neutral-400 border-white/10",
                                    };
                                    return (
                                        <tr key={tenant.id} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-6 py-4 font-medium text-white">
                                                {tenant.business_name}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${modeInfo.cls}`}>
                                                    {modeInfo.label}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {tenant.whatsapp_connected ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                                        <Wifi className="w-3 h-3" />
                                                        מחובר
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border bg-white/5 text-neutral-500 border-white/10">
                                                        <WifiOff className="w-3 h-3" />
                                                        לא מחובר
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-400">
                                                {messageCountByTenant[tenant.id] ?? 0}
                                            </td>
                                            <td className="px-6 py-4">
                                                <GrantScansButton
                                                    tenantId={tenant.id}
                                                    scansUsed={tenant.website_scans_used ?? 0}
                                                    scansLimit={10 + (tenant.website_scans_bonus ?? 0)}
                                                    scansMonth={tenant.website_scans_month ?? ""}
                                                />
                                            </td>
                                            <td className="px-6 py-4">
                                                <Link
                                                    href={`/tenant/${tenant.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-400 hover:text-white rounded-lg text-xs font-medium transition-all"
                                                >
                                                    פתח ←
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
