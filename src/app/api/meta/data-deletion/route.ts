import { NextResponse } from 'next/server';
import crypto from 'crypto';

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
  const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  const userId = data.user_id;

  // Generate a confirmation code
  const confirmationCode = crypto.randomBytes(16).toString('hex');

  // In a full implementation, we would:
  // 1. Find all tenant data associated with this Facebook user
  // 2. Queue it for deletion
  // 3. Store the confirmation code for status tracking
  console.log(`[Data Deletion] Request for Facebook user ${userId}, code: ${confirmationCode}`);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  return NextResponse.json({
    url: `${appUrl}/privacy`,
    confirmation_code: confirmationCode,
  });
}
