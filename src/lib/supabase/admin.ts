import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy-initialised admin client — avoids crashing at build time
// when env vars aren't present yet.
let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (!_admin) {
        _admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            process.env.SUPABASE_SERVICE_ROLE_KEY || ""
        );
    }
    return _admin;
}
