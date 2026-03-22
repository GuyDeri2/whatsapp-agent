/**
 * Website Crawler — fetches and extracts text from business websites.
 *
 * Features:
 * - Follows internal links (same domain), up to MAX_PAGES
 * - Prioritizes about/services/pricing/FAQ/contact pages
 * - SSRF protection: blocks private IPs
 * - Respects robots.txt (basic rules)
 * - Per-page and total timeouts
 */

import * as cheerio from "cheerio";
import { URL } from "url";
import dns from "dns/promises";
import net from "net";

// ── Constants ────────────────────────────────────────────────────────

const MAX_PAGES = 5;
const MAX_CONTENT_PER_PAGE = 3000;
const MAX_RESPONSE_BYTES = 500 * 1024; // 500KB
const PAGE_TIMEOUT_MS = 6_000;
const TOTAL_TIMEOUT_MS = 25_000;

// Priority keywords for page ranking (Hebrew + English)
const PRIORITY_KEYWORDS: { pattern: RegExp; score: number }[] = [
    { pattern: /about|אודות|מי\s*אנחנו/i, score: 10 },
    { pattern: /services|שירותים|מה\s*אנחנו\s*מציעים/i, score: 9 },
    { pattern: /pricing|price|מחירים|מחירון|תעריפים/i, score: 9 },
    { pattern: /faq|שאלות\s*נפוצות|שאלות\s*ותשובות/i, score: 8 },
    { pattern: /contact|צור\s*קשר|יצירת\s*קשר/i, score: 7 },
    { pattern: /menu|תפריט/i, score: 7 },
    { pattern: /hours|שעות\s*פעילות|זמני\s*פתיחה/i, score: 6 },
    { pattern: /products|מוצרים/i, score: 6 },
    { pattern: /gallery|גלריה/i, score: 3 },
    { pattern: /team|צוות/i, score: 4 },
    { pattern: /location|מיקום|הגעה|כתובת/i, score: 5 },
];

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
    // IPv6 loopback
    if (ip === "::1" || ip === "::ffff:127.0.0.1") return true;

    // IPv4 checks
    if (net.isIPv4(ip)) {
        const parts = ip.split(".").map(Number);
        if (parts[0] === 127) return true;                           // 127.x.x.x
        if (parts[0] === 10) return true;                            // 10.x.x.x
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16-31.x.x
        if (parts[0] === 192 && parts[1] === 168) return true;      // 192.168.x.x
        if (parts[0] === 169 && parts[1] === 254) return true;      // 169.254.x.x (link-local)
        if (parts[0] === 0) return true;                             // 0.x.x.x
    }

    return false;
}

