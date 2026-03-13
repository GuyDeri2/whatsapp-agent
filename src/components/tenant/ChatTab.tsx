import React, { useRef, useEffect, useState, useCallback } from "react";

// ── Pause countdown timer ──────────────────────────────────────────────
const FORTY_MIN_MS = 40 * 60 * 1000;

function PauseCountdown({ updatedAt }: { updatedAt: string }) {
    const getRemaining = useCallback(
        () => Math.max(0, FORTY_MIN_MS - (Date.now() - new Date(updatedAt).getTime())),
        [updatedAt]
    );
    const [remaining, setRemaining] = useState(getRemaining);

    useEffect(() => {
        setRemaining(getRemaining());
        const id = setInterval(() => setRemaining(getRemaining()), 1000);
        return () => clearInterval(id);
    }, [getRemaining]);

    if (remaining === 0)
        return <span className="text-xs opacity-60">(ממתין להודעה הבאה)</span>;

    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    return (
        <span className="text-xs opacity-60 tabular-nums">
            (מתחדש אוטומטית בעוד {m}:{String(s).padStart(2, "0")})
        </span>
    );
}

// Types
interface Tenant {
    id: string;
    agent_mode: "learning" | "active" | "paused";
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
    onUpdateContactName?: (conversationId: string, newName: string) => Promise<void>;
    onTogglePause?: (convId: string, currentPausedState: boolean) => Promise<void>;
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
    onUpdateContactName,
    onTogglePause,
}: ChatTabProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    // Auto-scroll when messages change or a conversation is selected
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, selectedConvId]);

    const handleEditName = async (conv: Conversation) => {
        const currentName = getDisplayName(conv);
        const newName = window.prompt("שם איש קשר:", currentName);
        if (newName && newName.trim() && newName.trim() !== currentName && onUpdateContactName) {
            await onUpdateContactName(conv.id, newName.trim());
        }
    };

    return (
        <div className="flex flex-1 h-full w-full overflow-hidden bg-black/40 relative z-10">
            {/* Photo Lightbox Overlay */}
            {lightboxUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
                    onClick={() => setLightboxUrl(null)}
                >
                    <button
                        className="absolute top-6 right-6 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                        onClick={() => setLightboxUrl(null)}
                    >
                        ✕
                    </button>
                    <img
                        src={lightboxUrl}
                        alt="Profile"
                        className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl ring-1 ring-white/10"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
            {/* ── Sidebar (Conversations) ── */}
            <aside className="w-full sm:w-[320px] lg:w-[350px] shrink-0 border-l border-white/10 flex flex-col bg-white/[0.02] backdrop-blur-md">
                <div className="p-4 border-b border-white/10">
                    <input
                        type="text"
                        placeholder="🔍 חפש שיחה..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-black/50 border border-white/10 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-white placeholder-neutral-500"
                    />
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {filteredConversations.length === 0 && (
                        <div className="p-8 text-center text-neutral-500 text-sm">
                            {searchQuery ? "לא נמצאו תוצאות" : "אין שיחות עדיין"}
                        </div>
                    )}
                    {filteredConversations.map((conv) => (
                        <button
                            key={conv.id}
                            className={`w-full flex items-center gap-3 p-3 transition-colors border-b border-white/5 hover:bg-white/5 active:bg-white/10 text-right ${selectedConvId === conv.id ? "bg-emerald-500/10 border-emerald-500/20" : ""
                                }`}
                            onClick={() => selectConversation(conv)}
                        >
                            <div className="relative shrink-0">
                                {conv.profile_picture_url ? (
                                    <img
                                        src={conv.profile_picture_url}
                                        alt={getDisplayName(conv)}
                                        className="w-12 h-12 rounded-full object-cover bg-neutral-800 ring-2 ring-transparent"
                                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(conv.profile_picture_url); }}
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = "none";
                                            (e.target as HTMLImageElement).nextElementSibling!.classList.remove("hidden");
                                            (e.target as HTMLImageElement).nextElementSibling!.classList.add("flex");
                                        }}
                                    />
                                ) : null}
                                <div
                                    className={`w-12 h-12 rounded-full items-center justify-center text-white font-medium text-lg shrink-0 overflow-hidden ${conv.profile_picture_url ? 'hidden' : 'flex'}`}
                                    style={{ background: getAvatarColor(getDisplayName(conv)) }}
                                >
                                    {getInitials(getDisplayName(conv), conv.is_group)}
                                </div>
                                {conv.is_paused && (
                                    <div className="absolute -bottom-1 -left-1 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center ring-2 ring-black" title="AI מושהה">
                                        <span className="text-[10px]">⏸</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 pr-1">
                                <div className="flex justify-between items-baseline mb-0.5">
                                    <span className={`font-semibold truncate text-[15px] ${selectedConvId === conv.id ? "text-emerald-400" : "text-neutral-200"}`}>
                                        {getDisplayName(conv)}
                                    </span>
                                    <span className="text-[11px] text-neutral-500 shrink-0 mr-2">
                                        {formatDate(conv.updated_at)}
                                    </span>
                                </div>
                                <div className="text-[13px] text-neutral-400 truncate">
                                    {lastMessages[conv.id] || <span className="italic opacity-50">...</span>}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </aside>

            {/* ── Main Chat Area ── */}
            <main className="flex-1 flex flex-col min-w-0 relative bg-[url('https://w0.peakpx.com/wallpaper/818/148/HD-wallpaper-whatsapp-background-solid-color-whatsapp-background-thumbnail.jpg')] bg-repeat bg-[length:400px_auto]">
                {/* Dark overlay for background pattern */}
                <div className="absolute inset-0 bg-black/85 z-0 pointer-events-none" />
                {!selectedConvId ? (
                    <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center p-8 bg-black/60 backdrop-blur-sm">
                        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 ring-1 ring-white/10">
                            <span className="text-4xl">💬</span>
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">שיחות לקוחות</h2>
                        <p className="text-neutral-400 max-w-sm">
                            בחר שיחה מהתפריט בצד ימין כדי לצפות בהיסטוריית ההודעות ולהשיב ללקוח.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col h-full w-full">
                        {/* Chat header with contact actions */}
                        {(() => {
                            const conv = conversations.find((c) => c.id === selectedConvId);
                            if (!conv) return null;
                            const existingRule = contactRules.find(
                                (r) => r.phone_number === conv.phone_number
                            );
                            return (
                                <>
                                <div className="relative z-10 flex items-center justify-between px-6 py-3 bg-neutral-900/90 backdrop-blur-md border-b border-white/10 shadow-sm shrink-0">
                                    <div className="flex items-center gap-3 min-w-0">
                                        {conv.profile_picture_url ? (
                                            <img
                                                src={conv.profile_picture_url}
                                                alt={getDisplayName(conv)}
                                                className="w-10 h-10 rounded-full object-cover cursor-pointer ring-1 ring-white/10"
                                                onClick={() => setLightboxUrl(conv.profile_picture_url)}
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = "none";
                                                    (e.target as HTMLImageElement).nextElementSibling!.classList.remove("hidden");
                                                    (e.target as HTMLImageElement).nextElementSibling!.classList.add("flex");
                                                }}
                                            />
                                        ) : null}
                                        <div
                                            className={`w-10 h-10 rounded-full items-center justify-center text-white font-medium text-sm shrink-0 ${conv.profile_picture_url ? 'hidden' : 'flex'}`}
                                            style={{ background: getAvatarColor(getDisplayName(conv)) }}
                                        >
                                            {getInitials(getDisplayName(conv), conv.is_group)}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <strong className="text-white truncate font-medium text-[15px]">
                                                    {getDisplayName(conv)}
                                                </strong>
                                                {onUpdateContactName && (
                                                    <button
                                                        className="text-neutral-500 hover:text-white transition-colors p-1"
                                                        onClick={() => handleEditName(conv)}
                                                        title="ערוך שם"
                                                    >
                                                        ✏️
                                                    </button>
                                                )}
                                            </div>
                                            <div className="text-xs text-neutral-400 truncate" dir="ltr">
                                                {formatPhone(conv.phone_number)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {onTogglePause && !conv.is_paused && (
                                            <button
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors bg-white/5 text-neutral-300 hover:bg-white/10 border border-white/5"
                                                onClick={() => onTogglePause(conv.id, false)}
                                                title="השהה AI עבור שיחה זו"
                                            >
                                                ⏸️ השהה AI
                                            </button>
                                        )}
                                        {existingRule ? (
                                            <span className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${existingRule.rule_type === "allow"
                                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                : "bg-red-500/10 text-red-400 border-red-500/20"
                                                }`}>
                                                {existingRule.rule_type === "allow" ? "✅ מאושר" : "🚫 חסום"}
                                            </span>
                                        ) : (
                                            <div className="flex gap-1">
                                                <button
                                                    className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/20 text-xs transition-colors"
                                                    onClick={() => handleAddFromConversation(conv, "allow")}
                                                    title="הוסף לרשימה הלבנה"
                                                >
                                                    ✅ אפשר
                                                </button>
                                                <button
                                                    className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded border border-red-500/20 text-xs transition-colors"
                                                    onClick={() => handleAddFromConversation(conv, "block")}
                                                    title="חסום"
                                                >
                                                    🚫 חסום
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {/* Pause Banner */}
                                {conv.is_paused && onTogglePause && (
                                    <div className="relative z-10 bg-orange-500/10 border-b border-orange-500/20 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
                                        <div className="flex items-center gap-2 text-sm text-orange-300 min-w-0">
                                            <span className="shrink-0">⏸️</span>
                                            <span className="font-medium">ה-AI מושהה — השיחה בטיפול ידני</span>
                                            <PauseCountdown updatedAt={conv.updated_at} />
                                        </div>
                                        <button
                                            className="shrink-0 px-3 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
                                            onClick={() => onTogglePause(conv.id, true)}
                                        >
                                            ▶️ הפעל AI
                                        </button>
                                    </div>
                                )}
                                </>
                            );
                        })()}

                        {/* Messages List */}
                        <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 custom-scrollbar">
                            {messages.map((msg, idx) => {
                                const isPrevSameSender = idx > 0 && messages[idx - 1].role === msg.role && messages[idx - 1].is_from_agent === msg.is_from_agent;
                                const isUserMessage = msg.role === "user";
                                const isBotMessage = msg.role === "assistant";
                                const isOwnerMessage = msg.role === "owner";

                                // Base bubble colors
                                let bubbleClass = "bg-neutral-800 text-neutral-100 rounded-bl-sm";
                                if (isBotMessage) bubbleClass = "bg-emerald-900/40 border border-emerald-500/20 text-neutral-100 rounded-br-sm";
                                if (isOwnerMessage) bubbleClass = "bg-emerald-900/40 border border-emerald-500/20 text-neutral-100 rounded-br-sm";

                                return (
                                    <div
                                        key={msg.id}
                                        className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${isUserMessage ? "self-start items-start" : "self-end items-end"
                                            } ${!isPrevSameSender ? "mt-4" : ""}`}
                                    >
                                        <div
                                            className={`relative px-4 py-2.5 rounded-2xl shadow-sm leading-relaxed text-[15px] max-w-full break-words ${bubbleClass}`}
                                            dir={isRTL(msg.content) ? "rtl" : "ltr"}
                                        >
                                            {/* Header Labels */}
                                            {(msg.sender_name || msg.is_from_agent || isOwnerMessage) && !isPrevSameSender && (
                                                <div className="flex items-center gap-2 mb-1">
                                                    {msg.is_from_agent && (
                                                        <span className="text-[10px] font-bold text-emerald-400 tracking-wide uppercase px-1.5 py-0.5 bg-emerald-500/10 rounded">
                                                            🤖 סוכן AI
                                                        </span>
                                                    )}
                                                    {isOwnerMessage && (
                                                        <span className="text-[10px] font-bold text-emerald-400 tracking-wide uppercase px-1.5 py-0.5 bg-emerald-500/10 rounded">
                                                            👤 בעלים
                                                        </span>
                                                    )}
                                                    {isUserMessage && msg.sender_name && conversations.find((c) => c.id === selectedConvId)?.is_group && (
                                                        <span className="text-xs font-semibold text-neutral-400">
                                                            ~ {msg.sender_name}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {/* Media Rendering */}
                                            {renderMedia(msg)}

                                            {/* Text Content */}
                                            {shouldShowText(msg) && (
                                                <div className="whitespace-pre-wrap">{msg.content}</div>
                                            )}

                                            {/* Footer metadata */}
                                            <div className="flex justify-end items-center gap-1.5 mt-1 -mb-1 opacity-70">
                                                <span className="text-[10px] text-neutral-400 tabular-nums">
                                                    {formatTime(msg.created_at)}
                                                </span>
                                                {!isUserMessage && msg.status && (
                                                    <span className="flex items-center">
                                                        {msg.status === "sent" && <svg viewBox="0 0 16 15" width="16" height="15" fill="var(--text-muted)"><path d="M10.91 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.032L1.892 7.72a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .011.524l3.12 2.753c.153.135.385.118.514-.037l6.241-8.02a.362.362 0 0 0-.056-.508z"></path></svg>}
                                                        {msg.status === "delivered" && <svg viewBox="0 0 16 15" width="16" height="15" fill="var(--text-muted)"><path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.358-.325a.32.32 0 0 0-.484.032l-.378.48a.418.418 0 0 0 .036.54l1.32 1.267c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.064-.51zM10.665 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.321 9.88a.32.32 0 0 1-.484.032L1.646 7.72a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .011.524l3.12 2.753c.153.135.385.118.514-.037l6.327-8.168a.362.362 0 0 0-.014-.513z"></path></svg>}
                                                        {msg.status === "read" && <svg viewBox="0 0 16 15" width="16" height="15" fill="#53bdeb"><path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.358-.325a.32.32 0 0 0-.484.032l-.378.48a.418.418 0 0 0 .036.54l1.32 1.267c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.064-.51zM10.665 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.321 9.88a.32.32 0 0 1-.484.032L1.646 7.72a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .011.524l3.12 2.753c.153.135.385.118.514-.037l6.327-8.168a.362.362 0 0 0-.014-.513z"></path></svg>}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Small WhatsApp tail pointing effect */}
                                            {!isPrevSameSender && (
                                                <div className={`absolute top-0 w-4 h-4 overflow-hidden ${isUserMessage ? '-right-2' : '-left-2'}`}>
                                                    <div className={`w-4 h-4 rotate-45 transform origin-top-left ${isUserMessage
                                                            ? "bg-neutral-800 translate-y-[-50%] translate-x-[-50%]"
                                                            : isBotMessage
                                                                ? "bg-emerald-900/40 border-[0.5px] border-emerald-500/20 translate-y-[-50%] translate-x-[50%]"
                                                                : "bg-emerald-900/40 border-[0.5px] border-emerald-500/20 translate-y-[-50%] translate-x-[50%]"
                                                        }`} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={bottomRef} className="h-2" />
                        </div>

                        {/* Input Area */}
                        <div className="relative z-10 bg-neutral-900/90 backdrop-blur-md border-t border-white/10 p-3 sm:p-4 shrink-0">
                            {tenant.agent_mode === "active" && (
                                <div className="absolute -top-10 left-0 right-0 flex justify-center pointer-events-none">
                                    <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs px-4 py-1.5 rounded-full backdrop-blur-md shadow-lg flex items-center gap-2">
                                        <span className="animate-pulse">⚠️</span>
                                        הסוכן פעיל. השהה את הסוכן כדי לענות ידנית.
                                    </div>
                                </div>
                            )}
                            <form onSubmit={handleSendMessage} className="flex items-end gap-2 max-w-4xl mx-auto">
                                <div className="flex-1 relative bg-black/40 border border-white/10 rounded-2xl focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/50 transition-all">
                                    <textarea
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder="הקלד הודעה..."
                                        disabled={isSending || tenant.agent_mode === "active"}
                                        rows={1}
                                        className="w-full bg-transparent text-neutral-200 placeholder-neutral-500 py-3.5 px-4 outline-none resize-none min-h-[52px] max-h-[150px] overflow-y-auto block custom-scrollbar"
                                        style={{
                                            height: newMessage.split("\n").length > 1 ? `${Math.min(newMessage.split("\n").length * 24 + 28, 150)}px` : '52px'
                                        }}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={!newMessage.trim() || isSending || tenant.agent_mode === "active"}
                                    className="w-12 h-12 shrink-0 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-full flex items-center justify-center transition-all disabled:cursor-not-allowed transform active:scale-95 disabled:active:scale-100 shadow-md"
                                >
                                    {isSending ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="-ml-1 rtl:ml-0 rtl:-mr-1"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
