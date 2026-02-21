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
    whatsapp_connected: boolean;
    whatsapp_phone: string | null;
}

interface Conversation {
    id: string;
    phone_number: string;
    contact_name: string | null;
    updated_at: string;
}

interface Message {
    id: string;
    conversation_id: string;
    role: "user" | "assistant" | "owner";
    content: string;
    is_from_agent: boolean;
    created_at: string;
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
    const [activeTab, setActiveTab] = useState<"chat" | "settings" | "connect">(
        "chat"
    );
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<string>("unknown");
    const [saving, setSaving] = useState(false);
    const [editForm, setEditForm] = useState({
        business_name: "",
        description: "",
        products: "",
        target_customers: "",
    });

    const bottomRef = useRef<HTMLDivElement>(null);

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

    // ── Fetch conversations ──
    const fetchConversations = useCallback(async () => {
        const { data } = await supabase
            .from("conversations")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("updated_at", { ascending: false });
        if (data) setConversations(data);
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

    // ── Initial load + realtime ──
    useEffect(() => {
        fetchTenant();
        fetchConversations();

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
    }, [supabase, tenantId, fetchTenant, fetchConversations]);

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

    // ── Save settings ──
    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        await fetch(`/api/tenants/${tenantId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editForm),
        });
        await fetchTenant();
        setSaving(false);
    };

    // ── Connect WhatsApp ──
    const handleConnect = async () => {
        setConnectionStatus("connecting");
        setQrCode(null);
        const res = await fetch(`/api/sessions/${tenantId}/start`, {
            method: "POST",
        });
        const data = await res.json();
        if (data.qrCode) {
            setQrCode(data.qrCode);
            setConnectionStatus("waiting_scan");
        } else if (data.status === "connected") {
            setConnectionStatus("connected");
            await fetchTenant();
        }

        // Poll for status updates
        const interval = setInterval(async () => {
            const statusRes = await fetch(`/api/sessions/${tenantId}/status`);
            const statusData = await statusRes.json();

            if (statusData.status === "connected") {
                setConnectionStatus("connected");
                setQrCode(null);
                await fetchTenant();
                clearInterval(interval);
            } else if (statusData.qrCode) {
                setQrCode(statusData.qrCode);
                setConnectionStatus("waiting_scan");
            }
        }, 3000);

        // Stop polling after 2 minutes
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
    };

    // ── Select conversation ──
    const selectConversation = (conv: Conversation) => {
        setSelectedConvId(conv.id);
        fetchMessages(conv.id);
    };

    // ── Helpers ──
    const formatPhone = (phone: string) =>
        phone.length > 6 ? `+${phone.slice(0, 3)}-***-${phone.slice(-4)}` : phone;

    const formatTime = (ts: string) =>
        new Date(ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });

    const formatDate = (ts: string) => {
        const d = new Date(ts);
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return "Today";
        return d.toLocaleDateString([], { month: "short", day: "numeric" });
    };

    if (!tenant)
        return (
            <div className="loading-state">
                <div className="spinner" />
            </div>
        );

    const modeConfig = {
        learning: { label: "Learning", emoji: "📚", color: "#f59e0b" },
        active: { label: "Active", emoji: "🤖", color: "#10b981" },
        paused: { label: "Paused", emoji: "⏸️", color: "#6b7280" },
    };

    return (
        <div className="tenant-page">
            {/* Top Bar */}
            <header className="tenant-header">
                <button className="btn btn-ghost" onClick={() => router.push("/")}>
                    ← Back
                </button>
                <div className="tenant-title">
                    <h1>{tenant.business_name}</h1>
                    <span
                        className="mode-badge"
                        style={{ backgroundColor: modeConfig[tenant.agent_mode].color }}
                    >
                        {modeConfig[tenant.agent_mode].emoji}{" "}
                        {modeConfig[tenant.agent_mode].label}
                    </span>
                    <span
                        className={`status-dot ${tenant.whatsapp_connected ? "connected" : "disconnected"
                            }`}
                    />
                </div>
                <div className="mode-switcher">
                    {(["paused", "learning", "active"] as const).map((mode) => (
                        <button
                            key={mode}
                            className={`mode-btn ${tenant.agent_mode === mode ? "active" : ""
                                }`}
                            onClick={() => setAgentMode(mode)}
                            style={
                                tenant.agent_mode === mode
                                    ? { backgroundColor: modeConfig[mode].color }
                                    : {}
                            }
                        >
                            {modeConfig[mode].emoji} {modeConfig[mode].label}
                        </button>
                    ))}
                </div>
            </header>

            {/* Tab Navigation */}
            <nav className="tab-nav">
                <button
                    className={`tab ${activeTab === "chat" ? "active" : ""}`}
                    onClick={() => setActiveTab("chat")}
                >
                    💬 Conversations
                </button>
                <button
                    className={`tab ${activeTab === "connect" ? "active" : ""}`}
                    onClick={() => setActiveTab("connect")}
                >
                    📱 WhatsApp Connection
                </button>
                <button
                    className={`tab ${activeTab === "settings" ? "active" : ""}`}
                    onClick={() => setActiveTab("settings")}
                >
                    ⚙️ Settings
                </button>
            </nav>

            {/* Tab Content */}
            <div className="tab-content">
                {/* ── Chat Tab ── */}
                {activeTab === "chat" && (
                    <div className="chat-layout">
                        {/* Sidebar */}
                        <aside className="chat-sidebar">
                            <h3>Conversations</h3>
                            {conversations.length === 0 && (
                                <div className="empty-mini">
                                    <p>No conversations yet</p>
                                </div>
                            )}
                            {conversations.map((conv) => (
                                <button
                                    key={conv.id}
                                    className={`conv-item ${selectedConvId === conv.id ? "active" : ""
                                        }`}
                                    onClick={() => selectConversation(conv)}
                                >
                                    <div className="conv-avatar">👤</div>
                                    <div className="conv-info">
                                        <span className="conv-name">
                                            {conv.contact_name || formatPhone(conv.phone_number)}
                                        </span>
                                        <span className="conv-time">
                                            {formatDate(conv.updated_at)}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </aside>

                        {/* Chat Messages */}
                        <main className="chat-main">
                            {!selectedConvId && (
                                <div className="empty-chat">
                                    <div className="empty-chat-icon">💬</div>
                                    <h2>Select a conversation</h2>
                                    <p>Choose a conversation from the sidebar to view messages.</p>
                                </div>
                            )}
                            {selectedConvId && (
                                <div className="messages-list">
                                    {messages.map((msg) => (
                                        <div
                                            key={msg.id}
                                            className={`message-bubble ${msg.role} ${msg.is_from_agent ? "from-agent" : ""
                                                }`}
                                        >
                                            <div className="bubble-content">
                                                {msg.is_from_agent && (
                                                    <span className="agent-badge">🤖 AI</span>
                                                )}
                                                {msg.role === "owner" && (
                                                    <span className="owner-badge">👤 Owner</span>
                                                )}
                                                <p>{msg.content}</p>
                                                <span className="bubble-time">
                                                    {formatTime(msg.created_at)}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={bottomRef} />
                                </div>
                            )}
                        </main>
                    </div>
                )}

                {/* ── Connect Tab ── */}
                {activeTab === "connect" && (
                    <div className="connect-section">
                        {tenant.whatsapp_connected ? (
                            <div className="connected-card">
                                <div className="connected-icon">✅</div>
                                <h2>WhatsApp Connected</h2>
                                <p>
                                    Connected to: <strong>{tenant.whatsapp_phone}</strong>
                                </p>
                                <p className="connected-info">
                                    Your agent is{" "}
                                    {tenant.agent_mode === "active"
                                        ? "actively replying to messages"
                                        : tenant.agent_mode === "learning"
                                            ? "observing and learning from your replies"
                                            : "paused and not processing messages"}
                                    .
                                </p>
                                <button
                                    className="btn btn-danger"
                                    onClick={handleDisconnect}
                                >
                                    Disconnect WhatsApp
                                </button>
                            </div>
                        ) : (
                            <div className="connect-card">
                                <h2>Connect Your WhatsApp</h2>
                                <p>
                                    Scan the QR code with WhatsApp on your phone to connect your
                                    business number.
                                </p>

                                {connectionStatus === "connecting" && !qrCode && (
                                    <div className="qr-loading">
                                        <div className="spinner" />
                                        <p>Generating QR code...</p>
                                    </div>
                                )}

                                {qrCode && (
                                    <div className="qr-container">
                                        <img src={qrCode} alt="QR Code" className="qr-image" />
                                        <p className="qr-hint">
                                            Open WhatsApp → Settings → Linked Devices → Link a Device
                                        </p>
                                    </div>
                                )}

                                {connectionStatus !== "connecting" &&
                                    connectionStatus !== "waiting_scan" && (
                                        <button
                                            className="btn btn-primary btn-large"
                                            onClick={handleConnect}
                                        >
                                            📱 Generate QR Code
                                        </button>
                                    )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Settings Tab ── */}
                {activeTab === "settings" && (
                    <div className="settings-section">
                        <form onSubmit={handleSaveSettings} className="settings-form">
                            <h2>Business Profile</h2>

                            <div className="form-group">
                                <label>Business Name</label>
                                <input
                                    type="text"
                                    value={editForm.business_name}
                                    onChange={(e) =>
                                        setEditForm({
                                            ...editForm,
                                            business_name: e.target.value,
                                        })
                                    }
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>Description</label>
                                <textarea
                                    value={editForm.description}
                                    onChange={(e) =>
                                        setEditForm({ ...editForm, description: e.target.value })
                                    }
                                    rows={4}
                                    placeholder="Describe your business..."
                                />
                            </div>

                            <div className="form-group">
                                <label>Products / Services</label>
                                <textarea
                                    value={editForm.products}
                                    onChange={(e) =>
                                        setEditForm({ ...editForm, products: e.target.value })
                                    }
                                    rows={4}
                                    placeholder="What do you sell?"
                                />
                            </div>

                            <div className="form-group">
                                <label>Target Customers</label>
                                <textarea
                                    value={editForm.target_customers}
                                    onChange={(e) =>
                                        setEditForm({
                                            ...editForm,
                                            target_customers: e.target.value,
                                        })
                                    }
                                    rows={3}
                                    placeholder="Who are your customers?"
                                />
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={saving}
                            >
                                {saving ? "Saving..." : "Save Settings"}
                            </button>
                        </form>

                        <div className="danger-zone">
                            <h3>⚠️ Danger Zone</h3>
                            <p>
                                Deleting this business will remove all conversations, learnings,
                                and disconnect WhatsApp.
                            </p>
                            <button
                                className="btn btn-danger"
                                onClick={async () => {
                                    if (
                                        confirm(
                                            "Are you sure? This will permanently delete this business and all its data."
                                        )
                                    ) {
                                        await fetch(`/api/tenants/${tenantId}`, {
                                            method: "DELETE",
                                        });
                                        router.push("/");
                                    }
                                }}
                            >
                                Delete Business
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
