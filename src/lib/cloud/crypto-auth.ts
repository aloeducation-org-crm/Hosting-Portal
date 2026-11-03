/**
 * Cloud Projects — Cryptographic Key, Constant-Time Auth & Webhook Signing
 *
 * Server-only module (`node:crypto`). Raw API keys (`alok_live_...`) and
 * webhook signing secrets (`alowh_...`) are generated once with CSPRNG
 * entropy, returned to the creating caller in a single HTTP 201 response, and
 * NEVER stored in plaintext — only SHA-256 digests and short display prefixes
 * persist in SQLite.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseCloudScopes, type CloudProjectScope } from "./catalog";

export const CLOUD_API_KEY_PREFIX_TAG = "alok_live_";
export const CLOUD_WEBHOOK_SECRET_PREFIX_TAG = "alowh_";

export function hashCloudSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function constantTimeHexEquals(leftHex: string, rightHex: string): boolean {
  if (typeof leftHex !== "string" || typeof rightHex !== "string") return false;
  if (leftHex.length !== rightHex.length || leftHex.length === 0 || leftHex.length % 2 !== 0) return false;
  if (!/^[a-f0-9]+$/i.test(leftHex) || !/^[a-f0-9]+$/i.test(rightHex)) return false;
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function generateCloudApiKey(): {
  secret: string;
  prefix: string;
  keyHash: string;
} {
  const tokenHex = randomBytes(24).toString("hex"); // 192 bits of CSPRNG entropy
  const secret = `${CLOUD_API_KEY_PREFIX_TAG}${tokenHex}`;
  const prefix = secret.slice(0, 18); // "alok_live_" + first 8 hex chars
  return {
    secret,
    prefix,
    keyHash: hashCloudSecret(secret),
  };
}

export function generateWebhookSigningSecret(): {
  signingSecret: string;
  signingKeyPrefix: string;
  signingKeyHash: string;
} {
  const tokenHex = randomBytes(24).toString("hex");
  const signingSecret = `${CLOUD_WEBHOOK_SECRET_PREFIX_TAG}${tokenHex}`;
  const signingKeyPrefix = signingSecret.slice(0, 14); // "alowh_" + first 8 hex chars
  return {
    signingSecret,
    signingKeyPrefix,
    signingKeyHash: hashCloudSecret(signingSecret),
  };
}

export interface StoredCloudProjectKey {
  id: string;
  projectId: string;
  projectSlug: string;
  projectStatus: string;
  keyHash: string;
  prefix: string;
  scopes: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export type CloudKeyAuthDecision =
  | {
      ok: true;
      keyId: string;
      projectId: string;
      projectSlug: string;
      grantedScopes: CloudProjectScope[];
    }
  | {
      ok: false;
      status: 401 | 403;
      code:
        | "MISSING_CREDENTIALS"
        | "MALFORMED_KEY"
        | "INVALID_KEY"
        | "KEY_REVOKED"
        | "KEY_EXPIRED"
        | "PROJECT_MISMATCH"
        | "PROJECT_ARCHIVED"
        | "INSUFFICIENT_SCOPE";
      message: string;
    };

export function extractCloudKeyHeaders(headers: Headers): {
  projectRef: string | null;
  rawKey: string | null;
} {
  const projectRef =
    headers.get("x-alo-project")?.trim() ||
    headers.get("x-appwrite-project")?.trim() ||
    null;

  const directKey =
    headers.get("x-alo-key")?.trim() ||
    headers.get("x-appwrite-key")?.trim() ||
    null;

  if (directKey) return { projectRef, rawKey: directKey };

  const authHeader = headers.get("authorization")?.trim() ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return { projectRef, rawKey: token };
  }
  return { projectRef, rawKey: null };
}

/**
 * Pure decision function verifying a scoped Cloud Project API key against a
 * candidate DB record. Never accepts cookies or session tokens.
 */
