/**
 * Website Crawler — fetches and extracts text from business websites.
 *
 * Features:
 * - BFS crawl with priority queue (discovers links from every page)
 * - Sitemap.xml parsing for complete page discovery
 * - JSON-LD / schema.org structured data extraction
 * - Contact info extraction from header/footer before stripping
 * - Table-aware content extraction (preserves price tables)
 * - Concurrent page fetching (3 at a time)
 * - Smart URL normalization (www, trailing slashes, query params)
 * - SSRF protection, robots.txt, per-page and total timeouts
 */

import * as cheerio from "cheerio";
import { URL } from "url";
import dns from "dns/promises";
import net from "net";

// ── Constants ────────────────────────────────────────────────────────

const MAX_PAGES = 50;
const MAX_CONTENT_PER_PAGE = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB
const PAGE_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 180_000; // 3 minutes
const CONCURRENCY = 3;

// Priority keywords for page ranking (Hebrew + English)
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

// Pagination link patterns
const PAGINATION_PATTERNS = /page[=\/]\d|עמוד|next|הבא|pagination|paged|load.?more/i;

// ── Types ────────────────────────────────────────────────────────────

export interface CrawledPage {
    url: string;
    title: string;
    content: string;
    pageType: string;
}

export interface CrawlResult {
    pages: CrawledPage[];
    errors: string[];
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
        throw new Error(`SSRF blocked: hostname "${hostname}" is not allowed`);
    }
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) throw new Error(`SSRF blocked: IP ${hostname} is private`);
        return;
    }
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];
    if (allAddresses.length === 0) throw new Error(`DNS resolution failed for ${hostname}`);
    for (const addr of allAddresses) {
        if (isPrivateIP(addr)) throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${addr}`);
    }
}

// ── URL Normalization ───────────────────────────────────────────────

/** Normalize URLs to avoid visiting the same page twice with different formats */
function normalizeUrl(urlStr: string, baseHostname: string): string | null {
    try {
        const u = new URL(urlStr);
        // Treat www and non-www as same
        const hostname = u.hostname.replace(/^www\./, "");
        const baseNorm = baseHostname.replace(/^www\./, "");
        if (hostname !== baseNorm) return null;

        // Normalize: remove trailing slash, remove hash, lowercase path
        let path = u.pathname.replace(/\/+$/, "") || "/";
        // Remove common tracking params
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

// ── Robots.txt ───────────────────────────────────────────────────────

async function fetchRobotsTxt(origin: string): Promise<Set<string>> {
    const disallowed = new Set<string>();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${origin}/robots.txt`, {
            signal: controller.signal,
            headers: { "User-Agent": "WhatsAppAgentBot/1.0" },
        });
        clearTimeout(timeout);
        if (!res.ok) return disallowed;
        const text = await res.text();
        let inUserAgent = false;
        for (const line of text.split("\n")) {
            const trimmed = line.trim().toLowerCase();
            if (trimmed.startsWith("user-agent:")) {
                const ua = trimmed.replace("user-agent:", "").trim();
                inUserAgent = ua === "*" || ua.includes("whatsapp");
            } else if (inUserAgent && trimmed.startsWith("disallow:")) {
                const path = trimmed.replace("disallow:", "").trim();
                if (path) disallowed.add(path);
            }
        }
    } catch { /* ignore */ }
    return disallowed;
}

function isDisallowed(pathname: string, disallowedPaths: Set<string>): boolean {
    for (const path of disallowedPaths) {
        if (pathname.startsWith(path)) return true;
    }
    return false;
}

// ── Sitemap.xml ─────────────────────────────────────────────────────

