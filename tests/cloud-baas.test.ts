/**
 * Must be the first import: points DATABASE_URL at a throwaway copy of db/custom.db
 * before `@/lib/db` is evaluated so tracked `db/custom.db` is never modified.
 */
import { isolatedDbUrl, teardownIsolatedDb } from "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { db } from "@/lib/db";
import { proxy as middleware, isProtectedDashboardPath, config as middlewareConfig } from "@/proxy";
import { BUILTIN_APPS, ensureBuiltinApps } from "@/lib/app-center";
import {
  APPWRITE_REA_EVIDENCE_LEDGER,
  APPWRITE_RECONSTRUCTION_MATRIX,
  UPSTREAM_INSPECTION_BASELINES,
  verifyReconstructionLedgerIntegrity,
} from "@/lib/ai/rea/reconstruction-ledger";
import {
  CLOUD_PROJECT_SCOPES,
  CLOUD_SITE_FRAMEWORKS,
  buildProjectOnboardingConfig,
  evaluateCloudProjectPosture,
  getCloudFrameworkPreset,
  parseCloudScopes,
  validateCronSchedule,
  validateFunctionEntrypoint,
  validatePlatformIdentifier,
  validateWebhookTargetUrl,
} from "@/lib/cloud/catalog";
import {
  authenticateCloudProjectKey,
  generateCloudApiKey,
  generateWebhookSigningSecret,
  redactCloudSecrets,
  signCloudWebhookPayload,
  verifyCloudWebhookSignature,
} from "@/lib/cloud/crypto-auth";
import { createScopedHostingTools } from "@/lib/ai/automation/tools";
import { runWorkflowGraph } from "@/lib/ai/automation/engine";
import { WORKFLOW_TEMPLATES } from "@/lib/ai/automation/templates";

import { GET as listProjectsGET, POST as createProjectPOST } from "@/app/api/cloud/projects/route";
import {
  GET as getProjectGET,
  PATCH as updateProjectPATCH,
  DELETE as deleteProjectDELETE,
} from "@/app/api/cloud/projects/[id]/route";
import { POST as issueKeyPOST } from "@/app/api/cloud/projects/[id]/keys/route";
import { DELETE as revokeKeyDELETE } from "@/app/api/cloud/projects/[id]/keys/[keyId]/route";
import { POST as registerPlatformPOST } from "@/app/api/cloud/projects/[id]/platforms/route";
import { DELETE as removePlatformDELETE } from "@/app/api/cloud/projects/[id]/platforms/[platformId]/route";
import { POST as createWebhookPOST } from "@/app/api/cloud/projects/[id]/webhooks/route";
import { DELETE as removeWebhookDELETE } from "@/app/api/cloud/projects/[id]/webhooks/[webhookId]/route";
import { POST as createFunctionPOST } from "@/app/api/cloud/projects/[id]/functions/route";
import { DELETE as removeFunctionDELETE } from "@/app/api/cloud/projects/[id]/functions/[functionId]/route";
import { GET as healthGET } from "@/app/api/cloud/v1/health/route";

const TEST_JWT_SECRET = "dev-secret-change-in-production";
const MIGRATION_NAME = "20261102120000_cloud_baas_projects";
const MIGRATION_FILE = path.resolve("prisma/migrations", MIGRATION_NAME, "migration.sql");
const APPLIER_FILE = path.resolve("scripts/apply-deploy-schema.mjs");

async function authedRequest(
  url: string,
  user: { id: string; email: string; role: string },
  init?: { method?: string; body?: string },
): Promise<NextRequest> {
  process.env.NEXTAUTH_SECRET = TEST_JWT_SECRET;
  const token = await encode({
    secret: TEST_JWT_SECRET,
    token: { id: user.id, sub: user.id, email: user.email, role: user.role },
  });
  const headers = new Headers();
  headers.set("cookie", `next-auth.session-token=${token}`);
  if (init?.body) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });
}

afterAll(async () => {
  await teardownIsolatedDb();
});

