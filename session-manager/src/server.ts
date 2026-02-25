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
    stopSession,
    getSessionInfo,
    getActiveSessions,
    restoreAllSessions,
    setQRUpdateCallback,
    sendMessage,
    reconnectSession,
} from "./session-manager";
import { runBatchLearning } from "./learning-engine";

const app = express();
// Default port for the session manager (dashboard runs on 3000)
const PORT = parseInt(process.env.PORT || "3001", 10);

// ─── Middleware ────────────────────────────────────────────────────────
app.use(
    cors({
        origin: process.env.DASHBOARD_URL || "http://localhost:3000",
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
        next();
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

    // Cleanup on close
    req.on("close", () => {
        // In a production app, you'd want a proper event emitter pattern
        // For MVP, having a single SSE listener per tenant is fine
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

/** Trigger batch learning for a given tenant */
app.post("/sessions/:tenantId/learn", async (req, res) => {
    const { tenantId } = req.params;
    const hours = parseInt(req.body?.hours || "24", 10);
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
    const sessions = getActiveSessions();
    console.log(`Closing ${sessions.length} active session(s)...`);

    for (const tenantId of sessions) {
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

// ─── Start server ─────────────────────────────────────────────────────
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, async () => {
    console.log(`\n🚀 WhatsApp Session Manager running on http://${HOST}:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Sessions: http://localhost:${PORT}/sessions\n`);

    // Restore any previously connected sessions
    await restoreAllSessions();
});

import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";

// Run every night at 02:00 server time
cron.schedule("0 2 * * *", async () => {
    console.log("⏰ Running daily batch learning for all tenants in 'learning' mode...");
    try {
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
    }
});
