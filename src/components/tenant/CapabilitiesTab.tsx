import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Brain, Lightbulb, BookOpen, Plus, Save, X, Edit2, Trash2, Folder, Calendar, Bot, UserCheck, Webhook, CheckCircle2 } from "lucide-react";

interface AgentLearning {
    id: string;
    question: string;
    answer: string;
    category: string;
    confidence: number;
    source: string;
    created_at: string;
}

export function CapabilitiesTab({ tenant }: { tenant: any }) {
    const supabase = createClient();
    const [learnings, setLearnings] = useState<AgentLearning[]>([]);
    const [loading, setLoading] = useState(true);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{ question: string; answer: string; category: string }>({ question: "", answer: "", category: "general" });
    const [isAdding, setIsAdding] = useState(false);

    const [unanswered, setUnanswered] = useState<any[]>([]);
    const [dismissedIds, setDismissedIds] = useState<string[]>([]);

    const [webhookUrl, setWebhookUrl] = useState<string>(tenant?.lead_webhook_url ?? "");
    const [webhookSaving, setWebhookSaving] = useState(false);
    const [webhookSaved, setWebhookSaved] = useState(false);

    const fetchLearnings = async () => {
        if (!tenant?.id) return;
        setLoading(true);
        const { data, error } = await supabase
            .from("knowledge_base")
            .select("*")
            .eq("tenant_id", tenant.id)
            .in("source", ["learned", "manual"])
            .order("created_at", { ascending: false });

        if (!error && data) {
            setLearnings(data as AgentLearning[]);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchLearnings();
        if (tenant?.id) {
            fetch(`/api/tenants/${tenant.id}/unanswered-questions`)
                .then(res => res.json())
                .then(data => {
                    if (data.questions) setUnanswered(data.questions);
                })
                .catch(err => console.error(err));
        }
    }, [tenant?.id, supabase]);

    const handleSaveEdit = async (id: string) => {
        const { error } = await supabase.from("knowledge_base").update({
            question: editForm.question,
            answer: editForm.answer,
            category: editForm.category,
            updated_at: new Date().toISOString()
        }).eq("id", id);

        if (!error) {
            setEditingId(null);
            fetchLearnings();
        } else {
            alert("שגיאה בעדכון הנתונים");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("האם למחוק יכולת זו? הסוכן לא ישתמש בה יותר.")) return;
        const { error } = await supabase.from("knowledge_base").delete().eq("id", id);
        if (!error) {
            fetchLearnings();
        } else {
            alert("שגיאה במחיקה");
        }
    };

    const handleAdd = async () => {
        if (!editForm.question || !editForm.answer) return alert("יש למלא נושא ותשובה");
        const { error } = await supabase.from("knowledge_base").insert({
            tenant_id: tenant.id,
            question: editForm.question,
            answer: editForm.answer,
            category: editForm.category,
            source: "manual"
        });

        if (!error) {
            setIsAdding(false);
            setEditForm({ question: "", answer: "", category: "general" });
            fetchLearnings();
        } else {
            alert("שגיאה בהוספה");
        }
    };

    const activeUnanswered = unanswered.filter(q => !dismissedIds.includes(q.id));

    const handleSaveWebhook = async () => {
        setWebhookSaving(true);
        await fetch(`/api/tenants/${tenant.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lead_webhook_url: webhookUrl || null }),
        });
        setWebhookSaving(false);
        setWebhookSaved(true);
        setTimeout(() => setWebhookSaved(false), 2500);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto">

            {/* Header Section */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>

                <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0 ring-1 ring-emerald-500/30">
                        <Brain className="w-6 h-6 text-emerald-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white tracking-tight">"המוח" של הסוכן</h2>
                </div>

                <p className="text-neutral-400 text-sm max-w-3xl leading-relaxed pr-16 bg-white/5 inline-block px-4 py-2 rounded-lg border border-white/5">
                    כאן מרוכזות כל היכולות האוטומטיות שהסוכן למד משיחות עבר, או שהוספת ידנית. מידע זה משמש כבסיס הידע המרכזי לתשובותיו.
                </p>
            </div>

            {/* Lead Webhook Section */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-64 h-64 bg-violet-500/10 rounded-full blur-[80px] -z-10 pointer-events-none"></div>

                <div className="flex items-center gap-4 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0 ring-1 ring-violet-500/30">
                        <Webhook className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Webhook לידים</h3>
                        <p className="text-sm text-neutral-400">כשלקוח מועבר לנציג, שלח את פרטיו אוטומטית ל-Make / Zapier / CRM</p>
                    </div>
                </div>

                <div className="mt-5 bg-black/30 border border-white/5 rounded-2xl p-4 text-xs text-neutral-400 mb-5 space-y-1">
                    <p className="font-semibold text-neutral-300 mb-2">המידע שיישלח ב-POST:</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[["👤 name", "שם הלקוח"], ["📞 phone", "מספר טלפון"], ["📧 email", "מייל שנאסף"], ["📋 summary", "סיכום השיחה"]].map(([field, label]) => (
                            <div key={field} className="bg-white/5 rounded-xl px-3 py-2 border border-white/5">
                                <div className="font-mono text-violet-400 font-semibold">{field}</div>
                                <div className="text-neutral-500 text-[11px]">{label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex gap-3 items-center">
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
                        {webhookSaved ? <><CheckCircle2 className="w-4 h-4" /> נשמר!</> : <><Save className="w-4 h-4" /> שמור</>}
                    </button>
                </div>
            </div>

            {/* Unanswered Questions Widget */}
            {activeUnanswered.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-3xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-[60px] pointer-events-none -z-10"></div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-amber-500/10 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
                                <Lightbulb className="w-5 h-5 text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-amber-400">הזדמנויות למידה</h3>
                                <p className="text-sm text-neutral-400">שאלות גולשים שהסוכן לא ידע לענות עליהן</p>
                            </div>
                        </div>
                        <div className="bg-amber-500/10 text-amber-400 text-xs font-bold px-3 py-1 rounded-full border border-amber-500/20 self-start sm:self-auto">
                            {activeUnanswered.length} ממתינות
                        </div>
                    </div>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                        {activeUnanswered.map(q => (
                            <div key={q.id} className="bg-black/40 border border-amber-500/10 hover:border-amber-500/30 rounded-2xl p-4 sm:p-5 transition-all group flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
                                {/* Accent line */}
                                <div className="absolute right-0 top-0 bottom-0 w-1 bg-amber-500/50 group-hover:bg-amber-400 transition-colors"></div>

                                <div className="flex-1 min-w-0 pr-3">
                                    <div className="flex items-center gap-2 text-xs text-neutral-500 mb-2">
                                        <span className="flex items-center gap-1 font-medium text-neutral-400">
                                            <UserCheck className="w-3.5 h-3.5" />
                                            {q.contact}
                                        </span>
                                        <span className="text-neutral-600">•</span>
                                        <span className="flex items-center gap-1">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {new Date(q.date).toLocaleDateString("he-IL")}
                                        </span>
                                    </div>
                                    <div className="bg-white/5 border border-white/5 rounded-xl px-4 py-3 inline-block">
                                        <p className="text-[15px] font-medium text-white leading-relaxed">"{q.user_question}"</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 pr-3 md:pr-0">
                                    <button
                                        className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-xl font-medium text-sm transition-all border border-amber-500/20"
                                        onClick={() => {
                                            setEditForm({ question: q.user_question, answer: "", category: "שאלות פתוחות" });
                                            setIsAdding(true);
                                            setDismissedIds(prev => [...prev, q.id]);
                                            setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
                                        }}
                                    >
                                        <Plus className="w-4 h-4" />
                                        למד מהשאלה
                                    </button>
                                    <button
                                        className="inline-flex items-center justify-center w-10 h-10 bg-white/5 hover:bg-red-500/10 text-neutral-400 hover:text-red-400 rounded-xl transition-all"
                                        onClick={() => setDismissedIds(prev => [...prev, q.id])}
                                        title="התעלם"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Knowledge Base Section */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden flex flex-col min-h-[500px]">
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none -z-10"></div>

                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 border-b border-white/10 pb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 border border-blue-500/30">
                            <BookOpen className="w-5 h-5 text-blue-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white">בסיס ידע ללקוחות</h3>
                    </div>

                    <button
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-all shadow-lg hover:shadow-[0_0_15px_rgba(99,102,241,0.4)]"
                        onClick={() => { setIsAdding(true); setEditingId(null); setEditForm({ question: "", answer: "", category: "general" }); }}
                    >
                        <Plus className="w-4 h-4" />
                        הוסף כלל אצבע
                    </button>
                </div>

                {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 py-12">
                        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                        <p>טוען נתונים...</p>
                    </div>
                ) : (
                    <div className="flex-1 space-y-6 overflow-y-auto custom-scrollbar pr-2">

                        {/* Add/Edit Form */}
                        {isAdding && (
                            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-6 animate-in slide-in-from-top-4 duration-300">
                                <h4 className="text-lg font-bold text-emerald-300 mb-4 flex items-center gap-2">
                                    <Edit2 className="w-4 h-4" />
                                    {editingId ? "ערוך כלל" : "כלל חדש"}
                                </h4>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-neutral-400 mb-1.5 ml-1">קטגוריה</label>
                                            <input
                                                type="text"
                                                placeholder="למשל: מדיניות החזרות, כללי..."
                                                value={editForm.category}
                                                onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-white transition-all text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-neutral-400 mb-1.5 ml-1">נושא / שאלה שכיחה</label>
                                            <input
                                                type="text"
                                                placeholder="למשל: כמה ימים להחזרה?"
                                                value={editForm.question}
                                                onChange={e => setEditForm({ ...editForm, question: e.target.value })}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-white transition-all text-sm"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-neutral-400 mb-1.5 ml-1">התשובה של הסוכן</label>
                                        <textarea
                                            placeholder="מה הסוכן צריך לדעת ולענות?"
                                            value={editForm.answer}
                                            onChange={e => setEditForm({ ...editForm, answer: e.target.value })}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-white transition-all text-sm min-h-[100px] resize-y custom-scrollbar"
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 pt-2">
                                        <button
                                            className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-all text-sm"
                                            onClick={handleAdd}
                                        >
                                            <Save className="w-4 h-4" />
                                            שמור כלל
                                        </button>
                                        <button
                                            className="inline-flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-all text-sm border border-white/10"
                                            onClick={() => setIsAdding(false)}
                                        >
                                            <X className="w-4 h-4" />
                                            ביטול
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Empty State */}
                        {learnings.length === 0 && !isAdding && (
                            <div className="flex flex-col items-center justify-center text-center py-12 bg-black/20 border-2 border-dashed border-white/5 rounded-2xl">
                                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                                    <Brain className="w-8 h-8 text-neutral-500" />
                                </div>
                                <h3 className="text-lg font-medium text-neutral-300 mb-2">בסיס הידע עדיין ריק</h3>
                                <p className="text-neutral-500 max-w-sm">
                                    צור כללי אצבע ראשונים או המתן שהסוכן ילמד בעצמו משיחות עם לקוחות.
                                </p>
                            </div>
                        )}

                        {/* Grouped Learnings List */}
                        <div className="space-y-8">
                            {Object.entries(
                                learnings.reduce((acc, curr) => {
                                    const cat = curr.category || "כללי";
                                    if (!acc[cat]) acc[cat] = [];
                                    acc[cat].push(curr);
                                    return acc;
                                }, {} as Record<string, typeof learnings>)
                            ).sort(([catA], [catB]) => (catA === "general" || catA === "כללי" ? 1 : catB === "general" || catB === "כללי" ? -1 : catA.localeCompare(catB)))
                                .map(([category, catLearnings]) => (
                                    <div key={category} className="space-y-4">
                                        <h4 className="flex items-center gap-2 text-[15px] font-semibold text-emerald-300 mb-3 ml-2 border-b border-white/5 pb-2">
                                            <Folder className="w-4 h-4" />
                                            {category === "general" ? "כללי" : category}
                                            <span className="text-xs px-2 py-0.5 bg-white/5 rounded-full text-neutral-400 font-normal mr-auto relative top-0.5">
                                                {catLearnings.length}
                                            </span>
                                        </h4>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                            {catLearnings.map(learning => (
                                                <div key={learning.id} className="relative group bg-black/40 border border-white/5 hover:border-white/10 rounded-2xl p-5 transition-all duration-300 overflow-hidden">

                                                    {/* Accent border left */}
                                                    <div className={`absolute right-0 top-0 bottom-0 w-1 ${learning.source === "manual" ? "bg-emerald-500/50" : "bg-emerald-500/50"}`}></div>

                                                    {editingId === learning.id ? (
                                                        <div className="space-y-3 animate-in fade-in pr-3 flex flex-col items-stretch">
                                                            <input type="text" placeholder="קטגוריה" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                                            <input type="text" placeholder="שאלה/נושא" value={editForm.question} onChange={e => setEditForm({ ...editForm, question: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-emerald-500 font-medium" />
                                                            <textarea placeholder="תשובה" value={editForm.answer} onChange={e => setEditForm({ ...editForm, answer: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg py-2 px-3 text-white text-sm min-h-[80px] focus:outline-none focus:border-emerald-500 custom-scrollbar resize-none" />
                                                            <div className="flex gap-2 pt-1">
                                                                <button className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors" onClick={() => handleSaveEdit(learning.id)}>עדכן</button>
                                                                <button className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition-colors border border-white/5" onClick={() => setEditingId(null)}>ביטול</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="pr-3 flex flex-col h-full">
                                                            <div className="flex items-start justify-between mb-3 gap-2">
                                                                <div className="font-semibold text-white/90 leading-snug">
                                                                    {learning.question}
                                                                </div>

                                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 bg-black/60 backdrop-blur-sm rounded-lg border border-white/5 p-1">
                                                                    <button
                                                                        onClick={() => { setEditingId(learning.id); setEditForm({ question: learning.question, answer: learning.answer, category: learning.category || "כללי" }); setIsAdding(false); }}
                                                                        className="w-7 h-7 flex items-center justify-center rounded text-neutral-400 hover:text-emerald-400 hover:bg-white/5 transition-colors"
                                                                        title="ערוך"
                                                                    >
                                                                        <Edit2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDelete(learning.id)}
                                                                        className="w-7 h-7 flex items-center justify-center rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                                        title="מחק"
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            <div className="text-[14px] text-neutral-400 leading-relaxed mb-4 flex-1">
                                                                {learning.answer}
                                                            </div>

                                                            <div className="flex items-center justify-between text-[11px] text-neutral-500 border-t border-white/5 pt-3 mt-auto">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Calendar className="w-3 h-3 opacity-70" />
                                                                    {new Date(learning.created_at).toLocaleDateString("he-IL")}
                                                                </div>
                                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/5 ${learning.source === "manual" ? "text-emerald-400" : "text-emerald-400"}`}>
                                                                    {learning.source === "manual" ? (
                                                                        <><UserCheck className="w-3 h-3" /> נוסף ידנית</>
                                                                    ) : (
                                                                        <><Bot className="w-3 h-3" /> נלמד מהשיחות</>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
