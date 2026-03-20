/**
 * LID Resolver — maps WhatsApp LID (Linked ID) JIDs to real phone numbers.
 *
 * WhatsApp's newer privacy features use opaque LIDs (`123456@lid`) instead of
 * phone-number JIDs (`972501234567@s.whatsapp.net`). This module:
 * 1. Extracts real phone from `msg.key.senderPn` when available
 * 2. Caches LID→phone mappings in memory + DB for reuse
 * 3. Falls back to LID (stripped) when phone can't be resolved
 */

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { getSupabase } from "./session-manager";

// In-memory cache: LID JID → phone number (without +)
const lidCache = new Map<string, string>();

/**
 * Resolve a JID to a clean phone number.
 * - Regular JID (`972...@s.whatsapp.net`) → strips suffix
 * - LID JID (`123@lid`) → uses senderPn from message key, or cached mapping
 * - Newsletter/broadcast → returns as-is
 */
export async function resolveLidPhone(
    jid: string,
    msg: WAMessage,
    tenantId: string
): Promise<string> {
    // Regular phone JID — simple strip
    if (jid.endsWith("@s.whatsapp.net")) {
        return jid.replace("@s.whatsapp.net", "");
    }

    // Not a LID — return as-is (newsletter, broadcast, etc.)
    if (!jid.endsWith("@lid")) {
        return jid;
    }

    // LID JID — try to resolve to real phone number

    // 1. Check senderPn in message key (most reliable source)
    const senderPn = (msg.key as any).senderPn as string | undefined;
    if (senderPn) {
        const phone = senderPn.replace("@s.whatsapp.net", "");
        // Cache for future use
        lidCache.set(jid, phone);
        // Persist to DB (fire-and-forget)
        _saveLidMapping(jid, phone, tenantId).catch(() => {});
        return phone;
    }

    // 2. Check in-memory cache
    const cached = lidCache.get(jid);
    if (cached) return cached;

    // 3. Check DB cache
    const dbPhone = await _loadLidMapping(jid, tenantId);
    if (dbPhone) {
        lidCache.set(jid, dbPhone);
        return dbPhone;
    }

    // 4. No resolution — store LID without @lid suffix as phone
    //    (will be updated when phoneNumberShare event arrives)
    return jid;
}

/**
 * Register a LID→phone mapping from chats.phoneNumberShare event.
 * Also updates any existing conversations that used the LID.
 */
export async function registerLidMapping(
    lid: string,
    phoneJid: string,
    tenantId: string
): Promise<void> {
    const phone = phoneJid.replace("@s.whatsapp.net", "");
    lidCache.set(lid, phone);
    await _saveLidMapping(lid, phone, tenantId);

    // Update existing conversations that have this LID as phone_number
    await _migrateConversation(lid, phone, tenantId);
}

/**
 * Bulk-register mappings from the phoneNumberShare event listener.
 */
export function getCachedPhone(lid: string): string | undefined {
    return lidCache.get(lid);
}

// ── DB persistence ──────────────────────────────────────────────────

async function _saveLidMapping(lid: string, phone: string, tenantId: string): Promise<void> {
    const supabase = getSupabase();
    await supabase.from("lid_phone_map").upsert(
        { lid, phone, tenant_id: tenantId },
        { onConflict: "lid,tenant_id" }
    );
}

async function _loadLidMapping(lid: string, tenantId: string): Promise<string | null> {
    const supabase = getSupabase();
    const { data } = await supabase
        .from("lid_phone_map")
        .select("phone")
        .eq("lid", lid)
        .eq("tenant_id", tenantId)
        .maybeSingle();
    return data?.phone ?? null;
}

/**
 * When we learn a LID→phone mapping, update any conversation that stored the LID.
 */
async function _migrateConversation(lid: string, phone: string, tenantId: string): Promise<void> {
    const supabase = getSupabase();

    // Check if a conversation with the real phone already exists
    const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone_number", phone)
        .maybeSingle();

    if (existing) {
        // Merge: move messages from LID conversation to real phone conversation
        const { data: lidConv } = await supabase
            .from("conversations")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("phone_number", lid)
            .maybeSingle();

        if (lidConv) {
            await supabase
                .from("messages")
                .update({ conversation_id: existing.id })
                .eq("conversation_id", lidConv.id)
                .eq("tenant_id", tenantId);

            await supabase
                .from("conversations")
                .delete()
                .eq("id", lidConv.id)
                .eq("tenant_id", tenantId);

            console.log(`[${tenantId}] Merged LID conversation ${lid} → ${phone}`);
        }
    } else {
        // Simply update the phone_number on the existing conversation
        const { error } = await supabase
            .from("conversations")
            .update({ phone_number: phone })
            .eq("tenant_id", tenantId)
            .eq("phone_number", lid);

        if (!error) {
            console.log(`[${tenantId}] Updated LID → phone: ${lid} → ${phone}`);
        }
    }
}
