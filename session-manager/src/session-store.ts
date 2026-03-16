/**
 * Supabase-backed auth state store for Baileys with In-Memory Cache & Batch Sync.
 * Solves "PreKeyError" corruption by instantly resolving crypto key reads/writes 
 * in memory, while persisting to Supabase in robust periodic batches holding the Event Loop steady.
 * 
 * 🔒 Security: session_data is encrypted at rest using AES-256-GCM when
 *    SESSION_ENCRYPTION_KEY is set in environment variables.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import {
    AuthenticationCreds,
    AuthenticationState,
    SignalDataTypeMap,
    initAuthCreds,
    BufferJSON,
} from "@whiskeysockets/baileys";

// ─── Supabase singleton ───────────────────────────────────────────────
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

// ─── Encryption helpers (AES-256-GCM) ─────────────────────────────────
const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || null;
const ALGORITHM = "aes-256-gcm";

function getEncryptionKeyBuffer(): Buffer | null {
    if (!ENCRYPTION_KEY) return null;
    // Key must be exactly 32 bytes for AES-256. SHA-256 hash ensures correct length.
    return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

function encryptData(plaintext: string): { encrypted: string; iv: string; tag: string } {
    const keyBuf = getEncryptionKeyBuffer();
    if (!keyBuf) throw new Error("No encryption key");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");
    const tag = cipher.getAuthTag().toString("base64");
    return { encrypted, iv: iv.toString("base64"), tag };
}

function decryptData(encObj: { encrypted: string; iv: string; tag: string }): string {
    const keyBuf = getEncryptionKeyBuffer();
    if (!keyBuf) throw new Error("No encryption key");
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        keyBuf,
        Buffer.from(encObj.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(encObj.tag, "base64"));
    let decrypted = decipher.update(encObj.encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

function isEncryptedPayload(data: any): boolean {
    return data && typeof data === "object" && "encrypted" in data && "iv" in data && "tag" in data;
}

// ─── Global State Caches ──────────────────────────────────────────────
// tenantId -> session_key -> parsed data
const sessionCache = new Map<string, Map<string, any>>();
// tenantId -> session_key (only keys that have changed and need DB sync)
const dirtyKeys = new Map<string, Set<string>>();
// Track active flush intervals per tenant to prevent memory leaks
const flushIntervals = new Map<string, NodeJS.Timeout>();

// Interval duration for batch syncing (3 seconds)
const BATCH_SYNC_INTERVAL_MS = 3000;

// ─── Cache Management ─────────────────────────────────────────────────

function initTenantCache(tenantId: string) {
    if (!sessionCache.has(tenantId)) {
        sessionCache.set(tenantId, new Map());
        dirtyKeys.set(tenantId, new Set());
    }
}

function markDirty(tenantId: string, key: string) {
    initTenantCache(tenantId);
    dirtyKeys.get(tenantId)!.add(key);
}

// ─── Batch DB Flush Worker ────────────────────────────────────────────
export async function flushCacheToDB(tenantId: string) {
    const dirtySet = dirtyKeys.get(tenantId);
    if (!dirtySet || dirtySet.size === 0) return;

    // Snapshot the dirty keys we're about to process and clear the active set
    // so new writes during the HTTP request don't get missed next flush
    const keysToSync = Array.from(dirtySet);
    dirtySet.clear();

    const cache = sessionCache.get(tenantId)!;
    const upsertPayload: { tenant_id: string; session_key: string; session_data: any }[] = [];
    const deleteKeys: string[] = [];

    for (const key of keysToSync) {
        if (cache.has(key)) {
            const rawJson = JSON.stringify(cache.get(key), BufferJSON.replacer);
            // Encrypt if encryption key is configured
            const session_data = ENCRYPTION_KEY
                ? encryptData(rawJson)
                : JSON.parse(rawJson);
            upsertPayload.push({
                tenant_id: tenantId,
                session_key: key,
                session_data,
            });
        } else {
            deleteKeys.push(key);
        }
    }

    try {
        const supabase = getSupabase();

        // Execute Batch Upserts
        if (upsertPayload.length > 0) {
            const { error } = await supabase.from("whatsapp_sessions").upsert(upsertPayload, {
                onConflict: "tenant_id,session_key",
            });
            if (error) throw new Error(`Upsert failed: ${error.message}`);
        }

        // Execute Batch Deletes
        if (deleteKeys.length > 0) {
            const { error } = await supabase
                .from("whatsapp_sessions")
                .delete()
                .eq("tenant_id", tenantId)
                .in("session_key", deleteKeys);
            if (error) throw new Error(`Delete failed: ${error.message}`);
        }

        // console.log(`[${tenantId}] 💾 Batch Sync Complete: ${upsertPayload.length} writes, ${deleteKeys.length} deletes.`);
    } catch (err) {
        console.error(`[${tenantId}] ❌ Batch Cache Sync Error:`, err);
        // On error, put the keys back into the dirty set so they are retried next cycle
        keysToSync.forEach(k => dirtySet.add(k));
    }
}

// ─── Main export ──────────────────────────────────────────────────────
export async function useSupabaseAuthState(
    tenantId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {

    // 1. Initialise Cache & Data
    initTenantCache(tenantId);
    const cache = sessionCache.get(tenantId)!;

    console.log(`[${tenantId}] 🔄 Loading full WhatsApp crypto state into memory...`);

    // Retry with exponential backoff to handle transient DNS / network failures on reconnect.
    // Without retries a single ENOTFOUND causes the session to start with an empty crypto
    // state, which leads to Signal protocol errors (Invalid PreKey ID) on the next connection.
    const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
    let allRows: any[] | null = null;
    let loadError: any = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        const { data, error } = await getSupabase()
            .from("whatsapp_sessions")
            .select("session_key, session_data")
            .eq("tenant_id", tenantId);

        if (!error) {
            allRows = data;
            loadError = null;
            break; // success
        }

        loadError = error;
        const isNetworkError = error?.message?.includes("ENOTFOUND") ||
            error?.message?.includes("ECONNREFUSED") ||
            error?.message?.includes("getaddrinfo") ||
            error?.message?.includes("fetch failed");

        if (attempt < RETRY_DELAYS_MS.length && isNetworkError) {
            const waitMs = RETRY_DELAYS_MS[attempt];
            console.warn(`[${tenantId}] ⚠️ DNS/network error loading crypto state (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}) — retrying in ${waitMs / 1000}s: ${error.message}`);
            await new Promise(r => setTimeout(r, waitMs));
        } else {
            break; // non-network error or retries exhausted
        }
    }

    const error = loadError;
    if (error) {
        // Check if we already have keys in the in-memory cache from a previous successful load
        const existingCache = sessionCache.get(tenantId);
        if (existingCache && existingCache.size > 0) {
            console.warn(`[${tenantId}] ⚠️ Using cached crypto state due to DNS failure (${existingCache.size} keys) — session may continue normally`);
        } else {
            console.error(`[${tenantId}] Error loading existing session keys:`, error);
        }
    } else if (allRows) {
        let corruptedKeys: string[] = [];
        for (const row of allRows) {
            try {
                let parsed: any;
                if (isEncryptedPayload(row.session_data)) {
                    // Decrypt encrypted data
                    const decryptedJson = decryptData(row.session_data);
                    parsed = JSON.parse(decryptedJson, BufferJSON.reviver);
                } else {
                    // Legacy unencrypted data — read as-is, will be encrypted on next flush
                    parsed = JSON.parse(JSON.stringify(row.session_data), BufferJSON.reviver);
                    // Mark as dirty so it gets encrypted on next sync cycle
                    markDirty(tenantId, row.session_key);
                }
                cache.set(row.session_key, parsed);
            } catch (decryptErr) {
                // Key was encrypted with a different key or data is corrupted — skip it
                console.warn(`[${tenantId}] ⚠️ Skipping corrupted session key: ${row.session_key}`);
                corruptedKeys.push(row.session_key);
            }
        }

        // Clean up corrupted keys from DB so they don't cause issues on next restart
        if (corruptedKeys.length > 0) {
            console.log(`[${tenantId}] 🗑️ Deleting ${corruptedKeys.length} corrupted keys from DB...`);
            await getSupabase()
                .from("whatsapp_sessions")
                .delete()
                .eq("tenant_id", tenantId)
                .in("session_key", corruptedKeys);
        }

        console.log(`[${tenantId}] ✅ Loaded ${allRows.length - corruptedKeys.length} keys into RAM cache (${corruptedKeys.length} corrupted keys removed).`);
    }

    // 2. Start Background Sync Worker (if not already running)
    if (!flushIntervals.has(tenantId)) {
        const interval = setInterval(() => flushCacheToDB(tenantId), BATCH_SYNC_INTERVAL_MS);
        flushIntervals.set(tenantId, interval);
    }

    // Load or initialise creds
    const creds: AuthenticationCreds = cache.get("creds") ?? initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async <T extends keyof SignalDataTypeMap>(
                    type: T,
                    ids: string[]
                ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
                    // Serve entirely from 0ms RAM cache instead of network calls!
                    const result: { [id: string]: SignalDataTypeMap[T] } = {};
                    for (const id of ids) {
                        const key = `${type}-${id}`;
                        if (cache.has(key)) {
                            result[id] = cache.get(key);
                        }
                    }
                    return result;
                },

                set: async (data: any): Promise<void> => {
                    // Update RAM cache instantly so Baileys crypto runs full speed
                    // Mark as dirty so background worker pushes to Supabase later
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                cache.set(key, value);
                            } else {
                                cache.delete(key);
                            }
                            markDirty(tenantId, key);
                        }
                    }
                },
            },
        },

        saveCreds: async () => {
            cache.set("creds", creds);
            markDirty(tenantId, "creds");
        },
    };
}

// ─── Cleanup Background Sync ──────────────────────────────────────────
export function stopBackgroundSync(tenantId: string): void {
    const interval = flushIntervals.get(tenantId);
    if (interval) {
        clearInterval(interval);
        flushIntervals.delete(tenantId);
        console.log(`[${tenantId}] ⏹️ Background sync interval stopped.`);
    }
}

// ─── Cleanup: wipe only WhatsApp crypto/auth keys (preserve conversations) ───
// Call this before starting a fresh QR session to avoid "can't link device" errors.
// Unlike clearSessionData, this does NOT delete conversations or messages.
export async function clearAuthState(tenantId: string): Promise<void> {
    stopBackgroundSync(tenantId);
    if (sessionCache.has(tenantId)) sessionCache.get(tenantId)!.clear();
    if (dirtyKeys.has(tenantId)) dirtyKeys.get(tenantId)!.clear();
    // Delete all session rows EXCEPT LID mappings (lid_*) and contacts cache,
    // which are expensive to rebuild and not auth-related.
    await getSupabase()
        .from("whatsapp_sessions")
        .delete()
        .eq("tenant_id", tenantId)
        .not("session_key", "like", "lid_%")
        .neq("session_key", "contacts");
    console.log(`[${tenantId}] 🔑 Auth state cleared (crypto keys wiped, LID mappings + contacts preserved).`);
}

// ─── Cleanup: remove all session data for a tenant ────────────────────
export async function clearSessionData(tenantId: string): Promise<void> {
    // 1. Stop background worker
    stopBackgroundSync(tenantId);

    // 2. Clear local RAM caches
    if (sessionCache.has(tenantId)) sessionCache.get(tenantId)!.clear();
    if (dirtyKeys.has(tenantId)) dirtyKeys.get(tenantId)!.clear();

    // 3. Wipe database
    await getSupabase()
        .from("whatsapp_sessions")
        .delete()
        .eq("tenant_id", tenantId);

    // 4. Wipe all conversations (and cascaded messages)
    await getSupabase()
        .from("conversations")
        .delete()
        .eq("tenant_id", tenantId);

    console.log(`[${tenantId}] 🧹 Session data completely wiped.`);
}
