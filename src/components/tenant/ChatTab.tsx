import React, { useRef, useEffect } from "react";

// Types
interface Tenant {
    id: string;
    agent_mode: "learning" | "active";
}

interface Conversation {
    id: string;
    phone_number: string;
    contact_name: string | null;
    is_group: boolean;
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
    phone_number: string;
    rule_type: "allow" | "block";
}

interface ChatTabProps {
    tenant: Tenant;
    conversations: Conversation[];
    filteredConversations: Conversation[];
    selectedConvId: string | null;
    messages: Message[];
    searchQuery: string;
    setSearchQuery: (val: string) => void;
    selectConversation: (conv: Conversation) => void;
    getDisplayName: (conv: Conversation) => string;
    getAvatarColor: (name: string) => string;
    getInitials: (name: string, isGroup: boolean) => string;
    formatPhone: (phone: string) => string;
    lastMessages: Record<string, string>;
    formatDate: (ts: string) => string;
    formatTime: (ts: string) => string;
    contactRules: ContactRule[];
    handleAddFromConversation: (
        conv: Conversation,
        ruleType: "allow" | "block"
    ) => Promise<void>;
    isRTL: (text: string) => boolean;
    renderMedia: (msg: Message) => React.ReactNode;
    shouldShowText: (msg: Message) => boolean;
    newMessage: string;
    setNewMessage: (val: string) => void;
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    handleSendMessage: (e?: React.FormEvent) => Promise<void>;
    isSending: boolean;
}

export function ChatTab({
    tenant,
    conversations,
    filteredConversations,
    selectedConvId,
    messages,
    searchQuery,
    setSearchQuery,
    selectConversation,
    getDisplayName,
    getAvatarColor,
    getInitials,
    formatPhone,
    lastMessages,
    formatDate,
    formatTime,
    contactRules,
    handleAddFromConversation,
    isRTL,
    renderMedia,
    shouldShowText,
    newMessage,
    setNewMessage,
    handleKeyDown,
    handleSendMessage,
    isSending,
}: ChatTabProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll when messages change or a conversation is selected
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, selectedConvId]);

    return (
        <div className="chat-layout">
            {/* ── Sidebar (Conversations) ── */}
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
                        className={`conv-item ${selectedConvId === conv.id ? "active" : ""
                            }`}
                        onClick={() => selectConversation(conv)}
                    >
                        {conv.profile_picture_url ? (
                            <img
                                src={conv.profile_picture_url}
                                alt={getDisplayName(conv)}
                                className="conv-avatar conv-avatar-img"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                    (e.target as HTMLImageElement)
                                        .nextElementSibling!.removeAttribute("style");
                                }}
                            />
                        ) : null}
                        <div
                            className="conv-avatar conv-avatar-initials"
                            style={{
                                background: getAvatarColor(getDisplayName(conv)),
                                display: conv.profile_picture_url ? "none" : "flex",
                            }}
                        >
                            {getInitials(getDisplayName(conv), conv.is_group)}
                        </div>
                        <div className="conv-info">
                            <span className="conv-name">{getDisplayName(conv)}</span>
                            {!conv.is_group && conv.contact_name && (
                                <span className="conv-phone-sub">
                                    {formatPhone(conv.phone_number)}
                                </span>
                            )}
                            {lastMessages[conv.id] && (
                                <span className="conv-preview">{lastMessages[conv.id]}</span>
                            )}
                            <span className="conv-time">{formatDate(conv.updated_at)}</span>
                        </div>
                    </button>
                ))}
            </aside>

            {/* ── Main Chat Area ── */}
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
                            const conv = conversations.find((c) => c.id === selectedConvId);
                            if (!conv) return null;
                            const existingRule = contactRules.find(
                                (r) => r.phone_number === conv.phone_number
                            );
                            return (
                                <div className="chat-header-bar">
                                    <div className="chat-header-info">
                                        {conv.profile_picture_url ? (
                                            <img
                                                src={conv.profile_picture_url}
                                                alt={getDisplayName(conv)}
                                                className="chat-header-avatar chat-header-avatar-img"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = "none";
                                                    (e.target as HTMLImageElement)
                                                        .nextElementSibling!.removeAttribute("style");
                                                }}
                                            />
                                        ) : null}
                                        <span
                                            className="chat-header-avatar"
                                            style={{
                                                background: getAvatarColor(getDisplayName(conv)),
                                                display: conv.profile_picture_url
                                                    ? "none"
                                                    : "inline-flex",
                                            }}
                                        >
                                            {getInitials(getDisplayName(conv), conv.is_group)}
                                        </span>
                                        <div>
                                            <strong>{getDisplayName(conv)}</strong>
                                            <span className="chat-header-phone">
                                                {conv.phone_number}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="chat-header-actions">
                                        {existingRule ? (
                                            <span
                                                className={`rule-badge rule-${existingRule.rule_type}`}
                                            >
                                                {existingRule.rule_type === "allow"
                                                    ? "✅ ברשימה לבנה"
                                                    : "🚫 חסום"}
                                            </span>
                                        ) : (
                                            <>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => handleAddFromConversation(conv, "allow")}
                                                    title="הוסף לרשימה לבנה"
                                                >
                                                    ✅ אפשר
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => handleAddFromConversation(conv, "block")}
                                                    title="חסום"
                                                >
                                                    🚫 חסום
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Messages List */}
                        <div className="messages-list">
                            {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`message-bubble ${msg.role} ${msg.is_from_agent ? "from-agent" : ""
                                        }`}
                                >
                                    <div
                                        className="bubble-content"
                                        dir={isRTL(msg.content) ? "rtl" : "ltr"}
                                    >
                                        {msg.is_from_agent && (
                                            <span className="agent-badge">🤖 AI</span>
                                        )}
                                        {msg.role === "owner" && (
                                            <span className="owner-badge">👤 בעלים</span>
                                        )}
                                        {msg.role === "user" && conversations.find((c) => c.id === selectedConvId)?.is_group && (
                                            <span className="sender-name-badge">
                                                {msg.sender_name || "משתתף בקבוצה"}
                                            </span>
                                        )}
                                        {renderMedia(msg)}
                                        {shouldShowText(msg) && <p>{msg.content}</p>}
                                        <span className="bubble-time">
                                            {formatTime(msg.created_at)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            <div ref={bottomRef} />
                        </div>

                        {/* Input Area */}
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
                                    disabled={
                                        !newMessage.trim() ||
                                        isSending ||
                                        tenant.agent_mode === "active"
                                    }
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
    );
}