export function authenticateCloudProjectKey(params: {
  projectRef: string | null;
  rawKey: string | null;
  candidate: StoredCloudProjectKey | null;
  anyOfScopes: readonly CloudProjectScope[];
  nowMs?: number;
}): CloudKeyAuthDecision {
  const now = params.nowMs ?? Date.now();
  const projectRef = params.projectRef?.trim() ?? "";
  const rawKey = params.rawKey?.trim() ?? "";

  if (!projectRef || !rawKey) {
    return {
      ok: false,
      status: 401,
      code: "MISSING_CREDENTIALS",
      message: "Both x-alo-project and x-alo-key headers are required.",
    };
  }

  if (!rawKey.startsWith(CLOUD_API_KEY_PREFIX_TAG) || rawKey.length < 32 || rawKey.length > 128) {
    return {
      ok: false,
      status: 401,
      code: "MALFORMED_KEY",
      message: "Malformed project API key.",
    };
  }

  const candidate = params.candidate;
  const presentedHash = hashCloudSecret(rawKey);
  if (!candidate || !constantTimeHexEquals(presentedHash, candidate.keyHash)) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_KEY",
      message: "Invalid project API key.",
    };
  }

  if (projectRef !== candidate.projectId && projectRef !== candidate.projectSlug) {
    return {
      ok: false,
      status: 403,
      code: "PROJECT_MISMATCH",
      message: "API key does not belong to the requested project.",
    };
  }

  if (candidate.projectStatus !== "ACTIVE") {
    return {
      ok: false,
      status: 403,
      code: "PROJECT_ARCHIVED",
      message: "Target Cloud Project is archived.",
    };
  }

  if (candidate.revokedAt) {
    return {
      ok: false,
      status: 401,
      code: "KEY_REVOKED",
      message: "API key has been revoked.",
    };
  }

  if (candidate.expiresAt && candidate.expiresAt.getTime() <= now) {
    return {
      ok: false,
      status: 401,
      code: "KEY_EXPIRED",
      message: "API key has expired.",
    };
  }

  const grantedScopes = parseCloudScopes(candidate.scopes);
  if (params.anyOfScopes.length > 0 && !params.anyOfScopes.some((s) => grantedScopes.includes(s))) {
    return {
      ok: false,
      status: 403,
      code: "INSUFFICIENT_SCOPE",
      message: `API key lacks required scope (${params.anyOfScopes.join(" or ")}).`,
    };
  }

  return {
    ok: true,
    keyId: candidate.id,
    projectId: candidate.projectId,
    projectSlug: candidate.projectSlug,
    grantedScopes,
  };
}

/** Sign an outbound webhook payload with HMAC-SHA256 (`t=<unix>,v1=<hex>`). */
export function signCloudWebhookPayload(
  signingSecret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  const mac = createHmac("sha256", signingSecret)
    .update(`${timestampSeconds}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export function verifyCloudWebhookSignature(params: {
  signingSecret: string;
  signatureHeader: string;
  rawBody: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const tolerance = params.toleranceSeconds ?? 300;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const parts = Object.fromEntries(
    params.signatureHeader
      .split(",")
      .map((item) => item.trim().split("=", 2) as [string, string]),
  );
  const ts = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isInteger(ts) || Math.abs(now - ts) > tolerance || !/^[a-f0-9]{64}$/i.test(v1)) {
    return false;
  }
  const expected = createHmac("sha256", params.signingSecret)
    .update(`${ts}.${params.rawBody}`, "utf8")
    .digest("hex");
  return constantTimeHexEquals(v1.toLowerCase(), expected.toLowerCase());
}

/** Redact any accidentally echoed Cloud API key or webhook secret from logs/errors. */
export function redactCloudSecrets(input: string): string {
  return input
    .replace(/\balok_live_[a-f0-9]{16,128}\b/gi, "alok_live_[REDACTED]")
    .replace(/\balowh_[a-f0-9]{16,128}\b/gi, "alowh_[REDACTED]");
}
