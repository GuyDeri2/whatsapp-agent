import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// GET /api/oauth/google?tenantId=... — initiate Google OAuth flow
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

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/google/callback`;
  const scope = encodeURIComponent(
    'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'
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
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${state}`;

  return NextResponse.redirect(oauthUrl);
}
