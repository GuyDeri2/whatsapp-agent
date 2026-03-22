/**
 * API route: Crawl and analyze a business website.
 * POST /api/tenants/[tenantId]/website-crawl
 *
 * Rate limit: 10 scans/month per tenant (+ bonus granted by admin).
 * Admins are exempt from the limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crawlWebsite } from "@/lib/website-crawler";
import { analyzeWebsiteContent } from "@/lib/website-analyzer";

export const maxDuration = 300;

const MONTHLY_SCAN_LIMIT = 10;

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    // Verify tenant ownership + get scan counters
    const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .select("id, website_scans_used, website_scans_month, website_scans_bonus")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (tenantError || !tenant)
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    // Check if user is admin (admins bypass scan limits)
    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    const isAdmin = profile?.role === "admin";

    // Enforce monthly scan limit (non-admins only)
    if (!isAdmin) {
        const currentMonth = new Date().toISOString().substring(0, 7); // "YYYY-MM"
        let scansUsed = tenant.website_scans_used ?? 0;
        const scansMonth = tenant.website_scans_month ?? "";
        const scansBonus = tenant.website_scans_bonus ?? 0;

        // Reset counter if new month
        if (scansMonth !== currentMonth) {
            scansUsed = 0;
            await supabase
                .from("tenants")
                .update({ website_scans_used: 0, website_scans_month: currentMonth, website_scans_bonus: 0 })
                .eq("id", tenantId);
        }

        const limit = MONTHLY_SCAN_LIMIT + scansBonus;
        if (scansUsed >= limit) {
            return NextResponse.json({
                error: "scan_limit_reached",
                message: `הגעת למגבלת ${limit} סריקות החודש. פנה למנהל המערכת לקבלת סריקות נוספות.`,
                scans_used: scansUsed,
                scans_limit: limit,
            }, { status: 429 });
        }
    }

    // Parse and validate URL
    let body: { url?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { url } = body;
    if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return NextResponse.json({ error: "URL must use http or https" }, { status: 400 });
    }

    // Block credentials in URL
    if (parsedUrl.username || parsedUrl.password) {
        return NextResponse.json({ error: "URL must not contain credentials" }, { status: 400 });
    }

    // URL length sanity check
    if (url.length > 2000) {
        return NextResponse.json({ error: "URL too long" }, { status: 400 });
    }

    // 1. Crawl the website
    let crawlResult;
    try {
        crawlResult = await crawlWebsite(url);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json(
            { error: `crawl_failed: ${msg}`, step: "crawl" },
            { status: 500 }
        );
    }

    if (crawlResult.pages.length === 0) {
        return NextResponse.json(
            {
                error: "Could not extract content from the website",
                errors: crawlResult.errors,
            },
            { status: 422 }
        );
    }

    // 2. Analyze with AI
    try {
        const analysis = await analyzeWebsiteContent(crawlResult.pages);

        // Increment scan counter (after successful scan)
        const currentMonth = new Date().toISOString().substring(0, 7);
        const currentUsed = (tenant.website_scans_month === currentMonth)
            ? (tenant.website_scans_used ?? 0)
            : 0;
        await supabase
            .from("tenants")
            .update({
                website_scans_used: currentUsed + 1,
                website_scans_month: currentMonth,
            })
            .eq("id", tenantId);

        return NextResponse.json({
            analysis,
            pages_crawled: crawlResult.pages.length,
            errors: crawlResult.errors,
            scans_used: currentUsed + 1,
            scans_limit: MONTHLY_SCAN_LIMIT + (tenant.website_scans_bonus ?? 0),
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json(
            { error: `analysis_failed: ${msg}`, step: "analysis" },
            { status: 500 }
        );
    }
}
