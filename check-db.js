const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase
    .from('conversations')
    .select('phone_number, contact_name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(5);
  console.log(JSON.stringify(data, null, 2));
}
check();
