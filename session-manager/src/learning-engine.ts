import OpenAI from "openai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _openai: OpenAI | null = null;
let _supabase: SupabaseClient | null = null;

function getOpenAI(): OpenAI {
    if (!_openai) {
        if (!process.env.DEEPSEEK_API_KEY) {
            throw new Error("DEEPSEEK_API_KEY is not set");
        }
        _openai = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: "https://api.deepseek.com",
        });
    }
    return _openai;
}

function getSupabase(): SupabaseClient {
    if (!_supabase) {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
        }
        _supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
    }
    return _supabase;
}

interface ChatMessage {
    role: "user" | "assistant" | "owner";
    content: string;
    created_at: string;
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
    // Use messages.tenant_id directly (indexed) instead of joining through conversations.tenant_id
    const { data: recentMessages, error: msgError } = await supabase
        .from("messages")
        .select("conversation_id, role, content, created_at, conversations!inner(phone_number, contact_name)")
        .eq("tenant_id", tenantId)
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

    // 3. Get current agent_prompt (capabilities) to avoid duplicates
    const { data: tenantFull } = await supabase
        .from("tenants")
        .select("agent_prompt")
        .eq("id", tenantId)
        .single();

    const currentCapabilities = tenantFull?.agent_prompt || "";

    // 4. Ask DeepSeek to extract new business facts from owner conversations
    const systemPrompt = `You are an expert business analyst for a business named "${tenant.business_name}".
Your task is to review recent WhatsApp conversations where the business OWNER replied manually, and extract ONLY business knowledge that will help an AI customer support agent.

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

━━━ PHASE 3 — CHECK EXISTING CAPABILITIES ━━━
The agent already has these capabilities/knowledge. DO NOT add duplicates:

${currentCapabilities || "(Empty — no capabilities yet)"}

━━━ OUTPUT FORMAT ━━━
Output ONLY the NEW facts to add, as a plain text list in Hebrew. Each line is one fact.
Write them as clear, concise statements that an AI agent can use to answer customers.
Format: one fact per line, starting with "- ".

Example output:
- דמי משלוח: ₪25 להזמנות מתחת ל-₪150, חינם מעל
- שעות פעילות: א-ה 9:00-19:00, סגור בשישי-שבת
- אין החזרים על הזמנות מותאמות אישית

If there are no new facts to add, output exactly: NONE

Output ONLY the list or NONE. No explanations, no markdown, no JSON.`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `--- RECENT CONVERSATIONS ---\n${chatsToProcess}` }
    ];

    const AI_TIMEOUT_MS = 60_000;
    try {
        const completion = await Promise.race([
            getOpenAI().chat.completions.create({
                model: "deepseek-chat",
                messages: messages as any,
                max_tokens: 1500,
                temperature: 0.1,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("AI learning timeout after 60s")), AI_TIMEOUT_MS)
            ),
        ]);

        const reply = completion.choices[0]?.message?.content?.trim() || "NONE";

        if (reply === "NONE" || reply.length < 5) {
            console.log(`[${tenantId}] 🧠 No new capabilities to add.`);
            return { success: true, learned_items: 0 };
        }

        // Parse the lines — each line starting with "- " is a fact
        const newFacts = reply
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("- "))
            .map(line => line.substring(2).trim())
            .filter(line => line.length > 0);

        if (newFacts.length === 0) {
            console.log(`[${tenantId}] 🧠 No new capabilities extracted.`);
            return { success: true, learned_items: 0 };
        }

        // Append new facts to agent_prompt
        const separator = "\n\n--- נלמד אוטומטית ---\n";
        const newFactsText = newFacts.map(f => `- ${f}`).join("\n");

        // Check if there's already a learned section
        let updatedPrompt: string;
        if (currentCapabilities.includes("--- נלמד אוטומטית ---")) {
            // Append to existing learned section
            updatedPrompt = currentCapabilities + "\n" + newFactsText;
        } else {
            // Create new learned section
            updatedPrompt = currentCapabilities + separator + newFactsText;
        }

        // Safety: cap at 8000 chars to prevent prompt bloat
        if (updatedPrompt.length > 8000) {
            console.warn(`[${tenantId}] ⚠️ agent_prompt would exceed 8000 chars — skipping learning update`);
            return { success: false, error: "agent_prompt too long" };
        }

        const { error: updateError } = await supabase
            .from("tenants")
            .update({ agent_prompt: updatedPrompt })
            .eq("id", tenantId);

        if (updateError) {
            console.error(`[${tenantId}] Failed to update agent_prompt:`, updateError);
            return { success: false, error: updateError.message };
        }

        for (const fact of newFacts) {
            console.log(`[${tenantId}] 💡 Learned: "${fact.substring(0, 80)}"`);
        }

        return { success: true, learned_items: newFacts.length, facts: newFacts };
    } catch (err: any) {
        console.error(`[${tenantId}] AI extraction failed:`, err);
        return { success: false, error: err.message };
    }
}
