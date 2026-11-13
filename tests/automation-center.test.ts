/**
 * Automation Center: admin-only API, durable workflow/profile behaviour and
 * honest presentation. Every database write goes to an isolated scratch copy.
 */
import { teardownIsolatedDb, isolatedDbPath } from "./helpers/isolated-db";
import { applyCurrentSchema } from "./helpers/apply-schema";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { GET, POST } from "@/app/api/automation/admin/route";
import { orchestrator } from "@/lib/orchestrator/orchestrator";
import { createWorkflow, startWorkflow, advanceRun, actorForUser, validateWorkflowDefinition } from "@/lib/orchestrator/workflows";
import { createProfile, verifyProfile, activeProfile, rollbackProfile, reconcileProfileVerifications } from "@/lib/orchestrator/profiles";
import { inlineWorkerEnabled } from "@/lib/deploy/queue";
import { canAccessRoute, isAdminPath, config as proxyConfig } from "@/proxy";
import { verificationLabel } from "@/components/dashboard/automation/model";

// The committed database is deliberately a pre-release fixture (see
// migration-safety.test.ts and deploy-harness.ts: "never mutate it"), so this
// file brings its own scratch copy up to the full current schema — additive
// migrations plus the authorized operation_jobs rebuild, because platform-scope
// automation jobs store a NULL websiteId.
beforeAll(() => {
  applyCurrentSchema(isolatedDbPath);
}, 180_000);

afterAll(async () => { await teardownIsolatedDb(); });
afterEach(() => { delete process.env.DEPLOY_INLINE_WORKER; delete process.env.AUTOMATION_TEST_MISSING_CREDENTIAL; });

async function request(method: "GET" | "POST", email?: string, body?: unknown, url = "http://localhost:3000/api/automation/admin") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (email) {
    const secret = process.env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET;
    headers.cookie = `next-auth.session-token=${await encode({ token: { email, sub: email }, secret })}`;
  }
  return new NextRequest(url, { method, headers, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) });
}
async function adminActor() {
  const admin = await db.user.findFirstOrThrow({ where: { role: { name: { in: ["SUPER_ADMIN", "ADMIN"] } } } });
  return actorForUser(admin.id);
}
const healthyDefinition = { version: 1, steps: [{ key: "nodes", label: "Check nodes", handler: "PLATFORM_OPS", input: { action: "node-health" } }] };

