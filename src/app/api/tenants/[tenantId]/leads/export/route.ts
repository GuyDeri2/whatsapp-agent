import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, lead_webhook_url')
    .eq('id', tenantId)
    .eq('owner_id', user.id)
    .single();
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!tenant.lead_webhook_url) return NextResponse.json({ error: 'No webhook URL configured' }, { status: 400 });

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, email, summary, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Validate URL
  try {
    const url = new URL(tenant.lead_webhook_url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
  } catch {
    return NextResponse.json({ error: 'Invalid webhook URL' }, { status: 400 });
  }

  // Send all leads in one payload
  const res = await fetch(tenant.lead_webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads, exported_at: new Date().toISOString(), total: leads?.length ?? 0 }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Webhook returned ${res.status}` }, { status: 502 });
  }

  return NextResponse.json({ success: true, sent: leads?.length ?? 0 });
}
