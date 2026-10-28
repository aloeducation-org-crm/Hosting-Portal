/**
 * Encrypted-at-rest storage for the `secrets` table.
 *
 * Every value written through the platform secrets API is sealed with
 * AES-256-GCM (`@/lib/encryption`) and tagged with an `enc:v1:` prefix so the
 * read path can tell sealed ciphertext apart from legacy plaintext rows that
 * pre-date this module. Legacy rows stay readable (nothing is destroyed) and
 * are lazily re-sealed on their next read.
 *
 * Rules:
 *   - Plaintext never leaves this module except through `openSecretValue`.
 *   - `maskSecretValue` is the only helper the API layer may use when
 *     responding to clients — full values are never returned.
 *   - A value that fails to decrypt (tampered, wrong key) masks as `****` and
 *     is never echoed back.
 */
import { encryptSecret, decryptSecret } from "@/lib/encryption";

/** Tag prepended to every ciphertext stored in `secrets.value`. */
export const SEALED_PREFIX = "enc:v1:";

function isSealed(stored: string): boolean {
  return stored.startsWith(SEALED_PREFIX);
}

/** Seal a plaintext value for storage. Idempotent: sealed input is returned as-is. */
export function sealSecretValue(plaintext: string): string {
  if (isSealed(plaintext)) return plaintext;
  return SEALED_PREFIX + encryptSecret(plaintext);
}

/**
 * Recover the plaintext of a stored value.
 *
 * Sealed values are decrypted; legacy plaintext rows (created before this
 * module existed) are returned unchanged so no existing record breaks.
 * Throws when the ciphertext cannot be authenticated — callers must treat a
 * throw as "value unavailable", never as an empty string.
 */
export function openSecretValue(stored: string): string {
  if (!isSealed(stored)) return stored;
  return decryptSecret(stored.slice(SEALED_PREFIX.length));
}

/** True when a stored value is still legacy plaintext and should be re-sealed. */
export function needsSealing(stored: string): boolean {
  return !isSealed(stored);
}

/**
 * Client-safe mask: first 4 characters of the *plaintext* plus `***`.
 * Unreadable values collapse to `****`.
 */
export function maskSecretValue(stored: string): string {
  try {
    const plain = openSecretValue(stored);
    if (plain.length <= 4) return "****";
    return `${plain.slice(0, 4)}***`;
  } catch {
    return "****";
  }
}
