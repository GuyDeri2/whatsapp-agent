import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users, Building2, MessageSquare, Bot, TrendingUp, BarChart2 } from "lucide-react";

export const dynamic = "force-dynamic";

async function verifyAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return profile?.role === "admin";
}

function formatDate(d: Date) {
    return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

function startOfWeek(d: Date) {
    const r = new Date(d);
    r.setDate(r.getDate() - r.getDay());
    r.setHours(0, 0, 0, 0);
    return r;
}

export default async function AnalyticsPage({
    searchParams,
}: {
    searchParams: Promise<{ from?: string; to?: string }>;
}) {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) redirect("/");

    const params = await searchParams;

    const defaultTo = new Date();
    const defaultFrom = addDays(defaultTo, -30);

    const fromDate = params.from ? new Date(params.from) : defaultFrom;
    const toDate = params.to ? new Date(params.to) : defaultTo;
    // Ensure toDate covers the full day
    const toDateEnd = new Date(toDate);
    toDateEnd.setHours(23, 59, 59, 999);

    const fromStr = formatDate(fromDate);
    const toStr = formatDate(toDateEnd);

    const admin = getSupabaseAdmin();

    // Fetch all data in parallel
    const [
        profilesResult,
        tenantsResult,
        messagesResult,
        conversationsResult,
        allMessagesResult,
    ] = await Promise.all([
        admin.from("profiles").select("id, created_at, role").gte("created_at", fromStr).lte("created_at", toStr),
        admin.from("tenants").select("id, owner_id, business_name, agent_mode").gte("created_at", fromStr).lte("created_at", toStr),
        admin.from("messages").select("tenant_id, role, is_from_agent, created_at").gte("created_at", fromStr).lte("created_at", toStr),
        admin.from("conversations").select("id, created_at").gte("created_at", fromStr).lte("created_at", toStr),
        // For top 5 businesses, we need all messages (not date filtered per business)
        admin.from("messages").select("tenant_id, is_from_agent").gte("created_at", fromStr).lte("created_at", toStr),
    ]);

    // Also fetch totals without date filter for KPI cards
    const [allProfilesResult, allTenantsResult, allConversationsResult] = await Promise.all([
        admin.from("profiles").select("id, role", { count: "exact" }),
        admin.from("tenants").select("id", { count: "exact" }),
        admin.from("conversations").select("id", { count: "exact" }),
    ]);

    const allProfiles = allProfilesResult.data ?? [];
    const totalRegistered = allProfiles.filter(p => p.role === "client").length;
    const totalBusinesses = allTenantsResult.count ?? 0;
    const totalConversations = allConversationsResult.count ?? 0;

    const allMsgs = allMessagesResult.data ?? [];
    const totalMessagesInSystem = allMsgs.length;
    const totalAiInSystem = allMsgs.filter(m => m.is_from_agent).length;

    const avgBusinessesPerCustomer = totalRegistered > 0
        ? (totalBusinesses / totalRegistered).toFixed(1)
        : "0";

    // --- Messages per day (last 14 days) ---
    const last14Messages = (messagesResult.data ?? []).filter(m => {
        const d = new Date(m.created_at);
        const cutoff = addDays(toDate, -13);
        return d >= cutoff;
    });

    const msgByDay: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
        const d = formatDate(addDays(toDate, -i));
        msgByDay[d] = 0;
    }
    for (const m of last14Messages) {
        const d = formatDate(new Date(m.created_at));
        if (d in msgByDay) msgByDay[d]++;
    }
    const maxDayCount = Math.max(...Object.values(msgByDay), 1);
    const msgByDayEntries = Object.entries(msgByDay);

    // --- Top 5 most active businesses ---
    const msgCountByTenant: Record<string, number> = {};
    for (const m of allMsgs) {
        msgCountByTenant[m.tenant_id] = (msgCountByTenant[m.tenant_id] ?? 0) + 1;
    }

    // Fetch all tenant names for those in the top list
    const topTenantIds = Object.entries(msgCountByTenant)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

    let topTenants: { id: string; business_name: string }[] = [];
    if (topTenantIds.length > 0) {
        const { data } = await admin.from("tenants").select("id, business_name").in("id", topTenantIds);
        topTenants = data ?? [];
    }

    const topTenantsWithCount = topTenantIds.map(id => ({
        id,
        business_name: topTenants.find(t => t.id === id)?.business_name ?? id,
        count: msgCountByTenant[id] ?? 0,
    }));
    const maxTopCount = Math.max(...topTenantsWithCount.map(t => t.count), 1);

    // --- New customers per week (last 4 weeks) ---
    const weekStarts: Date[] = [];
    for (let i = 3; i >= 0; i--) {
        weekStarts.push(startOfWeek(addDays(toDate, -i * 7)));
    }

    const newCustomersByWeek: { label: string; count: number }[] = weekStarts.map((ws, idx) => {
        const we = idx < weekStarts.length - 1 ? weekStarts[idx + 1] : addDays(toDate, 1);
        const count = (profilesResult.data ?? []).filter(p => {
            if (p.role !== "client") return false;
            const d = new Date(p.created_at);
            return d >= ws && d < we;
        }).length;
        return {
            label: `${ws.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}`,
            count,
        };
    });
    const maxWeekCount = Math.max(...newCustomersByWeek.map(w => w.count), 1);

    const kpis = [
        { label: "לקוחות רשומים", value: totalRegistered, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
        { label: "עסקים פעילים", value: totalBusinesses, icon: Building2, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
        { label: "ממוצע עסקים ללקוח", value: avgBusinessesPerCustomer, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
        { label: "הודעות במערכת", value: totalMessagesInSystem, icon: MessageSquare, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
        { label: "תשובות AI", value: totalAiInSystem, icon: Bot, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
        { label: "שיחות סה\"כ", value: totalConversations, icon: BarChart2, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
    ];

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white">אנליטיקה</h1>
                <p className="text-neutral-500 text-sm mt-1">נתוני שימוש ופעילות בפלטפורמה</p>
            </div>

            {/* Date filter */}
            <form method="GET" className="flex items-center gap-3 mb-8 p-4 bg-neutral-900 border border-white/5 rounded-2xl">
                <span className="text-sm text-neutral-400">טווח תאריכים:</span>
                <input
                    type="date"
                    name="from"
                    defaultValue={fromStr}
                    className="bg-neutral-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                />
                <span className="text-neutral-600">—</span>
                <input
                    type="date"
                    name="to"
                    defaultValue={formatDate(toDate)}
                    className="bg-neutral-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                />
                <button
                    type="submit"
                    className="px-4 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-sm font-medium rounded-lg transition-all"
                >
                    סנן
                </button>
                <a
                    href="/admin/analytics"
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-400 text-sm rounded-lg transition-all"
                >
                    איפוס
                </a>
            </form>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
                {kpis.map((k) => (
                    <div key={k.label} className="bg-neutral-900 border border-white/5 rounded-2xl p-5">
                        <div className={`w-10 h-10 rounded-xl ${k.bg} border flex items-center justify-center mb-4`}>
                            <k.icon className={`w-5 h-5 ${k.color}`} />
                        </div>
                        <div className={`text-3xl font-bold ${k.color} mb-1`}>{k.value}</div>
                        <div className="text-sm text-neutral-500">{k.label}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Messages per day chart */}
                <div className="bg-neutral-900 border border-white/5 rounded-2xl p-6">
                    <h2 className="text-base font-semibold text-white mb-5">הודעות ב-14 הימים האחרונים</h2>
                    <div className="space-y-2">
                        {msgByDayEntries.map(([date, count]) => {
                            const barPct = Math.round((count / maxDayCount) * 100);
                            const label = new Date(date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
                            return (
                                <div key={date} className="flex items-center gap-3">
                                    <span className="text-xs text-neutral-500 w-12 text-left shrink-0">{label}</span>
                                    <div className="flex-1 bg-neutral-800 rounded-full h-5 overflow-hidden">
                                        <div
                                            className="h-full bg-indigo-500/60 rounded-full transition-all"
                                            style={{ width: `${barPct}%` }}
                                        />
                                    </div>
                                    <span className="text-xs text-neutral-400 w-8 text-right shrink-0">{count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* New customers per week */}
                <div className="bg-neutral-900 border border-white/5 rounded-2xl p-6">
                    <h2 className="text-base font-semibold text-white mb-5">לקוחות חדשים לפי שבוע (4 שבועות אחרונים)</h2>
                    <div className="space-y-2">
                        {newCustomersByWeek.map((w) => {
                            const barPct = Math.round((w.count / maxWeekCount) * 100);
                            return (
                                <div key={w.label} className="flex items-center gap-3">
                                    <span className="text-xs text-neutral-500 w-16 text-left shrink-0">שבוע {w.label}</span>
                                    <div className="flex-1 bg-neutral-800 rounded-full h-5 overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500/60 rounded-full transition-all"
                                            style={{ width: `${barPct}%` }}
                                        />
                                    </div>
                                    <span className="text-xs text-neutral-400 w-8 text-right shrink-0">{w.count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Top 5 businesses */}
            <div className="bg-neutral-900 border border-white/5 rounded-2xl p-6">
                <h2 className="text-base font-semibold text-white mb-5">5 העסקים הפעילים ביותר (לפי מספר הודעות)</h2>
                {topTenantsWithCount.length === 0 ? (
                    <p className="text-neutral-500 text-sm">אין נתונים לתקופה זו.</p>
                ) : (
                    <div className="space-y-3">
                        {topTenantsWithCount.map((t, i) => {
                            const barPct = Math.round((t.count / maxTopCount) * 100);
                            return (
                                <div key={t.id} className="flex items-center gap-3">
                                    <span className="text-xs text-neutral-600 w-4 shrink-0">#{i + 1}</span>
                                    <span className="text-sm text-neutral-300 w-40 truncate shrink-0">{t.business_name}</span>
                                    <div className="flex-1 bg-neutral-800 rounded-full h-5 overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500/60 rounded-full transition-all"
                                            style={{ width: `${barPct}%` }}
                                        />
                                    </div>
                                    <span className="text-xs text-neutral-400 w-12 text-right shrink-0">{t.count} הודעות</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
