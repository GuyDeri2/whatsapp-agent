/**
 * Voice settings API: GET (read) and PATCH (update) voice configuration for a tenant.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateVoiceAgentConfig } from "@/lib/voice-agent-setup";

const VOICE_FIELDS = [
    "elevenlabs_agent_id",
    "elevenlabs_voice_id",
    "voice_settings",
    "voice_first_message",
    "voice_custom_instructions",
    "twilio_phone_number",
    "voice_enabled",
] as const;

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    const { data: tenant, error } = await supabase
        .from("tenants")
        .select(VOICE_FIELDS.join(", "))
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (error || !tenant) {
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    return NextResponse.json({ data: tenant });
}

const fieldValidators: Record<string, (v: unknown) => boolean> = {
    elevenlabs_voice_id: (v) => v === null || (typeof v === "string" && v.length <= 200),
    voice_settings: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
    voice_first_message: (v) => v === null || (typeof v === "string" && v.length <= 2000),
    voice_custom_instructions: (v) => v === null || (typeof v === "string" && v.length <= 10000),
    voice_enabled: (v) => typeof v === "boolean",
};

const allowedFields = Object.keys(fieldValidators);

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Verify ownership
    const { data: existing } = await supabase
        .from("tenants")
        .select("id, elevenlabs_agent_id")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!existing) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
        .from("tenants")
        .update(updates)
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .select(VOICE_FIELDS.join(", "))
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Sync to ElevenLabs if agent exists
    if (existing.elevenlabs_agent_id) {
        try {
            const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://localhost:3000";
            await updateVoiceAgentConfig(tenantId, appBaseUrl);
        } catch (err) {
            console.error("Failed to sync voice config to ElevenLabs:", err);
        }
    }

    return NextResponse.json({ data });
}
