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
            .select("owner_id")
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

        // 4. Send via WhatsApp Cloud API
        const cloudConfig = await getCloudConfigByTenantId(tenantId);

        if (!cloudConfig) {
            return NextResponse.json(
                { error: "WhatsApp Cloud API לא מוגדר לעסק זה" },
                { status: 400 }
            );
        }

        const result = await sendTextMessage(cloudConfig, phone_number, text);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Failed to send message via Cloud API" },
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
                wa_message_id: result.messageId,
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
            messageId: result.messageId,
            via: "cloud_api",
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
