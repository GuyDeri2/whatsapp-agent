import React from "react";

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

export function ContactsTab({
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
    return (
        <div className="settings-section">
            <div className="settings-form">
                <h2>👥 סינון אנשי קשר</h2>
                <p
                    style={{
                        color: "var(--text-secondary)",
                        marginBottom: 20,
                        fontSize: 14,
                        lineHeight: 1.8,
                    }}
                >
                    כאן אתה קובע <strong>למי הבוט יענה אוטומטית</strong> כשהוא במצב
                    "פעיל".
                    <br />
                    📥 כל ההודעות תמיד נשמרות ומוצגות לך — הסינון משפיע{" "}
                    <strong>רק</strong> על האם הבוט שולח תשובה אוטומטית או לא.
                </p>

                {/* Filter mode selector */}
                <div className="filter-mode-selector">
                    <label
                        style={{
                            display: "block",
                            marginBottom: 12,
                            fontSize: 13,
                            color: "var(--text-secondary)",
                            fontWeight: 500,
                        }}
                    >
                        למי הבוט יענה?
                    </label>
                    <div className="mode-switcher" style={{ marginBottom: 24 }}>
                        {(["all", "whitelist", "blacklist"] as const).map((mode) => (
                            <button
                                key={mode}
                                className={`mode-btn ${tenant.agent_filter_mode === mode ? "active" : ""
                                    }`}
                                onClick={() => setFilterMode(mode)}
                                style={
                                    tenant.agent_filter_mode === mode
                                        ? { backgroundColor: "var(--accent)" }
                                        : {}
                                }
                            >
                                {mode === "all" ? "🌐" : mode === "whitelist" ? "✅" : "🚫"}{" "}
                                {filterLabels[mode]}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Add new rule */}
                <div className="add-rule-card">
                    <h3>הוסף כלל חדש</h3>
                    <form className="rule-form" onSubmit={handleAddRule}>
                        <div className="form-row">
                            <input
                                type="text"
                                placeholder="מספר טלפון (חובה)"
                                value={newRulePhone}
                                onChange={(e) => setNewRulePhone(e.target.value)}
                                required
                            />
                            <input
                                type="text"
                                placeholder="שם (אופציונלי)"
                                value={newRuleName}
                                onChange={(e) => setNewRuleName(e.target.value)}
                            />
                            <select
                                value={newRuleType}
                                onChange={(e) =>
                                    setNewRuleType(e.target.value as "allow" | "block")
                                }
                            >
                                <option value="allow">✅ אפשר (רשימה לבנה)</option>
                                <option value="block">🚫 חסום (רשימה שחורה)</option>
                            </select>
                            <button type="submit" className="btn btn-primary">
                                הוסף
                            </button>
                        </div>
                    </form>
                </div>

                {/* Rules list */}
                <div className="rules-list">
                    {contactRules.length === 0 ? (
                        <p className="empty-text">לא הוגדרו כללים עדיין.</p>
                    ) : (
                        contactRules.map((rule) => (
                            <div key={rule.id} className="rule-item">
                                <div className="rule-info">
                                    <span
                                        className={`rule-badge rule-${rule.rule_type}`}
                                        title={
                                            rule.rule_type === "allow" ? "רשימה לבנה" : "רשימה שחורה"
                                        }
                                    >
                                        {rule.rule_type === "allow" ? "✅" : "🚫"}
                                    </span>
                                    <strong>{rule.phone_number}</strong>
                                    {rule.contact_name && (
                                        <span className="rule-name">- {rule.contact_name}</span>
                                    )}
                                </div>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleDeleteRule(rule.id)}
                                    title="מחק כלל"
                                >
                                    🗑️
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
