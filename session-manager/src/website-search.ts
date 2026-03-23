/**
 * Website Search — crawl business websites to answer customer questions.
 * Mirrors the logic in src/lib/website-crawler.ts but optimized for
 * real-time question answering inside the session-manager service.
 *
 * Features:
 * - JSON-LD / schema.org structured data extraction
 * - Contact info extraction from header/footer before stripping
 * - Table-aware content extraction (preserves price tables)
 * - Concurrent page fetching
 * - Smart URL normalization (www, trailing slashes, query params)
 * - SSRF protection
 */

import * as cheerio from "cheerio";
import { URL } from "url";
import dns from "dns/promises";
import net from "net";
import OpenAI from "openai";

// ── Constants ────────────────────────────────────────────────────────

const MAX_CONTENT_PER_PAGE = 5000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 8_000;
const MAX_TOTAL_CHARS = 25_000;

const PRIORITY_KEYWORDS: { pattern: RegExp; score: number }[] = [
    { pattern: /products|מוצרים|חנות|shop|store|catalog|קטלוג/i, score: 11 },
    { pattern: /pricing|price|מחירים|מחירון|תעריפים/i, score: 11 },
    { pattern: /about|אודות|מי\s*אנחנו/i, score: 10 },
    { pattern: /services|שירותים|מה\s*אנחנו\s*מציעים/i, score: 9 },
    { pattern: /faq|שאלות\s*נפוצות|שאלות\s*ותשובות/i, score: 8 },
    { pattern: /contact|צור\s*קשר|יצירת\s*קשר/i, score: 7 },
    { pattern: /menu|תפריט/i, score: 7 },
    { pattern: /hours|שעות\s*פעילות|זמני\s*פתיחה/i, score: 6 },
    { pattern: /category|קטגוריה|מחלקה|department/i, score: 9 },
    { pattern: /delivery|משלוח|שילוח/i, score: 7 },
    { pattern: /returns|החזרות|מדיניות/i, score: 6 },
    { pattern: /policy|תקנון|תנאי/i, score: 5 },
    { pattern: /gallery|גלריה/i, score: 3 },
    { pattern: /team|צוות/i, score: 4 },
    { pattern: /location|מיקום|הגעה|כתובת/i, score: 5 },
    { pattern: /blog|בלוג|מאמרים/i, score: 2 },
];

// ── Types ────────────────────────────────────────────────────────────

interface CrawledPage {
    url: string;
    title: string;
    content: string;
    pageType: string;
}

// ── SSRF Protection ──────────────────────────────────────────────────

function isPrivateIP(ip: string): boolean {
    if (ip === "::1" || ip === "::ffff:127.0.0.1") return true;
    if (net.isIPv4(ip)) {
        const parts = ip.split(".").map(Number);
        if (parts[0] === 127) return true;
        if (parts[0] === 10) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
        if (parts[0] === 0) return true;
    }
    return false;
}

async function resolveAndValidateHost(hostname: string): Promise<void> {
    if (hostname === "localhost" || hostname === "0.0.0.0") {
        throw new Error(`SSRF blocked: hostname "${hostname}"`);
    }
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) throw new Error(`SSRF blocked: IP ${hostname}`);
        return;
    }
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const all = [...addresses, ...addresses6];
    if (all.length === 0) throw new Error(`DNS resolution failed for ${hostname}`);
    for (const addr of all) {
        if (isPrivateIP(addr)) throw new Error(`SSRF blocked: ${hostname} → ${addr}`);
    }
}

// ── URL Normalization ───────────────────────────────────────────────

function normalizeUrl(urlStr: string, baseHostname: string): string | null {
    try {
        const u = new URL(urlStr);
        const hostname = u.hostname.replace(/^www\./, "");
        const baseNorm = baseHostname.replace(/^www\./, "");
        if (hostname !== baseNorm) return null;

        const path = u.pathname.replace(/\/+$/, "") || "/";
        u.searchParams.delete("utm_source");
        u.searchParams.delete("utm_medium");
        u.searchParams.delete("utm_campaign");
        u.searchParams.delete("utm_content");
        u.searchParams.delete("utm_term");
        u.searchParams.delete("fbclid");
        u.searchParams.delete("gclid");

        const search = u.searchParams.toString();
        return `${u.protocol}//${u.hostname}${path}${search ? "?" + search : ""}`;
    } catch {
        return null;
    }
}

// ── JSON-LD / Schema.org Extraction ──────────────────────────────────

