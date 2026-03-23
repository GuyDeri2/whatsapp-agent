/**
 * Session Manager — Cron-only service.
 *
 * After migrating to WhatsApp Cloud API, this service no longer manages
 * Baileys WebSocket sessions. It runs scheduled jobs that can't execute
 * on Vercel (long-running / recurring):
 *   - Auto-unpause conversations (every 2 min)
 *   - Unanswered-customer reminders (every 5 min)
 *   - Meeting day-before reminders (every hour)
 *   - Meeting 2h-before reminders (every 15 min)
 *   - Daily batch learning (02:00)
 *   - Self-pinger keep-alive (every 10 min)
 *
 * Messages are sent via the WhatsApp Cloud API (Meta Graph API).
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { runBatchLearning } from "./learning-engine";
import { sendDayBeforeReminders, sendTwoHourReminders } from "./reminders";
import { summarizeConversationForHandoff } from "./ai-agent";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
const PUBLIC_URL = process.env.PUBLIC_URL;

// ─── Supabase singleton ──────────────────────────────────────────────
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
    if (!_supabase) {
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    }
    return _supabase;
}

// ─── WhatsApp Cloud API sender ───────────────────────────────────────
// Replaces the old Baileys sendMessage function.
// Looks up tenant Cloud API config from whatsapp_cloud_config table.

interface CloudConfig {
    phone_number_id: string;
    access_token: string;
}

const configCache = new Map<string, { config: CloudConfig | null; expiresAt: number }>();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CONFIG_CACHE_MAX_SIZE = 500;

async function getCloudConfig(tenantId: string): Promise<CloudConfig | null> {
    const cached = configCache.get(tenantId);
    if (cached && Date.now() < cached.expiresAt) return cached.config;

    const { data, error } = await getSupabase()
        .from("whatsapp_cloud_config")
        .select("phone_number_id, access_token")
        .eq("tenant_id", tenantId)
        .maybeSingle();

    if (error) {
        console.error(`[${tenantId}] Failed to fetch Cloud config:`, error.message);
        return null;
    }

    const config: CloudConfig | null = data
        ? { phone_number_id: data.phone_number_id, access_token: data.access_token }
        : null;

    // Evict oldest entry if cache is full
    if (configCache.size >= CONFIG_CACHE_MAX_SIZE && !configCache.has(tenantId)) {
        const oldestKey = configCache.keys().next().value;
        if (oldestKey) configCache.delete(oldestKey);
    }

    configCache.set(tenantId, { config, expiresAt: Date.now() + CONFIG_CACHE_TTL });
    return config;
}

/**
 * Send a WhatsApp message via Cloud API.
 * Accepts phone number or JID (strips @s.whatsapp.net for backward compat).
 */
async function sendCloudMessage(tenantId: string, to: string, text: string): Promise<void> {
    const config = await getCloudConfig(tenantId);
    if (!config) {
        console.error(`[${tenantId}] No Cloud API config — cannot send message`);
        return;
    }

    // Normalize: strip JID suffix, convert Israeli local to international
    let phone = to.replace(/@s\.whatsapp\.net$/, "").replace(/@g\.us$/, "");
    phone = phone.replace(/^\+/, "");
    if (phone.startsWith("00")) {
        phone = phone.slice(2);
    }
    if (/^0[2-9]/.test(phone)) {
        phone = "972" + phone.slice(1);
    }

    const apiVersion = process.env.META_API_VERSION || "v21.0";
    const url = `https://graph.facebook.com/${apiVersion}/${config.phone_number_id}/messages`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.access_token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "text",
            text: { body: text },
        }),
    });

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Cloud API error (${res.status}): ${errBody}`);
    }
}

// ─── Middleware ────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : [process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (cron, health checks, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
}));
app.use(express.json());

function authMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    const secret = process.env.SESSION_MANAGER_SECRET;
    if (!secret) {
        res.status(500).json({ error: "SESSION_MANAGER_SECRET is not configured" });
        return;
    }
    if (req.headers.authorization !== `Bearer ${secret}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
}

