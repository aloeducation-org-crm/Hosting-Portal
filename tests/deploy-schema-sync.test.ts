/**
 * Deploy-schema drift guard.
 *
 * This test exists because of a real CI failure: PR #37 added the
 * `git_projects.agentId` column to `prisma/schema.prisma` and to migration
 * `20261112120000_remote_node_deployment`, but did not add it to the two places
 * CI's database is actually derived from:
 *
 *   - `REQUIRED_SCHEMA` in `scripts/apply-deploy-schema.mjs` — so the column was
 *     never created in the CI database; and
 *   - `SCHEMA_PROBES` in `src/lib/health.ts` — so the health probe did not check it.
 *
 * The health probe then reported an incomplete schema, `/api/ai/operator`
 * answered 400 instead of 200, and `tests/marketing-operator-and-providers.test.ts`
 * failed on `main`. Every file was present; the *schema* had drifted.
 *
 * Two invariants are enforced here, in the direction that is mechanically
 * decidable:
 *
 *   1. Migration -> Prisma: every `ALTER TABLE … ADD COLUMN` in
 *      `prisma/migrations/**` resolves to a real column on a real model.
 *      Catches a migration that the schema was never updated to match.
 *   2. Deploy schema -> Prisma: every table/column named in `REQUIRED_SCHEMA`
 *      and `SCHEMA_PROBES` exists in `prisma/schema.prisma`. Catches a stale or
 *      misspelled entry, which is how a required column silently stops being
 *      verified.
 *
 * WHAT THIS TEST DELIBERATELY DOES NOT CLAIM. It does **not** catch a repeat of
 * PR #37's actual mistake. That slip was an *omission* — a new column that was
 * correct in both the migration and `schema.prisma` but simply never added to
 * `REQUIRED_SCHEMA`/`SCHEMA_PROBES`. The reverse rule ("every migrated column
 * must be required") is not a valid invariant: `REQUIRED_SCHEMA` is a curated
 * minimal subset, and 18 migrated columns (for example
 * `deployments.durationMs`, `operation_jobs.deadLetterReason`) are correctly
 * absent from it today. Enforcing that rule would fail CI on legitimate code.
 *
 * Choosing which new column joins the curated set is a review judgement. This
 * test's job is narrower and still real: it guarantees that once a column *is*
 * listed, it is spelled correctly and genuinely exists, and that no migration
 * has quietly outrun `schema.prisma`. The omission case is caught by PR review,
 * whose checklist now lives in §2.1 of `docs/audit/MERGE-INTEGRITY-VERIFICATION.md`.
 *
 * Each parser also asserts it matched something, so an edit that renames or
 * moves these constants fails the test loudly instead of silently checking
 * nothing and reporting green.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** table name -> set of column names, resolved through `@@map` / `@map`. */
function parsePrismaModels(src: string): Map<string, Set<string>> {
  const models = new Map<string, Set<string>>();
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(src)) !== null) {
    const [, name, body] = m;
    const tableMap = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    const table = tableMap ? tableMap[1] : name;
    const columns = new Set<string>();
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("/*")) continue;
      if (line.startsWith("*") || line.startsWith("@@")) continue;
      const field = line.match(/^(\w+)\s+/);
      if (!field) continue;
      const columnMap = line.match(/@map\(\s*"([^"]+)"\s*\)/);
      columns.add(columnMap ? columnMap[1] : field[1]);
    }
    models.set(table, columns);
  }
  return models;
}

