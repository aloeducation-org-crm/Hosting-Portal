/**
 * Dynamic Nginx + PM2 + Certbot provisioning tests.
 *
 * Covers the three real-world hosting-provider capabilities the panel must
 * own to act as a hosting provider:
 *   1. Dynamic application-port allocation that checks the DB (GitProject +
 *      Website), the reserved platform-port registry, AND a live OS TCP probe.
 *   2. The Nginx helper that writes + enables + reloads a server block.
 *   3. The Certbot helper that issues / inspects certificates.
 * Plus the env-gated orchestration wiring (launchSite / provisionRuntime) and
 * the importRepository change that lets Next.js/Node auto-deploy under PM2.
 */
import "./helpers/isolated-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";

import {
  allocateFreePort,
  isPortFree,
  launchSite,
  portCandidates,
  provisionRuntime,
} from "@/lib/deploy/provision";
import { ALO_SERVER_SPEC } from "@/lib/deploy/server-spec";
import { teardownIsolatedDb } from "./helpers/isolated-db";

const REPO = process.cwd();
const NGINX_HELPER = path.join(REPO, "helpers", "alo-nginx-helper");
const CERTBOT_HELPER = path.join(REPO, "helpers", "alo-certbot-helper");
const RESERVED = ALO_SERVER_SPEC.portAllocation.reservedPorts;

