/**
 * Website Search — crawl business websites to answer customer questions.
 * Mirrors the logic in src/lib/website-crawler.ts + website-analyzer.ts
 * but runs inside the session-manager service.
 */

import * as cheerio from "cheerio";
import { URL } from "url";
import dns from "dns/promises";
import net from "net";
import OpenAI from "openai";

// ── Constants ────────────────────────────────────────────────────────

const MAX_CONTENT_PER_PAGE = 3000;
const MAX_RESPONSE_BYTES = 500 * 1024;
const PAGE_TIMEOUT_MS = 6_000;
const MAX_TOTAL_CHARS = 15_000;

const PRIORITY_KEYWORDS: { pattern: RegExp; score: number }[] = [
    { pattern: /about|אודות|מי\s*אנחנו/i, score: 10 },
    { pattern: /services|שירותים|מה\s*אנחנו\s*מציעים/i, score: 9 },
    { pattern: /pricing|price|מחירים|מחירון|תעריפים/i, score: 9 },
    { pattern: /faq|שאלות\s*נפוצות|שאלות\s*ותשובות/i, score: 8 },
    { pattern: /contact|צור\s*קשר|יצירת\s*קשר/i, score: 7 },
    { pattern: /menu|תפריט/i, score: 7 },
    { pattern: /hours|שעות\s*פעילות|זמני\s*פתיחה/i, score: 6 },
    { pattern: /products|מוצרים|חנות|shop|store|catalog|קטלוג/i, score: 9 },
    { pattern: /gallery|גלריה/i, score: 3 },
    { pattern: /team|צוות/i, score: 4 },
    { pattern: /location|מיקום|הגעה|כתובת/i, score: 5 },
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

// ── HTML helpers ─────────────────────────────────────────────────────

function extractContent($: cheerio.CheerioAPI): string {
    $("script, style, nav, header, footer, iframe, noscript, svg, form").remove();
    $("[aria-hidden='true']").remove();
    $(".cookie-banner, .popup, .modal, #cookie-consent").remove();
    return $("body").text().replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim().substring(0, MAX_CONTENT_PER_PAGE);
}

function extractInternalLinks($: cheerio.CheerioAPI, baseUrl: URL): string[] {
    const links: string[] = [];
    $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
            const resolved = new URL(href, baseUrl.origin);
            if (resolved.hostname !== baseUrl.hostname) return;
            if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
            if (/\.(pdf|zip|doc|docx|xls|xlsx|ppt|jpg|jpeg|png|gif|svg|mp3|mp4|avi)$/i.test(resolved.pathname)) return;
            resolved.hash = "";
            links.push(resolved.href);
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
    if (/products|מוצרים/.test(text)) return "products";
    return "general";
}

// ── Fetch single page ────────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; WhatsAppAgentBot/1.0)",
                Accept: "text/html,application/xhtml+xml",
                "Accept-Language": "he,en;q=0.9",
            },
            redirect: "follow",
        });
        clearTimeout(timeout);
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
        return { html, finalUrl: res.url || url };
    } finally {
        clearTimeout(timeout);
    }
}

// ── Crawl relevant pages ─────────────────────────────────────────────

async function crawlRelevantPages(websiteUrl: string, question: string): Promise<CrawledPage[]> {
    let baseUrl: URL;
    try { baseUrl = new URL(websiteUrl); } catch { return []; }
    try { await resolveAndValidateHost(baseUrl.hostname); } catch { return []; }

    const pages: CrawledPage[] = [];
    const visited = new Set<string>();
    const deadline = Date.now() + 20_000;

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
            .slice(0, 3);

        for (const candidate of scored) {
            if (pages.length >= 3 || Date.now() >= deadline) break;
            if (visited.has(candidate.url)) continue;
            visited.add(candidate.url);
            try {
                const parsed = new URL(candidate.url);
                await resolveAndValidateHost(parsed.hostname);
                const { html: h, finalUrl: fu } = await fetchPage(candidate.url);
                visited.add(fu);
                const $p = cheerio.load(h);
                const t = $p("title").text().trim() || parsed.pathname;
                const c = extractContent($p);
                if (c.length > 50) pages.push({ url: fu, title: t, content: c, pageType: classifyPage(fu, t) });
            } catch { /* skip */ }
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
