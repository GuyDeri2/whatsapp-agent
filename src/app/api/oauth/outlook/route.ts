import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// GET /api/oauth/outlook?tenantId=... — initiate Microsoft Outlook OAuth flow
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  // Authenticate user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify tenant ownership
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .eq('owner_id', user.id)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
  if (!MICROSOFT_CLIENT_ID) {
    return NextResponse.json({ error: 'Outlook OAuth not configured' }, { status: 500 });
  }

  const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/outlook/callback`;
  const scope = encodeURIComponent(
    'https://graph.microsoft.com/Calendars.ReadWrite offline_access'
  );

  // Sign state with HMAC to prevent tampering
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  if (!stateSecret) {
    return NextResponse.json({ error: 'OAUTH_STATE_SECRET is not configured' }, { status: 500 });
  }
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', stateSecret)
    .update(`${tenantId}:${user.id}:${ts}`)
    .digest('hex');

  const state = Buffer.from(JSON.stringify({ tenantId, userId: user.id, ts, sig })).toString('base64');

  const oauthUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` +
    `?client_id=${MICROSOFT_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&response_mode=query` +
    `&state=${state}`;

  return NextResponse.redirect(oauthUrl);
}
