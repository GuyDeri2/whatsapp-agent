import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ tenantId: string }> };

const VALID_PROVIDERS = ['google', 'outlook', 'calendly', 'apple'] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

async function verifyTenant(tenantId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, tenant: null };
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('id', tenantId).eq('owner_id', user.id).single();
  return { supabase, user, tenant };
}

// GET /api/tenants/[tenantId]/calendar-integration
// Returns all provider statuses: { google, outlook, calendly, apple }
export async function GET(_req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data } = await supabase
    .from('calendar_integrations')
    .select('provider, calendar_name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  const byProvider = Object.fromEntries(
    (data ?? []).map((row: { provider: string; calendar_name: string | null }) => [
      row.provider,
      row.calendar_name,
    ])
  );

  const response: Record<Provider, { connected: boolean; calendar_name: string | null }> = {
    google:   { connected: 'google'   in byProvider, calendar_name: byProvider['google']   ?? null },
    outlook:  { connected: 'outlook'  in byProvider, calendar_name: byProvider['outlook']  ?? null },
    calendly: { connected: 'calendly' in byProvider, calendar_name: byProvider['calendly'] ?? null },
    apple:    { connected: 'apple'    in byProvider, calendar_name: byProvider['apple']    ?? null },
  };

  return NextResponse.json(response);
}

// DELETE /api/tenants/[tenantId]/calendar-integration?provider=google|outlook|calendly|apple
export async function DELETE(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { supabase, tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const provider = url.searchParams.get('provider');

  if (!provider || !(VALID_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: `provider query param must be one of: ${VALID_PROVIDERS.join(', ')}` },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from('calendar_integrations')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', provider);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
