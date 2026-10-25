import crypto from "crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(rawKey?: string): Buffer {
  const source = rawKey || env.APP_ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(source)) {
    return Buffer.from(source, "hex");
  }
  return crypto.createHash("sha256").update(source).digest();
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns base64 string formatted as iv:authTag:ciphertext.
 */
export function encryptSecret(plaintext: string, customKey?: string): string {
  const key = deriveKey(customKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts ciphertext produced by encryptSecret.
 */
export function decryptSecret(payload: string, customKey?: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const key = deriveKey(customKey);
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Masks sensitive credentials for safe UI display.
 */
export function maskSecret(value: string, visibleChars: number = 4): string {
  if (!value) return "";
  if (value.length <= visibleChars) return "••••••••";
  return `${"•".repeat(Math.min(12, value.length - visibleChars))}${value.slice(-visibleChars)}`;
}

/**
 * Checks whether a string matches the iv:authTag:ciphertext format produced by encryptSecret.
 */
export function isEncryptedSecret(value: string): boolean {
  if (!value) return false;
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

