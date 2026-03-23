import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function verifyAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await getSupabaseAdmin()
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    return profile?.role === "admin" ? user : null;
}

// GET — read all feature flags (admin only for the admin panel)
export async function GET() {
    const admin = await verifyAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await getSupabaseAdmin()
        .from("feature_flags")
        .select("key, enabled, label, updated_at")
        .order("key");

    if (error) {
        console.error("[admin/feature-flags GET]", error.message);
        return NextResponse.json({ error: "Failed to fetch feature flags" }, { status: 500 });
    }
    return NextResponse.json({ flags: data });
}

// PATCH — toggle a feature flag
export async function PATCH(req: NextRequest) {
    const admin = await verifyAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { key, enabled } = await req.json();

    if (!key || typeof enabled !== "boolean") {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { error, count } = await getSupabaseAdmin()
        .from("feature_flags")
        .update({ enabled, updated_at: new Date().toISOString() }, { count: "exact" })
        .eq("key", key);

    if (error) {
        console.error("[admin/feature-flags PATCH]", error.message);
        return NextResponse.json({ error: "Failed to update feature flag" }, { status: 500 });
    }

    if (count === 0) {
        return NextResponse.json({ error: "Feature flag not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
