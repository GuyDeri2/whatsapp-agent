-- LID → phone number mapping table
-- WhatsApp uses opaque LIDs for privacy; this maps them to real phone numbers.

CREATE TABLE IF NOT EXISTS lid_phone_map (
    lid TEXT NOT NULL,
    phone TEXT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lid, tenant_id)
);

-- Index for reverse lookups
CREATE INDEX IF NOT EXISTS idx_lid_phone_map_phone ON lid_phone_map(phone, tenant_id);

-- RLS
ALTER TABLE lid_phone_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on lid_phone_map"
    ON lid_phone_map
    FOR ALL
    USING (true)
    WITH CHECK (true);
