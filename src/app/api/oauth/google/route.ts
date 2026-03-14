import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/oauth/google?tenantId=... — initiate Google OAuth flow
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/google/callback`;
  const scope = encodeURIComponent(
    'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'
  );

  // Encode tenantId in state for retrieval in callback
  const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64');

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
