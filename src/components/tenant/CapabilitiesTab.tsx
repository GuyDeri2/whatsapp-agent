"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

    return (
        <div className="settings-layout">
            <div className="settings-main">
                <div className="settings-section">
                    <h2>🧠 "המוח" של הסוכן (חוקים ויכולות)</h2>
                    <p className="text-sm" style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
                        כאן מרוכזות כל היכולות האוטומטיות שהסוכן למד לבד, או שאתה הוספת ידנית. מה שרשום כאן - חקוק בסלע של הסוכן.
                    </p>

                    <div className="knowledge-card" style={{ padding: "16px", background: "var(--bg-glass)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>
                            <h3 style={{ margin: 0 }}>📚 בסיס ידע ללקוחות</h3>
                            <button
                                className="btn btn-primary"
                                style={{ padding: "6px 12px", fontSize: "14px" }}
                                onClick={() => { setIsAdding(true); setEditingId(null); setEditForm({ question: "", answer: "", category: "general" }); }}
                            >
                                ➕ הוסף כלל אצבע
                            </button>
                        </div>

                        {loading ? (
                            <p style={{ color: "var(--text-secondary)" }}>טוען נתונים...</p>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "500px", overflowY: "auto", paddingRight: "4px" }}>

                                {isAdding && (
                                    <div style={{ padding: "12px", borderRadius: "6px", background: "var(--bg-secondary)", border: "1px dashed var(--accent)" }}>
                                        <h4 style={{ marginTop: 0, marginBottom: "8px" }}>כלל חדש</h4>
                                        <input type="text" placeholder="קטגוריה (למשל: מדיניות החזרות)" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} style={{ width: "100%", marginBottom: "8px", padding: "8px", borderRadius: "4px", background: "var(--bg-glass)", border: "1px solid var(--border)", color: "#fff" }} />
                                        <input type="text" placeholder="נושא/שאלה (למשל: כמה ימים להחזרה?)" value={editForm.question} onChange={e => setEditForm({ ...editForm, question: e.target.value })} style={{ width: "100%", marginBottom: "8px", padding: "8px", borderRadius: "4px", background: "var(--bg-glass)", border: "1px solid var(--border)", color: "#fff" }} />
                                        <textarea placeholder="מה הסוכן צריך לדעת ולענות?" value={editForm.answer} onChange={e => setEditForm({ ...editForm, answer: e.target.value })} style={{ width: "100%", marginBottom: "8px", padding: "8px", borderRadius: "4px", background: "var(--bg-glass)", border: "1px solid var(--border)", color: "#fff", minHeight: "60px" }} />
                                        <div style={{ display: "flex", gap: "8px" }}>
                                            <button className="btn btn-primary" onClick={handleAdd} style={{ padding: "4px 8px", fontSize: "12px" }}>שמור</button>
                                            <button className="btn btn-ghost" onClick={() => setIsAdding(false)} style={{ padding: "4px 8px", fontSize: "12px" }}>ביטול</button>
                                        </div>
                                    </div>
                                )}

                                {learnings.length === 0 && !isAdding && (
                                    <p style={{ color: "var(--text-secondary)" }}>בסיס הידע ריק. הוסף כלל למעלה או חכה שהסוכן ילמד משיחות.</p>
                                )}

                                {Object.entries(
                                    learnings.reduce((acc, curr) => {
                                        const cat = curr.category || "כללי";
                                        if (!acc[cat]) acc[cat] = [];
                                        acc[cat].push(curr);
                                        return acc;
                                    }, {} as Record<string, typeof learnings>)
                                ).sort(([catA], [catB]) => (catA === "general" || catA === "כללי" ? 1 : catB === "general" || catB === "כללי" ? -1 : catA.localeCompare(catB)))
                                    .map(([category, catLearnings]) => (
                                        <div key={category} style={{ marginBottom: "24px" }}>
                                            <h4 style={{ color: "var(--accent)", marginBottom: "12px", borderBottom: "1px solid var(--border)", paddingBottom: "4px" }}>
                                                📁 קטגוריה: {category === "general" ? "כללי" : category}
                                            </h4>
                                            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                                {catLearnings.map(learning => (
                                                    <div key={learning.id} className="capabilities-row" style={{
                                                        padding: "12px",
                                                        borderRadius: "6px",
                                                        background: "var(--bg-secondary)",
                                                        borderLeft: `4px solid ${learning.source === "manual" ? "var(--success)" : "var(--accent)"}`
                                                    }}>
                                                        {editingId === learning.id ? (
                                                            <div>
                                                                <input type="text" placeholder="קטגוריה" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} style={{ width: "100%", marginBottom: "8px", padding: "8px", borderRadius: "4px", background: "var(--bg-glass)", border: "1px solid var(--border)", color: "#fff" }} />
                                                                <input type="text" placeholder="נושא/שאלה" value={editForm.question} onChange={e => setEditForm({ ...editForm, question: e.target.value })} style={{ width: "100%", marginBottom: "8px", padding: "8px", borderRadius: "4px", background: "var(--bg-glass)", border: "1px solid var(--border)", color: "#fff" }} />
                                                                <textarea placeholder="מה התשובה?" value={editForm.answer} onChange={e => setEditForm({ ...editForm, answer: e.target.value })} style={{ width: "100%", marginBottom: "8px", padding: "8px", borderRadius: "4px", background: "var(--bg-glass)", border: "1px solid var(--border)", color: "#fff", minHeight: "60px" }} />
                                                                <div style={{ display: "flex", gap: "8px" }}>
                                                                    <button className="btn btn-primary" onClick={() => handleSaveEdit(learning.id)} style={{ padding: "4px 8px", fontSize: "12px" }}>עדכן</button>
                                                                    <button className="btn btn-ghost" onClick={() => setEditingId(null)} style={{ padding: "4px 8px", fontSize: "12px" }}>ביטול</button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                                                                    <span>
                                                                        {new Date(learning.created_at).toLocaleDateString("he-IL")}
                                                                        &nbsp;|&nbsp;
                                                                        {learning.source === "manual" ? <span style={{ color: "var(--success)" }}>✅ עודכן ידנית</span> : <span style={{ color: "var(--accent)" }}>🤖 נלמד אוטומטית</span>}
                                                                    </span>
                                                                    <div style={{ display: "flex", gap: "8px" }}>
                                                                        <button onClick={() => { setEditingId(learning.id); setEditForm({ question: learning.question, answer: learning.answer, category: learning.category || "כללי" }); setIsAdding(false); }} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "14px" }}>✏️</button>
                                                                        <button onClick={() => handleDelete(learning.id)} style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer", fontSize: "14px" }}>🗑️</button>
                                                                    </div>
                                                                </div>
                                                                <div style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                                                    <div><strong>{learning.question}</strong></div>
                                                                    <div>{learning.answer}</div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
