"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Conversation {
  id: string;
  phone_number: string;
  updated_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Page component                                                      */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---- Fetch conversations ----
  const fetchConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  }, [supabase]);

  // ---- Fetch messages for a conversation ----
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

  // ---- Initial load + realtime ----
  useEffect(() => {
    fetchConversations();

    const channels: RealtimeChannel[] = [];

    // Realtime: conversations
    const convChannel = supabase
      .channel("conversations-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => {
          fetchConversations();
        }
      )
      .subscribe();
    channels.push(convChannel);

    // Realtime: messages
    const msgChannel = supabase
      .channel("messages-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.length === 0) return prev; // no conversation selected
            if (prev[0]?.conversation_id !== newMsg.conversation_id) return prev;
            if (prev.find((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          // Also refresh conversations to get updated timestamps
          fetchConversations();
        }
      )
      .subscribe();
    channels.push(msgChannel);

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [supabase, fetchConversations]);

  // ---- Scroll to bottom on new messages ----
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ---- Select conversation ----
  const selectConversation = (conv: Conversation) => {
    setSelectedId(conv.id);
    fetchMessages(conv.id);
    // On mobile, close sidebar
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  // ---- Log out ----
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  // ---- Format phone number ----
  const formatPhone = (phone: string) => {
    if (phone.length > 6) {
      return `+${phone.slice(0, 2)} ••• ${phone.slice(-4)}`;
    }
    return phone;
  };

  // ---- Format timestamp ----
  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (ts: string) => {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="dashboard">
      {/* ---- Sidebar ---- */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <h2>💬 Conversations</h2>
          <button className="toggle-btn mobile-only" onClick={() => setSidebarOpen(false)}>
            ✕
          </button>
        </div>

        <div className="conversation-list">
          {conversations.length === 0 && (
            <div className="empty-state">
              <p>No conversations yet</p>
              <span>Messages will appear here once customers send a WhatsApp message.</span>
            </div>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={`conversation-item ${selectedId === conv.id ? "active" : ""}`}
              onClick={() => selectConversation(conv)}
            >
              <div className="conv-avatar">👤</div>
              <div className="conv-info">
                <span className="conv-phone">{formatPhone(conv.phone_number)}</span>
                <span className="conv-time">{formatDate(conv.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="logout-btn" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* ---- Chat Area ---- */}
      <main className="chat-area">
        <div className="chat-header">
          <button className="toggle-btn mobile-only" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          {selectedId ? (
            <h3>
              {formatPhone(
                conversations.find((c) => c.id === selectedId)?.phone_number ?? ""
              )}
            </h3>
          ) : (
            <h3>WhatsApp Agent Dashboard</h3>
          )}
        </div>

        <div className="chat-messages">
          {!selectedId && (
            <div className="empty-chat">
              <div className="empty-chat-icon">🤖</div>
              <h2>QuickShip Support Agent</h2>
              <p>Select a conversation from the sidebar to view messages.</p>
            </div>
          )}

          {selectedId && messages.length === 0 && (
            <div className="empty-chat">
              <p>No messages in this conversation yet.</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`message-bubble ${msg.role}`}>
              <div className="bubble-content">
                <p>{msg.content}</p>
                <span className="bubble-time">{formatTime(msg.created_at)}</span>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </main>
    </div>
  );
}
