/**
 * API route: Proxy requests from the dashboard to the Session Manager service.
 * This keeps the Session Manager URL and API key hidden from the client.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SESSION_MANAGER_URL =
    process.env.SESSION_MANAGER_URL || "http://localhost:3001";
const SESSION_MANAGER_SECRET = process.env.SESSION_MANAGER_SECRET || "";

async function getAuthenticatedUser() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user;
}

// POST /api/sessions/[tenantId]/start
// POST /api/sessions/[tenantId]/stop
// GET  /api/sessions/[tenantId]/status
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string; action: string }> }
) {
    const user = await getAuthenticatedUser();
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId, action } = await params;

    // Verify user owns this tenant
    const supabase = await createClient();
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!tenant)
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));

    const response = await fetch(
        `${SESSION_MANAGER_URL}/sessions/${tenantId}/${action}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SESSION_MANAGER_SECRET}`,
            },
            body: JSON.stringify(body),
        }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string; action: string }> }
) {
    const user = await getAuthenticatedUser();
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId, action } = await params;

    const response = await fetch(
        `${SESSION_MANAGER_URL}/sessions/${tenantId}/${action}`,
        {
            headers: {
                Authorization: `Bearer ${SESSION_MANAGER_SECRET}`,
            },
        }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
}
