import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ tenantId: string }> };

async function verifyTenant(tenantId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, tenant: null };
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('id', tenantId).eq('owner_id', user.id).single();
  return { supabase, user, tenant };
}

// GET /api/tenants/[tenantId]/meetings?status=confirmed&limit=20
export async function GET(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

  let query = supabase
    .from('meetings')
    .select('id, customer_name, customer_phone, start_time, end_time, status, meeting_type, notes')
    .eq('tenant_id', tenantId)
    .order('start_time', { ascending: true })
    .limit(limit);

  if (status) query = query.eq('status', status);

  // Only return upcoming meetings by default
  query = query.gte('start_time', new Date().toISOString());

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// POST /api/tenants/[tenantId]/meetings
// Body: { customer_name, customer_phone, start_time, end_time, conversation_id?, meeting_type?, notes? }
export async function POST(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { customer_name, customer_phone, start_time, end_time, conversation_id, meeting_type, notes } = body;

  if (!customer_phone || !start_time || !end_time) {
    return NextResponse.json({ error: 'customer_phone, start_time, end_time are required' }, { status: 400 });
  }

  // Check for overlapping confirmed meetings to prevent double-booking
  const { data: conflicts } = await supabase
    .from('meetings')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .lt('start_time', end_time)
    .gt('end_time', start_time)
    .limit(1);

  if (conflicts && conflicts.length > 0) {
    return NextResponse.json({ error: 'Time slot already booked' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('meetings')
    .insert({
      tenant_id: tenantId,
      customer_name: customer_name ?? null,
      customer_phone,
      start_time,
      end_time,
      conversation_id: conversation_id ?? null,
      meeting_type: meeting_type ?? null,
      notes: notes ?? null,
      status: 'confirmed',
    })
    .select('id, customer_name, customer_phone, start_time, end_time, status, meeting_type')
    .single();

  // Handle unique constraint violation (race condition — another request booked it between check and insert)
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Time slot already booked' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
