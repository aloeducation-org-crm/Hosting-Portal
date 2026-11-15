import crypto from "node:crypto";
import { TOTP } from "otpauth";
import { env } from "@/lib/env";
import { openSecretValue, sealSecretValue } from "@/lib/secret-store";
import { verifyPassword } from "@/lib/password";

export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface MfaChallengePayload {
  userId: string;
  email: string;
  purpose: "mfa_login";
  exp: number;
}

function getSigningKey(secretOverride?: string): Buffer {
  const raw = secretOverride || env.NEXTAUTH_SECRET || env.JWT_SECRET;
  if (!raw) {
    throw new Error("MFA challenge signing secret is not configured");
  }
  return crypto.createHash("sha256").update(`alo:mfa-challenge:v1:${raw}`).digest();
}

/**
 * Mints a short-lived HMAC-SHA256 signed MFA challenge ticket after primary
 * password verification succeeds for an account with MFA enabled.
 */
export function createMfaChallengeToken(
  userId: string,
  email: string,
  options?: { now?: number; ttlMs?: number; secret?: string },
): string {
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? MFA_CHALLENGE_TTL_MS;
  const payload: MfaChallengePayload = {
    userId,
    email: email.toLowerCase().trim(),
    purpose: "mfa_login",
    exp: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSigningKey(options?.secret))
    .update(encoded, "utf8")
    .digest("base64url");
  return `v1.${encoded}.${sig}`;
}

/**
 * Verifies a signed MFA challenge ticket in constant time and enforces expiry.
 */
export function verifyMfaChallengeToken(
  token: string,
  options?: { now?: number; secret?: string },
): MfaChallengePayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;

  const [, encoded, providedSig] = parts as [string, string, string];
  if (!encoded || !providedSig) return null;

  let expectedSig: string;
  try {
    expectedSig = crypto
      .createHmac("sha256", getSigningKey(options?.secret))
      .update(encoded, "utf8")
      .digest("base64url");
  } catch {
    return null;
  }

  const a = Buffer.from(expectedSig, "utf8");
  const b = Buffer.from(providedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<MfaChallengePayload>;
    if (
      parsed.purpose !== "mfa_login" ||
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      typeof parsed.email !== "string" ||
      !parsed.email ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    const now = options?.now ?? Date.now();
    if (parsed.exp <= now) return null;
    return {
      userId: parsed.userId,
      email: parsed.email,
      purpose: "mfa_login",
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/** Seals a TOTP base32 secret with AES-256-GCM (`enc:v1:`). */
export function sealMfaSecret(base32Secret: string): string {
  return sealSecretValue(base32Secret);
}

/** Recovers a TOTP base32 secret (supports sealed `enc:v1:` and legacy plaintext). */
export function openMfaSecret(storedSecret: string): string {
  return openSecretValue(storedSecret);
}

export interface MfaVerifyResult {
  valid: boolean;
  method?: "totp" | "backup_code";
  remainingBackupCodesJson?: string | null;
}

/**
 * Verifies a 6-digit TOTP token or single-use backup code against stored MFA
 * credentials (sealed or legacy plaintext).
 */
export async function verifyUserMfaCode(params: {
  storedSecret: string;
  email: string;
  code: string;
  backupCodesJson?: string | null;
}): Promise<MfaVerifyResult> {
  const trimmedCode = params.code.trim();
  if (!trimmedCode) return { valid: false };

  let plainSecret: string;
  try {
    plainSecret = openMfaSecret(params.storedSecret);
  } catch {
    return { valid: false };
  }

  // Try 6-digit TOTP first
  if (/^\d{6}$/.test(trimmedCode)) {
    try {
      const totp = new TOTP({
        issuer: "ALO Labs Hosting",
        label: params.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: plainSecret,
      });
      if (totp.validate({ token: trimmedCode, window: 1 }) !== null) {
        return { valid: true, method: "totp" };
      }
    } catch {
      // Fall through to backup code verification
    }
  }

  // Fall back to hashed single-use backup codes
  if (params.backupCodesJson) {
    let storedCodes: string[] = [];
    try {
      const parsed = JSON.parse(params.backupCodesJson);
      if (Array.isArray(parsed)) storedCodes = parsed;
    } catch {
      storedCodes = [];
    }

    for (let i = 0; i < storedCodes.length; i++) {
      const hash = storedCodes[i];
      if (!hash || typeof hash !== "string") continue;
      if (await verifyPassword(trimmedCode, hash)) {
        const next = [...storedCodes.slice(0, i), ...storedCodes.slice(i + 1)];
        return {
          valid: true,
          method: "backup_code",
          remainingBackupCodesJson: next.length > 0 ? JSON.stringify(next) : null,
        };
      }
    }
  }

  return { valid: false };
}

/**
 * Validates that a post-login redirect target is a safe same-origin relative path.
 * Blocks open redirects such as `https://evil.com`, `//evil.com`, `/\evil.com`,
 * and `javascript:...`.
 */
export function sanitizeCallbackUrl(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
  if (/[\r\n\0]/.test(trimmed)) return fallback;
  try {
    const resolved = new URL(trimmed, "https://hosting.alolabs.net");
    if (resolved.origin !== "https://hosting.alolabs.net") return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
