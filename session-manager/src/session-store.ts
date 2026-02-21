/**
 * Supabase-backed auth state store for Baileys.
 * Replaces the default file-based `useMultiFileAuthState` with a DB-backed version
 * so sessions persist across server restarts and can be managed per tenant.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
    AuthenticationCreds,
    AuthenticationState,
    SignalDataTypeMap,
    initAuthCreds,
    proto,
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

// ─── Helper: read a single key ────────────────────────────────────────
async function readKey(tenantId: string, key: string): Promise<any | null> {
    const { data } = await getSupabase()
        .from("whatsapp_sessions")
        .select("session_data")
        .eq("tenant_id", tenantId)
        .eq("session_key", key)
        .single();

    if (!data) return null;
    return JSON.parse(JSON.stringify(data.session_data), BufferJSON.reviver);
}

// ─── Helper: write a single key ───────────────────────────────────────
async function writeKey(
    tenantId: string,
    key: string,
    value: any
): Promise<void> {
    const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));

    await getSupabase().from("whatsapp_sessions").upsert(
        {
            tenant_id: tenantId,
            session_key: key,
            session_data: serialized,
        },
        { onConflict: "tenant_id,session_key" }
    );
}

// ─── Helper: delete a single key ──────────────────────────────────────
async function deleteKey(tenantId: string, key: string): Promise<void> {
    await getSupabase()
        .from("whatsapp_sessions")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("session_key", key);
}

// ─── Main export ──────────────────────────────────────────────────────
export async function useSupabaseAuthState(
    tenantId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    // Load or initialise creds
    let creds: AuthenticationCreds =
        (await readKey(tenantId, "creds")) ?? initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async <T extends keyof SignalDataTypeMap>(
                    type: T,
                    ids: string[]
                ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
                    const result: { [id: string]: SignalDataTypeMap[T] } = {};
                    for (const id of ids) {
                        const value = await readKey(tenantId, `${type}-${id}`);
                        if (value) {
                            // Handle pre-key special case
                            if (type === "pre-key") {
                                result[id] = value;
                            } else {
                                result[id] = value;
                            }
                        }
                    }
                    return result;
                },

                set: async (data: any): Promise<void> => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                await writeKey(tenantId, key, value);
                            } else {
                                await deleteKey(tenantId, key);
                            }
                        }
                    }
                },
            },
        },

        saveCreds: async () => {
            await writeKey(tenantId, "creds", creds);
        },
    };
}

// ─── Cleanup: remove all session data for a tenant ────────────────────
export async function clearSessionData(tenantId: string): Promise<void> {
    await getSupabase()
        .from("whatsapp_sessions")
        .delete()
        .eq("tenant_id", tenantId);
}
