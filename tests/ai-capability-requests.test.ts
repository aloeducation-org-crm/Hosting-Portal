import { isolatedDbPath, teardownIsolatedDb } from "./helpers/isolated-db";
import { execFileSync } from "node:child_process";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { capabilityRequestSchema, createCapabilityRequest, reviewCapabilityRequest, capabilityRequestPresentation } from "@/lib/ai/capability-requests";
import { readCapabilityJson } from "@/lib/ai/capability-http";
import { GET, POST } from "@/app/api/ai/capability-requests/route";
import { canAccessRoute, isProtectedDashboardPath } from "@/proxy";
import { PATCH } from "@/app/api/ai/capability-requests/[id]/route";

let admin: AuthUser; let reviewer: AuthUser; let client: AuthUser; let projectId: string;
const scope = () => ({ projectId, capability: "REVERSE_ENGINEERING", targetKind: "NATIVE_BINARY", targetReference: "owned-fixture.bin", targetSha256: "a".repeat(64), objective: "Inspect static procedure boundaries", authorizationEvidence: "Owned internal fixture; authorization ticket TEST-1", authorizedInspection: true });
const review = (scopeDigest: string, action = "APPROVE") => ({ scopeDigest, action, reason: "Reviewed the authorized fixture scope" });
async function request(actor?: AuthUser, method = "GET", body?: unknown) {
  const headers = new Headers();
  if (actor) headers.set("cookie", `next-auth.session-token=${await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { sub: actor.id, email: actor.email, role: actor.role } })}`);
  return new NextRequest("http://localhost/api/ai/capability-requests", { method, headers, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}
function failAuditOnce() {
  const transaction = db.$transaction.bind(db);
  vi.spyOn(db, "$transaction").mockImplementationOnce((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async (tx) => callback(new Proxy(tx, {
    get(target, property) { if (property === "auditLog") return { create: async () => { throw new Error("injected audit failure"); } }; return Reflect.get(target, property); },
  })))) as never);
}
beforeAll(async () => {
  expect(isolatedDbPath).toMatch(/alo-test-db-/);
  // Apply ONLY this additive migration, to this file's disposable database copy.
  for (const flags of [["--check"], [], [], ["--verify"]]) {
    const output = execFileSync(process.execPath, ["scripts/apply-deploy-schema.mjs", "--migration", "20261031090000_ai_capability_requests", ...flags], {
      env: { ...process.env, DATABASE_URL: `file:${isolatedDbPath}` }, encoding: "utf8", timeout: 30000,
    });
    expect(JSON.parse(output.slice(output.indexOf("{"))).ok).toBe(true);
  }
  projectId = (await db.project.create({ data: { name: "Capability test project" } })).id;
  const actors: AuthUser[] = [];
  for (const [index, role] of ["ADMIN", "SUPER_ADMIN", "CLIENT"].entries()) {
    const roleRow = await db.role.upsert({ where: { name: role }, update: {}, create: { name: role } });
    const user = await db.user.create({ data: { email: `capability-${index}@test.invalid`, roleId: roleRow.id } });
    actors.push({ id: user.id, email: user.email, role, permissions: [] });
  }
  [admin, reviewer, client] = actors;
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(teardownIsolatedDb);

describe("durable non-executable capability intake", () => {
  it("stores scope and audit atomically, never issuing execution authority", async () => {
    const record = await createCapabilityRequest(admin, scope());
    expect(record).toMatchObject({ effectiveStatus: "REQUESTED", executionState: "REQUIRES_APPROVAL", executable: false });
    expect(record.scopeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await db.auditLog.count({ where: { resourceId: record.id, action: "AI_CAPABILITY_REQUESTED" } })).toBe(1);
  });
  it("blocks non-admin service calls", async () => {
    await expect(createCapabilityRequest(client, scope())).rejects.toMatchObject({ status: 403 });
  });
  it("requires an existing project", async () => {
    await expect(createCapabilityRequest(admin, { ...scope(), projectId: "missing-project" })).rejects.toMatchObject({ status: 404 });
  });
  it.each([
    { authorizedInspection: false }, { authorizationEvidence: "short" }, { targetSha256: "bad" },
    { capability: "CODE_EVOLUTION" }, { extraCommand: "anything" },
    { targetReference: "bad\nreference" },
    { targetKind: "WEBSITE", targetReference: "http://example.com" },
    { targetKind: "WEBSITE", targetReference: "https://user:secret@example.com" },
    { targetKind: "WEBSITE", targetReference: "https://example.com/?token=secret" },
    { targetKind: "WEBSITE", targetReference: "https://example.com/#fragment" },
  ])("rejects invalid or undeclared scope %j", (override) => {
    expect(capabilityRequestSchema.safeParse({ ...scope(), ...override }).success).toBe(false);
  });
  it("accepts a website reference as data without making a network call", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch targets"));
    const record = await createCapabilityRequest(admin, { ...scope(), targetKind: "WEBSITE", targetReference: "https://example.com/owned-snapshot" });
    expect(record.executable).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts a repository-scoped code-evolution request without generating edits", async () => {
    const record = await createCapabilityRequest(admin, { ...scope(), capability: "CODE_EVOLUTION", targetKind: "SOURCE_REPOSITORY" });
    expect(record.executable).toBe(false);
  });
  it("rolls back request creation if the audit fails", async () => {
    const count = await db.aiCapabilityRequest.count(); failAuditOnce();
    await expect(createCapabilityRequest(admin, scope())).rejects.toThrow("injected audit failure");
    expect(await db.aiCapabilityRequest.count()).toBe(count);
  });
});

describe("independent immutable-scope review", () => {
  it("rejects self-approval and non-admin review", async () => {
    const record = await createCapabilityRequest(admin, scope());
    await expect(reviewCapabilityRequest(admin, record.id, review(record.scopeDigest))).rejects.toMatchObject({ status: 403 });
    await expect(reviewCapabilityRequest(client, record.id, review(record.scopeDigest))).rejects.toMatchObject({ status: 403 });
  });
  it("approves with a bounded expiry, rejects replay, and permits revocation", async () => {
    const record = await createCapabilityRequest(admin, scope());
    const approved = await reviewCapabilityRequest(reviewer, record.id, review(record.scopeDigest));
    expect(approved).toMatchObject({ effectiveStatus: "APPROVED", executionState: "REQUIRES_SETUP", executable: false });
    expect(approved.expiresAt!.getTime() - approved.reviewedAt!.getTime()).toBe(15 * 60000);
    await expect(reviewCapabilityRequest(reviewer, record.id, review(record.scopeDigest))).rejects.toMatchObject({ status: 409 });
    const revoked = await reviewCapabilityRequest(admin, record.id, review(record.scopeDigest, "REVOKE"));
    expect(revoked.effectiveStatus).toBe("REVOKED"); expect(revoked.executable).toBe(false);
    expect(await db.auditLog.count({ where: { resourceId: record.id } })).toBe(3);
  });
  it("rejects stale scope, unknown requests, unsafe expiry and scope mutation", async () => {
    const record = await createCapabilityRequest(admin, scope());
    await expect(reviewCapabilityRequest(reviewer, record.id, review("b".repeat(64)))).rejects.toMatchObject({ status: 409 });
    await expect(reviewCapabilityRequest(reviewer, "missing", review(record.scopeDigest))).rejects.toMatchObject({ status: 404 });
    for (const validForMinutes of [0, 61, 1.5]) await expect(reviewCapabilityRequest(reviewer, record.id, { ...review(record.scopeDigest), validForMinutes })).rejects.toThrow();
    await expect(reviewCapabilityRequest(reviewer, record.id, { ...review(record.scopeDigest), targetReference: "changed" })).rejects.toThrow();
  });
  it("rejects re-approval after rejection", async () => {
    const record = await createCapabilityRequest(admin, scope());
    expect((await reviewCapabilityRequest(reviewer, record.id, review(record.scopeDigest, "REJECT"))).effectiveStatus).toBe("REJECTED");
    await expect(reviewCapabilityRequest(reviewer, record.id, review(record.scopeDigest))).rejects.toMatchObject({ status: 409 });
  });
  it("fails closed at expiry without pretending to execute or renew", async () => {
    const record = await createCapabilityRequest(admin, scope());
    await reviewCapabilityRequest(reviewer, record.id, review(record.scopeDigest));
    const expired = await db.aiCapabilityRequest.update({ where: { id: record.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(capabilityRequestPresentation(expired)).toMatchObject({ effectiveStatus: "EXPIRED", executable: false });
    await expect(reviewCapabilityRequest(reviewer, record.id, review(record.scopeDigest, "REVOKE"))).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back review if the audit fails", async () => {
    const record = await createCapabilityRequest(admin, scope()); failAuditOnce();
    await expect(reviewCapabilityRequest(reviewer, record.id, review(record.scopeDigest))).rejects.toThrow("injected audit failure");
    expect(await db.aiCapabilityRequest.findUnique({ where: { id: record.id } })).toMatchObject({ status: "REQUESTED", reviewedBy: null, expiresAt: null });
  });
});

describe("authenticated capability API and bounded input", () => {
  it("protects the internal UI for administrators only", () => {
    expect(isProtectedDashboardPath("/ai/research")).toBe(true);
    for (const role of ["CLIENT", "RESELLER", "DEVOPS", "SUPPORT", "VIEWER"]) expect(canAccessRoute("/ai/research", role).allowed).toBe(false);
    expect(canAccessRoute("/ai/research", "ADMIN").allowed).toBe(true);
    expect(canAccessRoute("/ai/research", "SUPER_ADMIN").allowed).toBe(true);
  });
  it("does not trust a session for a subsequently disabled account", async () => {
    const req = await request(reviewer);
    await db.user.update({ where: { id: reviewer.id }, data: { isActive: false } });
    try { expect((await GET(req)).status).toBe(403); }
    finally { await db.user.update({ where: { id: reviewer.id }, data: { isActive: true } }); }
  });
  it("requires active administrator authentication for all handlers", async () => {
    for (const actor of [undefined, client]) {
      const expected = actor ? 403 : 401;
      expect((await GET(await request(actor))).status).toBe(expected);
      expect((await POST(await request(actor, "POST", scope()))).status).toBe(expected);
      expect((await PATCH(await request(actor, "PATCH", {}), { params: Promise.resolve({ id: "missing" }) })).status).toBe(expected);
    }
  });
  it("persists through POST/list/PATCH without enabling execution", async () => {
    const created = await POST(await request(admin, "POST", scope())); expect(created.status).toBe(201);
    const record = (await created.json()).data;
    const approved = await PATCH(await request(reviewer, "PATCH", review(record.scopeDigest)), { params: Promise.resolve({ id: record.id }) });
    expect(approved.status).toBe(200); expect((await approved.json()).data.executable).toBe(false);
    const listing = await GET(await request(admin)); expect(listing.headers.get("Cache-Control")).toContain("no-store");
    const data = (await listing.json()).data; expect(data.executionEnabled).toBe(false); expect(data.requests.some((item: { id: string }) => item.id === record.id)).toBe(true);
  });
  it("rejects malformed and oversized bodies", async () => {
    expect((await POST(await request(admin, "POST", "{"))).status).toBe(400);
    expect((await POST(await request(admin, "POST", "x".repeat(12001)))).status).toBe(413);
    expect((await PATCH(await request(admin, "PATCH", "x".repeat(5001)), { params: Promise.resolve({ id: "missing" }) })).status).toBe(413);
  });
  it("cancels an over-limit stream before reading its remaining chunks", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
    const req = new Request("http://localhost", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readCapabilityJson(req, 10)).rejects.toMatchObject({ status: 413 }); expect(cancelled).toBe(true);
  });
  it("reports unavailable storage rather than fake records", async () => {
    vi.spyOn(db.aiCapabilityRequest, "findMany").mockRejectedValueOnce(new Error("private database detail"));
    const response = await GET(await request(admin)); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });
});
