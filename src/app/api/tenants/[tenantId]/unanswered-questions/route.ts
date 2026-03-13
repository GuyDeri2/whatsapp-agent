import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Collect unique conversation IDs from all handoff messages
    const conversationIds = [...new Set(handoffMessages.map((m) => m.conversation_id))];

    // Batch-fetch ALL user messages for those conversations in one query
    const { data: allUserMessages } = await supabase
        .from("messages")
        .select("id, conversation_id, content, created_at")
        .eq("tenant_id", tenantId)
        .eq("role", "user")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true });

    // Group user messages by conversation_id for O(1) lookup
    const userMsgsByConv = new Map<string, { id: string; conversation_id: string; content: string; created_at: string }[]>();
    for (const um of allUserMessages ?? []) {
        if (!userMsgsByConv.has(um.conversation_id)) {
            userMsgsByConv.set(um.conversation_id, []);
        }
        userMsgsByConv.get(um.conversation_id)!.push(um);
    }

    // Map handoff messages back to the preceding user message (newest user msg before the handoff)
    const unansweredQuestions = [];

    for (const msg of handoffMessages) {
        const userMsgs = userMsgsByConv.get(msg.conversation_id) ?? [];
        // Find the latest user message that came before the handoff
        const preceding = [...userMsgs]
            .reverse()
            .find((um) => um.created_at < msg.created_at);

        if (preceding) {
            unansweredQuestions.push({
                id: msg.id, // Using the AI message ID as a unique key
                user_question: preceding.content,
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
