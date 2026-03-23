import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const BAILEYS_SERVICE_URL = process.env.BAILEYS_SERVICE_URL;
const SESSION_MANAGER_SECRET = process.env.SESSION_MANAGER_SECRET;

/**
 * POST /api/tenants/[tenantId]/baileys — start Baileys session (QR code flow)
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;

    // Authenticate
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

    if (!BAILEYS_SERVICE_URL || !SESSION_MANAGER_SECRET) {
        return NextResponse.json(
            { error: 'Baileys service not configured' },
            { status: 500 }
        );
    }

    // Mutual exclusion: disconnect Cloud API if active
    const admin = getSupabaseAdmin();
    const { data: cloudConfig } = await admin
        .from('whatsapp_cloud_config')
        .select('access_token')
        .eq('tenant_id', tenantId)
        .single();

    if (cloudConfig) {
        // Revoke Facebook token
        if (cloudConfig.access_token) {
            const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
            try {
                await fetch(
                    `https://graph.facebook.com/${META_API_VERSION}/me/permissions`,
                    { method: 'DELETE', headers: { Authorization: `Bearer ${cloudConfig.access_token}` } }
                );
            } catch { /* non-fatal */ }
        }
        await admin.from('whatsapp_cloud_config').delete().eq('tenant_id', tenantId);
    }

    try {
        const res = await fetch(`${BAILEYS_SERVICE_URL}/sessions/${tenantId}/start`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SESSION_MANAGER_SECRET}`,
                'Content-Type': 'application/json',
            },
        });

        const data = await res.json();
        if (!res.ok) {
            return NextResponse.json({ error: data.error }, { status: res.status });
        }

        // Only return known safe fields
        const safe = {
          qr: data.qr ?? undefined,
          status: data.status ?? undefined,
          connected: data.connected ?? undefined,
          phone: data.phone ?? undefined,
        };
        return NextResponse.json(safe);
    } catch (err) {
        console.error('[Baileys API] Start session error:', err);
        return NextResponse.json({ error: 'שגיאה בחיבור לשירות' }, { status: 502 });
    }
}

/**
 * DELETE /api/tenants/[tenantId]/baileys — disconnect Baileys session
 */
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .eq('owner_id', user.id)
        .single();

    if (!tenant) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!BAILEYS_SERVICE_URL || !SESSION_MANAGER_SECRET) {
        return NextResponse.json(
            { error: 'Baileys service not configured' },
            { status: 500 }
        );
    }

    try {
        const res = await fetch(`${BAILEYS_SERVICE_URL}/sessions/${tenantId}/stop`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SESSION_MANAGER_SECRET}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ clearData: true }),
        });

        const data = await res.json();
        if (!res.ok) {
            return NextResponse.json({ error: data.error ?? 'Disconnect failed' }, { status: res.status });
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[Baileys API] Stop session error:', err);
        return NextResponse.json({ error: 'שגיאה בניתוק' }, { status: 502 });
    }
}

/**
 * GET /api/tenants/[tenantId]/baileys — get session status
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .eq('owner_id', user.id)
        .single();

    if (!tenant) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!BAILEYS_SERVICE_URL || !SESSION_MANAGER_SECRET) {
        return NextResponse.json({ connected: false, reason: 'not_configured' });
    }

    try {
        const res = await fetch(`${BAILEYS_SERVICE_URL}/sessions/${tenantId}/status`, {
            headers: {
                'Authorization': `Bearer ${SESSION_MANAGER_SECRET}`,
            },
        });

        const data = await res.json();
        // Only return known safe fields
        const safe = {
          connected: data.connected ?? false,
          status: data.status ?? undefined,
          phone: data.phone ?? undefined,
          reason: data.reason ?? undefined,
          qr: data.qr ?? undefined,
        };
        return NextResponse.json(safe);
    } catch {
        return NextResponse.json({ connected: false, reason: 'service_unreachable' });
    }
}
