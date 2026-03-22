/**
 * Admin API: Manage tenant website scan limits.
 * POST /api/admin/tenant-scans — grant bonus scans to a tenant
 */

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

// POST — Grant +10 bonus scans to a tenant
export async function POST(req: NextRequest) {
    const admin = await verifyAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { tenant_id } = body;

    if (!tenant_id) {
        return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Get current bonus
    const { data: tenant, error: fetchError } = await supabaseAdmin
        .from("tenants")
        .select("id, business_name, website_scans_bonus, website_scans_used, website_scans_month")
        .eq("id", tenant_id)
        .single();

    if (fetchError || !tenant) {
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const currentBonus = tenant.website_scans_bonus ?? 0;
    const newBonus = currentBonus + 10;

    const { error: updateError } = await supabaseAdmin
        .from("tenants")
        .update({ website_scans_bonus: newBonus })
        .eq("id", tenant_id);

    if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
        success: true,
        tenant_id,
        business_name: tenant.business_name,
        new_bonus: newBonus,
        total_limit: 10 + newBonus,
        scans_used: tenant.website_scans_used ?? 0,
    });
}
