import React from "react";
import { Settings, Info, Briefcase, BookOpen, Target, Package, Save, Loader2, Users, Phone } from "lucide-react";

interface Tenant {
    id: string;
    business_name: string;
    description: string | null;
    products: string | null;
    target_customers: string | null;
    agent_mode: "learning" | "active" | "paused";
}

interface SettingsTabProps {
    tenant: Tenant;
    editForm: {
        business_name: string;
        description: string;
        products: string;
        target_customers: string;
        agent_respond_to_saved_contacts: boolean;
        owner_phone: string;
    };
    setEditForm: React.Dispatch<React.SetStateAction<any>>;
    handleSaveSettings: (e: React.FormEvent) => Promise<void>;
    saving: boolean;
}

export function SettingsTab({
    tenant,
    editForm,
    setEditForm,
    handleSaveSettings,
    saving,
}: SettingsTabProps) {
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
}
