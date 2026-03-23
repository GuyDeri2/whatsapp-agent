/**
 * API route: Apply website analysis results to a tenant.
 * POST /api/tenants/[tenantId]/website-crawl/apply
 *
 * Updates tenant profile fields and inserts knowledge base entries
 * extracted from the website crawl.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WebsiteAnalysis } from "@/lib/website-analyzer";

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

    // Verify tenant ownership
    const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .select("id")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (tenantError || !tenant)
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    // Parse body
    let body: { analysis?: WebsiteAnalysis; website_url?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { analysis, website_url } = body;
    if (!analysis || typeof analysis !== "object") {
        return NextResponse.json({ error: "analysis object is required" }, { status: 400 });
    }

    // Validate and sanitize analysis fields
    const MAX_TEXT_LEN = 2000;
    const MAX_PROMPT_LEN = 5000;
    const MAX_KNOWLEDGE_ENTRIES = 200;

    // Sanitize string fields
    const sanitizeStr = (val: unknown, maxLen: number): string | null => {
        if (typeof val !== "string") return null;
        return val.trim().substring(0, maxLen) || null;
    };

    analysis.business_name = sanitizeStr(analysis.business_name, 200);
    analysis.description = sanitizeStr(analysis.description, MAX_TEXT_LEN);
    analysis.products_services = sanitizeStr(analysis.products_services, MAX_TEXT_LEN);
    analysis.target_customers = sanitizeStr(analysis.target_customers, MAX_TEXT_LEN);
    analysis.operating_hours = sanitizeStr(analysis.operating_hours, 500);
    analysis.location = sanitizeStr(analysis.location, 500);
    analysis.contact_phone = sanitizeStr(analysis.contact_phone, 200);
    analysis.contact_email = sanitizeStr(analysis.contact_email, 200);
    analysis.suggested_agent_prompt = sanitizeStr(analysis.suggested_agent_prompt, MAX_PROMPT_LEN);

    // Limit and validate knowledge_entries
    if (Array.isArray(analysis.knowledge_entries)) {
        analysis.knowledge_entries = analysis.knowledge_entries
            .slice(0, MAX_KNOWLEDGE_ENTRIES)
            .filter((e: unknown): e is { category: string; question: string; answer: string } =>
                typeof e === "object" && e !== null &&
                typeof (e as Record<string, unknown>).question === "string" &&
                typeof (e as Record<string, unknown>).answer === "string"
            )
            .map((e: { category?: string; question: string; answer: string }) => ({
                category: (typeof e.category === "string" ? e.category : "general").substring(0, 100),
                question: e.question.substring(0, 500),
                answer: e.answer.substring(0, MAX_TEXT_LEN),
            }));
    } else {
        analysis.knowledge_entries = [];
    }

    // Limit and validate products_with_prices
    if (Array.isArray(analysis.products_with_prices)) {
        analysis.products_with_prices = analysis.products_with_prices
            .slice(0, MAX_KNOWLEDGE_ENTRIES)
            .filter((p: unknown): p is { name: string; price: string; description?: string } =>
                typeof p === "object" && p !== null &&
                typeof (p as Record<string, unknown>).name === "string" &&
                typeof (p as Record<string, unknown>).price === "string"
            )
            .map((p: { name: string; price: string; description?: string }) => ({
                name: p.name.substring(0, 200),
                price: p.price.substring(0, 100),
                ...(typeof p.description === "string" ? { description: p.description.substring(0, 500) } : {}),
            }));
    } else {
        analysis.products_with_prices = [];
    }

    // Validate website_url if provided
    if (website_url !== undefined) {
        if (typeof website_url !== "string" || website_url.length > 2000) {
            return NextResponse.json({ error: "Invalid website_url" }, { status: 400 });
        }
        try {
            const parsedWUrl = new URL(website_url);
            if (parsedWUrl.protocol !== "http:" && parsedWUrl.protocol !== "https:") {
                return NextResponse.json({ error: "website_url must use http or https" }, { status: 400 });
            }
        } catch {
            return NextResponse.json({ error: "Invalid website_url format" }, { status: 400 });
        }
    }

    // 1. Update tenant profile with extracted data
    const tenantUpdates: Record<string, unknown> = {
        website_last_crawled_at: new Date().toISOString(),
    };

    if (website_url) tenantUpdates.website_url = website_url;
    if (analysis.business_name) tenantUpdates.business_name = analysis.business_name;
    if (analysis.description) tenantUpdates.description = analysis.description;
    if (analysis.products_services) tenantUpdates.products = analysis.products_services;
    if (analysis.target_customers) tenantUpdates.target_customers = analysis.target_customers;
    if (analysis.suggested_agent_prompt) tenantUpdates.agent_prompt = analysis.suggested_agent_prompt;

    const { error: updateError } = await supabase
        .from("tenants")
        .update(tenantUpdates)
        .eq("id", tenantId)
        .eq("owner_id", user.id);

    if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 2. Delete existing website-sourced knowledge entries
    const { error: deleteError } = await supabase
        .from("knowledge_base")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("source", "website");

    if (deleteError) {
        console.error(`[${tenantId}] Failed to delete old website knowledge:`, deleteError);
        // Non-fatal — continue with insert
    }

    // 3. Insert new knowledge entries from analysis
    const rows: Array<{
        tenant_id: string;
        category: string;
        question: string;
        answer: string;
        source: string;
    }> = [];

    // Add Q&A knowledge entries
    if (analysis.knowledge_entries && analysis.knowledge_entries.length > 0) {
        for (const entry of analysis.knowledge_entries) {
            rows.push({
                tenant_id: tenantId,
                category: entry.category || "general",
                question: entry.question,
                answer: entry.answer,
                source: "website",
            });
        }
    }

    // Add structured fields as knowledge entries too
    if (analysis.operating_hours) {
        rows.push({ tenant_id: tenantId, category: "hours", question: "מה שעות הפתיחה?", answer: analysis.operating_hours, source: "website" });
    }
    if (analysis.location) {
        rows.push({ tenant_id: tenantId, category: "location", question: "איפה אתם נמצאים?", answer: analysis.location, source: "website" });
    }
    if (analysis.contact_phone) {
        rows.push({ tenant_id: tenantId, category: "contact", question: "מה מספר הטלפון שלכם?", answer: analysis.contact_phone, source: "website" });
    }
    if (analysis.contact_email) {
        rows.push({ tenant_id: tenantId, category: "contact", question: "מה המייל שלכם?", answer: analysis.contact_email, source: "website" });
    }

    // Add product+price entries as knowledge
    if (analysis.products_with_prices && analysis.products_with_prices.length > 0) {
        for (const product of analysis.products_with_prices) {
            const answer = product.description
                ? `${product.price} — ${product.description}`
                : product.price;
            rows.push({
                tenant_id: tenantId,
                category: "pricing",
                question: `כמה עולה ${product.name}?`,
                answer,
                source: "website",
            });
        }
    }

    let insertedCount = 0;
    if (rows.length > 0) {
        const { error: insertError } = await supabase
            .from("knowledge_base")
            .insert(rows);

        if (insertError) {
            console.error(`[${tenantId}] Failed to insert website knowledge:`, insertError);
            return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        insertedCount = rows.length;
    }

    return NextResponse.json({
        success: true,
        tenant_updated: true,
        knowledge_entries_added: insertedCount,
    });
}
