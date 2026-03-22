/**
 * Website Analyzer — uses DeepSeek to extract structured business data
 * from crawled website content.
 */

import OpenAI from "openai";
import type { CrawledPage } from "./website-crawler";

// ── Singleton ────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;

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

// ── Types ────────────────────────────────────────────────────────────

export interface KnowledgeEntryResult {
    category: string;
    question: string;
    answer: string;
}

export interface WebsiteAnalysis {
    business_name: string | null;
    description: string | null;
    products_services: string | null;
    target_customers: string | null;
    operating_hours: string | null;
    location: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    knowledge_entries: KnowledgeEntryResult[];
    suggested_agent_prompt: string | null;
}

// ── Content Preparation ──────────────────────────────────────────────

const MAX_TOTAL_CHARS = 40_000;

function prepareContent(pages: CrawledPage[]): string {
    let content = "";
    for (const page of pages) {
        const section = `\n\n=== ${page.pageType.toUpperCase()}: ${page.title} (${page.url}) ===\n${page.content}`;
        if (content.length + section.length > MAX_TOTAL_CHARS) {
            // Add truncated version
            const remaining = MAX_TOTAL_CHARS - content.length;
            if (remaining > 200) {
                content += section.substring(0, remaining) + "\n[...truncated]";
            }
            break;
        }
        content += section;
    }
    return content;
}

// ── Main Analysis ────────────────────────────────────────────────────

export async function analyzeWebsiteContent(pages: CrawledPage[]): Promise<WebsiteAnalysis> {
    if (pages.length === 0) {
        return {
            business_name: null,
            description: null,
            products_services: null,
            target_customers: null,
            operating_hours: null,
            location: null,
            contact_phone: null,
            contact_email: null,
            knowledge_entries: [],
            suggested_agent_prompt: null,
        };
    }

    const content = prepareContent(pages);

    const systemPrompt = `אתה מנתח אתרי עסקים. מטרתך לנתח את תוכן האתר ולחלץ מידע עסקי מובנה.

חלץ את המידע הבא מתוכן האתר:

1. **business_name** — שם העסק (כפי שמופיע באתר)
2. **description** — תיאור קצר של העסק בעברית (2-3 משפטים)
3. **products_services** — רשימת שירותים/מוצרים עיקריים בעברית, מופרדים בפסיקים
4. **target_customers** — קהל יעד בעברית (משפט אחד)
5. **operating_hours** — שעות פעילות (אם נמצא)
6. **location** — כתובת/מיקום (אם נמצא)
7. **contact_phone** — טלפון ליצירת קשר (אם נמצא)
8. **contact_email** — מייל ליצירת קשר (אם נמצא)
9. **knowledge_entries** — מערך של 10-20 זוגות שאלה-תשובה בעברית שלקוח עשוי לשאול. כל פריט כולל:
   - category: קטגוריה (general, pricing, hours, services, policy, products, location)
   - question: שאלה שלקוח עשוי לשאול
   - answer: תשובה מדויקת על סמך תוכן האתר
10. **suggested_agent_prompt** — הוראות מותאמות לבוט WhatsApp בעברית (2-4 משפטים), שמתארות את אופי העסק וסגנון השירות

**חוקים:**
- הכל בעברית חוץ מ-business_name שיכול להיות באנגלית
- אל תמציא מידע — רק מה שמופיע בתוכן האתר
- אם שדה לא נמצא — null
- knowledge_entries: לפחות 10, מקסימום 20. תשובות קצרות ולעניין.

החזר JSON תקין בלבד.`;

    const AI_TIMEOUT_MS = 30_000;
    try {
        const completion = await Promise.race([
            getOpenAI().chat.completions.create({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `נתח את תוכן האתר הבא:\n\n${content}` },
                ],
                max_tokens: 3000,
                temperature: 0.1,
                response_format: { type: "json_object" },
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Website analysis timeout after 45s")), AI_TIMEOUT_MS)
            ),
        ]);

        const reply = completion.choices[0]?.message?.content?.trim() || "{}";
        return parseAnalysis(reply);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[WebsiteAnalyzer] DeepSeek analysis failed:", msg);
        throw new Error(`AI analysis failed: ${msg}`);
    }
}

