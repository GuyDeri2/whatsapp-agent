import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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

  const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/tenants/${tenantId}/cloud-signup/callback`;
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
  const oauthUrl =
    `https://www.facebook.com/${META_API_VERSION}/dialog/oauth` +
    `?client_id=${META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&state=${state}`;

  return NextResponse.redirect(oauthUrl);
}
