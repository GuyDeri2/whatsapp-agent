/**
 * API route: Manage tenants (CRUD).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });

    if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ tenants });
}

// POST /api/tenants — create a new tenant
export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { business_name, description, products, target_customers } = body;

    if (!business_name) {
        return NextResponse.json(
            { error: "Business name is required" },
            { status: 400 }
        );
    }

    const { data: tenant, error } = await supabase
        .from("tenants")
        .insert({
            owner_id: user.id,
            business_name,
            description: description || null,
            products: products || null,
            target_customers: target_customers || null,
            agent_mode: "paused",
        })
        .select()
        .single();

    if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ tenant }, { status: 201 });
}
