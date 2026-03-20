/**
 * QR Code Manager — broadcasts QR codes via Supabase Realtime.
 *
 * When Baileys generates a QR code, we:
 * 1. Convert it to a data URL (base64 PNG)
 * 2. Upsert it into baileys_qr_codes table
 * 3. Frontend subscribes to Realtime changes on that table
 * 4. When connection opens, delete the QR row
 */

import QRCode from "qrcode";
import { getSupabase } from "./session-manager";

/**
 * Convert QR string to data URL and broadcast via Supabase.
 */
export async function broadcastQR(tenantId: string, qr: string): Promise<void> {
    try {
        const dataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: { dark: "#000000", light: "#ffffff" },
        });

        const { error } = await getSupabase()
            .from("baileys_qr_codes")
            .upsert(
                {
                    tenant_id: tenantId,
                    qr_data_url: dataUrl,
                    expires_at: new Date(Date.now() + 25_000).toISOString(), // QR expires in ~25s
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "tenant_id" }
            );

        if (error) {
            console.error(`[${tenantId}] QR broadcast error:`, error.message);
        }
    } catch (err) {
        console.error(`[${tenantId}] QR generation error:`, err);
    }
}

/**
 * Clear QR code after successful connection.
 */
export async function clearQR(tenantId: string): Promise<void> {
    await getSupabase()
        .from("baileys_qr_codes")
        .delete()
        .eq("tenant_id", tenantId);
}
