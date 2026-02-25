const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlMatch = envContent.match(/SUPABASE_URL=(.*)/);
const supabaseKeyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
const supabase = createClient(supabaseUrlMatch[1].trim(), supabaseKeyMatch[1].trim());

async function check() {
  const { data } = await supabase.from('whatsapp_sessions').select('session_key').limit(5);
  console.log('Sample Keys in DB:', data.map(d=>d.session_key));
}
check();