function runHelper(helper: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync("bash", [helper, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("dynamic port allocation", () => {
  it("isPortFree reports true for an unbound port and false for a bound one", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    expect(await isPortFree(port)).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortFree(port)).toBe(true);
  });

  it("portCandidates skips reserved and used ports, starting at the preferred base", () => {
    const used = new Set([3062, 3063]);
    const gen = portCandidates(used, 3062);
    const first = gen.next().value;
    expect(first).toBe(3064);
    // No yielded candidate is ever reserved or already used.
    for (let i = 0; i < 300; i++) {
      const candidate = gen.next().value;
      expect(Number.isInteger(candidate)).toBe(true);
      expect(RESERVED).not.toContain(candidate);
      expect(used).not.toContain(candidate);
    }
  });

  it("allocateFreePort returns a DB-free, reserved-free, OS-free port", async () => {
    const port = await allocateFreePort(3062);
    expect(port).toBeGreaterThanOrEqual(3062);
    expect(RESERVED).not.toContain(port);
    expect(await isPortFree(port)).toBe(true);
  });
});

describe("alo-nginx-helper", () => {
  let availDir: string;
  let enabledDir: string;
  let binDir: string;
  let calls: string;

  beforeAll(() => {
    availDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-nginx-avail-"));
    enabledDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-nginx-enabled-"));
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-nginx-bin-"));
    calls = path.join(binDir, "nginx.calls");
    fs.writeFileSync(path.join(binDir, "nginx"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NGINX_TEST_CALLS"\n', { mode: 0o700 });
  });

  afterAll(() => {
    fs.rmSync(availDir, { recursive: true, force: true });
    fs.rmSync(enabledDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  const env = () => ({ NGINX_SITES_AVAILABLE: availDir, NGINX_SITES_ENABLED: enabledDir,
    PATH: `${binDir}:${process.env.PATH}`, NGINX_TEST_CALLS: calls,
  });

  it("passes bash syntax validation", () => {
    expect(() => execFileSync("bash", ["-n", NGINX_HELPER], { encoding: "utf8" })).not.toThrow();
  });

  it("site-add writes a vhost, enables it, and reports success", () => {
    const out = JSON.parse(runHelper(NGINX_HELPER, ["site-add", "app.example.com", "3063"], env()));
    expect(out.success).toBe(true);
    expect(out.port).toBe(3063);
    const conf = path.join(availDir, "app.example.com.conf");
    expect(fs.existsSync(conf)).toBe(true);
    const text = fs.readFileSync(conf, "utf8");
    expect(text).toContain("server_name app.example.com;");
    expect(text).toContain("proxy_pass http://127.0.0.1:3063;");
    expect(text).toContain("location /.well-known/acme-challenge/");
    expect(fs.existsSync(path.join(enabledDir, "app.example.com"))).toBe(true);
    expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toEqual(["-t", "-s reload"]);
  });

  it("site-add is idempotent for a matching upstream port", () => {
    const out = JSON.parse(runHelper(NGINX_HELPER, ["site-add", "app.example.com", "3063"], env()));
    expect(out.success).toBe(true);
  });

  it("site-add refuses a reserved platform port", () => {
    let threw = false;
    let out = "";
    try {
      out = runHelper(NGINX_HELPER, ["site-add", "app.example.com", "3051"], env());
    } catch (error) {
      threw = true;
      out = (error as { stdout?: string }).stdout ?? "";
    }
    expect(threw).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/reserved/);
  });

  it("site-exists reports whether a vhost is enabled", () => {
    const yes = JSON.parse(runHelper(NGINX_HELPER, ["site-exists", "app.example.com"], env()));
    expect(yes.success).toBe(true);
    expect(yes.exists).toBe(true);
    const no = JSON.parse(runHelper(NGINX_HELPER, ["site-exists", "missing.example.com"], env()));
    expect(no.exists).toBe(false);
  });

  it("site-remove disables and deletes the vhost", () => {
    const out = JSON.parse(runHelper(NGINX_HELPER, ["site-remove", "app.example.com"], env()));
    expect(out.success).toBe(true);
    expect(fs.existsSync(path.join(availDir, "app.example.com.conf"))).toBe(false);
    expect(fs.existsSync(path.join(enabledDir, "app.example.com"))).toBe(false);
  });
});

describe("alo-certbot-helper", () => {
  let liveDir: string;

  beforeAll(() => {
    liveDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-certbot-live-"));
  });

  afterAll(() => {
    fs.rmSync(liveDir, { recursive: true, force: true });
  });

  const env = () => ({ CERTBOT_LIVE_BASE: liveDir });

  it("passes bash syntax validation", () => {
    expect(() => execFileSync("bash", ["-n", CERTBOT_HELPER], { encoding: "utf8" })).not.toThrow();
  });

  it("info reports installed:false when no certificate exists", () => {
    const out = JSON.parse(runHelper(CERTBOT_HELPER, ["info", "app.example.com"], env()));
    expect(out.success).toBe(true);
    expect(out.installed).toBe(false);
    expect(out.expiry).toBeNull();
  });

  it("rejects an invalid domain", () => {
    let threw = false;
    try {
      runHelper(CERTBOT_HELPER, ["info", "../etc/passwd"], env());
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("provision orchestration (env-gated, no host required)", () => {
  const saved = { ...process.env };

  afterAll(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it("launchSite allocates a port and skips provisioning when all toggles are off", async () => {
    process.env.ALO_PROVISION_PM2 = "0";
    process.env.ALO_PROVISION_NGINX = "0";
    process.env.ALO_PROVISION_SSL = "0";
    const result = await launchSite({ domain: "app.example.com", startCommand: "npm start" });
    expect(result.port).toBeGreaterThanOrEqual(3062);
    const pm2 = result.steps.find((s) => s.step === "pm2")!;
    const nginx = result.steps.find((s) => s.step === "nginx")!;
    const ssl = result.steps.find((s) => s.step === "ssl")!;
    expect(pm2.attempted).toBe(false);
    expect(nginx.attempted).toBe(false);
    expect(ssl.attempted).toBe(false);
    expect(result.steps.find((s) => s.step === "port")!.ok).toBe(true);
  });

  it("provisionRuntime reports skipped steps without throwing when toggles are off", async () => {
    process.env.ALO_PROVISION_NGINX = "0";
    process.env.ALO_PROVISION_SSL = "0";
    const result = await provisionRuntime({ domain: "app.example.com", port: 3063 });
    expect(result.nginx.attempted).toBe(false);
    expect(result.ssl.attempted).toBe(false);
  });
});

describe("importRepository auto-deploy wiring", () => {
  it("maps Next.js/Node frameworks to PM2 instead of forcing operator approval", () => {
    // Source-level contract: the local deploy path must register a PM2 service
    // for Node runtimes so a GitHub push deploys end-to-end, rather than
    // pausing for an operator-configured service manager.
    const source = fs.readFileSync(path.join(REPO, "src/lib/deploy/projects.ts"), "utf8");
    expect(source).toMatch(/NODE_SERVER_FRAMEWORKS\s*=\s*\[[^\]]*"nextjs"[^\]]*\]/);
    expect(source).toMatch(/config\.serviceManager = "pm2"/);
    expect(source).toMatch(/serviceName = `alo-\$\{slugify/);
    expect(source).toMatch(/config\.serviceName = serviceName/);
    expect(source).toMatch(/isReservedServiceName/);
    // Non-Node runtimes still require operator wiring.
    expect(source).toMatch(/"django", "fastapi", "flask", "python", "php-composer", "laravel"/);
  });

  it("allocatePort delegates to the DB + OS-probe allocator", () => {
    const source = fs.readFileSync(path.join(REPO, "src/lib/deploy/projects.ts"), "utf8");
    expect(source).toContain("allocateFreePort");
    expect(source).not.toMatch(/for \(let port = base; port < base \+ 200/);
  });
});

afterAll(async () => {
  await teardownIsolatedDb();
});
