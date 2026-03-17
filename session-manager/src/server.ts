/**
 * Express API server for the WhatsApp Session Manager.
 * Exposes REST endpoints for managing tenant WhatsApp sessions
 * and serves QR codes via Server-Sent Events (SSE).
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import {
    startSession,
    createSession,
    stopSession,
    getSessionInfo,
    getActiveSessions,
    restoreAllSessions,
    setQRUpdateCallback,
    removeQRUpdateCallback,
    sendMessage,
    reconnectSession,
    checkWhatsAppNumber,
    normalizePhone,
    isReconnecting,
    probeSessionHealth,
    setShuttingDown,
} from "./session-manager";
import { invalidateTenantConfigCache } from "./message-handler";
import { getHealthStatus } from "./antiban";
import { runBatchLearning } from "./learning-engine";
import { sendDayBeforeReminders, sendTwoHourReminders } from "./reminders";
import { saveCredsBackup, flushCacheToDB } from "./session-store";

const app = express();
// Default port for the session manager (dashboard runs on 3000)
const PORT = parseInt(process.env.PORT || "3001", 10);
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://whatsapp-agent-sm.onrender.com

// ─── Middleware ────────────────────────────────────────────────────────
app.use(
    cors({
        origin: "*",  // Auth token protects the API; allow any origin
        credentials: true,
    })
);
app.use(express.json());

// Simple API key auth
function authMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    const secret = process.env.SESSION_MANAGER_SECRET;
    if (!secret) {
        console.error("❌ SESSION_MANAGER_SECRET is not configured. Blocking /sessions access.");
        res.status(500).json({ error: "SESSION_MANAGER_SECRET is not configured on the server" });
        return;
    }
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${secret}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
}

app.use("/sessions", authMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────

/** Health check */
app.get("/health", (_req, res) => {
    res.json({ status: "ok", activeSessions: getActiveSessions().length });
});

/** List all active sessions */
app.get("/sessions", (_req, res) => {
    const sessionIds = getActiveSessions();
    const sessions = sessionIds.map((id) => ({
        tenantId: id,
        ...getSessionInfo(id),
    }));
    res.json({ sessions });
});

