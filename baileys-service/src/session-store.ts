/**
 * Supabase-backed auth state store for Baileys.
 *
 * - In-memory cache for all Signal Protocol keys (prevents PreKeyError)
 * - Periodic batch sync to Supabase every 3 seconds (only dirty keys)
 * - AES-256-GCM encryption at rest
 */

import {
    AuthenticationCreds,
    AuthenticationState,
    SignalDataTypeMap,
    initAuthCreds,
    proto,
    BufferJSON,
} from "@whiskeysockets/baileys";
import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";

const SYNC_INTERVAL_MS = 3000;

// ── Encryption helpers ─────────────────────────────────────────────

function getEncryptionKey(): Buffer | null {
    const hex = process.env.SESSION_ENCRYPTION_KEY;
    if (!hex) return null;
    return Buffer.from(hex, "hex");
}

function encrypt(data: string): string {
    const key = getEncryptionKey();
    if (!key) return data;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(data: string): string {
    const key = getEncryptionKey();
    if (!key) return data;
    const parts = data.split(":");
    if (parts.length !== 3) return data; // Not encrypted
    const [ivHex, tagHex, encHex] = parts;
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(encHex, "hex")) + decipher.final("utf8");
}

/**
 * Deserialize session data from Supabase.
 * Handles both text columns (string) and jsonb columns (already-parsed object).
 * The jsonb case is a safety net — migration changes column to text.
 */
function deserializeSessionData(data: unknown): any {
    if (typeof data === "string") {
        // Text column or encrypted data — decrypt then parse
        const decrypted = decrypt(data);
        return JSON.parse(decrypted, BufferJSON.reviver);
    }
    // jsonb column returned a parsed object — roundtrip through JSON to apply BufferJSON reviver
    return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
}

// ── Auth state implementation ──────────────────────────────────────

export async function useSupabaseAuthState(
    supabase: SupabaseClient,
    tenantId: string
): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    clearState: () => Promise<void>;
    stopSync: () => void;
    forceFlush: () => Promise<void>;
}> {
    // In-memory cache: key -> { value, dirty }
    const cache = new Map<string, { value: unknown; dirty: boolean }>();
    let creds: AuthenticationCreds;
    let syncTimer: ReturnType<typeof setInterval> | null = null;

    // ── Load all keys from Supabase into memory ──

    const { data: rows } = await supabase
        .from("whatsapp_sessions")
        .select("session_key, session_data")
        .eq("tenant_id", tenantId);

    const stored = new Map<string, string>();
    for (const row of rows ?? []) {
        stored.set(row.session_key, row.session_data);
    }

    // Load or init creds
    const credsRaw = stored.get("creds");
    if (credsRaw) {
        creds = deserializeSessionData(credsRaw);
    } else {
        creds = initAuthCreds();
    }
    cache.set("creds", { value: creds, dirty: !credsRaw });

    // Load all signal keys into cache
    for (const [key, value] of stored) {
        if (key === "creds") continue;
        try {
            cache.set(key, { value: deserializeSessionData(value), dirty: false });
        } catch {
            // Corrupted key — skip
        }
    }

    // ── Periodic batch sync ──

    async function flushDirty() {
        const dirtyEntries: { tenant_id: string; session_key: string; session_data: string }[] = [];

        for (const [key, entry] of cache) {
            if (!entry.dirty) continue;
            const serialized = JSON.stringify(entry.value, BufferJSON.replacer);
            dirtyEntries.push({
                tenant_id: tenantId,
                session_key: key,
                session_data: encrypt(serialized),
            });
            entry.dirty = false;
        }

        if (dirtyEntries.length === 0) return;

        const { error } = await supabase
            .from("whatsapp_sessions")
            .upsert(dirtyEntries, { onConflict: "tenant_id,session_key" });

        if (error) {
            console.error(`[${tenantId}] Session sync error:`, error.message);
            // Mark entries as dirty again for next sync
            for (const entry of dirtyEntries) {
                const cached = cache.get(entry.session_key);
                if (cached) cached.dirty = true;
            }
        }
    }

    syncTimer = setInterval(flushDirty, SYNC_INTERVAL_MS);

    // ── Baileys AuthenticationState interface ──

    const state: AuthenticationState = {
        creds,
        keys: {
            get: async <T extends keyof SignalDataTypeMap>(
                type: T,
                ids: string[]
            ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
                const result: Record<string, SignalDataTypeMap[T]> = {};
                for (const id of ids) {
                    const key = `${type}-${id}`;
                    const entry = cache.get(key);
                    if (entry) {
                        let value = entry.value;
                        // Handle pre-key deserialization
                        if (type === "pre-key" && value && typeof value === "object") {
                            const v = value as Record<string, unknown>;
                            if (v.keyPair) {
                                // Already in correct format
                            }
                        }
                        result[id] = value as SignalDataTypeMap[T];
                    }
                }
                return result;
            },

            set: async (data: Record<string, Record<string, unknown>>) => {
                for (const [type, entries] of Object.entries(data)) {
                    for (const [id, value] of Object.entries(entries)) {
                        const key = `${type}-${id}`;
                        if (value === null || value === undefined) {
                            cache.delete(key);
                            // Queue deletion
                            supabase
                                .from("whatsapp_sessions")
                                .delete()
                                .eq("tenant_id", tenantId)
                                .eq("session_key", key)
                                .then(() => {});
                        } else {
                            cache.set(key, { value, dirty: true });
                        }
                    }
                }
            },
        },
    };

    // ── Save creds callback ──

    async function saveCreds() {
        const credsEntry = cache.get("creds");
        if (credsEntry) {
            credsEntry.value = creds;
            credsEntry.dirty = true;
        }
    }

    // ── Clear all auth state ──

    async function clearState() {
        cache.clear();
        stopSync();

        const { error } = await supabase
            .from("whatsapp_sessions")
            .delete()
            .eq("tenant_id", tenantId);

        if (error) {
            console.error(`[${tenantId}] Failed to clear session state:`, error.message);
        }
    }

    // ── Stop sync timer ──

    function stopSync() {
        if (syncTimer) {
            clearInterval(syncTimer);
            syncTimer = null;
        }
        // Final flush
        flushDirty().catch(() => {});
    }

    /** Force-flush all dirty entries and await completion */
    async function forceFlush(): Promise<void> {
        await flushDirty();
    }

    return { state, saveCreds, clearState, stopSync, forceFlush };
}
