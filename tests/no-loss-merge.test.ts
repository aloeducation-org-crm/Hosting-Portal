/**
 * Proof that the 2026-11-09 "no functionality removed" merge really carried
 * forward the unique behaviour from the retired nested application.
 */
import { isolatedDbUrl, isolatedDbPath, teardownIsolatedDb } from "./helpers/isolated-db";
import { applyCurrentSchema } from "./helpers/apply-schema";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createClient } from "@libsql/client";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

afterAll(async () => {
  await teardownIsolatedDb();
});

// The legacy cron trigger now delegates to the automation engine tick, which
// reads the automation tables this release adds — so the scratch copy must be
// brought up to the current schema, exactly like an upgraded host would be.
beforeAll(() => {
  applyCurrentSchema(isolatedDbPath);
}, 180_000);

describe("legacy automation APIs are present in the canonical tree", () => {
  it("re-adds the bearer-authenticated cron trigger", async () => {
    const source = read("src/app/api/automation/cron/route.ts");
    expect(source).toContain("process.env.CRON_SECRET");
    expect(source).toContain("verifyInternalSecretValue");
    const { GET } = await import("@/app/api/automation/cron/route");
    expect(typeof GET).toBe("function");

    process.env.CRON_SECRET = "a".repeat(64);
    const { NextRequest } = await import("next/server");
    const denied = await GET(new NextRequest("http://localhost/api/automation/cron"));
    expect(denied.status).toBe(401);
    const allowed = await GET(
      new NextRequest("http://localhost/api/automation/cron", {
        headers: { authorization: `Bearer ${"a".repeat(64)}` },
      }),
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).success).toBe(true);
  });

  it("re-adds the allowlisted internal tool route with the canonical service name", async () => {
    const source = read("src/app/api/automation/tool/route.ts");
    expect(source).toContain("alo-hosting-panel");
    expect(source).toContain("requiresApproval");
    expect(source).not.toContain("exec(");
    const { POST } = await import("@/app/api/automation/tool/route");
    expect(typeof POST).toBe("function");

    process.env.INTERNAL_SECRET = "b".repeat(64);
    const { NextRequest } = await import("next/server");
    const denied = await POST(new NextRequest("http://localhost/api/automation/tool", { method: "POST" }));
    expect(denied.status).toBe(401);
    const badAction = await POST(
      new NextRequest("http://localhost/api/automation/tool", {
        method: "POST",
        headers: { authorization: `Bearer ${"b".repeat(64)}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "rm -rf /" }),
      }),
    );
    expect(badAction.status).toBe(403);
    const needsApproval = await POST(
      new NextRequest("http://localhost/api/automation/tool", {
        method: "POST",
        headers: { authorization: `Bearer ${"b".repeat(64)}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "restart-app" }),
      }),
    );
    expect(needsApproval.status).toBe(409);
  });

  it("re-adds the retired deploy-webhook health probe and GitHub-mode dispatch", async () => {
    const route = read("src/app/api/deploy/webhook/route.ts");
    expect(route).toContain("export async function GET");
    expect(route).toContain("handleGitHubWebhook");
    expect(route).toContain("x-github-event");
    const webhook = read("src/lib/deploy/webhook.ts");
    expect(webhook).toContain("workflow_dispatch");
    expect(webhook).toContain("CRON_SECRET");
    const { GET } = await import("@/app/api/deploy/webhook/route");
    expect(typeof GET).toBe("function");
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).message).toBe("deploy webhook alive");
  });
});

