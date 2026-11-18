/**
 * SEC-07 regression tests — agent task signing, transport and lifecycle.
 *
 * Three distinct defects, all established by reading the code before this
 * change and all now covered:
 *
 *   1. Task signatures were produced by the control plane and never verified by
 *      the agent (`verify()` was defined in agent/alo-agent.mjs and never
 *      called), and the signed body omitted fields the agent actually executed.
 *   2. The agent accepted a plain-http panel URL, and the enrollment response
 *      carries the agent's signing secret.
 *   3. `expireStaleTasks` flipped ASSIGNED (running) tasks to TIMED_OUT on a
 *      five-minute `createdAt` window, while allowlisted commands may run ten
 *      minutes.
 *
 * Adversarial cases are exercised directly against the agent's exported
 * verifier: forged signature, replayed payload, mutated field, injected extra
 * field, and a timestamp outside the replay window.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  signTaskEnvelope,
  canonicalTaskDocument,
  SIGNED_TASK_FIELDS,
  signPayload,
} from "../src/lib/agents/agent";

const ROOT = path.resolve(__dirname, "..");
const SECRET = "agent-secret-value-for-tests-only-0123456789";

type AgentModule = {
  verifyClaimedTask: (envelope: unknown, secret: string) => { ok: boolean; reason?: string; task?: Record<string, unknown> };
  assertPanelTransport: (url: string) => void;
  canonicalTaskDocument: (task: Record<string, unknown>) => string;
  SIGNED_TASK_FIELDS: readonly string[];
};

let agent: AgentModule;
beforeEach(async () => {
  agent = (await import("../agent/alo-agent.mjs")) as unknown as AgentModule;
});

const task = {
  id: "task-abc",
  command: "service.restart",
  args: JSON.stringify({ unit: "nginx" }),
  timeoutMs: 60_000,
  correlationId: "corr-1",
  jobId: "job-1",
};

const envelopeFor = (overrides: Partial<typeof task> = {}, secret = SECRET, timestamp = String(Date.now())) => {
  const nonce = randomBytes(12).toString("hex");
  return signTaskEnvelope(secret, { ...task, ...overrides }, timestamp, nonce);
};

describe("SEC-07 task document canonicalisation", () => {
  it("uses one fixed field order that both sides agree on", () => {
    expect(agent.SIGNED_TASK_FIELDS).toEqual([...SIGNED_TASK_FIELDS]);
  });

  it("produces byte-identical canonical strings server-side and agent-side", () => {
    const server = canonicalTaskDocument(task);
    const client = agent.canonicalTaskDocument({ ...task });
    expect(client).toBe(server);
  });

  it("is insensitive to JSON key order but sensitive to values", () => {
    const reordered = {
      jobId: task.jobId,
      correlationId: task.correlationId,
      timeoutMs: task.timeoutMs,
      args: task.args,
      command: task.command,
      id: task.id,
    };
    expect(agent.canonicalTaskDocument(reordered)).toBe(agent.canonicalTaskDocument(task));
    expect(agent.canonicalTaskDocument({ ...task, command: "service.stop" })).not.toBe(agent.canonicalTaskDocument(task));
  });

  it("distinguishes null from the string 'null'", () => {
    expect(agent.canonicalTaskDocument({ ...task, jobId: null })).not.toBe(
      agent.canonicalTaskDocument({ ...task, jobId: "null" }),
    );
  });
});

describe("SEC-07 the agent verifies the signature it receives", () => {
  it("accepts a correctly signed task and returns the rebuilt document", () => {
    const envelope = envelopeFor();
    const verdict = agent.verifyClaimedTask(envelope, SECRET);
    expect(verdict.ok).toBe(true);
    expect(verdict.task).toEqual(task);
  });

  it("rejects a task signed with a different secret", () => {
    const envelope = envelopeFor({}, "some-other-agents-secret");
    const verdict = agent.verifyClaimedTask(envelope, SECRET);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/signature mismatch/);
  });

  it("rejects a payload whose command was changed after signing", () => {
    const envelope = envelopeFor();
    const tampered = { ...envelope, task: { ...envelope.task, command: "ssh.authorized-key-add" } };
    const verdict = agent.verifyClaimedTask(tampered, SECRET);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/signature mismatch/);
  });

  it("rejects a payload with an extra field injected after signing", () => {
    const envelope = envelopeFor();
    const tampered = { ...envelope, task: { ...envelope.task, shellOverride: "rm -rf /" } };
    const verdict = agent.verifyClaimedTask(tampered, SECRET);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/unsigned fields: shellOverride/);
  });

  it("rejects a signature replayed onto a different task id", () => {
    const envelope = envelopeFor();
    const moved = { ...envelope, task: { ...envelope.task, id: "task-other" } };
    expect(agent.verifyClaimedTask(moved, SECRET).ok).toBe(false);
  });

  it("rejects a replayed envelope once the timestamp is outside the window", () => {
    const stale = envelopeFor({}, SECRET, String(Date.now() - 10 * 60_000));
    const verdict = agent.verifyClaimedTask(stale, SECRET);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/replay window/);
  });

  it("rejects a task with no signature (an unsigned claim response)", () => {
    const verdict = agent.verifyClaimedTask({ task }, SECRET);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/incomplete/);
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [null, undefined, 42, "string", [], { task: null }]) {
      expect(() => agent.verifyClaimedTask(bad, SECRET)).not.toThrow();
      expect(agent.verifyClaimedTask(bad, SECRET).ok).toBe(false);
    }
  });

  it("rejects an empty command even with a valid signature", () => {
    const envelope = signTaskEnvelope(SECRET, { ...task, command: "" }, String(Date.now()), "n1");
    expect(agent.verifyClaimedTask(envelope, SECRET).ok).toBe(false);
  });

  it("uses the same HMAC construction as request authentication", () => {
    // Guards against the two sides drifting: the agent's verify() and the
    // server's signPayload() must be interchangeable.
    const body = canonicalTaskDocument(task);
    const ts = String(Date.now());
    const nonce = "abc123";
    const expected = createHmac("sha256", SECRET)
      .update(`${ts}.${nonce}.${createHash("sha256").update(body).digest("hex")}`)
      .digest("hex");
    expect(signPayload(SECRET, body, ts, nonce)).toBe(expected);
    expect(agent.verifyClaimedTask({ task, signature: expected, timestamp: ts, nonce }, SECRET).ok).toBe(true);
  });
});

describe("SEC-07 panel transport", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("accepts https anywhere", () => {
    expect(() => agent.assertPanelTransport("https://panel.example.com")).not.toThrow();
  });

  it("accepts plain http on loopback for a collocated panel", () => {
    for (const url of ["http://127.0.0.1:3051", "http://localhost:3051", "http://[::1]:3051"]) {
      expect(() => agent.assertPanelTransport(url), url).not.toThrow();
    }
  });

  it("refuses plain http to a remote host, which would expose the agent secret", () => {
    expect(() => agent.assertPanelTransport("http://panel.example.com")).toThrow(/Refusing to send agent credentials/);
    expect(() => agent.assertPanelTransport("http://10.0.0.5:3051")).toThrow(/Refusing to send agent credentials/);
  });

  it("honours the documented private-hop override", () => {
    process.env.ALO_ALLOW_INSECURE_PANEL = "1";
    expect(() => agent.assertPanelTransport("http://10.0.0.5:3051")).not.toThrow();
  });

  it("refuses a non-http scheme", () => {
    expect(() => agent.assertPanelTransport("ftp://panel.example.com")).toThrow(/must be http/);
  });
});

describe("SEC-07 task lifecycle", () => {
  it("the agent refuses to execute a task the panel says is no longer assigned", () => {
    const source = fs.readFileSync(path.join(ROOT, "agent/alo-agent.mjs"), "utf8");
    const poll = source.slice(source.indexOf("export async function pollAndRunOnce"));
    const startCall = poll.indexOf("/api/agents/tasks/start");
    const execute = poll.indexOf("await executeTask(");
    expect(startCall).toBeGreaterThan(-1);
    expect(startCall).toBeLessThan(execute);
    expect(poll).toMatch(/started === false/);
  });

  it("expiry only touches tasks that have not started, plus overrunning RUNNING tasks", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/agents/agent.ts"), "utf8");
    const block = source.slice(source.indexOf("export async function expireStaleTasks"));
    expect(block).not.toMatch(/status:\s*\{\s*in:\s*\[\s*"PENDING",\s*"ASSIGNED"/);
    expect(block).toContain('status: "PENDING"');
    expect(block).toContain('status: "ASSIGNED"');
    expect(block).toContain('status: "RUNNING"');
  });

  it("exposes a start transition and a start route", () => {
    expect(fs.existsSync(path.join(ROOT, "src/app/api/agents/tasks/start/route.ts"))).toBe(true);
    const lib = fs.readFileSync(path.join(ROOT, "src/lib/agents/agent.ts"), "utf8");
    expect(lib).toMatch(/export async function startTask\(/);
    // The transition is a conditional update on ASSIGNED, so it cannot resurrect
    // a task that was expired or re-assigned.
    const startFn = lib.slice(lib.indexOf("export async function startTask("));
    expect(startFn.slice(0, 600)).toContain('status: "ASSIGNED"');
    expect(startFn.slice(0, 600)).toContain('status: "RUNNING"');
  });

  it("signs the complete executed document, not a four-field projection", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/api/agents/tasks/claim/route.ts"), "utf8");
    expect(route).toContain("signTaskEnvelope");
    expect(route).not.toMatch(/JSON\.stringify\(\{\s*taskId:\s*task\.id,\s*command:/);
  });
});
