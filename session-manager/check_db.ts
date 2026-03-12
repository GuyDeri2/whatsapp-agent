import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    console.log("Checking DB for Noam Ifergan...");

    const conversationId = '69c7a25e-04a2-4792-bfaf-776c53cb2d5e';

    // Check tenant status
    const tenantId = 'b069b5a3-8cf3-4609-84f4-1433d10c54d5';
    const { data: tenant } = await supabase
        .from("tenants")
        .select("id, agent_mode, whatsapp_connected, whatsapp_phone")
        .eq("id", tenantId)
        .single();
    console.log("Tenant Info:", tenant);

    const { data: msgs } = await supabase
        .from("messages")
        .select("id, role, content, created_at, is_from_agent")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(5);

    console.log("Recent messages:", msgs);
}

check();
