import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// GET /api/tenants/[tenantId]/cloud-signup — initiate Meta Embedded Signup (Facebook Login)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const url = new URL(req.url);
  
  // Check for required environment variables
  const META_APP_ID = process.env.META_APP_ID;
  const META_APP_SECRET = process.env.META_APP_SECRET;
  
  if (!META_APP_ID || !META_APP_SECRET) {
    return NextResponse.json(
      { error: 'Meta OAuth not configured. Please set META_APP_ID and META_APP_SECRET.' },
      { status: 500 }
    );
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

  // Check if already has WhatsApp Cloud config
  const { data: existingConfig } = await supabase
    .from('whatsapp_cloud_config')
    .select('id')
    .eq('tenant_id', tenantId)
    .single();

  if (existingConfig) {
    // If already configured, redirect to dashboard with info
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.redirect(`${appUrl}/tenant/${tenantId}?tab=connect&error=already_configured`);
  }

  // Fixed redirect URI — tenantId is in the state parameter, not the URL
  const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/cloud-signup/callback`;
  const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
  
  // Facebook Login OAuth scopes required for WhatsApp Business API
  const scope = encodeURIComponent([
    'business_management',           // Manage business accounts
    'whatsapp_business_management',  // WhatsApp Business API
    'whatsapp_business_messaging',   // Send/receive messages
  ].join(','));

  // Sign state with HMAC to prevent tampering (same pattern as Google OAuth)
  const stateSecret = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', stateSecret)
    .update(`${tenantId}:${user.id}:${ts}`)
    .digest('hex');

  const state = Buffer.from(JSON.stringify({ tenantId, userId: user.id, ts, sig })).toString('base64');

  // Facebook OAuth URL for Embedded Signup
  // config_id triggers the WhatsApp Embedded Signup experience —
  // users can create a new WABA and register their own phone number.
  // override_default_response_type=true is required for Embedded Signup via redirect.
  // auth_type=rerequest forces Facebook to show the permissions screen fresh.
  const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID;

  const oauthUrl =
    `https://www.facebook.com/${META_API_VERSION}/dialog/oauth` +
    `?client_id=${META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&state=${state}` +
    `&auth_type=rerequest` +
    (META_CONFIG_ID
      ? `&config_id=${META_CONFIG_ID}&override_default_response_type=true`
      : '');

  return NextResponse.redirect(oauthUrl);
}

// DELETE /api/tenants/[tenantId]/cloud-signup — disconnect WhatsApp Cloud API
export async function DELETE(
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

  // Get existing config to revoke the Facebook token
  const admin = getSupabaseAdmin();
  const { data: config } = await admin
    .from('whatsapp_cloud_config')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .single();

  // Revoke the Facebook access token so next connect starts fresh
  // (removes app from user's Facebook Business Integrations)
  if (config?.access_token) {
    const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
    try {
      await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/me/permissions`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${config.access_token}` },
        }
      );
    } catch {
      // Non-fatal — continue with local cleanup even if revoke fails
    }
  }

  // Delete WhatsApp Cloud config (use admin to bypass RLS — no DELETE policy)
  const { error } = await admin
    .from('whatsapp_cloud_config')
    .delete()
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('Failed to delete WhatsApp Cloud config:', error);
    return NextResponse.json({ error: 'שגיאה במחיקת ההגדרות' }, { status: 500 });
  }

  // Update tenant whatsapp_connected status
  await admin
    .from('tenants')
    .update({ whatsapp_connected: false, whatsapp_phone: null, connection_type: 'none' })
    .eq('id', tenantId);

  // Delete all conversations (messages cascade via FK)
  await admin
    .from('conversations')
    .delete()
    .eq('tenant_id', tenantId);

  return NextResponse.json({ success: true });
}
