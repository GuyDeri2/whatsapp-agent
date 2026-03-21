"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, LogOut, ArrowLeft, Bot, Activity, PauseCircle, Building2, Wifi, WifiOff, BookOpen, Loader2, Sparkles } from "lucide-react";

interface Tenant {
  id: string;
  business_name: string;
  description: string | null;
  agent_mode: "learning" | "active" | "paused";
  whatsapp_connected: boolean;
  whatsapp_phone: string | null;
  created_at: string;
}

interface Profile {
  role: "client" | "admin";
  subscription_status: "trial" | "active" | "past_due" | "canceled";
  first_name: string | null;
  last_name: string | null;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  return "ערב טוב";
}

export default function Dashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ business_name: "", description: "", products: "", target_customers: "" });
  const [creating, setCreating] = useState(false);

  const fetchTenants = useCallback(async () => {
    try {
      const res = await fetch("/api/tenants");
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      if (data.tenants) {
        setTenants(data.tenants);
        data.tenants.forEach((t: Tenant) => router.prefetch(`/tenant/${t.id}`));
      }
      if (data.profile) setProfile(data.profile);
    } catch (err) {
      console.error("Failed to fetch tenants:", err);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      setShowForm(false);
      setFormData({ business_name: "", description: "", products: "", target_customers: "" });
      await fetchTenants();
    }
    setCreating(false);
  };

  const modeConfig = {
    learning: { label: "למידה", icon: <BookOpen className="w-3.5 h-3.5" />, bg: "bg-amber-500/15 text-amber-400 ring-amber-500/25" },
    active: { label: "פעיל", icon: <Activity className="w-3.5 h-3.5" />, bg: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25" },
    paused: { label: "מושהה", icon: <PauseCircle className="w-3.5 h-3.5" />, bg: "bg-neutral-500/15 text-neutral-400 ring-neutral-500/25" },
  };

  return (
    <div className="min-h-screen text-neutral-200 font-sans selection:bg-emerald-500/30 relative overflow-x-hidden bg-background">

      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full opacity-25" style={{ background: "radial-gradient(circle, #10b981 0%, transparent 70%)", filter: "blur(90px)" }} />
        <div className="absolute bottom-[-15%] left-[-10%] w-[700px] h-[700px] rounded-full opacity-15" style={{ background: "radial-gradient(circle, #059669 0%, transparent 70%)", filter: "blur(100px)" }} />
        <div className="absolute top-[40%] left-[30%] w-[400px] h-[400px] rounded-full opacity-[0.07]" style={{ background: "radial-gradient(circle, #34d399 0%, transparent 70%)", filter: "blur(80px)" }} />
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10"
        >
          <div className="flex items-center gap-4">
            <div className="relative w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_24px_rgba(16,185,129,0.25)]">
              <Bot className="w-6 h-6 text-emerald-400" />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#060c18] animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                {getGreeting()}{profile?.first_name ? `, ${profile.first_name}${profile.last_name ? ` ${profile.last_name}` : ""}` : ""}
              </h1>
              <p className="text-slate-500 text-sm">נהל את סוכני הווטסאפ שלך</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {profile && (
              <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ring-1 ring-inset ${profile.subscription_status === "active" ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20" :
                  profile.subscription_status === "trial" ? "bg-indigo-500/10 text-indigo-300 ring-indigo-500/20" :
                    "bg-red-500/10 text-red-400 ring-red-500/20"
                }`}>
                {profile.subscription_status === "trial" && "✨ תקופת ניסיון"}
                {profile.subscription_status === "active" && "✅ מנוי פעיל"}
                {profile.subscription_status === "past_due" && "⚠️ בפיגור תשלום"}
                {profile.subscription_status === "canceled" && "❌ מנוי בוטל"}
              </span>
            )}
            {profile?.role === "admin" && (
              <button
                onClick={() => router.push("/admin")}
                onMouseEnter={() => router.prefetch("/admin")}
                className="px-4 py-2 text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all inline-flex items-center gap-2"
              >
                ניהול מערכת
              </button>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">התנתק</span>
            </button>
          </div>
        </motion.header>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            { title: "סה״כ עסקים", value: loading ? "—" : tenants.length, icon: <Building2 className="w-5 h-5" />, color: "text-emerald-400", glow: "rgba(16,185,129,0.15)" },
            { title: "מחוברים לווטסאפ", value: loading ? "—" : tenants.filter(t => t.whatsapp_connected).length, icon: <Wifi className="w-5 h-5" />, color: "text-teal-300", glow: "rgba(20,184,166,0.15)" },
            { title: "סוכנים פעילים", value: loading ? "—" : tenants.filter(t => t.agent_mode === "active").length, icon: <Sparkles className="w-5 h-5" />, color: "text-green-400", glow: "rgba(74,222,128,0.15)" },
          ].map((stat, idx) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.2 } }}
              whileTap={{ scale: 0.98 }}
              transition={{ delay: idx * 0.08, duration: 0.4 }}
              className="group relative glass-panel hover:bg-white/[0.06] hover:border-emerald-500/40 rounded-2xl p-5 overflow-hidden cursor-default transition-colors duration-200"
              style={{ boxShadow: `0 0 20px ${stat.glow}` }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-slate-500 group-hover:text-slate-300 font-medium transition-colors duration-200">{stat.title}</span>
                <span className={`${stat.color} opacity-60 group-hover:opacity-100 group-hover:scale-110 transition-all duration-200 inline-block`}>{stat.icon}</span>
              </div>
              <p className={`text-4xl font-bold tracking-tight ${stat.color} transition-all duration-200`} style={{ filter: "none" }}
                onMouseEnter={e => (e.currentTarget.style.filter = `drop-shadow(0 0 12px ${stat.glow})`)}
                onMouseLeave={e => (e.currentTarget.style.filter = "none")}
              >{stat.value}</p>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent group-hover:via-emerald-500/70 transition-all duration-300" />
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 group-hover:from-emerald-500/[0.04] to-transparent transition-all duration-300 rounded-2xl pointer-events-none" />
            </motion.div>
          ))}
        </div>

        {/* Tenants */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-slate-400" />
              העסקים שלך
            </h2>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setShowForm(!showForm)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${showForm
                ? "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
                }`}
            >
              {showForm ? "ביטול" : <><Plus className="w-4 h-4" /> הוסף עסק</>}
            </motion.button>
          </div>

          <AnimatePresence>
            {showForm && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -8 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -8 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="mb-8 overflow-hidden"
              >
                <div className="glass-panel rounded-2xl p-6 sm:p-8 shadow-[0_0_40px_rgba(16,185,129,0.07)]">
                  <h3 className="text-lg font-semibold mb-6 text-white">הוסף עסק חדש למערכת</h3>
                  <form onSubmit={handleCreate} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">שם העסק <span className="text-red-400">*</span></label>
                        <input type="text" required value={formData.business_name}
                          onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder-slate-600"
                          placeholder="לדוגמה: חנות אלקטרוניקה" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">לקוחות יעד</label>
                        <input type="text" value={formData.target_customers}
                          onChange={(e) => setFormData({ ...formData, target_customers: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder-slate-600"
                          placeholder="למשל: חובבי טכנולוגיה..." />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">מוצרים / שירותים</label>
                      <textarea value={formData.products} onChange={(e) => setFormData({ ...formData, products: e.target.value })} rows={2}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all resize-none placeholder-slate-600"
                        placeholder="מה אתם מוכרים?" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">תיאור העסק</label>
                      <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={2}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all resize-none placeholder-slate-600"
                        placeholder="מה העסק שלך עושה?" />
                    </div>
                    <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                      <button type="button" onClick={() => setShowForm(false)}
                        className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                        ביטול
                      </button>
                      <button type="submit" disabled={creating}
                        className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all inline-flex items-center gap-2 shadow-lg shadow-emerald-500/25">
                        {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> יוצר...</> : "צור סוכן חדש"}
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3].map(i => (
                <div key={i} className="glass-panel rounded-2xl p-6 animate-pulse">
                  <div className="skeleton h-5 w-2/3 mb-3 rounded-lg" />
                  <div className="skeleton h-3.5 w-full mb-2 rounded" />
                  <div className="skeleton h-3.5 w-3/4 mb-6 rounded" />
                  <div className="skeleton h-px w-full mb-4" />
                  <div className="skeleton h-4 w-1/3 rounded" />
                </div>
              ))}
            </div>
          ) : tenants.length === 0 && !showForm ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="border-2 border-dashed border-white/10 rounded-2xl p-16 text-center">
              <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/10">
                <Building2 className="w-8 h-8 text-slate-600" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">אין עסקים עדיין</h3>
              <p className="text-slate-400 mb-6 max-w-xs mx-auto">הוסף את העסק הראשון שלך כדי להתחיל לאמן את סוכן ה-AI.</p>
              <button onClick={() => setShowForm(true)}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/25 inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> הוסף עסק ראשון
              </button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {tenants.map((tenant, idx) => {
                const mode = modeConfig[tenant.agent_mode];
                return (
                  <motion.div
                    key={tenant.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.07, duration: 0.35 }}
                    whileHover={{ y: -3, transition: { duration: 0.2 } }}
                    onMouseEnter={() => router.prefetch(`/tenant/${tenant.id}`)}
                    onClick={() => router.push(`/tenant/${tenant.id}`)}
                    className="group relative glass-panel rounded-2xl p-6 cursor-pointer transition-all duration-300 flex flex-col overflow-hidden hover:bg-white/[0.04] hover:border-emerald-500/40 hover:shadow-[0_8px_32px_rgba(16,185,129,0.12)]"
                  >
                    {/* Top accent line on hover */}
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/0 to-transparent group-hover:via-emerald-500/60 transition-all duration-500" />

                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-base font-semibold text-white truncate pr-2 group-hover:text-emerald-300 transition-colors leading-tight">
                        {tenant.business_name}
                      </h3>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset shrink-0 ${mode.bg}`}>
                        {mode.icon}
                        {mode.label}
                      </span>
                    </div>

                    <p className="text-sm text-slate-500 line-clamp-2 mb-5 flex-1 leading-relaxed">
                      {tenant.description || "אין תיאור נתון."}
                    </p>

                    <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs">
                        {tenant.whatsapp_connected ? (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            <span className="text-emerald-400 font-medium" dir="ltr">{tenant.whatsapp_phone || "מחובר"}</span>
                          </>
                        ) : (
                          <>
                            <WifiOff className="w-3.5 h-3.5 text-slate-600" />
                            <span className="text-slate-600">לא מחובר</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 group-hover:text-emerald-400 transition-colors">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity">פתח</span>
                        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
