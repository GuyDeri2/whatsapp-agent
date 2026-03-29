/**
 * Voice agent setup: POST creates an ElevenLabs agent for the tenant.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setupVoiceAgent } from "@/lib/voice-agent-setup";

export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    // Verify ownership
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id, business_name, elevenlabs_agent_id")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!tenant) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (tenant.elevenlabs_agent_id) {
        return NextResponse.json(
            { error: "Voice agent already set up", agent_id: tenant.elevenlabs_agent_id },
            { status: 409 }
        );
    }

    try {
        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://localhost:3000";
        const agentId = await setupVoiceAgent({
            tenantId,
            businessName: tenant.business_name,
            appBaseUrl,
        });

        return NextResponse.json({ agent_id: agentId });
    } catch (err) {
        console.error("Voice agent setup error:", err);
        return NextResponse.json(
            { error: "Failed to set up voice agent" },
            { status: 500 }
        );
    }
}