app.use("/sessions", authMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────

/** Health check */
app.get("/health", (_req, res) => {
    res.json({ status: "ok", mode: "cron-only" });
});

/** Invalidate tenant config cache */
app.post("/sessions/:tenantId/invalidate-cache", (req, res) => {
    const { tenantId } = req.params;
    configCache.delete(tenantId);
    res.json({ success: true });
});

/** Trigger batch learning for a given tenant */
app.post("/sessions/:tenantId/learn", async (req, res) => {
    const { tenantId } = req.params;
    const hours = parseInt(req.body?.hours || "24", 10);

    const { data: tenant } = await getSupabase()
        .from("tenants").select("id").eq("id", tenantId).maybeSingle();
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
process.on("uncaughtException", (err) => {
    console.error("❌ Uncaught Exception — exiting:", err.message);
    process.exit(1);
});
process.on("unhandledRejection", (reason: any) => {
    console.error("❌ Unhandled Rejection (process will NOT exit):", reason?.message || reason);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────
process.on("SIGINT", () => { console.log("\n🛑 Shutting down..."); process.exit(0); });
process.on("SIGTERM", () => { console.log("\n🛑 Shutting down..."); process.exit(0); });

// ─── Start server ────────────────────────────────────────────────────
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
    console.log(`\n🚀 Session Manager (cron-only) running on http://${HOST}:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);

    // ─── Self-Pinger (Keep-Alive) ────────────────────────────────────
    if (PUBLIC_URL) {
        console.log(`📡 Self-pinger active: pinging ${PUBLIC_URL}/health every 10 minutes`);
        cron.schedule("*/10 * * * *", async () => {
            try {
                const response = await fetch(`${PUBLIC_URL}/health?t=${Date.now()}`);
                if (response.ok) {
                    console.log("💓 Self-ping successful");
                } else {
                    console.warn(`💓 Self-ping failed with status: ${response.status}`);
                }
            } catch (err: any) {
                console.error("💓 Self-ping failed:", err.message);
            }
        });
    } else {
        console.log("⚠️ PUBLIC_URL not set – self-pinger disabled.");
    }
});

// ─── Cron overlap guards ─────────────────────────────────────────────
let _learningRunning = false;
let _learningStartedAt = 0;
const LEARNING_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Auto-Unpause (40 minutes) ──────────────────────────────────────
// Every 2 minutes: unpause conversations that have been paused for 40+ minutes.
cron.schedule("*/2 * * * *", async () => {
    try {
        const supabase = getSupabase();
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
const _reminderSentAt = new Map<string, number>();
const REMINDER_DEBOUNCE_MS = 30 * 60 * 1000;

// Clean up stale reminder entries every 30 minutes to prevent unbounded Map growth
setInterval(() => {
    const cutoff = Date.now() - REMINDER_DEBOUNCE_MS;
    for (const [id, ts] of _reminderSentAt) {
        if (ts < cutoff) _reminderSentAt.delete(id);
    }
}, 30 * 60 * 1000);

cron.schedule("*/5 * * * *", async () => {
    try {
        const supabase = getSupabase();

        // Get all tenants with Cloud API configured (replaces "active sessions" check)
        const { data: cloudConfigs } = await supabase
            .from("whatsapp_cloud_config")
            .select("tenant_id");

        if (!cloudConfigs || cloudConfigs.length === 0) return;

        const tenantIds = cloudConfigs.map((c) => c.tenant_id as string);
        const tenCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        for (const tenantId of tenantIds) {
            try {
                const { data: tenant } = await supabase
                    .from("tenants")
                    .select("owner_phone, agent_filter_mode")
                    .eq("id", tenantId)
                    .single();

                if (!tenant?.owner_phone) continue;

                const { data: pausedConvs } = await supabase
                    .from("conversations")
                    .select("id, phone_number, contact_name, updated_at")
                    .eq("tenant_id", tenantId)
                    .eq("is_paused", true)
                    .eq("is_group", false);

                if (!pausedConvs || pausedConvs.length === 0) continue;

                let contactRules: { phone_number: string; rule_type: string }[] = [];
                const filterMode = tenant.agent_filter_mode ?? "all";
                if (filterMode !== "all") {
                    const { data: rulesData } = await supabase
                        .from("contact_rules")
                        .select("phone_number, rule_type")
                        .eq("tenant_id", tenantId);
                    contactRules = rulesData ?? [];
                }

                const isEligible = (phone: string): boolean => {
                    if (filterMode === "all") return true;
                    const normalize = (p: string) => p.replace(/^\+/, "");
                    const international = normalize(phone);
                    const local =
                        international.startsWith("972") && international.length >= 11
                            ? "0" + international.substring(3)
                            : null;
                    const matched = contactRules.find(
                        (r) =>
                            normalize(r.phone_number) === international ||
                            (local !== null && normalize(r.phone_number) === local)
                    );
                    if (filterMode === "whitelist") return matched?.rule_type === "allow";
                    return matched?.rule_type !== "block";
                };

                // Filter eligible conversations before querying messages
                const eligibleConvs = pausedConvs.filter((conv) => {
                    if (!isEligible(conv.phone_number)) return false;
                    const lastSent = _reminderSentAt.get(conv.id) ?? 0;
                    return Date.now() - lastSent >= REMINDER_DEBOUNCE_MS;
                });

                if (eligibleConvs.length === 0) continue;

                // Batch query: fetch last message per conversation using a single query
                const convIds = eligibleConvs.map((c) => c.id);
                const { data: lastMessages } = await supabase
                    .from("messages")
                    .select("conversation_id, role, created_at")
                    .in("conversation_id", convIds)
                    .order("created_at", { ascending: false });

                // Build map of conversation_id → last message (first occurrence per conv is the latest)
                const lastMsgMap = new Map<string, { role: string; created_at: string }>();
                for (const msg of lastMessages ?? []) {
                    if (!lastMsgMap.has(msg.conversation_id)) {
                        lastMsgMap.set(msg.conversation_id, { role: msg.role, created_at: msg.created_at });
                    }
                }

                for (const conv of eligibleConvs) {
                    const lastMsg = lastMsgMap.get(conv.id);
                    if (!lastMsg) continue;
                    if (lastMsg.role !== "user") continue;
                    if (lastMsg.created_at > tenCutoff) continue;

                    const waitMs = Date.now() - new Date(lastMsg.created_at).getTime();
                    const waitMins = Math.floor(waitMs / 60_000);

                    let summary = "";
                    try {
                        summary = await summarizeConversationForHandoff(tenantId, conv.id);
                    } catch (_) {
                        // Non-fatal
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

                    let ownerDigits = tenant.owner_phone.replace(/\D/g, "");
                    if (ownerDigits.startsWith("0") && ownerDigits.length === 10) {
                        ownerDigits = "972" + ownerDigits.substring(1);
                    }

                    try {
                        await sendCloudMessage(tenantId, ownerDigits, reminderMsg);
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

// ─── Meeting day-before reminders (every hour) ──────────────────────
cron.schedule("0 * * * *", async () => {
    try {
        const { data: cloudConfigs } = await getSupabase()
            .from("whatsapp_cloud_config")
            .select("tenant_id");

        if (!cloudConfigs || cloudConfigs.length === 0) return;

        const tenantIds = cloudConfigs.map((c) => c.tenant_id as string);
        await sendDayBeforeReminders(tenantIds, sendCloudMessage);
    } catch (err: any) {
        console.error("Day-before reminder cron fatal:", err.message);
    }
});

// ─── Meeting 2h-before reminders (every 15 minutes) ─────────────────
cron.schedule("*/15 * * * *", async () => {
    try {
        const { data: cloudConfigs } = await getSupabase()
            .from("whatsapp_cloud_config")
            .select("tenant_id");

        if (!cloudConfigs || cloudConfigs.length === 0) return;

        const tenantIds = cloudConfigs.map((c) => c.tenant_id as string);
        await sendTwoHourReminders(tenantIds, sendCloudMessage);
    } catch (err: any) {
        console.error("2h-before reminder cron fatal:", err.message);
    }
});

// ─── Token refresh (daily at 03:00) ──────────────────────────────────
// Refresh Meta long-lived tokens that expire within 7 days.
// Long-lived tokens last ~60 days; refreshing weekly gives plenty of margin.
cron.schedule("0 3 * * *", async () => {
    try {
        const supabase = getSupabase();
        const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Find tokens expiring within 7 days (or with no expiry recorded)
        const { data: configs, error } = await supabase
            .from("whatsapp_cloud_config")
            .select("tenant_id, access_token, token_expires_at")
            .or(`token_expires_at.is.null,token_expires_at.lt.${sevenDaysFromNow}`);

        if (error || !configs || configs.length === 0) {
            if (error) console.error("Token refresh query error:", error.message);
            return;
        }

        console.log(`🔑 Token refresh: ${configs.length} token(s) need refresh`);

        const META_APP_ID = process.env.META_APP_ID;
        const META_APP_SECRET = process.env.META_APP_SECRET;
        const apiVersion = process.env.META_API_VERSION || "v21.0";

        if (!META_APP_ID || !META_APP_SECRET) {
            console.error("🔑 Token refresh: META_APP_ID or META_APP_SECRET not set");
            return;
        }

        for (const cfg of configs) {
            try {
                const res = await fetch(
                    `https://graph.facebook.com/${apiVersion}/oauth/access_token?` +
                    new URLSearchParams({
                        grant_type: "fb_exchange_token",
                        client_id: META_APP_ID,
                        client_secret: META_APP_SECRET,
                        fb_exchange_token: cfg.access_token,
                    })
                );

                if (!res.ok) {
                    const errText = await res.text();
                    console.error(`[${cfg.tenant_id}] 🔑 Token refresh failed:`, errText);
                    continue;
                }

                const data = await res.json() as { access_token?: string; expires_in?: number };
                if (!data.access_token) {
                    console.error(`[${cfg.tenant_id}] 🔑 Token refresh: no token in response`);
                    continue;
                }

                const expiresInMs = (data.expires_in ?? 5184000) * 1000;
                const newExpiresAt = new Date(Date.now() + expiresInMs).toISOString();

                await supabase
                    .from("whatsapp_cloud_config")
                    .update({
                        access_token: data.access_token,
                        token_expires_at: newExpiresAt,
                    })
                    .eq("tenant_id", cfg.tenant_id);

                // Invalidate config cache so new token is used immediately
                configCache.delete(cfg.tenant_id);

                console.log(`[${cfg.tenant_id}] 🔑 Token refreshed, new expiry: ${newExpiresAt}`);
            } catch (err: any) {
                console.error(`[${cfg.tenant_id}] 🔑 Token refresh error:`, err.message);
            }
        }
    } catch (err: any) {
        console.error("Token refresh cron fatal:", err.message);
    }
});

// ─── Daily batch learning (02:00) ───────────────────────────────────
cron.schedule("0 2 * * *", async () => {
    if (_learningRunning) {
        if (Date.now() - _learningStartedAt > LEARNING_TIMEOUT_MS) {
            console.warn("⚠️ Daily learning cron stuck for >30 min — resetting flag");
            _learningRunning = false;
        } else {
            console.warn("⚠️ Daily learning cron still running — skipping");
            return;
        }
    }
    _learningRunning = true;
    _learningStartedAt = Date.now();
    console.log("⏰ Running daily batch learning for all tenants...");
    try {
        const supabase = getSupabase();
        const { data: tenants, error } = await supabase
            .from("tenants")
            .select("id")
            .eq("agent_mode", "learning");

        if (error || !tenants) {
            console.error("Failed to query tenants for daily learning:", error);
            return;
        }

        console.log(`Found ${tenants.length} tenants in learning mode.`);
        for (const t of tenants) {
            try {
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
