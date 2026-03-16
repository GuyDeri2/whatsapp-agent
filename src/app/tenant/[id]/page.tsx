"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { ChatTab } from "@/components/tenant/ChatTab";
import { SettingsTab } from "@/components/tenant/SettingsTab";
import { ConnectTab } from "@/components/tenant/ConnectTab";
import { ContactsTab } from "@/components/tenant/ContactsTab";
import { CapabilitiesTab } from "@/components/tenant/CapabilitiesTab";
import { LeadsTab } from "@/components/tenant/LeadsTab";
import { CalendarTab } from "@/components/tenant/CalendarTab";

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
    agent_respond_to_saved_contacts: boolean;
    handoff_collect_email: boolean;
    whatsapp_connected: boolean;
    whatsapp_phone: string | null;
}

interface Conversation {
    id: string;
    phone_number: string;
    contact_name: string | null;
    is_group: boolean;
    is_paused?: boolean;
    updated_at: string;
    profile_picture_url: string | null;
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

function isRTL(text: string): boolean {
    if (!text) return false;
    const firstChar = text.replace(/[\s\u200f\u200e\[\(]/g, '').charAt(0);
    return /[\u0590-\u05FF\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(firstChar);
}

const AVATAR_COLORS = [
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#ef4444', '#f97316',
    '#eab308', '#84cc16', '#22c55e', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#2563eb',
];

const MEDIA_LABELS: Record<string, string> = {
    image: "📷 תמונה",
    video: "🎥 סרטון",
    audio: "🎙️ הודעה קולית",
    document: "📄 מסמך",
    sticker: "🎨 סטיקר",
};

function getAvatarColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string, isGroup: boolean): string {
    if (!name) return isGroup ? '👥' : '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 3500);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div
            className={`fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-xl text-sm font-medium transition-all animate-in fade-in slide-in-from-top-3 duration-300 ${
                type === "success"
                    ? "bg-emerald-900/90 border-emerald-500/40 text-emerald-100"
                    : "bg-red-900/90 border-red-500/40 text-red-100"
            }`}
        >
            <span>{type === "success" ? "✅" : "❌"}</span>
            <span>{message}</span>
            <button
                onClick={onClose}
                className="mr-1 opacity-60 hover:opacity-100 transition-opacity text-base leading-none"
            >
                ✕
            </button>
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
    const [activeTab, setActiveTab] = useState<"chat" | "settings" | "connect" | "contacts" | "capabilities" | "leads" | "calendar">("chat");
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<string>("unknown");
    const [saving, setSaving] = useState(false);
    const [editForm, setEditForm] = useState({
        business_name: "",
        description: "",
        products: "",
        target_customers: "",
        agent_respond_to_saved_contacts: true,
        handoff_collect_email: false,
        owner_phone: "",
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

    // Debounce ref for realtime events
    const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Track selected conversation id in a ref so realtime callbacks always see current value
    const selectedConvIdRef = useRef<string | null>(null);
    // QR polling interval ref — allows cleanup on unmount
    const qrPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const showToast = (message: string, type: "success" | "error") => {
        setToast({ message, type });
    };

    // ── Apply tenant data (shared between cache and fresh fetch) ──
    const applyTenantData = useCallback((data: Tenant) => {
        setTenant(data);
        setEditForm({
            business_name: data.business_name || "",
            description: data.description || "",
            products: data.products || "",
            target_customers: data.target_customers || "",
            agent_respond_to_saved_contacts: (data as any).agent_respond_to_saved_contacts ?? true,
            handoff_collect_email: data.handoff_collect_email ?? false,
            owner_phone: (() => {
                const p = (data as any).owner_phone || "";
                if (p.startsWith("972") && p.length === 12) return "0" + p.substring(3);
                return p;
            })(),
        });
    }, []);

    // ── Fetch tenant info (with sessionStorage cache for instant first paint) ──
    const fetchTenant = useCallback(async () => {
        const cacheKey = `tenant_cache_${tenantId}`;
        // Show cached data instantly on first render (avoids skeleton on repeat visits)
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) applyTenantData(JSON.parse(cached));
        } catch { /* ignore */ }

        const { data } = await supabase
            .from("tenants")
            .select("*")
            .eq("id", tenantId)
            .single();
        if (data) {
            applyTenantData(data);
            try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* ignore */ }
        }
    }, [supabase, tenantId, applyTenantData]);

    // ── Apply conversations + last messages (shared between cache and fresh fetch) ──
    const applyConversationsData = useCallback((rows: any[]) => {
        setConversations(rows);
        const lastMsgMap: Record<string, string> = {};
        for (const row of rows) {
            if (!row.last_message && !row.last_media_type) continue;
            if (row.last_media_type && (row.last_message === `[${row.last_media_type} received]` || !row.last_message)) {
                lastMsgMap[row.id] = MEDIA_LABELS[row.last_media_type] || "📎 קובץ";
            } else {
                lastMsgMap[row.id] = row.last_message?.substring(0, 50) || "";
            }
        }
        setLastMessages(prev => ({ ...prev, ...lastMsgMap }));
    }, []);

    // ── Fetch conversations with last message preview — single round-trip via RPC ──
    const fetchConversations = useCallback(async () => {
        const cacheKey = `conv_cache_${tenantId}`;
        // Show cached conversations instantly while fetching fresh data
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) applyConversationsData(JSON.parse(cached));
        } catch { /* ignore */ }

        const { data } = await supabase
            .rpc("get_conversations_with_preview", { p_tenant_id: tenantId, p_limit: 50 });
        if (data) {
            applyConversationsData(data);
            try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* ignore */ }
        }
    }, [supabase, tenantId, applyConversationsData]);

    // ── Fetch messages ──
    const fetchMessages = useCallback(
        async (convId: string) => {
            const { data } = await supabase
                .from("messages")
                .select("*")
                .eq("conversation_id", convId)
                .order("created_at", { ascending: false })
                .limit(100);
            if (data) setMessages([...data].reverse());
        },
        [supabase]
    );

    // Ref to always have the latest fetchMessages in realtime callbacks (avoids stale closure)
    const fetchMessagesRef = useRef(fetchMessages);
    useEffect(() => {
        fetchMessagesRef.current = fetchMessages;
    }, [fetchMessages]);

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
        // Prefetch dashboard so back-navigation is instant
        router.prefetch("/dashboard");

        fetchTenant();
        fetchConversations();
        fetchContactRules();

        // Fetch live connection status from session-manager on load
        // so connectionStatus reflects reality even after a page refresh
        fetch(`/api/sessions/${tenantId}/status`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                if (data.status === "connected") {
                    setConnectionStatus("connected");
                } else if (data.qrCode) {
                    setQrCode(data.qrCode);
                    setConnectionStatus("waiting_scan");
                } else {
                    setConnectionStatus("disconnected");
                }
            })
            .catch(() => { /* ignore — session-manager may be unreachable */ });

        const channels: RealtimeChannel[] = [];

        const debouncedFetch = () => {
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
            fetchTimeoutRef.current = setTimeout(() => {
                fetchConversations();
                // Re-sync messages for the currently open conversation to ensure DB consistency
                if (selectedConvIdRef.current) {
                    fetchMessagesRef.current(selectedConvIdRef.current);
                }
            }, 200); // Wait 200ms for bulk DB operations to settle
        };

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
                (payload) => {
                    if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
                        const newConv = payload.new as Conversation;
                        // Optimistically reorder and update UI instantly
                        setConversations(prev => {
                            const without = prev.filter(c => c.id !== newConv.id);
                            // Insert at the top because it's updated or new!
                            return [newConv, ...without].sort((a, b) =>
                                new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                            );
                        });
                    }
                    debouncedFetch();
                }
            )
            .subscribe();
        channels.push(convChannel);

        const msgChannel = supabase
            .channel(`msg-${tenantId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "messages",
                    filter: `tenant_id=eq.${tenantId}`,
                },
                (payload) => {
                    if (payload.eventType === "INSERT") {
                        const newMsg = payload.new as Message;
                        const msgTime = newMsg.created_at || new Date().toISOString();

                        // 1. Append message to active chat view.
                        // If there's a matching optimistic temp message (same role + content),
                        // replace it with the real DB row to avoid duplicates.
                        if (newMsg.conversation_id === selectedConvIdRef.current) {
                            setMessages((prev) => {
                                if (prev.find((m) => m.id === newMsg.id)) return prev;
                                // Replace matching temp optimistic message if present
                                const tempIdx = prev.findIndex(
                                    (m) => m.id.startsWith("temp-") &&
                                        m.role === newMsg.role &&
                                        m.content === newMsg.content &&
                                        m.conversation_id === newMsg.conversation_id
                                );
                                if (tempIdx !== -1) {
                                    const updated = [...prev];
                                    updated[tempIdx] = newMsg;
                                    return updated;
                                }
                                return [...prev, newMsg];
                            });
                        }

                        // 2. Optimistically update Sidebar Preview instantly
                        setLastMessages(prev => {
                            let textPreview = newMsg.content?.substring(0, 50) || "";
                            if (newMsg.media_type && (newMsg.content === `[${newMsg.media_type} received]` || !newMsg.content)) {
                                textPreview = MEDIA_LABELS[newMsg.media_type] || "📎 קובץ";
                            }
                            return { ...prev, [newMsg.conversation_id]: textPreview };
                        });

                        // 3. Immediately bubble the conversation to the top —
                        //    don't wait for the DB updated_at to propagate
                        setConversations(prev => {
                            const idx = prev.findIndex(c => c.id === newMsg.conversation_id);
                            if (idx === -1) return prev;
                            const updated = { ...prev[idx], updated_at: msgTime };
                            const rest = prev.filter(c => c.id !== newMsg.conversation_id);
                            return [updated, ...rest];
                        });

                        debouncedFetch();
                    } else if (payload.eventType === "UPDATE") {
                        const updatedMsg = payload.new as Message;
                        setMessages((prev) =>
                            prev.map((msg) => (msg.id === updatedMsg.id ? updatedMsg : msg))
                        );
                    }
                }
            )
            .subscribe();
        channels.push(msgChannel);

        // ── Realtime: tenant row changes (whatsapp_connected, agent_mode, etc.) ──
        const tenantChannel = supabase
            .channel(`tenant-${tenantId}`)
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "tenants",
                    filter: `id=eq.${tenantId}`,
                },
                () => {
                    // Re-fetch tenant so whatsapp_connected badge updates immediately
                    fetchTenant();
                }
            )
            .subscribe();
        channels.push(tenantChannel);

        // ── Refresh when tab regains focus ──
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                fetchTenant();
                fetchConversations();
                if (selectedConvIdRef.current) {
                    fetchMessagesRef.current(selectedConvIdRef.current);
                }
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        // ── Periodic polling fallback (every 60s) ──
        const pollingInterval = setInterval(() => {
            fetchConversations();
            if (selectedConvIdRef.current) {
                fetchMessagesRef.current(selectedConvIdRef.current);
            }
        }, 60000);

        return () => {
            channels.forEach((ch) => supabase.removeChannel(ch));
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearInterval(pollingInterval);
            // Clean up QR polling interval on unmount
            if (qrPollingRef.current) {
                clearInterval(qrPollingRef.current);
                qrPollingRef.current = null;
            }
        };
    }, [supabase, tenantId, fetchTenant, fetchConversations, fetchContactRules]);

    // ── Agent mode toggle ──
    const setAgentMode = async (mode: "learning" | "active" | "paused") => {
        setTenant(prev => prev ? { ...prev, agent_mode: mode } : prev); // Instant UI
        try {
            await fetch(`/api/tenants/${tenantId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent_mode: mode }),
            });
        } catch {
            fetchTenant(); // Revert on error
            showToast("שגיאה בשינוי מצב הסוכן", "error");
        }
    };

    // ── Agent filter mode toggle ──
    const setFilterMode = async (mode: "all" | "whitelist" | "blacklist") => {
        setTenant(prev => prev ? { ...prev, agent_filter_mode: mode } : prev); // Instant UI
        showToast(`מצב סינון שונה ל: ${filterLabels[mode]}`, "success");
        try {
            await fetch(`/api/tenants/${tenantId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent_filter_mode: mode }),
            });
        } catch {
            fetchTenant(); // Revert on error
            showToast("שגיאה בשינוי מצב הסינון", "error");
        }
    };

    // ── Add contact rule ──
    const handleAddRule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newRulePhone.trim()) return;

        const phone = normalizePhone(newRulePhone);
        const name = newRuleName || null;
        const ruleType = newRuleType;

        // Clear form immediately for perceived performance
        setNewRulePhone("");
        setNewRuleName("");

        // Optimistic update
        const tempId = `temp-${Date.now()}`;
        const optimisticRule: ContactRule = {
            id: tempId, tenant_id: tenantId, phone_number: phone,
            contact_name: name, rule_type: ruleType, created_at: new Date().toISOString(),
        };
        setContactRules(prev => [...prev, optimisticRule]);

        const res = await fetch(`/api/tenants/${tenantId}/contacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone_number: phone, contact_name: name, rule_type: ruleType }),
        });

        if (res.ok) {
            fetchContactRules(); // Replace temp with real server-generated ID
            showToast("כלל אנשי קשר נוסף", "success");
        } else {
            setContactRules(prev => prev.filter(r => r.id !== tempId)); // Revert
            showToast("שגיאה בהוספת כלל", "error");
        }
    };

    // ── Add from conversation ──
    const handleAddFromConversation = async (conv: Conversation, ruleType: "allow" | "block") => {
        // Optimistic update
        const tempId = `temp-${Date.now()}`;
        const optimisticRule: ContactRule = {
            id: tempId, tenant_id: tenantId, phone_number: conv.phone_number,
            contact_name: conv.contact_name, rule_type: ruleType, created_at: new Date().toISOString(),
        };
        setContactRules(prev => [...prev, optimisticRule]);

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
            fetchContactRules(); // Replace temp with real server-generated ID
            showToast(
                ruleType === "allow"
                    ? `${conv.contact_name || formatPhone(conv.phone_number)} נוסף לרשימה הלבנה`
                    : `${conv.contact_name || formatPhone(conv.phone_number)} נחסם`,
                "success"
            );
        } else {
            setContactRules(prev => prev.filter(r => r.id !== tempId)); // Revert
        }
    };

    // ── Delete contact rule ──
    const handleDeleteRule = async (ruleId: string) => {
        setContactRules(prev => prev.filter(r => r.id !== ruleId)); // Instant
        const res = await fetch(`/api/tenants/${tenantId}/contacts?id=${ruleId}`, {
            method: "DELETE",
        });
        if (res.ok) {
            showToast("כלל הוסר", "success");
        } else {
            fetchContactRules(); // Revert on error
            showToast("שגיאה בהסרת כלל", "error");
        }
    };

    // ── Toggle AI Pause for a single conversation ──
    const handleTogglePause = async (convId: string, currentPausedState: boolean) => {
        const res = await fetch(`/api/tenants/${tenantId}/conversations/${convId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_paused: !currentPausedState }),
        });

        if (res.ok) {
            setConversations((prev) =>
                prev.map((c) => (c.id === convId ? { ...c, is_paused: !currentPausedState } : c))
            );
            showToast(!currentPausedState ? "ה-AI הושהה עבור שיחה זו" : "ה-AI הופעל מחדש עבור שיחה זו", "success");
        } else {
            showToast("שגיאה בעדכון הסטטוס", "error");
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
        const data = await res.json();
        setSaving(false); // Stop spinner as soon as API responds
        if (res.ok) {
            if (data.phoneWarning) {
                showToast(`⚠️ נשמר, אך: ${data.phoneWarning}`, "error");
            } else {
                showToast("ההגדרות נשמרו בהצלחה", "success");
            }
            fetchTenant(); // Background sync (don't await)
        } else {
            showToast("שגיאה בשמירת ההגדרות", "error");
        }
    };

    // ── Connect WhatsApp ──
    const handleConnect = async () => {
        setConnectionStatus("connecting");
        setQrCode(null);
        try {
            const res = await fetch(`/api/sessions/${tenantId}/start`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to start");

            if (data.qrCode) {
                setQrCode(data.qrCode);
                setConnectionStatus("waiting_scan");
            } else if (data.status === "connected") {
                setConnectionStatus("connected");
                await fetchTenant();
            }

            // Clear any previous QR polling interval before starting a new one
            if (qrPollingRef.current) clearInterval(qrPollingRef.current);

            qrPollingRef.current = setInterval(async () => {
                try {
                    const statusRes = await fetch(`/api/sessions/${tenantId}/status`);
                    const statusData = await statusRes.json();
                    if (statusData.status === "connected") {
                        setConnectionStatus("connected");
                        setQrCode(null);
                        await fetchTenant();
                        if (qrPollingRef.current) {
                            clearInterval(qrPollingRef.current);
                            qrPollingRef.current = null;
                        }
                        showToast("ווטסאפ מחובר בהצלחה!", "success");
                    } else if (statusData.qrCode) {
                        setQrCode(statusData.qrCode);
                        setConnectionStatus("waiting_scan");
                    }
                } catch {
                    // ignore polling errors
                }
            }, 3000);

            // Stop polling after 2 minutes regardless
            setTimeout(() => {
                if (qrPollingRef.current) {
                    clearInterval(qrPollingRef.current);
                    qrPollingRef.current = null;
                }
            }, 120000);
        } catch (err: any) {
            console.error(err);
            const errMsg = err.message || "שגיאה בחיבור לשרת";
            showToast(`שגיאה: ${errMsg}`, "error");
            setConnectionStatus("disconnected");
        }
    };

    // ── Disconnect WhatsApp ──
    const handleDisconnect = async () => {
        try {
            await fetch(`/api/sessions/${tenantId}/stop`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clearData: true }),
            });
            setConnectionStatus("disconnected");
            setQrCode(null);
            await fetchTenant();
            showToast("ווטסאפ נותק", "success");
        } catch {
            showToast("שגיאה בניתוק ווטסאפ", "error");
        }
    };

    const handleReconnect = async (clearAuth = false) => {
        showToast("מתחבר מחדש...", "success");
        setConnectionStatus("connecting");
        try {
            const res = await fetch(`/api/sessions/${tenantId}/reconnect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clearAuth }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to reconnect");
            if (data.qrCode) {
                setQrCode(data.qrCode);
                setConnectionStatus("waiting_scan");
            }
            await fetchTenant();
            showToast(clearAuth ? "נוצר QR חדש — סרוק שוב" : "מתחבר מחדש...", "success");
        } catch (err: any) {
            console.error(err);
            const errMsg = err.message || "שגיאה בחיבור לשרת";
            showToast(`שגיאה בהתחברות מחדש: ${errMsg}`, "error");
            setConnectionStatus("disconnected");
        }
    };

    // ── Select conversation ──
    const selectConversation = (conv: Conversation) => {
        setSelectedConvId(conv.id);
        selectedConvIdRef.current = conv.id;
        // Don't clear messages — avoids flash of empty state while loading
        fetchMessages(conv.id);
        fetchConversations(); // Refresh sidebar to show latest previews
    };

    // ── Send message ──
    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newMessage.trim() || !selectedConvId) return;
        const conv = conversations.find(c => c.id === selectedConvId);
        if (!conv) return;

        const messageText = newMessage.trim();
        const tempId = `temp-${Date.now()}`;
        const now = new Date().toISOString();

        // Optimistic update — show message immediately before API responds
        const optimisticMsg: Message = {
            id: tempId,
            conversation_id: selectedConvId,
            role: "owner",
            content: messageText,
            sender_name: "Owner",
            is_from_agent: false,
            created_at: now,
        };
        setMessages(prev => [...prev, optimisticMsg]);
        setNewMessage("");

        // Also update conversation preview and bubble to top instantly
        setLastMessages(prev => ({ ...prev, [selectedConvId]: messageText.substring(0, 50) }));
        setConversations(prev => {
            const idx = prev.findIndex(c => c.id === selectedConvId);
            if (idx === -1) return prev;
            const updated = { ...prev[idx], updated_at: now };
            const rest = prev.filter(c => c.id !== selectedConvId);
            return [updated, ...rest];
        });

        setIsSending(true);
        try {
            const res = await fetch(`/api/tenants/${tenantId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone_number: conv.phone_number, text: messageText }),
            });
            if (!res.ok) {
                const data = await res.json();
                showToast(`שגיאה: ${data.error}`, "error");
                // Revert optimistic message on failure
                setMessages(prev => prev.filter(m => m.id !== tempId));
                setNewMessage(messageText);
            }
            // On success: Realtime will replace the temp message with the real DB row.
            // If Realtime fires before we remove the temp, the dedup check (m.id !== newMsg.id)
            // will prevent duplicates since temp id won't match the real DB UUID.
        } catch (err) {
            console.error(err);
            showToast("שגיאה בשליחה", "error");
            // Revert optimistic message on network error
            setMessages(prev => prev.filter(m => m.id !== tempId));
            setNewMessage(messageText);
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

    /**
     * Normalize any Israeli phone format to the WhatsApp-native "972..." format.
     * Handles: 05x..., +97252..., 972-52-..., etc.
     * Returns digits-only. Non-Israeli numbers remain stripped of non-digits.
     */
    const normalizePhone = (input: string): string => {
        // Strip everything except digits
        const digits = input.replace(/[^0-9]/g, "");
        // Israeli local → international: 05xxxxxxxx → 9725xxxxxxxx
        if (digits.startsWith("0") && digits.length === 10) {
            return "972" + digits.substring(1);
        }
        return digits;
    };

    /**
     * Format a phone number for beautiful display in the UI.
     * - Israeli cells (972 + 9 digits):  052-699-1415
     * - Israeli landlines (972 + 8 digits): 02-123-4567
     * - Group JIDs (contain "-"):  show "קבוצה"
     * - Other international:  +CC XXXXXXXXX
     */
    const formatPhone = (phone: string) => {
        if (!phone) return "";

        // Groups have a hyphen in the JID (e.g. "120363404274395120-1234@g.us")
        if (phone.includes("-") || phone.includes("@")) return "קבוצה";

        // Strip any accidental non-digit characters (spaces, +, etc.)
        const digits = phone.replace(/\D/g, "");
        if (!digits) return phone;

        // WhatsApp group IDs stored without @g.us suffix (16-18 digits, starts with 120)
        if (digits.length >= 16 && digits.startsWith("120")) {
            return "קבוצה";
        }

        // WhatsApp LID / internal identifiers (13+ digits that aren't real phone numbers)
        // e.g. 240213326622964 — no real phone number is longer than 15 digits
        // but valid E.164 numbers top out at 15 digits; LIDs are often 15+ or have unusual patterns
        if (digits.length > 13 && !digits.startsWith("972")) {
            return `מזהה WA`;
        }

        // Israeli numbers starting with 972
        if (digits.startsWith("972")) {
            const local = digits.substring(3); // strip country code
            if (local.length === 9) {
                // Mobile: 05X-XXX-XXXX
                return `0${local.substring(0, 2)}-${local.substring(2, 5)}-${local.substring(5)}`;
            }
            if (local.length === 8) {
                // Landline: 0X-XXX-XXXX
                return `0${local.substring(0, 1)}-${local.substring(1, 4)}-${local.substring(4)}`;
            }
            // Fallback for unexpected Israeli lengths
            return `+972-${local}`;
        }

        // Israeli local format (stored without country code, starts with 05x)
        if (digits.startsWith("05") && digits.length === 10) {
            return `${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6)}`;
        }

        // Known Meta/WhatsApp system numbers — show as system
        if (/^1203631\d{4}$/.test(digits) || /^1650\d{7}$/.test(digits)) {
            return "מספר מערכת";
        }

        // US/Canada: 1 + 10 digits
        if (digits.startsWith("1") && digits.length === 11) {
            return `+1 (${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.substring(7)}`;
        }

        // Generic international: group into blocks of 3 for readability
        // e.g. 447911123456 → +44 791 112 3456
        if (digits.length >= 8) {
            const cc = digits.substring(0, digits.length - 9);
            const rest = digits.substring(cc.length);
            const grouped = rest.match(/.{1,3}/g)?.join(" ") || rest;
            return `+${cc} ${grouped}`;
        }

        return `+${digits}`;
    };

    const formatTime = (ts: string) =>
        new Date(ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

    const formatDate = (ts: string) => {
        const d = new Date(ts);
        const today = new Date();
        if (d.toDateString() === today.toDateString()) {
            // Today → show HH:MM like real WhatsApp
            return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
        }
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

    // ── Filtered conversations (Optimized) ──
    const filteredConversations = useMemo(() => {
        return conversations.filter(conv => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return conv.contact_name?.toLowerCase().includes(q) || conv.phone_number.includes(q);
        });
    }, [conversations, searchQuery]);

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

    // Skeleton Loader for initial state
    if (!tenant) {
        return (
            <div className="min-h-screen flex flex-col" style={{ background: "#080810" }}>
                {/* Header skeleton */}
                <div className="px-4 sm:px-6 py-3 border-b border-white/[0.06] bg-black/60 backdrop-blur-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="skeleton w-16 h-7 rounded-lg" />
                        <div className="w-px h-5 bg-white/10" />
                        <div className="skeleton w-40 h-6 rounded-lg" />
                        <div className="skeleton w-20 h-5 rounded-full" />
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="skeleton w-20 h-7 rounded-xl" />
                        <div className="skeleton w-28 h-7 rounded-xl" />
                    </div>
                </div>
                {/* Tab nav skeleton */}
                <div className="border-b border-white/[0.06] bg-black/30 px-6 flex gap-1 py-0">
                    {[80, 70, 65, 70, 55, 50, 65].map((w, i) => (
                        <div key={i} className="skeleton mx-1 my-3 rounded-md" style={{ width: w, height: 20 }} />
                    ))}
                </div>
                {/* Content skeleton */}
                <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3 text-neutral-600">
                        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                        <span className="text-sm">טוען נתוני עסק...</span>
                    </div>
                </div>
            </div>
        );
    }

    const modeConfig = {
        learning: { label: "בוט לא פעיל", emoji: "📚", badge: "bg-amber-500/15 text-amber-400 ring-amber-500/25" },
        active:   { label: "בוט פעיל",    emoji: "🤖", badge: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25" },
        paused:   { label: "מושהה",        emoji: "⏸️", badge: "bg-neutral-500/15 text-neutral-400 ring-neutral-500/25" },
    };

    return (
        <div className="h-screen text-neutral-200 font-sans selection:bg-emerald-500/30 flex flex-col overflow-hidden" style={{ background: "#080810" }}>
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Background */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-15%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-15" style={{ background: "radial-gradient(circle, #10b981 0%, transparent 70%)", filter: "blur(80px)" }} />
                <div className="absolute bottom-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-8" style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)", filter: "blur(100px)" }} />
            </div>

            {/* Top Bar */}
            <header className="relative z-10 px-4 sm:px-6 py-3 border-b border-white/[0.06] bg-black/60 backdrop-blur-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        className="shrink-0 p-2 text-neutral-500 hover:text-white hover:bg-white/8 rounded-lg transition-all flex items-center gap-1.5 text-sm"
                        onMouseEnter={() => router.prefetch("/dashboard")}
                        onClick={() => router.push("/dashboard")}
                    >
                        <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                        <span className="hidden sm:inline">חזרה</span>
                    </button>
                    <div className="w-px h-5 bg-white/10 hidden sm:block shrink-0" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-base font-bold text-white truncate">{tenant.business_name}</h1>
                            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ring-1 ring-inset font-medium ${modeConfig[tenant.agent_mode].badge}`}>
                                {modeConfig[tenant.agent_mode].emoji} {modeConfig[tenant.agent_mode].label}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto hide-scrollbar">
                    {/* WhatsApp status */}
                    <button
                        onClick={() => setActiveTab("connect")}
                        className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold ring-1 ring-inset transition-all ${tenant.whatsapp_connected
                            ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20 hover:bg-emerald-500/15'
                            : 'bg-red-500/10 text-red-400 ring-red-500/20 hover:bg-red-500/15'
                        }`}
                    >
                        <span className="relative flex h-2 w-2 shrink-0">
                            {tenant.whatsapp_connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${tenant.whatsapp_connected ? "bg-emerald-500" : "bg-red-500"}`} />
                        </span>
                        {tenant.whatsapp_connected ? 'מחובר' : 'מנותק'}
                    </button>

                    {/* Mode toggle */}
                    <div className="flex bg-white/5 rounded-xl p-1 border border-white/8 shrink-0">
                        {(["learning", "active"] as const).map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setAgentMode(mode)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${tenant.agent_mode === mode
                                    ? 'bg-emerald-600 text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)]'
                                    : 'text-neutral-500 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <span>{modeConfig[mode].emoji}</span>
                                <span className="hidden sm:inline">{modeConfig[mode].label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            {/* Tab Navigation */}
            <nav className="relative z-10 flex overflow-x-auto border-b border-white/[0.06] px-2 sm:px-6 hide-scrollbar bg-black/30">
                {[
                    { id: "chat",         icon: "💬", label: "שיחות" },
                    { id: "contacts",     icon: "👥", label: "אנשי קשר", action: fetchContactRules },
                    { id: "connect",      icon: "📱", label: "ווטסאפ" },
                    { id: "capabilities", icon: "🧠", label: "יכולות" },
                    { id: "leads",        icon: "🎯", label: "לידים" },
                    { id: "calendar",     icon: "📅", label: "יומן" },
                    { id: "settings",     icon: "⚙️", label: "הגדרות" }
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => { setActiveTab(tab.id as any); if (tab.action) tab.action(); }}
                        className={`relative flex items-center gap-2 px-4 py-3 whitespace-nowrap text-sm font-medium transition-all ${activeTab === tab.id
                            ? "text-white"
                            : "text-neutral-500 hover:text-neutral-300"
                        }`}
                    >
                        <span className="text-base leading-none">{tab.icon}</span>
                        <span>{tab.label}</span>
                        {activeTab === tab.id && (
                            <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                        )}
                    </button>
                ))}
            </nav>

            <div className="relative z-10 flex-1 flex flex-col h-0 overflow-hidden bg-black/40">
                {activeTab === "chat" && (
                    <ChatTab
                        tenant={tenant}
                        conversations={conversations}
                        filteredConversations={filteredConversations}
                        selectedConvId={selectedConvId}
                        messages={messages}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        selectConversation={selectConversation}
                        getDisplayName={getDisplayName}
                        getAvatarColor={getAvatarColor}
                        getInitials={getInitials}
                        formatPhone={formatPhone}
                        lastMessages={lastMessages}
                        formatDate={formatDate}
                        formatTime={formatTime}
                        contactRules={contactRules}
                        handleAddFromConversation={handleAddFromConversation}
                        isRTL={isRTL}
                        renderMedia={renderMedia}
                        shouldShowText={shouldShowText}
                        newMessage={newMessage}
                        setNewMessage={setNewMessage}
                        handleKeyDown={handleKeyDown}
                        handleSendMessage={handleSendMessage}
                        isSending={isSending}
                        onUpdateContactName={async (conversationId, newName) => {
                            try {
                                const res = await fetch(`/api/tenants/${tenant.id}/conversations/${conversationId}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ contact_name: newName }),
                                });
                                if (!res.ok) throw new Error("Failed to update name");
                                // Update local state immediately
                                setConversations((prev) =>
                                    prev.map((c) =>
                                        c.id === conversationId ? { ...c, contact_name: newName } : c
                                    )
                                );
                            } catch (err) {
                                console.error("Failed to update contact name:", err);
                                alert("שגיאה בעדכון שם איש הקשר");
                            }
                        }}
                        onTogglePause={handleTogglePause}
                    />
                )}

                {activeTab === "contacts" && (
                    <div className="p-6 overflow-y-auto w-full max-w-5xl mx-auto h-full">
                        <ContactsTab
                            tenant={tenant}
                            contactRules={contactRules}
                            newRulePhone={newRulePhone}
                            setNewRulePhone={setNewRulePhone}
                            newRuleName={newRuleName}
                            setNewRuleName={setNewRuleName}
                            newRuleType={newRuleType}
                            setNewRuleType={setNewRuleType}
                            setFilterMode={setFilterMode}
                            handleAddRule={handleAddRule}
                            handleDeleteRule={handleDeleteRule}
                            filterLabels={filterLabels}
                        />
                    </div>
                )}

                {activeTab === "connect" && (
                    <div className="p-6 overflow-y-auto w-full max-w-4xl mx-auto h-full">
                        <ConnectTab
                            tenant={tenant}
                            connectionStatus={connectionStatus}
                            qrCode={qrCode}
                            handleConnect={handleConnect}
                            handleReconnect={handleReconnect}
                            handleDisconnect={handleDisconnect}
                        />
                    </div>
                )}

                {activeTab === "capabilities" && (
                    <div className="p-6 overflow-y-auto w-full max-w-4xl mx-auto h-full">
                        <CapabilitiesTab tenant={tenant} />
                    </div>
                )}

                {activeTab === "leads" && (
                    <div className="flex-1 overflow-y-auto p-6">
                        <LeadsTab tenant={tenant} />
                    </div>
                )}

                {activeTab === "calendar" && (
                    <div className="flex-1 overflow-y-auto p-6">
                        <CalendarTab tenant={tenant} />
                    </div>
                )}

                {activeTab === "settings" && (
                    <div className="p-6 overflow-y-auto w-full max-w-4xl mx-auto h-full">
                        <SettingsTab
                            tenant={tenant}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            handleSaveSettings={handleSaveSettings}
                            saving={saving}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
