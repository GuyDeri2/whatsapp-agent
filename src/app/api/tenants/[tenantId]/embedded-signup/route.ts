import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { exchangeForLongLivedToken } from '@/lib/whatsapp-cloud';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tenants/[tenantId]/embedded-signup
 *
 * Receives the authorization code + WABA/phone data from the Meta Embedded Signup
 * flow (client-side FB.login), exchanges the code for an access token,
 * and stores the credentials.
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;

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

    // Parse request body
    let body: { code?: string; waba_id?: string; phone_number_id?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { code, waba_id, phone_number_id } = body;
    if (!code) {
        return NextResponse.json({ error: 'Authorization code is required' }, { status: 400 });
    }

    const META_APP_ID = process.env.META_APP_ID;
    const META_APP_SECRET = process.env.META_APP_SECRET;
    const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

    if (!META_APP_ID || !META_APP_SECRET) {
        return NextResponse.json({ error: 'Meta not configured' }, { status: 500 });
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
        } catch { /* non-fatal — Baileys may not be running */ }
    }

    try {
        // Step 1: Exchange code for access token
        const tokenRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: META_APP_ID,
                client_secret: META_APP_SECRET,
                redirect_uri: appUrl, // Must match — for Embedded Signup this is typically the app URL
            }),
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            console.error('[Embedded Signup] Token exchange failed:', errText);
            return NextResponse.json({ error: 'שגיאה בחילופי הקוד מול Meta' }, { status: 502 });
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
            console.error('[Embedded Signup] No access token in response:', tokenData);
            return NextResponse.json({ error: 'לא התקבל טוקן מ-Meta' }, { status: 502 });
        }

        // Step 2: If we didn't get waba_id/phone_number_id from the client,
        // discover them from the API
        let finalWabaId = waba_id || null;
        let finalPhoneNumberId = phone_number_id || null;

        if (!finalWabaId || !finalPhoneNumberId) {
            // Get businesses
            const bizRes = await fetch(
                `https://graph.facebook.com/${META_API_VERSION}/me/businesses?access_token=${accessToken}&fields=id,name`
            );
            if (bizRes.ok) {
                const bizData = await bizRes.json();
                for (const biz of (bizData.data || [])) {
                    // Get WABAs
                    const wabasRes = await fetch(
                        `https://graph.facebook.com/${META_API_VERSION}/${biz.id}/owned_whatsapp_business_accounts?access_token=${accessToken}&fields=id,name`
                    );
                    if (!wabasRes.ok) continue;
                    const wabas = await wabasRes.json();

                    for (const waba of (wabas.data || [])) {
                        if (finalWabaId && finalWabaId !== waba.id) continue;
                        finalWabaId = waba.id;

                        // Get phone numbers
                        const phonesRes = await fetch(
                            `https://graph.facebook.com/${META_API_VERSION}/${waba.id}/phone_numbers?access_token=${accessToken}&fields=id,display_phone_number,verified_name`
                        );
                        if (!phonesRes.ok) continue;
                        const phones = await phonesRes.json();

                        if (phones.data?.length > 0) {
                            if (!finalPhoneNumberId) {
                                finalPhoneNumberId = phones.data[0].id;
                            }
                            break;
                        }
                    }
                    if (finalPhoneNumberId) break;
                }
            }
        }

        if (!finalWabaId || !finalPhoneNumberId) {
            return NextResponse.json({
                error: 'לא נמצא מספר WhatsApp בחשבון. ודא שהוספת מספר טלפון במהלך ההרשמה.'
            }, { status: 400 });
        }

        // Step 3: Exchange for long-lived token (~60 days)
        let finalToken = accessToken;
        let tokenExpiresAt: string | null = null;
        const longLived = await exchangeForLongLivedToken(accessToken);
        if (longLived) {
            finalToken = longLived.token;
            tokenExpiresAt = longLived.expiresAt.toISOString();
            console.log(`[${tenantId}] Exchanged for long-lived token, expires: ${tokenExpiresAt}`);
        } else {
            console.warn(`[${tenantId}] Could not exchange for long-lived token — using short-lived token`);
        }

        // Step 4: Store credentials
        const admin = getSupabaseAdmin();
        const webhookVerifyToken = crypto.randomBytes(32).toString('hex');

        const { error: upsertError } = await admin.from('whatsapp_cloud_config').upsert(
            {
                tenant_id: tenantId,
                access_token: finalToken,
                phone_number_id: finalPhoneNumberId,
                waba_id: finalWabaId,
                webhook_verify_token: webhookVerifyToken,
                token_expires_at: tokenExpiresAt,
            },
            { onConflict: 'tenant_id' }
        );

        if (upsertError) {
            console.error('[Embedded Signup] Config save failed:', upsertError);
            return NextResponse.json({ error: 'שגיאה בשמירת ההגדרות' }, { status: 500 });
        }

        // Step 5: Get display phone number
        let displayPhone: string | null = null;
        try {
            const phoneInfoRes = await fetch(
                `https://graph.facebook.com/${META_API_VERSION}/${finalPhoneNumberId}?fields=display_phone_number,verified_name&access_token=${finalToken}`
            );
            if (phoneInfoRes.ok) {
                const phoneInfo = await phoneInfoRes.json();
                displayPhone = phoneInfo.display_phone_number?.replace(/\D/g, '') ?? null;
            }
        } catch {
            // Non-fatal
        }

        // Step 6: Update tenant
        await admin.from('tenants').update({
            whatsapp_connected: true,
            whatsapp_phone: displayPhone,
            connection_type: 'cloud',
        }).eq('id', tenantId);

        // Step 7: Subscribe WABA to webhook
        try {
            const subscribeRes = await fetch(
                `https://graph.facebook.com/${META_API_VERSION}/${finalWabaId}/subscribed_apps`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${finalToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            if (subscribeRes.ok) {
                console.log(`[${tenantId}] WABA ${finalWabaId} subscribed to webhook`);
            } else {
                const subErr = await subscribeRes.text();
                console.error(`[${tenantId}] Webhook subscription failed:`, subErr);
            }
        } catch (subErr) {
            console.error(`[${tenantId}] Webhook subscription error:`, subErr);
        }

        return NextResponse.json({
            success: true,
            phone: displayPhone,
            waba_id: finalWabaId,
            phone_number_id: finalPhoneNumberId,
        });

    } catch (error) {
        console.error('[Embedded Signup] Unexpected error:', error);
        return NextResponse.json({ error: 'שגיאה בלתי צפויה' }, { status: 500 });
    }
}
