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

function dbToClient(row: Record<string, unknown>) {
  return {
    scheduling_enabled: row.scheduling_enabled ?? false,
    meeting_duration: row.duration_minutes ?? 30,
    buffer_between: row.buffer_minutes ?? 0,
    timezone: row.timezone ?? 'Asia/Jerusalem',
    min_notice_hours: row.booking_notice_hours ?? 2,
    booking_window_days: row.booking_window_days ?? 14,
    meeting_label: row.meeting_type_label ?? 'פגישה',
  };
}

export async function GET(_req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data } = await supabase
    .from('meeting_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  return NextResponse.json(dbToClient((data as Record<string, unknown>) ?? {}));
}

export async function PATCH(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();

  const update: Record<string, unknown> = { tenant_id: tenantId, updated_at: new Date().toISOString() };
  if (body.scheduling_enabled !== undefined) update.scheduling_enabled = body.scheduling_enabled;
  if (body.meeting_duration !== undefined) {
    const v = Number(body.meeting_duration);
    if (!Number.isInteger(v) || v < 5 || v > 480) return NextResponse.json({ error: 'Invalid meeting duration' }, { status: 400 });
    update.duration_minutes = v;
  }
  if (body.buffer_between !== undefined) {
    const v = Number(body.buffer_between);
    if (!Number.isInteger(v) || v < 0 || v > 120) return NextResponse.json({ error: 'Invalid buffer time' }, { status: 400 });
    update.buffer_minutes = v;
  }
  if (body.timezone !== undefined) update.timezone = body.timezone;
  if (body.min_notice_hours !== undefined) {
    const v = Number(body.min_notice_hours);
    if (!Number.isInteger(v) || v < 0 || v > 168) return NextResponse.json({ error: 'Invalid notice hours' }, { status: 400 });
    update.booking_notice_hours = v;
  }
  if (body.booking_window_days !== undefined) {
    const v = Number(body.booking_window_days);
    if (!Number.isInteger(v) || v < 1 || v > 90) return NextResponse.json({ error: 'Invalid booking window' }, { status: 400 });
    update.booking_window_days = v;
  }
  if (body.meeting_label !== undefined) update.meeting_type_label = body.meeting_label;

  const { error } = await supabase
    .from('meeting_settings')
    .upsert(update, { onConflict: 'tenant_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
