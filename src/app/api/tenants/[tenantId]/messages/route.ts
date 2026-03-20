import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCloudConfigByTenantId, sendTextMessage } from "@/lib/whatsapp-cloud";

export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { tenantId } = await params;
        const supabase = await createClient();

        // 1. Authenticate user
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 2. Verify tenant ownership
        const { data: tenant, error: tenantError } = await supabase
            .from("tenants")
            .select("owner_id, connection_type")
            .eq("id", tenantId)
            .single();

        if (tenantError || !tenant || tenant.owner_id !== user.id) {
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

        // 4. Send via the appropriate channel
        let sendResult: { success: boolean; messageId?: string; error?: string; via: string };

        const cloudConfig = await getCloudConfigByTenantId(tenantId);

        if (cloudConfig) {
            // Cloud API path
            const result = await sendTextMessage(cloudConfig, phone_number, text);
            sendResult = { ...result, via: "cloud_api" };
        } else if (tenant.connection_type === "baileys") {
            // Baileys path — send via baileys-service
            const baileysUrl = process.env.BAILEYS_SERVICE_URL;
            const baileysSecret = process.env.SESSION_MANAGER_SECRET;

            if (!baileysUrl || !baileysSecret) {
                return NextResponse.json(
                    { error: "Baileys service not configured" },
                    { status: 500 }
                );
            }

            try {
                const res = await fetch(`${baileysUrl}/sessions/${tenantId}/send`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${baileysSecret}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ to: phone_number, text }),
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    sendResult = { success: false, error: errBody, via: "baileys" };
                } else {
                    sendResult = { success: true, via: "baileys" };
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Unknown error";
                sendResult = { success: false, error: msg, via: "baileys" };
            }
        } else {
            return NextResponse.json(
                { error: "WhatsApp לא מחובר לעסק זה" },
                { status: 400 }
            );
        }

        if (!sendResult.success) {
            return NextResponse.json(
                { error: sendResult.error || "Failed to send message" },
                { status: 502 }
            );
        }

        // Store the owner's message in DB
        const admin = getSupabaseAdmin();

        // Find or create conversation
        const { data: conversation } = await admin
            .from("conversations")
            .upsert(
                {
                    tenant_id: tenantId,
                    phone_number,
                    is_group: false,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "tenant_id,phone_number" }
            )
            .select("id")
            .single();

        if (conversation) {
            await admin.from("messages").insert({
                conversation_id: conversation.id,
                tenant_id: tenantId,
                role: "owner",
                content: text,
                is_from_agent: false,
                wa_message_id: sendResult.messageId ?? null,
                status: "sent",
            });

            // Pause the conversation — owner is handling manually
            await admin
                .from("conversations")
                .update({ is_paused: true })
                .eq("id", conversation.id);
        }

        return NextResponse.json({
            success: true,
            messageId: sendResult.messageId ?? null,
            via: sendResult.via,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
