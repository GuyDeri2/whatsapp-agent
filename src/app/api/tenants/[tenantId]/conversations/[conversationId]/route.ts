/**
 * API route: Conversation operations (update contact_name).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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
    const updateData: Record<string, string | boolean> = {};

    // Validate contact_name if provided
    if (body.contact_name !== undefined) {
        if (typeof body.contact_name !== "string" || body.contact_name.trim().length === 0) {
            return NextResponse.json({ error: "contact_name is required" }, { status: 400 });
        }
        if (body.contact_name.length > 100) {
            return NextResponse.json({ error: "contact_name too long (max 100)" }, { status: 400 });
        }
        // Strip control characters (except common whitespace) and normalize Unicode
        updateData.contact_name = body.contact_name
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
            .normalize("NFC")
            .trim();
        updateData.name_manually_set = true;
    }

    // Validate is_paused if provided
    if (typeof body.is_paused === "boolean") {
        updateData.is_paused = body.is_paused;
    }

    if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: "No valid fields provided to update" }, { status: 400 });
    }

    // Update conversation — use admin client to bypass RLS (ownership already verified above)
    const admin = getSupabaseAdmin();
    const { data: conversation, error } = await admin
        .from("conversations")
        .update(updateData)
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .select()
        .single();

    if (error) {
        console.error(`[conversations/PATCH] Update failed for conversation=${conversationId} tenant=${tenantId}:`, error.message);
        return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
    }

    if (!conversation)
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    return NextResponse.json({ conversation });
}
