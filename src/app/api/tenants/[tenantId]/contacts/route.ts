import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET — list contact rules for a tenant
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;
        const supabase = await createClient();

        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Verify ownership
        const { data: tenant } = await supabase
            .from("tenants")
            .select("owner_id")
            .eq("id", tenantId)
            .single();

        if (!tenant || tenant.owner_id !== session.user.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { data: rules, error } = await supabase
            .from("contact_rules")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ rules });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST — add a contact rule
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;
        const supabase = await createClient();

        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { data: tenant } = await supabase
            .from("tenants")
            .select("owner_id")
            .eq("id", tenantId)
            .single();

        if (!tenant || tenant.owner_id !== session.user.id) {
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

        const { data, error } = await supabase
            .from("contact_rules")
            .upsert(
                { tenant_id: tenantId, phone_number, contact_name, rule_type },
                { onConflict: "tenant_id,phone_number" }
            )
            .select()
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ rule: data });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE — remove a contact rule
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;
        const supabase = await createClient();

        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { data: tenant } = await supabase
            .from("tenants")
            .select("owner_id")
            .eq("id", tenantId)
            .single();

        if (!tenant || tenant.owner_id !== session.user.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const ruleId = searchParams.get("id");

        if (!ruleId) {
            return NextResponse.json({ error: "Missing rule id" }, { status: 400 });
        }

        const { error } = await supabase
            .from("contact_rules")
            .delete()
            .eq("id", ruleId)
            .eq("tenant_id", tenantId);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
