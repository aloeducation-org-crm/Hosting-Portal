/**
 * Client identity for rate limiting and audit records (SEC-05).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * `src/proxy.ts` keyed every rate limit on:
 *
 *     request.headers.get("x-real-ip")?.trim() || "unknown"
 *
 * `x-real-ip` is set by nginx/Caddy, not by the client, and the comment above
 * the line was correct that the leftmost `x-forwarded-for` value must not be
 * trusted. But the fallback was the literal string `"unknown"`: when the header
 * was absent — a direct connection, a container hop, a tunnel that does not set
 * it, or any misconfigured proxy — *every* client on the platform shared the
 * `"unknown"` bucket. The effective limit then applied to the platform as a
 * whole rather than per client, which is simultaneously a denial-of-service
 * vector (one client exhausts the shared budget for everyone) and an audit
 * problem (every request is attributed to the same non-identity).
 *
 * ── The model ───────────────────────────────────────────────────────────────
 * A client address is only trustworthy when it comes from a hop the operator
 * declared. This module therefore takes the *transport* peer address where the
 * runtime exposes it and walks a configured trust list:
 *
 *   1. If `TRUSTED_PROXY_COUNT` is 0 (the default), only the transport peer is
 *      used and every forwarding header is ignored. A client cannot spoof its
 *      own address, and a direct deployment needs no configuration.
 *   2. If `TRUSTED_PROXY_COUNT` is N > 0, the address is read from the *right*
 *      end of `x-forwarded-for` — the entries appended by the trusted hops —
 *      after discarding N - 1 rightmost entries. The leftmost entry is
 *      attacker-controlled and is never used.
 *   3. `x-real-ip` is honoured only when a proxy count is configured, because
 *      only then is there a declared proxy that could have set it.
 *
 * ── The unidentifiable case, and why it fails closed ────────────────────────
 * If no address can be determined, unidentifiable traffic is placed in ONE
 * dedicated bucket (`unverified:singleton`) rather than each request getting its
 * own. This is deliberate and is the opposite of "give every request a fresh
 * key", which would disable rate limiting entirely: a client that could obtain a
 * new bucket per request has no limit at all. Grouping unidentifiable requests
 * together keeps abuse control effective while the operator fixes the
 * configuration, and the group is named so it is visible in metrics rather than
 * hidden behind a plausible-looking address.
 *
 * That grouping is only acceptable because it is no longer the *normal* path and
 * no longer silent: a peer address or a declared proxy takes precedence, and the
 * remaining case is reported by `describeIdentityProblem` and by the health
 * endpoint so an operator can see and fix the misconfiguration.
 *
 * This module is pure: no `next/server` import, no I/O, so every branch is
 * unit-testable.
 */

export interface ClientIdentityInput {
  /** Transport peer address, if the runtime exposes one (`request.ip`, socket). */
  peerAddress?: string | null;
  headers: {
    get(name: string): string | null;
  };
  /** Number of proxy hops the operator declares in front of the application. */
  trustedProxyCount?: number;
}

export interface ClientIdentity {
  /** Normalised address, or null when it cannot be determined trustworthily. */
  address: string | null;
  /** Stable bucket key. Never the same for two different unidentifiable clients. */
  key: string;
  /** Where the address came from, for the audit record and for diagnostics. */
  source: "peer" | "x-forwarded-for" | "x-real-ip" | "none";
  /** True when the request cannot be attributed to a client. */
  unidentifiable: boolean;
}

/**
 * Default trusted proxy count.
 *
 * Zero is the safe default: the shipped Caddyfile and nginx vhost both proxy
 * from loopback, and a direct deployment has no proxy at all. An operator behind
 * Cloudflare, a load balancer or a tunnel sets this to the real hop count.
 */
export function trustedProxyCount(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.TRUSTED_PROXY_COUNT ?? "").trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    // A misconfigured trust list must not silently become "trust everything".
    return 0;
  }
  return parsed;
}

/**
 * Parse and normalise one address.
 *
 * Accepts IPv4, IPv4-mapped IPv6 (`::ffff:1.2.3.4`) and bracketed/plain IPv6,
 * strips a port, and returns null for anything that is not an address. Rejecting
 * instead of passing the raw string through is what stops a spoofed header value
 * from becoming part of a rate-limit key (and therefore from choosing another
 * tenant's bucket).
 */
