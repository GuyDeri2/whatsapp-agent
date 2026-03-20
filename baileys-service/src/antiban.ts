/**
 * Anti-ban protection module.
 *
 * Implements human-like behavior to minimize detection risk:
 * - Rate limiting (per-conversation, per-tenant, warm-up)
 * - Typing indicator simulation (short, ~1s)
 * - Random "reading" delay before typing
 * - Presence pause scheduling (go offline periodically)
 * - Night mode (slower responses 23:00-07:00 Israel time)
 * - Global send gap (minimum delay between any two messages)
 */

import type { WASocket } from "@whiskeysockets/baileys";
import {
    AntiBanConfig,
    ConversationRateLimit,
    TenantRateLimit,
    DEFAULT_ANTIBAN_CONFIG,
} from "./types";

// ── Random helpers ─────────────────────────────────────────────────

/** Gaussian random using Box-Muller transform (more natural than uniform) */
function gaussianRandom(mean: number, stddev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mean + z * stddev);
}

/** Random integer in [min, max] */
function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Get current Israel hour (0-23) */
function getIsraelHour(): number {
    return parseInt(
        new Date().toLocaleString("en-US", {
            timeZone: "Asia/Jerusalem",
            hour: "numeric",
            hour12: false,
        }),
        10
    );
}

