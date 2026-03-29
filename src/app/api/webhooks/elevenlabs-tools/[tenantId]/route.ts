/**
 * Webhook endpoint for ElevenLabs agent tools (e.g. send SMS).
 * ElevenLabs calls this during a voice conversation when the agent invokes a tool.
 * Validated via x-webhook-secret header against the tenant's voice_webhook_secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { twilioService } from "@/lib/twilio";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;
    const secret = req.headers.get("x-webhook-secret");

    const supabase = getSupabaseAdmin();
    const { data: tenant } = await supabase
        .from("tenants")
        .select("voice_webhook_secret")
        .eq("id", tenantId)
        .single();

    // Validate webhook secret
    if (tenant?.voice_webhook_secret && tenant.voice_webhook_secret !== secret) {
        return NextResponse.json(
            { error: "Unauthorized webhook call" },
            { status: 401 }
        );
    }

    let body: { phone_number?: string; message?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { phone_number, message } = body;

    if (!phone_number || !message) {
        return NextResponse.json(
            { error: "phone_number and message are required" },
            { status: 400 }
        );
    }

    try {
        await twilioService.sendSms(phone_number, message);
        return NextResponse.json({ message: "SMS sent successfully" });
    } catch (err) {
        console.error("elevenlabs-tools send-sms error:", err);
        return NextResponse.json({ error: "Could not send SMS at this time" });
    }
}
