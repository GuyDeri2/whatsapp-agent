require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data } = await supabase.from('tenants').select('id, name, whatsapp_phone, whatsapp_connected');
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    const { data: data2 } = await supabase.from('tenants').select('id, store_name, whatsapp_phone, whatsapp_connected');
    console.log(JSON.stringify(data2, null, 2));
  }
}
run();
