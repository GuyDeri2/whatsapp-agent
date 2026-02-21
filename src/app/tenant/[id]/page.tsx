"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Tenant {
    id: string;
    business_name: string;
    description: string | null;
    products: string | null;
    target_customers: string | null;
    agent_mode: "learning" | "active" | "paused";
    agent_filter_mode: "all" | "whitelist" | "blacklist";
    whatsapp_connected: boolean;
    whatsapp_phone: string | null;
}

interface Conversation {
    id: string;
    phone_number: string;
    contact_name: string | null;
    is_group: boolean;
    updated_at: string;
}

interface Message {
    id: string;
    conversation_id: string;
    role: "user" | "assistant" | "owner";
    content: string;
    sender_name: string | null;
    is_from_agent: boolean;
    created_at: string;
    media_url?: string | null;
    media_type?: string | null;
}

interface ContactRule {
    id: string;
    tenant_id: string;
    phone_number: string;
    contact_name: string | null;
    rule_type: "allow" | "block";
    created_at: string;
}

/* ------------------------------------------------------------------ */
/* Toast component                                                     */
/* ------------------------------------------------------------------ */

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className={`toast toast-${type}`}>
            <span>{type === "success" ? "✅" : "❌"} {message}</span>
            <button onClick={onClose} className="toast-close">✕</button>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Page component                                                      */
/* ------------------------------------------------------------------ */

