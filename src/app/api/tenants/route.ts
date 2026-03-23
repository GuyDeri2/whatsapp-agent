/**
 * API route: Manage tenants (CRUD).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Explicit column list — avoid exposing all columns with select("*")
const TENANT_LIST_COLUMNS = [
    "id",
    "business_name",
    "description",
    "agent_mode",
    "whatsapp_phone",
    "whatsapp_connected",
    "setup_completed",
    "created_at",
    "updated_at",
].join(", ");

// GET /api/tenants — list user's tenants
export async function GET() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: tenants, error } = await supabase
        .from("tenants")
        .select(TENANT_LIST_COLUMNS)
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });

    if (error)
        return NextResponse.json({ error: "Failed to load tenants" }, { status: 500 });

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, subscription_status, first_name, last_name")
        .eq("id", user.id)
        .single();

    return NextResponse.json({ tenants, profile });
}

// POST /api/tenants — create a new tenant
export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { business_name, description, products, target_customers, website_url } = body as {
        business_name?: string;
        description?: string;
        products?: string;
        target_customers?: string;
        website_url?: string;
    };

    const trimmedName = typeof business_name === "string" ? business_name.trim() : "";

    if (!trimmedName || trimmedName.length > 200) {
        return NextResponse.json(
            { error: "Business name is required (max 200 characters)" },
            { status: 400 }
        );
    }

    const trimmedUrl = typeof website_url === "string" ? website_url.trim() : null;

    const { data: tenant, error } = await supabase
        .from("tenants")
        .insert({
            owner_id: user.id,
            business_name: trimmedName,
            description: (typeof description === "string" ? description.trim() : null) || null,
            products: (typeof products === "string" ? products.trim() : null) || null,
            target_customers: (typeof target_customers === "string" ? target_customers.trim() : null) || null,
            website_url: trimmedUrl || null,
            agent_mode: "paused",
        })
        .select()
        .single();

    if (error)
        return NextResponse.json({ error: "Failed to create tenant" }, { status: 500 });

    return NextResponse.json({ tenant }, { status: 201 });
}
