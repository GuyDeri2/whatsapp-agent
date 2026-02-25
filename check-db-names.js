const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlMatch = envContent.match(/SUPABASE_URL=(.*)/);
const supabaseKeyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

const supabaseUrl = supabaseUrlMatch[1].trim();
const supabaseKey = supabaseKeyMatch[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('conversations')
    .select('phone_number, contact_name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(10);
  
  if (error) console.error(error);
  else console.table(data);
}
check();