describe("Automation Center access and presentation", () => {
  it("requires an administrator for the read model and every mutation", async () => {
    expect((await GET(await request("GET"))).status).toBe(401);
    expect((await GET(await request("GET", "client@alolabs.net"))).status).toBe(403);
    const denied = await POST(await request("POST", "client@alolabs.net", { action: "workflow.toggle", workflowId: "anything", enabled: true }));
    expect(denied.status).toBe(403);
    expect(isAdminPath("/automation")).toBe(true);
    expect(canAccessRoute("/automation", "CLIENT").allowed).toBe(false);
    expect(canAccessRoute("/automation", "ADMIN").allowed).toBe(true);
    expect((proxyConfig.matcher as string[])).toContain("/automation/:path*");
  });

  it("returns only real catalogue/queue data and never credential values", async () => {
    const res = await GET(await request("GET", "admin@alolabs.net"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.workers.length).toBeGreaterThanOrEqual(13);
    expect(body.data.workflows.some((w: { key: string }) => w.key === "project-lifecycle")).toBe(true);
    expect(body.data.queue.total).toBeTypeOf("number");
    expect(body.data.observedAt).toBeTypeOf("string");
    expect(JSON.stringify(body.data)).not.toContain(process.env.APP_ENCRYPTION_KEY!);
    expect(JSON.stringify(body.data)).not.toContain(process.env.NEXTAUTH_SECRET!);
  });

  it("never renders OK_UNVERIFIED as a verified success", () => {
    expect(verificationLabel(true, "OK_UNVERIFIED")).toBe("Unverified");
    expect(verificationLabel(false)).toBe("Unverified");
    expect(verificationLabel(null)).toBe("Not yet verified");
    expect(verificationLabel(true, "OK")).toBe("Verified");
    const ui = fs.readFileSync(path.resolve("src/components/dashboard/AutomationCenter.tsx"), "utf8");
    expect(ui).toContain("#E8501A");
    expect(ui).toContain("VerificationBadge");
    expect(ui).toContain("No independent evidence was reported.");
    expect(fs.readFileSync(path.resolve("src/components/dashboard/DashboardShell.tsx"), "utf8")).toContain('href: "/automation"');
  });

  it("honours every conventional inline-worker disable value", () => {
    for (const value of ["false", "0", "off", "no", " FALSE "]) {
      process.env.DEPLOY_INLINE_WORKER = value;
      expect(inlineWorkerEnabled(), value).toBe(false);
    }
    for (const value of ["true", "1", ""]) {
      process.env.DEPLOY_INLINE_WORKER = value;
      expect(inlineWorkerEnabled(), value).toBe(true);
    }
  });
});

describe("workflow administration", () => {
  it("rejects cyclic definitions and unknown handlers before persistence", async () => {
    expect(() => validateWorkflowDefinition({ version: 1, steps: [{ key: "a", label: "A", handler: "PLATFORM_OPS", dependsOn: ["b"] }, { key: "b", label: "B", handler: "PLATFORM_OPS", dependsOn: ["a"] }] })).toThrow(/cycle/);
    const before = await db.automationWorkflow.count();
    const res = await POST(await request("POST", "admin@alolabs.net", { action: "workflow.create", key: "invalid-cycle", name: "Invalid", definition: { version: 1, steps: [{ key: "a", label: "A", handler: "SHELL_EXEC" }] } }));
    expect(res.status).toBe(400);
    expect(await db.automationWorkflow.count()).toBe(before);
  });

  it("freezes a version, collapses duplicate run requests, executes and verifies", async () => {
    const actor = await adminActor();
    const workflow = await createWorkflow({ key: "center-health", name: "Center health", definition: healthyDefinition }, actor);
    const requestId = crypto.randomUUID();
    const first = await POST(await request("POST", "admin@alolabs.net", { action: "workflow.run", workflowId: workflow.id, requestId }));
    expect(first.status).toBe(200);
    const run = await first.json().then((b) => b.data);
    const duplicate = await POST(await request("POST", "admin@alolabs.net", { action: "workflow.run", workflowId: workflow.id, requestId }));
    expect((await duplicate.json()).data.id).toBe(run.id);
    await orchestrator.runNext("center-test", { kinds: ["PLATFORM_OPS"], lockKey: `workflow:${run.id}` });
    const completed = await db.automationRun.findUniqueOrThrow({ where: { id: run.id }, include: { steps: true } });
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.verified).toBe(true);
    expect(completed.workflowVersion).toBe(1);
    expect(completed.steps[0]!.verified).toBe(true);
    const versioned = await POST(await request("POST", "admin@alolabs.net", { action: "workflow.version", workflowId: workflow.id, definition: healthyDefinition, changeNote: "test revision" }));
    expect(versioned.status).toBe(200);
    expect((await versioned.json()).data.version).toBe(2);
    expect((await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })).workflowVersion).toBe(1);
  });

  it("does not claim verification for an all-skipped run", async () => {
    const actor = await adminActor();
    const workflow = await createWorkflow({ key: "center-skipped", name: "Skipped", definition: { version: 1, steps: [{ key: "nodes", label: "Check nodes", handler: "PLATFORM_OPS", input: { action: "node-health" }, when: { path: "input.enabled", operator: "truthy" } }] } }, actor);
    const run = await startWorkflow({ workflowId: workflow.id, input: { enabled: false }, actor, trigger: "manual" });
    await advanceRun(run.id, orchestrator);
    const stored = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored.status).toBe("SUCCEEDED");
    expect(stored.verified).toBe(false);
  });

  it("advances a join step whose alternative branches were skipped (self-heal shape)", async () => {
    const actor = await adminActor();
    // Same shape as the builtin self-heal workflow: diagnose, three mutually
    // exclusive recovery branches gated by `when`, and a verify join that
    // depends on all of them. Regression: a SKIPPED dependency used to count
    // as unsatisfied, so the join could never run and the run never ended.
    const definition = {
      version: 1,
      steps: [
        { key: "diagnose", label: "Diagnose", handler: "PLATFORM_OPS", input: { action: "node-health" } },
        { key: "restart", label: "Restart", handler: "PLATFORM_OPS", dependsOn: ["diagnose"], when: { path: "input.recovery", operator: "equals", value: "restart" }, input: { action: "node-health" } },
        { key: "rollback", label: "Rollback", handler: "PLATFORM_OPS", dependsOn: ["diagnose"], when: { path: "input.recovery", operator: "equals", value: "rollback" }, input: { action: "node-health" } },
        { key: "restart-static", label: "Restart static", handler: "PLATFORM_OPS", dependsOn: ["diagnose"], when: { path: "input.recovery", operator: "equals", value: "restart-static" }, input: { action: "node-health" } },
        { key: "verify", label: "Verify", handler: "PLATFORM_OPS", dependsOn: ["restart", "rollback", "restart-static"], input: { action: "node-health" } },
      ],
    };
    const workflow = await createWorkflow({ key: "center-join", name: "Join", definition }, actor);
    const run = await startWorkflow({ workflowId: workflow.id, input: { recovery: "rollback" }, actor, trigger: "manual" });
    // diagnose, then the taken branch, then the join step.
    for (let i = 0; i < 3; i++) await orchestrator.runNext(`center-join-${i}`, { kinds: ["PLATFORM_OPS"], lockKey: `workflow:${run.id}` });
    const completed = await db.automationRun.findUniqueOrThrow({ where: { id: run.id }, include: { steps: { orderBy: { ordinal: "asc" } } } });
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.verified).toBe(true);
    expect(Object.fromEntries(completed.steps.map((s) => [s.key, s.status]))).toMatchObject({
      diagnose: "SUCCEEDED",
      restart: "SKIPPED",
      rollback: "SUCCEEDED",
      "restart-static": "SKIPPED",
      verify: "SUCCEEDED",
    });
  });

  it("cancels pending work through the admin API and records an audit", async () => {
    const actor = await adminActor();
    const workflow = await createWorkflow({ key: "center-cancel", name: "Cancel", definition: healthyDefinition }, actor);
    const run = await startWorkflow({ workflowId: workflow.id, input: {}, actor, trigger: "manual" });
    const res = await POST(await request("POST", "admin@alolabs.net", { action: "run.cancel", runId: run.id, reason: "Operator stopped the test" }));
    expect(res.status).toBe(200);
    expect((await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELLED");
    const job = await db.operationJob.findFirstOrThrow({ where: { type: "center-cancel:nodes" } });
    expect(job.status).toBe("CANCELLED");
    expect(await db.auditLog.count({ where: { action: "AUTOMATION_RUN_CANCELLED", resourceId: run.id } })).toBe(1);
  });
});

