import type { WASocket } from "@whiskeysockets/baileys";

/** Per-tenant session state */
export interface TenantSession {
    socket: WASocket;
    tenantId: string;
    phoneNumber: string | null;
    connectedAt: Date | null;
    retryCount: number;
    lastDisconnect: Date | null;
    reconnecting: boolean;
}

/** Health state tracked per session */
export interface SessionHealth {
    tenantId: string;
    riskScore: number; // 0-100
    lastProbeAt: Date | null;
    lastProbeOk: boolean;
    consecutiveFailures: number;
    disconnectHistory: { code: number; at: Date }[];
}

/** Rate limit state per conversation */
export interface ConversationRateLimit {
    /** Messages sent in the current minute window */
    minuteCount: number;
    minuteWindowStart: number;
    /** Messages sent in the current hour window */
    hourCount: number;
    hourWindowStart: number;
}

/** Rate limit state per tenant (global) */
export interface TenantRateLimit {
    hourCount: number;
    hourWindowStart: number;
    dayCount: number;
    dayWindowStart: number;
}

/** Warm-up phase limits */
export interface WarmupLimits {
    maxPerDay: number;
    minDelayMs: number;
}

/** Anti-ban configuration */
export interface AntiBanConfig {
    /** Minimum delay between any two outgoing messages (ms) */
    globalSendGapMs: number;
    /** Typing indicator duration range [min, max] ms */
    typingDurationMs: [number, number];
    /** Pre-typing "reading" delay range [min, max] ms */
    readingDelayMs: [number, number];
    /** Presence pause interval range [min, max] minutes */
    presencePauseIntervalMin: [number, number];
    /** Presence pause duration range [min, max] minutes */
    presencePauseDurationMin: [number, number];
    /** Warm-up schedule: day ranges -> limits */
    warmup: { daysMax: number; limits: WarmupLimits }[];
    /** Per-conversation limits */
    perConversation: { maxPerMinute: number; maxPerHour: number };
    /** Per-tenant global limits */
    perTenant: { maxPerHour: number; maxPerDay: number };
    /** Night mode hours (Israel time) */
    nightHours: { start: number; end: number; delayMultiplier: number };
}

/** Default anti-ban config */
export const DEFAULT_ANTIBAN_CONFIG: AntiBanConfig = {
    globalSendGapMs: 1200,
    typingDurationMs: [600, 1500],
    readingDelayMs: [1000, 3000],
    presencePauseIntervalMin: [60, 180],
    presencePauseDurationMin: [5, 20],
    warmup: [
        { daysMax: 3, limits: { maxPerDay: 20, minDelayMs: 10000 } },
        { daysMax: 7, limits: { maxPerDay: 50, minDelayMs: 5000 } },
        { daysMax: Infinity, limits: { maxPerDay: 1000, minDelayMs: 1200 } },
    ],
    perConversation: { maxPerMinute: 5, maxPerHour: 30 },
    perTenant: { maxPerHour: 200, maxPerDay: 1000 },
    nightHours: { start: 23, end: 7, delayMultiplier: 3 },
};
