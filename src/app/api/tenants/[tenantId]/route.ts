/**
 * API route: Single tenant operations (update, delete).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/tenants/[tenantId] — update tenant
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;
    const body = await req.json();

    const allowedFields = [
        "business_name",
        "description",
        "products",
        "target_customers",
        "agent_mode",
        "agent_prompt",
        "agent_filter_mode",
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
        if (body[field] !== undefined) {
            updates[field] = body[field];
        }
    }

    const { data: tenant, error } = await supabase
        .from("tenants")
        .update(updates)
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .select()
        .single();

    if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });

    if (!tenant)
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    return NextResponse.json({ tenant });
}

// DELETE /api/tenants/[tenantId] — delete tenant
export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    const { error } = await supabase
        .from("tenants")
        .delete()
        .eq("id", tenantId)
        .eq("owner_id", user.id);

    if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
}
