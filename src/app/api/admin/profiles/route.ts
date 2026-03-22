import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Verify the caller is a logged-in admin, then use the service-role client
// for the actual data operations so RLS doesn't filter out other users' profiles.

async function verifyAdmin() {
    // Use the SSR client only to authenticate the caller (cookie-based).
    // Then use the service-role admin client to read the profile so that
    // the self-referential RLS policy on `profiles` doesn't cause infinite
    // recursion and return an empty row for legitimate admins.
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

export async function GET() {
    const admin = await verifyAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: profiles, error } = await getSupabaseAdmin()
        .from("profiles")
        .select("id, email, first_name, last_name, role, approval_status, created_at")
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

export async function DELETE(req: NextRequest) {
    const admin = await verifyAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { profileId } = body;

    if (!profileId || typeof profileId !== "string") {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    // Prevent self-deletion
    if (profileId === admin.id) {
        return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    const adminClient = getSupabaseAdmin();
    const { error } = await adminClient.auth.admin.deleteUser(profileId);

    if (error) {
        // If user doesn't exist in auth.users, clean up orphaned profile + tenants directly
        const { error: profileDeleteError } = await adminClient
            .from("profiles")
            .delete()
            .eq("id", profileId);

        // Also clean up any tenants owned by this user (CASCADE will handle child tables)
        await adminClient.from("tenants").delete().eq("owner_id", profileId);

        if (profileDeleteError) {
            return NextResponse.json({ error: profileDeleteError.message }, { status: 500 });
        }
    }

    return NextResponse.json({ success: true });
}
