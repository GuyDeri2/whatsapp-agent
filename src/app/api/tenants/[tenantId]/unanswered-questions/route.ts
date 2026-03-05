import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";

// GET /api/tenants/[tenantId]/unanswered-questions
export async function GET(
    req: NextRequest,
    context: { params: Promise<{ tenantId: string }> } // Await the entire params object in Next.js 15
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tenantId } = await context.params;

    // Verify tenant ownership
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!tenant) {
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Find AI responses containing the handoff phrase
    const { data: handoffMessages, error } = await supabase
        .from("messages")
        .select("id, conversation_id, content, created_at, conversations(phone_number, contact_name)")
        .eq("tenant_id", tenantId)
        .eq("role", "assistant")
        .or("content.ilike.*אעביר את השיחה לצוות שלנו*,content.ilike.*אעביר לטיפול אנושי*")
        .order("created_at", { ascending: false })
        .limit(30);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!handoffMessages || handoffMessages.length === 0) {
        return NextResponse.json({ questions: [] });
    }

    // Now for each handoff message, we find the preceding user message in the same conversation
    const unansweredQuestions = [];

    for (const msg of handoffMessages) {
        const { data: previousMsgs } = await supabase
            .from("messages")
            .select("id, content, created_at")
            .eq("conversation_id", msg.conversation_id)
            .eq("role", "user")
            .lt("created_at", msg.created_at) // Before the AI replied
            .order("created_at", { ascending: false })
            .limit(1);

        if (previousMsgs && previousMsgs.length > 0) {
            unansweredQuestions.push({
                id: msg.id, // Using the AI message ID as a unique key
                user_question: previousMsgs[0].content,
                conversation_id: msg.conversation_id,
                date: msg.created_at,
                contact: msg.conversations ? ((msg.conversations as any).contact_name || (msg.conversations as any).phone_number) : "Unknown",
            });
        }
    }

    // Remove duplicates (if the user asked the same thing twice)
    const uniqueQuestions = Array.from(new Map(unansweredQuestions.map(item => [item.user_question, item])).values());

    return NextResponse.json({ questions: uniqueQuestions });
}
