/**
 * API route: Conversation operations (update contact_name).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/tenants/[tenantId]/conversations/[conversationId]
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string; conversationId: string }> }
) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId, conversationId } = await params;

    // Verify tenant ownership
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!tenant)
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const body = await req.json();

    // Prepare update object
    const updateData: any = {};

    // Validate contact_name if provided
    if (body.contact_name !== undefined) {
        if (typeof body.contact_name !== "string" || body.contact_name.trim().length === 0) {
            return NextResponse.json({ error: "contact_name is required" }, { status: 400 });
        }
        if (body.contact_name.length > 100) {
            return NextResponse.json({ error: "contact_name too long (max 100)" }, { status: 400 });
        }
        updateData.contact_name = body.contact_name.trim();
        updateData.name_manually_set = true;
    }

    // Validate is_paused if provided
    if (typeof body.is_paused === "boolean") {
        updateData.is_paused = body.is_paused;
    }

    if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: "No valid fields provided to update" }, { status: 400 });
    }

    // Update conversation
    const { data: conversation, error } = await supabase
        .from("conversations")
        .update(updateData)
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .select()
        .single();

    if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });

    if (!conversation)
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    return NextResponse.json({ conversation });
}