/** Parse sitemap.xml to discover all pages. Returns list of URLs. */
async function fetchSitemap(origin: string): Promise<string[]> {
    const urls: string[] = [];
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${origin}/sitemap.xml`, {
            signal: controller.signal,
            headers: { "User-Agent": "WhatsAppAgentBot/1.0" },
        });
        clearTimeout(timeout);
        if (!res.ok) return urls;

        const text = await res.text();
        // Extract <loc> tags
        const locMatches = text.match(/<loc>(.*?)<\/loc>/gi);
        if (locMatches) {
            for (const match of locMatches) {
                const url = match.replace(/<\/?loc>/gi, "").trim();
                if (url.startsWith("http")) {
                    // Check if it's a nested sitemap
                    if (url.endsWith(".xml") || url.includes("sitemap")) {
                        // Try to fetch nested sitemap (one level deep only)
                        try {
                            const ctrl2 = new AbortController();
                            const t2 = setTimeout(() => ctrl2.abort(), 3000);
                            const res2 = await fetch(url, { signal: ctrl2.signal, headers: { "User-Agent": "WhatsAppAgentBot/1.0" } });
                            clearTimeout(t2);
                            if (res2.ok) {
                                const text2 = await res2.text();
                                const locs2 = text2.match(/<loc>(.*?)<\/loc>/gi);
                                if (locs2) {
                                    for (const m2 of locs2) {
                                        const u2 = m2.replace(/<\/?loc>/gi, "").trim();
                                        if (u2.startsWith("http") && !u2.endsWith(".xml")) urls.push(u2);
                                    }
                                }
                            }
                        } catch { /* skip nested sitemap */ }
                    } else {
                        urls.push(url);
                    }
                }
            }
        }
    } catch { /* no sitemap — that's fine */ }
    return urls;
}

// ── Page scoring ─────────────────────────────────────────────────────

function scorePage(url: string): number {
    const lower = url.toLowerCase();
    let score = 0;
    for (const kw of PRIORITY_KEYWORDS) {
        if (kw.pattern.test(lower)) {
            score = Math.max(score, kw.score);
        }
    }
    try {
        const parsed = new URL(url);
        if (parsed.pathname === "/" || parsed.pathname === "") score = Math.max(score, 8);
        // Shallow pages are more important (less path depth)
        const depth = parsed.pathname.split("/").filter(Boolean).length;
        if (depth <= 1) score += 1;
    } catch { /* ignore */ }
    if (PAGINATION_PATTERNS.test(lower)) score = Math.max(score, 10);
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

// ── JSON-LD / Schema.org Extraction ──────────────────────────────────

/** Extract structured data from JSON-LD scripts in the page */
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

                if (type === "BreadcrumbList" && item.itemListElement) {
                    // Breadcrumbs can reveal site structure — skip to avoid noise
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

    return info.length > 0 ? `[פרטי קשר]\n${info.join("\n")}\n\n` : "";
}

// ── Table Extraction ────────────────────────────────────────────────

/** Extract tables as structured text (preserves price tables, specs, hours) */
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
        if (rows.length > 1) { // Only include tables with more than header
            tables.push(rows.join("\n"));
        }
    });

    return tables.length > 0 ? `[טבלאות]\n${tables.join("\n\n")}\n\n` : "";
}

// ── HTML Extraction ──────────────────────────────────────────────────

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

    // Extract main body text
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
        } catch { /* invalid URL — skip */ }
    });
    return [...new Set(links)];
}

// ── Fetch a single page ──────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
            },
            redirect: "follow",
        });

        clearTimeout(timeout);

        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
            throw new Error(`Not HTML: ${contentType}`);
        }

        const contentLength = res.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
            throw new Error(`Response too large: ${contentLength} bytes`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalSize += value.length;
            if (totalSize > MAX_RESPONSE_BYTES) {
                reader.cancel();
                throw new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`);
            }
            chunks.push(value);
        }

        const html = new TextDecoder().decode(Buffer.concat(chunks));
        return { html, finalUrl: res.url || url };
    } finally {
        clearTimeout(timeout);
    }
}

// ── Concurrent fetcher ──────────────────────────────────────────────

