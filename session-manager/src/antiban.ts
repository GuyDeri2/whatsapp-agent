/**
 * Anti-ban protection for WhatsApp sessions.
 *
 * Provides:
 *  1. Health monitoring — tracks disconnects, failed messages, risk scoring
 *  2. Gaussian jitter — human-like delay distribution (not uniform random)
 *  3. Periodic presence pause — simulates "closing the app" for short periods
 *  4. Owner alerts — notifies tenant owner when risk level changes
 *
 * Designed for a response-only bot (no bulk sending).
 */

// ─── Gaussian Jitter ──────────────────────────────────────────────────

/**
 * Box-Muller transform: generates a normally distributed random number.
 * Mean = (min+max)/2, 99.7% of values fall within [min, max].
 */
export function gaussianRandom(min: number, max: number): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random(); // avoid log(0)
    while (v === 0) v = Math.random();
    // Standard normal (mean=0, std=1)
    const stdNormal = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    // Scale to [min, max] — treat (max-min)/6 as 3σ so 99.7% falls in range
    const mean = (min + max) / 2;
    const std = (max - min) / 6;
    const result = mean + stdNormal * std;
    // Clamp to [min, max] for the rare outliers
    return Math.max(min, Math.min(max, result));
}

/**
 * Returns a human-like debounce delay in milliseconds.
 * Uses gaussian distribution centered around 3 seconds.
 * During night hours (23:00-07:00 Israel time), delays are 3x longer.
 */
export function getHumanDebounceDelay(): number {
    const israelHour = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Jerusalem",
        hour: "numeric",
        hour12: false,
    });
    const hour = parseInt(israelHour, 10);
    const isNight = hour >= 23 || hour < 7;

    // Base: gaussian centered around 3s, range 1.5s-4.5s
    const base = gaussianRandom(1_500, 4_500);
    return isNight ? base * 3 : base;
}

// ─── Health Monitor ───────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

interface HealthState {
    score: number;            // 0-100
    risk: RiskLevel;
    disconnects: number;      // rolling window (last 1 hour)
    disconnectTimestamps: number[];
    failedMessages: number;   // rolling window (last 1 hour)
    failedTimestamps: number[];
    lastRiskChange: RiskLevel;
}

const WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window

// Score contributions
const SCORE_DISCONNECT = 15;
const SCORE_403_FORBIDDEN = 40;
const SCORE_401_LOGGED_OUT = 60;
const SCORE_FAILED_MESSAGE = 20;

// Score decay: subtract this much per minute when idle
const SCORE_DECAY_PER_MIN = 2;

// Risk thresholds
function scoreToRisk(score: number): RiskLevel {
    if (score >= 85) return "critical";
    if (score >= 60) return "high";
    if (score >= 30) return "medium";
    return "low";
}

// Per-tenant health state
const healthStates = new Map<string, HealthState>();

// Decay interval — runs every minute to gradually reduce scores
let _decayInterval: NodeJS.Timeout | null = null;

function ensureDecayRunning(): void {
    if (_decayInterval) return;
    _decayInterval = setInterval(() => {
        const now = Date.now();
        for (const [tenantId, state] of healthStates) {
            // Prune old timestamps outside window
            state.disconnectTimestamps = state.disconnectTimestamps.filter(t => now - t < WINDOW_MS);
            state.failedTimestamps = state.failedTimestamps.filter(t => now - t < WINDOW_MS);
            state.disconnects = state.disconnectTimestamps.length;
            state.failedMessages = state.failedTimestamps.length;

            // Decay score
            if (state.score > 0) {
                state.score = Math.max(0, state.score - SCORE_DECAY_PER_MIN);
                const newRisk = scoreToRisk(state.score);
                if (newRisk !== state.risk) {
                    const oldRisk = state.risk;
                    state.risk = newRisk;
                    // Only alert on escalation, not de-escalation
                    if (riskOrdinal(newRisk) > riskOrdinal(oldRisk)) {
                        state.lastRiskChange = newRisk;
                    }
                }
            }
        }
    }, 60_000);
}

function riskOrdinal(risk: RiskLevel): number {
    switch (risk) {
        case "low": return 0;
        case "medium": return 1;
        case "high": return 2;
        case "critical": return 3;
    }
}

function getOrCreateHealth(tenantId: string): HealthState {
    let state = healthStates.get(tenantId);
    if (!state) {
        state = {
            score: 0,
            risk: "low",
            disconnects: 0,
            disconnectTimestamps: [],
            failedMessages: 0,
            failedTimestamps: [],
            lastRiskChange: "low",
        };
        healthStates.set(tenantId, state);
    }
    ensureDecayRunning();
    return state;
}

function addScore(state: HealthState, points: number): void {
    state.score = Math.min(100, state.score + points);
    state.risk = scoreToRisk(state.score);
}

