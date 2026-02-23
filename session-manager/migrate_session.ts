import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '../.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const fromTenant = '4fa5eb17-3c98-46fd-9831-1e69beefec92';
    const toTenant = '2a29c279-5433-4cd5-afdc-f93e5958b2d9';

    console.log(`Migrating session from ${fromTenant} to ${toTenant}...`);

    // First, delete any old dead session data on the target tenant
    await supabase.from('whatsapp_sessions').delete().eq('tenant_id', toTenant);
    console.log('Cleared old dead session data on target.');

    // Update session rows to point to the new tenant
    const { data, error } = await supabase
        .from('whatsapp_sessions')
        .update({ tenant_id: toTenant })
        .eq('tenant_id', fromTenant);

    if (error) {
        console.error('Error moving session data:', error);
        return;
    }
    console.log('Session data moved successfully.');

    // Update connection status
    await supabase.from('tenants').update({ whatsapp_connected: false }).eq('id', fromTenant);
    await supabase.from('tenants').update({ whatsapp_connected: true }).eq('id', toTenant);
    console.log('Updated tenant connection status.');
}

run();