// ── Defensive JSON Parsing ───────────────────────────────────────────

function parseAnalysis(raw: string): WebsiteAnalysis {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw);
    } catch {
        console.error("[WebsiteAnalyzer] Invalid JSON response:", raw.substring(0, 200));
        throw new Error("Failed to parse AI response as JSON");
    }

    // Handle wrapped responses (DeepSeek sometimes wraps in an object)
    if (parsed.data && typeof parsed.data === "object") {
        parsed = parsed.data as Record<string, unknown>;
    }
    if (parsed.result && typeof parsed.result === "object") {
        parsed = parsed.result as Record<string, unknown>;
    }

    // Extract knowledge entries with defensive handling
    let knowledgeEntries: KnowledgeEntryResult[] = [];
    const rawEntries = parsed.knowledge_entries;
    if (Array.isArray(rawEntries)) {
        knowledgeEntries = rawEntries
            .filter((e: unknown): e is Record<string, unknown> =>
                typeof e === "object" && e !== null &&
                typeof (e as Record<string, unknown>).question === "string" &&
                typeof (e as Record<string, unknown>).answer === "string"
            )
            .map((e) => ({
                category: typeof e.category === "string" ? e.category : "general",
                question: e.question as string,
                answer: e.answer as string,
            }));
    }

    return {
        business_name: typeof parsed.business_name === "string" ? parsed.business_name : null,
        description: typeof parsed.description === "string" ? parsed.description : null,
        products_services: typeof parsed.products_services === "string" ? parsed.products_services : null,
        target_customers: typeof parsed.target_customers === "string" ? parsed.target_customers : null,
        operating_hours: typeof parsed.operating_hours === "string" ? parsed.operating_hours : null,
        location: typeof parsed.location === "string" ? parsed.location : null,
        contact_phone: typeof parsed.contact_phone === "string" ? parsed.contact_phone : null,
        contact_email: typeof parsed.contact_email === "string" ? parsed.contact_email : null,
        knowledge_entries: knowledgeEntries,
        suggested_agent_prompt: typeof parsed.suggested_agent_prompt === "string" ? parsed.suggested_agent_prompt : null,
    };
}

// ── Answer from Website (used by AI agent fallback) ──────────────────

/**
 * Given crawled website pages and a customer question, ask DeepSeek
 * if the answer can be found in the website content.
 * Returns the answer in Hebrew, or null if not found.
 */
export async function answerFromWebsite(
    pages: CrawledPage[],
    question: string
): Promise<string | null> {
    if (pages.length === 0) return null;

    const content = prepareContent(pages);

    const AI_TIMEOUT_MS = 15_000;
    try {
        const completion = await Promise.race([
            getOpenAI().chat.completions.create({
                model: "deepseek-chat",
                messages: [
                    {
                        role: "system",
                        content: `אתה עוזר שירות לקוחות. קיבלת שאלה מלקוח ותוכן מאתר העסק.
אם התשובה לשאלה נמצאת בתוכן האתר — ענה בעברית בקצרה (1-2 משפטים), בסגנון WhatsApp טבעי ונעים.
אם התשובה לא נמצאת בתוכן — ענה בדיוק: [NOT_FOUND]
אל תמציא מידע שלא מופיע בתוכן.`,
                    },
                    {
                        role: "user",
                        content: `שאלת הלקוח: ${question}\n\nתוכן האתר:\n${content}`,
                    },
                ],
                max_tokens: 200,
                temperature: 0.2,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Website search timeout")), AI_TIMEOUT_MS)
            ),
        ]);

        const reply = completion.choices[0]?.message?.content?.trim() ?? "";

        if (!reply || reply.includes("[NOT_FOUND]")) {
            return null;
        }

        return reply;
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[WebsiteAnalyzer] Answer search failed:", msg);
        return null;
    }
}
