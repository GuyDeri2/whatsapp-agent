import React from "react";

interface Tenant {
    id: string;
    business_name: string;
    description: string | null;
    products: string | null;
    target_customers: string | null;
    agent_mode: "learning" | "active";
}

interface SettingsTabProps {
    tenant: Tenant;
    editForm: {
        business_name: string;
        description: string;
        products: string;
        target_customers: string;
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
        <div className="settings-section">
            <div className="settings-form">
                <h2>הגדרות עסק וסוכן</h2>
                <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
                    המידע כאן משמש את ה-AI בתור "בסיס הידע" שלו כשהוא עונה ללקוחות.
                </p>

                <form onSubmit={handleSaveSettings}>
                    <div className="form-group">
                        <label>שם העסק / מותג *</label>
                        <input
                            type="text"
                            value={editForm.business_name}
                            onChange={(e) =>
                                setEditForm({ ...editForm, business_name: e.target.value })
                            }
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>על העסק (תיאור כללי)</label>
                        <textarea
                            value={editForm.description}
                            onChange={(e) =>
                                setEditForm({ ...editForm, description: e.target.value })
                            }
                            rows={4}
                            placeholder="מי אנחנו, מה המומחיות שלנו, שעות פעילות, וכו'..."
                        />
                    </div>

                    <div className="form-group">
                        <label>מוצרים / שירותים שאנחנו נותנים</label>
                        <textarea
                            value={editForm.products}
                            onChange={(e) =>
                                setEditForm({ ...editForm, products: e.target.value })
                            }
                            rows={4}
                            placeholder="למשל: ייעוץ משכנתאות, ליווי פיננסי לעסקים..."
                        />
                    </div>

                    <div className="form-group">
                        <label>מי קהל היעד שלנו?</label>
                        <textarea
                            value={editForm.target_customers}
                            onChange={(e) =>
                                setEditForm({ ...editForm, target_customers: e.target.value })
                            }
                            rows={3}
                            placeholder="למשל: זוגות צעירים לפני קניית דירה..."
                        />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={saving}>
                        {saving ? "שומר..." : "💾 שמור שינויים"}
                    </button>
                </form>
            </div>

            <div className="settings-sidebar">
                <div className="info-card">
                    <h3>💡 טיפ לניהול AI</h3>
                    <p>
                        ככל שהמידע שתזין כאן יהיה מדויק ומפורט יותר, ככה הסוכן יידע לתת
                        תשובות טובות יותר ללקוחות.
                    </p>
                    <ul style={{ paddingRight: 20, marginTop: 10, fontSize: 14 }}>
                        <li>הכלל מחירים אם יש (או הסבר שאין)</li>
                        <li>ציין זמני מענה ולוגיסטיקה</li>
                        <li>אם יש לינקים חשובים, צרף אותם</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