async function resolveAndValidateHost(hostname: string): Promise<void> {
    // Block localhost aliases
    if (hostname === "localhost" || hostname === "0.0.0.0") {
        throw new Error(`SSRF blocked: hostname "${hostname}" is not allowed`);
    }

    // If it's already an IP, check directly
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) {
            throw new Error(`SSRF blocked: IP ${hostname} is private`);
        }
        return;
    }

    // Resolve DNS and check all returned IPs
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
        throw new Error(`DNS resolution failed for ${hostname}`);
    }

    for (const addr of allAddresses) {
        if (isPrivateIP(addr)) {
            throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${addr}`);
        }
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
    } catch {
        // Ignore robots.txt errors — proceed with crawl
    }
    return disallowed;
}

function isDisallowed(pathname: string, disallowedPaths: Set<string>): boolean {
    for (const path of disallowedPaths) {
        if (pathname.startsWith(path)) return true;
    }
    return false;
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
    // Homepage always gets a high base score
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

// ── HTML Extraction ──────────────────────────────────────────────────

function extractContent($: cheerio.CheerioAPI): string {
    // Remove non-content elements
    $("script, style, nav, header, footer, iframe, noscript, svg, form").remove();
    $("[aria-hidden='true']").remove();
    $(".cookie-banner, .popup, .modal, #cookie-consent").remove();

    // Extract text from body
    const text = $("body").text()
        .replace(/\s+/g, " ")    // collapse whitespace
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return text.substring(0, MAX_CONTENT_PER_PAGE);
}

function extractInternalLinks($: cheerio.CheerioAPI, baseUrl: URL): string[] {
    const links: string[] = [];
    $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;

        try {
            const resolved = new URL(href, baseUrl.origin);
            // Same domain only
            if (resolved.hostname !== baseUrl.hostname) return;
            // Skip anchors, mailto, tel, javascript
            if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
            // Skip file downloads
            if (/\.(pdf|zip|doc|docx|xls|xlsx|ppt|jpg|jpeg|png|gif|svg|mp3|mp4|avi)$/i.test(resolved.pathname)) return;

            // Normalize: remove hash, keep path+search
            resolved.hash = "";
            links.push(resolved.href);
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
                "User-Agent": "Mozilla/5.0 (compatible; WhatsAppAgentBot/1.0)",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "he,en;q=0.9",
            },
            redirect: "follow",
        });

        clearTimeout(timeout);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
            throw new Error(`Not HTML: ${contentType}`);
        }

        // Check content-length if available
        const contentLength = res.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
            throw new Error(`Response too large: ${contentLength} bytes`);
        }

        // Read body with size limit
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

// ── Main Crawl Function ──────────────────────────────────────────────

export async function crawlWebsite(startUrl: string): Promise<CrawlResult> {
    const errors: string[] = [];
    const pages: CrawledPage[] = [];
    const visited = new Set<string>();

    // Validate and normalize the start URL
    let baseUrl: URL;
    try {
        baseUrl = new URL(startUrl);
        if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
            return { pages: [], errors: ["URL must use http or https protocol"] };
        }
    } catch {
        return { pages: [], errors: ["Invalid URL format"] };
    }

    // SSRF check on the initial host
    try {
        await resolveAndValidateHost(baseUrl.hostname);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "SSRF check failed";
        return { pages: [], errors: [msg] };
    }

    // Fetch robots.txt
    const disallowed = await fetchRobotsTxt(baseUrl.origin);

    // Total timeout guard
    const totalDeadline = Date.now() + TOTAL_TIMEOUT_MS;

    // Collect candidate URLs (start with homepage)
    const candidateUrls: { url: string; score: number }[] = [
        { url: baseUrl.href, score: scorePage(baseUrl.href) },
    ];

    // Phase 1: Fetch homepage to discover links
    if (Date.now() < totalDeadline) {
        try {
            const { html, finalUrl } = await fetchPage(baseUrl.href);
            visited.add(finalUrl);
            visited.add(baseUrl.href);

            const $ = cheerio.load(html);
            const title = $("title").text().trim() || baseUrl.hostname;
            const content = extractContent($);

            if (content.length > 50) {
                pages.push({
                    url: finalUrl,
                    title,
                    content,
                    pageType: classifyPage(finalUrl, title),
                });
            }

            // Discover internal links
            const internalLinks = extractInternalLinks($, baseUrl);
            for (const link of internalLinks) {
                if (!visited.has(link)) {
                    const parsed = new URL(link);
                    if (!isDisallowed(parsed.pathname, disallowed)) {
                        candidateUrls.push({ url: link, score: scorePage(link) });
                    }
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`Homepage fetch failed: ${msg}`);
        }
    }

    // Phase 2: Crawl remaining pages in priority order
    // Sort by score descending, take top candidates
    candidateUrls.sort((a, b) => b.score - a.score);

    for (const candidate of candidateUrls) {
        if (pages.length >= MAX_PAGES) break;
        if (Date.now() >= totalDeadline) {
            errors.push("Total crawl timeout reached");
            break;
        }
        if (visited.has(candidate.url)) continue;
        visited.add(candidate.url);

        try {
            // SSRF check for each new URL (in case of redirects to different hosts)
            const parsed = new URL(candidate.url);
            await resolveAndValidateHost(parsed.hostname);

            const { html, finalUrl } = await fetchPage(candidate.url);
            visited.add(finalUrl);

            const $ = cheerio.load(html);
            const title = $("title").text().trim() || parsed.pathname;
            const content = extractContent($);

            if (content.length > 50) {
                pages.push({
                    url: finalUrl,
                    title,
                    content,
                    pageType: classifyPage(finalUrl, title),
                });
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`${candidate.url}: ${msg}`);
        }
    }

    return { pages, errors };
}

/**
 * Crawl specific pages from a website based on a question.
 * Used by the AI agent to search for answers on the business website.
 * Returns up to 3 most relevant pages.
 */
export async function crawlRelevantPages(
    websiteUrl: string,
    question: string
): Promise<CrawledPage[]> {
    // First crawl the homepage to get links
    let baseUrl: URL;
    try {
        baseUrl = new URL(websiteUrl);
    } catch {
        return [];
    }

    try {
        await resolveAndValidateHost(baseUrl.hostname);
    } catch {
        return [];
    }

    const pages: CrawledPage[] = [];
    const visited = new Set<string>();
    const deadline = Date.now() + 20_000; // 20s total for search crawl

    // Fetch homepage
    try {
        const { html, finalUrl } = await fetchPage(baseUrl.href);
        visited.add(finalUrl);
        visited.add(baseUrl.href);

        const $ = cheerio.load(html);
        const title = $("title").text().trim() || baseUrl.hostname;
        const content = extractContent($);

        if (content.length > 50) {
            pages.push({
                url: finalUrl,
                title,
                content,
                pageType: classifyPage(finalUrl, title),
            });
        }

        // Get internal links and score them based on question relevance
        const links = extractInternalLinks($, baseUrl);
        const questionLower = question.toLowerCase();

        // Score links by both priority keywords and question relevance
        const scored = links
            .filter(l => !visited.has(l))
            .map(l => {
                let score = scorePage(l);
                const lower = l.toLowerCase();
                // Boost if URL seems related to the question
                const words = questionLower.split(/\s+/).filter(w => w.length > 2);
                for (const word of words) {
                    if (lower.includes(word)) score += 5;
                }
                return { url: l, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 3); // Only try top 3 links

        for (const candidate of scored) {
            if (pages.length >= 3) break;
            if (Date.now() >= deadline) break;
            if (visited.has(candidate.url)) continue;
            visited.add(candidate.url);

            try {
                const parsed = new URL(candidate.url);
                await resolveAndValidateHost(parsed.hostname);

                const { html: pageHtml, finalUrl: pageFinalUrl } = await fetchPage(candidate.url);
                visited.add(pageFinalUrl);

                const $page = cheerio.load(pageHtml);
                const pageTitle = $page("title").text().trim() || parsed.pathname;
                const pageContent = extractContent($page);

                if (pageContent.length > 50) {
                    pages.push({
                        url: pageFinalUrl,
                        title: pageTitle,
                        content: pageContent,
                        pageType: classifyPage(pageFinalUrl, pageTitle),
                    });
                }
            } catch {
                // Skip failed pages silently during search
            }
        }
    } catch {
        // Homepage failed — return empty
    }

    return pages;
}
