import React, { useState, useCallback } from "react";
import { Settings, Info, Briefcase, BookOpen, Target, Package, Save, Loader2, Users, Phone, Globe, Search, CheckSquare, Square, X, RefreshCw, AlertTriangle } from "lucide-react";

interface Tenant {
    id: string;
    business_name: string;
    description: string | null;
    products: string | null;
    target_customers: string | null;
    agent_mode: "learning" | "active" | "paused";
    website_url: string | null;
    website_last_crawled_at: string | null;
}

type EditForm = {
    business_name: string;
    description: string;
    products: string;
    target_customers: string;
    agent_respond_to_saved_contacts: boolean;
    handoff_collect_email: boolean;
    owner_phone: string;
};

interface WebsiteCrawlAnalysis {
    business_name?: string;
    description?: string;
    products?: string;
    target_customers?: string;
    knowledge_entries: Array<{ question: string; answer: string; category: string }>;
    operating_hours?: string;
    location?: string;
    contact_info?: string;
}

interface SettingsTabProps {
    tenant: Tenant;
    editForm: EditForm;
    setEditForm: React.Dispatch<React.SetStateAction<EditForm>>;
    handleSaveSettings: (e: React.FormEvent) => Promise<void>;
    saving: boolean;
    onTenantUpdate?: () => void;
}

