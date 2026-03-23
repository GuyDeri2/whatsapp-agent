"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Globe,
    Building2,
    Bot,
    ArrowLeft,
    ArrowRight,
    Check,
    Loader2,
    SkipForward,
    Search,
    Clock,
    MapPin,
    Phone,
    Mail,
    Package,
    BookOpen,
    Sparkles,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface WebsiteCrawlAnalysis {
    business_name: string | null;
    description: string | null;
    products_services: string | null;
    target_customers: string | null;
    operating_hours: string | null;
    location: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    knowledge_entries: Array<{ question: string; answer: string; category: string }>;
    products_with_prices: Array<{ name: string; price: string; description?: string }>;
    suggested_agent_prompt: string | null;
}

interface OnboardingWizardProps {
    tenant: {
        id: string;
        business_name: string;
        description: string | null;
        products: string | null;
        target_customers: string | null;
        website_url: string | null;
        agent_prompt: string | null;
    };
    onComplete: () => void;
}

/* ------------------------------------------------------------------ */
/* Step indicator                                                      */
/* ------------------------------------------------------------------ */

const STEPS = [
    { label: "אתר עסקי", icon: Globe },
    { label: "פרופיל העסק", icon: Building2 },
    { label: "התנהגות הבוט", icon: Bot },
] as const;

