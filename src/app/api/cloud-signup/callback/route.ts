import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { exchangeForLongLivedToken } from '@/lib/whatsapp-cloud';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fixed redirect URI for Facebook OAuth — tenantId comes from the state parameter
const REDIRECT_PATH = '/api/cloud-signup/callback';

// GET /api/cloud-signup/callback — handle Meta OAuth callback
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  // Decode state to get tenantId (needed for redirects even on error)
  let tenantId = '';
  try {
    const decoded = JSON.parse(Buffer.from(state || '', 'base64').toString());
    tenantId = decoded.tenantId || '';
  } catch {
    // If state is unparseable, redirect to root
  }

  // Handle OAuth errors (e.g. user denied access)
  if (error || !code || !state) {
    if (error) console.error('[OAuth Callback] Meta returned error:', error);
    const redirectTo = tenantId
      ? `${appUrl}/tenant/${tenantId}?tab=connect&error=meta_oauth_failed`
      : `${appUrl}?error=meta_oauth_failed`;
    return NextResponse.redirect(redirectTo);
  }

  let verifiedTenantId: string;
  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    verifiedTenantId = decoded.tenantId;
    userId = decoded.userId;
    if (!verifiedTenantId) throw new Error('missing tenantId');

    // Verify HMAC signature to prevent state tampering
    const stateSecret = process.env.OAUTH_STATE_SECRET;
    if (!stateSecret) throw new Error('OAUTH_STATE_SECRET not configured');

    const expectedSig = crypto.createHmac('sha256', stateSecret)
      .update(`${decoded.tenantId}:${decoded.userId}:${decoded.ts}`)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const sigBuf = Buffer.from(decoded.sig ?? '', 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error('invalid signature');
    }

    // Prevent replay attacks — state must not be older than 10 minutes
    if (Date.now() - decoded.ts > STATE_MAX_AGE_MS) {
      throw new Error('state expired');
    }
  } catch {
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=invalid_oauth_state`);
  }

  tenantId = verifiedTenantId;

  // Validate tenantId is a valid UUID
  if (!UUID_RE.test(tenantId)) {
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=invalid_tenant`);
  }

  // Verify that the userId from state actually owns this tenant
  const admin = getSupabaseAdmin();
  const { data: ownerCheck } = await admin
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .eq('owner_id', userId)
    .single();

  if (!ownerCheck) {
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=forbidden`);
  }

  const META_APP_ID = process.env.META_APP_ID;
  const META_APP_SECRET = process.env.META_APP_SECRET;
  const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
  const REDIRECT_URI = `${appUrl}${REDIRECT_PATH}`;

  if (!META_APP_ID || !META_APP_SECRET) {
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=meta_not_configured`);
  }

  try {
    // Step 1: Exchange authorization code for user access token
    const tokenRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Meta token exchange failed:', errText);
      return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=token_exchange`);
    }

    const userTokens = await tokenRes.json();
    const userAccessToken = userTokens.access_token;

    if (!userAccessToken) {
      console.error('No access token in response:', userTokens);
      return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=no_access_token`);
    }

    // Step 2: Get WhatsApp Business Accounts directly
    // The user token with whatsapp_business_management scope gives us direct access
    const wabasRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me/businesses?fields=id,name`,
      { headers: { 'Authorization': `Bearer ${userAccessToken}` } }
    );

    if (!wabasRes.ok) {
      const errText = await wabasRes.text();
      console.error('Failed to fetch businesses:', errText);
      return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=business_fetch`);
    }

    const businessesData = await wabasRes.json();
    const businesses = businessesData.data || [];

    // Find WABAs owned by each business
    let wabaId: string | null = null;
    let phoneNumberId: string | null = null;

    for (const business of businesses) {
      // Get WABAs owned by this business
      const ownedWabasRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${business.id}/owned_whatsapp_business_accounts?fields=id,name`,
        { headers: { 'Authorization': `Bearer ${userAccessToken}` } }
      );

      if (!ownedWabasRes.ok) continue;

      const ownedWabas = await ownedWabasRes.json();
      const wabas = ownedWabas.data || [];

      if (wabas.length === 0) {
        // Also try client_whatsapp_business_accounts (shared WABAs)
        const clientWabasRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${business.id}/client_whatsapp_business_accounts?fields=id,name`,
          { headers: { 'Authorization': `Bearer ${userAccessToken}` } }
        );
        if (clientWabasRes.ok) {
          const clientWabas = await clientWabasRes.json();
          wabas.push(...(clientWabas.data || []));
        }
      }

      for (const waba of wabas) {
        wabaId = waba.id;

        // Get phone numbers for this WABA
        const phoneNumbersRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
          { headers: { 'Authorization': `Bearer ${userAccessToken}` } }
        );

        if (!phoneNumbersRes.ok) continue;

        const phoneNumbersData = await phoneNumbersRes.json();
        const phoneNumbers = phoneNumbersData.data || [];

        if (phoneNumbers.length > 0) {
          phoneNumberId = phoneNumbers[0].id;
          break;
        }
      }

      if (phoneNumberId) break;
    }

    if (!wabaId || !phoneNumberId) {
      console.error('No WhatsApp Business Account found or incomplete setup:', {
        wabaId,
        phoneNumberId,
        businessesCount: businesses.length
      });
      return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=no_waba_setup`);
    }

    // Mutual exclusion: disconnect Baileys if active
    const BAILEYS_SERVICE_URL = process.env.BAILEYS_SERVICE_URL;
    const SESSION_MANAGER_SECRET = process.env.SESSION_MANAGER_SECRET;
    if (BAILEYS_SERVICE_URL && SESSION_MANAGER_SECRET) {
      try {
        await fetch(`${BAILEYS_SERVICE_URL}/sessions/${tenantId}/stop`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SESSION_MANAGER_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clearData: true }),
        });
      } catch { /* non-fatal */ }
    }

    // Exchange for long-lived token (~60 days instead of ~1 hour)
    let finalToken = userAccessToken;
    let tokenExpiresAt: string | null = null;
    const longLived = await exchangeForLongLivedToken(userAccessToken);
    if (longLived) {
      finalToken = longLived.token;
      tokenExpiresAt = longLived.expiresAt.toISOString();
      console.log(`[${tenantId}] Exchanged for long-lived token, expires: ${tokenExpiresAt}`);
    } else {
      console.warn(`[${tenantId}] Could not exchange for long-lived token — using short-lived token`);
    }

    // Generate a webhook verification token
    const webhookVerifyToken = crypto.randomBytes(32).toString('hex');

    // Store credentials in whatsapp_cloud_config using service role (bypass RLS)
    const { error: upsertError } = await admin.from('whatsapp_cloud_config').upsert(
      {
        tenant_id: tenantId,
        access_token: finalToken,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        webhook_verify_token: webhookVerifyToken,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: 'tenant_id' }
    );

    if (upsertError) {
      console.error('Failed to save WhatsApp Cloud config:', upsertError);
      return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=save_failed`);
    }

    // Get the actual phone number to display in the dashboard
    let displayPhone: string | null = null;
    try {
      const phoneInfoRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { 'Authorization': `Bearer ${finalToken}` } }
      );
      if (phoneInfoRes.ok) {
        const phoneInfo = await phoneInfoRes.json();
        displayPhone = phoneInfo.display_phone_number?.replace(/\D/g, '') ?? null;
      }
    } catch {
      // Non-fatal
    }

    // Update tenant record with connection status
    await admin.from('tenants').update({
      whatsapp_connected: true,
      whatsapp_phone: displayPhone,
      connection_type: 'cloud',
    }).eq('id', tenantId);

    // Subscribe WABA to our webhook
    const GLOBAL_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (GLOBAL_VERIFY_TOKEN) {
      try {
        const subscribeRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${wabaId}/subscribed_apps`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${finalToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (subscribeRes.ok) {
          console.log(`[${tenantId}] WABA ${wabaId} subscribed to webhook`);
        } else {
          const subErr = await subscribeRes.text();
          console.error(`[${tenantId}] Webhook subscription failed:`, subErr);
        }
      } catch (subErr) {
        console.error(`[${tenantId}] Webhook subscription error:`, subErr);
      }
    }

    // Redirect back to the tenant connect tab with success indicator
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&connected=whatsapp_cloud`);

  } catch (error) {
    console.error('Unexpected error in Meta OAuth callback:', error);
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=unexpected`);
  }
}
