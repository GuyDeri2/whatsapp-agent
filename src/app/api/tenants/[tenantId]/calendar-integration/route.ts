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

// GET /api/tenants/[tenantId]/calendar-integration
export async function GET(_req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data } = await supabase
    .from('calendar_integrations')
    .select('provider, calendar_name, is_active')
    .eq('tenant_id', tenantId)
    .eq('provider', 'google')
    .eq('is_active', true)
    .single();

  return NextResponse.json({
    connected: !!data,
    calendar_name: data?.calendar_name ?? null,
  });
}

// DELETE /api/tenants/[tenantId]/calendar-integration
export async function DELETE(_req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase
    .from('calendar_integrations')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', 'google');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
