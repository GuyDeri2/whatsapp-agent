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

export async function GET(_req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('availability_rules')
    .select('id, day_of_week, start_time, end_time')
    .eq('tenant_id', tenantId)
    .order('day_of_week')
    .order('start_time');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rules: Record<string, { id: string; start_time: string; end_time: string }[]> = {};
  for (let d = 0; d <= 6; d++) rules[String(d)] = [];
  for (const row of data ?? []) {
    rules[String(row.day_of_week)].push({ id: row.id, start_time: row.start_time, end_time: row.end_time });
  }

  return NextResponse.json({ rules });
}

export async function POST(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { day_of_week, slots } = body as { day_of_week: number; slots: { start_time: string; end_time: string }[] };

  if (typeof day_of_week !== 'number' || day_of_week < 0 || day_of_week > 6) {
    return NextResponse.json({ error: 'Invalid day_of_week' }, { status: 400 });
  }

  const { error: delError } = await supabase
    .from('availability_rules')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('day_of_week', day_of_week);

  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  if (slots && slots.length > 0) {
    if (slots.length > 20) {
      return NextResponse.json({ error: 'Maximum 20 slots per day' }, { status: 400 });
    }
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const s of slots as { start_time: string; end_time: string }[]) {
      if (!timeRegex.test(s.start_time) || !timeRegex.test(s.end_time)) {
        return NextResponse.json({ error: `Invalid time format: ${s.start_time}-${s.end_time}. Expected HH:MM (00:00-23:59)` }, { status: 400 });
      }
      if (s.end_time <= s.start_time) {
        return NextResponse.json({ error: `end_time (${s.end_time}) must be after start_time (${s.start_time})` }, { status: 400 });
      }
    }
    const rows = slots.map((s: { start_time: string; end_time: string }) => ({
      tenant_id: tenantId,
      day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    }));
    const { error: insError } = await supabase.from('availability_rules').insert(rows);
    if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
