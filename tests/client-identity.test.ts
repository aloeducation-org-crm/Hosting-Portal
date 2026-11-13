/**
 * SEC-05 regression tests — rate-limit client identity.
 *
 * The defect: `const ip = request.headers.get("x-real-ip")?.trim() || "unknown"`
 * put every client without that header into one shared rate-limit bucket, so the
 * per-client limit silently became a platform-wide limit (one client could
 * exhaust it for everyone) and every audit record attributed the request to the
 * string "unknown".
 *
 * What is proven here:
 *   - with no proxy declared, forwarding headers are ignored entirely, so a
 *     client cannot choose its own bucket;
 *   - with N proxies declared, only the entry the trusted hops appended is used;
 *   - two different unidentifiable clients never share a key;
 *   - malformed, oversized and placeholder header values are rejected rather
 *     than becoming part of a key;
 *   - IPv4-mapped IPv6 and bracketed addresses normalise, so one client cannot
 *     occupy several buckets by changing notation.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveClientIdentity,
  normaliseAddress,
  parseForwardedFor,
  trustedProxyCount,
  describeIdentityProblem,
} from "../src/lib/security/client-identity";

const ROOT = path.resolve(__dirname, "..");

const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

describe("SEC-05 address normalisation", () => {
  it("accepts IPv4, IPv4 with a port, and bracketed IPv6", () => {
    expect(normaliseAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(normaliseAddress("203.0.113.9:51234")).toBe("203.0.113.9");
    expect(normaliseAddress("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normaliseAddress("2001:DB8::1")).toBe("2001:db8::1");
  });

  it("unwraps IPv4-mapped IPv6 so one client cannot occupy two buckets", () => {
    expect(normaliseAddress("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("rejects placeholders and junk", () => {
    for (const value of ["unknown", "-", "null", "none", "", "   ", "not-an-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5"]) {
      expect(normaliseAddress(value), value).toBeNull();
    }
  });
});

describe("SEC-05 trust policy", () => {
  it("defaults to trusting no proxy", () => {
    expect(trustedProxyCount({})).toBe(0);
    expect(trustedProxyCount({ TRUSTED_PROXY_COUNT: "" })).toBe(0);
  });

  it("refuses to interpret a malformed trust list as 'trust everything'", () => {
    for (const raw of ["abc", "-1", "1.5", "99"]) {
      expect(trustedProxyCount({ TRUSTED_PROXY_COUNT: raw }), raw).toBe(0);
    }
  });

  it("accepts a declared hop count", () => {
    expect(trustedProxyCount({ TRUSTED_PROXY_COUNT: "2" })).toBe(2);
  });
});

describe("SEC-05 identity resolution", () => {
  it("ignores forwarding headers when no proxy is declared", () => {
    // The attacker sets a header claiming a fresh address per request. With no
    // declared proxy these must not be believed, or rate limiting is bypassed by
    // simply varying the header.
    const identity = resolveClientIdentity(
      { peerAddress: null, headers: headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }) },
      {},
    );
    expect(identity.address).toBeNull();
    expect(identity.unidentifiable).toBe(true);
    expect(identity.key).not.toContain("1.2.3.4");
    expect(identity.key).not.toContain("5.6.7.8");
  });

  it("uses the transport peer when the runtime exposes one", () => {
    const identity = resolveClientIdentity(
      { peerAddress: "198.51.100.7", headers: headers({ "x-forwarded-for": "1.2.3.4" }) },
      {},
    );
    expect(identity).toMatchObject({ address: "198.51.100.7", source: "peer", unidentifiable: false });
  });

  it("uses the entry appended by the declared proxy, not the client-supplied leftmost one", () => {
    // One proxy in front: it appended the real client (198.51.100.7). The
    // leftmost 1.2.3.4 is whatever the client typed into its own header.
    const identity = resolveClientIdentity(
      { peerAddress: null, headers: headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }), trustedProxyCount: 1 },
      {},
    );
    expect(identity.address).toBe("198.51.100.7");
    expect(identity.source).toBe("x-forwarded-for");
  });

  it("walks the chain correctly for two declared hops", () => {
    const identity = resolveClientIdentity(
      {
        peerAddress: null,
        headers: headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 198.51.100.7" }),
        trustedProxyCount: 2,
      },
      {},
    );
    // Rightmost is the edge; one before it is the client. 6.6.6.6 is spoofed.
    expect(identity.address).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip only when a proxy is declared", () => {
    const withProxy = resolveClientIdentity(
      { peerAddress: null, headers: headers({ "x-real-ip": "203.0.113.50" }), trustedProxyCount: 1 },
      {},
    );
    expect(withProxy).toMatchObject({ address: "203.0.113.50", source: "x-real-ip" });
  });

  it("groups unidentifiable traffic into ONE dedicated bucket, so abuse control stays effective", () => {
    // This is the fail-closed choice. Giving each request a fresh key would mean
    // that a client able to force this state had no rate limit at all.
    const a = resolveClientIdentity({ peerAddress: null, headers: headers({}) }, {});
    const b = resolveClientIdentity({ peerAddress: null, headers: headers({}) }, {});
    expect(a.unidentifiable).toBe(true);
    expect(b.unidentifiable).toBe(true);
    expect(a.key).toBe(b.key);
    // Dedicated, so it is visible in metrics rather than looking like a client,
    // and distinct from the old shared literal "unknown".
    expect(a.key).toBe("unverified:singleton");
    expect(a.key).not.toBe("unknown");
  });

  it("does not collide identified and unidentifiable traffic", () => {
    const identified = resolveClientIdentity({ peerAddress: "198.51.100.7", headers: headers({}) }, {});
    const unidentified = resolveClientIdentity({ peerAddress: null, headers: headers({}) }, {});
    expect(identified.key).not.toBe(unidentified.key);
    expect(unidentified.key.startsWith("unverified:")).toBe(true);
  });

  it("explains the misconfiguration instead of leaving it silent", () => {
    const identity = resolveClientIdentity({ peerAddress: null, headers: headers({}) }, {});
    const problem = describeIdentityProblem(identity, {});
    expect(problem).toMatch(/TRUSTED_PROXY_COUNT is 0/);
    expect(problem).toMatch(/shares one rate-limit bucket/);

    const withProxy = resolveClientIdentity({ peerAddress: null, headers: headers({}) }, { TRUSTED_PROXY_COUNT: "2" });
    expect(describeIdentityProblem(withProxy, { TRUSTED_PROXY_COUNT: "2" })).toMatch(/TRUSTED_PROXY_COUNT=2/);

    const identified = resolveClientIdentity({ peerAddress: "198.51.100.7", headers: headers({}) }, {});
    expect(describeIdentityProblem(identified, {})).toBeNull();
  });

  it("rejects a header value that is not an address", () => {
    const identity = resolveClientIdentity(
      { peerAddress: null, headers: headers({ "x-forwarded-for": "not-an-ip" }), trustedProxyCount: 1 },
      {},
    );
    expect(identity.unidentifiable).toBe(true);
  });

  it("keeps different sources of the same address distinguishable", () => {
    const viaPeer = resolveClientIdentity({ peerAddress: "198.51.100.7", headers: headers({}) }, {});
    const viaXri = resolveClientIdentity(
      { peerAddress: null, headers: headers({ "x-real-ip": "198.51.100.7" }), trustedProxyCount: 1 },
      {},
    );
    expect(viaPeer.key).not.toBe(viaXri.key);
    expect(viaPeer.address).toBe(viaXri.address);
  });
});

describe("SEC-05 forwarding-chain parsing", () => {
  it("splits, trims and caps the chain", () => {
    expect(parseForwardedFor("1.2.3.4, 5.6.7.8")).toEqual(["1.2.3.4", "5.6.7.8"]);
    const big = Array.from({ length: 100 }, (_, i) => `10.0.0.${i % 255}`).join(",");
    expect(parseForwardedFor(big)!.length).toBe(20);
  });

  it("returns an empty chain for absent or empty headers", () => {
    expect(parseForwardedFor(null)).toEqual([]);
    expect(parseForwardedFor("")).toEqual([]);
    expect(parseForwardedFor(" , , ")).toEqual([]);
  });
});

describe("SEC-05 the proxy uses the resolver", () => {
  it("no longer falls back to a shared literal bucket", () => {
    const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    expect(proxy).toContain("resolveClientIdentity");
    expect(proxy).not.toMatch(/headers\.get\("x-real-ip"\)\?\.trim\(\)\s*\|\|\s*"unknown"/);
  });

  it("rate-limit keys derive from the resolved identity", () => {
    const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    const block = proxy.slice(proxy.indexOf("const identity = resolveClientIdentity("));
    expect(block.slice(0, 600)).toContain("const ip = identity.key");
  });
});
