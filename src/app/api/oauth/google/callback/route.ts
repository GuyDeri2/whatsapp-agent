import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

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

  let tenantId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    tenantId = decoded.tenantId;
    if (!tenantId) throw new Error('missing tenantId');
  } catch {
    return NextResponse.redirect(`${appUrl}/?error=invalid_oauth_state`);
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
    console.error('Google token exchange failed:', errText);
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
  const { error: upsertError } = await admin.from('calendar_integrations').upsert(
    {
      tenant_id: tenantId,
      provider: 'google',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      calendar_id: calendarId,
      calendar_name: calendarName,
      is_active: true,
    },
    { onConflict: 'tenant_id,provider' }
  );

  if (upsertError) {
    console.error('Failed to save calendar integration:', upsertError);
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=calendar&error=save_failed`);
  }

  // Redirect back to the tenant calendar tab with success indicator
  return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=calendar&connected=google`);
}
