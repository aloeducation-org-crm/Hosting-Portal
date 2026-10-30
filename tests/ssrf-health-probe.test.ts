/**
 * Reflected SSRF through the deployment health probe.
 *
 * `verifyDeployment` fetches `new URL(healthPath, baseUrl)` where `baseUrl` is
 * `project.healthUrl` — a value any user holding WEBSITE_CREATE could set through
 * POST /api/deploy/projects or PATCH /api/deploy/projects/[id], validated only by
 * `z.string().url()`. The reply is not merely observed: `marker` is parsed from
 * the response and the whole `VerifyResult` is persisted to
 * `deployment.healthResult`, so pointing healthUrl at an instance metadata
 * service turned a deployment record into a read-back channel for whatever that
 * endpoint returned.
 *
 * The repository already had the right primitive — `isCloudMetadataOrLinkLocalHost`,
 * documented as "must NEVER be contacted by any provider or webhook" — and
 * `validateExternalWebhookUrl` used it for customer webhooks. The deploy probe did
 * not. Separately, `/api/ai/providers` kept its own narrower copy of the same rule,
 * which had drifted: it missed `0.0.0.0`, `::`, `metadata`, `metadata.azure.com`,
 * `instance-data`, `fe80::/10` and IPv4-mapped `::ffff:169.254.x.x`, and did not
 * reject credentials embedded in the URL.
 *
 * These tests fail closed on the metadata targets and prove the legitimate case
 * still works against a real local HTTP server, because a guard that also broke
 * loopback verification would fail every deployment on the host.
 */
import { afterAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import {
  assertNotCloudMetadataUrl,
  isCloudMetadataOrLinkLocalHost,
  isPrivateOrLoopbackHost,
  validateExternalWebhookUrl,
} from "@/lib/security/url-guard";
import { verifyDeployment } from "@/lib/deploy/service";

const REPO = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");

const EXPECTED_SHA = "a".repeat(40);
const EXPECTED_DEPLOYMENT = "deployment-1";

const METADATA_TARGETS = [
  "http://169.254.169.254",
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  "http://[fd00:ec2::254]",
  "http://metadata.google.internal",
  "http://metadata.azure.com",
  "http://instance-data",
  "http://100.100.100.200",
  "http://169.254.0.1",
  "http://[fe80::1]",
  "http://0.0.0.0",
  "http://metadata",
];

describe("cloud metadata and link-local detection", () => {
  it("blocks every metadata target, including the ones the old local list missed", () => {
    for (const target of METADATA_TARGETS) {
      const { hostname } = new URL(target);
      expect(isCloudMetadataOrLinkLocalHost(hostname), target).toBe(true);
      expect(() => assertNotCloudMetadataUrl(target, "test"), target).toThrow(/SSRF protection/);
    }
  });

  it("blocks IPv4-mapped link-local addresses", () => {
    expect(isCloudMetadataOrLinkLocalHost("::ffff:169.254.169.254")).toBe(true);
  });

  it("rejects credentials embedded in a URL", () => {
    expect(() => assertNotCloudMetadataUrl("http://user:pass@example.com", "test")).toThrow(
      /credentials/,
    );
  });

  it("rejects non-HTTP schemes", () => {
    for (const scheme of ["file:///etc/passwd", "gopher://169.254.169.254", "ftp://example.com"]) {
      expect(() => assertNotCloudMetadataUrl(scheme, "test")).toThrow();
    }
  });

  it("still allows loopback and private ranges, which the deploy probe legitimately needs", () => {
    // Blocking these would fail every deployment: the default health base URL is
    // 127.0.0.1 and self-hosted AI engines live on private addresses.
    for (const allowed of ["http://127.0.0.1:3051", "http://localhost:8080", "http://10.0.0.5", "http://192.168.1.20"]) {
      expect(() => assertNotCloudMetadataUrl(allowed, "test")).not.toThrow();
      expect(isCloudMetadataOrLinkLocalHost(new URL(allowed).hostname)).toBe(false);
    }
    // The stricter external-webhook policy still rejects them, as it should.
    expect(isPrivateOrLoopbackHost("127.0.0.1")).toBe(true);
    expect(validateExternalWebhookUrl("http://127.0.0.1/hook").ok).toBe(false);
  });
});

describe("verifyDeployment refuses to probe a metadata target", () => {
  it("fails closed for every metadata base URL, without making a request", async () => {
    for (const baseUrl of METADATA_TARGETS) {
      const result = await verifyDeployment({
        baseUrl,
        healthPath: "/api/health",
        expectedSha: EXPECTED_SHA,
        expectedDeploymentId: EXPECTED_DEPLOYMENT,
        attempts: 1,
        delayMs: 1,
      });
      expect(result.ok, baseUrl).toBe(false);
      // attempts 0 proves it was rejected before the probe loop, not after a
      // request that happened to fail.
      expect(result.attempts, baseUrl).toBe(0);
      expect(result.httpStatus, baseUrl).toBeNull();
      expect(result.marker, baseUrl).toBeNull();
      expect(result.reason, baseUrl).toMatch(/SSRF protection|not a valid absolute URL/);
    }
  });

  it("cannot be smuggled through healthPath, which overrides the base when absolute", async () => {
    // new URL("http://169.254.169.254/x", "http://127.0.0.1:3051") discards the
    // base entirely, so guarding only baseUrl would leave this open.
    const result = await verifyDeployment({
      baseUrl: "http://127.0.0.1:3051",
      healthPath: "http://169.254.169.254/latest/meta-data/",
      expectedSha: EXPECTED_SHA,
      expectedDeploymentId: EXPECTED_DEPLOYMENT,
      attempts: 1,
      delayMs: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.reason).toMatch(/SSRF protection/);
  });

  it("rejects an unusable base URL instead of throwing past the caller", async () => {
    const result = await verifyDeployment({
      baseUrl: "not a url",
      healthPath: "/api/health",
      expectedSha: EXPECTED_SHA,
      expectedDeploymentId: EXPECTED_DEPLOYMENT,
      attempts: 1,
      delayMs: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
  });
});

describe("verifyDeployment still verifies a real local release", () => {
  const servers: http.Server[] = [];
  afterAll(async () => {
    for (const server of servers) await new Promise((r) => server.close(r));
  });

  async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("accepts a healthy loopback release whose marker matches", async () => {
    const baseUrl = await serve((req, res) => {
      if (req.url === "/__alo_release.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ commitSha: EXPECTED_SHA, deploymentId: EXPECTED_DEPLOYMENT }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
    });

    const result = await verifyDeployment({
      baseUrl,
      healthPath: "/api/health",
      expectedSha: EXPECTED_SHA,
      expectedDeploymentId: EXPECTED_DEPLOYMENT,
      attempts: 2,
      delayMs: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.marker?.commitSha).toBe(EXPECTED_SHA);
  });

  it("still refuses a 200 from a stale process whose marker does not match", async () => {
    const baseUrl = await serve((req, res) => {
      if (req.url === "/__alo_release.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ commitSha: "b".repeat(40), deploymentId: "other" }));
        return;
      }
      res.writeHead(200);
      res.end("{}");
    });

    const result = await verifyDeployment({
      baseUrl,
      healthPath: "/api/health",
      expectedSha: EXPECTED_SHA,
      expectedDeploymentId: EXPECTED_DEPLOYMENT,
      attempts: 2,
      delayMs: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("release marker mismatch");
  });
});

describe("the SSRF rule exists once, not per route", () => {
  it("ai/providers delegates to the shared guard", () => {
    const route = read("src/app/api/ai/providers/route.ts");
    expect(route).toContain("assertNotCloudMetadataUrl");
    expect(route).toContain("@/lib/security/url-guard");
    // The narrower hand-rolled list is gone.
    expect(route).not.toContain("host === '169.254.169.254'");
    expect(route).not.toContain("Cloud metadata endpoints are blocked (SSRF protection)");
  });

  it("every route that accepts a healthUrl validates it", () => {
    for (const route of [
      "src/app/api/deploy/projects/route.ts",
      "src/app/api/deploy/projects/[id]/route.ts",
    ]) {
      const code = read(route);
      expect(code, route).toContain("healthUrl");
      expect(code, route).toContain("assertNotCloudMetadataUrl");
      expect(code, route).toContain("cloud metadata or link-local address");
    }
  });

  it("the probe itself is guarded, so a value already in the database cannot be used", () => {
    // Input validation does not cover rows written before the guard existed.
    const service = read("src/lib/deploy/service.ts");
    expect(service).toContain("assertNotCloudMetadataUrl");
    expect(service).toMatch(/import \{ assertNotCloudMetadataUrl \} from "@\/lib\/security\/url-guard"/);
  });
});
