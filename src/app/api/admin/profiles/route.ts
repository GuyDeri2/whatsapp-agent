import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Verify the caller is a logged-in admin, then use the service-role client
// for the actual data operations so RLS doesn't filter out other users' profiles.

async function verifyAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    return profile?.role === "admin" ? user : null;
}

export async function GET() {
    const admin = await verifyAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: profiles, error } = await getSupabaseAdmin()
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ profiles });
}

export async function PATCH(req: NextRequest) {
    const admin = await verifyAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { profileId, approval_status } = body;

    if (!profileId || !["approved", "rejected", "pending"].includes(approval_status)) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { error } = await getSupabaseAdmin()
        .from("profiles")
        .update({ approval_status })
        .eq("id", profileId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
}
