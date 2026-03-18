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

        // 4. Try Cloud API first, fallback to Baileys session-manager
        const cloudConfig = await getCloudConfigByTenantId(tenantId);

        if (cloudConfig) {
            // ── Cloud API path ──
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
        }

        // ── Baileys fallback (legacy) ──
        const jid = phone_number.includes("-")
            ? `${phone_number}@g.us`
            : `${phone_number}@s.whatsapp.net`;

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
        return NextResponse.json({ ...data, via: "baileys" });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