/** Pull `{ table: ["col", …] }` entries out of a JS/TS object or array literal. */
function parseTableColumns(src: string, startPattern: RegExp): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const block = src.match(startPattern);
  if (!block) return out;
  const entryRe = /(["']?\w+["']?)\s*:\s*\[([\s\S]*?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(block[1])) !== null) {
    const table = m[1].replace(/^["']|["']$/g, "");
    const columns = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (table.startsWith("_") || table === "table") continue;
    out.set(table, columns);
  }
  return out;
}

const prismaModels = parsePrismaModels(read("prisma/schema.prisma"));

const requiredSchema = (() => {
  const src = read("scripts/apply-deploy-schema.mjs");
  return parseTableColumns(src, /REQUIRED_SCHEMA\s*(?::[^=]+)?=\s*\{([\s\S]*?)\n\};/);
})();

const schemaProbes = (() => {
  const src = read("src/lib/health.ts");
  const out = new Map<string, string[]>();
  const block = src.match(/SCHEMA_PROBES[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) return out;
  const entryRe = /\{\s*table:\s*"([^"]+)"\s*,\s*columns:\s*\[([^\]]*)\]\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(block[1])) !== null) {
    out.set(m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  }
  return out;
})();

describe("deploy-schema parsers found the constants they are guarding", () => {
  it("parses the Prisma schema", () => {
    expect(prismaModels.size).toBeGreaterThan(50);
    expect(prismaModels.get("git_projects")?.has("agentId")).toBe(true);
    expect(prismaModels.get("deployments")?.has("executedByAgentId")).toBe(true);
  });

  it("parses REQUIRED_SCHEMA", () => {
    // A rename or a move would make the block match nothing; an empty map must
    // fail loudly rather than trivially pass every downstream assertion.
    expect(requiredSchema.size).toBeGreaterThan(5);
    expect(requiredSchema.get("git_projects")).toContain("agentId");
    expect(requiredSchema.get("deployments")).toContain("executedByAgentId");
  });

  it("parses SCHEMA_PROBES", () => {
    expect(schemaProbes.size).toBeGreaterThanOrEqual(5);
    expect(schemaProbes.get("git_projects")).toContain("agentId");
    expect(schemaProbes.get("deployments")).toContain("executedByAgentId");
  });
});

describe("every migration column exists in the Prisma schema", () => {
  const migrationsDir = path.join(ROOT, "prisma/migrations");
  const addColumn = /ALTER\s+TABLE\s+"?([^"\s]+)"?\s+ADD\s+(?:COLUMN\s+)?"?([^"\s]+)"?/gi;

  it("finds migrations to check", () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
  });

  it("resolves every ADD COLUMN to a real Prisma model column", () => {
    const checked: string[] = [];
    const orphans: string[] = [];
    for (const dir of fs.readdirSync(migrationsDir).sort()) {
      const sqlPath = path.join(migrationsDir, dir, "migration.sql");
      if (!fs.existsSync(sqlPath)) continue;
      addColumn.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = addColumn.exec(read(path.relative(ROOT, sqlPath)))) !== null) {
        const [, table, column] = m;
        checked.push(`${table}.${column}`);
        const model = prismaModels.get(table);
        if (!model) orphans.push(`${dir}: no Prisma model maps to table "${table}"`);
        else if (!model.has(column)) orphans.push(`${dir}: "${table}"."${column}" missing from schema.prisma`);
      }
    }
    // Guard against the regex silently matching nothing after a formatting change.
    expect(checked.length).toBeGreaterThan(20);
    expect(orphans).toEqual([]);
  });
});

describe("deploy-schema constants reference real Prisma tables and columns", () => {
  const check = (label: string, entries: Map<string, string[]>) => {
    const problems: string[] = [];
    for (const [table, columns] of entries) {
      const model = prismaModels.get(table);
      if (!model) {
        problems.push(`${label}: table "${table}" is not a model in prisma/schema.prisma`);
        continue;
      }
      for (const column of columns) {
        if (!model.has(column)) problems.push(`${label}: "${table}"."${column}" is not a column in prisma/schema.prisma`);
      }
    }
    return problems;
  };

  it("REQUIRED_SCHEMA has no stale or misspelled entries", () => {
    expect(check("REQUIRED_SCHEMA", requiredSchema)).toEqual([]);
  });

  it("SCHEMA_PROBES has no stale or misspelled entries", () => {
    expect(check("SCHEMA_PROBES", schemaProbes)).toEqual([]);
  });

  it("probes only cover tables the deploy schema actually guarantees", () => {
    // The reverse direction is *not* asserted: `SCHEMA_PROBES` is a curated
    // subset, deliberately probing the tables whose drift breaks a deployment
    // rather than all seven that `REQUIRED_SCHEMA` manages. Requiring a probe
    // for every required table would be a design change, not a drift guard.
    // But a probe for a table the applier never guarantees is dead weight —
    // it can only ever report on columns nothing is responsible for creating.
    for (const table of schemaProbes.keys()) {
      expect(requiredSchema.has(table), `SCHEMA_PROBES probes "${table}", which REQUIRED_SCHEMA does not manage`).toBe(true);
    }
  });
});