describe("legacy library paths resolve to canonical supersets", () => {
  it("exposes the automation audit compatibility API and a file fallback", async () => {
    const fallback = path.join(os.tmpdir(), `alo-audit-${process.pid}.log`);
    process.env.AUDIT_FALLBACK_FILE = fallback;
    const canonical = await import("@/lib/audit");
    const compat = await import("@/lib/automation/audit");
    expect(typeof canonical.logAutomationEvent).toBe("function");
    expect(typeof compat.logAutomationEvent).toBe("function");
    await compat.logAutomationEvent("merge.no-loss.check", null, { source: "test" }, "SUCCESS");
    expect(fs.existsSync(fallback)).toBe(true);
    expect(read(path.relative(ROOT, fallback))).toContain("merge.no-loss.check");
    const { db } = await import("@/lib/db");
    const row = await db.auditLog.findFirst({ where: { action: "merge.no-loss.check" } });
    expect(row).toBeTruthy();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-audit-tempdir-"));
    delete process.env.AUDIT_FALLBACK_FILE;
    process.env.TEMP_DIR = tempDir;
    await compat.logAutomationEvent("merge.no-loss.tempdir.check", null, { source: "test" }, "SUCCESS");
    expect(fs.existsSync(path.join(tempDir, "automation-audit.log"))).toBe(true);
    delete process.env.TEMP_DIR;
    fs.rmSync(fallback, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("exposes detector and orchestrator compatibility modules", async () => {
    const detector = await import("@/lib/deploy/detector");
    expect(typeof detector.detectFramework).toBe("function");
    expect(typeof detector.detectFrameworkAsync).toBe("function");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "alo-detector-compat-"));
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0" }, scripts: { build: "next build", start: "next start" } }),
    );
    fs.writeFileSync(path.join(repo, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(repo, ".env.example"), "PORT=3000\nDATABASE_URL=file:/tmp/example.db\n");
    const result = detector.detectFramework(repo);
    expect(result.framework).toBe("NEXTJS");
    expect(result.language).toBe("typescript");
    expect(result.outputDir).toBe(".next");
    expect(result.detectedEnvVars).toEqual(["PORT", "DATABASE_URL"]);
    expect(read("src/lib/deploy/detector.ts")).toContain("FrameworkDetectionResult");
    expect(read("src/proxy.ts")).toContain("export { proxy as middleware }");
    fs.rmSync(repo, { recursive: true, force: true });

    const orchestrator = await import("@/lib/deploy/orchestrator");
    expect(typeof orchestrator.executeDeployment).toBe("function");
    expect(typeof orchestrator.runDeployment).toBe("function");
    expect(exists("src/lib/deploy/detect.ts")).toBe(true);
    expect(exists("src/lib/deploy/engine.ts")).toBe(true);
  });
});

describe("everything retired is preserved and safe", () => {
  it("keeps all 431 retired paths and maps each to a canonical replacement", () => {
    const manifest = JSON.parse(read("archive/retired-2026-11-09/manifest.json")) as Record<
      string,
      { archived_at: string; canonical: string }
    >;
    expect(Object.keys(manifest).length).toBe(431);
    for (const [retired, meta] of Object.entries(manifest)) {
      expect(exists(meta.archived_at), `${retired} missing from archive`).toBe(true);
      expect(meta.canonical.length).toBeGreaterThan(0);
    }
    expect(exists("scripts/legacy/compat.sh")).toBe(true);
    expect(read("scripts/legacy/compat.sh")).toContain("deploy/ubuntu-setup.sh");
  });

  it("rotates the archived legacy database so no published default verifies", async () => {
    const url = `file:${path.join(ROOT, "archive/retired-2026-11-09/alo-hosting-portal/db/custom.db")}`;
    const client = createClient({ url });
    const rows = await client.execute("SELECT passwordHash FROM users");
    client.close();
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      const hash = String(row.passwordHash);
      for (const pw of ["admin" + "123", "reseller" + "123", "client" + "123"]) {
        expect(bcrypt.compareSync(pw, hash)).toBe(false);
      }
    }
  });

  it("uses the isolated database for this suite", () => {
    expect(isolatedDbUrl.startsWith("file:")).toBe(true);
    expect(isolatedDbUrl).toContain("alo-test-db-");
  });
});
