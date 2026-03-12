import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
    console.log("--- Tables ---");
    const { data: tables, error: tableError } = await supabase.from('tenants').select('id, name');
    console.log("Tenants:", tables);

    // Look for rules or configurations
    const { data: contactRules } = await supabase.from('contact_rules').select('*');
    console.log("\n--- Contact Rules ---");
    console.log(contactRules);

    // Check if there is a 'knowledge' or 'prompts' table
    // I will try to list some common names
    const potentialTables = ['knowledge_base', 'agent_configs', 'prompts', 'learning_data'];
    for (const table of potentialTables) {
        try {
            const { data, error } = await supabase.from(table).select('*').limit(5);
            if (!error) {
                console.log(`\n--- ${table} ---`);
                console.log(data);
            }
        } catch (e) { }
    }
}

run();
