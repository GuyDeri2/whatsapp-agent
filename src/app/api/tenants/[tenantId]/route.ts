/**
 * API route: Single tenant operations (update, delete).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_AGENT_MODES = ["learning", "active", "paused"] as const;
const VALID_FILTER_MODES = ["all", "whitelist", "blacklist"] as const;

// Field-level type validators for PATCH updates
const fieldValidators: Record<string, (v: unknown) => boolean> = {
    business_name: (v) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= 200,
    description: (v) => v === null || (typeof v === "string" && v.length <= 5000),
    products: (v) => v === null || (typeof v === "string" && v.length <= 5000),
    target_customers: (v) => v === null || (typeof v === "string" && v.length <= 5000),
    agent_mode: (v) => typeof v === "string" && (VALID_AGENT_MODES as readonly string[]).includes(v),
    agent_prompt: (v) => v === null || (typeof v === "string" && v.length <= 10000),
    agent_filter_mode: (v) => typeof v === "string" && (VALID_FILTER_MODES as readonly string[]).includes(v),
    agent_respond_to_saved_contacts: (v) => typeof v === "boolean",
    owner_phone: (v) => v === "" || (typeof v === "string" && v.length <= 20),
    lead_webhook_url: (v) => v === null || v === "" || (typeof v === "string" && v.length <= 500),
    handoff_collect_email: (v) => typeof v === "boolean",
    website_url: (v) => v === null || v === "" || (typeof v === "string" && v.length <= 500),
    // setup_completed: client-editable because the onboarding wizard sets it after the user finishes setup steps
    setup_completed: (v) => typeof v === "boolean",
};

const allowedFields = Object.keys(fieldValidators);

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

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
        if (body[field] !== undefined) {
            const validator = fieldValidators[field];
            if (!validator(body[field])) {
                return NextResponse.json(
                    { error: `Invalid value for field: ${field}` },
                    { status: 400 }
                );
            }
            updates[field] = body[field];
        }
    }

    // Reject empty updates
    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Normalize owner_phone before saving
    if (updates.owner_phone !== undefined && updates.owner_phone !== "") {
        let digits = String(updates.owner_phone).replace(/[^\d]/g, "");
        if (digits.startsWith("0") && digits.length === 10) {
            digits = "972" + digits.substring(1);
        }
        // Validate minimum length (9 digits) after normalization
        if (digits.length > 0 && digits.length < 9) {
            return NextResponse.json(
                { error: "Phone number must be at least 9 digits" },
                { status: 400 }
            );
        }
        updates.owner_phone = digits;
    }

    const { data: tenant, error } = await supabase
        .from("tenants")
        .update(updates)
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .select()
        .single();

    if (error) {
        // PGRST116 = no rows found — tenant doesn't exist or not owned by user
        if (error.code === "PGRST116") {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }
        return NextResponse.json({ error: "Failed to update tenant" }, { status: 500 });
    }

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

    const { data, error } = await supabase
        .from("tenants")
        .delete()
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .select("id")
        .single();

    if (error) {
        if (error.code === "PGRST116") {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }
        return NextResponse.json({ error: "Failed to delete tenant" }, { status: 500 });
    }

    if (!data) {
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