function extractStructuredData($: cheerio.CheerioAPI): string {
    const parts: string[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const raw = $(el).html();
            if (!raw) return;
            const data = JSON.parse(raw);
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                if (!item || typeof item !== "object") continue;
                const type = item["@type"];

                if (type === "LocalBusiness" || type === "Store" || type === "Organization" || type === "Restaurant") {
                    if (item.name) parts.push(`עסק: ${item.name}`);
                    if (item.description) parts.push(`תיאור: ${item.description}`);
                    if (item.telephone) parts.push(`טלפון: ${item.telephone}`);
                    if (item.email) parts.push(`אימייל: ${item.email}`);
                    if (item.address) {
                        const a = item.address;
                        const addr = [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean).join(", ");
                        if (addr) parts.push(`כתובת: ${addr}`);
                    }
                    if (item.openingHoursSpecification) {
                        const specs = Array.isArray(item.openingHoursSpecification) ? item.openingHoursSpecification : [item.openingHoursSpecification];
                        const hours = specs.map((s: Record<string, string>) => {
                            const days = s.dayOfWeek ? (Array.isArray(s.dayOfWeek) ? s.dayOfWeek.join(", ") : s.dayOfWeek) : "";
                            return `${days}: ${s.opens || ""}-${s.closes || ""}`;
                        }).join(" | ");
                        if (hours) parts.push(`שעות פתיחה: ${hours}`);
                    }
                    if (item.openingHours) {
                        const oh = Array.isArray(item.openingHours) ? item.openingHours.join(" | ") : item.openingHours;
                        parts.push(`שעות פתיחה: ${oh}`);
                    }
                }

                if (type === "Product" || type === "Offer") {
                    const name = item.name || "";
                    const price = item.offers?.price || item.price || "";
                    const currency = item.offers?.priceCurrency || item.priceCurrency || "₪";
                    if (name && price) parts.push(`מוצר: ${name} — ${price} ${currency}`);
                    else if (name) parts.push(`מוצר: ${name}`);
                }

                if (type === "FAQPage" && item.mainEntity) {
                    const faqs = Array.isArray(item.mainEntity) ? item.mainEntity : [item.mainEntity];
                    for (const faq of faqs) {
                        if (faq.name && faq.acceptedAnswer?.text) {
                            parts.push(`שאלה: ${faq.name} — תשובה: ${faq.acceptedAnswer.text}`);
                        }
                    }
                }
            }
        } catch { /* invalid JSON-LD — skip */ }
    });

    return parts.length > 0 ? `[מידע מובנה מהאתר]\n${parts.join("\n")}\n\n` : "";
}

// ── Contact Info Extraction ──────────────────────────────────────────

function extractContactInfo($: cheerio.CheerioAPI): string {
    const info: string[] = [];
    const contactZones = $("header, footer, nav, [class*='contact'], [id*='contact'], [class*='footer'], [class*='header'], address").text();
    const fullText = $("body").text();

    // Phone numbers (Israeli formats)
    const phones = contactZones.match(/(?:\+?972[-\s]?|0)(?:[2-9][-\s]?\d{7}|\d[-\s]?\d{3}[-\s]?\d{4})|(?:\*\d{4})/g);
    if (phones) {
        info.push(`טלפון: ${[...new Set(phones.map(p => p.replace(/\s/g, "")))].join(", ")}`);
    }

    // Emails
    const emails = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emails) info.push(`אימייל: ${[...new Set(emails)].join(", ")}`);

    // Hours
    const hoursSet = new Set<string>();
    const hoursPatterns = [
        /שעות\s*(?:פתיחה|פעילות|עבודה)[^.]*?(?:\d{1,2}[:.]\d{2}[^.]*){1,}/gi,
        /(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|sunday|monday|tuesday|wednesday|thursday|friday|saturday)[\s:|-]*\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}/gi,
    ];
    for (const pattern of hoursPatterns) {
        (contactZones.match(pattern) || []).forEach(m => hoursSet.add(m.trim().replace(/\s+/g, " ")));
        (fullText.match(pattern) || []).forEach(m => hoursSet.add(m.trim().replace(/\s+/g, " ")));
    }
    const dayTimePattern = /(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|א['׳]|ב['׳]|ג['׳]|ד['׳]|ה['׳]|ו['׳]|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*[-–:]\s*\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}/gi;
    (fullText.match(dayTimePattern) || []).forEach(m => hoursSet.add(m.trim().replace(/\s+/g, " ")));
    if (hoursSet.size > 0) info.push(`שעות פתיחה: ${[...hoursSet].join(" | ")}`);

    // Address
    const addresses = new Set<string>();
    const addrPatterns = [/כתובת[:\s]*[^,\n]{5,80}/gi, /(?:רחוב|רח['׳]|שד['׳]|שדרות)\s+[^\n,]{3,60}/gi, /address[:\s]*[^,\n]{5,80}/gi];
    for (const pattern of addrPatterns) {
        (contactZones.match(pattern) || []).forEach(m => addresses.add(m.trim().replace(/\s+/g, " ")));
        (fullText.match(pattern) || []).forEach(m => addresses.add(m.trim().replace(/\s+/g, " ")));
    }
    if (addresses.size > 0) info.push(`כתובת: ${[...addresses].join(" | ")}`);

    return info.length > 0 ? `[פרטי קשר מהאתר]\n${info.join("\n")}\n\n` : "";
}

