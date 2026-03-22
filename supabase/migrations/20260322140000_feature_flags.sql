-- Global feature flags: admin controls which tabs are visible to all tenants
CREATE TABLE feature_flags (
    key TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT true,
    label TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with all tabs (enabled by default)
INSERT INTO feature_flags (key, label) VALUES
    ('tab_chat',         'שיחות'),
    ('tab_contacts',     'אנשי קשר'),
    ('tab_connect',      'ווטסאפ'),
    ('tab_capabilities', 'יכולות'),
    ('tab_settings',     'הגדרות'),
    ('tab_leads',        'לידים'),
    ('tab_calendar',     'יומן');

-- RLS: everyone can read, only admins can update
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read feature flags"
    ON feature_flags FOR SELECT
    USING (true);

CREATE POLICY "Only admins can update feature flags"
    ON feature_flags FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );
