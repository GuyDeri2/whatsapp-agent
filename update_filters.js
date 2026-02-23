require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.from('tenants').update({ agent_filter_mode: 'all', agent_mode: 'active' }).neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Update result:', data, error);
}
run();
