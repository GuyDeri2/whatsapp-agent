import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Params = { params: Promise<{ tenantId: string }> };

async function verifyTenant(tenantId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, tenant: null };
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('id', tenantId).eq('owner_id', user.id).single();
  return { user, tenant };
}

// PATCH /api/tenants/[tenantId]/calendar-integration/apple
// Body: { apple_id: string, app_password: string }
// Stores Apple Calendar (iCloud) credentials for CalDAV access.
export async function PATCH(req: Request, { params }: Params) {
  const { tenantId } = await params;
  const { tenant } = await verifyTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { apple_id?: string; app_password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { apple_id, app_password } = body;

  if (!apple_id || typeof apple_id !== 'string' || !apple_id.trim()) {
    return NextResponse.json({ error: 'apple_id is required' }, { status: 400 });
  }

  if (!app_password || typeof app_password !== 'string' || !app_password.trim()) {
    return NextResponse.json({ error: 'app_password is required' }, { status: 400 });
  }

  // Basic email format validation for Apple ID
  if (!apple_id.includes('@')) {
    return NextResponse.json({ error: 'apple_id must be a valid email address' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('calendar_integrations').upsert(
    {
      tenant_id: tenantId,
      provider: 'apple',
      calendar_id: apple_id.trim(),
      access_token: app_password.trim(),
      calendar_name: 'Apple Calendar',
      is_active: true,
    },
    { onConflict: 'tenant_id,provider' }
  );

  if (error) {
    console.error('Failed to save Apple Calendar integration:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
