import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ tenantId: string; meetingId: string }> };

async function verifyTenant(tenantId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, tenant: null };
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('id', tenantId).eq('owner_id', user.id).single();
  return { supabase, user, tenant };
}

// PATCH /api/tenants/[tenantId]/meetings/[meetingId]
// Body: { status: 'cancelled' | 'rescheduled' } or { start_time, end_time }
export async function PATCH(req: Request, { params }: Params) {
  const { tenantId, meetingId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();

  // Validate status against allowed enum values
  const VALID_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `Invalid status. Allowed values: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  const allowed = ['status', 'start_time', 'end_time', 'notes'];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { error } = await supabase
    .from('meetings')
    .update(update)
    .eq('id', meetingId)
    .eq('tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/tenants/[tenantId]/meetings/[meetingId]
export async function DELETE(_req: Request, { params }: Params) {
  const { tenantId, meetingId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase
    .from('meetings')
    .delete()
    .eq('id', meetingId)
    .eq('tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
