import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;
        const supabase = await createClient();

        // 1. Authenticate user
        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 2. Verify tenant ownership
        const { data: tenant, error: tenantError } = await supabase
            .from("tenants")
            .select("owner_id")
            .eq("id", tenantId)
            .single();

        if (tenantError || !tenant || tenant.owner_id !== session.user.id) {
            return NextResponse.json(
                { error: "Forbidden - Not tenant owner" },
                { status: 403 }
            );
        }

        // 3. Parse body
        const body = await request.json();
        const { phone_number, text } = body;

        if (!phone_number || !text) {
            return NextResponse.json(
                { error: "Missing phone_number or text" },
                { status: 400 }
            );
        }

        // Append @s.whatsapp.net or @g.us based on if it's a group
        const jid = phone_number.includes("-") ? `${phone_number}@g.us` : `${phone_number}@s.whatsapp.net`;

        const sessionManagerUrl =
            process.env.SESSION_MANAGER_URL || "http://127.0.0.1:3001";
        const sessionManagerSecret = process.env.SESSION_MANAGER_SECRET || "";

        const res = await fetch(`${sessionManagerUrl}/sessions/${tenantId}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(sessionManagerSecret && {
                    Authorization: `Bearer ${sessionManagerSecret}`,
                }),
            },
            body: JSON.stringify({ jid, text }),
        });

        if (!res.ok) {
            const errorData = await res.json();
            return NextResponse.json(
                { error: errorData.error || "Failed to send message" },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