/**
 * Call when a WhatsApp connection closes.
 * Returns the new risk level so the caller can decide whether to alert.
 */
export function onDisconnect(tenantId: string, statusCode?: number): { risk: RiskLevel; score: number; shouldAlert: boolean } {
    const state = getOrCreateHealth(tenantId);
    state.disconnectTimestamps.push(Date.now());
    state.disconnects = state.disconnectTimestamps.length;

    const prevRisk = state.risk;

    if (statusCode === 403) {
        addScore(state, SCORE_403_FORBIDDEN);
    } else if (statusCode === 401) {
        addScore(state, SCORE_401_LOGGED_OUT);
    } else {
        addScore(state, SCORE_DISCONNECT);
    }

    const shouldAlert = riskOrdinal(state.risk) > riskOrdinal(prevRisk) && state.risk !== "low";
    if (shouldAlert) state.lastRiskChange = state.risk;

    return { risk: state.risk, score: state.score, shouldAlert };
}

/**
 * Call when a message send fails.
 */
export function onMessageFailed(tenantId: string): { risk: RiskLevel; score: number; shouldAlert: boolean } {
    const state = getOrCreateHealth(tenantId);
    state.failedTimestamps.push(Date.now());
    state.failedMessages = state.failedTimestamps.length;

    const prevRisk = state.risk;
    addScore(state, SCORE_FAILED_MESSAGE);

    const shouldAlert = riskOrdinal(state.risk) > riskOrdinal(prevRisk) && state.risk !== "low";
    if (shouldAlert) state.lastRiskChange = state.risk;

    return { risk: state.risk, score: state.score, shouldAlert };
}

/**
 * Call on successful reconnect — doesn't reset score but stabilizes.
 */
export function onReconnect(tenantId: string): void {
    getOrCreateHealth(tenantId); // just ensure exists
}

/**
 * Get current health status for a tenant.
 */
export function getHealthStatus(tenantId: string): { risk: RiskLevel; score: number; disconnects: number; failedMessages: number } {
    const state = getOrCreateHealth(tenantId);
    return {
        risk: state.risk,
        score: state.score,
        disconnects: state.disconnects,
        failedMessages: state.failedMessages,
    };
}

// ─── Presence Pause (Offline Simulation) ──────────────────────────────

/**
 * Schedules periodic "offline" windows where presence updates are suppressed.
 * Returns a cleanup function to stop the scheduler.
 *
 * How it works:
 *  - Every 1-3 hours (gaussian random), sets the session to "unavailable"
 *  - Stays offline for 5-20 minutes (gaussian random)
 *  - Then goes back "available"
 *
 * This simulates a human closing the app briefly — much more natural than
 * being permanently online.
 */
export function startPresencePauseScheduler(
    tenantId: string,
    sendPresence: (type: "available" | "unavailable") => Promise<void>,
): () => void {
    let timeout: NodeJS.Timeout | null = null;
    let stopped = false;

    const scheduleNext = () => {
        if (stopped) return;

        // Next pause in 1-3 hours (gaussian centered at 2h)
        const delayMs = gaussianRandom(60 * 60_000, 3 * 60 * 60_000);

        timeout = setTimeout(async () => {
            if (stopped) return;
            try {
                // Go offline
                await sendPresence("unavailable");
                console.log(`[${tenantId}] 😴 Presence pause started (simulating app close)`);

                // Stay offline for 5-20 minutes
                const pauseMs = gaussianRandom(5 * 60_000, 20 * 60_000);
                timeout = setTimeout(async () => {
                    if (stopped) return;
                    try {
                        await sendPresence("available");
                        console.log(`[${tenantId}] 👋 Presence pause ended (back online)`);
                    } catch { /* non-fatal */ }
                    scheduleNext();
                }, pauseMs);
            } catch { /* non-fatal */ }
        }, delayMs);
    };

    scheduleNext();

    return () => {
        stopped = true;
        if (timeout) clearTimeout(timeout);
    };
}

// ─── Risk Alert Message ───────────────────────────────────────────────

const RISK_MESSAGES: Record<RiskLevel, string> = {
    low: "",
    medium: "⚠️ WhatsApp risk level: MEDIUM\nמספר ניתוקים חריג זוהה. המערכת ממשיכה לפעול אבל כדאי לשים לב.",
    high: "🟠 WhatsApp risk level: HIGH\nסיכון גבוה לחסימת המספר. מומלץ להפחית פעילות או לבדוק את המספר.",
    critical: "🔴 WhatsApp risk level: CRITICAL\nסיכון קריטי לחסימה! מומלץ לעצור את הבוט זמנית ולבדוק את המצב.",
};

/**
 * Returns a Hebrew alert message for the given risk level, or null for "low".
 */
export function getRiskAlertMessage(risk: RiskLevel): string | null {
    return risk === "low" ? null : RISK_MESSAGES[risk];
}
