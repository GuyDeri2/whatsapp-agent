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
  if (body.meeting_duration !== undefined) update.duration_minutes = body.meeting_duration;
  if (body.buffer_between !== undefined) update.buffer_minutes = body.buffer_between;
  if (body.timezone !== undefined) update.timezone = body.timezone;
  if (body.min_notice_hours !== undefined) update.booking_notice_hours = body.min_notice_hours;
  if (body.booking_window_days !== undefined) update.booking_window_days = body.booking_window_days;
  if (body.meeting_label !== undefined) update.meeting_type_label = body.meeting_label;

  const { error } = await supabase
    .from('meeting_settings')
    .upsert(update, { onConflict: 'tenant_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
