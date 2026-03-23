import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivateIP(ip: string): boolean {
  // IPv4 private/reserved ranges
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return true;
  // IPv6 loopback and link-local
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd')) return true;
  return false;
}

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

  // Fix #1: Add limit to export query
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, email, summary, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(5000);

  // Fix #5: Generic error message
  if (error) return NextResponse.json({ error: 'Failed to fetch leads for export' }, { status: 500 });

  // Validate URL
  let url: URL;
  try {
    url = new URL(tenant.lead_webhook_url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
  } catch {
    return NextResponse.json({ error: 'Invalid webhook URL' }, { status: 400 });
  }

  // Fix #3: SSRF protection — DNS resolution + private IP check
  const hostname = url.hostname;

  // Check hostname string first (catches localhost etc.)
  if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1') {
    return NextResponse.json({ error: 'Webhook URL points to a private/internal address' }, { status: 400 });
  }

  // Resolve DNS and validate all resolved IPs are public
  try {
    let ips: string[];
    if (isIP(hostname)) {
      ips = [hostname];
    } else {
      const resolved = await dns.resolve4(hostname).catch(() => [] as string[]);
      const resolved6 = await dns.resolve6(hostname).catch(() => [] as string[]);
      ips = [...resolved, ...resolved6];
    }

    if (ips.length === 0) {
      return NextResponse.json({ error: 'Could not resolve webhook URL hostname' }, { status: 400 });
    }

    if (ips.some(isPrivateIP)) {
      return NextResponse.json({ error: 'Webhook URL points to a private/internal address' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Could not resolve webhook URL hostname' }, { status: 400 });
  }

  // Fix #2: Add timeout to webhook fetch
  // Fix #4: Consume response body
  try {
    const res = await fetch(tenant.lead_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads, exported_at: new Date().toISOString(), total: leads?.length ?? 0 }),
      signal: AbortSignal.timeout(10_000),
    });

    // Always consume the response body to free resources
    await res.text();

    if (!res.ok) {
      return NextResponse.json({ error: 'Webhook request failed' }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: 'Webhook request failed or timed out' }, { status: 502 });
  }

  return NextResponse.json({ success: true, sent: leads?.length ?? 0 });
}
