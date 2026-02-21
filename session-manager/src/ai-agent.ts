/**
 * Per-tenant AI Agent.
 * Builds a dynamic system prompt from the tenant's business profile,
 * knowledge base, and learned Q&A pairs, then generates responses via OpenAI.
 */

import OpenAI from "openai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Singletons ───────────────────────────────────────────────────────
let _openai: OpenAI | null = null;
let _supabase: SupabaseClient | null = null;

function getOpenAI(): OpenAI {
    if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
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

// ─── Types ────────────────────────────────────────────────────────────
interface TenantProfile {
    business_name: string;
    description: string | null;
    products: string | null;
    target_customers: string | null;
    agent_prompt: string | null;
}

interface KnowledgeEntry {
    category: string | null;
    question: string | null;
    answer: string;
}

interface LearningEntry {
    customer_message: string;
    owner_reply: string;
}

interface ChatMessage {
    role: "user" | "assistant" | "owner";
    content: string;
}

// ─── Build system prompt ──────────────────────────────────────────────
async function buildSystemPrompt(tenantId: string): Promise<string> {
    const supabase = getSupabase();

    // 1. Tenant profile
    const { data: tenant } = await supabase
        .from("tenants")
        .select("business_name, description, products, target_customers, agent_prompt")
        .eq("id", tenantId)
        .single();

    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    const t = tenant as TenantProfile;

    // If tenant has a custom prompt override, use it
    if (t.agent_prompt) return t.agent_prompt;

    // 2. Knowledge base
    const { data: knowledge } = await supabase
        .from("knowledge_base")
        .select("category, question, answer")
        .eq("tenant_id", tenantId)
        .limit(50);

    // 3. Learned Q&A pairs (approved ones only)
    const { data: learnings } = await supabase
        .from("agent_learnings")
        .select("customer_message, owner_reply")
        .eq("tenant_id", tenantId)
        .eq("approved", true)
        .limit(30);

    // Build dynamic prompt
    let prompt = `You are a WhatsApp customer support assistant for "${t.business_name}".`;

    if (t.description) {
        prompt += `\n\nAbout the business:\n${t.description}`;
    }

    if (t.products) {
        prompt += `\n\nProducts/Services:\n${t.products}`;
    }

    if (t.target_customers) {
        prompt += `\n\nTarget customers:\n${t.target_customers}`;
    }

    if (knowledge && knowledge.length > 0) {
        prompt += "\n\nKnowledge Base:";
        for (const k of knowledge as KnowledgeEntry[]) {
            if (k.question) {
                prompt += `\n- Q: ${k.question}\n  A: ${k.answer}`;
            } else {
                prompt += `\n- ${k.category ? `[${k.category}] ` : ""}${k.answer}`;
            }
        }
    }

    if (learnings && learnings.length > 0) {
        prompt += "\n\nExamples of how the business owner replies to customers:";
        for (const l of learnings as LearningEntry[]) {
            prompt += `\nCustomer: ${l.customer_message}\nOwner: ${l.owner_reply}`;
        }
    }

    prompt += `\n\nInstructions:
- Reply in the same language the customer uses.
- Be friendly, helpful, and concise — match the business owner's tone from the examples above.
- If you don't know something specific, say so honestly and offer to check with the team.
- Keep replies natural and conversational for WhatsApp.
- Do NOT mention that you are an AI unless directly asked.`;

    return prompt;
}

// ─── Generate AI reply ────────────────────────────────────────────────
export async function generateReply(
    tenantId: string,
    conversationId: string,
    incomingMessage: string
): Promise<string> {
    const supabase = getSupabase();

    // Load conversation history (last 20 messages)
    const { data: history } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(20);

    const systemPrompt = await buildSystemPrompt(tenantId);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...((history ?? []) as ChatMessage[]).map((m) => ({
            role: (m.role === "owner" ? "assistant" : m.role) as "user" | "assistant",
            content: m.content,
        })),
        { role: "user", content: incomingMessage },
    ];

    const completion = await getOpenAI().chat.completions.create({
        model: "gpt-4",
        messages,
        max_tokens: 500,
        temperature: 0.7,
    });

    return (
        completion.choices[0]?.message?.content ??
        "Sorry, I couldn't generate a response right now."
    );
}