describe("profile administration", () => {
  it("keeps a new version inactive until verification, then permits verified rollback", async () => {
    const actor = await adminActor();
    const first = await createProfile({ key: "center-node", name: "Node", kind: "node", config: { agentId: "agent-a", maxConcurrency: 2 } }, actor);
    expect(first.version.status).toBe("VALIDATED");
    expect(await activeProfile("center-node")).toBeNull();
    await verifyProfile(first.version.id, actor, crypto.randomUUID());
    await orchestrator.runNext("center-profile", { kinds: ["WORKFLOW_STEP"] });
    const verified = await db.automationProfileVersion.findUniqueOrThrow({ where: { id: first.version.id } });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedById).toBe(actor.id);
    expect((await activeProfile("center-node"))?.version).toBe(1);
    const second = await createProfile({ key: "center-node", name: "Node", kind: "node", config: { agentId: "agent-b", maxConcurrency: 1 } }, actor);
    await expect(rollbackProfile(first.profile.id, second.version.version, actor)).rejects.toThrow(/previously verified/);
    await verifyProfile(second.version.id, actor, crypto.randomUUID());
    await orchestrator.runNext("center-profile", { kinds: ["WORKFLOW_STEP"] });
    expect((await activeProfile("center-node"))?.version).toBe(2);
    await rollbackProfile(first.profile.id, 1, actor);
    expect((await activeProfile("center-node"))?.version).toBe(1);
  });

  it("reports missing credential references and can retry after they are supplied", async () => {
    const actor = await adminActor();
    delete process.env.AUTOMATION_TEST_MISSING_CREDENTIAL;
    const created = await createProfile({ key: "center-github", name: "GitHub", kind: "github", config: { connectionId: "connection-a", credential: { envName: "AUTOMATION_TEST_MISSING_CREDENTIAL" } } }, actor);
    const job = await verifyProfile(created.version.id, actor, crypto.randomUUID());
    await orchestrator.runNext("center-profile", { kinds: ["WORKFLOW_STEP"] });
    expect((await db.operationJob.findUniqueOrThrow({ where: { id: job.jobId } })).lastError).toBe("WAITING_CREDENTIALS");
    expect((await db.automationProfileVersion.findUniqueOrThrow({ where: { id: created.version.id } })).status).toBe("FAILED");
    expect(await activeProfile("center-github")).toBeNull();
    process.env.AUTOMATION_TEST_MISSING_CREDENTIAL = "reference-is-now-present";
    const retry = await verifyProfile(created.version.id, actor, crypto.randomUUID());
    expect(retry.jobId).not.toBe(job.jobId);
    await orchestrator.runNext("center-profile", { kinds: ["WORKFLOW_STEP"] });
    await reconcileProfileVerifications();
    expect((await activeProfile("center-github"))?.version).toBe(1);
  });

  it("refuses plaintext credential values in profile configuration", async () => {
    const res = await POST(await request("POST", "admin@alolabs.net", { action: "profile.create", key: "center-bad-secret", name: "Bad", kind: "github", config: { connectionId: "c", credential: { token: "plaintext-secret" } } }));
    expect(res.status).toBe(400);
    expect(await db.automationProfile.count({ where: { key: "center-bad-secret" } })).toBe(0);
  });
});

describe("approval controls", () => {
  it("approves only a waiting job through the admin endpoint", async () => {
    const actor = await adminActor();
    const job = await orchestrator.enqueue({ kind: "INFRASTRUCTURE", type: "center-approval", input: { agentId: "agent-a", command: "service.status", args: { unit: "alo-site-example.test" } }, actor, requiresApproval: true });
    expect(job.status).toBe("WAITING_APPROVAL");
    const res = await POST(await request("POST", "admin@alolabs.net", { action: "job.approve", jobId: job.jobId, note: "Reviewed read-only status request" }));
    expect(res.status).toBe(200);
    const stored = await db.operationJob.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(stored.status).toBe("QUEUED");
    expect(stored.approvedBy).toBe("admin@alolabs.net");
    const again = await POST(await request("POST", "admin@alolabs.net", { action: "job.approve", jobId: job.jobId }));
    expect(again.status).toBe(400);
  });
});
