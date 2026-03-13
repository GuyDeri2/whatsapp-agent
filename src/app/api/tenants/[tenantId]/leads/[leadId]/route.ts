import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ tenantId: string; leadId: string }> }
) {
  const { tenantId, leadId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('id', tenantId).eq('user_id', user.id).single();
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', leadId)
    .eq('tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
