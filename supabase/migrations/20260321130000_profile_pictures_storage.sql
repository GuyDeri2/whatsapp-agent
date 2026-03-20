-- Profile pictures: Supabase Storage bucket + tracking column

-- Create public bucket for profile pictures
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'profile-pictures',
    'profile-pictures',
    true,
    524288, -- 512KB max per image
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Service role can upload/update/delete
CREATE POLICY "Service role manages profile pictures"
    ON storage.objects FOR ALL
    TO service_role
    USING (bucket_id = 'profile-pictures')
    WITH CHECK (bucket_id = 'profile-pictures');

-- Public can read
CREATE POLICY "Public reads profile pictures"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'profile-pictures');

-- Track when profile picture was last fetched (avoid re-fetching)
ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS profile_picture_updated_at TIMESTAMPTZ;
