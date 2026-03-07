import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: adminProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (adminProfile?.role !== 'admin') {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ profiles });
}

export async function PATCH(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: adminProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (adminProfile?.role !== 'admin') {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { profileId, approval_status } = body;

    if (!profileId || !['approved', 'rejected', 'pending'].includes(approval_status)) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { error } = await supabase
        .from('profiles')
        .update({ approval_status })
        .eq('id', profileId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    
    return NextResponse.json({ success: true });
}
