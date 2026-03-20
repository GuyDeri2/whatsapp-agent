/**
 * Profile Pictures — fetch from WhatsApp, store in Supabase Storage.
 *
 * Baileys `profilePictureUrl()` returns temporary CDN URLs.
 * We download the image and upload to Supabase Storage for permanent URLs.
 */

import type { WASocket } from "@whiskeysockets/baileys";
import { getSupabase } from "./session-manager";

// Track in-flight fetches to avoid duplicates
const fetching = new Set<string>();

/**
 * Fetch a contact/group profile picture and store it permanently.
 * Returns the public URL or null if unavailable.
 */
export async function fetchAndStoreProfilePicture(
    socket: WASocket,
    jid: string,
    tenantId: string,
    phoneNumber: string
): Promise<string | null> {
    const key = `${tenantId}:${phoneNumber}`;
    if (fetching.has(key)) return null;
    fetching.add(key);

    try {
        // Get temporary CDN URL from WhatsApp
        let cdnUrl: string | undefined;
        try {
            cdnUrl = await socket.profilePictureUrl(jid, "image");
        } catch {
            // 404 or privacy block — no picture available
        }

        // If LID JID failed, try with phone JID
        if (!cdnUrl && jid.endsWith("@lid") && !phoneNumber.includes("@")) {
            try {
                cdnUrl = await socket.profilePictureUrl(phoneNumber + "@s.whatsapp.net", "image");
            } catch {
                // Still no picture
            }
        }

        const supabase = getSupabase();
        const now = new Date().toISOString();

        if (!cdnUrl) {
            // Mark as checked so we don't retry constantly
            await supabase
                .from("conversations")
                .update({ profile_picture_updated_at: now })
                .eq("tenant_id", tenantId)
                .eq("phone_number", phoneNumber);
            return null;
        }

        // Download image
        const response = await fetch(cdnUrl);
        if (!response.ok) {
            await supabase
                .from("conversations")
                .update({ profile_picture_updated_at: now })
                .eq("tenant_id", tenantId)
                .eq("phone_number", phoneNumber);
            return null;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") || "image/jpeg";
        const ext = contentType.includes("png") ? "png" : "jpg";
        const storagePath = `${tenantId}/${phoneNumber}.${ext}`;

        // Upload to Supabase Storage (upsert)
        const { error: uploadError } = await supabase.storage
            .from("profile-pictures")
            .upload(storagePath, buffer, {
                contentType,
                upsert: true,
            });

        if (uploadError) {
            console.error(`[${tenantId}] Profile pic upload error for ${phoneNumber}:`, uploadError.message);
            return null;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from("profile-pictures")
            .getPublicUrl(storagePath);

        const publicUrl = urlData.publicUrl;

        // Update conversation
        await supabase
            .from("conversations")
            .update({
                profile_picture_url: publicUrl,
                profile_picture_updated_at: now,
            })
            .eq("tenant_id", tenantId)
            .eq("phone_number", phoneNumber);

        console.log(`[${tenantId}] Profile pic stored for ${phoneNumber}`);
        return publicUrl;
    } catch (err: any) {
        console.error(`[${tenantId}] Profile pic error for ${phoneNumber}:`, err.message);
        return null;
    } finally {
        fetching.delete(key);
    }
}

/**
 * Bulk-fetch profile pictures for all conversations without one.
 * Rate-limited: 3 seconds between requests, max 30 per run.
 */
export async function bulkFetchProfilePictures(
    socket: WASocket,
    tenantId: string
): Promise<void> {
    const supabase = getSupabase();

    const { data: conversations } = await supabase
        .from("conversations")
        .select("phone_number, is_group")
        .eq("tenant_id", tenantId)
        .is("profile_picture_updated_at", null)
        .limit(30);

    if (!conversations || conversations.length === 0) return;

    console.log(`[${tenantId}] Bulk-fetching ${conversations.length} profile pictures...`);

    for (let i = 0; i < conversations.length; i++) {
        const conv = conversations[i];
        const phone = conv.phone_number;

        // Build JID
        let jid: string;
        if (conv.is_group || phone.includes("@g.us")) {
            jid = phone.endsWith("@g.us") ? phone : `${phone}@g.us`;
        } else if (phone.includes("@lid")) {
            jid = phone;
        } else if (phone.includes("@")) {
            // Newsletter or other — skip
            continue;
        } else {
            jid = `${phone}@s.whatsapp.net`;
        }

        await fetchAndStoreProfilePicture(socket, jid, tenantId, phone);

        // Rate limit: 3 seconds between requests
        if (i < conversations.length - 1) {
            await new Promise((r) => setTimeout(r, 3000));
        }
    }

    console.log(`[${tenantId}] Bulk profile picture fetch complete`);
}
