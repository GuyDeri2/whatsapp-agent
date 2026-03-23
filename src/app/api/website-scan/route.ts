/**
 * Standalone website scan — no tenant required.
 * POST /api/website-scan { url: string }
 * Used during "Add Business" flow to pre-fill fields before tenant creation.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crawlWebsite } from "@/lib/website-crawler";
import { analyzeWebsiteContent } from "@/lib/website-analyzer";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { url?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { url } = body;
    if (!url || typeof url !== "string")
        return NextResponse.json({ error: "url is required" }, { status: 400 });

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
        return NextResponse.json({ error: "URL must use http or https" }, { status: 400 });

    if (parsedUrl.username || parsedUrl.password)
        return NextResponse.json({ error: "URL must not contain credentials" }, { status: 400 });

    if (url.length > 2000)
        return NextResponse.json({ error: "URL too long" }, { status: 400 });

    // Crawl
    let crawlResult;
    try {
        crawlResult = await crawlWebsite(url);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `crawl_failed: ${msg}` }, { status: 500 });
    }

    if (crawlResult.pages.length === 0) {
        return NextResponse.json(
            { error: "Could not extract content from the website", errors: crawlResult.errors },
            { status: 422 }
        );
    }

    // Analyze
    try {
        const analysis = await analyzeWebsiteContent(crawlResult.pages);
        return NextResponse.json({ analysis, pages_crawled: crawlResult.pages.length });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `analysis_failed: ${msg}` }, { status: 500 });
    }
}
