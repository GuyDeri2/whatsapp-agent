"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, LogOut, ArrowLeft, Bot, Activity, PauseCircle, Building2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

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
}

/* ------------------------------------------------------------------ */
/* Page component                                                      */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    business_name: "",
    description: "",
    products: "",
    target_customers: "",
  });
  const [creating, setCreating] = useState(false);

  const fetchTenants = useCallback(async () => {
    const res = await fetch("/api/tenants");
    const data = await res.json();
    if (data.tenants) setTenants(data.tenants);
    if (data.profile) setProfile(data.profile);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

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
      setFormData({
        business_name: "",
        description: "",
        products: "",
        target_customers: "",
      });
      await fetchTenants();
    }
    setCreating(false);
  };

  const modeConfig = {
    learning: { label: "למידה", icon: <Bot className="w-4 h-4" />, color: "bg-amber-500/20 text-amber-500 ring-amber-500/30" },
    active: { label: "פעיל", icon: <Activity className="w-4 h-4" />, color: "bg-emerald-500/20 text-emerald-500 ring-emerald-500/30" },
    paused: { label: "מושהה", icon: <PauseCircle className="w-4 h-4" />, color: "bg-neutral-500/20 text-neutral-400 ring-neutral-500/30" },
  };

  return (
    <div className="min-h-screen bg-black text-neutral-200 font-sans selection:bg-indigo-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-5%] w-[400px] h-[400px] rounded-full bg-indigo-600/10 blur-[100px]" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-purple-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10 pb-6 border-b border-white/10">
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400 flex items-center gap-2">
              <Bot className="w-8 h-8 text-indigo-500" />
              דשבורד סוכנים
            </h1>
            <p className="text-neutral-500 text-sm mt-1">נהל את סוכני ה-AI והעסקים שלך במקום אחד</p>
          </div>
          <div className="flex items-center gap-4">
            {profile && (
              <span className={`px-3 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${profile.subscription_status === "active" ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20" :
                  profile.subscription_status === "trial" ? "bg-indigo-500/10 text-indigo-400 ring-indigo-500/20" :
                    "bg-red-500/10 text-red-400 ring-red-500/20"
                }`}>
                {profile.subscription_status === "trial" && "תקופת ניסיון"}
                {profile.subscription_status === "active" && "מנוי פעיל"}
                {profile.subscription_status === "past_due" && "בפיגור תשלום"}
                {profile.subscription_status === "canceled" && "מנוי בוטל"}
              </span>
            )}
            {profile?.role === "admin" && (
              <button
                onClick={() => router.push("/admin")}
                className="px-4 py-2 text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
              >
                ניהול מערכת
              </button>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2"
              title="התנתק"
            >
              <LogOut className="w-5 h-5" />
              <span className="hidden sm:inline text-sm">התנתק</span>
            </button>
          </div>
        </header>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
          <StatCard title="סה״כ עסקים" value={tenants.length} />
          <StatCard title="מחוברים לוואטסאפ" value={tenants.filter((t) => t.whatsapp_connected).length} highlight="text-emerald-400" />
          <StatCard title="סוכנים פעילים" value={tenants.filter((t) => t.agent_mode === "active").length} highlight="text-indigo-400" />
        </div>

        {/* Main Content */}
        <div>
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-neutral-400" />
              העסקים שלך
            </h2>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
            >
              {showForm ? "ביטול" : <><Plus className="w-4 h-4" /> הוסף עסק</>}
            </button>
          </div>

          <AnimatePresence>
            {showForm && (
              <motion.div
                initial={{ opacity: 0, height: 0, scale: 0.95 }}
                animate={{ opacity: 1, height: "auto", scale: 1 }}
                exit={{ opacity: 0, height: 0, scale: 0.95 }}
                className="mb-8 overflow-hidden"
              >
                <div className="bg-white/[0.03] border border-white/[0.05] rounded-2xl p-6 sm:p-8 relative">
                  <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-50 rounded-2xl pointer-events-none" />
                  <h3 className="text-lg font-semibold mb-6 relative z-10">הוסף עסק חדש למערכת</h3>

                  <form onSubmit={handleCreate} className="space-y-6 relative z-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-neutral-400">שם העסק <span className="text-red-400">*</span></label>
                        <input
                          type="text"
                          required
                          value={formData.business_name}
                          onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                          placeholder="לדוגמה: חנות אלקטרוניקה"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-neutral-400">לקוחות יעד</label>
                        <input
                          type="text"
                          value={formData.target_customers}
                          onChange={(e) => setFormData({ ...formData, target_customers: e.target.value })}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                          placeholder="למשל: חובבי טכנולוגיה, עסקים קטנים..."
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-neutral-400">מוצרים / שירותים</label>
                      <textarea
                        value={formData.products}
                        onChange={(e) => setFormData({ ...formData, products: e.target.value })}
                        rows={2}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm resize-none"
                        placeholder="מה אתם מוכרים? למשל: סמארטפונים, מחשבים ניידים..."
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-neutral-400">תיאור העסק</label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={3}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm resize-none"
                        placeholder="מה העסק שלך עושה באופן כללי?"
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setShowForm(false)}
                        className="px-5 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        ביטול
                      </button>
                      <button
                        type="submit"
                        disabled={creating}
                        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                      >
                        {creating ? (
                          <><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> יוצר...</>
                        ) : (
                          "צור סוכן חדש"
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
              <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
              <p>טוען נתונים...</p>
            </div>
          ) : tenants.length === 0 && !showForm ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center"
            >
              <Building2 className="w-16 h-16 text-neutral-600 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-white mb-2">אין עסקים עדיין</h3>
              <p className="text-neutral-400 mb-6">הוסף את העסק הראשון שלך כדי להתחיל לאמן את סוכן ה-AI בווטסאפ.</p>
              <button onClick={() => setShowForm(true)} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors">
                + הוסף עסק ראשון
              </button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tenants.map((tenant, idx) => {
                const mode = modeConfig[tenant.agent_mode];
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    key={tenant.id}
                    onClick={() => router.push(`/tenant/${tenant.id}`)}
                    className="group relative bg-white/[0.02] hover:bg-white/[0.04] border border-white/10 hover:border-indigo-500/50 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/10 flex flex-col"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-lg font-semibold text-white truncate pr-2 group-hover:text-indigo-300 transition-colors">
                        {tenant.business_name}
                      </h3>
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${mode.color} shrink-0`}>
                        {mode.icon}
                        {mode.label}
                      </div>
                    </div>

                    <p className="text-sm text-neutral-500 line-clamp-2 mb-6 flex-1">
                      {tenant.description || "אין תיאור נתון."}
                    </p>

                    <div className="pt-4 border-t border-white/5 flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-2 text-sm">
                        <div className="relative flex h-2.5 w-2.5">
                          {tenant.whatsapp_connected && <span className="animate-ping py-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${tenant.whatsapp_connected ? "bg-emerald-500" : "bg-neutral-600"}`}></span>
                        </div>
                        <span className={tenant.whatsapp_connected ? "text-neutral-300" : "text-neutral-500"}>
                          {tenant.whatsapp_connected ? `מחובר (${tenant.whatsapp_phone || "..."})` : "לא מחובר"}
                        </span>
                      </div>
                      <ArrowLeft className="w-4 h-4 text-neutral-600 group-hover:text-indigo-400 group-hover:-translate-x-1 transition-all" />
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

function StatCard({ title, value, highlight = "text-white" }: { title: string, value: string | number, highlight?: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 flex flex-col justify-between">
      <h3 className="text-sm font-medium text-neutral-400 mb-2">{title}</h3>
      <p className={`text-4xl font-bold tracking-tight ${highlight}`}>{value}</p>
    </div>
  );
}
