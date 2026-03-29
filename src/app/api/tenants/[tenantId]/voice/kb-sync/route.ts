/**
 * Knowledge Base sync to ElevenLabs: POST triggers a full sync of
 * the tenant's knowledge_base entries to their ElevenLabs agent.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
    createKBDocument,
    deleteKBDocument,
} from "@/lib/elevenlabs";
import { syncKnowledgeBaseToVoiceAgent } from "@/lib/voice-agent-setup";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    // Verify ownership and voice enabled
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id, elevenlabs_agent_id, voice_enabled")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!tenant) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!tenant.elevenlabs_agent_id) {
        return NextResponse.json({ error: "Voice agent not set up" }, { status: 400 });
    }

    let body: { action: string; itemId?: string; question?: string; answer?: string; oldElevenlabsKbId?: string } | undefined;
    try {
        body = await req.json();
    } catch {
        body = undefined;
    }

    const admin = getSupabaseAdmin();

    try {
        if (body?.action === "create" && body.question && body.answer) {
            // Create a new KB doc in ElevenLabs
            const kbId = await createKBDocument({ name: body.question, text: body.answer });
            if (body.itemId) {
                await admin
                    .from("knowledge_base")
                    .update({ elevenlabs_kb_id: kbId })
                    .eq("id", body.itemId)
                    .eq("tenant_id", tenantId);
            }
        } else if (body?.action === "update" && body.question && body.answer) {
            // Delete old doc, create new doc
            if (body.oldElevenlabsKbId) {
                await deleteKBDocument(body.oldElevenlabsKbId);
            }
            const kbId = await createKBDocument({ name: body.question, text: body.answer });
            if (body.itemId) {
                await admin
                    .from("knowledge_base")
                    .update({ elevenlabs_kb_id: kbId })
                    .eq("id", body.itemId)
                    .eq("tenant_id", tenantId);
            }
        } else if (body?.action === "delete" && body.oldElevenlabsKbId) {
            // Delete doc from ElevenLabs
            await deleteKBDocument(body.oldElevenlabsKbId);
        }

        // Always sync agent references after any KB change
        await syncKnowledgeBaseToVoiceAgent(tenantId);

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("KB sync to ElevenLabs error:", err);
        return NextResponse.json(
            { error: "Failed to sync knowledge base to voice agent" },
            { status: 500 }
        );
    }
}
