import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import crypto from 'crypto';
import { encryptToken } from '@/lib/token-encryption';

export const dynamic = 'force-dynamic';

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// GET /api/oauth/google/callback — handle Google OAuth callback
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  // Handle OAuth errors (e.g. user denied access)
  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/?error=google_oauth_${error ?? 'missing_params'}`);
  }

  // Verify current user is logged in
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/?error=google_oauth_unauthorized`);
  }

  let tenantId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    tenantId = decoded.tenantId;
    if (!tenantId) throw new Error('missing tenantId');

    // Verify the callback user matches the user who initiated the OAuth flow
    if (decoded.userId !== user.id) {
      throw new Error('user mismatch');
    }

    // Verify HMAC signature to prevent state tampering (timing-safe)
    const stateSecret = process.env.OAUTH_STATE_SECRET;
    if (!stateSecret) throw new Error('OAUTH_STATE_SECRET not configured');
    const expectedSig = crypto.createHmac('sha256', stateSecret)
      .update(`${decoded.tenantId}:${decoded.userId}:${decoded.ts}`)
      .digest('hex');

    const sigBuf = Buffer.from(decoded.sig ?? '', 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error('invalid signature');
    }

    // Prevent replay attacks — state must not be older than 10 minutes
    if (Date.now() - decoded.ts > STATE_MAX_AGE_MS) {
      throw new Error('state expired');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.redirect(`${appUrl}/?error=invalid_oauth_state&debug=${encodeURIComponent(msg)}`);
  }

  const REDIRECT_URI = `${appUrl}/api/oauth/google/callback`;

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[Google OAuth] Token exchange failed:', tokenRes.status);
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=calendar&error=token_exchange`);
  }

  const tokens = await tokenRes.json();

  // Get calendar list to find primary calendar
  const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  let calendarId = 'primary';
  let calendarName = 'Google Calendar';

  if (calRes.ok) {
    const calList = await calRes.json();
    const primary = calList.items?.find((c: { primary?: boolean }) => c.primary) ?? calList.items?.[0];
    if (primary) {
      calendarId = primary.id ?? 'primary';
      calendarName = primary.summary ?? 'Google Calendar';
    }
  }

  // Upsert into calendar_integrations using service role (bypass RLS)
  const admin = getSupabaseAdmin();

  // Build upsert payload — only overwrite refresh_token if we received a new one
  const upsertData: Record<string, unknown> = {
    tenant_id: tenantId,
    provider: 'google',
    access_token: encryptToken(tokens.access_token),
    token_expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    calendar_id: calendarId,
    calendar_name: calendarName,
    is_active: true,
  };
  if (tokens.refresh_token) {
    upsertData.refresh_token = encryptToken(tokens.refresh_token);
  }

  const { error: upsertError } = await admin.from('calendar_integrations').upsert(
    upsertData,
    { onConflict: 'tenant_id,provider' }
  );

  if (upsertError) {
    console.error('[Google OAuth] Failed to save calendar integration:', upsertError.message);
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=calendar&error=save_failed`);
  }
  // Redirect back to the tenant calendar tab with success indicator
  return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=calendar&connected=google`);
}