// ── Table Extraction ────────────────────────────────────────────────

function extractTables($: cheerio.CheerioAPI): string {
    const tables: string[] = [];

    $("table").each((_, table) => {
        const rows: string[] = [];
        $(table).find("tr").each((_, tr) => {
            const cells: string[] = [];
            $(tr).find("th, td").each((_, cell) => {
                const text = $(cell).text().trim().replace(/\s+/g, " ");
                if (text) cells.push(text);
            });
            if (cells.length > 0) rows.push(cells.join(" | "));
        });
        if (rows.length > 1) {
            tables.push(rows.join("\n"));
        }
    });

    return tables.length > 0 ? `[טבלאות]\n${tables.join("\n\n")}\n\n` : "";
}

// ── HTML Extraction ─────────────────────────────────────────────────

function extractContent($: cheerio.CheerioAPI): string {
    // Extract structured data, contact info, and tables BEFORE stripping
    const structuredData = extractStructuredData($);
    const contactInfo = extractContactInfo($);
    const tables = extractTables($);

    // Remove non-content elements
    $("script, style, iframe, noscript, svg").remove();
    $("[aria-hidden='true']").remove();
    $(".cookie-banner, .popup, .modal, #cookie-consent").remove();

    // Extract headings separately to preserve structure
    const headings: string[] = [];
    $("h1, h2, h3").each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2) headings.push(text);
    });

    // Now remove nav/header/footer for main content
    $("nav, header, footer").remove();

    const text = $("body").text()
        .replace(/\s+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    // Combine: structured data + contact info + headings + tables + body text
    let combined = structuredData + contactInfo;
    if (headings.length > 0) {
        combined += `[כותרות בעמוד] ${headings.join(" | ")}\n\n`;
    }
    combined += tables + text;

    return combined.substring(0, MAX_CONTENT_PER_PAGE);
}

function extractInternalLinks($: cheerio.CheerioAPI, baseUrl: URL): string[] {
    const links: string[] = [];
    const baseHostname = baseUrl.hostname;

    $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
            const resolved = new URL(href, baseUrl.origin);
            if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
            if (/\.(pdf|zip|doc|docx|xls|xlsx|ppt|jpg|jpeg|png|gif|svg|mp3|mp4|avi|webp)$/i.test(resolved.pathname)) return;

            const normalized = normalizeUrl(resolved.href, baseHostname);
            if (normalized) links.push(normalized);
        } catch { /* skip */ }
    });
    return [...new Set(links)];
}

function scorePage(url: string): number {
    const lower = url.toLowerCase();
    let score = 0;
    for (const kw of PRIORITY_KEYWORDS) {
        if (kw.pattern.test(lower)) score = Math.max(score, kw.score);
    }
    try {
        const parsed = new URL(url);
        if (parsed.pathname === "/" || parsed.pathname === "") score = Math.max(score, 8);
        const depth = parsed.pathname.split("/").filter(Boolean).length;
        if (depth <= 1) score += 1;
    } catch { /* ignore */ }
    return score;
}

function classifyPage(url: string, title: string): string {
    const text = `${url} ${title}`.toLowerCase();
    if (/about|אודות|מי\s*אנחנו/.test(text)) return "about";
    if (/services|שירותים/.test(text)) return "services";
    if (/pricing|price|מחירים|מחירון/.test(text)) return "pricing";
    if (/faq|שאלות/.test(text)) return "faq";
    if (/contact|צור\s*קשר/.test(text)) return "contact";
    if (/menu|תפריט/.test(text)) return "menu";
    if (/hours|שעות/.test(text)) return "hours";
    if (/products|מוצרים|shop|store|catalog|קטלוג|category|קטגוריה/.test(text)) return "products";
    if (/delivery|shipping|משלוח|שילוח/.test(text)) return "shipping";
    if (/returns|refund|החזרות|החזר/.test(text)) return "returns";
    if (/policy|תקנון|תנאי/.test(text)) return "policy";
    return "general";
}

// ── Fetch single page ────────────────────────────────────────────────

