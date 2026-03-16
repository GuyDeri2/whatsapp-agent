import OpenAI from "openai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _openai: OpenAI | null = null;
let _supabase: SupabaseClient | null = null;

function getOpenAI(): OpenAI {
    if (!_openai)
        _openai = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY!,
            baseURL: "https://api.deepseek.com",
        });
    return _openai;
}

function getSupabase(): SupabaseClient {
    if (!_supabase)
        _supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    return _supabase;
}

interface ChatMessage {
    role: "user" | "assistant" | "owner";
    content: string;
    created_at: string;
}

interface KnowledgeEntry {
    question: string;
    answer: string;
    category: string;
}

export async function runBatchLearning(tenantId: string, hoursBack: number = 24): Promise<any> {
    const supabase = getSupabase();
    console.log(`[${tenantId}] 🧠 Starting batch learning for the last ${hoursBack} hours...`);

    // 1. Get tenant info
    const { data: tenant } = await supabase
        .from("tenants")
        .select("business_name, description, products, target_customers")
        .eq("id", tenantId)
        .single();

    if (!tenant) throw new Error("Tenant not found");

    // 2. Fetch conversations that had activity in the last X hours
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    // We only want conversations where the owner actually participated
    const { data: recentMessages, error: msgError } = await supabase
        .from("messages")
        .select("conversation_id, role, content, created_at, conversations!inner(phone_number, contact_name)")
        .eq("conversations.tenant_id", tenantId)
        .gte("created_at", since)
        .order("conversation_id", { ascending: true })
        .order("created_at", { ascending: true });

    if (msgError) {
        console.error(`[${tenantId}] Error fetching recent messages:`, msgError);
        return { success: false, error: msgError };
    }

    if (!recentMessages || recentMessages.length === 0) {
        console.log(`[${tenantId}] 🤷‍♂️ No new messages to learn from.`);
        return { success: true, learned_items: 0 };
    }

    // Group by conversation
    const conversationsMap = new Map<string, typeof recentMessages>();
    for (const msg of recentMessages) {
        if (!conversationsMap.has(msg.conversation_id)) {
            conversationsMap.set(msg.conversation_id, []);
        }
        conversationsMap.get(msg.conversation_id)!.push(msg);
    }

    // Only keep conversations where the OWNER manually replied.
    // Using "assistant" here would cause the engine to learn from its own AI responses —
    // a feedback loop that amplifies hallucinations over time.
    let chatsToProcess = "";
    for (const [convId, msgs] of conversationsMap.entries()) {
        const hasOwnerReply = msgs.some(m => m.role === "owner");
        if (!hasOwnerReply) continue;

        const convInfo = msgs[0].conversations as any;
        chatsToProcess += `\n--- Conversation with ${convInfo?.contact_name || convInfo?.phone_number || "Customer"} ---\n`;
        for (const m of msgs) {
            chatsToProcess += `[${m.role.toUpperCase()}]: ${m.content}\n`;
        }
    }

    if (!chatsToProcess) {
        console.log(`[${tenantId}] 🤷‍♂️ No replied conversations to learn from.`);
        return { success: true, learned_items: 0 };
    }

    // 3. Get existing knowledge
    const { data: knowledge } = await supabase
        .from("knowledge_base")
        .select("id, question, answer, category, source")
        .eq("tenant_id", tenantId);

    const existingKnowledgeStr = (knowledge || [])
        .map(k => `- ID: ${k.id} | [${k.category || 'general'}] ${k.question || 'Fact'}: ${k.answer} (Source: ${k.source})`)
        .join("\n");

    // 4. Ask DeepSeek to extract new facts and correct mistakes
    const systemPrompt = `You are an expert business analyst and AI knowledge manager for a business named "${tenant.business_name}".
Your task is to review recent WhatsApp conversations and extract ONLY knowledge that will help an AI customer support agent answer future customer questions about this business.

━━━ PHASE 1 — UNDERSTAND THE CONVERSATION ━━━
Before extracting anything, read each conversation fully and ask yourself:
- What is the customer actually asking about?
- Is this a question about the BUSINESS (its services, prices, hours, policies, products)?
  OR is it a personal/situational exchange (scheduling a one-time meeting, small talk, a personal favor)?
- Did the OWNER's reply teach something that ANY future customer could benefit from?

━━━ PHASE 2 — THE UNIVERSAL TEST (apply to every candidate fact) ━━━
Ask: "If a different customer asked the same question tomorrow, would this OWNER answer be correct and applicable?"
- YES → this is a business fact. Extract it.
- NO (it was personal, situational, or a one-time exception) → SKIP IT ENTIRELY.

Examples of what PASSES the universal test:
✅ "Our delivery fee is ₪25 for orders under ₪150"
✅ "We are open Sunday–Thursday 9:00–19:00, closed Friday–Saturday"
✅ "We don't offer refunds on custom orders"
✅ "The small pizza costs ₪49"

Examples of what FAILS the universal test (skip these):
❌ "OK I'll meet you at 14:00 on Thursday" — one-time appointment
❌ "Sure, I can give you a discount this time" — personal exception
❌ "תודה רבה 😊" — small talk / greeting
❌ "Your name is beautiful" — personal remark
❌ Customer's phone number or personal details — private info

━━━ PHASE 3 — KNOWLEDGE MANAGEMENT ━━━
Review the EXISTING KNOWLEDGE BASE before deciding to add:
- If a new fact CONTRADICTS existing knowledge → UPDATE the existing record.
- If an existing fact is WRONG or OBSOLETE based on recent chats → UPDATE or DELETE it.
- If the knowledge ALREADY COVERS this fact → DO NOT add a duplicate.

━━━ OUTPUT FORMAT ━━━
Output a strict JSON array. Each object is one action:
- "action": MUST be "add", "update", or "delete"
- "id": Required ONLY for "update" or "delete" — use the EXACT ID from EXISTING KNOWLEDGE BASE
- "question": (add/update) A generic customer question that this fact answers
- "answer": (add/update) The factual answer, as the business would state it
- "category": (add/update) e.g., "pricing", "hours", "policy", "products", "general"

Example:
[
  { "action": "add", "question": "What are your opening hours?", "answer": "Sunday–Thursday 9:00–19:00, closed Friday–Saturday.", "category": "hours" },
  { "action": "update", "id": "123e4567-e89b-12d3...", "question": "What is the delivery fee?", "answer": "₪25 for orders under ₪150, free above.", "category": "pricing" },
  { "action": "delete", "id": "987fcdeb-51a2-43d7..." }
]

Output ONLY valid JSON starting with [ and ending with ]. No markdown. Return [] if nothing should change.

--- EXISTING KNOWLEDGE BASE ---
${existingKnowledgeStr || "(Empty)"}
`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `--- RECENT CONVERSATIONS ---\n${chatsToProcess}` }
    ];

    const AI_TIMEOUT_MS = 60_000; // Learning extraction can be longer due to larger payloads
    try {
        const completion = await Promise.race([
            getOpenAI().chat.completions.create({
                model: "deepseek-chat",
                messages: messages as any,
                max_tokens: 1500,
                temperature: 0.1, // Keep it deterministic
                // Note: no response_format here — json_object mode forces a {} wrapper
                // which conflicts with our [] array instruction. We parse raw text instead.
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("AI learning timeout after 60s")), AI_TIMEOUT_MS)
            ),
        ]);

        const reply = completion.choices[0]?.message?.content?.trim() || "[]";

        let extractedActions: any[] = [];
        try {
            const parsed = JSON.parse(reply);
            if (Array.isArray(parsed)) {
                extractedActions = parsed;
            } else if (parsed && Array.isArray(parsed.actions)) {
                extractedActions = parsed.actions;
            } else if (parsed && Array.isArray(parsed.facts)) {
                extractedActions = parsed.facts;
            } else if (parsed && Array.isArray(parsed.knowledge)) {
                extractedActions = parsed.knowledge;
            }
        } catch (e) {
            console.error(`[${tenantId}] Failed to parse DeepSeek JSON response:`, reply);
            return { success: false, error: "Invalid JSON from AI" };
        }

        if (extractedActions.length === 0) {
            console.log(`[${tenantId}] 🧠 DeepSeek found no changes needed.`);
            return { success: true, learned_items: 0 };
        }

        // 5. Execute Actions against Knowledge Base
        let processedCount = 0;

        // Collect all "add" actions and batch-insert in a single query
        const addRows = extractedActions
            .filter((a) => a.action === "add" && a.question && a.answer)
            .map((a) => ({
                tenant_id: tenantId,
                category: a.category || "learned",
                question: a.question,
                answer: a.answer,
                source: "learned",
            }));

        if (addRows.length > 0) {
            const { error } = await supabase.from("knowledge_base").insert(addRows);
            if (!error) {
                processedCount += addRows.length;
                for (const r of addRows) {
                    console.log(`[${tenantId}] 💡 Learned: "${r.question}" → "${r.answer?.substring(0, 60)}"`);
                }
            } else {
                console.error(`[${tenantId}] Batch add error:`, error);
            }
        }

        // Fetch valid IDs for this tenant to verify AI-generated IDs before mutation
        const { data: validFacts } = await supabase
            .from("knowledge_base")
            .select("id")
            .eq("tenant_id", tenantId);
        const validIds = new Set((validFacts ?? []).map((f: any) => f.id));

        // Updates and deletes target specific IDs — keep them individual
        for (const actionRow of extractedActions) {
            if (actionRow.action === "update" && actionRow.id && actionRow.question && actionRow.answer) {
                if (!validIds.has(actionRow.id)) {
                    console.warn(`[${tenantId}] ⚠️ Update skipped — ID ${actionRow.id} not found in knowledge base`);
                    continue;
                }
                const { error } = await supabase.from("knowledge_base").update({
                    category: actionRow.category,
                    question: actionRow.question,
                    answer: actionRow.answer,
                    updated_at: new Date().toISOString()
                }).eq("id", actionRow.id).eq("tenant_id", tenantId);
                if (!error) {
                    processedCount++;
                    console.log(`[${tenantId}] ✏️ Updated: "${actionRow.question}" → "${actionRow.answer?.substring(0, 60)}"`);
                } else console.error(`[${tenantId}] Update error:`, error);
            }
            else if (actionRow.action === "delete" && actionRow.id) {
                if (!validIds.has(actionRow.id)) {
                    console.warn(`[${tenantId}] ⚠️ Delete skipped — ID ${actionRow.id} not found in knowledge base`);
                    continue;
                }
                const { error } = await supabase.from("knowledge_base").delete()
                    .eq("id", actionRow.id).eq("tenant_id", tenantId);
                if (!error) {
                    processedCount++;
                    console.log(`[${tenantId}] 🗑️ Deleted fact ID: ${actionRow.id}`);
                } else console.error(`[${tenantId}] Delete error:`, error);
            }
        }

        return { success: true, learned_items: processedCount, actions: extractedActions };
    } catch (err: any) {
        console.error(`[${tenantId}] AI extraction failed:`, err);
        return { success: false, error: err.message };
    }
}