// ─── 1. REA Evidence Ledger & Reconstruction Matrix ─────────────────────────

describe("Appwrite + REA reconstruction ledger invariants", () => {
  it("pins exact 40-char commit SHAs and permissive licenses for Appwrite and REA", () => {
    expect(UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(UPSTREAM_INSPECTION_BASELINES.appwrite.license).toBe("BSD-3-Clause");
    expect(UPSTREAM_INSPECTION_BASELINES.rea.pinnedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(UPSTREAM_INSPECTION_BASELINES.rea.license).toBe("MIT");
  });

  it("validates every evidence item and capability row with zero dangling references", () => {
    const integrity = verifyReconstructionLedgerIntegrity();
    expect(integrity.evidenceCount).toBe(APPWRITE_REA_EVIDENCE_LEDGER.length);
    expect(integrity.capabilityCount).toBe(APPWRITE_RECONSTRUCTION_MATRIX.length);
    expect(integrity.capabilities.every((c) => c.executableRuntimeAttached === false)).toBe(true);

    // Must explicitly include an `unknown` record for deferred Open Runtimes host execution
    expect(APPWRITE_REA_EVIDENCE_LEDGER.some((e) => e.kind === "unknown")).toBe(true);
    const fnCapability = APPWRITE_RECONSTRUCTION_MATRIX.find((c) => c.id === "serverless-functions-registry");
    expect(fnCapability?.operationalState).toBe("REQUIRES_SETUP");
  });
});

// ─── 2. Pure Domain, Crypto, SSRF & Posture Validators ──────────────────────

describe("Cloud Projects pure catalog, crypto, and security guards", () => {
  it("provides all 10 Appwrite Sites framework presets with SSR and static adapters", () => {
    expect(CLOUD_SITE_FRAMEWORKS.map((f) => f.key)).toEqual([
      "nextjs",
      "tanstack-start",
      "react",
      "sveltekit",
      "astro",
      "nuxt",
      "vue",
      "angular",
      "analog",
      "static",
    ]);
    expect(getCloudFrameworkPreset("nextjs", "ssr")?.adapter.outputDirectory).toBe("./.next");
    expect(getCloudFrameworkPreset("nextjs", "static")?.adapter.outputDirectory).toBe("./out");
    expect(getCloudFrameworkPreset("astro", "static")?.adapter.outputDirectory).toBe("./dist");
  });

  it("parses known granular scopes and drops unknown or wildcard scopes", () => {
    expect(parseCloudScopes(["sites.read", "sites.read", "*", "root.admin", "health.read"])).toEqual([
      "sites.read",
      "health.read",
    ]);
  });

  it("validates web hostnames vs production localhost restriction and reverse-DNS bundle IDs", () => {
    expect(validatePlatformIdentifier("web", "localhost", "development")).toEqual({
      ok: true,
      normalized: "localhost",
    });
    expect(validatePlatformIdentifier("web", "localhost", "production").ok).toBe(false);
    expect(validatePlatformIdentifier("nextjs", "https://bad-origin.example.com", "production").ok).toBe(false);
    expect(validatePlatformIdentifier("nextjs", "*.alolabs.net", "production")).toEqual({
      ok: true,
      normalized: "*.alolabs.net",
    });
    expect(validatePlatformIdentifier("apple-ios", "net.alolabs.portal", "production")).toEqual({
      ok: true,
      normalized: "net.alolabs.portal",
    });
    expect(validatePlatformIdentifier("android", "singleword", "production").ok).toBe(false);
  });

  it("enforces strict HTTPS + SSRF blocking on webhook URLs", () => {
    expect(validateWebhookTargetUrl("https://hooks.alolabs.net/events")).toEqual({
      ok: true,
      normalized: "https://hooks.alolabs.net/events",
    });
    for (const unsafe of [
      "http://hooks.alolabs.net/events",
      "https://user:pass@hooks.alolabs.net/events",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.8/hook",
      "https://172.20.1.4/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://100.64.0.10/hook",
      "https://[::1]/hook",
      "https://redis.internal/hook",
      "https://printer.local/hook",
    ]) {
      expect(validateWebhookTargetUrl(unsafe).ok, `expected ${unsafe} to be rejected`).toBe(false);
    }
  });

  it("validates function entrypoints and 5-field cron schedules", () => {
    expect(validateFunctionEntrypoint("src/main.ts")).toBe(true);
    expect(validateFunctionEntrypoint("../etc/passwd")).toBe(false);
    expect(validateFunctionEntrypoint("/etc/shadow")).toBe(false);
    expect(validateCronSchedule("0 */6 * * *")).toBe(true);
    expect(validateCronSchedule("every five minutes")).toBe(false);
  });

  it("authenticates CSPRNG API keys in constant time and signs/verifies HMAC webhooks", () => {
    const issued = generateCloudApiKey();
    expect(issued.secret.startsWith("alok_live_")).toBe(true);
    expect(issued.keyHash).toMatch(/^[0-9a-f]{64}$/);

    const baseCandidate = {
      id: "key-1",
      projectId: "proj-1",
      projectSlug: "demo-cloud",
      projectStatus: "ACTIVE",
      keyHash: issued.keyHash,
      prefix: issued.prefix,
      scopes: JSON.stringify(["project.read", "health.read"]),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    };

    const okAuth = authenticateCloudProjectKey({
      projectRef: "demo-cloud",
      rawKey: issued.secret,
      candidate: baseCandidate,
      anyOfScopes: ["health.read"],
    });
    expect(okAuth).toEqual({
      ok: true,
      keyId: "key-1",
      projectId: "proj-1",
      projectSlug: "demo-cloud",
      grantedScopes: ["project.read", "health.read"],
    });

    const badScope = authenticateCloudProjectKey({
      projectRef: "demo-cloud",
      rawKey: issued.secret,
      candidate: { ...baseCandidate, scopes: JSON.stringify(["sites.read"]) },
      anyOfScopes: ["health.read"],
    });
    expect(badScope.ok).toBe(false);
    if (!badScope.ok) expect(badScope.code).toBe("INSUFFICIENT_SCOPE");

    const wh = generateWebhookSigningSecret();
    const body = JSON.stringify({ event: "sites.deployments.ready", project: "demo" });
    const ts = Math.floor(Date.now() / 1000);
    const sigHeader = signCloudWebhookPayload(wh.signingSecret, ts, body);
    expect(
      verifyCloudWebhookSignature({
        signingSecret: wh.signingSecret,
        signatureHeader: sigHeader,
        rawBody: body,
        nowSeconds: ts,
      }),
    ).toBe(true);
    expect(
      verifyCloudWebhookSignature({
        signingSecret: wh.signingSecret,
        signatureHeader: sigHeader,
        rawBody: body,
        nowSeconds: ts + 9999,
      }),
    ).toBe(false);

    const redacted = redactCloudSecrets(`token=${issued.secret} and wh=${wh.signingSecret}`);
    expect(redacted).not.toContain(issued.secret);
    expect(redacted).not.toContain(wh.signingSecret);
  });

  it("computes deterministic posture findings and secret-free onboarding snippets", () => {
    const findings = evaluateCloudProjectPosture({
      stage: "production",
      linkedWebsite: null,
      linkedDatabase: null,
      linkedBucket: null,
      platforms: [],
      keys: [
        {
          scopes: CLOUD_PROJECT_SCOPES.slice(0, 13).map((s) => s.id),
          expiresAt: null,
          revokedAt: null,
        },
      ],
      webhooks: [{ tlsVerify: false, enabled: true }],
      functions: [{ enabled: true, executionState: "REQUIRES_SETUP" }],
    });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("NO_CLIENT_PLATFORMS");
    expect(codes).toContain("KEY_NO_EXPIRATION");
    expect(codes).toContain("KEY_OVERBROAD_SCOPES");
    expect(codes).toContain("WEBHOOK_TLS_DISABLED");
    expect(codes).toContain("FUNCTIONS_EXECUTOR_REQUIRES_SETUP");

    const onboarding = buildProjectOnboardingConfig({
      origin: "https://panel.alolabs.net",
      projectId: "proj-123",
      projectSlug: "student-cloud",
      frameworkPreset: "nextjs",
    });
    expect(onboarding.envSnippet).not.toContain("alok_live_");
    expect(onboarding.healthEndpoint).toBe("https://panel.alolabs.net/api/cloud/v1/health");
  });
});

// ─── 3. Unmigrated Fail-Closed Behaviour + Additive Migration Applier ───────

describe("Additive migration 20261102120000_cloud_baas_projects & end-to-end BaaS routes", () => {
  let adminUser: { id: string; email: string; role: string };
  let clientA: { id: string; email: string; role: string };
  let clientB: { id: string; email: string; role: string };
  let orgOwnedByAId = "";

  beforeAll(async () => {
    // The tracked fixture now includes the cloud tables (schema drift was
    // resolved on 2026-11-09). This suite must still prove the graceful
    // pre-migration 503 path, so recreate that state in this file's throwaway
    // copy before exercising the additive migration end-to-end. Foreign keys
    // are disabled on this separate connection: dropping child tables while the
    // parent still exists would otherwise leave dangling FK actions in SQLite.
    const scratch = createClient({ url: isolatedDbUrl });
    await scratch.execute("PRAGMA foreign_keys = OFF");
    for (const table of [
      "cloud_project_functions",
      "cloud_project_keys",
      "cloud_project_members",
      "cloud_project_platforms",
      "cloud_project_quotas",
      "cloud_project_webhooks",
      "cloud_projects",
    ]) {
      await scratch.execute(`DROP TABLE IF EXISTS "${table}"`);
    }
    scratch.close();

    const adminRow = await db.user.findUnique({
      where: { email: "admin@alolabs.net" },
      select: { id: true, email: true, role: { select: { name: true } } },
    });
    const clientARow = await db.user.findUnique({
      where: { email: "client@alolabs.net" },
      select: { id: true, email: true, roleId: true, role: { select: { name: true } } },
    });
    if (!adminRow || !clientARow) throw new Error("Seeded users missing from isolated DB");

    const clientBRow = await db.user.create({
      data: {
        email: `cloud-client-b-${Date.now()}@alolabs.net`,
        name: "Client B",
        isActive: true,
        roleId: clientARow.roleId,
      },
      select: { id: true, email: true, role: { select: { name: true } } },
    });

    adminUser = { id: adminRow.id, email: adminRow.email, role: adminRow.role.name };
    clientA = { id: clientARow.id, email: clientARow.email, role: clientARow.role.name };
    clientB = { id: clientBRow.id, email: clientBRow.email, role: clientBRow.role.name };
  });

  it("migration SQL contains exclusively additive CREATE TABLE/INDEX IF NOT EXISTS statements", () => {
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    expect(sql).not.toMatch(/^\s*(DROP|ALTER|DELETE\s+FROM|TRUNCATE|UPDATE\s+\w)/im);
    for (const line of sql.split("\n")) {
      if (line.trimStart().startsWith("--")) {
        expect(line).not.toContain(";");
      }
    }
  });

  it("returns 503 CLOUD_SCHEMA_REQUIRES_SETUP and safe workflow REQUIRES_SETUP before migration runs", async () => {
    const req = await authedRequest("http://localhost/api/cloud/projects", clientA);
    const res = await listProjectsGET(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error?.code).toBe("CLOUD_SCHEMA_REQUIRES_SETUP");

    const tools = createScopedHostingTools({ userId: clientA.id, isAdmin: false });
    const toolResult = (await tools.cloudProjects({}, {
      input: {},
      actor: { userId: clientA.id, isAdmin: false },
    })) as { setupState: string; count: number };
    expect(toolResult.setupState).toBe("REQUIRES_SETUP");
    expect(toolResult.count).toBe(0);
  });

  it("applies additive schema cleanly, idempotently, and passes --verify on isolated DB", () => {
    const env = { ...process.env, DATABASE_URL: isolatedDbUrl };
    execFileSync(process.execPath, [APPLIER_FILE], { env, stdio: "pipe" });
    // Second run proves idempotency
    execFileSync(process.execPath, [APPLIER_FILE], { env, stdio: "pipe" });
    const verifyOut = execFileSync(process.execPath, [APPLIER_FILE, "--verify"], {
      env,
      encoding: "utf8",
    });
    const parsedVerify = JSON.parse(verifyOut) as { ok: boolean; migrations: string[]; problems: unknown[] };
    expect(parsedVerify.ok).toBe(true);
    expect(parsedVerify.problems).toEqual([]);
    expect(parsedVerify.migrations).toContain(MIGRATION_NAME);
  });

  it("rejects unauthenticated requests across Cloud Projects endpoints", async () => {
    const unauth = new NextRequest("http://localhost/api/cloud/projects");
    const res = await listProjectsGET(unauth);
    expect(res.status).toBe(401);
  });

  it("supports full project lifecycle, tenant isolation, org member read-only RBAC, atomic audit rollback, and live API key verification", async () => {
    const org = await db.organization.create({
      data: {
        name: "ALO Cloud Org",
        slug: `alo-cloud-org-${Date.now()}`,
        ownerId: clientA.id,
        memberships: {
          create: [{ userId: clientB.id, role: "MEMBER" }],
        },
      },
    });
    orgOwnedByAId = org.id;

    // Foreign website owned by clientB (clientA must NOT be allowed to link it)
    const foreignSite = await db.website.create({
      data: {
        domain: `foreign-${Date.now()}.example.com`,
        ownerId: clientB.id,
        runtime: "NEXTJS",
        status: "ACTIVE",
      },
    });

    // Own website owned by clientA
    const ownSite = await db.website.create({
      data: {
        domain: `own-${Date.now()}.example.com`,
        ownerId: clientA.id,
        runtime: "NEXTJS",
        status: "ACTIVE",
      },
    });

    // 1. Cross-tenant resource link attempt fails closed with 403
    const crossTenantCreateReq = await authedRequest("http://localhost/api/cloud/projects", clientA, {
      method: "POST",
      body: JSON.stringify({
        name: "Illegal Link Project",
        slug: "illegal-link",
        linkedWebsiteId: foreignSite.id,
      }),
    });
    const crossTenantRes = await createProjectPOST(crossTenantCreateReq);
    expect(crossTenantRes.status).toBe(403);

    // 2. Client A creates a valid personal project + an org project
    const createPersonalReq = await authedRequest("http://localhost/api/cloud/projects", clientA, {
      method: "POST",
      body: JSON.stringify({
        name: "Student Cloud",
        slug: "student-cloud",
        frameworkPreset: "nextjs",
        renderingMode: "ssr",
        stage: "development",
        linkedWebsiteId: ownSite.id,
      }),
    });
    const createPersonalRes = await createProjectPOST(createPersonalReq);
    expect(createPersonalRes.status).toBe(201);
    const personalProject = (await createPersonalRes.json()).data as { id: string; slug: string };
    expect(personalProject.slug).toBe("student-cloud");

    const createOrgReq = await authedRequest("http://localhost/api/cloud/projects", clientA, {
      method: "POST",
      body: JSON.stringify({
        name: "Shared Org Cloud",
        slug: "shared-org-cloud",
        organizationId: orgOwnedByAId,
        frameworkPreset: "astro",
        renderingMode: "static",
      }),
    });
    const createOrgRes = await createProjectPOST(createOrgReq);
    expect(createOrgRes.status).toBe(201);
    const orgProject = (await createOrgRes.json()).data as { id: string };

    // 3. Client B (foreign tenant) gets 403 on Client A's personal project
    const foreignGetRes = await getProjectGET(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}`, clientB),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(foreignGetRes.status).toBe(403);

    // 4. Client B (MEMBER of org) CAN view org project (`canManage: false`) but CANNOT issue keys (`403`)
    const memberGetRes = await getProjectGET(
      await authedRequest(`http://localhost/api/cloud/projects/${orgProject.id}`, clientB),
      { params: Promise.resolve({ id: orgProject.id }) },
    );
    expect(memberGetRes.status).toBe(200);
    const memberDetail = (await memberGetRes.json()).data;
    expect(memberDetail.canManage).toBe(false);

    const memberIssueKeyRes = await issueKeyPOST(
      await authedRequest(`http://localhost/api/cloud/projects/${orgProject.id}/keys`, clientB, {
        method: "POST",
        body: JSON.stringify({ name: "unauthorized-key", scopes: ["project.read"], expiresInDays: 30 }),
      }),
      { params: Promise.resolve({ id: orgProject.id }) },
    );
    expect(memberIssueKeyRes.status).toBe(403);

    // 5. Issue two keys on personalProject: one limited (`sites.read`) and one health-capable (`health.read`)
    const limitedKeyRes = await issueKeyPOST(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}/keys`, clientA, {
        method: "POST",
        body: JSON.stringify({ name: "sites-only", scopes: ["sites.read"], expiresInDays: 30 }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(limitedKeyRes.status).toBe(201);
    const limitedIssued = (await limitedKeyRes.json()).data as { secret: string; key: { id: string } };

    const healthKeyRes = await issueKeyPOST(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}/keys`, clientA, {
        method: "POST",
        body: JSON.stringify({ name: "agent-health", scopes: ["health.read"], expiresInDays: 30 }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(healthKeyRes.status).toBe(201);
    const healthIssued = (await healthKeyRes.json()).data as { secret: string; key: { id: string } };
    expect(healthIssued.secret.startsWith("alok_live_")).toBe(true);

    // Subsequent GET must NEVER include plaintext secret or keyHash
    const afterKeyGetRes = await getProjectGET(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}`, clientA),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    const rawDetailJson = JSON.stringify(await afterKeyGetRes.json());
    expect(rawDetailJson).not.toContain(healthIssued.secret);
    expect(rawDetailJson).not.toContain("keyHash");

    // 6. Verify machine `/api/cloud/v1/health` auth matrix
    expect((await healthGET(new NextRequest("http://localhost/api/cloud/v1/health"))).status).toBe(401);

    const badScopeHealth = await healthGET(
      new NextRequest("http://localhost/api/cloud/v1/health", {
        headers: { "x-alo-project": "student-cloud", "x-alo-key": limitedIssued.secret },
      }),
    );
    expect(badScopeHealth.status).toBe(403);

    const wrongProjHealth = await healthGET(
      new NextRequest("http://localhost/api/cloud/v1/health", {
        headers: { "x-alo-project": "shared-org-cloud", "x-alo-key": healthIssued.secret },
      }),
    );
    expect(wrongProjHealth.status).toBe(403);

    const validHealthRes = await healthGET(
      new NextRequest("http://localhost/api/cloud/v1/health", {
        headers: { "x-alo-project": "student-cloud", "x-alo-key": healthIssued.secret },
      }),
    );
    expect(validHealthRes.status).toBe(200);
    const validHealthBody = await validHealthRes.json();
    expect(validHealthBody.data.project.slug).toBe("student-cloud");
    expect(validHealthBody.data.services.functions.executionState).toBe("REQUIRES_SETUP");

    const revokeRes = await revokeKeyDELETE(
      await authedRequest(
        `http://localhost/api/cloud/projects/${personalProject.id}/keys/${healthIssued.key.id}`,
        clientA,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: personalProject.id, keyId: healthIssued.key.id }) },
    );
    expect(revokeRes.status).toBe(200);

    const revokedHealthRes = await healthGET(
      new NextRequest("http://localhost/api/cloud/v1/health", {
        headers: { "x-alo-project": "student-cloud", "x-alo-key": healthIssued.secret },
      }),
    );
    expect(revokedHealthRes.status).toBe(401);

    // 7. Register localhost platform in development, verify promotion to production is blocked until removed
    const platRes = await registerPlatformPOST(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}/platforms`, clientA, {
        method: "POST",
        body: JSON.stringify({ name: "Local Dev", type: "nextjs", identifier: "localhost" }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(platRes.status).toBe(201);
    const createdPlat = (await platRes.json()).data as { id: string };

    const blockedProdPatch = await updateProjectPATCH(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}`, clientA, {
        method: "PATCH",
        body: JSON.stringify({ stage: "production" }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(blockedProdPatch.status).toBe(422);

    await removePlatformDELETE(
      await authedRequest(
        `http://localhost/api/cloud/projects/${personalProject.id}/platforms/${createdPlat.id}`,
        clientA,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: personalProject.id, platformId: createdPlat.id }) },
    );

    const okProdPatch = await updateProjectPATCH(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}`, clientA, {
        method: "PATCH",
        body: JSON.stringify({ stage: "production" }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(okProdPatch.status).toBe(200);

    // 8. Webhooks: block SSRF URL (422), allow valid HTTPS URL (201), then remove
    const ssrfWebhookRes = await createWebhookPOST(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}/webhooks`, clientA, {
        method: "POST",
        body: JSON.stringify({
          name: "Metadata SSRF",
          url: "https://169.254.169.254/latest/meta-data",
          events: ["sites.deployments.ready"],
        }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect([400, 422]).toContain(ssrfWebhookRes.status);

    const okWebhookRes = await createWebhookPOST(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}/webhooks`, clientA, {
        method: "POST",
        body: JSON.stringify({
          name: "Deploy Hook",
          url: "https://hooks.alolabs.net/cloud-events",
          events: ["sites.deployments.ready"],
          tlsVerify: true,
        }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(okWebhookRes.status).toBe(201);
    const createdWh = (await okWebhookRes.json()).data as { signingSecret: string; webhook: { id: string } };
    expect(createdWh.signingSecret.startsWith("alowh_")).toBe(true);

    await removeWebhookDELETE(
      await authedRequest(
        `http://localhost/api/cloud/projects/${personalProject.id}/webhooks/${createdWh.webhook.id}`,
        clientA,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: personalProject.id, webhookId: createdWh.webhook.id }) },
    );

    // 9. Functions: persist spec honestly with `executionState: REQUIRES_SETUP` and `executable: false`
    const fnRes = await createFunctionPOST(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}/functions`, clientA, {
        method: "POST",
        body: JSON.stringify({
          name: "Sync Student Profile",
          runtime: "node-22",
          entrypoint: "src/index.ts",
          schedule: "0 * * * *",
          events: ["users.sessions.created"],
          timeoutSeconds: 30,
        }),
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(fnRes.status).toBe(201);
    const createdFn = (await fnRes.json()).data as { id: string; executionState: string; executable: boolean };
    expect(createdFn.executionState).toBe("REQUIRES_SETUP");
    expect(createdFn.executable).toBe(false);

    await removeFunctionDELETE(
      await authedRequest(
        `http://localhost/api/cloud/projects/${personalProject.id}/functions/${createdFn.id}`,
        clientA,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: personalProject.id, functionId: createdFn.id }) },
    );

    // 10. AI Workflow `hosting.cloudProjects` node is tenant-isolated and secret-free
    const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === "cloud-baas-posture-advisor");
    expect(tpl).toBeDefined();
    const wfResult = await runWorkflowGraph(
      tpl!.graph,
      {
        tools: createScopedHostingTools({ userId: clientA.id, isAdmin: false }),
        ai: async (messages) => {
          const joined = messages.map((m) => m.content).join("\n");
          expect(joined).toContain("student-cloud");
          expect(joined).not.toContain("alok_live_");
          return { text: "Posture verified.", model: "deterministic-test", provider: "test", tokensUsed: 12 };
        },
      },
      { actor: { userId: clientA.id, isAdmin: false } },
    );
    expect(wfResult.status).toBe("succeeded");

    // 11. Atomic audit rollback: if auditLog.create throws inside $transaction, project creation rolls back
    const origTransaction = db.$transaction.bind(db);
    const txSpy = ((fn: unknown) =>
      origTransaction(async (tx) => {
        const brokenTx = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === "auditLog") {
              return {
                create: async () => {
                  throw new Error("Simulated audit sink failure");
                },
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        return (fn as (t: typeof tx) => Promise<unknown>)(brokenTx);
      })) as typeof db.$transaction;

    db.$transaction = txSpy;
    try {
      const rollbackRes = await createProjectPOST(
        await authedRequest("http://localhost/api/cloud/projects", adminUser, {
          method: "POST",
          body: JSON.stringify({ name: "Must Rollback", slug: "must-rollback" }),
        }),
      );
      expect(rollbackRes.status).toBe(500);
    } finally {
      db.$transaction = origTransaction;
    }
    const rolledBack = await db.cloudProject.findUnique({ where: { slug: "must-rollback" } });
    expect(rolledBack).toBeNull();

    // 12. Delete personal project cleanly & verify audit logs persisted
    const delRes = await deleteProjectDELETE(
      await authedRequest(`http://localhost/api/cloud/projects/${personalProject.id}`, clientA, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: personalProject.id }) },
    );
    expect(delRes.status).toBe(200);

    const auditCount = await db.auditLog.count({ where: { domain: "cloud-baas" } });
    expect(auditCount).toBeGreaterThanOrEqual(6);
  });
});

