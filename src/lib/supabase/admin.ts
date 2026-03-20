import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy-initialised admin client — avoids crashing at build time
// when env vars aren't present yet.
let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (!_admin) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
            throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
        }
        _admin = createClient(url, key);
    }
    return _admin;
}
