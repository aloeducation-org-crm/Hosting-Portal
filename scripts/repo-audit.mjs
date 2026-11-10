#!/usr/bin/env node
/**
 * Repeatable repository audit for the unified ALO Hosting Portal.
 *
 * `npm run audit:repo` re-checks the invariants that the 2026-11-09 merge had
 * to establish: one project tree, resolvable imports, declared dependencies,
 * documented environment variables, valid shells/links, and Prisma/SQLite
 * parity. It prints a JSON report and exits non-zero on any FAIL.
 *
 * Read-only: it never writes to the repository or the database.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(abs(p), "utf8");
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });

function walk(dir, out = []) {
  // archive/ is an immutable, verbatim historical snapshot of every path
  // retired by the 2026-11-09 unification. It is deliberately excluded from
  // active-tree invariants (imports, duplicate content, credentials, links);
  // its own MANIFEST.md maps each path to the canonical replacement.
  const skip = new Set([".git", "node_modules", ".next", ".arena", "__pycache__", "out", "dist", "coverage", "archive"]);
  for (const entry of readdirSync(abs(dir), { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel.split(path.sep).join("/"));
  }
  return out;
}

const files = walk(".");
const textFiles = files.filter((f) => /\.(ts|tsx|js|mjs|cjs|json|md|sh|prisma|sql|yml|yaml|toml|txt|py|conf|service|sudoers|example|css|html)$/.test(f) || f.endsWith(".env.example"));

// 1 — One project, no retired duplicate trees or duplicate config pairs.
const retired = ["alo-hosting-portal", "alo-server-kit", "server-helpers", "server-config", "install-scripts", "Dockerfile.node20", "docker-compose.node20.yml", "docs/SERVER-SPEC.md", "src/middleware.ts", "vitest.config.ts"];
check("retired duplicate trees/files are absent", retired.every((p) => !existsSync(abs(p))), retired.filter((p) => existsSync(abs(p))).join(", "));
// The server kit ships one tiny standalone demo app used by its stage-02
// provisioning rehearsal; it is not a second copy of this portal.
const appManifests = files.filter((f) => f.endsWith("package.json") && f !== "package.json" && f !== "deploy/server-kit/demo-app/package.json");
check("one canonical package.json", appManifests.length === 0, appManifests.join(", "));
check("one canonical prisma schema", files.filter((f) => f.endsWith("schema.prisma")).length === 1);
const sudoers = files.filter((f) => f.startsWith("deploy/sudoers/") || f.includes("sudoers-alo") || f.endsWith(".sudoers"));
check("exactly two canonical sudoers policies", sudoers.length === 2 && sudoers.every((f) => f.startsWith("deploy/sudoers/")), sudoers.join(", "));
check("proxy convention is current", existsSync(abs("src/proxy.ts")) && !existsSync(abs("src/middleware.ts")));
const archiveManifest = "archive/retired-2026-11-09/manifest.json";
const semanticDiff = "archive/retired-2026-11-09/semantic-diff.json";
let semanticOk = false;
try {
  const semantic = JSON.parse(read(semanticDiff));
  const entries = Array.isArray(semantic.entries) ? semantic.entries : [];
  const summary = semantic.summary ?? {};
  semanticOk =
    existsSync(abs("archive/retired-2026-11-09/SEMANTIC-DIFF.md")) &&
    entries.length === 431 &&
    summary.retired_paths === 431 &&
    summary.archive_preserved === 431 &&
    summary.no_exact_copy_reviewed > 0 &&
    summary.semantic_review_complete === true &&
    summary.missing_api_route_paths === 0 &&
    summary.missing_api_route_methods === 0 &&
    summary.missing_page_routes === 0 &&
    summary.missing_component_paths === 0 &&
    summary.missing_library_paths === 0 &&
    entries.every(
      (entry) =>
        entry.archive_preserved &&
        entry.head_sha256 &&
        entry.archive_sha256 &&
        entry.classification &&
        entry.resolution &&
        entry.reviewed === true,
    );
} catch {}
check(
  "every retired path is preserved and semantically mapped",
  existsSync(abs(archiveManifest)) && JSON.parse(read(archiveManifest)) instanceof Object && Object.keys(JSON.parse(read(archiveManifest))).length === 431 && semanticOk,
  semanticDiff,
);

// 2 — Imports resolve, and every bare import is declared.
const importRe = /(?:^|\n)\s*(?:import|export)\s[^;\n]*?\sfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|(?:require|import)\s*\(\s*["']([^"']+)["']/g;
const pkg = JSON.parse(read("package.json"));
const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
const runtimeProvided = new Set(["fs", "path", "crypto", "url", "os", "child_process", "stream", "zlib", "net", "dns", "http", "https", "util", "timers", "events", "buffer", "querystring", "assert", "worker_threads", "fs/promises", "dns/promises", "timers/promises", "readline", "tty", "vm", "module"]);
const broken = [];
const undeclared = new Map();
const candidates = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"];
for (const f of files.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))) {
  const src = read(f);
  for (const m of src.matchAll(importRe)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    if (spec.startsWith("node:") || runtimeProvided.has(spec.replace(/^node:/, "")) || spec.startsWith("http")) continue;
    let target;
    if (spec.startsWith("@/")) target = path.join(ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) target = path.resolve(path.dirname(abs(f)), spec);
    else {
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!declared.has(name)) undeclared.set(name, (undeclared.get(name) ?? 0) + 1);
      continue;
    }
    if (!candidates.some((c) => existsSync(target + c))) broken.push(`${f} -> ${spec}`);
  }
}
check("no broken relative or @/ imports", broken.length === 0, broken.slice(0, 8).join("; "));
check("no undeclared npm imports", undeclared.size === 0, [...undeclared.keys()].join(", "));

// 3 — Environment template: no duplicate keys, documents every app variable.
const envKeys = [...read(".env.example").matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]);
const dupes = envKeys.filter((k, i) => envKeys.indexOf(k) !== i);
check(".env.example has no duplicate keys", dupes.length === 0, [...new Set(dupes)].join(", "));
const used = new Set();
for (const f of files.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))) {
  for (const m of read(f).matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
}
const runtimeVars = new Set(["HOME", "PATH", "HOSTNAME", "NEXT_RUNTIME", "NEXT_PHASE", "npm_lifecycle_event", "npm_package_version", "NODE_ENV", "PORT", "TEST_LOOKUP_EXIT"]);
const undocumented = [...used].filter((k) => !envKeys.includes(k) && !runtimeVars.has(k));
check("all app env vars are documented", undocumented.length === 0, undocumented.join(", "));

// 4 — No placeholder implementations / TODO / FIXME in shipped source.
const banned = /\b(TODO|FIXME|NOT IMPLEMENTED|coming soon|lorem ipsum)\b/i;
const placeholderHits = [];
for (const f of files.filter((f) => /^(src|scripts|helpers|deploy|tests)\/.*\.(ts|tsx|js|mjs|cjs|sh)$/.test(f) && f !== "scripts/repo-audit.mjs")) {
  for (const [i, line] of read(f).split("\n").entries()) {
    if (banned.test(line) && !/expect\(|not\.toMatch|\/todo\|tbd\/i/.test(line)) placeholderHits.push(`${f}:${i + 1}`);
  }
}
check("no TODO/FIXME/placeholder code", placeholderHits.length === 0, placeholderHits.slice(0, 8).join("; "));

// 5 — Shell scripts parse.
const shells = files.filter((f) => f.endsWith(".sh") || /^(helpers\/alo-|deploy\/server-kit\/stages\/)/.test(f));
const shellErrors = [];
for (const f of shells) {
  try { execFileSync("bash", ["-n", abs(f)], { stdio: "ignore" }); }
  catch { shellErrors.push(f); }
}
check(`all ${shells.length} shell programs pass bash -n`, shellErrors.length === 0, shellErrors.join(", "));

// 6 — Local markdown links resolve.
const brokenLinks = [];
for (const f of files.filter((f) => f.endsWith(".md"))) {
  for (const m of read(f).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].trim().split("#")[0].split(" ")[0];
    if (!target || /^(https?:|mailto:|data:|#)/.test(target)) continue;
    const p = target.startsWith("/") ? target.slice(1) : path.join(path.dirname(f), target);
    if (!existsSync(abs(p))) brokenLinks.push(`${f} -> ${target}`);
  }
}
check("no broken local markdown links", brokenLinks.length === 0, brokenLinks.slice(0, 8).join("; "));

// 7 — Prisma schema / SQLite parity (read-only).
try {
  const { createClient } = await import("@libsql/client");
  const schema = read("prisma/schema.prisma");
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));
  const tables = models.map((m) => m.body.match(/@@map\("([^"]+)"\)/)?.[1] ?? m.name);
  const client = createClient({ url: `file:${abs("db/custom.db")}` });
  const present = new Set((await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => String(r.name)));
  check(`all ${tables.length} Prisma tables exist in db/custom.db`, tables.every((t) => present.has(t)), tables.filter((t) => !present.has(t)).join(", "));
  const integrity = await client.execute("PRAGMA integrity_check");
  check("SQLite integrity_check is ok", integrity.rows[0]?.integrity_check === "ok");
  client.close();
} catch (e) {
  check("Prisma/SQLite parity", false, e.message);
}

// 8 — No published seed passwords anywhere in code.
const published = ["admin123", "reseller123", "client123"];
const leaked = [];
// scripts/init-production-db.sh intentionally keeps the historical defaults so
// it can detect and rotate databases seeded by older releases.
const codeFiles = textFiles.filter((f) => /^(src|prisma|tests|helpers|deploy|scripts)\//.test(f) && f !== "scripts/init-production-db.sh" && f !== "scripts/repo-audit.mjs");
for (const f of codeFiles) {
  const t = read(f);
  for (const p of published) if (t.includes(p)) leaked.push(`${f}:${p}`);
}
check("no published seed passwords in source", leaked.length === 0, leaked.slice(0, 8).join("; "));

// 9 — Duplicate content groups (excluding intentional small config shims).
const byHash = new Map();
for (const f of files.filter((f) => !f.endsWith(".db") && statSync(abs(f)).size > 200)) {
  const h = createHash("sha256").update(readFileSync(abs(f))).digest("hex");
  byHash.set(h, [...(byHash.get(h) ?? []), f]);
}
const dupGroups = [...byHash.values()].filter((g) => g.length > 1);
check("no large byte-identical duplicate files", dupGroups.length === 0, dupGroups.slice(0, 5).map((g) => g.join(" = ")).join(" | "));

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks: checks.length, passed: checks.length - failed.length, failed, generatedAt: new Date().toISOString() }, null, 2));
process.exit(failed.length ? 1 : 0);
