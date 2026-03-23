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

    if (error) {
        console.error("[admin/profiles GET]", error.message);
        return NextResponse.json({ error: "Failed to fetch profiles" }, { status: 500 });
    }

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

    const { error, count } = await getSupabaseAdmin()
        .from("profiles")
        .update({ approval_status }, { count: "exact" })
        .eq("id", profileId);

    if (error) {
        console.error("[admin/profiles PATCH]", error.message);
        return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    if (count === 0) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

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

    // Check target user is not an admin (prevent deleting other admins)
    const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("role")
        .eq("id", profileId)
        .single();

    if (!targetProfile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (targetProfile.role === "admin") {
        return NextResponse.json({ error: "Cannot delete admin accounts" }, { status: 400 });
    }

    // Delete tenants BEFORE profile/auth user (correct order to avoid orphans)
    const { error: tenantsDeleteError } = await adminClient
        .from("tenants")
        .delete()
        .eq("owner_id", profileId);

    if (tenantsDeleteError) {
        console.error("[admin/profiles DELETE] Failed to delete tenants:", tenantsDeleteError.message);
        return NextResponse.json({ error: "Failed to delete user's businesses" }, { status: 500 });
    }

    // Delete auth user (this cascades to profiles via trigger/FK in most setups)
    const { error } = await adminClient.auth.admin.deleteUser(profileId);

    if (error) {
        console.error("[admin/profiles DELETE] Auth deletion failed, cleaning up orphan:", error.message);
        // If user doesn't exist in auth.users, clean up orphaned profile directly
        const { error: profileDeleteError } = await adminClient
            .from("profiles")
            .delete()
            .eq("id", profileId);

        if (profileDeleteError) {
            console.error("[admin/profiles DELETE] Profile cleanup failed:", profileDeleteError.message);
            return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
        }
    }

    return NextResponse.json({ success: true });
}