/** Start a session for a tenant */
app.post("/sessions/:tenantId/start", async (req, res) => {
    const { tenantId } = req.params;
    try {
        await startSession(tenantId);
        // Wait a moment for QR to generate
        await new Promise((r) => setTimeout(r, 2000));
        const info = getSessionInfo(tenantId);
        res.json({ success: true, ...info });
    } catch (error: any) {
        console.error(`Error starting session for ${tenantId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

/** Get session status and QR code */
app.get("/sessions/:tenantId/status", (req, res) => {
    const { tenantId } = req.params;
    const info = getSessionInfo(tenantId);
    res.json(info);
});

/** Anti-ban health status for a tenant */
app.get("/sessions/:tenantId/health", (req, res) => {
    const { tenantId } = req.params;
    res.json(getHealthStatus(tenantId));
});

/** Send a message */
app.post("/sessions/:tenantId/messages", async (req, res) => {
    const { tenantId } = req.params;
    const { jid, text } = req.body;

    if (!jid || !text) {
        res.status(400).json({ error: "Missing jid or text" });
        return;
    }

    try {
        const messageId = await sendMessage(tenantId, jid, text);
        res.json({ success: true, messageId });
    } catch (error: any) {
        console.error(`Error sending message for ${tenantId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

/** SSE endpoint for real-time QR code updates */
app.get("/sessions/:tenantId/qr", (req, res) => {
    const { tenantId } = req.params;

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // Send current state immediately
    const info = getSessionInfo(tenantId);
    res.write(`data: ${JSON.stringify(info)}\n\n`);

    // Listen for updates
    const onQRUpdate = (updatedTenantId: string, qrDataUrl: string | null) => {
        if (updatedTenantId === tenantId) {
            const currentInfo = getSessionInfo(tenantId);
            res.write(`data: ${JSON.stringify(currentInfo)}\n\n`);
        }
    };

    setQRUpdateCallback(onQRUpdate);

    // Cleanup on close — remove this specific listener
    req.on("close", () => {
        removeQRUpdateCallback(onQRUpdate);
    });
});

/** Stop a session */
app.post("/sessions/:tenantId/stop", async (req, res) => {
    const { tenantId } = req.params;
    const clearData = req.body?.clearData === true;
    try {
        await stopSession(tenantId, clearData);
        res.json({ success: true });
    } catch (error: any) {
        console.error(`Error stopping session for ${tenantId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

/** Reconnect a session (force restart, optionally clear auth) */
app.post("/sessions/:tenantId/reconnect", async (req, res) => {
    const { tenantId } = req.params;
    const clearAuth = req.body?.clearAuth === true;
    try {
        await reconnectSession(tenantId, clearAuth);
        // Wait for QR to generate
        await new Promise((r) => setTimeout(r, 3000));
        const info = getSessionInfo(tenantId);
        res.json({ success: true, ...info });
    } catch (error: any) {
        console.error(`Error reconnecting session for ${tenantId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

/** Check if a phone number is registered on WhatsApp */
app.get("/sessions/:tenantId/check-number", async (req, res) => {
    const { tenantId } = req.params;
    const phone = req.query.phone as string;
    if (!phone) {
        res.status(400).json({ error: "Missing phone query param" });
        return;
    }
    const normalized = normalizePhone(phone);
    try {
        const jid = await checkWhatsAppNumber(tenantId, normalized);
        res.json({ exists: !!jid, jid, normalized });
    } catch (err: any) {
        // Session not active — can't validate, return unknown
        res.json({ exists: null, error: err.message, normalized });
    }
});

/** Invalidate tenant config cache (called after settings update) */
app.post("/sessions/:tenantId/invalidate-cache", (req, res) => {
    const { tenantId } = req.params;
    invalidateTenantConfigCache(tenantId);
    res.json({ success: true });
});

/** Trigger batch learning for a given tenant */
app.post("/sessions/:tenantId/learn", async (req, res) => {
    const { tenantId } = req.params;
    const hours = parseInt(req.body?.hours || "24", 10);

    // Verify tenant exists before running learning
    const { createClient: mkClient } = await import("@supabase/supabase-js");
    const sb = mkClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: tenant } = await sb.from("tenants").select("id").eq("id", tenantId).maybeSingle();
    if (!tenant) {
        return res.status(404).json({ success: false, error: "Tenant not found" });
    }

    try {
        const result = await runBatchLearning(tenantId, hours);
        res.json(result);
    } catch (error: any) {
        console.error(`Error running learning for ${tenantId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Global crash protection ─────────────────────────────────────────
// Baileys WebSocket can throw unhandled errors that crash the process.
// These handlers log the error but keep the server alive.
process.on("uncaughtException", (err) => {
    console.error("❌ Uncaught Exception (process will NOT exit):", err.message);
});

process.on("unhandledRejection", (reason: any) => {
    console.error("❌ Unhandled Rejection (process will NOT exit):", reason?.message || reason);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

    // Set flag BEFORE closing sockets — this prevents disconnect handlers
    // from calling clearSessionData (which would destroy creds for the new instance).
    setShuttingDown();

    const activeSessions = getActiveSessions();
    console.log(`Closing ${activeSessions.length} active session(s)...`);

    // Save creds backup for each active session before stopping.
    // This ensures the new instance can restore even if main creds get cleared.
    for (const tenantId of activeSessions) {
        try {
            await flushCacheToDB(tenantId);
            await saveCredsBackup(tenantId);
            console.log(`[${tenantId}] 💾 Creds backup saved before shutdown`);
        } catch (err: any) {
            console.error(`[${tenantId}] Failed to save backup:`, err.message);
        }
    }

    for (const tenantId of activeSessions) {
        try {
            await stopSession(tenantId, false); // false = keep auth data
        } catch (err: any) {
            console.error(`Error stopping session for ${tenantId}:`, err.message);
        }
    }

    console.log("✅ All sessions closed cleanly. Exiting.");
    process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── Temporary Admin API Key Ingestion ────────────────────────────────
app.post("/admin/set-key", (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.SESSION_MANAGER_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const { key } = req.body;
    if (key) {
        process.env.DEEPSEEK_API_KEY = key;
        return res.json({ success: true, message: "DeepSeek API key updated in memory." });
    }
    return res.status(400).json({ error: "Missing key" });
});

// ─── Start server ─────────────────────────────────────────────────────
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, async () => {
    console.log(`\n🚀 WhatsApp Session Manager running on http://${HOST}:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Sessions: http://localhost:${PORT}/sessions\n`);

    // Restore any previously connected sessions
    await restoreAllSessions();

    // ─── Self-Pinger (Keep-Alive) ─────────────────────────────────────────
    if (PUBLIC_URL) {
        console.log(`📡 Self-pinger active: pinging ${PUBLIC_URL}/health every 10 minutes`);

        const userAgents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0"
        ];

        // Ping every 10 minutes
        cron.schedule("*/10 * * * *", async () => {
            try {
                const randomId = Math.random().toString(36).substring(7);
                const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

                const response = await fetch(`${PUBLIC_URL}/health?t=${Date.now()}&ref=${randomId}`, {
                    headers: {
                        "User-Agent": randomUA,
                        "Accept": "application/json",
                        "X-Requested-With": "XMLHttpRequest",
                        "Cache-Control": "no-cache"
                    }
                });

                if (response.ok) {
                    console.log(`💓 Self-ping successful (id: ${randomId})`);
                } else {
                    console.warn(`💓 Self-ping failed (id: ${randomId}) with status: ${response.status}`);
                }
            } catch (err: any) {
                console.error("💓 Self-ping failed:", err.message);
            }
        });
    } else {
        console.log("⚠️ PUBLIC_URL not set – self-pinger disabled. Server may sleep on free-tier hosting.");
    }
});

import cron from "node-cron";

// ─── Cron overlap guards ──────────────────────────────────────────────
let _watchdogRunning = false;
let _learningRunning = false;

// ─── Session Watchdog (Auto-Recovery) ────────────────────────────────
// Every 5 minutes: find sessions with saved creds that aren't in memory, and restart them.
// This recovers sessions that died after MAX_RETRIES or after a server restart.
cron.schedule("*/5 * * * *", async () => {
    if (_watchdogRunning) {
        console.warn("⚠️ Watchdog still running from previous tick — skipping this cycle");
        return;
    }
    _watchdogRunning = true;
    try {
        const activeSessions = getActiveSessions();
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: sessionsWithCreds } = await supabase
            .from("whatsapp_sessions")
            .select("tenant_id")
            .eq("session_key", "creds");

        if (!sessionsWithCreds || sessionsWithCreds.length === 0) return;

        const uniqueTenants = [...new Set(sessionsWithCreds.map((s) => s.tenant_id))];
        const deadTenants = uniqueTenants.filter((id) => !activeSessions.includes(id));

        if (deadTenants.length === 0) return;

        // Fix D: Filter out tenants already in an auto-reconnect cycle to prevent
        // the watchdog from starting a second concurrent connection attempt.
        const actionableTenants = deadTenants.filter((id) => {
            if (isReconnecting(id)) {
                console.log(`[${id}] ⏳ Watchdog: reconnect already in progress — skipping`);
                return false;
            }
            return true;
        });

        if (actionableTenants.length === 0 && activeSessions.length === 0) return;

        // ── Phase 1: Restart dead sessions (not in sessions Map) ──
        // IMPORTANT: use createSession (not startSession) to preserve saved auth state.
        // startSession clears crypto keys and forces a QR rescan — never do that automatically.
        if (actionableTenants.length > 0) {
            console.log(`🔍 Watchdog: ${actionableTenants.length} dead session(s) detected. Restarting...`);
            for (const tenantId of actionableTenants) {
                try {
                    console.log(`[${tenantId}] 🔄 Watchdog restarting session (auth preserved)...`);
                    await createSession(tenantId);
                    await new Promise((r) => setTimeout(r, 3000));
                } catch (err: any) {
                    console.error(`[${tenantId}] Watchdog restart failed:`, err.message);
                }
            }
        }

        // ── Phase 2: Detect zombie connections (in Map but socket is dead) ──
        // Same: use createSession to reconnect without wiping auth.
        for (const tenantId of activeSessions) {
            try {
                const info = getSessionInfo(tenantId);
                if (info.status !== "connected") continue; // Only probe "connected" sessions

                const alive = await probeSessionHealth(tenantId);
                if (!alive) {
                    console.warn(`[${tenantId}] 🧟 Watchdog: zombie connection detected — force restarting (auth preserved)...`);
                    await stopSession(tenantId, false);
                    await new Promise((r) => setTimeout(r, 3000));
                    await createSession(tenantId);
                }
            } catch (err: any) {
                console.error(`[${tenantId}] Watchdog zombie check failed:`, err.message);
            }
        }
    } catch (err: any) {
        console.error("Session watchdog error:", err.message);
    } finally {
        _watchdogRunning = false;
    }
});

// ─── Auto-Unpause (40 minutes) ────────────────────────────────────────
// Every 2 minutes: unpause conversations that have been paused for 40+ minutes.
cron.schedule("*/2 * * * *", async () => {
    try {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const cutoff = new Date(Date.now() - 40 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from("conversations")
            .update({ is_paused: false })
            .eq("is_paused", true)
            .lt("updated_at", cutoff)
            .select("id, tenant_id");

        if (error) {
            console.error("Auto-unpause cron error:", error.message);
            return;
        }

        if (data && data.length > 0) {
            console.log(`⏰ Auto-unpause: resumed ${data.length} conversation(s)`);
        }
    } catch (err: any) {
        console.error("Auto-unpause cron fatal:", err.message);
    }
});

// ─── Unanswered-customer reminder (every 5 minutes) ──────────────────
// Find paused conversations where the last message is from a user and was
// sent > 10 minutes ago, then send the owner a WhatsApp reminder.
// Debounce: max 1 reminder per conversation per 30 minutes (in-memory map).
const _reminderSentAt = new Map<string, number>(); // conversationId → timestamp
const REMINDER_DEBOUNCE_MS = 30 * 60 * 1000; // 30 minutes

cron.schedule("*/5 * * * *", async () => {
    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) return;

    try {
        const { createClient } = await import("@supabase/supabase-js");
        const { summarizeConversationForHandoff } = await import("./ai-agent");
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const tenCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        // For each active tenant session, find paused conversations with unanswered user messages
        for (const tenantId of activeSessions) {
            try {
                // Get tenant owner_phone + filter config
                const { data: tenant } = await supabase
                    .from("tenants")
                    .select("owner_phone, agent_filter_mode")
                    .eq("id", tenantId)
                    .single();

                if (!tenant?.owner_phone) continue;

                // Find paused conversations for this tenant (individual chats only)
                const { data: pausedConvs } = await supabase
                    .from("conversations")
                    .select("id, phone_number, contact_name, updated_at")
                    .eq("tenant_id", tenantId)
                    .eq("is_paused", true)
                    .eq("is_group", false);

                if (!pausedConvs || pausedConvs.length === 0) continue;

                // Fetch contact rules once for this tenant (needed for whitelist/blacklist)
                let contactRules: { phone_number: string; rule_type: string }[] = [];
                const filterMode = tenant.agent_filter_mode ?? "all";
                if (filterMode !== "all") {
                    const { data: rulesData } = await supabase
                        .from("contact_rules")
                        .select("phone_number, rule_type")
                        .eq("tenant_id", tenantId);
                    contactRules = rulesData ?? [];
                }

                // Helper: is this phone eligible for reminders under the current filter mode?
                const isEligible = (phone: string): boolean => {
                    if (filterMode === "all") return true;
                    // Normalise: strip leading + if present
                    const normalize = (p: string) => p.replace(/^\+/, "");
                    const international = normalize(phone);
                    // Also check local Israeli format (0xxxxxxxxx)
                    const local =
                        international.startsWith("972") && international.length >= 11
                            ? "0" + international.substring(3)
                            : null;
                    const matched = contactRules.find(
                        (r) =>
                            normalize(r.phone_number) === international ||
                            (local !== null && normalize(r.phone_number) === local)
                    );
                    if (filterMode === "whitelist") {
                        return matched?.rule_type === "allow";
                    } else {
                        // blacklist
                        return matched?.rule_type !== "block";
                    }
                };

                for (const conv of pausedConvs) {
                    // Skip contacts not eligible under the tenant's filter mode
                    if (!isEligible(conv.phone_number)) continue;

                    // Debounce: skip if reminder was sent in the last 30 minutes
                    const lastSent = _reminderSentAt.get(conv.id) ?? 0;
                    if (Date.now() - lastSent < REMINDER_DEBOUNCE_MS) continue;

                    // Check if the last message in this conversation is from a user
                    // and was sent more than 10 minutes ago
                    const { data: lastMsg } = await supabase
                        .from("messages")
                        .select("role, created_at")
                        .eq("conversation_id", conv.id)
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!lastMsg) continue;
                    if (lastMsg.role !== "user") continue;
                    if (lastMsg.created_at > tenCutoff) continue; // Not yet 10 minutes

                    // Calculate how many minutes the customer has been waiting
                    const waitMs = Date.now() - new Date(lastMsg.created_at).getTime();
                    const waitMins = Math.floor(waitMs / 60_000);

                    // Summarize what the customer wants
                    let summary = "";
                    try {
                        summary = await summarizeConversationForHandoff(tenantId, conv.id);
                    } catch (_) {
                        // Non-fatal — send reminder without summary
                    }

                    const customerPhone = conv.phone_number.startsWith("972") && conv.phone_number.length >= 11
                        ? "0" + conv.phone_number.substring(3)
                        : conv.phone_number;

                    const summaryLine = summary ? `\n\n📋 ${summary}` : "";
                    const reminderMsg = [
                        `⏰ תזכורת: לקוח עדיין ממתין לתשובה!`,
                        ``,
                        `👤 ${conv.contact_name || "לא ידוע"}`,
                        `📞 ${customerPhone}`,
                        `⏱️ ממתין כבר ${waitMins} דקות`,
                        summaryLine.trim() ? summaryLine.trim() : null,
                        ``,
                        `פתח את הצ'אט בוואטסאפ העסקי שלך לענות.`,
                    ].filter((l) => l !== null).join("\n");

                    // Normalize owner_phone → international
                    let ownerDigits = tenant.owner_phone.replace(/\D/g, "");
                    if (ownerDigits.startsWith("0") && ownerDigits.length === 10) {
                        ownerDigits = "972" + ownerDigits.substring(1);
                    }
                    const ownerJid = `${ownerDigits}@s.whatsapp.net`;

                    try {
                        await sendMessage(tenantId, ownerJid, reminderMsg);
                        _reminderSentAt.set(conv.id, Date.now());
                        console.log(`[${tenantId}] ⏰ Reminder sent to owner for conversation ${conv.id} (waited ${waitMins} min)`);
                    } catch (sendErr: any) {
                        console.error(`[${tenantId}] ❌ Failed to send reminder to owner:`, sendErr.message);
                    }
                }
            } catch (tenantErr: any) {
                console.error(`[${tenantId}] Reminder cron error:`, tenantErr.message);
            }
        }
    } catch (err: any) {
        console.error("Unanswered-reminder cron fatal:", err.message);
    }
});

// ─── Meeting day-before reminders (every hour) ─────────────────────────────
// Sends customer a reminder + cancellation offer 23–25h before their meeting.
cron.schedule("0 * * * *", async () => {
    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) return;
    try {
        await sendDayBeforeReminders(
            activeSessions,
            async (tenantId, jid, text) => {
                await sendMessage(tenantId, jid, text);
            }
        );
    } catch (err: any) {
        console.error("Day-before reminder cron fatal:", err.message);
    }
});

// ─── Meeting 2h-before reminders (every 15 minutes) ────────────────────────
// Sends customer + owner a reminder 1h45m–2h15m before their meeting.
cron.schedule("*/15 * * * *", async () => {
    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) return;
    try {
        await sendTwoHourReminders(
            activeSessions,
            async (tenantId, jid, text) => {
                await sendMessage(tenantId, jid, text);
            }
        );
    } catch (err: any) {
        console.error("2h-before reminder cron fatal:", err.message);
    }
});

// ─── Daily batch learning (02:00) ───────────────────────────────────────────
// Run every night at 02:00 server time
cron.schedule("0 2 * * *", async () => {
    if (_learningRunning) {
        console.warn("⚠️ Daily learning cron still running from previous tick — skipping this cycle");
        return;
    }
    _learningRunning = true;
    console.log("⏰ Running daily batch learning for all tenants in 'learning' mode...");
    try {
        // Reuse the Supabase singleton from session-manager
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Find all tenants that have agent_mode = 'learning' or 'active'
        const { data: tenants, error } = await supabase
            .from("tenants")
            .select("id")
            .in("agent_mode", ["learning", "active"]);

        if (error || !tenants) {
            console.error("Failed to query tenants for daily learning:", error);
            return;
        }

        console.log(`Found ${tenants.length} tenants in learning/active mode.`);

        for (const t of tenants) {
            try {
                // Read the last 24 hours of history
                await runBatchLearning(t.id, 24);
            } catch (err: any) {
                console.error(`[${t.id}] failed daily learning:`, err.message);
            }
        }
    } catch (err) {
        console.error("Fatal error during daily cron job:", err);
    } finally {
        _learningRunning = false;
    }
});
