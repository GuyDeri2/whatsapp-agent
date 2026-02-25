const fs=require('fs'); 
const {createClient}=require('@supabase/supabase-js');
const env=fs.readFileSync('.env.local','utf-8');
const u=env.match(/SUPABASE_URL=(.*)/)[1].trim();
const k=env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const s=createClient(u,k);

async function check() {
  const {data: tenant} = await s.from('tenants').select('id, whatsapp_phone').limit(1).single();
  const jid = '972526991415@s.whatsapp.net'; // we'll use a test user
  const aiReply = 'Test AI reply logic';

  console.log('Using tenant:', tenant.id);
  // Call the backend API
  const res = await fetch(`http://localhost:3001/sessions/${tenant.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          jid: jid,
          text: aiReply,
      }),
  });
  console.log(res.status, await res.text());
}
check();
