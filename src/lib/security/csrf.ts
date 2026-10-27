/**
 * CSRF protection for browser mutations — synchronizer-token style, implemented
 * as a signed double-submit value.
 *
 * Why this shape:
 *   - The session cookie is a NextAuth JWT. A cross-site form or `fetch` can
 *     make the browser attach it, which is the whole attack. The middleware
 *     already rejected a *mismatched* `Origin` header, but only when the header
 *     was present — an Origin-less request walked straight through, and
 *     same-origin checking alone is not sufficient CSRF protection.
 *   - A value that lives in a cookie readable by our own JavaScript, and must be
 *     echoed back in a header, cannot be produced by a cross-site page: that
 *     page cannot read the cookie, and cannot add a custom header to a
 *     non-CORS "simple" request without triggering a preflight it would fail.
 *   - The cookie value is an HMAC of the random token under a server key, so a
 *     token cannot be minted by anyone who can write cookies for this origin
 *     (a subdomain or a sibling application), and it cannot be reused as a
 *     session credential.
 *
 * RUNTIME CONSTRAINT: this module is imported by `src/middleware.ts`, which runs
 * in the Edge runtime. `node:crypto` is not available there — an earlier
 * revision imported it and Turbopack reported "Ecmascript file had an error"
 * against the middleware bundle, which would have failed every request at
 * runtime. Everything here therefore uses Web Crypto (`crypto.subtle`), which
 * exists in both the Edge and Node runtimes, and the entry points are async.
 *
 * This is deliberately separate from the other two authentication mechanisms in
 * the app, which must NOT be given CSRF tokens:
 *   - agent endpoints authenticate with a per-agent HMAC over the request body;
 *   - `/api/orchestrator/run` authenticates with INTERNAL_SECRET;
 *   - GitHub webhooks authenticate with a signature over the payload.
 * None of those use cookies, so none of them are CSRF-able, and each keeps its
 * own verification path.
 */

/** Readable by our own client script; must NOT be `httpOnly`. */
export const CSRF_COOKIE_NAME = "alo_csrf";
/** Header the client must echo the token back in. */
export const CSRF_HEADER_NAME = "x-alo-csrf";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const LABEL = "alo-csrf-cookie-binding";

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function serverSecret(): string | null {
  // Reuses the existing application secrets; no new required variable, and no
  // new value to leak. Fails closed when none is configured.
  const source =
    process.env.CSRF_SECRET?.trim() ||
    process.env.APP_ENCRYPTION_KEY?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "";
  return source.length >= 16 ? source : null;
}

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function signingKey(): Promise<CryptoKey | null> {
  const secret = serverSecret();
  if (!secret) return null;
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  // Domain separation: the CSRF key is derived from, but never equal to, the
  // application secret, so it cannot be reused as an encryption or session key.
  const derived = await crypto.subtle.sign("HMAC", await rawKey(secret), encoder.encode(LABEL));
  const key = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  cachedKey = { secret, key };
  return key;
}

async function rawKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(token: string): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(token)));
}

/**
 * Mint a new CSRF token and its cookie value.
 * Returns null when no usable server secret is configured — callers must then
 * fail closed rather than issue an unsigned token.
 */
export async function issueCsrfToken(): Promise<{ token: string; cookieValue: string } | null> {
  if (!serverSecret()) return null;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toHex(bytes.buffer as ArrayBuffer);
  const signature = await sign(token);
  if (!signature) return null;
  return { token, cookieValue: `${token}.${signature}` };
}

/**
 * Constant-time string comparison.
 * `crypto.timingSafeEqual` is Node-only and unavailable in the Edge runtime, so
 * the comparison is done by accumulating the XOR of every byte: the work done
 * does not depend on where the first difference is.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= (bufA[i] as number) ^ (bufB[i] as number);
  return diff === 0;
}

export type CsrfRejection = "missing-cookie" | "missing-header" | "malformed-cookie" | "bad-signature" | "mismatch" | "unconfigured";

export interface CsrfDecision {
  ok: boolean;
  reason?: CsrfRejection;
}

/**
 * Validate a mutation request.
 *
 * `cookieValue` is the raw `alo_csrf` cookie; `headerValue` is the raw
 * `x-alo-csrf` header. Both must be present, the cookie must carry a valid
 * signature for its own token, and the header must equal that token.
 */
export async function validateCsrf(
  cookieValue: string | null | undefined,
  headerValue: string | null | undefined,
): Promise<CsrfDecision> {
  if (!serverSecret()) return { ok: false, reason: "unconfigured" };
  if (!cookieValue) return { ok: false, reason: "missing-cookie" };
  if (!headerValue) return { ok: false, reason: "missing-header" };

  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed-cookie" };
  const token = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!TOKEN_PATTERN.test(token) || !TOKEN_PATTERN.test(signature)) return { ok: false, reason: "malformed-cookie" };

  const expected = await sign(token);
  if (!expected || !safeEqual(expected, signature)) return { ok: false, reason: "bad-signature" };
  if (!safeEqual(token, headerValue.trim())) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/**
 * Cookie attributes for the CSRF cookie.
 *
 * `SameSite=Lax` is set even though the token is the real defence: it stops the
 * cookie riding along on cross-site POSTs at all. It must be readable by
 * JavaScript (`httpOnly: false`) — that is what makes the double-submit work —
 * and it carries no identity, so reading it grants nothing.
 */
export function csrfCookieAttributes(secure: boolean) {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}

/**
 * Is this request carrying a session cookie at all?
 *
 * CSRF is an attack on *ambient session authority*. A request with no session
 * cookie has none to abuse, so requiring a token there would only break
 * pre-authentication flows (login, signup, email verification, MFA challenge,
 * NextAuth's own callback) without adding protection. Those paths are already
 * rate-limited more strictly than the rest of the API.
 */
export function hasSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (name === "next-auth.session-token" || name === "__Secure-next-auth.session-token") return true;
    if (name.endsWith(".next-auth.session-token")) return true; // custom `cookies.sessionToken` prefix
  }
  return false;
}
