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
} from "./session-manager";

const app = express();
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

// ─── Start server ─────────────────────────────────────────────────────
app.listen(PORT, async () => {
    console.log(`\n🚀 WhatsApp Session Manager running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Sessions: http://localhost:${PORT}/sessions\n`);

    // Restore any previously connected sessions
    await restoreAllSessions();
});