function isNightTime(config: AntiBanConfig): boolean {
    const hour = getIsraelHour();
    const { start, end } = config.nightHours;
    if (start > end) {
        // Wraps around midnight: e.g., 23:00 - 07:00
        return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
}

// ── Rate limiter ───────────────────────────────────────────────────

export class RateLimiter {
    private config: AntiBanConfig;
    private conversationLimits = new Map<string, ConversationRateLimit>();
    private tenantLimits = new Map<string, TenantRateLimit>();

    constructor(config: AntiBanConfig = DEFAULT_ANTIBAN_CONFIG) {
        this.config = config;
    }

    /** Check if a message can be sent. Returns true if allowed. */
    canSend(tenantId: string, conversationId: string): boolean {
        const now = Date.now();

        // Per-conversation limits
        let conv = this.conversationLimits.get(conversationId);
        if (!conv) {
            conv = { minuteCount: 0, minuteWindowStart: now, hourCount: 0, hourWindowStart: now };
            this.conversationLimits.set(conversationId, conv);
        }

        // Reset windows
        if (now - conv.minuteWindowStart > 60_000) {
            conv.minuteCount = 0;
            conv.minuteWindowStart = now;
        }
        if (now - conv.hourWindowStart > 3_600_000) {
            conv.hourCount = 0;
            conv.hourWindowStart = now;
        }

        if (conv.minuteCount >= this.config.perConversation.maxPerMinute) return false;
        if (conv.hourCount >= this.config.perConversation.maxPerHour) return false;

        // Per-tenant global limits
        let tenant = this.tenantLimits.get(tenantId);
        if (!tenant) {
            tenant = { hourCount: 0, hourWindowStart: now, dayCount: 0, dayWindowStart: now };
            this.tenantLimits.set(tenantId, tenant);
        }

        if (now - tenant.hourWindowStart > 3_600_000) {
            tenant.hourCount = 0;
            tenant.hourWindowStart = now;
        }
        if (now - tenant.dayWindowStart > 86_400_000) {
            tenant.dayCount = 0;
            tenant.dayWindowStart = now;
        }

        if (tenant.hourCount >= this.config.perTenant.maxPerHour) return false;
        if (tenant.dayCount >= this.config.perTenant.maxPerDay) return false;

        return true;
    }

    /** Record that a message was sent */
    recordSend(tenantId: string, conversationId: string): void {
        const conv = this.conversationLimits.get(conversationId);
        if (conv) {
            conv.minuteCount++;
            conv.hourCount++;
        }

        const tenant = this.tenantLimits.get(tenantId);
        if (tenant) {
            tenant.hourCount++;
            tenant.dayCount++;
        }
    }

    /** Check warm-up limits for a tenant. Returns effective limits. */
    getWarmupLimits(connectionAgeDays: number): { maxPerDay: number; minDelayMs: number } {
        for (const tier of this.config.warmup) {
            if (connectionAgeDays <= tier.daysMax) {
                return tier.limits;
            }
        }
        return this.config.warmup[this.config.warmup.length - 1].limits;
    }

    /** Cleanup stale entries */
    cleanup(): void {
        const now = Date.now();
        for (const [key, val] of this.conversationLimits) {
            if (now - val.hourWindowStart > 7_200_000) {
                this.conversationLimits.delete(key);
            }
        }
    }
}

// ── Human-like send wrapper ────────────────────────────────────────

/** Global send queue — enforces minimum gap between messages across all tenants */
let lastGlobalSendAt = 0;

/**
 * Send a message with human-like behavior:
 * 1. Wait a random "reading" delay
 * 2. Send "composing" presence (typing indicator)
 * 3. Wait a short typing duration (~0.6-1.5s)
 * 4. Send the message
 * 5. Send "available" presence
 */
export async function humanSend(
    socket: WASocket,
    jid: string,
    text: string,
    config: AntiBanConfig = DEFAULT_ANTIBAN_CONFIG
): Promise<void> {
    // Global send gap
    const now = Date.now();
    const elapsed = now - lastGlobalSendAt;
    const gap = config.globalSendGapMs;
    if (elapsed < gap) {
        await sleep(gap - elapsed);
    }

    // Night mode multiplier
    const nightMult = isNightTime(config) ? config.nightHours.delayMultiplier : 1;

    // 1. "Reading" delay — simulate reading the incoming message
    const readingDelay = gaussianRandom(
        (config.readingDelayMs[0] + config.readingDelayMs[1]) / 2,
        (config.readingDelayMs[1] - config.readingDelayMs[0]) / 4
    ) * nightMult;
    await sleep(Math.min(readingDelay, 4000)); // cap at 4s

    // 2. Typing indicator (short — max 1.5s)
    try {
        await socket.presenceSubscribe(jid);
        await socket.sendPresenceUpdate("composing", jid);
    } catch {
        // Non-fatal
    }

    // 3. Typing duration — short and natural
    const typingDuration = randInt(config.typingDurationMs[0], config.typingDurationMs[1]);
    await sleep(typingDuration);

    // 4. Stop typing
    try {
        await socket.sendPresenceUpdate("paused", jid);
    } catch {
        // Non-fatal
    }

    // 5. Send the message
    await socket.sendMessage(jid, { text });
    lastGlobalSendAt = Date.now();
}

// ── Presence pause scheduler ───────────────────────────────────────

/**
 * Periodically goes "unavailable" for a random duration.
 * Simulates a human closing WhatsApp — prevents 24/7 online fingerprint.
 */
export class PresencePauseScheduler {
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private active = new Set<string>();
    private config: AntiBanConfig;

    constructor(config: AntiBanConfig = DEFAULT_ANTIBAN_CONFIG) {
        this.config = config;
    }

    /** Start scheduling presence pauses for a session */
    start(tenantId: string, socket: WASocket): void {
        this.stop(tenantId);
        this.active.add(tenantId);
        this.scheduleNext(tenantId, socket);
    }

    /** Stop presence pauses for a session */
    stop(tenantId: string): void {
        this.active.delete(tenantId);
        const timer = this.timers.get(tenantId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(tenantId);
        }
    }

    private scheduleNext(tenantId: string, socket: WASocket): void {
        if (!this.active.has(tenantId)) return;

        const [minMin, maxMin] = this.config.presencePauseIntervalMin;
        const intervalMs = randInt(minMin, maxMin) * 60_000;

        const timer = setTimeout(async () => {
            if (!this.active.has(tenantId)) return;

            try {
                await socket.sendPresenceUpdate("unavailable");

                const [minPause, maxPause] = this.config.presencePauseDurationMin;
                const pauseMs = randInt(minPause, maxPause) * 60_000;

                console.log(`[${tenantId}] Presence pause: offline for ${Math.round(pauseMs / 60000)}m`);

                const innerTimer = setTimeout(async () => {
                    if (!this.active.has(tenantId)) return;
                    try {
                        await socket.sendPresenceUpdate("available");
                    } catch {
                        // Session may have closed
                    }
                    this.scheduleNext(tenantId, socket);
                }, pauseMs);

                // Store inner timer so stop() can cancel it
                this.timers.set(tenantId, innerTimer);
            } catch {
                if (this.active.has(tenantId)) {
                    this.scheduleNext(tenantId, socket);
                }
            }
        }, intervalMs);

        this.timers.set(tenantId, timer);
    }
}

// ── Utility ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
}
