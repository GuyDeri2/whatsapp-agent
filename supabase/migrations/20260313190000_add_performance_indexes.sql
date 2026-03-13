-- ============================================================
-- Performance indexes for common query patterns
-- ============================================================

-- Conversations: filtered by tenant, ordered by recency
-- Used on every dashboard load (ChatTab conversation list)
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_updated
  ON conversations(tenant_id, updated_at DESC);

-- Messages: filtered by tenant + conversation, ordered by time
-- Used in unanswered-questions query and chat rendering (avoids N+1)
CREATE INDEX IF NOT EXISTS idx_messages_tenant_conversation
  ON messages(tenant_id, conversation_id, created_at DESC);

-- Knowledge base: filtered by tenant + source
-- Used in CapabilitiesTab (list by source) and ai-agent (fetch manual/learned entries)
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tenant_source
  ON knowledge_base(tenant_id, source);

-- Messages: filtered by tenant + role, ordered by time
-- Used by learning engine to find owner replies efficiently
CREATE INDEX IF NOT EXISTS idx_messages_tenant_role
  ON messages(tenant_id, role, created_at DESC);