const SettingsTab = React.memo(function SettingsTab({
    tenant,
    editForm,
    setEditForm,
    handleSaveSettings,
    saving,
    onTenantUpdate,
}: SettingsTabProps) {
    // Website Intelligence state
    const [websiteUrl, setWebsiteUrl] = useState(tenant.website_url || "");
    const [savingUrl, setSavingUrl] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState("");
    const [scanError, setScanError] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<WebsiteCrawlAnalysis | null>(null);
    const [applyProfile, setApplyProfile] = useState(true);
    const [applyKnowledge, setApplyKnowledge] = useState(true);
    const [applyingScan, setApplyingScan] = useState(false);

    const handleSaveUrl = useCallback(async () => {
        setSavingUrl(true);
        try {
            const res = await fetch(`/api/tenants/${tenant.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ website_url: websiteUrl || null }),
            });
            if (!res.ok) throw new Error();
            onTenantUpdate?.();
        } catch {
            setScanError("שגיאה בשמירת כתובת האתר");
        } finally {
            setSavingUrl(false);
        }
    }, [tenant.id, websiteUrl, onTenantUpdate]);

    const handleScan = useCallback(async () => {
        if (!websiteUrl) return;
        setScanning(true);
        setScanError(null);
        setAnalysis(null);
        setScanProgress("מתחבר לאתר...");

        try {
            // Save URL first if changed
            if (websiteUrl !== tenant.website_url) {
                await fetch(`/api/tenants/${tenant.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ website_url: websiteUrl }),
                });
            }

            setScanProgress("סורק את האתר...");
            const res = await fetch(`/api/tenants/${tenant.id}/website-crawl`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: websiteUrl }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "scan_failed");
            }

            setScanProgress("מנתח תוכן...");
            const data = await res.json();
            setAnalysis(data.analysis);
            setScanProgress("");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "scan_failed";
            if (msg.includes("access") || msg.includes("fetch")) {
                setScanError("לא הצלחנו לגשת לאתר. בדוק שהכתובת נכונה.");
            } else if (msg.includes("insufficient") || msg.includes("empty")) {
                setScanError("לא הצלחנו לחלץ מידע מספיק מהאתר.");
            } else {
                setScanError("שגיאה בניתוח התוכן. נסה שוב.");
            }
            setScanProgress("");
        } finally {
            setScanning(false);
        }
    }, [websiteUrl, tenant.id, tenant.website_url]);

    const handleApplyScan = useCallback(async () => {
        if (!analysis) return;
        setApplyingScan(true);
        setScanError(null);

        try {
            const res = await fetch(`/api/tenants/${tenant.id}/website-crawl/apply`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    analysis,
                    apply_profile: applyProfile,
                    apply_knowledge: applyKnowledge,
                }),
            });

            if (!res.ok) throw new Error();

            // Update local form if profile was applied
            if (applyProfile) {
                setEditForm(prev => ({
                    ...prev,
                    business_name: analysis.business_name || prev.business_name,
                    description: analysis.description || prev.description,
                    products: analysis.products || prev.products,
                    target_customers: analysis.target_customers || prev.target_customers,
                }));
            }

            setAnalysis(null);
            onTenantUpdate?.();
        } catch {
            setScanError("שגיאה בשמירת תוצאות הסריקה. נסה שוב.");
        } finally {
            setApplyingScan(false);
        }
    }, [analysis, tenant.id, applyProfile, applyKnowledge, setEditForm, onTenantUpdate]);

    return (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-500 max-w-6xl mx-auto">

            {/* Main Form Section */}
            <div className="flex-1 order-2 lg:order-1">
                <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>

                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0 ring-1 ring-emerald-500/30">
                            <Settings className="w-6 h-6 text-emerald-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white">הגדרות עסק וסוכן</h2>
                    </div>

                    <p className="text-neutral-400 text-sm mb-8 pr-16 leading-relaxed">
                        המידע כאן משמש את ה-AI בתור <span className="text-emerald-300 font-medium">"בסיס הידע"</span> שלו כשהוא עונה ללקוחות.
                        ככל שתפרט יותר, כך הסוכן יספק תשובות מדויקות ואמינות יותר.
                    </p>

                    <form onSubmit={handleSaveSettings} className="space-y-6">

                        {/* Business Name */}
                        <div className="group">
                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2 ml-1">
                                <Briefcase className="w-4 h-4 text-emerald-400" />
                                שם העסק / מותג <span className="text-red-400">*</span>
                            </label>
                            <input
                                type="text"
                                value={editForm.business_name}
                                onChange={(e) => setEditForm({ ...editForm, business_name: e.target.value })}
                                required
                                className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder-neutral-600 group-hover:border-white/20"
                                placeholder="הזן את שם העסק המלא"
                            />
                        </div>

                        {/* Description */}
                        <div className="group">
                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2 ml-1">
                                <BookOpen className="w-4 h-4 text-emerald-400" />
                                על העסק (תיאור כללי)
                            </label>
                            <textarea
                                value={editForm.description}
                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                rows={4}
                                className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder-neutral-600 resize-none group-hover:border-white/20 custom-scrollbar"
                                placeholder="מי אנחנו, מה המומחיות שלנו, שעות פעילות, וכו'..."
                            />
                        </div>

                        {/* Products */}
                        <div className="group">
                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2 ml-1">
                                <Package className="w-4 h-4 text-emerald-400" />
                                מוצרים / שירותים שאנחנו נותנים
                            </label>
                            <textarea
                                value={editForm.products}
                                onChange={(e) => setEditForm({ ...editForm, products: e.target.value })}
                                rows={4}
                                className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder-neutral-600 resize-none group-hover:border-white/20 custom-scrollbar"
                                placeholder="למשל: ייעוץ משכנתאות, ליווי פיננסי לעסקים..."
                            />
                        </div>

                        {/* Target Customers */}
                        <div className="group">
                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2 ml-1">
                                <Target className="w-4 h-4 text-emerald-400" />
                                מי קהל היעד שלנו?
                            </label>
                            <textarea
                                value={editForm.target_customers}
                                onChange={(e) => setEditForm({ ...editForm, target_customers: e.target.value })}
                                rows={3}
                                className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder-neutral-600 resize-none group-hover:border-white/20 custom-scrollbar"
                                placeholder="למשל: זוגות צעירים לפני קניית דירה..."
                            />
                        </div>

                        {/* Save Contacts Toggle */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 md:p-5 mt-6 hover:bg-white/[0.07] transition-colors cursor-pointer" onClick={() => setEditForm({ ...editForm, agent_respond_to_saved_contacts: !editForm.agent_respond_to_saved_contacts })}>
                            <div className="flex items-start gap-4">
                                <div className="mt-1">
                                    <div className={`w-6 h-6 rounded flex items-center justify-center border transition-all ${editForm.agent_respond_to_saved_contacts
                                            ? "bg-emerald-600 border-emerald-500 text-white"
                                            : "bg-black/50 border-white/20 text-transparent"
                                        }`}>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={editForm.agent_respond_to_saved_contacts}
                                        onChange={(e) => setEditForm({ ...editForm, agent_respond_to_saved_contacts: e.target.checked })}
                                    />
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-white font-medium mb-1 flex items-center gap-2">
                                        <Users className="w-4 h-4 text-emerald-400" />
                                        הגב גם לאנשי קשר שמורים
                                    </h4>
                                    <p className="text-sm text-neutral-400 leading-relaxed">
                                        אם כבוי, הסוכן יתעלם מלקוחות שמורים בטלפון שלך ויגיב <span className="text-neutral-300 font-medium">רק</span> ללידים חדשים שאנחנו לא מכירים.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Handoff Collect Email Toggle */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 md:p-5 mt-6 hover:bg-white/[0.07] transition-colors cursor-pointer" onClick={() => setEditForm({ ...editForm, handoff_collect_email: !editForm.handoff_collect_email })}>
                            <div className="flex items-start gap-4">
                                <div className="mt-1">
                                    <div className={`w-6 h-6 rounded flex items-center justify-center border transition-all ${editForm.handoff_collect_email
                                            ? "bg-emerald-600 border-emerald-500 text-white"
                                            : "bg-black/50 border-white/20 text-transparent"
                                        }`}>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={editForm.handoff_collect_email}
                                        onChange={(e) => setEditForm({ ...editForm, handoff_collect_email: e.target.checked })}
                                    />
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-white font-medium mb-1 flex items-center gap-2">
                                        בקש מייל בהעברה לנציג
                                    </h4>
                                    <p className="text-sm text-neutral-400 leading-relaxed">
                                        כשהבוט מעביר שיחה לנציג אנושי, הוא יבקש מהלקוח את כתובת המייל שלו לפני ההעברה.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Owner Personal Phone */}
                        <div className="group">
                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2 ml-1">
                                <Phone className="w-4 h-4 text-emerald-400" />
                                מספר טלפון אישי (לקבלת התראות)
                            </label>
                            <input
                                type="tel"
                                value={editForm.owner_phone}
                                onChange={(e) => setEditForm({ ...editForm, owner_phone: e.target.value })}
                                dir="ltr"
                                className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder-neutral-600 group-hover:border-white/20"
                                placeholder="972501234567"
                            />
                            <p className="text-xs text-neutral-500 mt-1.5 mr-1">
                                כשהבוט מעביר שיחה לאדם אמיתי, תקבל הודעת וואטסאפ עם פרטי הלקוח. הכנס מספר בפורמט בינלאומי ללא +.
                            </p>
                        </div>

                        <div className="pt-4 flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="relative overflow-hidden inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] disabled:opacity-70 disabled:cursor-not-allowed group w-full sm:w-auto transform active:scale-[0.98]"
                            >
                                {saving ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        שומר שינויים...
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-5 h-5 group-hover:scale-110 transition-transform" />
                                        שמור שינויים
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Website Intelligence Section */}
                <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden mt-8">
                    <div className="absolute top-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>

                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0 ring-1 ring-blue-500/30">
                            <Globe className="w-6 h-6 text-blue-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white">מודיעין אתר</h2>
                    </div>

                    <p className="text-neutral-400 text-sm mb-6 pr-16 leading-relaxed">
                        הזן את כתובת האתר שלך ונסרוק אותו אוטומטית כדי למלא את פרופיל העסק ובסיס הידע.
                    </p>

                    {/* URL Input */}
                    <div className="flex flex-col sm:flex-row gap-3 mb-4">
                        <div className="flex-1">
                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2 ml-1">
                                <Globe className="w-4 h-4 text-blue-400" />
                                כתובת אתר העסק
                            </label>
                            <input
                                type="url"
                                value={websiteUrl}
                                onChange={(e) => { setWebsiteUrl(e.target.value); setScanError(null); }}
                                dir="ltr"
                                className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder-neutral-600"
                                placeholder="https://www.example.com"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 mb-6">
                        <button
                            type="button"
                            onClick={handleSaveUrl}
                            disabled={savingUrl || !websiteUrl}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-all border border-white/10 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {savingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {savingUrl ? "שומר..." : "שמור כתובת"}
                        </button>

                        <button
                            type="button"
                            onClick={handleScan}
                            disabled={scanning || !websiteUrl}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-[0_0_15px_rgba(59,130,246,0.4)]"
                        >
                            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            {scanning ? "סורק..." : (tenant.website_last_crawled_at ? "סרוק מחדש" : "סרוק אתר")}
                        </button>
                    </div>

                    {/* Last crawl indicator */}
                    {tenant.website_last_crawled_at && !scanning && !analysis && (
                        <div className="flex items-center gap-2 text-xs text-neutral-500 mb-4">
                            <RefreshCw className="w-3.5 h-3.5" />
                            סריקה אחרונה: {new Date(tenant.website_last_crawled_at).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                    )}

                    {/* Scanning progress */}
                    {scanning && (
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5 animate-in fade-in duration-300">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin shrink-0"></div>
                                <div>
                                    <p className="text-blue-300 font-medium text-sm">סורק את האתר...</p>
                                    <p className="text-neutral-500 text-xs mt-0.5">{scanProgress}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error state */}
                    {scanError && (
                        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in duration-300">
                            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                            <p className="text-red-300 text-sm leading-relaxed">{scanError}</p>
                        </div>
                    )}

                    {/* Scan Results Preview */}
                    {analysis && !scanning && (
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-6 space-y-5 animate-in slide-in-from-top-4 duration-300">
                            <h3 className="text-lg font-bold text-blue-300 flex items-center gap-2">
                                <Search className="w-5 h-5" />
                                תוצאות הסריקה
                            </h3>

                            {/* Extracted profile fields */}
                            <div className="space-y-3">
                                {analysis.business_name && (
                                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                        <span className="text-xs text-neutral-500 block mb-1">שם העסק</span>
                                        <span className="text-neutral-200 text-sm">{analysis.business_name}</span>
                                    </div>
                                )}
                                {analysis.description && (
                                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                        <span className="text-xs text-neutral-500 block mb-1">תיאור</span>
                                        <span className="text-neutral-200 text-sm leading-relaxed">{analysis.description}</span>
                                    </div>
                                )}
                                {analysis.products && (
                                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                        <span className="text-xs text-neutral-500 block mb-1">מוצרים / שירותים</span>
                                        <span className="text-neutral-200 text-sm">{analysis.products}</span>
                                    </div>
                                )}
                                {analysis.target_customers && (
                                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                        <span className="text-xs text-neutral-500 block mb-1">קהל יעד</span>
                                        <span className="text-neutral-200 text-sm">{analysis.target_customers}</span>
                                    </div>
                                )}
                                {analysis.operating_hours && (
                                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                        <span className="text-xs text-neutral-500 block mb-1">שעות פעילות</span>
                                        <span className="text-neutral-200 text-sm">{analysis.operating_hours}</span>
                                    </div>
                                )}
                                {analysis.location && (
                                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                        <span className="text-xs text-neutral-500 block mb-1">מיקום</span>
                                        <span className="text-neutral-200 text-sm">{analysis.location}</span>
                                    </div>
                                )}
                                {analysis.contact_info && (
                                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                        <span className="text-xs text-neutral-500 block mb-1">פרטי קשר</span>
                                        <span className="text-neutral-200 text-sm">{analysis.contact_info}</span>
                                    </div>
                                )}
                            </div>

                            {/* Knowledge entries count */}
                            {analysis.knowledge_entries.length > 0 && (
                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
                                    <BookOpen className="w-4 h-4 text-emerald-400" />
                                    <span className="text-emerald-300 text-sm font-medium">
                                        נמצאו {analysis.knowledge_entries.length} שאלות ותשובות
                                    </span>
                                </div>
                            )}

                            {/* Apply checkboxes */}
                            <div className="space-y-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setApplyProfile(!applyProfile)}
                                    className="flex items-center gap-3 w-full text-right hover:bg-white/5 rounded-xl p-2 -m-2 transition-colors"
                                >
                                    {applyProfile
                                        ? <CheckSquare className="w-5 h-5 text-emerald-400 shrink-0" />
                                        : <Square className="w-5 h-5 text-neutral-500 shrink-0" />
                                    }
                                    <span className="text-sm text-neutral-300">עדכן פרופיל עסקי</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setApplyKnowledge(!applyKnowledge)}
                                    className="flex items-center gap-3 w-full text-right hover:bg-white/5 rounded-xl p-2 -m-2 transition-colors"
                                >
                                    {applyKnowledge
                                        ? <CheckSquare className="w-5 h-5 text-emerald-400 shrink-0" />
                                        : <Square className="w-5 h-5 text-neutral-500 shrink-0" />
                                    }
                                    <span className="text-sm text-neutral-300">הוסף לבסיס הידע</span>
                                </button>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={handleApplyScan}
                                    disabled={applyingScan || (!applyProfile && !applyKnowledge)}
                                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {applyingScan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    {applyingScan ? "שומר..." : "שמור"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAnalysis(null)}
                                    disabled={applyingScan}
                                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-all text-sm border border-white/10 disabled:opacity-50"
                                >
                                    <X className="w-4 h-4" />
                                    בטל
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar Section */}
            <div className="lg:w-80 shrink-0 order-1 lg:order-2">
                <div className="bg-gradient-to-br from-emerald-900/40 to-emerald-900/40 border border-emerald-500/20 rounded-3xl p-6 backdrop-blur-xl sticky top-6 shadow-[0_0_30px_rgba(99,102,241,0.1)]">
                    <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                        <Info className="w-5 h-5 text-emerald-300" />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-3">טיפ לניהול AI</h3>
                    <p className="text-emerald-200/90 text-sm leading-relaxed mb-4">
                        ככל שהמידע שתזין כאן יהיה מדויק ומפורט יותר, ככה הסוכן יידע לתת תשובות טובות ואנושיות יותר ללקוחות שלך.
                    </p>

                    <ul className="space-y-3">
                        {[
                            "הכלל מחירים אם יש (או הסבר מפורט שאין)",
                            "ציין זמני מענה, שעות פעילות ולוגיסטיקה",
                            "אם יש לינקים חשובים לשליחה, צרף אותם כאן",
                            "השתמש בשפה שאתה רוצה שהסוכן ידבר בה"
                        ].map((tip, idx) => (
                            <li key={idx} className="flex items-start gap-2.5 text-sm text-emerald-100/70">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0"></span>
                                <span className="leading-tight">{tip}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

        </div>
    );
});

export { SettingsTab };
