import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/meta/data-deletion
 *
 * Meta Data Deletion Callback — required for Facebook Login compliance.
 * When a user removes the app from their Facebook settings, Meta sends
 * a signed request here. We respond with a confirmation URL and code.
 *
 * See: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export async function POST(req: Request) {
  const formData = await req.formData();
  const signedRequest = formData.get('signed_request') as string | null;

  if (!signedRequest) {
    return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
  }

  const META_APP_SECRET = process.env.META_APP_SECRET;
  if (!META_APP_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  // Parse the signed request
  const [encodedSig, payload] = signedRequest.split('.');
  if (!encodedSig || !payload) {
    return NextResponse.json({ error: 'Invalid signed_request format' }, { status: 400 });
  }

  // Verify signature
  const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expectedSig = crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(payload)
    .digest();

  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  // Decode the payload to get user_id
  let data: { user_id?: string };
  try {
    data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch {
    return NextResponse.json({ error: 'Invalid payload encoding' }, { status: 400 });
  }
  const userId = data.user_id;

  if (!userId) {
    return NextResponse.json({ error: 'Missing user_id in payload' }, { status: 400 });
  }

  // Generate a confirmation code
  const confirmationCode = crypto.randomBytes(16).toString('hex');

  console.log(`[Data Deletion] Request for Facebook user ${userId}, code: ${confirmationCode}`);

  // Actually delete/anonymize tenant data linked to this Facebook user
  try {
    const supabase = getSupabaseAdmin();

    // Find tenants linked to this Facebook user_id (stored during OAuth signup)
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id")
      .eq("facebook_user_id", userId);

    if (tenants && tenants.length > 0) {
      const tenantIds = tenants.map(t => t.id);

      // Delete in order: messages → conversations → knowledge_base → contact_rules → whatsapp_cloud_config → tenants
      // Each query scoped by tenant_id for multi-tenant safety
      for (const tenantId of tenantIds) {
        // Get conversation IDs for this tenant
        const { data: convs } = await supabase
          .from("conversations")
          .select("id")
          .eq("tenant_id", tenantId);

        if (convs && convs.length > 0) {
          const convIds = convs.map(c => c.id);
          await supabase.from("messages").delete().in("conversation_id", convIds);
        }

        await supabase.from("conversations").delete().eq("tenant_id", tenantId);
        await supabase.from("knowledge_base").delete().eq("tenant_id", tenantId);
        await supabase.from("contact_rules").delete().eq("tenant_id", tenantId);
        await supabase.from("whatsapp_cloud_config").delete().eq("tenant_id", tenantId);
        await supabase.from("tenants").delete().eq("id", tenantId);
      }

      console.log(`[Data Deletion] Deleted data for ${tenantIds.length} tenant(s) of Facebook user ${userId}`);
    } else {
      console.log(`[Data Deletion] No tenants found for Facebook user ${userId}`);
    }
  } catch (err) {
    console.error(`[Data Deletion] Error deleting data for Facebook user ${userId}:`, err);
    // Still return confirmation — Meta expects 200, deletion can be retried
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  return NextResponse.json({
    url: `${appUrl}/privacy`,
    confirmation_code: confirmationCode,
  });
}
