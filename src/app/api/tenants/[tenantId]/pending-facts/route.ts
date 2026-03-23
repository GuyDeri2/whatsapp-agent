/**
 * API route: Manage pending learned facts (approve/reject).
 *
 * GET  — Fetch pending facts for a tenant
 * POST — Approve or reject a pending fact
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface PendingFact {
    fact: string;
    learned_at: string;
}

// GET /api/tenants/[tenantId]/pending-facts
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    // Verify tenant ownership
    const { data: tenant } = await supabase
        .from("tenants")
        .select("pending_learned_facts")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!tenant) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    return NextResponse.json({ facts: tenant.pending_learned_facts || [] });
}

// POST /api/tenants/[tenantId]/pending-facts
// Body: { action: "approve" | "reject" | "approve_all" | "reject_all", index?: number, edited_fact?: string }
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tenantId } = await params;

    let body: { action: string; index?: number; edited_fact?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { action, index, edited_fact } = body;

    if (!["approve", "reject", "approve_all", "reject_all"].includes(action)) {
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Verify tenant ownership and get current state
    const { data: tenant } = await supabase
        .from("tenants")
        .select("agent_prompt, pending_learned_facts")
        .eq("id", tenantId)
        .eq("owner_id", user.id)
        .single();

    if (!tenant) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const pending: PendingFact[] = tenant.pending_learned_facts || [];
    const currentPrompt = tenant.agent_prompt || "";

    if (action === "approve_all") {
        if (pending.length === 0) {
            return NextResponse.json({ success: true, message: "Nothing to approve" });
        }
        const factsText = pending.map(p => `- ${p.fact}`).join("\n");
        const separator = currentPrompt.includes("--- נלמד אוטומטית ---") ? "\n" : "\n\n--- נלמד אוטומטית ---\n";
        const updatedPrompt = currentPrompt + separator + factsText;

        if (updatedPrompt.length > 10000) {
            return NextResponse.json({ error: "יכולות הסוכן ארוכות מדי" }, { status: 400 });
        }

        const { error } = await supabase.from("tenants").update({
            agent_prompt: updatedPrompt,
            pending_learned_facts: [],
        }).eq("id", tenantId);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, approved: pending.length });
    }

    if (action === "reject_all") {
        const { error } = await supabase.from("tenants").update({
            pending_learned_facts: [],
        }).eq("id", tenantId);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    }

    // Single approve/reject needs index
    if (index === undefined || index < 0 || index >= pending.length) {
        return NextResponse.json({ error: "Invalid index" }, { status: 400 });
    }

    if (action === "approve") {
        const factText = edited_fact || pending[index].fact;
        const factLine = `- ${factText}`;
        const separator = currentPrompt.includes("--- נלמד אוטומטית ---") ? "\n" : "\n\n--- נלמד אוטומטית ---\n";
        const updatedPrompt = currentPrompt + separator + factLine;

        if (updatedPrompt.length > 10000) {
            return NextResponse.json({ error: "יכולות הסוכן ארוכות מדי" }, { status: 400 });
        }

        const updatedPending = pending.filter((_, i) => i !== index);
        const { error } = await supabase.from("tenants").update({
            agent_prompt: updatedPrompt,
            pending_learned_facts: updatedPending,
        }).eq("id", tenantId);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    }

    if (action === "reject") {
        const updatedPending = pending.filter((_, i) => i !== index);
        const { error } = await supabase.from("tenants").update({
            pending_learned_facts: updatedPending,
        }).eq("id", tenantId);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
