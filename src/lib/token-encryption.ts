/**
 * Token encryption/decryption utility for sensitive credentials at rest.
 * Uses AES-256-GCM — same algorithm as Baileys session-store.
 *
 * Format: "enc:iv_hex:tag_hex:ciphertext_hex"
 * The "enc:" prefix distinguishes encrypted values from plaintext (for migration).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENC_PREFIX = "enc:";

function getKey(): Buffer {
    const hex = process.env.SESSION_ENCRYPTION_KEY;
    if (!hex) throw new Error("SESSION_ENCRYPTION_KEY not configured — tokens would be stored in plaintext!");
    return Buffer.from(hex, "hex");
}

/** Encrypt a plaintext string. Returns "enc:iv:tag:ciphertext" */
export function encryptToken(plaintext: string): string {
    const key = getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

/** Decrypt a token. Handles both encrypted ("enc:...") and legacy plaintext values. */
export function decryptToken(data: string): string {
    if (!data.startsWith(ENC_PREFIX)) {
        // Legacy plaintext — return as-is (will be encrypted on next write)
        return data;
    }
    const key = getKey();
    const parts = data.slice(ENC_PREFIX.length).split(":");
    if (parts.length !== 3) return data;
    const [ivHex, tagHex, encHex] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(encHex, "hex")) + decipher.final("utf8");
}
