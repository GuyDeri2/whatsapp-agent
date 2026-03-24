/**
 * AI Validator Agent for Baileys service.
 * Quality gate between reply generation and message sending.
 * Must stay in sync with src/lib/ai-validator.ts (Cloud API validator).
 */

import { getOpenAI } from "./ai-agent";
import { getSupabase } from "./session-manager";

// ── Types ────────────────────────────────────────────────────────────

export interface ValidatorInput {
    tenantId: string;
    reply: string;
    lastUserMessage: string;
    history: Array<{ role: string; content: string }>;
    businessName: string;
    knowledgeBaseSnippet: string;
    recentAssistantReplies: string[];
}

export interface ValidatorResult {
    approved: boolean;
    reason: string;
    shouldPause: boolean;
}

// ── KB Cache (5-minute TTL) ──────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
const kbCache = new Map<string, { text: string; fetchedAt: number }>();

export async function getKnowledgeBaseSnippet(tenantId: string): Promise<string> {
    const cached = kbCache.get(tenantId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.text;

    const supabase = getSupabase();
    const { data } = await supabase
        .from("knowledge_base")
        .select("question, answer, category")
        .eq("tenant_id", tenantId)
        .limit(50);

    const text = (data ?? [])
        .map(e => `ש: ${e.question}\nת: ${e.answer}`)
        .join("\n");

    kbCache.set(tenantId, { text, fetchedAt: Date.now() });
    return text;
}

// ── Skip Validation ──────────────────────────────────────────────────

const TRIVIAL_PATTERNS = [
    /^(שלום|היי|הי|בוקר טוב|צהריים טובים|ערב טוב)/,
    /^(בשמחה|בטח|תודה|אין בעיה)/,
    /^(אני כאן|במה אוכל לעזור)/,
];

const ERROR_FALLBACK = "מצטער, לא הצלחתי לעבד";

export function shouldSkipValidation(reply: string, isNewConversation: boolean): boolean {
    if (isNewConversation) return true;
    if (reply.includes(ERROR_FALLBACK)) return true;
    const clean = reply.replace(/\[PAUSE\]/g, "").trim();
    if (clean.length < 30 && TRIVIAL_PATTERNS.some(p => p.test(clean))) return true;
    return false;
}

// ── Validator Prompt ─────────────────────────────────────────────────

function buildValidatorPrompt(input: ValidatorInput): string {
    const recentRepliesText = input.recentAssistantReplies.length > 0
        ? input.recentAssistantReplies.map((r, i) => `${i + 1}. "${r.substring(0, 100)}"`).join("\n")
        : "אין תשובות קודמות";

    return `אתה בודק איכות קפדני של תשובות בוט WhatsApp. אתה עובד בשביל בעל העסק — לא בשביל הבוט. תפקידך למנוע שליחת תשובות גרועות ללקוחות.

**חשוב: אתה לא הבוט. אל תשתכנע מהתשובה. בדוק אותה בקפדנות.**
**אם יש לך ספק — דחה. עדיף לדחות תשובה תקינה מאשר לאשר תשובה בעייתית.**

## מידע על העסק
שם העסק: ${input.businessName}

## בסיס הידע — המקור היחיד לאמת
${input.knowledgeBaseSnippet || "(ריק — אין מידע בבסיס הידע. כל פרט ספציפי שהבוט אומר הוא בהכרח המצאה.)"}

## תשובות קודמות של הבוט בשיחה הזו
${recentRepliesText}

## בדיקות (בדוק כל אחת בנפרד)

### 1. המצאת מידע (הבדיקה החשובה ביותר)
חפש בתשובת הבוט כל פרט ספציפי: מחירים, שעות פעילות, שמות מוצרים, אמצעי תשלום, כתובות, מבצעים, מדיניות, מותגים.
**לכל פרט ספציפי — בדוק אם הוא מופיע מילה במילה בבסיס הידע למעלה.**
אם הפרט לא מופיע בבסיס הידע — זו המצאה. **דחה.**
דוגמה: אם הבוט אומר "אפשר לשלם באשראי" ובבסיס הידע אין מילה על אשראי — זו המצאה.

### 2. חזרה על עצמו
השווה את תשובת הבוט לתשובות הקודמות למעלה. אם אותו מידע (מבצע, מחיר, שעה) כבר נאמר — **דחה.**

### 3. בלבול תפקידים
האם התשובה נשמעת כאילו היא מהלקוח? (כמו "שמעתי עליכם", "אשמח לשמוע", "העברת אותי?") — **דחה.**

### 4. התעלמות מהשאלה
האם הבוט באמת עונה על מה שהלקוח שאל? אם מתעלם או מסיט — **דחה.**

### 5. העברה חסרה לנציג
אם הלקוח כועס, מבקש נציג, רוצה לקנות/להזמין, מדווח על בעיה טכנית — והבוט לא מעביר לנציג — **דחה וסמן shouldPause=true.**

### 6. אורך
יותר מ-3 משפטים = ארוך מדי ל-WhatsApp. **דחה.**

### 7. סתירות
האם התשובה סותרת מידע שהבוט נתן קודם בשיחה? **דחה.**

## כללי shouldPause
סמן shouldPause=true אם:
- הלקוח מבקש נציג/אדם אמיתי
- הלקוח כועס או מתוסכל
- הלקוח רוצה לקנות/להזמין/לרכוש
- בעיה טכנית שהבוט לא יכול לפתור
- הבוט חזר על עצמו 2+ פעמים (הלקוח תקוע)

## פלט
ענה ב-JSON בלבד. **אם יש ספק — דחה.**
{"approved": true/false, "reason": "סיבה קצרה בעברית", "shouldPause": true/false}`;
}

// ── Validate Reply ───────────────────────────────────────────────────

const VALIDATOR_TIMEOUT_MS = 8_000;

export async function validateReply(input: ValidatorInput): Promise<ValidatorResult> {
    const systemPrompt = buildValidatorPrompt(input);

    // Build a concise conversation context for the validator
    const lastMessages = input.history.slice(-6).map(m => {
        const label = m.role === "user" ? "לקוח" : "בוט";
        return `${label}: ${m.content.substring(0, 150)}`;
    }).join("\n");

    const userPrompt = `## הודעה אחרונה של הלקוח
"${input.lastUserMessage}"

## תשובת הבוט לבדיקה
"${input.reply}"

## הקשר שיחה (הודעות אחרונות)
${lastMessages}

בדוק את תשובת הבוט והחזר JSON.`;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), VALIDATOR_TIMEOUT_MS);

    try {
        const completion = await getOpenAI().chat.completions.create(
            {
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                response_format: { type: "json_object" },
                max_tokens: 100,
                temperature: 0.1,
            },
            { signal: abortController.signal as AbortSignal }
        );
        clearTimeout(timeout);

        const raw = completion.choices[0]?.message?.content?.trim();
        if (!raw) {
            console.warn(`[${input.tenantId}] Validator returned empty — fail-open`);
            return { approved: true, reason: "", shouldPause: false };
        }

        const parsed = JSON.parse(raw);
        return {
            approved: Boolean(parsed.approved),
            reason: String(parsed.reason || ""),
            shouldPause: Boolean(parsed.shouldPause),
        };
    } catch (err) {
        clearTimeout(timeout);
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[${input.tenantId}] Validator failed — fail-open:`, msg);
        return { approved: true, reason: "", shouldPause: false };
    }
}
