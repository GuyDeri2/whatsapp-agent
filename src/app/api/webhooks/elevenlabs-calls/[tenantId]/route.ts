/**
 * Webhook endpoint for ElevenLabs conversation completion events.
 * Called when a voice call ends — populates the call_logs table.
 * Validated via x-webhook-secret header against the tenant's voice_webhook_secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { timingSafeEqual } from "crypto";

/** Safely compare two strings in constant time to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Shape of a single transcript entry from ElevenLabs. */
interface TranscriptMessage {
    role: "agent" | "user";
    message: string;
    time_in_call_secs?: number;
}

/** Shape of the ElevenLabs conversation webhook payload. */
interface ElevenLabsConversationWebhook {
    conversation_id: string;
    status: "done" | "failed" | "timeout" | string;
    transcript?: TranscriptMessage[];
    metadata?: Record<string, string>;
    analysis?: {
        summary?: string;
        [key: string]: unknown;
    };
    start_time_unix_secs?: number;
    end_time_unix_secs?: number;
    call_duration_secs?: number;
}

/** Map ElevenLabs status to our call_logs status enum. */
function mapStatus(
    elStatus: string
): "completed" | "missed" | "failed" {
    switch (elStatus) {
        case "done":
            return "completed";
        case "failed":
        case "error":
            return "failed";
        case "timeout":
        case "no-answer":
            return "missed";
        default:
            return "completed";
    }
}

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

    if (!tenant) {
        return NextResponse.json(
            { error: "Tenant not found" },
            { status: 404 }
        );
    }

    // Validate webhook secret using timing-safe comparison
    if (tenant.voice_webhook_secret) {
        if (!secret || !safeCompare(tenant.voice_webhook_secret, secret)) {
            return NextResponse.json(
                { error: "Unauthorized webhook call" },
                { status: 401 }
            );
        }
    }

    let body: ElevenLabsConversationWebhook;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const {
        conversation_id,
        status,
        transcript,
        metadata,
        analysis,
        start_time_unix_secs,
        end_time_unix_secs,
        call_duration_secs,
    } = body;

    if (!conversation_id) {
        return NextResponse.json(
            { error: "conversation_id is required" },
            { status: 400 }
        );
    }

    // Extract caller phone from Twilio metadata (forwarded by ElevenLabs)
    const callerPhone =
        metadata?.caller_phone_number ||
        metadata?.from ||
        metadata?.caller_id ||
        null;

    // Compute timestamps
    const startedAt = start_time_unix_secs
        ? new Date(start_time_unix_secs * 1000).toISOString()
        : new Date().toISOString();
    const endedAt = end_time_unix_secs
        ? new Date(end_time_unix_secs * 1000).toISOString()
        : new Date().toISOString();

    // Duration: prefer explicit field, fall back to timestamp diff
    const durationSeconds =
        call_duration_secs ??
        (start_time_unix_secs && end_time_unix_secs
            ? Math.round(end_time_unix_secs - start_time_unix_secs)
            : null);

    // Summary from ElevenLabs analysis
    const summary = analysis?.summary || null;

    try {
        const { error: insertError } = await supabase
            .from("call_logs")
            .insert({
                tenant_id: tenantId,
                elevenlabs_conversation_id: conversation_id,
                caller_phone: callerPhone,
                started_at: startedAt,
                ended_at: endedAt,
                duration_seconds: durationSeconds,
                status: mapStatus(status),
                summary,
                transcript: transcript || null,
            });

        if (insertError) {
            console.error("elevenlabs-calls insert error:", insertError);
            return NextResponse.json(
                { error: "Failed to save call log" },
                { status: 500 }
            );
        }

        return NextResponse.json({ message: "Call log saved" });
    } catch (err) {
        console.error("elevenlabs-calls unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
