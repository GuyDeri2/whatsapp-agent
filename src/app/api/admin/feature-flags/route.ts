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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

    const { error } = await getSupabaseAdmin()
        .from("feature_flags")
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq("key", key);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