export default function TenantPage() {
    const supabase = createClient();
    const router = useRouter();
    const params = useParams();
    const tenantId = params.id as string;

    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [activeTab, setActiveTab] = useState<"chat" | "settings" | "connect" | "contacts">("chat");
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<string>("unknown");
    const [saving, setSaving] = useState(false);
    const [editForm, setEditForm] = useState({
        business_name: "",
        description: "",
        products: "",
        target_customers: "",
    });

    const [newMessage, setNewMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

    // Contact rules state
    const [contactRules, setContactRules] = useState<ContactRule[]>([]);
    const [newRulePhone, setNewRulePhone] = useState("");
    const [newRuleName, setNewRuleName] = useState("");
    const [newRuleType, setNewRuleType] = useState<"allow" | "block">("allow");

    // Last messages cache
    const [lastMessages, setLastMessages] = useState<Record<string, string>>({});

    const bottomRef = useRef<HTMLDivElement>(null);

    const showToast = (message: string, type: "success" | "error") => {
        setToast({ message, type });
    };

    // ── Fetch tenant info ──
    const fetchTenant = useCallback(async () => {
        const { data } = await supabase
            .from("tenants")
            .select("*")
            .eq("id", tenantId)
            .single();
        if (data) {
            setTenant(data);
            setEditForm({
                business_name: data.business_name || "",
                description: data.description || "",
                products: data.products || "",
                target_customers: data.target_customers || "",
            });
        }
    }, [supabase, tenantId]);

    // ── Fetch conversations with last messages ──
    const fetchConversations = useCallback(async () => {
        const { data } = await supabase
            .from("conversations")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("updated_at", { ascending: false });
        if (data) {
            setConversations(data);

            // Fetch last message for each conversation
            const lastMsgMap: Record<string, string> = {};
            for (const conv of data.slice(0, 20)) {
                const { data: msgs } = await supabase
                    .from("messages")
                    .select("content, media_type")
                    .eq("conversation_id", conv.id)
                    .order("created_at", { ascending: false })
                    .limit(1);
                if (msgs && msgs.length > 0) {
                    const m = msgs[0];
                    if (m.media_type && (m.content === `[${m.media_type} received]` || !m.content)) {
                        const labels: Record<string, string> = { image: "📷 תמונה", video: "🎥 סרטון", audio: "🎙️ הודעה קולית", document: "📄 מסמך", sticker: "🎨 סטיקר" };
                        lastMsgMap[conv.id] = labels[m.media_type] || "📎 קובץ";
                    } else {
                        lastMsgMap[conv.id] = m.content?.substring(0, 50) || "";
                    }
                }
            }
            setLastMessages(lastMsgMap);
        }
    }, [supabase, tenantId]);

    // ── Fetch messages ──
    const fetchMessages = useCallback(
        async (convId: string) => {
            const { data } = await supabase
                .from("messages")
                .select("*")
                .eq("conversation_id", convId)
                .order("created_at", { ascending: true });
            if (data) setMessages(data);
        },
        [supabase]
    );

    // ── Fetch contact rules ──
    const fetchContactRules = useCallback(async () => {
        try {
            const res = await fetch(`/api/tenants/${tenantId}/contacts`);
            const data = await res.json();
            if (data.rules) setContactRules(data.rules);
        } catch (err) {
            console.error("Failed to fetch contact rules:", err);
        }
    }, [tenantId]);

    // ── Initial load + realtime ──
    useEffect(() => {
        fetchTenant();
        fetchConversations();
        fetchContactRules();

        const channels: RealtimeChannel[] = [];

        const convChannel = supabase
            .channel(`conv-${tenantId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "conversations",
                    filter: `tenant_id=eq.${tenantId}`,
                },
                () => fetchConversations()
            )
            .subscribe();
        channels.push(convChannel);

        const msgChannel = supabase
            .channel(`msg-${tenantId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages" },
                (payload) => {
                    const newMsg = payload.new as Message;
                    setMessages((prev) => {
                        if (prev.length === 0) return prev;
                        if (prev[0]?.conversation_id !== newMsg.conversation_id)
                            return prev;
                        if (prev.find((m) => m.id === newMsg.id)) return prev;
                        return [...prev, newMsg];
                    });
                    fetchConversations();
                }
            )
            .subscribe();
        channels.push(msgChannel);

        return () => {
            channels.forEach((ch) => supabase.removeChannel(ch));
        };
    }, [supabase, tenantId, fetchTenant, fetchConversations, fetchContactRules]);

    // ── Auto-scroll ──
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Agent mode toggle ──
    const setAgentMode = async (mode: "learning" | "active" | "paused") => {
        await fetch(`/api/tenants/${tenantId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent_mode: mode }),
        });
        await fetchTenant();
    };

    // ── Agent filter mode toggle ──
    const setFilterMode = async (mode: "all" | "whitelist" | "blacklist") => {
        await fetch(`/api/tenants/${tenantId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent_filter_mode: mode }),
        });
        await fetchTenant();
        showToast(`מצב סינון שונה ל: ${filterLabels[mode]}`, "success");
    };

    // ── Add contact rule ──
    const handleAddRule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newRulePhone.trim()) return;

        const res = await fetch(`/api/tenants/${tenantId}/contacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone_number: newRulePhone.replace(/[^0-9]/g, ""),
                contact_name: newRuleName || null,
                rule_type: newRuleType,
            }),
        });

        if (res.ok) {
            setNewRulePhone("");
            setNewRuleName("");
            await fetchContactRules();
            showToast("כלל אנשי קשר נוסף", "success");
        } else {
            showToast("שגיאה בהוספת כלל", "error");
        }
    };

    // ── Add from conversation ──
    const handleAddFromConversation = async (conv: Conversation, ruleType: "allow" | "block") => {
        const res = await fetch(`/api/tenants/${tenantId}/contacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone_number: conv.phone_number,
                contact_name: conv.contact_name,
                rule_type: ruleType,
            }),
        });

        if (res.ok) {
            await fetchContactRules();
            showToast(
                ruleType === "allow"
                    ? `${conv.contact_name || conv.phone_number} נוסף לרשימה הלבנה`
                    : `${conv.contact_name || conv.phone_number} נחסם`,
                "success"
            );
        }
    };

    // ── Delete contact rule ──
    const handleDeleteRule = async (ruleId: string) => {
        const res = await fetch(`/api/tenants/${tenantId}/contacts?id=${ruleId}`, {
            method: "DELETE",
        });
        if (res.ok) {
            await fetchContactRules();
            showToast("כלל הוסר", "success");
        }
    };

    // ── Save settings ──
    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        const res = await fetch(`/api/tenants/${tenantId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editForm),
        });
        await fetchTenant();
        setSaving(false);
        if (res.ok) showToast("ההגדרות נשמרו בהצלחה", "success");
        else showToast("שגיאה בשמירת ההגדרות", "error");
    };

    // ── Connect WhatsApp ──
    const handleConnect = async () => {
        setConnectionStatus("connecting");
        setQrCode(null);
        const res = await fetch(`/api/sessions/${tenantId}/start`, { method: "POST" });
        const data = await res.json();
        if (data.qrCode) {
            setQrCode(data.qrCode);
            setConnectionStatus("waiting_scan");
        } else if (data.status === "connected") {
            setConnectionStatus("connected");
            await fetchTenant();
        }

        const interval = setInterval(async () => {
            const statusRes = await fetch(`/api/sessions/${tenantId}/status`);
            const statusData = await statusRes.json();
            if (statusData.status === "connected") {
                setConnectionStatus("connected");
                setQrCode(null);
                await fetchTenant();
                clearInterval(interval);
                showToast("ווטסאפ מחובר בהצלחה!", "success");
            } else if (statusData.qrCode) {
                setQrCode(statusData.qrCode);
                setConnectionStatus("waiting_scan");
            }
        }, 3000);

        setTimeout(() => clearInterval(interval), 120000);
    };

    // ── Disconnect WhatsApp ──
    const handleDisconnect = async () => {
        await fetch(`/api/sessions/${tenantId}/stop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clearData: true }),
        });
        setConnectionStatus("disconnected");
        setQrCode(null);
        await fetchTenant();
        showToast("ווטסאפ נותק", "success");
    };

    // ── Select conversation ──
    const selectConversation = (conv: Conversation) => {
        setSelectedConvId(conv.id);
        fetchMessages(conv.id);
    };

    // ── Send message ──
    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newMessage.trim() || !selectedConvId) return;
        const conv = conversations.find(c => c.id === selectedConvId);
        if (!conv) return;

        setIsSending(true);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone_number: conv.phone_number, text: newMessage.trim() }),
            });
            if (res.ok) {
                setNewMessage("");
            } else {
                const data = await res.json();
                showToast(`שגיאה: ${data.error}`, "error");
            }
        } catch (err) {
            console.error(err);
            showToast("שגיאה בשליחה", "error");
        } finally {
            setIsSending(false);
        }
    };

    // ── Handle key press (Enter to send) ──
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // ── Helpers ──
    const formatPhone = (phone: string) =>
        phone.length > 6 ? `+${phone.slice(0, 3)}-***-${phone.slice(-4)}` : phone;

    const formatTime = (ts: string) =>
        new Date(ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

    const formatDate = (ts: string) => {
        const d = new Date(ts);
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return "היום";
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return "אתמול";
        return d.toLocaleDateString("he-IL", { month: "short", day: "numeric" });
    };

    const getDisplayName = (conv: Conversation) => {
        if (conv.contact_name) return conv.contact_name;
        if (conv.is_group) return "שיחה קבוצתית";
        return formatPhone(conv.phone_number);
    };

    // ── Filter mode labels ──
    const filterLabels: Record<string, string> = {
        all: "כולם",
        whitelist: "רשימה לבנה בלבד",
        blacklist: "כולם חוץ מחסומים",
    };

    // ── Filtered conversations ──
    const filteredConversations = conversations.filter(conv => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return conv.contact_name?.toLowerCase().includes(q) || conv.phone_number.includes(q);
    });

    // ── Render media ──
    const renderMedia = (msg: Message) => {
        if (!msg.media_url) return null;
        switch (msg.media_type) {
            case "image":
            case "sticker":
                return <img src={msg.media_url} alt="תמונה" className="media-image" loading="lazy" />;
            case "video":
                return <video src={msg.media_url} controls className="media-video" preload="metadata" />;
            case "audio":
                return <audio src={msg.media_url} controls className="media-audio" />;
            case "document":
                return (
                    <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="media-document">
                        📄 הורד קובץ
                    </a>
                );
            default:
                return null;
        }
    };

    // ── Should show text (filter out synthetic "[type received]" content) ──
    const shouldShowText = (msg: Message) => {
        if (!msg.content) return false;
        if (msg.media_url && msg.content.match(/^\[.+ received\]$/)) return false;
        return true;
    };

    if (!tenant) return <div className="loading-state"><div className="spinner" /></div>;

    const modeConfig = {
        learning: { label: "למידה", emoji: "📚", color: "#f59e0b" },
        active: { label: "פעיל", emoji: "🤖", color: "#10b981" },
        paused: { label: "מושהה", emoji: "⏸️", color: "#6b7280" },
    };

    return (
        <div className="tenant-page">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Top Bar */}
            <header className="tenant-header">
                <button className="btn btn-ghost" onClick={() => router.push("/")}>→ חזרה</button>
                <div className="tenant-title">
                    <h1>{tenant.business_name}</h1>
                    <span className="mode-badge" style={{ backgroundColor: modeConfig[tenant.agent_mode].color }}>
                        {modeConfig[tenant.agent_mode].emoji} {modeConfig[tenant.agent_mode].label}
                    </span>
                    <span className={`status-dot ${tenant.whatsapp_connected ? "connected" : "disconnected"}`} />
                </div>
                <div className="mode-switcher">
                    {(["paused", "learning", "active"] as const).map((mode) => (
                        <button
                            key={mode}
                            className={`mode-btn ${tenant.agent_mode === mode ? "active" : ""}`}
                            onClick={() => setAgentMode(mode)}
                            style={tenant.agent_mode === mode ? { backgroundColor: modeConfig[mode].color } : {}}
                        >
                            {modeConfig[mode].emoji} {modeConfig[mode].label}
                        </button>
                    ))}
                </div>
            </header>

            {/* Tab Navigation */}
            <nav className="tab-nav">
                <button className={`tab ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>
                    💬 שיחות
                </button>
                <button className={`tab ${activeTab === "contacts" ? "active" : ""}`} onClick={() => { setActiveTab("contacts"); fetchContactRules(); }}>
                    👥 סינון אנשי קשר
                </button>
                <button className={`tab ${activeTab === "connect" ? "active" : ""}`} onClick={() => setActiveTab("connect")}>
                    📱 חיבור ווטסאפ
                </button>
                <button className={`tab ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
                    ⚙️ הגדרות
                </button>
            </nav>

            <div className="tab-content">
                {/* ── Chat Tab ── */}
                {activeTab === "chat" && (
                    <div className="chat-layout">
                        <aside className="chat-sidebar">
                            <h3>שיחות</h3>
                            <div className="search-box">
                                <input
                                    type="text"
                                    placeholder="🔍 חפש שיחה..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="search-input"
                                />
                            </div>
                            {filteredConversations.length === 0 && (
                                <div className="empty-mini">
                                    <p>{searchQuery ? "לא נמצאו תוצאות" : "אין שיחות עדיין"}</p>
                                </div>
                            )}
                            {filteredConversations.map((conv) => (
                                <button
                                    key={conv.id}
                                    className={`conv-item ${selectedConvId === conv.id ? "active" : ""}`}
                                    onClick={() => selectConversation(conv)}
                                >
                                    <div className="conv-avatar">
                                        {conv.is_group ? "👥" : "👤"}
                                    </div>
                                    <div className="conv-info">
                                        <span className="conv-name">{getDisplayName(conv)}</span>
                                        {!conv.is_group && conv.contact_name && (
                                            <span className="conv-phone-sub">{formatPhone(conv.phone_number)}</span>
                                        )}
                                        {lastMessages[conv.id] && (
                                            <span className="conv-preview">{lastMessages[conv.id]}</span>
                                        )}
                                        <span className="conv-time">{formatDate(conv.updated_at)}</span>
                                    </div>
                                </button>
                            ))}
                        </aside>

                        <main className="chat-main">
                            {!selectedConvId ? (
                                <div className="empty-chat">
                                    <div className="empty-chat-icon">💬</div>
                                    <h2>בחר שיחה</h2>
                                    <p>בחר שיחה מהרשימה כדי לצפות בהודעות</p>
                                </div>
                            ) : (
                                <>
                                    {/* Chat header with contact actions */}
                                    {(() => {
                                        const conv = conversations.find(c => c.id === selectedConvId);
                                        if (!conv) return null;
                                        const existingRule = contactRules.find(r => r.phone_number === conv.phone_number);
                                        return (
                                            <div className="chat-header-bar">
                                                <div className="chat-header-info">
                                                    <span className="chat-header-avatar">{conv.is_group ? "👥" : "👤"}</span>
                                                    <div>
                                                        <strong>{getDisplayName(conv)}</strong>
                                                        <span className="chat-header-phone">{conv.phone_number}</span>
                                                    </div>
                                                </div>
                                                <div className="chat-header-actions">
                                                    {existingRule ? (
                                                        <span className={`rule-badge rule-${existingRule.rule_type}`}>
                                                            {existingRule.rule_type === "allow" ? "✅ ברשימה לבנה" : "🚫 חסום"}
                                                        </span>
                                                    ) : (
                                                        <>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => handleAddFromConversation(conv, "allow")} title="הוסף לרשימה לבנה">
                                                                ✅ אפשר
                                                            </button>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => handleAddFromConversation(conv, "block")} title="חסום">
                                                                🚫 חסום
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    <div className="messages-list">
                                        {messages.map((msg) => (
                                            <div
                                                key={msg.id}
                                                className={`message-bubble ${msg.role} ${msg.is_from_agent ? "from-agent" : ""}`}
                                            >
                                                <div className="bubble-content">
                                                    {msg.is_from_agent && <span className="agent-badge">🤖 AI</span>}
                                                    {msg.role === "owner" && <span className="owner-badge">👤 בעלים</span>}
                                                    {msg.role === "user" && msg.sender_name && (
                                                        <span className="sender-name-badge">{msg.sender_name}</span>
                                                    )}
                                                    {renderMedia(msg)}
                                                    {shouldShowText(msg) && <p>{msg.content}</p>}
                                                    <span className="bubble-time">{formatTime(msg.created_at)}</span>
                                                </div>
                                            </div>
                                        ))}
                                        <div ref={bottomRef} />
                                    </div>
                                    <div className="chat-input-area">
                                        <form onSubmit={handleSendMessage} className="chat-input-form">
                                            <textarea
                                                value={newMessage}
                                                onChange={(e) => setNewMessage(e.target.value)}
                                                onKeyDown={handleKeyDown}
                                                placeholder="הקלד הודעה..."
                                                disabled={isSending || tenant.agent_mode === "active"}
                                                rows={1}
                                            />
                                            <button
                                                type="submit"
                                                className="btn btn-primary"
                                                disabled={!newMessage.trim() || isSending || tenant.agent_mode === "active"}
                                            >
                                                {isSending ? "..." : "שלח"}
                                            </button>
                                        </form>
                                        {tenant.agent_mode === "active" && (
                                            <div className="agent-active-warning">
                                                ⚠️ הסוכן פעיל. השהה את הסוכן כדי לענות ידנית.
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </main>
                    </div>
                )}

                {/* ── Contacts Tab ── */}
                {activeTab === "contacts" && (
                    <div className="settings-section">
                        <div className="settings-form">
                            <h2>👥 סינון אנשי קשר</h2>
                            <p style={{ color: "var(--text-secondary)", marginBottom: 20, fontSize: 14, lineHeight: 1.8 }}>
                                כאן אתה קובע <strong>למי הבוט יענה אוטומטית</strong> כשהוא במצב &quot;פעיל&quot;.<br />
                                📥 כל ההודעות תמיד נשמרות ומוצגות לך — הסינון משפיע <strong>רק</strong> על האם הבוט שולח תשובה אוטומטית או לא.
                            </p>

                            {/* Filter mode selector */}
                            <div className="filter-mode-selector">
                                <label style={{ display: "block", marginBottom: 12, fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>למי הבוט יענה?</label>
                                <div className="mode-switcher" style={{ marginBottom: 24 }}>
                                    {(["all", "whitelist", "blacklist"] as const).map((mode) => (
                                        <button
                                            key={mode}
                                            className={`mode-btn ${tenant.agent_filter_mode === mode ? "active" : ""}`}
                                            onClick={() => setFilterMode(mode)}
                                            style={tenant.agent_filter_mode === mode ? { backgroundColor: "var(--accent)" } : {}}
                                        >
                                            {mode === "all" ? "🌐" : mode === "whitelist" ? "✅" : "🚫"} {filterLabels[mode]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Add new rule */}
                            {tenant.agent_filter_mode !== "all" && (
                                <>
                                    <form onSubmit={handleAddRule} className="contact-rule-form">
                                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                                            <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                                                <label>מספר טלפון</label>
                                                <input
                                                    type="text"
                                                    placeholder="972501234567"
                                                    value={newRulePhone}
                                                    onChange={(e) => setNewRulePhone(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                                                <label>שם (אופציונלי)</label>
                                                <input
                                                    type="text"
                                                    placeholder="שם איש הקשר"
                                                    value={newRuleName}
                                                    onChange={(e) => setNewRuleName(e.target.value)}
                                                />
                                            </div>
                                            <div className="form-group" style={{ minWidth: 120 }}>
                                                <label>סוג</label>
                                                <select
                                                    value={newRuleType}
                                                    onChange={(e) => setNewRuleType(e.target.value as "allow" | "block")}
                                                    style={{
                                                        width: "100%",
                                                        padding: "12px 16px",
                                                        background: "rgba(0,0,0,0.3)",
                                                        border: "1px solid var(--border)",
                                                        borderRadius: "var(--radius-sm)",
                                                        color: "var(--text-primary)",
                                                        fontFamily: "inherit",
                                                        fontSize: 14,
                                                    }}
                                                >
                                                    <option value="allow">✅ אפשר</option>
                                                    <option value="block">🚫 חסום</option>
                                                </select>
                                            </div>
                                            <button type="submit" className="btn btn-primary" style={{ marginBottom: 20 }}>
                                                הוסף
                                            </button>
                                        </div>
                                    </form>

                                    {/* Quick add from conversations */}
                                    <div style={{ marginBottom: 24 }}>
                                        <h3 style={{ fontSize: 14, marginBottom: 12, color: "var(--text-secondary)" }}>הוסף מהירה מרשימת השיחות</h3>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                            {conversations.slice(0, 10).map((conv) => {
                                                const existingRule = contactRules.find(r => r.phone_number === conv.phone_number);
                                                if (existingRule) return null;
                                                return (
                                                    <button
                                                        key={conv.id}
                                                        className="btn btn-ghost"
                                                        style={{ fontSize: 12 }}
                                                        onClick={() => handleAddFromConversation(
                                                            conv,
                                                            tenant.agent_filter_mode === "whitelist" ? "allow" : "block"
                                                        )}
                                                    >
                                                        {tenant.agent_filter_mode === "whitelist" ? "✅" : "🚫"} {getDisplayName(conv)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Current rules */}
                                    <h3 style={{ fontSize: 14, marginBottom: 12, color: "var(--text-secondary)" }}>
                                        {contactRules.length > 0 ? `כללים פעילים (${contactRules.length})` : "אין כללים עדיין"}
                                    </h3>
                                    {contactRules.map((rule) => (
                                        <div key={rule.id} className="contact-rule-item">
                                            <span className={`rule-badge rule-${rule.rule_type}`}>
                                                {rule.rule_type === "allow" ? "✅ מאושר" : "🚫 חסום"}
                                            </span>
                                            <div style={{ flex: 1 }}>
                                                <strong>{rule.contact_name || rule.phone_number}</strong>
                                                {rule.contact_name && (
                                                    <span style={{ color: "var(--text-muted)", marginRight: 8, fontSize: 12 }}>
                                                        {rule.phone_number}
                                                    </span>
                                                )}
                                            </div>
                                            <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteRule(rule.id)}>
                                                🗑️
                                            </button>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Connect Tab ── */}
                {activeTab === "connect" && (
                    <div className="connect-section">
                        {tenant.whatsapp_connected ? (
                            <div className="connected-card">
                                <div className="connected-icon">✅</div>
                                <h2>ווטסאפ מחובר</h2>
                                <p>מחובר ל: <strong>{tenant.whatsapp_phone}</strong></p>
                                <p className="connected-info">
                                    הסוכן שלך{" "}
                                    {tenant.agent_mode === "active" ? "עונה באופן אוטומטי להודעות"
                                        : tenant.agent_mode === "learning" ? "צופה ולומד מהתשובות שלך"
                                            : "מושהה ולא מעבד הודעות"}.
                                </p>
                                <button className="btn btn-danger" onClick={handleDisconnect}>נתק ווטסאפ</button>
                            </div>
                        ) : (
                            <div className="connect-card">
                                <h2>חבר את הווטסאפ שלך</h2>
                                <p>סרוק את קוד ה-QR כדי לחבר את המספר העסקי.</p>
                                {connectionStatus === "connecting" && !qrCode && (
                                    <div className="qr-loading"><div className="spinner" /><p>מייצר קוד QR...</p></div>
                                )}
                                {qrCode && (
                                    <div className="qr-container">
                                        <img src={qrCode} alt="QR Code" className="qr-image" />
                                        <p className="qr-hint">פתח ווטסאפ → הגדרות → מכשירים מקושרים → קשר מכשיר</p>
                                    </div>
                                )}
                                {connectionStatus !== "connecting" && connectionStatus !== "waiting_scan" && (
                                    <button className="btn btn-primary btn-large" onClick={handleConnect}>📱 צור קוד QR</button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Settings Tab ── */}
                {activeTab === "settings" && (
                    <div className="settings-section">
                        <form onSubmit={handleSaveSettings} className="settings-form">
                            <h2>פרופיל עסקי</h2>
                            <div className="form-group">
                                <label>שם העסק</label>
                                <input type="text" value={editForm.business_name} onChange={(e) => setEditForm({ ...editForm, business_name: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label>תיאור</label>
                                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={4} placeholder="תאר את העסק שלך..." />
                            </div>
                            <div className="form-group">
                                <label>מוצרים / שירותים</label>
                                <textarea value={editForm.products} onChange={(e) => setEditForm({ ...editForm, products: e.target.value })} rows={4} placeholder="מה אתם מוכרים?" />
                            </div>
                            <div className="form-group">
                                <label>לקוחות יעד</label>
                                <textarea value={editForm.target_customers} onChange={(e) => setEditForm({ ...editForm, target_customers: e.target.value })} rows={3} placeholder="מי הלקוחות שלך?" />
                            </div>
                            <button type="submit" className="btn btn-primary" disabled={saving}>
                                {saving ? "שומר..." : "שמור הגדרות"}
                            </button>
                        </form>

                        <div className="danger-zone">
                            <h3>⚠️ אזור מסוכן</h3>
                            <p>מחיקת העסק תסיר את כל הנתונים ותנתק את הווטסאפ.</p>
                            <button
                                className="btn btn-danger"
                                onClick={async () => {
                                    if (confirm("האם אתה בטוח? פעולה זו תמחק את הכל לצמיתות.")) {
                                        await fetch(`/api/tenants/${tenantId}`, { method: "DELETE" });
                                        router.push("/");
                                    }
                                }}
                            >
                                מחק עסק
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
