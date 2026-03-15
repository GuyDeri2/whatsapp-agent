/**
 * calendar-providers/index.ts
 * Factory function: returns the active CalendarProvider for a tenant,
 * or null if no calendar integration is configured.
 */

import { createClient } from "@supabase/supabase-js";
import type { CalendarProvider, ProviderName } from "./types";
import { googleCalendarProvider } from "./google";
import { calendlyProvider } from "./calendly";

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

/**
 * Returns the CalendarProvider for the tenant's active calendar integration,
 * or null if none is configured.
 */
export async function getCalendarProvider(
    tenantId: string
): Promise<{ provider: CalendarProvider; name: ProviderName } | null> {
    const { data } = await getSupabase()
        .from("calendar_integrations")
        .select("provider")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!data) return null;

    const name = data.provider as ProviderName;
    switch (name) {
        case "google":
            return { provider: googleCalendarProvider, name };
        case "calendly":
            return { provider: calendlyProvider, name };
        // outlook will be added in a future phase
        default:
            return null;
    }
}

export { type CalendarProvider, type ProviderName } from "./types";
