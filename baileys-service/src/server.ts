/**
 * Baileys Service — Express server.
 *
 * Manages WhatsApp sessions via Baileys (linked device / QR code).
 * Runs alongside the existing cron-only session-manager.
 *
 * Endpoints:
 *   GET  /health                     — health check
 *   POST /sessions/:tenantId/start   — start new session (QR flow)
 *   POST /sessions/:tenantId/stop    — stop session
 *   GET  /sessions/:tenantId/status  — get session status
 *   POST /sessions/:tenantId/send    — send a message
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import {
    createSession,
    startSession,
    stopSession,
    getSession,
    getAllSessions,
    runWatchdog,
    autoReconnectAll,
} from "./session-manager";

const app = express();
const PORT = parseInt(process.env.PORT || "3002", 10);
const PUBLIC_URL = process.env.PUBLIC_URL;

// ── Middleware ──────────────────────────────────────────────────────

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());

function authMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    const secret = process.env.SESSION_MANAGER_SECRET;
    if (!secret) {
        res.status(500).json({ error: "SESSION_MANAGER_SECRET not configured" });
        return;
    }
    if (req.headers.authorization !== `Bearer ${secret}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
}

app.use("/sessions", authMiddleware);

// ── Routes ─────────────────────────────────────────────────────────

/** Health check */
app.get("/health", (_req, res) => {
    const sessions = getAllSessions();
    res.json({
        status: "ok",
        service: "baileys",
        activeSessions: sessions.size,
        uptime: Math.floor(process.uptime()),
    });
});

/** Start new session (QR code flow) */
app.post("/sessions/:tenantId/start", async (req, res) => {
    const { tenantId } = req.params;
    try {
        await startSession(tenantId);
        res.json({ success: true, message: "Session starting — scan QR code" });
    } catch (err: any) {
        console.error(`[${tenantId}] Start session error:`, err);
        res.status(500).json({ error: err.message });
    }
});

/** Stop session */
app.post("/sessions/:tenantId/stop", async (req, res) => {
    const { tenantId } = req.params;
    const clearData = req.body?.clearData ?? true;
    try {
        await stopSession(tenantId, clearData);
        res.json({ success: true });
    } catch (err: any) {
        console.error(`[${tenantId}] Stop session error:`, err);
        res.status(500).json({ error: err.message });
    }
});

/** Get session status */
app.get("/sessions/:tenantId/status", (req, res) => {
    const { tenantId } = req.params;
    const session = getSession(tenantId);

    if (!session) {
        res.json({ connected: false });
        return;
    }

    res.json({
        connected: true,
        phoneNumber: session.phoneNumber,
        connectedAt: session.connectedAt?.toISOString() ?? null,
        retryCount: session.retryCount,
    });
});

/** Send a message (used by session-manager cron for reminders) */
app.post("/sessions/:tenantId/send", async (req, res) => {
    const { tenantId } = req.params;
    const { to, text } = req.body;

    if (!to || !text) {
        res.status(400).json({ error: "Missing 'to' or 'text'" });
        return;
    }

    const session = getSession(tenantId);
    if (!session) {
        res.status(404).json({ error: "No active session" });
        return;
    }

    try {
        // Normalize phone to JID
        let phone = to.replace(/^\+/, "").replace(/@s\.whatsapp\.net$/, "");
        if (/^0[2-9]/.test(phone)) {
            phone = "972" + phone.slice(1);
        }
        const jid = phone + "@s.whatsapp.net";

        const { humanSend } = await import("./antiban");
        await humanSend(session.socket, jid, text);

        res.json({ success: true });
    } catch (err: any) {
        console.error(`[${tenantId}] Send error:`, err);
        res.status(500).json({ error: err.message });
    }
});

// ── Global crash protection ────────────────────────────────────────

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err.message);
});
process.on("unhandledRejection", (reason: any) => {
    console.error("Unhandled Rejection:", reason?.message || reason);
});

// ── Graceful Shutdown ──────────────────────────────────────────────

async function shutdown() {
    console.log("\nShutting down — stopping all sessions...");
    const sessions = getAllSessions();
    for (const [tenantId] of sessions) {
        try {
            await stopSession(tenantId, false); // Don't clear auth — allow restore on restart
        } catch {
            // Best effort
        }
    }
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Start server ───────────────────────────────────────────────────

const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, async () => {
    console.log(`\nBaileys Service running on http://${HOST}:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);

    // Auto-reconnect all saved sessions
    try {
        await autoReconnectAll();
    } catch (err) {
        console.error("Auto-reconnect failed:", err);
    }

    // ── Watchdog cron (every 2 minutes) ──
    cron.schedule("*/2 * * * *", async () => {
        try {
            await runWatchdog();
        } catch (err: any) {
            console.error("Watchdog error:", err.message);
        }
    });

    // ── Self-pinger (keep-alive for Render) ──
    if (PUBLIC_URL) {
        cron.schedule("*/10 * * * *", async () => {
            try {
                await fetch(`${PUBLIC_URL}/health?t=${Date.now()}`);
            } catch {
                // Non-fatal
            }
        });
    }

    // ── Rate limiter cleanup (every hour) ──
    cron.schedule("0 * * * *", () => {
        const { RateLimiter } = require("./antiban");
        // The singleton rateLimiter in message-handler cleans itself
    });
});
