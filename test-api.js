const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlMatch = envContent.match(/SUPABASE_URL=(.*)/);
const supabaseKeyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

const supabaseUrl = supabaseUrlMatch[1].trim();
const supabaseKey = supabaseKeyMatch[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function testFetchConversations() {
  const tenantId = '4fa5eb17-3c98-46fd-9831-1e69beefec92';
  const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });
      
  console.log('Conv count:', data?.length, 'Error:', error);
  
  if (data) {
     const t1 = Date.now();
     const lastMsgMap = {};
     let errCount = 0;
     for (const conv of data.slice(0, 20)) {
         try {
             const { data: msgs, error } = await supabase
                 .from("messages")
                 .select("content, media_type")
                 .eq("conversation_id", conv.id)
                 .order("created_at", { ascending: false })
                 .limit(1);
                 
             if (error) errCount++;
         } catch(e) {
             errCount++;
         }
     }
     console.log('Last messages loop took:', Date.now() - t1, 'ms. Errors:', errCount);
  }
}
testFetchConversations();
