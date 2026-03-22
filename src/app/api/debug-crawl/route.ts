/**
 * TEMPORARY debug endpoint — test crawl pipeline without auth.
 * DELETE THIS after debugging.
 * GET /api/debug-crawl?url=https://example.com
 * GET /api/debug-crawl?test=deepseek  — test DeepSeek connectivity
 */

import { NextRequest, NextResponse } from "next/server";
import { crawlWebsite } from "@/lib/website-crawler";
import { analyzeWebsiteContent } from "@/lib/website-analyzer";
import OpenAI from "openai";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
    const test = req.nextUrl.searchParams.get("test");

    // Simple DeepSeek connectivity test
    if (test === "deepseek") {
        const t0 = Date.now();
        try {
            const hasKey = !!process.env.DEEPSEEK_API_KEY;
            const keyLen = process.env.DEEPSEEK_API_KEY?.length ?? 0;
            if (!hasKey) {
                return NextResponse.json({ error: "DEEPSEEK_API_KEY not set" });
            }
            const client = new OpenAI({
                apiKey: process.env.DEEPSEEK_API_KEY,
                baseURL: "https://api.deepseek.com",
            });
            const r = await client.chat.completions.create({
                model: "deepseek-chat",
                messages: [{ role: "user", content: "Say hello" }],
                max_tokens: 10,
            });
            return NextResponse.json({
                ok: true,
                ms: Date.now() - t0,
                reply: r.choices[0].message.content,
                keyLen,
            });
        } catch (err) {
            return NextResponse.json({
                ok: false,
                ms: Date.now() - t0,
                error: err instanceof Error ? err.message : "unknown",
            }, { status: 500 });
        }
    }

    const url = req.nextUrl.searchParams.get("url");
    if (!url) {
        return NextResponse.json({ error: "url param required" }, { status: 400 });
    }

    const t0 = Date.now();
    const result: Record<string, unknown> = { url };

    // Step 1: Crawl
    try {
        const crawlResult = await crawlWebsite(url);
        result.crawl_ms = Date.now() - t0;
        result.pages = crawlResult.pages.length;
        result.crawl_errors = crawlResult.errors;

        if (crawlResult.pages.length === 0) {
            return NextResponse.json({ ...result, error: "no_pages" }, { status: 422 });
        }

        // Step 2: Analyze
        const t1 = Date.now();
        try {
            const analysis = await analyzeWebsiteContent(crawlResult.pages);
            result.analysis_ms = Date.now() - t1;
            result.total_ms = Date.now() - t0;
            result.business_name = analysis.business_name;
            result.knowledge_count = analysis.knowledge_entries.length;
            return NextResponse.json(result);
        } catch (err) {
            result.analysis_ms = Date.now() - t1;
            result.total_ms = Date.now() - t0;
            result.error = `analysis: ${err instanceof Error ? err.message : "unknown"}`;
            return NextResponse.json(result, { status: 500 });
        }
    } catch (err) {
        result.crawl_ms = Date.now() - t0;
        result.error = `crawl: ${err instanceof Error ? err.message : "unknown"}`;
        return NextResponse.json(result, { status: 500 });
    }
}
