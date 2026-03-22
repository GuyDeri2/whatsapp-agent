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

    // 1. Update tenant profile with extracted data
    const tenantUpdates: Record<string, unknown> = {
        website_last_crawled_at: new Date().toISOString(),
    };

    if (website_url) tenantUpdates.website_url = website_url;
    if (analysis.business_name) tenantUpdates.business_name = analysis.business_name;
    if (analysis.description) tenantUpdates.description = analysis.description;
    if (analysis.products_services) tenantUpdates.products = analysis.products_services;
    if (analysis.target_customers) tenantUpdates.target_customers = analysis.target_customers;

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
    let insertedCount = 0;
    if (analysis.knowledge_entries && analysis.knowledge_entries.length > 0) {
        const rows = analysis.knowledge_entries.map((entry) => ({
            tenant_id: tenantId,
            category: entry.category || "general",
            question: entry.question,
            answer: entry.answer,
            source: "website",
        }));

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
