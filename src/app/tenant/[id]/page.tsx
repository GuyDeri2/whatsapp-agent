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
    const [activeTab, setActiveTab] = useState<"chat" | "settings" | "connect" | "contacts" | "capabilities">("chat");
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<string>("unknown");
    const [saving, setSaving] = useState(false);
    const [editForm, setEditForm] = useState({
        business_name: "",
        description: "",
        products: "",
        target_customers: "",
        agent_respond_to_saved_contacts: true,
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
                agent_respond_to_saved_contacts: data.agent_respond_to_saved_contacts ?? true,
                owner_phone: data.owner_phone || "",
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

            const lastMsgMap: Record<string, string> = {};
            // Only fetch previews for the top 30 to save DB bottleneck
            for (const conv of data.slice(0, 30)) {
                try {
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
                } catch (e) { /* ignore single fails */ }
            }
            // Safely merge so we don't wipe out older previews
            setLastMessages(prev => ({ ...prev, ...lastMsgMap }));
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
        fetchTenant();
        fetchConversations();
        fetchContactRules();

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

                        // 1. Optimistically append message to active chat view
                        if (newMsg.conversation_id === selectedConvIdRef.current) {
                            setMessages((prev) => {
                                if (prev.find((m) => m.id === newMsg.id)) return prev;
                                return [...prev, newMsg];
                            });
                        }

                        // 2. Optimistically update Sidebar Preview instantly
                        setLastMessages(prev => {
                            let textPreview = newMsg.content?.substring(0, 50) || "";
                            if (newMsg.media_type && (newMsg.content === `[${newMsg.media_type} received]` || !newMsg.content)) {
                                const labels: Record<string, string> = { image: "📷 תמונה", video: "🎥 סרטון", audio: "🎙️ הודעה קולית", document: "📄 מסמך", sticker: "🎨 סטיקר" };
                                textPreview = labels[newMsg.media_type] || "📎 קובץ";
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

        // ── Refresh when tab regains focus ──
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                fetchConversations();
                if (selectedConvIdRef.current) {
                    fetchMessagesRef.current(selectedConvIdRef.current);
                }
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        // ── Periodic polling fallback (every 30s) ──
        const pollingInterval = setInterval(() => {
            fetchConversations();
            if (selectedConvIdRef.current) {
                fetchMessagesRef.current(selectedConvIdRef.current);
            }
        }, 30000);

        return () => {
            channels.forEach((ch) => supabase.removeChannel(ch));
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearInterval(pollingInterval);
        };
    }, [supabase, tenantId, fetchTenant, fetchConversations, fetchContactRules]);

    // ── Agent mode toggle ──
    const setAgentMode = async (mode: "learning" | "active" | "paused") => {
        try {
            await fetch(`/api/tenants/${tenantId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent_mode: mode }),
            });
            await fetchTenant();
        } catch {
            showToast("שגיאה בשינוי מצב הסוכן", "error");
        }
    };

    // ── Agent filter mode toggle ──
    const setFilterMode = async (mode: "all" | "whitelist" | "blacklist") => {
        try {
            await fetch(`/api/tenants/${tenantId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent_filter_mode: mode }),
            });
            await fetchTenant();
            showToast(`מצב סינון שונה ל: ${filterLabels[mode]}`, "success");
        } catch {
            showToast("שגיאה בשינוי מצב הסינון", "error");
        }
    };

    // ── Add contact rule ──
    const handleAddRule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newRulePhone.trim()) return;

        const res = await fetch(`/api/tenants/${tenantId}/contacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone_number: normalizePhone(newRulePhone),
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
        await fetchTenant();
        setSaving(false);
        if (res.ok) showToast("ההגדרות נשמרו בהצלחה", "success");
        else showToast("שגיאה בשמירת ההגדרות", "error");
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

            const interval = setInterval(async () => {
                try {
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
                } catch {
                    // ignore polling errors
                }
            }, 3000);

            setTimeout(() => clearInterval(interval), 120000);
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
        setMessages([]); // Clear stale messages immediately before fetching
        fetchMessages(conv.id);
        fetchConversations(); // Refresh sidebar to show latest previews
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
            <div className="tenant-page">
                <header className="tenant-header" style={{ opacity: 0.6 }}>
                    <div style={{ width: 60, height: 24, background: 'var(--bg-card)', borderRadius: 4 }} />
                    <div className="tenant-title" style={{ gap: 16 }}>
                        <div style={{ width: 200, height: 28, background: 'var(--bg-glass)', borderRadius: 8 }} />
                        <div style={{ width: 80, height: 24, background: 'var(--bg-glass)', borderRadius: 12 }} />
                    </div>
                </header>
                <nav className="tab-nav" style={{ opacity: 0.6 }}>
                    <div style={{ width: 100, height: 40, background: 'var(--bg-glass)', margin: '0 12px' }} />
                    <div style={{ width: 140, height: 40, background: 'var(--bg-glass)', margin: '0 12px' }} />
                    <div style={{ width: 120, height: 40, background: 'var(--bg-glass)', margin: '0 12px' }} />
                </nav>
                <div className="tab-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="loading-state">
                        <div className="spinner" />
                        <p style={{ marginTop: 16 }}>טוען נתוני עסק...</p>
                    </div>
                </div>
            </div>
        );
    }

    const modeConfig = {
        learning: { label: "למידה", emoji: "📚", color: "#f59e0b" },
        active: { label: "פעיל", emoji: "🤖", color: "#10b981" },
        paused: { label: "מושהה", emoji: "⏸️", color: "#6b7280" },
    };

    return (
        <div className="min-h-screen bg-black text-neutral-200 font-sans selection:bg-emerald-500/30 flex flex-col">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Background Gradients */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] right-[-5%] w-[400px] h-[400px] rounded-full bg-emerald-600/10 blur-[100px]" />
                <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-emerald-600/10 blur-[120px]" />
            </div>

            {/* Top Bar */}
            <header className="relative z-10 px-6 py-4 border-b border-white/10 bg-black/50 backdrop-blur-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-4">
                    <button
                        className="p-2 text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2"
                        onClick={() => router.push("/dashboard")}
                    >
                        <svg className="w-5 h-5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        <span className="hidden sm:inline">חזרה לדשבורד</span>
                    </button>
                    <div className="h-6 w-px bg-white/10 hidden sm:block"></div>
                    <div>
                        <h1 className="text-xl font-bold text-white flex items-center gap-2">
                            {tenant.business_name}
                            <span className={`text-xs px-2 py-0.5 rounded-full ring-1 ring-inset ${modeConfig[tenant.agent_mode].color.replace('ring-amber-500/30', 'ring-amber-500/20').replace('ring-emerald-500/30', 'ring-emerald-500/20')}`}>
                                {modeConfig[tenant.agent_mode].emoji} {modeConfig[tenant.agent_mode].label}
                            </span>
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
                    <button
                        onClick={() => setActiveTab("connect")}
                        className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 ring-inset transition-colors ${tenant.whatsapp_connected
                                ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20 hover:bg-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 ring-red-500/20 hover:bg-red-500/20'
                            }`}
                    >
                        <div className="relative flex h-2 w-2">
                            {tenant.whatsapp_connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${tenant.whatsapp_connected ? "bg-emerald-500" : "bg-red-500"}`}></span>
                        </div>
                        {tenant.whatsapp_connected ? 'ווטסאפ מחובר' : 'ווטסאפ מנותק'}
                    </button>

                    <div className="flex bg-white/5 rounded-lg p-1 border border-white/10 shrink-0">
                        {(["learning", "active"] as const).map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setAgentMode(mode)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${tenant.agent_mode === mode
                                        ? 'bg-emerald-600 text-white shadow-md'
                                        : 'text-neutral-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <span>{modeConfig[mode].emoji}</span>
                                <span>{modeConfig[mode].label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            {/* Tab Navigation */}
            <nav className="relative z-10 flex overflow-x-auto border-b border-white/5 px-6 hide-scrollbar gap-2 py-2">
                {[
                    { id: "chat", icon: "💬", label: "שיחות" },
                    { id: "contacts", icon: "👥", label: "סינון אנשי קשר", action: fetchContactRules },
                    { id: "connect", icon: "📱", label: "חיבור ווטסאפ" },
                    { id: "capabilities", icon: "🧠", label: "יכולות סוכן" },
                    { id: "settings", icon: "⚙️", label: "הגדרות" }
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => {
                            setActiveTab(tab.id as any);
                            if (tab.action) tab.action();
                        }}
                        className={`flex items-center gap-2 px-4 py-2.5 whitespace-nowrap text-sm font-medium transition-colors rounded-t-lg relative ${activeTab === tab.id
                                ? "text-emerald-400"
                                : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5"
                            }`}
                    >
                        <span>{tab.icon}</span>
                        {tab.label}
                        {activeTab === tab.id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 shadow-[0_-2px_8px_rgba(99,102,241,0.5)]" />
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
