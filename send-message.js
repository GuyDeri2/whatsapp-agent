const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlMatch = envContent.match(/SUPABASE_URL=(.*)/);
const supabaseKeyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

const supabaseUrl = supabaseUrlMatch[1].trim();
const supabaseKey = supabaseKeyMatch[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function sendTest() {
  const { data: tenant } = await supabase.from('tenants').select('id, whatsapp_connected').limit(1).single();
  if (tenant && tenant.whatsapp_connected) {
      console.log('Tenant is connected:', tenant.id);
  } else {
      console.log('Tenant is NOT connected');
  }
}
sendTest();
