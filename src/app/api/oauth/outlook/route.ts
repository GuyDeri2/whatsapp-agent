import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/oauth/outlook?tenantId=... — initiate Microsoft Outlook OAuth flow
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
  if (!MICROSOFT_CLIENT_ID) {
    return NextResponse.json({ error: 'Outlook OAuth not configured' }, { status: 500 });
  }

  const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/outlook/callback`;
  const scope = encodeURIComponent(
    'https://graph.microsoft.com/Calendars.ReadWrite offline_access'
  );

  // Encode tenantId in state for retrieval in callback
  const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64');

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
