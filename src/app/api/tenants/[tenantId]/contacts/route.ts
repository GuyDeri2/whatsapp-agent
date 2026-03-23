import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RULE_TYPES = ["allow", "block"] as const;

function isValidUUID(id: string): boolean {
    return UUID_REGEX.test(id);
}

function sanitizePhoneNumber(raw: string): string | null {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) return null;
    return digits;
}

// GET — list contact rules for a tenant
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;

        if (!isValidUUID(tenantId)) {
            return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 });
        }

        const supabase = await createClient();

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Verify ownership
        const { data: tenant } = await supabase
            .from("tenants")
            .select("owner_id")
            .eq("id", tenantId)
            .single();

        if (!tenant || tenant.owner_id !== user.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { data: rules, error } = await supabase
            .from("contact_rules")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("[contacts/GET] DB error:", error.message);
            return NextResponse.json({ error: "Failed to fetch contact rules" }, { status: 500 });
        }

        return NextResponse.json({ rules });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[contacts/GET] Unexpected error:", message);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// POST — add a contact rule
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;

        if (!isValidUUID(tenantId)) {
            return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 });
        }

        const supabase = await createClient();

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { data: tenant } = await supabase
            .from("tenants")
            .select("owner_id")
            .eq("id", tenantId)
            .single();

        if (!tenant || tenant.owner_id !== user.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await request.json();
        const { phone_number, contact_name, rule_type } = body;

        if (!phone_number || !rule_type) {
            return NextResponse.json(
                { error: "Missing phone_number or rule_type" },
                { status: 400 }
            );
        }

        // Validate rule_type
        if (!VALID_RULE_TYPES.includes(rule_type)) {
            return NextResponse.json(
                { error: "Invalid rule_type. Must be 'allow' or 'block'" },
                { status: 400 }
            );
        }

        // Validate and sanitize phone number
        const sanitizedPhone = sanitizePhoneNumber(String(phone_number));
        if (!sanitizedPhone) {
            return NextResponse.json(
                { error: "Invalid phone number. Must be 9-15 digits" },
                { status: 400 }
            );
        }

        // Sanitize contact_name: trim and limit to 100 chars
        const sanitizedName = contact_name
            ? String(contact_name).trim().slice(0, 100)
            : null;

        const { data, error } = await supabase
            .from("contact_rules")
            .upsert(
                { tenant_id: tenantId, phone_number: sanitizedPhone, contact_name: sanitizedName, rule_type },
                { onConflict: "tenant_id,phone_number" }
            )
            .select()
            .single();

        if (error) {
            console.error("[contacts/POST] DB error:", error.message);
            return NextResponse.json({ error: "Failed to add contact rule" }, { status: 500 });
        }

        return NextResponse.json({ rule: data });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[contacts/POST] Unexpected error:", message);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// DELETE — remove a contact rule
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;

        if (!isValidUUID(tenantId)) {
            return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 });
        }

        const supabase = await createClient();

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { data: tenant } = await supabase
            .from("tenants")
            .select("owner_id")
            .eq("id", tenantId)
            .single();

        if (!tenant || tenant.owner_id !== user.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const ruleId = searchParams.get("id");

        if (!ruleId) {
            return NextResponse.json({ error: "Missing rule id" }, { status: 400 });
        }

        const { data: deleted, error } = await supabase
            .from("contact_rules")
            .delete()
            .eq("id", ruleId)
            .eq("tenant_id", tenantId)
            .select();

        if (error) {
            console.error("[contacts/DELETE] DB error:", error.message);
            return NextResponse.json({ error: "Failed to delete contact rule" }, { status: 500 });
        }

        if (!deleted || deleted.length === 0) {
            return NextResponse.json({ error: "Rule not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[contacts/DELETE] Unexpected error:", message);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