/** Fetch multiple pages concurrently with a concurrency limit */
async function fetchConcurrent(
    urls: string[],
    visited: Set<string>,
    disallowed: Set<string>,
    baseUrl: URL,
    deadline: number
): Promise<{ page: CrawledPage; links: string[] }[]> {
    const results: { page: CrawledPage; links: string[] }[] = [];

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
        if (Date.now() >= deadline) break;

        const batch = urls.slice(i, i + CONCURRENCY).filter(u => !visited.has(u));
        if (batch.length === 0) continue;

        const promises = batch.map(async (url) => {
            visited.add(url);
            try {
                const parsed = new URL(url);
                if (isDisallowed(parsed.pathname, disallowed)) return null;

                const { html, finalUrl } = await fetchPage(url);
                visited.add(finalUrl);

                const $ = cheerio.load(html);
                const title = $("title").text().trim() || parsed.pathname || baseUrl.hostname;
                const content = extractContent($);

                if (content.length <= 50) return null;

                const links = extractInternalLinks($, baseUrl);
                return {
                    page: { url: finalUrl, title, content, pageType: classifyPage(finalUrl, title) },
                    links,
                };
            } catch {
                return null;
            }
        });

        const batchResults = await Promise.all(promises);
        for (const r of batchResults) {
            if (r) results.push(r);
        }
    }

    return results;
}

// ── Main Crawl Function ──────────────────────────────────────────────

export async function crawlWebsite(startUrl: string): Promise<CrawlResult> {
    const errors: string[] = [];
    const pages: CrawledPage[] = [];
    const visited = new Set<string>();

    let baseUrl: URL;
    try {
        baseUrl = new URL(startUrl);
        if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
            return { pages: [], errors: ["URL must use http or https protocol"] };
        }
    } catch {
        return { pages: [], errors: ["Invalid URL format"] };
    }

    try {
        await resolveAndValidateHost(baseUrl.hostname);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "SSRF check failed";
        return { pages: [], errors: [msg] };
    }

    const totalDeadline = Date.now() + TOTAL_TIMEOUT_MS;

    // Fetch robots.txt and sitemap.xml in parallel
    const [disallowed, sitemapUrls] = await Promise.all([
        fetchRobotsTxt(baseUrl.origin),
        fetchSitemap(baseUrl.origin),
    ]);

    // Seed candidates from sitemap + start URL
    const candidateUrls = new Map<string, number>();
    const normalized = normalizeUrl(baseUrl.href, baseUrl.hostname);
    if (normalized) candidateUrls.set(normalized, scorePage(baseUrl.href));

    // Add sitemap URLs as candidates
    for (const sitemapUrl of sitemapUrls) {
        const norm = normalizeUrl(sitemapUrl, baseUrl.hostname);
        if (norm && !candidateUrls.has(norm)) {
            candidateUrls.set(norm, scorePage(sitemapUrl));
        }
    }

    // BFS with priority queue and concurrent fetching
    while (pages.length < MAX_PAGES && Date.now() < totalDeadline) {
        // Pick the top N highest-scoring unvisited candidates
        const unvisited: [string, number][] = [];
        for (const [url, score] of candidateUrls) {
            if (!visited.has(url)) unvisited.push([url, score]);
        }
        if (unvisited.length === 0) break;

        // Sort by score descending and take a batch
        unvisited.sort((a, b) => b[1] - a[1]);
        const batchSize = Math.min(CONCURRENCY, MAX_PAGES - pages.length);
        const batch = unvisited.slice(0, batchSize).map(([url]) => url);

        const results = await fetchConcurrent(batch, visited, disallowed, baseUrl, totalDeadline);

        for (const { page, links } of results) {
            if (pages.length >= MAX_PAGES) break;
            pages.push(page);

            // Add discovered links as new candidates
            for (const link of links) {
                if (!visited.has(link) && !candidateUrls.has(link)) {
                    try {
                        const linkParsed = new URL(link);
                        if (!isDisallowed(linkParsed.pathname, disallowed)) {
                            candidateUrls.set(link, scorePage(link));
                        }
                    } catch { /* skip */ }
                }
            }
        }
    }

    if (Date.now() >= totalDeadline && pages.length < MAX_PAGES) {
        errors.push("Total crawl timeout reached");
    }

    return { pages, errors };
}

// ── Crawl Relevant Pages (for AI agent website search fallback) ──────

export async function crawlRelevantPages(
    websiteUrl: string,
    question: string
): Promise<CrawledPage[]> {
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
            .slice(0, 5); // Try top 5 links

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
