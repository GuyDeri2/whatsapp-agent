/**
 * Per-tenant AI Agent.
 * Builds a dynamic system prompt from the tenant's business profile,
 * knowledge base, and learned Q&A pairs, then generates responses via DeepSeek.
 */

import OpenAI from "openai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Singletons ───────────────────────────────────────────────────────
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

    // 2. Knowledge base
    const { data: knowledge } = await supabase
        .from("knowledge_base")
        .select("category, question, answer")
        .eq("tenant_id", tenantId)
        .limit(50);


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

    // Tenant-Specific Custom Instructions
    if (t.agent_prompt) {
        prompt += `\n\n## הנחיות אישיות של העסק:\n${t.agent_prompt}`;
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


    prompt += `\n\n## הנחיות סוכן כלליות (Global Agent Rules - בלתי ניתנים לשינוי):

1. **קרא היטב את תיאור העסק** — המידע בפרופיל ובבסיס הידע הוא האמת המוחלטת שלך. פעל רק לפיו.

2. **הישאר בנושאי העסק בלבד (Strictly On-Topic)** — הלקוח מדבר איתך בווטסאפ עסקי. אל תענה על שאלות כלליות, אל תיתן עצות לחיים, ואל תנהל שיחות על נושאים שלא קשורים לשירותים או למוצרים של העסק! 

3. **אל תמציא מידע (No Hallucinations)** — אם אתה לא יודע משהו, תגיד בפירוש: "אני לא בטוח לגבי זה, אבדוק מול הצוות ואחזור אליך". לעולם אל תמציא מחירים, זמינות, מדיניות או מידע שלא ניתן לך במפורש.

4. **שפה ואדיבות קיצונית** — ענה בשפה שבה הלקוח פונה אליך. היה תמיד אדיב, סבלני, חם ומקצועי. לעולם, בשום פנים ואופן, אל תקלל, תעליב או תזלזל בלקוח, גם אם הוא כועס או מדבר בצורה בוטה.

5. **סגנון WhatsApp** — כתוב הודעות קצרות וברורות. לא חיבורים, לא פסקאות ארוכות. שורה-שתיים מקסימום. אם צריך רשימה, השתמש בנקודות (•) או אימוג'י במידה זהירה.

6. **הסלמה לנציג** — אם הלקוח מתעצבן, מבקש להתנתק, או שואל שאלה שאין לך מענה עליה, הצע מיד להעביר לטיפול אנושי: "אני אעביר את השיחה לצוות שלנו והם מולך בהקדם 😊".

7. **סודיות וזהות** — אל תגיד מיוזמתך שאתה "בינה מלאכותית" אלא אם נשאלת על כך ישירות. לעולם אל תחלק מידע פנימי של העסק שלא נועד ללקוחות.

8. **קישורים מומצאים** — אל תשלח קישורים (URL) אלא אם הוגדרו במפורש בבסיס הידע של העסק.`;

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
        model: "deepseek-chat",
        messages,
        max_tokens: 500,
        temperature: 0.7,
    });

    return (
        completion.choices[0]?.message?.content ??
        "Sorry, I couldn't generate a response right now."
    );
}