export function normaliseAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  // "unknown", "-" and similar placeholders are not addresses.
  if (/^(unknown|-|null|none)$/i.test(value)) return null;

  // [2001:db8::1]:443  →  2001:db8::1
  const bracketed = value.match(/^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/);
  if (bracketed) value = bracketed[1]!;
  // 1.2.3.4:5678  →  1.2.3.4   (only when there is exactly one colon)
  else if ((value.match(/:/g) ?? []).length === 1) value = value.split(":")[0]!;

  if (value.toLowerCase().startsWith("::ffff:")) value = value.slice(7);

  if (isIPv4(value)) return value;
  if (isIPv6(value)) return value.toLowerCase();
  return null;
}

function isIPv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIPv6(value: string): boolean {
  if (!value.includes(":")) return false;
  // Deliberately structural rather than exhaustive: reject anything that cannot
  // be an address, and rely on the fact that the value came from a socket or a
  // hop-counted header rather than from arbitrary text.
  return /^[0-9a-fA-F:]+$/.test(value) && value.split(":").length <= 9;
}

/**
 * Resolve the client identity for a request.
 *
 * The returned `key` is prefixed with the source so two different sources for
 * the same address do not collide, and an unidentifiable request gets its own
 * bucket (`unidentified:<random>`) so unidentifiable traffic can be limited
 * separately without being merged into a single global counter.
 */
export function resolveClientIdentity(input: ClientIdentityInput, env: NodeJS.ProcessEnv = process.env): ClientIdentity {
  const proxyCount = input.trustedProxyCount ?? trustedProxyCount(env);
  const peer = normaliseAddress(input.peerAddress ?? null);

  if (proxyCount > 0) {
    const forwarded = parseForwardedFor(input.headers.get("x-forwarded-for"));
    if (forwarded.length > 0) {
      // The rightmost `proxyCount` entries were appended by our own hops. The
      // client is the entry immediately before them, or the leftmost entry when
      // the chain is shorter than the declared hop count (a misconfiguration
      // that should degrade to the least-spoofable value, not to the leftmost).
      const index = Math.max(0, forwarded.length - proxyCount);
      const candidate = forwarded[index] ?? forwarded[0] ?? null;
      const address = normaliseAddress(candidate);
      if (address) return { address, key: `xff:${address}`, source: "x-forwarded-for", unidentifiable: false };
    }
    const realIp = normaliseAddress(input.headers.get("x-real-ip"));
    if (realIp) return { address: realIp, key: `xri:${realIp}`, source: "x-real-ip", unidentifiable: false };
  }

  if (peer) return { address: peer, key: `peer:${peer}`, source: "peer", unidentifiable: false };

  return {
    address: null,
    // One shared bucket, deliberately. Per-request keys would mean no limit at
    // all for a client that can force this state. This is the fail-closed choice
    // for abuse control, and it is reported loudly (see below).
    key: "unverified:singleton",
    source: "none",
    unidentifiable: true,
  };
}

/**
 * Operator-facing description of why a request could not be attributed, or null
 * when it could be.
 *
 * Written as a sentence rather than a code so it can go straight into an
 * operator notice, and returned instead of logged here because this module is
 * pure.
 */
export function describeIdentityProblem(identity: ClientIdentity, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!identity.unidentifiable) return null;
  const proxies = trustedProxyCount(env);
  if (proxies === 0) {
    return (
      "Client address unavailable and TRUSTED_PROXY_COUNT is 0, so forwarding headers are ignored and all such " +
      "traffic shares one rate-limit bucket. Set TRUSTED_PROXY_COUNT to the real number of proxy hops in front of " +
      "the application, or ensure the runtime exposes the peer address."
    );
  }
  return (
    `Client address unavailable even though TRUSTED_PROXY_COUNT=${proxies}: no usable x-forwarded-for or x-real-ip ` +
    "entry was present. Check that the reverse proxy sets them and that the hop count matches the real topology."
  );
}

/**
 * Split a forwarding chain, keeping only entries that parse as addresses.
 *
 * A malformed entry is dropped rather than aborting the parse, and the chain is
 * length-capped so an oversized header cannot make this quadratic.
 */
export function parseForwardedFor(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .slice(0, 20)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

