/**
 * Invariants of the 2026-11-09 unification.
 *
 * These are behavioural/existence assertions on the real checkout, not copies
 * of prose. They fail loudly if a second application tree, a second config
 * family, a broken cross-reference, a published credential or a missing
 * deployment artifact ever returns.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("one canonical project", () => {
  it("has exactly one package manifest, one Prisma schema and one app tree", () => {
    expect(exists("package.json")).toBe(true);
    expect(exists("package-lock.json")).toBe(true);
    expect(exists("src/app/layout.tsx")).toBe(true);
    expect(exists("prisma/schema.prisma")).toBe(true);
    expect(exists("prisma/migrations/migration_lock.toml")).toBe(true);
    const manifests: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (["node_modules", ".git", ".next", "archive"].includes(e.name)) continue;
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (e.name === "package.json" && rel !== "package.json" && rel !== "deploy/server-kit/demo-app/package.json") manifests.push(rel);
      }
    };
    walk(".");
    expect(manifests).toEqual([]);
  });

  it("removed every retired duplicate tree, config pair and legacy entrypoint", () => {
    const retired = [
      "alo-hosting-portal", "alo-server-kit", "server-helpers", "server-config",
      "install-scripts", "Dockerfile.node20", "docker-compose.node20.yml",
      "docs/SERVER-SPEC.md", "src/middleware.ts", "vitest.config.ts",
      "helpers/sudoers-alo", "scripts/generate-dev-guide.js",
      "scripts/package-production.sh", "scripts/deploy-alo-portal.sh",
    ];
    for (const p of retired) expect(exists(p), `${p} must not exist`).toBe(false);
  });

  it("uses the current Next.js proxy convention and keeps all importers in sync", () => {
    expect(exists("src/proxy.ts")).toBe(true);
    const proxy = read("src/proxy.ts");
    expect(proxy).toContain("export async function proxy(");
    for (const dir of ["src", "tests"]) {
      const walk = (d: string) => {
        for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
          const rel = path.join(d, e.name);
          if (e.isDirectory()) walk(rel);
          else if (/\.(ts|tsx|mjs)$/.test(e.name) && rel !== "tests/unified-project.test.ts") {
            const t = read(rel);
            expect(t, `${rel} still imports the retired middleware module`).not.toMatch(/@\/middleware|src\/middleware\.ts|\.\.\/src\/middleware/);
          }
        }
      };
      walk(dir);
    }
  });

  it("keeps the merged Ubuntu toolkit wired to its shared library", () => {
    expect(exists("deploy/ubuntu-setup.sh")).toBe(true);
    expect(exists("deploy/server-kit/setup.sh")).toBe(true);
    expect(exists("deploy/server-kit/lib/common.sh")).toBe(true);
    expect(exists("deploy/server-kit/scripts/configure-email.sh")).toBe(true);
    for (const f of ["backup.sh", "restore.sh"]) {
      const src = read(`deploy/server-kit/${f}`);
      expect(src).toContain('source "$(dirname "$0")/lib/common.sh"');
    }
    const setup = read("deploy/ubuntu-setup.sh");
    expect(setup).toContain("deploy/server-kit/setup.sh");
    expect(setup).toContain("scripts/bootstrap-server.sh");
    expect(setup).toContain("helpers/install-helpers.sh");
    expect(setup).toContain("scripts/server-doctor.sh");
  });

  it("points every installer/config reference at a file that exists", () => {
    const pairs: Array<[string, RegExp]> = [
      ["helpers/install-helpers.sh", /SUDOERS_SRC="\$\{HELPER_SRC_DIR\}\/\.\.\/(deploy\/sudoers\/alo-hosting-portal)"/],
      ["Dockerfile", /COPY --from=builder --chown=root:root \/app\/(deploy) \.\/deploy/],
      ["docker-compose.yml", /dockerfile: (Dockerfile)/],
      ["deploy/README-hosting-engine.md", /(Dockerfile)/],
    ];
    for (const [file, re] of pairs) {
      const m = read(file).match(re);
      expect(m, `${file} must declare its canonical dependency`).toBeTruthy();
      expect(exists(m![1]), `${file} -> ${m![1]} must exist`).toBe(true);
    }
    expect(exists("deploy/sudoers/alo-hosting-portal")).toBe(true);
    expect(exists("deploy/sudoers/alo-hosting-deploy")).toBe(true);
    expect(exists("deploy/systemd/alo-hosting-panel.service")).toBe(true);
    expect(exists("deploy/nginx/hosting.alolabs.net.conf")).toBe(true);
    expect(exists("deploy/cloudflared/config.yml")).toBe(true);
    expect(exists("deploy/env/alo-hosting-panel.env.example")).toBe(true);
  });

  it("keeps the CI shell gate and its test pointed at the merged directories", () => {
    const ci = read(".github/workflows/ci-cd.yml");
    const t = read("tests/deploy-pipeline.test.ts");
    expect(ci).toContain("find scripts helpers deploy agent -type f -print0");
    expect(t).toContain("find scripts helpers deploy agent -type f -print0");
    expect(ci).not.toContain("server-helpers");
    expect(t).not.toContain("server-helpers");
  });

  it("documents every environment variable once, with no duplicate keys", () => {
    const keys = [...read(".env.example").matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of ["CRON_SECRET", "CSRF_SECRET", "DEPLOY_WEBHOOK_SECRET", "CLOUD_DATA_DIR", "ADMIN_CREDENTIAL_FILE", "SEED_ADMIN_PASSWORD", "AUDIT_FALLBACK_FILE", "AUTOMATION_SERVICE_MANAGER", "AUTOMATION_SERVICE_NAME"]) {
      expect(keys).toContain(key);
    }
  });

  it("ships no published seed credentials and no demo login shortcuts", () => {
    const seed = read("prisma/seed.ts");
    const login = read("src/app/(auth)/login/page.tsx");
    // Deliberately assembled rather than written as literal strings, so this
    // assertion file does not itself reintroduce a published credential.
    const published = ["admin", "reseller", "client"].map((role) => `${role}123`);
    for (const p of published) {
      expect(seed).not.toContain(p);
      expect(login).not.toContain(p);
    }
    expect(seed).toContain("randomBytes");
    expect(login).not.toContain("fillDemoAccount");
  });

  it("declares the packages the test suite imports", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies["js-yaml"]).toBeTruthy();
    expect(pkg.overrides["@typescript-eslint/typescript-estree"].minimatch).toBeTruthy();
    expect(read("package-lock.json")).toContain('"js-yaml"');
  });

  it("keeps both audit reports, the repeatable audit command and the no-loss archive", () => {
    expect(exists("AUDIT-REPORT.md")).toBe(true);
    expect(exists("AUDIT-REPORT-FINAL.md")).toBe(true);
    expect(exists("scripts/repo-audit.mjs")).toBe(true);
    expect(JSON.parse(read("package.json")).scripts["audit:repo"]).toContain("repo-audit.mjs");
    expect(exists("archive/retired-2026-11-09/MANIFEST.md")).toBe(true);
    expect(exists("archive/retired-2026-11-09/SEMANTIC-DIFF.md")).toBe(true);
    const manifest = JSON.parse(read("archive/retired-2026-11-09/manifest.json"));
    expect(Object.keys(manifest).length).toBe(431);
    for (const [retired, meta] of Object.entries(manifest)) {
      expect(exists(`archive/retired-2026-11-09/${retired}`), `${retired} must be archived`).toBe(true);
      expect((meta as { canonical: string }).canonical.length).toBeGreaterThan(0);
    }
    const semantic = JSON.parse(read("archive/retired-2026-11-09/semantic-diff.json"));
    expect(semantic.summary.retired_paths).toBe(431);
    expect(semantic.summary.archive_preserved).toBe(431);
    expect(semantic.summary.semantic_review_complete).toBe(true);
    expect(semantic.summary.missing_api_route_paths).toBe(0);
    expect(semantic.summary.missing_api_route_methods).toBe(0);
    expect(semantic.summary.missing_page_routes).toBe(0);
    expect(semantic.summary.missing_component_paths).toBe(0);
    expect(semantic.summary.missing_library_paths).toBe(0);
    expect(semantic.entries).toHaveLength(431);
    for (const entry of semantic.entries) {
      expect(entry.archive_preserved).toBe(true);
      expect(entry.classification).toBeTruthy();
      expect(entry.resolution).toBeTruthy();
      expect(entry.reviewed).toBe(true);
    }
  });
});