function StepIndicator({ currentStep }: { currentStep: number }) {
    return (
        <div className="flex items-center justify-center gap-2 sm:gap-4 mb-8 sm:mb-10">
            {STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isActive = idx === currentStep;
                const isDone = idx < currentStep;
                return (
                    <div key={idx} className="flex items-center gap-2 sm:gap-4">
                        {idx > 0 && (
                            <div
                                className={`hidden sm:block w-12 h-px transition-colors duration-300 ${
                                    isDone ? "bg-emerald-500" : "bg-white/10"
                                }`}
                            />
                        )}
                        <div className="flex items-center gap-2">
                            <div
                                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
                                    isActive
                                        ? "bg-emerald-500/20 ring-2 ring-emerald-500/50 text-emerald-400"
                                        : isDone
                                        ? "bg-emerald-600 text-white"
                                        : "bg-white/5 text-neutral-600"
                                }`}
                            >
                                {isDone ? (
                                    <Check className="w-4 h-4 sm:w-5 sm:h-5" />
                                ) : (
                                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                                )}
                            </div>
                            <span
                                className={`hidden sm:block text-sm font-medium transition-colors duration-300 ${
                                    isActive
                                        ? "text-white"
                                        : isDone
                                        ? "text-emerald-400"
                                        : "text-neutral-600"
                                }`}
                            >
                                {step.label}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Shared button styles                                                */
/* ------------------------------------------------------------------ */

const btnPrimary =
    "inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-all shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-sm";
const btnSecondary =
    "inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 text-neutral-300 rounded-xl font-medium transition-all border border-white/10 text-sm";
const inputClass =
    "w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder-neutral-600";

/* ------------------------------------------------------------------ */
/* Page animation variants                                             */
/* ------------------------------------------------------------------ */

const pageVariants = {
    enter: (direction: number) => ({
        x: direction > 0 ? 80 : -80,
        opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({
        x: direction > 0 ? -80 : 80,
        opacity: 0,
    }),
};

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

function OnboardingWizard({ tenant, onComplete }: OnboardingWizardProps) {
    const [step, setStep] = useState(0);
    const [direction, setDirection] = useState(1);

    // Step 1 — Website scan (auto-show URL input if tenant already has a website_url)
    const [hasWebsite, setHasWebsite] = useState<boolean | null>(tenant.website_url ? true : null);
    const [websiteUrl, setWebsiteUrl] = useState(tenant.website_url || "");
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState("");
    const [scanError, setScanError] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<WebsiteCrawlAnalysis | null>(null);

    // Step 2 — Profile
    const [businessName, setBusinessName] = useState(tenant.business_name || "");
    const [description, setDescription] = useState(tenant.description || "");
    const [products, setProducts] = useState(tenant.products || "");
    const [targetCustomers, setTargetCustomers] = useState(tenant.target_customers || "");
    const [savingProfile, setSavingProfile] = useState(false);

    // Step 3 — Bot behavior
    const [agentPrompt, setAgentPrompt] = useState(tenant.agent_prompt || "");
    const [ownerPhone, setOwnerPhone] = useState("");
    const [finishing, setFinishing] = useState(false);

    // ── Navigation ──
    const goNext = () => {
        setDirection(1);
        setStep((s) => Math.min(s + 1, 2));
    };
    const goBack = () => {
        setDirection(-1);
        setStep((s) => Math.max(s - 1, 0));
    };

    // ── Step 1: Scan website ──
    const handleScan = useCallback(async () => {
        if (!websiteUrl) return;
        setScanning(true);
        setScanError(null);
        setAnalysis(null);
        setScanProgress("מתחבר לאתר...");

        try {
            // Save URL first
            await fetch(`/api/tenants/${tenant.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ website_url: websiteUrl }),
            });

            setScanProgress("סורק את האתר... זה יכול לקחת כמה דקות...");
            const res = await fetch(`/api/tenants/${tenant.id}/website-crawl`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: websiteUrl }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                if (errData.error === "scan_limit_reached") {
                    throw new Error("scan_limit_reached");
                }
                throw new Error(errData.error || "scan_failed");
            }

            setScanProgress("מנתח תוכן...");
            const data = await res.json();
            const a = data.analysis as WebsiteCrawlAnalysis;
            setAnalysis(a);

            // Pre-fill step 2 fields from scan
            if (a.business_name) setBusinessName(a.business_name);
            if (a.description) setDescription(a.description);
            if (a.products_services) setProducts(a.products_services);
            if (a.target_customers) setTargetCustomers(a.target_customers);
            if (a.suggested_agent_prompt) setAgentPrompt(a.suggested_agent_prompt);

            setScanProgress("");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "scan_failed";
            if (msg.includes("scan_limit_reached")) {
                setScanError("הגעת למגבלת הסריקות החודשית. פנה למנהל המערכת לקבלת סריקות נוספות.");
            } else if (msg.includes("crawl_failed") || msg.includes("fetch")) {
                setScanError("לא הצלחנו לגשת לאתר. בדוק שהכתובת נכונה.");
            } else if (msg.includes("extract") || msg.includes("empty")) {
                setScanError("לא הצלחנו לחלץ מידע מספיק מהאתר.");
            } else if (msg.includes("timeout")) {
                setScanError("ניתוח האתר נמשך יותר מדי זמן. נסה שוב.");
            } else {
                setScanError(`שגיאה: ${msg}`);
            }
            setScanProgress("");
        } finally {
            setScanning(false);
        }
    }, [websiteUrl, tenant.id]);

    // ── Step 2: Save profile ──
    const handleSaveProfile = useCallback(async () => {
        setSavingProfile(true);
        try {
            // Save tenant profile fields
            const res = await fetch(`/api/tenants/${tenant.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    business_name: businessName,
                    description: description || null,
                    products: products || null,
                    target_customers: targetCustomers || null,
                }),
            });
            if (!res.ok) throw new Error("save_failed");

            // If we had scan results, apply them (knowledge base + agent_prompt)
            if (analysis) {
                const applyRes = await fetch(`/api/tenants/${tenant.id}/website-crawl/apply`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        analysis,
                        website_url: websiteUrl,
                    }),
                });
                if (!applyRes.ok) {
                    console.error("Failed to apply website crawl analysis:", applyRes.status);
                }
            }

            goNext();
        } catch {
            // Stay on step, show error via alert
            alert("שגיאה בשמירת הפרופיל. נסה שוב.");
        } finally {
            setSavingProfile(false);
        }
    }, [tenant.id, businessName, description, products, targetCustomers, analysis, websiteUrl]);

    // ── Step 3: Finish ──
    const handleFinish = useCallback(async () => {
        setFinishing(true);
        try {
            // Save agent_prompt + owner_phone
            const updates: Record<string, unknown> = {};
            if (agentPrompt) updates.agent_prompt = agentPrompt;
            if (ownerPhone) updates.owner_phone = ownerPhone;

            if (Object.keys(updates).length > 0) {
                const res = await fetch(`/api/tenants/${tenant.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updates),
                });
                if (!res.ok) throw new Error("save_failed");
            }

            // Mark setup as complete
            onComplete();
        } catch {
            alert("שגיאה בשמירה. נסה שוב.");
            setFinishing(false);
        }
    }, [tenant.id, agentPrompt, ownerPhone, onComplete]);

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12" dir="rtl">
            {/* Header */}
            <div className="text-center mb-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium mb-4">
                    <Sparkles className="w-4 h-4" />
                    הגדרה ראשונית
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                    בואו נגדיר את הסוכן שלך
                </h1>
                <p className="text-neutral-400 text-sm sm:text-base">
                    3 שלבים קצרים כדי להפוך את הבוט לחכם ומוכן לעבודה
                </p>
            </div>

            <StepIndicator currentStep={step} />

            {/* Step content with animation */}
            <div className="relative overflow-hidden">
                <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                        key={step}
                        custom={direction}
                        variants={pageVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                        {/* ═══════════════════════════════════════════════════ */}
                        {/* Step 0: Website Scan                               */}
                        {/* ═══════════════════════════════════════════════════ */}
                        {step === 0 && (
                            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px] -z-10 pointer-events-none" />

                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0 ring-1 ring-blue-500/30">
                                        <Globe className="w-6 h-6 text-blue-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-white">יש לך אתר?</h2>
                                        <p className="text-neutral-400 text-sm mt-1">
                                            נוכל לסרוק את האתר שלך ולמלא אוטומטית את פרטי העסק
                                        </p>
                                    </div>
                                </div>

                                {hasWebsite === null && (
                                    <div className="flex gap-3 mb-6">
                                        <button
                                            onClick={() => setHasWebsite(true)}
                                            className={btnPrimary}
                                        >
                                            <Globe className="w-4 h-4" />
                                            כן, יש לי אתר
                                        </button>
                                        <button
                                            onClick={() => {
                                                setHasWebsite(false);
                                                goNext();
                                            }}
                                            className={btnSecondary}
                                        >
                                            לא, אין לי
                                        </button>
                                    </div>
                                )}

                                {hasWebsite === true && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                                                <Globe className="w-4 h-4 text-blue-400" />
                                                כתובת האתר
                                            </label>
                                            <input
                                                type="url"
                                                value={websiteUrl}
                                                onChange={(e) => {
                                                    setWebsiteUrl(e.target.value);
                                                    setScanError(null);
                                                }}
                                                dir="ltr"
                                                className={inputClass + " focus:ring-blue-500/50 focus:border-blue-500"}
                                                placeholder="https://www.example.com"
                                                disabled={scanning}
                                            />
                                        </div>

                                        {!scanning && !analysis && (
                                            <button
                                                onClick={handleScan}
                                                disabled={!websiteUrl}
                                                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-blue-500/25"
                                            >
                                                <Search className="w-4 h-4" />
                                                סרוק אתר
                                            </button>
                                        )}

                                        {/* Scanning progress */}
                                        {scanning && (
                                            <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5 animate-in fade-in duration-300">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin shrink-0" />
                                                    <div>
                                                        <p className="text-blue-300 font-medium text-sm">סורק את האתר...</p>
                                                        <p className="text-neutral-500 text-xs mt-0.5">{scanProgress}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Scan error */}
                                        {scanError && (
                                            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 text-red-300 text-sm">
                                                {scanError}
                                            </div>
                                        )}

                                        {/* Scan success */}
                                        {analysis && !scanning && (
                                            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 space-y-3">
                                                <div className="flex items-center gap-2">
                                                    <Check className="w-5 h-5 text-emerald-400" />
                                                    <span className="text-emerald-300 font-semibold text-sm">הסריקה הצליחה!</span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                    {analysis.business_name && (
                                                        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                                            <span className="text-neutral-500 block mb-0.5">שם העסק</span>
                                                            <span className="text-neutral-200">{analysis.business_name}</span>
                                                        </div>
                                                    )}
                                                    {analysis.operating_hours && (
                                                        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                                            <span className="text-neutral-500 flex items-center gap-1 mb-0.5">
                                                                <Clock className="w-3 h-3" /> שעות פעילות
                                                            </span>
                                                            <span className="text-neutral-200">{analysis.operating_hours}</span>
                                                        </div>
                                                    )}
                                                    {analysis.location && (
                                                        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                                            <span className="text-neutral-500 flex items-center gap-1 mb-0.5">
                                                                <MapPin className="w-3 h-3" /> מיקום
                                                            </span>
                                                            <span className="text-neutral-200">{analysis.location}</span>
                                                        </div>
                                                    )}
                                                    {analysis.contact_phone && (
                                                        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                                            <span className="text-neutral-500 flex items-center gap-1 mb-0.5">
                                                                <Phone className="w-3 h-3" /> טלפון
                                                            </span>
                                                            <span className="text-neutral-200" dir="ltr">{analysis.contact_phone}</span>
                                                        </div>
                                                    )}
                                                    {analysis.contact_email && (
                                                        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                                            <span className="text-neutral-500 flex items-center gap-1 mb-0.5">
                                                                <Mail className="w-3 h-3" /> מייל
                                                            </span>
                                                            <span className="text-neutral-200" dir="ltr">{analysis.contact_email}</span>
                                                        </div>
                                                    )}
                                                    {analysis.products_with_prices && analysis.products_with_prices.length > 0 && (
                                                        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                                            <span className="text-neutral-500 flex items-center gap-1 mb-0.5">
                                                                <Package className="w-3 h-3" /> מוצרים
                                                            </span>
                                                            <span className="text-neutral-200">{analysis.products_with_prices.length} מוצרים עם מחירים</span>
                                                        </div>
                                                    )}
                                                    {analysis.knowledge_entries && analysis.knowledge_entries.length > 0 && (
                                                        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                                                            <span className="text-neutral-500 flex items-center gap-1 mb-0.5">
                                                                <BookOpen className="w-3 h-3" /> בסיס ידע
                                                            </span>
                                                            <span className="text-neutral-200">{analysis.knowledge_entries.length} שאלות ותשובות</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="text-emerald-300/70 text-xs mt-2">
                                                    כל המידע ימולא אוטומטית בשלב הבא. תוכל לערוך הכל.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Navigation */}
                                <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/5">
                                    <button
                                        onClick={() => {
                                            if (hasWebsite !== null) {
                                                setHasWebsite(null);
                                            }
                                        }}
                                        className={`${btnSecondary} ${hasWebsite === null ? "opacity-0 pointer-events-none" : ""}`}
                                    >
                                        <ArrowRight className="w-4 h-4" />
                                        חזרה
                                    </button>
                                    <div className="flex items-center gap-3">
                                        <button onClick={goNext} className={btnSecondary}>
                                            <SkipForward className="w-4 h-4" />
                                            דלג
                                        </button>
                                        {(analysis || hasWebsite === true) && !scanning && (
                                            <button onClick={goNext} className={btnPrimary}>
                                                המשך
                                                <ArrowLeft className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ═══════════════════════════════════════════════════ */}
                        {/* Step 1: Business Profile                           */}
                        {/* ═══════════════════════════════════════════════════ */}
                        {step === 1 && (
                            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -z-10 pointer-events-none" />

                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0 ring-1 ring-emerald-500/30">
                                        <Building2 className="w-6 h-6 text-emerald-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-white">פרופיל העסק</h2>
                                        <p className="text-neutral-400 text-sm mt-1">
                                            {analysis
                                                ? "מילאנו את השדות מהסריקה. ערוך לפי הצורך."
                                                : "ספר לנו על העסק שלך כדי שהבוט יענה נכון."}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    {/* Business Name */}
                                    <div className="group">
                                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                                            <Building2 className="w-4 h-4 text-emerald-400" />
                                            שם העסק <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={businessName}
                                            onChange={(e) => setBusinessName(e.target.value)}
                                            required
                                            className={inputClass}
                                            placeholder="הזן את שם העסק"
                                        />
                                    </div>

                                    {/* Description */}
                                    <div className="group">
                                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                                            <BookOpen className="w-4 h-4 text-emerald-400" />
                                            תיאור העסק
                                        </label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows={3}
                                            className={inputClass + " resize-none"}
                                            placeholder="מה העסק שלך עושה? שעות פעילות, התמחות..."
                                        />
                                    </div>

                                    {/* Products */}
                                    <div className="group">
                                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                                            <Package className="w-4 h-4 text-emerald-400" />
                                            מוצרים / שירותים
                                        </label>
                                        <textarea
                                            value={products}
                                            onChange={(e) => setProducts(e.target.value)}
                                            rows={3}
                                            className={inputClass + " resize-none"}
                                            placeholder="מה אתם מוכרים או נותנים?"
                                        />
                                    </div>

                                    {/* Target Customers */}
                                    <div className="group">
                                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                                            קהל יעד
                                        </label>
                                        <textarea
                                            value={targetCustomers}
                                            onChange={(e) => setTargetCustomers(e.target.value)}
                                            rows={2}
                                            className={inputClass + " resize-none"}
                                            placeholder="מי הלקוחות האידיאליים שלך?"
                                        />
                                    </div>

                                    {/* Info cards from scan */}
                                    {analysis && (
                                        <div className="grid grid-cols-2 gap-2 text-xs pt-2">
                                            {analysis.operating_hours && (
                                                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3">
                                                    <span className="text-emerald-400/70 flex items-center gap-1 mb-0.5">
                                                        <Clock className="w-3 h-3" /> שעות פעילות
                                                    </span>
                                                    <span className="text-neutral-300">{analysis.operating_hours}</span>
                                                </div>
                                            )}
                                            {analysis.location && (
                                                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3">
                                                    <span className="text-emerald-400/70 flex items-center gap-1 mb-0.5">
                                                        <MapPin className="w-3 h-3" /> מיקום
                                                    </span>
                                                    <span className="text-neutral-300">{analysis.location}</span>
                                                </div>
                                            )}
                                            {analysis.contact_phone && (
                                                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3">
                                                    <span className="text-emerald-400/70 flex items-center gap-1 mb-0.5">
                                                        <Phone className="w-3 h-3" /> טלפון
                                                    </span>
                                                    <span className="text-neutral-300" dir="ltr">{analysis.contact_phone}</span>
                                                </div>
                                            )}
                                            {analysis.contact_email && (
                                                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3">
                                                    <span className="text-emerald-400/70 flex items-center gap-1 mb-0.5">
                                                        <Mail className="w-3 h-3" /> מייל
                                                    </span>
                                                    <span className="text-neutral-300" dir="ltr">{analysis.contact_email}</span>
                                                </div>
                                            )}
                                            {analysis.products_with_prices && analysis.products_with_prices.length > 0 && (
                                                <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3">
                                                    <span className="text-amber-400/70 flex items-center gap-1 mb-0.5">
                                                        <Package className="w-3 h-3" /> מוצרים ומחירים
                                                    </span>
                                                    <span className="text-neutral-300">{analysis.products_with_prices.length} פריטים</span>
                                                </div>
                                            )}
                                            {analysis.knowledge_entries && analysis.knowledge_entries.length > 0 && (
                                                <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-3">
                                                    <span className="text-blue-400/70 flex items-center gap-1 mb-0.5">
                                                        <BookOpen className="w-3 h-3" /> בסיס ידע
                                                    </span>
                                                    <span className="text-neutral-300">{analysis.knowledge_entries.length} שאלות ותשובות</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Navigation */}
                                <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/5">
                                    <button onClick={goBack} className={btnSecondary}>
                                        <ArrowRight className="w-4 h-4" />
                                        חזרה
                                    </button>
                                    <button
                                        onClick={handleSaveProfile}
                                        disabled={!businessName.trim() || savingProfile}
                                        className={btnPrimary}
                                    >
                                        {savingProfile ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                שומר...
                                            </>
                                        ) : (
                                            <>
                                                המשך
                                                <ArrowLeft className="w-4 h-4" />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ═══════════════════════════════════════════════════ */}
                        {/* Step 2: Bot Behavior                               */}
                        {/* ═══════════════════════════════════════════════════ */}
                        {step === 2 && (
                            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full blur-[80px] -z-10 pointer-events-none" />

                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0 ring-1 ring-purple-500/30">
                                        <Bot className="w-6 h-6 text-purple-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-white">התנהגות הבוט</h2>
                                        <p className="text-neutral-400 text-sm mt-1">
                                            ספר לבוט איך לדבר, מה לא לעשות, ומתי להעביר לנציג אנושי.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    {/* Agent Prompt */}
                                    <div className="group">
                                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                                            <Bot className="w-4 h-4 text-purple-400" />
                                            הוראות לבוט
                                        </label>
                                        <textarea
                                            value={agentPrompt}
                                            onChange={(e) => setAgentPrompt(e.target.value)}
                                            rows={8}
                                            className={inputClass + " resize-none focus:ring-purple-500/50 focus:border-purple-500 custom-scrollbar"}
                                            placeholder={`לדוגמה:\n- דבר בעברית בטון ידידותי ומקצועי\n- אל תמציא מידע שלא קיים\n- אם הלקוח רוצה לקבוע פגישה, העבר לנציג\n- ענה תמיד בקצרה ולעניין`}
                                        />
                                        <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">
                                            ההוראות האלה יילקחו בחשבון בכל שיחה שהבוט מנהל. אם סרקת אתר, כבר מילאנו הוראות מוצעות.
                                            תוכל לערוך אותן בכל שלב דרך ההגדרות.
                                        </p>
                                    </div>

                                    {/* Owner Phone */}
                                    <div className="group">
                                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                                            <Phone className="w-4 h-4 text-purple-400" />
                                            מספר טלפון לקבלת התראות
                                            <span className="text-neutral-600 text-xs font-normal">(אופציונלי)</span>
                                        </label>
                                        <input
                                            type="tel"
                                            value={ownerPhone}
                                            onChange={(e) => setOwnerPhone(e.target.value)}
                                            dir="ltr"
                                            className={inputClass + " focus:ring-purple-500/50 focus:border-purple-500"}
                                            placeholder="972501234567"
                                        />
                                        <p className="text-xs text-neutral-500 mt-1.5">
                                            כשהבוט מעביר שיחה לנציג אנושי, תקבל הודעת וואטסאפ עם פרטי הלקוח.
                                        </p>
                                    </div>
                                </div>

                                {/* Navigation */}
                                <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/5">
                                    <button onClick={goBack} className={btnSecondary}>
                                        <ArrowRight className="w-4 h-4" />
                                        חזרה
                                    </button>
                                    <button
                                        onClick={handleFinish}
                                        disabled={finishing}
                                        className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                    >
                                        {finishing ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                מסיים הגדרה...
                                            </>
                                        ) : (
                                            <>
                                                <Check className="w-4 h-4" />
                                                סיים הגדרה
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}

export { OnboardingWizard };
