import React, { useState } from "react";
import { Users, Shield, ShieldAlert, ShieldCheck, Plus, Trash2, Search, Loader2 } from "lucide-react";

interface Tenant {
    id: string;
    agent_filter_mode: "all" | "whitelist" | "blacklist";
}

interface ContactRule {
    id: string;
    tenant_id: string;
    phone_number: string;
    contact_name: string | null;
    rule_type: "allow" | "block";
    created_at: string;
}

interface ContactsTabProps {
    tenant: Tenant;
    contactRules: ContactRule[];
    newRulePhone: string;
    setNewRulePhone: (val: string) => void;
    newRuleName: string;
    setNewRuleName: (val: string) => void;
    newRuleType: "allow" | "block";
    setNewRuleType: (val: "allow" | "block") => void;
    setFilterMode: (mode: "all" | "whitelist" | "blacklist") => Promise<void>;
    handleAddRule: (e: React.FormEvent) => Promise<void>;
    handleDeleteRule: (ruleId: string) => Promise<void>;
    filterLabels: Record<string, string>;
}

const ContactsTab = React.memo(function ContactsTab({
    tenant,
    contactRules,
    newRulePhone,
    setNewRulePhone,
    newRuleName,
    setNewRuleName,
    newRuleType,
    setNewRuleType,
    setFilterMode,
    handleAddRule,
    handleDeleteRule,
    filterLabels,
}: ContactsTabProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const onSubmit = async (e: React.FormEvent) => {
        setIsSubmitting(true);
        try { await handleAddRule(e); } finally { setIsSubmitting(false); }
    };

    const onDelete = async (id: string) => {
        setDeletingId(id);
        try { await handleDeleteRule(id); } finally { setDeletingId(null); }
    };

    // Format phone for display
    const formatPhone = (phone: string) => {
        if (!phone) return "";
        if (phone.includes("-")) return "קבוצה";
        if (phone.startsWith("972") && phone.length === 12)
            return `0${phone.substring(3, 5)}-${phone.substring(5, 8)}-${phone.substring(8)}`;
        if (phone.startsWith("972") && phone.length === 11)
            return `0${phone.substring(3, 4)}-${phone.substring(4, 7)}-${phone.substring(7)}`;
        return `+${phone}`;
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-purple-500 to-emerald-500 opacity-50"></div>

                <div className="flex items-start gap-4 mb-6">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0 ring-1 ring-emerald-500/30">
                        <Users className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white mb-2">סינון אנשי קשר</h2>
                        <p className="text-neutral-400 text-sm leading-relaxed max-w-2xl">
                            כאן אתה קובע <strong className="text-white font-semibold">למי הבוט יענה אוטומטית</strong> כשהוא במצב "פעיל".<br />
                            <span className="inline-flex items-center gap-1.5 mt-2 text-emerald-300 bg-emerald-500/10 px-3 py-1.5 rounded-lg text-xs font-medium">
                                <Search className="w-3.5 h-3.5" />
                                כל ההודעות תמיד נשמרות ומוצגות לך — הסינון משפיע רק על מענה אוטומטי.
                            </span>
                        </p>
                    </div>
                </div>

                {/* Filter mode selector */}
                <div className="mt-8 bg-black/40 rounded-xl p-5 border border-white/5">
                    <label className="block text-sm font-medium text-neutral-300 mb-4 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-emerald-400" />
                        למי הבוט יענה?
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {(["all", "whitelist", "blacklist"] as const).map((mode) => {
                            const icons = {
                                all: <Users className="w-5 h-5 mb-1 opacity-70" />,
                                whitelist: <ShieldCheck className="w-5 h-5 mb-1 text-emerald-400" />,
                                blacklist: <ShieldAlert className="w-5 h-5 mb-1 text-red-400" />
                            };

                            const isActive = tenant.agent_filter_mode === mode;

                            return (
                                <button
                                    key={mode}
                                    onClick={() => setFilterMode(mode)}
                                    className={`relative flex flex-col items-center justify-center p-4 rounded-xl transition-all duration-300 border ${isActive
                                            ? "bg-emerald-600/20 border-emerald-500/50 shadow-[0_0_20px_rgba(99,102,241,0.15)] transform scale-[1.02]"
                                            : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-neutral-400"
                                        }`}
                                >
                                    {isActive && (
                                        <div className="absolute top-2 right-2 flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                        </div>
                                    )}
                                    {icons[mode]}
                                    <span className={`text-sm font-medium mt-1 ${isActive ? "text-emerald-300" : ""}`}>
                                        {filterLabels[mode]}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Add new rule form */}
                <div className="lg:col-span-1">
                    <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-xl sticky top-6">
                        <h3 className="text-lg font-semibold text-white mb-5 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-emerald-400" />
                            הוסף כלל חדש
                        </h3>

                        <form onSubmit={onSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-neutral-400 mb-1.5 ml-1">מספר טלפון</label>
                                <input
                                    type="text"
                                    placeholder="0526991415 או +972526991415"
                                    value={newRulePhone}
                                    onChange={(e) => setNewRulePhone(e.target.value)}
                                    required
                                    className="w-full bg-black/50 border border-white/10 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 text-white transition-all text-left placeholder-neutral-600"
                                    dir="ltr"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-neutral-400 mb-1.5 ml-1">שם (אופציונלי)</label>
                                <input
                                    type="text"
                                    placeholder="שם איש הקשר"
                                    value={newRuleName}
                                    onChange={(e) => setNewRuleName(e.target.value)}
                                    className="w-full bg-black/50 border border-white/10 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 text-white transition-all placeholder-neutral-600"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-neutral-400 mb-1.5 ml-1">סוג כלל</label>
                                <div className="relative">
                                    <select
                                        value={newRuleType}
                                        onChange={(e) => setNewRuleType(e.target.value as "allow" | "block")}
                                        className="w-full bg-black/50 border border-white/10 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 text-white transition-all appearance-none pr-10"
                                    >
                                        <option value="allow">✅ אפשר (רשימה לבנה)</option>
                                        <option value="block">🚫 חסום (רשימה שחורה)</option>
                                    </select>
                                    <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                                        <svg className="h-4 w-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-xl transition-all hover:shadow-[0_0_15px_rgba(16,185,129,0.35)] transform active:scale-[0.98] mt-2 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:bg-emerald-600"
                                disabled={!newRulePhone.trim() || isSubmitting}
                            >
                                {isSubmitting ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> מוסיף...</>
                                ) : "הוסף כלל"}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Rules list */}
                <div className="lg:col-span-2">
                    <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-xl h-full flex flex-col">
                        <h3 className="text-lg font-semibold text-white mb-5 flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-emerald-400" />
                                הכללים שלך
                            </span>
                            <span className="text-xs py-1 px-2.5 bg-white/5 rounded-full border border-white/10 text-neutral-400">
                                סה״כ: {contactRules.length}
                            </span>
                        </h3>

                        <div className="flex-1">
                            {contactRules.length === 0 ? (
                                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-neutral-500 border-2 border-dashed border-white/5 rounded-xl bg-black/20 p-8 text-center pattern-isometric pattern-neutral-900 pattern-bg-transparent pattern-size-4 pattern-opacity-100">
                                    <div className="bg-white/5 p-4 rounded-full mb-4">
                                        <Shield className="w-8 h-8 opacity-50" />
                                    </div>
                                    <p className="text-lg font-medium text-neutral-400 mb-1">לא הוגדרו כללים עדיין.</p>
                                    <p className="text-sm max-w-xs">צור כלל חדש באמצעות הטופס כדי להתחיל לסנן שיחות.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {contactRules.map((rule) => {
                                        const isAllow = rule.rule_type === "allow";
                                        return (
                                            <div
                                                key={rule.id}
                                                className="group flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl hover:bg-white/5 hover:border-white/10 transition-all duration-300"
                                            >
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <div className={`p-2 rounded-lg shrink-0 ${isAllow ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`} title={isAllow ? "רשימה לבנה" : "רשימה שחורה"}>
                                                        {isAllow ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-neutral-200 truncate" dir="ltr text-right">
                                                            {formatPhone(rule.phone_number)}
                                                        </div>
                                                        {rule.contact_name && (
                                                            <div className="text-xs text-neutral-500 truncate mt-0.5">
                                                                {rule.contact_name}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => onDelete(rule.id)}
                                                    disabled={deletingId === rule.id}
                                                    className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 ml-1 disabled:cursor-not-allowed"
                                                    title="מחק כלל"
                                                >
                                                    {deletingId === rule.id
                                                        ? <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                                                        : <Trash2 className="w-4 h-4" />
                                                    }
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export { ContactsTab };
