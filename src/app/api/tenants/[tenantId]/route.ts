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
        "agent_respond_to_saved_contacts",
        "owner_phone",
        "lead_webhook_url",
        "handoff_collect_email",
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
        if (body[field] !== undefined) {
            updates[field] = body[field];
        }
    }

    const smUrl = process.env.SESSION_MANAGER_URL || "http://localhost:3001";
    const smSecret = process.env.SESSION_MANAGER_SECRET || "";

    // Normalize owner_phone before saving
    let phoneWarning: string | null = null;
    if (updates.owner_phone !== undefined && updates.owner_phone !== "") {
        // Normalize: strip non-digits, convert 05x to 972x
        let digits = String(updates.owner_phone).replace(/[^\d]/g, "");
        if (digits.startsWith("0") && digits.length === 10) {
            digits = "972" + digits.substring(1);
        }
        updates.owner_phone = digits;

        // Validate against WhatsApp via session-manager
        try {
            const checkRes = await fetch(
                `${smUrl}/sessions/${tenantId}/check-number?phone=${digits}`,
                { headers: { Authorization: `Bearer ${smSecret}` } }
            );
            if (checkRes.ok) {
                const checkData = await checkRes.json();
                if (checkData.exists === false) {
                    phoneWarning = `המספר ${digits} אינו רשום ב-WhatsApp`;
                }
                // exists === null means no active session — skip warning
            }
        } catch {
            // Non-critical — session-manager unavailable
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

    // Invalidate session-manager's tenant config cache so changes take effect immediately
    try {
        await fetch(
            `${smUrl}/sessions/${tenantId}/invalidate-cache`,
            {
                method: "POST",
                headers: { Authorization: `Bearer ${smSecret}` },
            }
        );
    } catch {
        // Non-critical — cache expires in 30s anyway
    }

    return NextResponse.json({ tenant, phoneWarning });
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

    // Stop and clear the session on the session manager before deleting
    try {
        await fetch(
            `${process.env.SESSION_MANAGER_URL || "http://localhost:3001"}/sessions/${tenantId}/stop`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.SESSION_MANAGER_SECRET || ""}`,
                },
                body: JSON.stringify({ clearData: true }),
            }
        );
    } catch (e) {
        console.error("Failed to stop session manager on tenant delete", e);
    }

    const { error } = await supabase
        .from("tenants")
        .delete()
        .eq("id", tenantId)
        .eq("owner_id", user.id);

    if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
}
