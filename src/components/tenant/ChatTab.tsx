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
    status?: "sent" | "delivered" | "read" | "failed";
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
                                        <div className="bubble-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '4px' }}>
                                            <span className="bubble-time">
                                                {formatTime(msg.created_at)}
                                            </span>
                                            {(msg.role === "owner" || msg.role === "assistant") && msg.status && (
                                                <span className="message-status-tick" style={{ display: 'flex', alignItems: 'center' }}>
                                                    {msg.status === "sent" && (
                                                        <svg viewBox="0 0 16 15" width="16" height="15" fill="var(--text-muted)">
                                                            <path d="M10.91 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.032L1.892 7.72a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .011.524l3.12 2.753c.153.135.385.118.514-.037l6.241-8.02a.362.362 0 0 0-.056-.508z"></path>
                                                        </svg>
                                                    )}
                                                    {msg.status === "delivered" && (
                                                        <svg viewBox="0 0 16 15" width="16" height="15" fill="var(--text-muted)">
                                                            <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.358-.325a.32.32 0 0 0-.484.032l-.378.48a.418.418 0 0 0 .036.54l1.32 1.267c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.064-.51zM10.665 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.321 9.88a.32.32 0 0 1-.484.032L1.646 7.72a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .011.524l3.12 2.753c.153.135.385.118.514-.037l6.327-8.168a.362.362 0 0 0-.014-.513z"></path>
                                                        </svg>
                                                    )}
                                                    {msg.status === "read" && (
                                                        <svg viewBox="0 0 16 15" width="16" height="15" fill="#53bdeb">
                                                            <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.358-.325a.32.32 0 0 0-.484.032l-.378.48a.418.418 0 0 0 .036.54l1.32 1.267c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.064-.51zM10.665 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.321 9.88a.32.32 0 0 1-.484.032L1.646 7.72a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .011.524l3.12 2.753c.153.135.385.118.514-.037l6.327-8.168a.362.362 0 0 0-.014-.513z"></path>
                                                        </svg>
                                                    )}
                                                </span>
                                            )}
                                        </div>
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