// ─── 4. Middleware, Navigation & App Center Wiring ──────────────────────────

describe("Middleware, App Center, and dashboard wiring for /cloud", () => {
  it("guards /cloud as a protected dashboard route and allows machine /api/cloud/v1/health through HMAC path", async () => {
    expect(isProtectedDashboardPath("/cloud")).toBe(true);
    expect(isProtectedDashboardPath("/cloud/anything")).toBe(true);
    expect(middlewareConfig.matcher).toContain("/cloud/:path*");

    // Unauthenticated browser navigation to /cloud redirects to /login
    const uiRes = await middleware(new NextRequest("http://localhost/cloud"));
    expect(uiRes.status).toBe(307);
    expect(uiRes.headers.get("location")).toContain("/login");

    // Machine API path `/api/cloud/v1/health` bypasses session cookie middleware so route handler checks `x-alo-key`
    const machineRes = await middleware(new NextRequest("http://localhost/api/cloud/v1/health"));
    expect(machineRes.status).toBe(200);
  });

  it("registers cloud-baas in App Center BUILTIN_APPS with /cloud route", async () => {
    const appDef = BUILTIN_APPS.find((a) => a.slug === "cloud-baas");
    expect(appDef).toBeDefined();
    expect(appDef?.route).toBe("/cloud");
    await ensureBuiltinApps(db);
    const persisted = await db.appDefinition.findUnique({ where: { slug: "cloud-baas" } });
    expect(persisted?.route).toBe("/cloud");
  });

  it("keeps Cloud UI and browser catalog free of fabricated data, Math.random, and server-only imports", () => {
    const catalogSrc = fs.readFileSync(path.resolve("src/lib/cloud/catalog.ts"), "utf8");
    const uiSrc = fs.readFileSync(path.resolve("src/components/cloud/CloudProjectsConsole.tsx"), "utf8");
    const pageSrc = fs.readFileSync(path.resolve("src/app/(dashboard)/cloud/page.tsx"), "utf8");

    expect(catalogSrc).not.toMatch(/from\s+["']node:|@prisma\/client/);
    expect(uiSrc).not.toMatch(/from\s+["']node:|@prisma\/client|cloud-service|crypto-auth/);
    for (const src of [catalogSrc, uiSrc, pageSrc]) {
      expect(src).not.toContain("Math.random");
      expect(src).not.toMatch(/\b(mock|fake|dummy)\b/i);
    }
  });
});
