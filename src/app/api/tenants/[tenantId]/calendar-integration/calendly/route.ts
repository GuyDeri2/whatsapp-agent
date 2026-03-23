import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Params = { params: Promise<{ tenantId: string }> };

async function verifyTenant(tenantId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, tenant: null };
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('id', tenantId).eq('owner_id', user.id).single();
  return { user, tenant };
}

// PATCH /api/tenants/[tenantId]/calendar-integration/calendly
// Body: { webhook_url: string }
// Stores the Calendly webhook URL (no OAuth needed).
export async function PATCH(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { webhook_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { webhook_url } = body;
  if (!webhook_url || typeof webhook_url !== 'string' || !webhook_url.trim()) {
    return NextResponse.json({ error: 'webhook_url is required' }, { status: 400 });
  }

  // Validate URL is HTTPS only
  try {
    const parsed = new URL(webhook_url.trim());
    if (parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'webhook_url must use HTTPS' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'webhook_url must be a valid URL' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('calendar_integrations').upsert(
    {
      tenant_id: tenantId,
      provider: 'calendly',
      calendar_id: webhook_url.trim(),
      calendar_name: 'Calendly',
      is_active: true,
    },
    { onConflict: 'tenant_id,provider' }
  );

  if (error) {
    console.error('Failed to save Calendly integration:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
