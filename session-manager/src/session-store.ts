/**
 * Supabase-backed auth state store for Baileys with In-Memory Cache & Batch Sync.
 * Solves "PreKeyError" corruption by instantly resolving crypto key reads/writes 
 * in memory, while persisting to Supabase in robust periodic batches holding the Event Loop steady.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
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
async function flushCacheToDB(tenantId: string) {
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
            upsertPayload.push({
                tenant_id: tenantId,
                session_key: key,
                session_data: JSON.parse(JSON.stringify(cache.get(key), BufferJSON.replacer)),
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
    const { data: allRows, error } = await getSupabase()
        .from("whatsapp_sessions")
        .select("session_key, session_data")
        .eq("tenant_id", tenantId);

    if (error) {
        console.error(`[${tenantId}] Error loading existing session keys:`, error);
    } else if (allRows) {
        for (const row of allRows) {
            cache.set(row.session_key, JSON.parse(JSON.stringify(row.session_data), BufferJSON.reviver));
        }
        console.log(`[${tenantId}] ✅ Loaded ${allRows.length} keys into RAM cache.`);
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

// ─── Cleanup: remove all session data for a tenant ────────────────────
export async function clearSessionData(tenantId: string): Promise<void> {
    // 1. Stop background worker
    const interval = flushIntervals.get(tenantId);
    if (interval) {
        clearInterval(interval);
        flushIntervals.delete(tenantId);
    }

    // 2. Clear local RAM caches
    if (sessionCache.has(tenantId)) sessionCache.get(tenantId)!.clear();
    if (dirtyKeys.has(tenantId)) dirtyKeys.get(tenantId)!.clear();

    // 3. Wipe database
    await getSupabase()
        .from("whatsapp_sessions")
        .delete()
        .eq("tenant_id", tenantId);

    console.log(`[${tenantId}] 🧹 Session data completely wiped.`);
}
