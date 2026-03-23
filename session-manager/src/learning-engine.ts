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

    // 3. Get current capabilities + pending facts to avoid duplicates
    const { data: tenantFull } = await supabase
        .from("tenants")
        .select("agent_prompt, pending_learned_facts")
        .eq("id", tenantId)
        .single();

    const currentCapabilities = tenantFull?.agent_prompt || "";
    const existingPending: { fact: string; learned_at: string }[] = tenantFull?.pending_learned_facts || [];

    // Build context of what the agent already knows (capabilities + pending)
    const alreadyKnown = currentCapabilities
        + (existingPending.length > 0
            ? "\n\nממתין לאישור:\n" + existingPending.map(p => `- ${p.fact}`).join("\n")
            : "");

    // 4. Ask DeepSeek to extract ONLY business-relevant facts
    const businessContext = [
        tenant.business_name ? `שם: ${tenant.business_name}` : "",
        tenant.description ? `תיאור: ${tenant.description}` : "",
        tenant.products ? `מוצרים/שירותים: ${tenant.products}` : "",
        tenant.target_customers ? `קהל יעד: ${tenant.target_customers}` : "",
    ].filter(Boolean).join("\n");

    const systemPrompt = `אתה אנליסט עסקי מומחה. המשימה שלך: לקרוא שיחות WhatsApp בין בעל העסק ללקוחות ולחלץ **אך ורק עובדות עסקיות** שיעזרו לסוכן AI לענות ללקוחות עתידיים.

━━━ על העסק ━━━
${businessContext}

━━━ המבחן הקריטי — חייב לעבור על כל עובדה ━━━
שאל את עצמך: "אם לקוח אחר לגמרי ישאל את אותה שאלה מחר — האם התשובה הזו תהיה נכונה ורלוונטית?"
- כן → חלץ את העובדה
- לא → דלג לחלוטין

━━━ מה לחלץ (רק את הקטגוריות האלה) ━━━
- מחירים ותעריפים (משלוח, מוצרים, שירותים)
- שעות פעילות ואזורי שירות
- מדיניות (החזרות, ביטולים, אחריות)
- מוצרים ושירותים (מה יש, מה אין, מפרט)
- תהליכי הזמנה ותשלום
- מידע שימושי חוזר (חנייה, כתובת, זמני המתנה)

━━━ מה לא לחלץ (דלג לחלוטין) ━━━
- פגישות חד-פעמיות, תיאומי לוחות זמנים אישיים
- הנחות מיוחדות שניתנו ללקוח ספציפי
- שיחות חולין, ברכות, תודות, מחמאות
- פרטים אישיים של לקוחות (טלפון, כתובת, מייל)
- תשובות של הבוט (AI/ASSISTANT) — למד רק מתשובות הבעלים (OWNER)
- מידע שכבר קיים ביכולות הנוכחיות (ראה למטה)

━━━ יכולות קיימות (אל תכפיל!) ━━━
${alreadyKnown || "(ריק — אין יכולות עדיין)"}

━━━ פורמט פלט ━━━
כתוב רק עובדות חדשות, שורה אחת לכל עובדה, בעברית.
כל שורה מתחילה ב-"- ".
כתוב את העובדה כמשפט ברור וקצר שסוכן AI יכול להשתמש בו.

דוגמה:
- דמי משלוח: ₪25 להזמנות מתחת ל-₪150, חינם מעל ₪150
- שעות פעילות: א-ה 9:00-19:00, סגור בשישי-שבת
- אין החזרים על הזמנות בהתאמה אישית

אם אין עובדות חדשות — כתוב בדיוק: NONE`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `--- שיחות אחרונות ---\n${chatsToProcess}` }
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
            console.log(`[${tenantId}] 🧠 No new facts found.`);
            return { success: true, learned_items: 0 };
        }

        // Parse facts
        const newFacts = reply
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("- "))
            .map(line => line.substring(2).trim())
            .filter(line => line.length > 0);

        if (newFacts.length === 0) {
            console.log(`[${tenantId}] 🧠 No new facts extracted.`);
            return { success: true, learned_items: 0 };
        }

        // Add to pending_learned_facts (owner needs to approve)
        const now = new Date().toISOString();
        const newPendingEntries = newFacts.map(fact => ({ fact, learned_at: now }));
        const updatedPending = [...existingPending, ...newPendingEntries];

        // Cap at 50 pending items to prevent bloat
        const cappedPending = updatedPending.slice(-50);

        const { error: updateError } = await supabase
            .from("tenants")
            .update({ pending_learned_facts: cappedPending })
            .eq("id", tenantId);

        if (updateError) {
            console.error(`[${tenantId}] Failed to update pending_learned_facts:`, updateError);
            return { success: false, error: updateError.message };
        }

        for (const fact of newFacts) {
            console.log(`[${tenantId}] 📋 Pending approval: "${fact.substring(0, 80)}"`);
        }

        return { success: true, learned_items: newFacts.length, facts: newFacts };
    } catch (err: any) {
        console.error(`[${tenantId}] AI extraction failed:`, err);
        return { success: false, error: err.message };
    }
}
