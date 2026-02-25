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

    // Only keep conversations that have at least one reply (from owner or assistant)
    let chatsToProcess = "";
    for (const [convId, msgs] of conversationsMap.entries()) {
        const hasReply = msgs.some(m => m.role === "owner" || m.role === "assistant");
        if (!hasReply) continue;

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
Your task is to review recent WhatsApp conversations between the business OWNER, the AI ASSISTANT, and customers (USER). 

YOUR GOALS:
1. NEW FACTS: Extract NEW, repeatable business facts perfectly suited for a customer support AI based on OWNER replies.
2. MISTAKE CORRECTION: If the ASSISTANT made a mistake or gave incorrect/incomplete info that frustrated the USER or required OWNER intervention, synthesize a rule to prevent this mistake in the future.
3. KNOWLEDGE MANAGEMENT: Review the "EXISTING KNOWLEDGE BASE". You must manage it to prevent duplicates.
   - If a new fact contradicts existing knowledge, UPDATE the existing record.
   - If an existing fact is wrong or obsolete based on recent chats, UPDATE or DELETE it.
   - DO NOT add a duplicate if the knowledge already covers it.

CRITICAL RULES:
1. ONLY extract concrete, universal business facts (e.g., prices, business hours, addresses, core policies, recurring product details).
2. 🚨 ABSOLUTELY DO NOT extract small talk, personal info, greetings, emojis, individual meeting times, or single-case arrangements. IGNORE IT ENTIRELY.
3. Output your findings as a strict JSON array of objects. Each object represents an action to perform on the knowledge base:
   - "action": MUST be "add", "update", or "delete".
   - "id": Required ONLY for "update" or "delete". Must match the EXACT ID from the EXISTING KNOWLEDGE BASE.
   - "question": (Required for add/update) A generic version of the topic.
   - "answer": (Required for add/update) The factual rule/answer derived.
   - "category": (Required for add/update) e.g., "pricing", "policy", "general"

Example output:
[
  { "action": "add", "question": "What are your hours?", "answer": "9 AM to 5 PM.", "category": "general" },
  { "action": "update", "id": "123e4567-e89b-12d3...", "question": "Delivery fee?", "answer": "Now $10 instead of $5.", "category": "pricing" },
  { "action": "delete", "id": "987fcdeb-51a2-43d7..." }
]

Output ONLY valid JSON, starting with [ and ending with ]. No markdown blocks. Return [] if nothing should change.

--- EXISTING KNOWLEDGE BASE ---
${existingKnowledgeStr || "(Empty)"}
`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `--- RECENT CONVERSATIONS ---\n${chatsToProcess}` }
    ];

    try {
        const completion = await getOpenAI().chat.completions.create({
            model: "deepseek-chat",
            messages: messages as any,
            max_tokens: 1500,
            temperature: 0.1, // Keep it deterministic
            response_format: { type: "json_object" }
        });

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
        for (const actionRow of extractedActions) {
            if (actionRow.action === "add" && actionRow.question && actionRow.answer) {
                const { error } = await supabase.from("knowledge_base").insert({
                    tenant_id: tenantId,
                    category: actionRow.category || "learned",
                    question: actionRow.question,
                    answer: actionRow.answer,
                    source: "learned"
                });
                if (!error) {
                    processedCount++;
                    console.log(`[${tenantId}] 💡 Added new fact: Q: ${actionRow.question}`);
                } else console.error(`[${tenantId}] Add error:`, error);
            }
            else if (actionRow.action === "update" && actionRow.id && actionRow.question && actionRow.answer) {
                const { error } = await supabase.from("knowledge_base").update({
                    category: actionRow.category,
                    question: actionRow.question,
                    answer: actionRow.answer,
                    updated_at: new Date().toISOString()
                }).eq("id", actionRow.id).eq("tenant_id", tenantId);
                if (!error) {
                    processedCount++;
                    console.log(`[${tenantId}] ✏️ Updated fact ID: ${actionRow.id}`);
                } else console.error(`[${tenantId}] Update error:`, error);
            }
            else if (actionRow.action === "delete" && actionRow.id) {
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
