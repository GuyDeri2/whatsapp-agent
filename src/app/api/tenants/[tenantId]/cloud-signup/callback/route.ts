import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// GET /api/tenants/[tenantId]/cloud-signup/callback — handle Meta OAuth callback
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  // Handle OAuth errors (e.g. user denied access)
  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=meta_oauth_${error ?? 'missing_params'}`);
  }

  let verifiedTenantId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    verifiedTenantId = decoded.tenantId;
    if (!verifiedTenantId) throw new Error('missing tenantId');

    // Verify HMAC signature to prevent state tampering
    const stateSecret = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const expectedSig = crypto.createHmac('sha256', stateSecret)
      .update(`${decoded.tenantId}:${decoded.userId}:${decoded.ts}`)
      .digest('hex');

    if (decoded.sig !== expectedSig) {
      throw new Error('invalid signature');
    }

    // Prevent replay attacks — state must not be older than 10 minutes
    if (Date.now() - decoded.ts > STATE_MAX_AGE_MS) {
      throw new Error('state expired');
    }
  } catch {
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=invalid_oauth_state`);
  }

  // Verify tenantId from params matches state tenantId
  if (tenantId !== verifiedTenantId) {
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=tenant_mismatch`);
  }

  const META_APP_ID = process.env.META_APP_ID;
  const META_APP_SECRET = process.env.META_APP_SECRET;
  const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
  const REDIRECT_URI = `${appUrl}/api/tenants/${tenantId}/cloud-signup/callback`;

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

    // Step 2: Get user's businesses (WABAs)
    const businessesRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me/businesses?access_token=${userAccessToken}&fields=id,name,whatsapp_business_accounts{id,name,message_template_namespace,timezone_id,account_review_status,owner_business_info}`
    );

    if (!businessesRes.ok) {
      const errText = await businessesRes.text();
      console.error('Failed to fetch businesses:', errText);
      return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=business_fetch`);
    }

    const businessesData = await businessesRes.json();
    const businesses = businessesData.data || [];

    // Find first WhatsApp Business Account (WABA)
    let wabaId: string | null = null;
    let phoneNumberId: string | null = null;
    let systemUserAccessToken: string | null = null;

    for (const business of businesses) {
      const wabas = business.whatsapp_business_accounts?.data || [];
      if (wabas.length > 0) {
        wabaId = wabas[0].id;
        
        // Step 3: Get system user access token for the WABA
        const systemUserRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${wabaId}/assigned_users?access_token=${userAccessToken}`
        );

        if (systemUserRes.ok) {
          const systemUserData = await systemUserRes.json();
          const systemUsers = systemUserData.data || [];
          
          if (systemUsers.length > 0) {
            // Get system user token (requires additional API call in real implementation)
            // For now, we'll use the user access token (simplified)
            systemUserAccessToken = userAccessToken;
            
            // Step 4: Get phone numbers for the WABA
            const phoneNumbersRes = await fetch(
              `https://graph.facebook.com/${META_API_VERSION}/${wabaId}/phone_numbers?access_token=${systemUserAccessToken}`
            );

            if (phoneNumbersRes.ok) {
              const phoneNumbersData = await phoneNumbersRes.json();
              const phoneNumbers = phoneNumbersData.data || [];
              
              if (phoneNumbers.length > 0) {
                phoneNumberId = phoneNumbers[0].id;
                break;
              }
            }
          }
        }
      }
    }

    // If no existing WABA/phone number, we would need to create them
    // For MVP, we'll require the user to set up WhatsApp Business Account first
    if (!wabaId || !phoneNumberId || !systemUserAccessToken) {
      console.error('No WhatsApp Business Account found or incomplete setup:', {
        wabaId,
        phoneNumberId,
        systemUserAccessToken,
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

    // Generate a webhook verification token
    const webhookVerifyToken = crypto.randomBytes(32).toString('hex');

    // Step 5: Store credentials in whatsapp_cloud_config using service role (bypass RLS)
    const admin = getSupabaseAdmin();
    const { error: upsertError } = await admin.from('whatsapp_cloud_config').upsert(
      {
        tenant_id: tenantId,
        access_token: systemUserAccessToken,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        webhook_verify_token: webhookVerifyToken,
      },
      { onConflict: 'tenant_id' }
    );

    if (upsertError) {
      console.error('Failed to save WhatsApp Cloud config:', upsertError);
      return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=save_failed`);
    }

    // Step 6: Get the actual phone number to display in the dashboard
    let displayPhone: string | null = null;
    try {
      const phoneInfoRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name&access_token=${systemUserAccessToken}`
      );
      if (phoneInfoRes.ok) {
        const phoneInfo = await phoneInfoRes.json();
        displayPhone = phoneInfo.display_phone_number?.replace(/\D/g, '') ?? null;
      }
    } catch {
      // Non-fatal — phone display is nice-to-have
    }

    // Step 7: Update tenant record with connection status
    await admin.from('tenants').update({
      whatsapp_connected: true,
      whatsapp_phone: displayPhone,
      connection_type: 'cloud',
    }).eq('id', tenantId);

    // Step 8: Subscribe WABA to our webhook (so Meta sends us messages)
    const WEBHOOK_URL = `${appUrl}/api/webhooks/whatsapp-cloud`;
    const GLOBAL_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (GLOBAL_VERIFY_TOKEN) {
      try {
        const subscribeRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${wabaId}/subscribed_apps`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${systemUserAccessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (subscribeRes.ok) {
          console.log(`[${tenantId}] ✅ WABA ${wabaId} subscribed to webhook`);
        } else {
          const subErr = await subscribeRes.text();
          console.error(`[${tenantId}] ⚠️ Webhook subscription failed:`, subErr);
        }
      } catch (subErr) {
        console.error(`[${tenantId}] ⚠️ Webhook subscription error:`, subErr);
      }
    }

    // Redirect back to the tenant connect tab with success indicator
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&connected=whatsapp_cloud`);

  } catch (error) {
    console.error('Unexpected error in Meta OAuth callback:', error);
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=unexpected`);
  }
}
