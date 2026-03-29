import {
  createAgent,
  updateAgentConfig,
  syncKnowledgeBase,
  createKBDocument,
  type AgentConfigParams,
} from "./elevenlabs";
import { getSupabaseAdmin } from "./supabase/admin";
import type { VoiceGender } from "./voice-platform-config";

interface SetupAgentParams {
  tenantId: string;
  businessName: string;
  appBaseUrl: string;
}

// Look up voice gender from voice_catalog; defaults to "male"
async function getVoiceGender(voiceId: string | null): Promise<VoiceGender> {
  if (!voiceId) return "male";
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("voice_catalog")
    .select("gender")
    .eq("elevenlabs_voice_id", voiceId)
    .single();
  return (data?.gender as VoiceGender) || "male";
}

// Build AgentConfigParams from tenant record + KB IDs
async function buildAgentParams(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenant: any,
  appBaseUrl: string,
  kbIds: string[]
): Promise<AgentConfigParams> {
  const voiceGender = await getVoiceGender(tenant.elevenlabs_voice_id);
  return {
    name: tenant.business_name,
    tenantId: tenant.id,
    appBaseUrl,
    webhookSecret: tenant.voice_webhook_secret || undefined,
    voiceId: tenant.elevenlabs_voice_id || undefined,
    voiceGender,
    voiceSettings: tenant.voice_settings || undefined,
    firstMessage: tenant.voice_first_message || undefined,
    customInstructions: tenant.voice_custom_instructions || undefined,
    knowledgeBaseIds: kbIds,
  };
}

// Get all ElevenLabs KB IDs for a tenant
async function getKbIds(tenantId: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("knowledge_base")
    .select("elevenlabs_kb_id")
    .eq("tenant_id", tenantId)
    .not("elevenlabs_kb_id", "is", null);

  return (data || []).map(
    (item: { elevenlabs_kb_id: string }) => item.elevenlabs_kb_id
  );
}

// First-time agent setup — creates KB docs + agent in ElevenLabs
export async function setupVoiceAgent(
  params: SetupAgentParams
): Promise<string> {
  const { tenantId, appBaseUrl } = params;
  const supabase = getSupabaseAdmin();

  // 1. Get tenant record (for Layer 2 settings)
  const { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .single();

  if (!tenant) throw new Error("Tenant not found");

  // 2. Get KB items and create docs in ElevenLabs (skip items that already have an ElevenLabs ID)
  const { data: kbItems } = await supabase
    .from("knowledge_base")
    .select("*")
    .eq("tenant_id", tenantId);

  const kbIds: string[] = [];
  for (const item of kbItems || []) {
    if (item.elevenlabs_kb_id) {
      kbIds.push(item.elevenlabs_kb_id);
      continue;
    }

    const id = await createKBDocument({
      name: item.question,
      text: item.answer,
    });
    kbIds.push(id);

    await supabase
      .from("knowledge_base")
      .update({ elevenlabs_kb_id: id })
      .eq("id", item.id);
  }

  // 3. Create agent with merged Layer 1 + Layer 2 config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentParams = await buildAgentParams(tenant as any, appBaseUrl, kbIds);
  const agentId = await createAgent(agentParams);

  // 4. Update tenant with agent ID and enable voice
  await supabase
    .from("tenants")
    .update({ elevenlabs_agent_id: agentId, voice_enabled: true })
    .eq("id", tenantId);

  return agentId;
}

// Update existing agent config (when elevenlabs_agent_id already exists)
export async function updateVoiceAgentConfig(
  tenantId: string,
  appBaseUrl: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .single();

  if (!tenant) throw new Error("Tenant not found");
  if (!tenant.elevenlabs_agent_id) throw new Error("Voice agent not set up yet");

  const kbIds = await getKbIds(tenantId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentParams = await buildAgentParams(tenant as any, appBaseUrl, kbIds);

  await updateAgentConfig(tenant.elevenlabs_agent_id, agentParams);
}

// Sync KB references to ElevenLabs agent (after KB CRUD operations)
export async function syncKnowledgeBaseToVoiceAgent(
  tenantId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("elevenlabs_agent_id")
    .eq("id", tenantId)
    .single();

  if (!tenant?.elevenlabs_agent_id) return;

  const kbIds = await getKbIds(tenantId);
  await syncKnowledgeBase(tenant.elevenlabs_agent_id, kbIds);
}
