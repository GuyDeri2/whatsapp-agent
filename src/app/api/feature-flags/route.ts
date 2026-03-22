import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET — returns only enabled tab keys (for tenant dashboard)
export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
        .from("feature_flags")
        .select("key, enabled")
        .eq("enabled", true);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const enabledKeys = (data || []).map((f) => f.key);
    return NextResponse.json({ enabledTabs: enabledKeys });
}
