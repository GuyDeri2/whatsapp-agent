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

export interface ProductPriceResult {
    name: string;
    price: string;
    description?: string;
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
    products_with_prices: ProductPriceResult[];
    suggested_agent_prompt: string | null;
}

// ── Content Preparation ──────────────────────────────────────────────

const MAX_TOTAL_CHARS = 60_000;

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
            products_with_prices: [],
            suggested_agent_prompt: null,
        };
    }

    const content = prepareContent(pages);

    const systemPrompt = `You are a business intelligence analyst. Extract ALL useful information from this business website. A business owner needs this data to set up a WhatsApp customer service bot. Be EXHAUSTIVE — extract everything you can find.

Return JSON with these fields:

- business_name: string (exact name as shown on site)
- description: string in Hebrew (2-3 sentences describing what the business does, its specialty, and unique value)
- products_services: string in Hebrew (detailed comma-separated list of ALL products/services/categories found)
- target_customers: string in Hebrew (who are the customers) or null
- operating_hours: string in Hebrew (full schedule, e.g. "ראשון-חמישי 08:00-17:00, שישי 08:00-13:00") or null
- location: string (full address + any directions/landmarks mentioned) or null
- contact_phone: string (all phone numbers found, comma-separated) or null
- contact_email: string (all emails found, comma-separated) or null

- knowledge_entries: array of objects with category, question (Hebrew), answer (Hebrew).
  Extract AS MANY as possible. Cover ALL these categories if info exists:
  * "about" — what the business does, history, specialties, certifications, team
  * "hours" — opening hours, holiday hours, emergency hours
  * "location" — address, directions, parking, branches
  * "contact" — phone, email, WhatsApp, social media links
  * "shipping" — delivery options, shipping costs, delivery times, delivery areas
  * "returns" — return policy, warranty, exchange policy, refund policy
  * "payment" — payment methods, credit cards, installments, bank transfer
  * "products" — product categories, brands carried, special features, materials
  * "services" — service descriptions, service areas, response times
  * "promotions" — current deals, discounts, loyalty programs, gift cards
  * "faq" — any FAQ content found on the site
  * "general" — anything else useful (minimum order, ordering process, custom orders, etc.)

  For each piece of info found, create a Q&A entry. Write questions as a customer would ask them.
  Example: category "shipping", question "מה זמני המשלוח?", answer "משלוח תוך 3-5 ימי עסקים לכל הארץ."
  NO LIMIT on number of entries — extract everything.

- products_with_prices: array of objects with name (Hebrew), price (string with ₪), description (Hebrew, optional).
  Extract EVERY product/service that has a price. Include all variations (sizes, packages, tiers).
  Empty array only if truly no prices found anywhere on the site.

- suggested_agent_prompt: string in Hebrew — comprehensive operational guide for a WhatsApp bot.
  Write as bullet points covering: business identity, what we sell/do, hours, location, shipping/delivery, returns, payment, special notes, tone of voice. Be thorough — this is the bot's complete business knowledge.

Rules:
- Only use information actually found in the website content
- Hebrew for all text fields except business_name
- null if information truly not found (don't guess)
- Be exhaustive — more data is better. Extract EVERYTHING.
- For knowledge_entries: aim for 20-50+ entries covering all categories
- For products_with_prices: list every single priced item found`;

    const AI_TIMEOUT_MS = 120_000;
    try {
        const completion = await Promise.race([
            getOpenAI().chat.completions.create({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: content },
                ],
                max_tokens: 8000,
                temperature: 0.1,
                response_format: { type: "json_object" },
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Website analysis timeout")), AI_TIMEOUT_MS)
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

    // Extract products with prices
    let productsWithPrices: ProductPriceResult[] = [];
    const rawProducts = parsed.products_with_prices;
    if (Array.isArray(rawProducts)) {
        productsWithPrices = rawProducts
            .filter((p: unknown): p is Record<string, unknown> =>
                typeof p === "object" && p !== null &&
                typeof (p as Record<string, unknown>).name === "string" &&
                typeof (p as Record<string, unknown>).price === "string"
            )
            .map((p) => ({
                name: p.name as string,
                price: p.price as string,
                ...(typeof p.description === "string" ? { description: p.description } : {}),
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
        products_with_prices: productsWithPrices,
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