const MAX_REDIRECTS = 5;

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
    let currentUrl = url;
    let redirectCount = 0;

    while (true) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
        try {
            const res = await fetch(currentUrl, {
                signal: controller.signal,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
                },
                redirect: "manual",
            });
            clearTimeout(timeout);

            // Handle redirects manually to validate each target
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get("location");
                if (!location) throw new Error("Redirect without Location header");
                redirectCount++;
                if (redirectCount > MAX_REDIRECTS) throw new Error("Too many redirects");
                const redirectUrl = new URL(location, currentUrl);
                if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
                    throw new Error(`SSRF blocked: redirect to ${redirectUrl.protocol}`);
                }
                await resolveAndValidateHost(redirectUrl.hostname);
                currentUrl = redirectUrl.href;
                continue;
            }

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ct = res.headers.get("content-type") || "";
            if (!ct.includes("text/html") && !ct.includes("application/xhtml")) throw new Error(`Not HTML: ${ct}`);
            const cl = res.headers.get("content-length");
            if (cl && parseInt(cl) > MAX_RESPONSE_BYTES) throw new Error("Response too large");

            const reader = res.body?.getReader();
            if (!reader) throw new Error("No body");
            const chunks: Uint8Array[] = [];
            let total = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > MAX_RESPONSE_BYTES) { reader.cancel(); throw new Error("Response too large"); }
                chunks.push(value);
            }
            const html = new TextDecoder().decode(Buffer.concat(chunks));
            return { html, finalUrl: currentUrl };
        } finally {
            clearTimeout(timeout);
        }
    }
}

// ── Crawl relevant pages ─────────────────────────────────────────────

async function crawlRelevantPages(websiteUrl: string, question: string): Promise<CrawledPage[]> {
    let baseUrl: URL;
    try { baseUrl = new URL(websiteUrl); } catch { return []; }
    try { await resolveAndValidateHost(baseUrl.hostname); } catch { return []; }

    const pages: CrawledPage[] = [];
    const visited = new Set<string>();
    const deadline = Date.now() + 25_000;

    try {
        const { html, finalUrl } = await fetchPage(baseUrl.href);
        visited.add(finalUrl);
        visited.add(baseUrl.href);

        const $ = cheerio.load(html);
        const title = $("title").text().trim() || baseUrl.hostname;
        const content = extractContent($);
        if (content.length > 50) {
            pages.push({ url: finalUrl, title, content, pageType: classifyPage(finalUrl, title) });
        }

        const links = extractInternalLinks($, baseUrl);
        const questionLower = question.toLowerCase();

        const scored = links
            .filter(l => !visited.has(l))
            .map(l => {
                let score = scorePage(l);
                const lower = l.toLowerCase();
                for (const word of questionLower.split(/\s+/).filter(w => w.length > 2)) {
                    if (lower.includes(word)) score += 5;
                }
                return { url: l, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        // Fetch up to 4 additional pages concurrently
        const fetchBatch = scored.slice(0, 4).filter(c => !visited.has(c.url));
        const promises = fetchBatch.map(async (candidate) => {
            if (Date.now() >= deadline) return null;
            visited.add(candidate.url);
            try {
                const { html: h, finalUrl: fu } = await fetchPage(candidate.url);
                visited.add(fu);
                const $p = cheerio.load(h);
                const t = $p("title").text().trim() || new URL(candidate.url).pathname;
                const c = extractContent($p);
                if (c.length > 50) return { url: fu, title: t, content: c, pageType: classifyPage(fu, t) };
            } catch { /* skip */ }
            return null;
        });

        const results = await Promise.all(promises);
        for (const r of results) {
            if (r && pages.length < 5) pages.push(r);
        }
    } catch { /* homepage failed */ }

    return pages;
}

// ── Prepare content for AI ───────────────────────────────────────────

function prepareContent(pages: CrawledPage[]): string {
    let content = "";
    for (const page of pages) {
        const section = `\n\n=== ${page.pageType.toUpperCase()}: ${page.title} (${page.url}) ===\n${page.content}`;
        if (content.length + section.length > MAX_TOTAL_CHARS) {
            const remaining = MAX_TOTAL_CHARS - content.length;
            if (remaining > 200) content += section.substring(0, remaining) + "\n[...truncated]";
            break;
        }
        content += section;
    }
    return content;
}

// ── Public: search website for answer ────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
    if (!_openai) {
        if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not set");
        _openai = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" });
    }
    return _openai;
}

/**
 * Crawl relevant pages from a business website and ask DeepSeek
 * if the answer to the customer's question is found.
 * Returns the answer in Hebrew, or null if not found.
 */
export async function searchWebsiteForAnswer(
    websiteUrl: string,
    question: string
): Promise<string | null> {
    const pages = await crawlRelevantPages(websiteUrl, question);
    if (pages.length === 0) return null;

    const content = prepareContent(pages);
    if (content.length < 50) return null;

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
            setTimeout(() => reject(new Error("Website search timeout")), 15_000)
        ),
    ]);

    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!reply || reply.includes("[NOT_FOUND]")) return null;
    return reply;
}
