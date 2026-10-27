/**
 * Migration safety — `scripts/apply-deploy-schema.mjs`.
 *
 * These tests exist because a table-rebuild migration ran by default inside the
 * production deploy job, and two failure modes were reproduced against
 * disposable copies of the tracked database:
 *
 *   1. A schema mismatch left an orphaned `operation_jobs_new` table, and every
 *      later deploy then failed on `CREATE TABLE` — wedging the pipeline.
 *   2. An interruption after `DROP TABLE "audit_logs"` removed the audit table,
 *      and the applier still reported `{"ok": true}` with exit code 0, because
 *      its postcondition only looked at `operation_jobs.websiteId`.
 *
 * Every case here runs the real applier as a child process against a throwaway
 * copy in a temp directory. The tracked database `db/custom.db` is only ever
 * read, never written, and no test connects to a production database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const APPLIER = path.resolve("scripts/apply-deploy-schema.mjs");
const REBUILD = "20261027093000_operation_jobs_platform_scope";
const SOURCE_DB = path.resolve("db/custom.db");

let root = "";
/** Source database with the additive migrations applied; rebuild still pending. */
let baseline = "";
/** A verified backup an operator would take before authorizing a rebuild. */
let goodBackup = "";

function run(args: string[], dbFile: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number; json: any; raw: string }>((resolve) => {
    execFile(
      process.execPath,
      [APPLIER, ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${dbFile}`, ...env },
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error: (Error & { code?: number }) | null, stdout, stderr) => {
        const raw = `${stdout}${stderr}`;
        let json: any = null;
        try {
          json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
        } catch {
          json = null;
        }
        resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, json, raw });
      },
    );
  });
}

function sqlite(file: string, readOnly = true) {
  return new DatabaseSync(file, { readOnly });
}

function tables(file: string): string[] {
  const db = sqlite(file);
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => String(r.name));
  } finally {
    db.close();
  }
}

function columnInfo(file: string, table: string) {
  const db = sqlite(file);
  try {
    return db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; notnull: number; pk: number }>;
  } finally {
    db.close();
  }
}

function count(file: string, table: string): number {
  const db = sqlite(file);
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as unknown as Record<string, number>;
    return Number(row.c);
  } finally {
    db.close();
  }
}

/** Apply statements until `stopAfter` has run, then abandon the database. */
function interruptRebuildAfter(file: string, stopAfter: string) {
  const sql = readFileSync(path.resolve(`prisma/migrations/${REBUILD}/migration.sql`), "utf8");
  const statements = sql
    .split("\n")
    .filter((l: string) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s: string) => s.trim())
    .filter(Boolean);
  const db = new DatabaseSync(file);
  try {
    for (const statement of statements) {
      db.exec(statement);
      if (statement === stopAfter) return;
    }
    throw new Error(`statement not found in ${REBUILD}: ${stopAfter}`);
  } finally {
    db.close();
  }
}

let n = 0;
async function freshCopy(prefix: string): Promise<string> {
  const target = path.join(root, `${prefix}-${++n}.db`);
  await fs.copyFile(baseline, target);
  return target;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "alo-migration-safety-"));
  baseline = path.join(root, "baseline.db");
  goodBackup = path.join(root, "verified-backup.db");
  await fs.copyFile(SOURCE_DB, baseline);
  await fs.copyFile(SOURCE_DB, goodBackup);

  // Bring the baseline to "additive applied, rebuild pending" — the exact state
  // a production host is in the first time this release reaches it.
  const seeded = await run([], baseline);
  expect(seeded.code, seeded.raw).toBe(0);
  expect(seeded.json.ok).toBe(true);
  expect(seeded.json.rebuilds[0].outcome).toBe("not-authorized");
}, 180_000);

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

/**
 * Every case spawns a real child process (module load + libsql open ≈ 0.2 s),
 * so each test gets a longer budget than the default 5 s. Raising the global
 * timeout in vitest.config.ts would hide genuinely slow tests elsewhere.
 */
const T = 120_000;

// ─── Target validation: fail closed ─────────────────────────────────────────

describe("migration target validation", () => {
  it("refuses to run when DATABASE_URL is not set instead of defaulting to the tracked database", async () => {
    const res = await new Promise<{ code: number; raw: string }>((resolve) => {
      execFile(
        process.execPath,
        [APPLIER],
        { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: "" }, timeout: 60_000 },
        (error, stdout, stderr) => resolve({ code: error ? 1 : 0, raw: `${stdout}${stderr}` }),
      );
    });
    expect(res.code).not.toBe(0);
    expect(res.raw).toContain("DATABASE_URL is not set");
    expect(res.raw).toContain("no longer falls back to file:./db/custom.db");
  }, T);

  it("refuses a relative file: path, which is what broke a production deploy before", async () => {
    const relative = path.join(root, "relative.db");
    await fs.copyFile(baseline, relative);
    const res = await new Promise<{ code: number; raw: string }>((resolve) => {
      execFile(
        process.execPath,
        [APPLIER],
        { cwd: root, env: { ...process.env, DATABASE_URL: "file:./relative.db" }, timeout: 60_000 },
        (error, stdout, stderr) => resolve({ code: error ? 1 : 0, raw: `${stdout}${stderr}` }),
      );
    });
    expect(res.code).not.toBe(0);
    expect(res.raw).toContain("relative file: path");
  }, T);

  it("refuses a non-SQLite engine rather than attempting schema changes against it", async () => {
    const res = await new Promise<{ code: number; raw: string }>((resolve) => {
      execFile(
        process.execPath,
        [APPLIER],
        { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: "mysql://user@host:3306/db" }, timeout: 60_000 },
        (error, stdout, stderr) => resolve({ code: error ? 1 : 0, raw: `${stdout}${stderr}` }),
      );
    });
    expect(res.code).not.toBe(0);
    expect(res.raw).toContain("not a SQLite/libSQL target");
    expect(res.raw).not.toContain("user@host"); // never echo the connection string
  }, T);

  it("refuses a file that is not a SQLite database (magic header mismatch)", async () => {
    const fake = path.join(root, "not-a-database.db");
    await fs.writeFile(fake, "this is plainly not a sqlite file");
    const res = await run([], fake);
    expect(res.code).not.toBe(0);
    expect(res.raw).toContain("magic header mismatch");
  }, T);

  it("rejects an unrecognized flag instead of silently ignoring it", async () => {
    const db = await freshCopy("typo");
    const res = await run(["--allow-rebuild-typo"], db);
    expect(res.code).not.toBe(0);
    expect(res.raw).toContain("Unknown option");
  }, T);
});

// ─── Rebuild migrations are opt-in ──────────────────────────────────────────

describe("table-rebuild authorization", () => {
  it("applies additive migrations by default and refuses to rewrite a table", async () => {
    const db = await freshCopy("default");
    const res = await run([], db);
    expect(res.code, res.raw).toBe(0);
    expect(res.json.ok).toBe(true);
    expect(res.json.rebuildAuthorized).toBe(false);
    expect(res.json.rebuilds[0].outcome).toBe("not-authorized");
    expect(res.json.rebuilds[0].detail).toContain("--allow-rebuild");
    // Additive work happened, the rebuild did not.
    expect(tables(db)).toContain("server_agents");
    expect(columnInfo(db, "operation_jobs").find((c) => c.name === "websiteId")?.notnull).toBe(1);
  }, T);

  it("refuses an authorized rebuild with no backup", async () => {
    const db = await freshCopy("nobackup");
    const res = await run(["--allow-rebuild"], db);
    expect(res.code).not.toBe(0);
    expect(res.json.ok).toBe(false);
    expect(res.json.rebuilds[0].outcome).toBe("refused");
    expect(res.json.rebuilds[0].detail).toContain("no verified backup");
    // Nothing changed.
    expect(columnInfo(db, "operation_jobs").find((c) => c.name === "websiteId")?.notnull).toBe(1);
  }, T);

  it("refuses a backup that is not a database, so a stray file cannot authorize a rebuild", async () => {
    const db = await freshCopy("badbackup");
    const bad = path.join(root, "garbage-backup.db");
    await fs.writeFile(bad, "garbage");
    const res = await run(["--allow-rebuild", "--backup", bad], db);
    expect(res.code).not.toBe(0);
    expect(res.json.rebuilds[0].outcome).toBe("refused");
    expect(res.json.rebuilds[0].detail).toContain("not a SQLite database");
    expect(columnInfo(db, "operation_jobs").find((c) => c.name === "websiteId")?.notnull).toBe(1);
  }, T);

  it("refuses a backup that does not contain the tables about to be rewritten", async () => {
    const db = await freshCopy("wrongbackup");
    const wrong = path.join(root, "wrong-backup.db");
    await fs.copyFile(baseline, wrong);
    const d = sqlite(wrong, false);
    try {
      d.exec("PRAGMA foreign_keys=OFF");
      d.exec("DROP TABLE audit_logs");
    } finally {
      d.close();
    }
    const res = await run(["--allow-rebuild", "--backup", wrong], db);
    expect(res.code).not.toBe(0);
    expect(res.json.rebuilds[0].outcome).toBe("refused");
    expect(res.json.rebuilds[0].detail).toContain("backup does not contain table audit_logs");
  }, T);

  it("refuses a backup older than the configured maximum age", async () => {
    const db = await freshCopy("oldbackup");
    const res = await run(["--allow-rebuild", "--backup", goodBackup, "--max-backup-age-minutes", "0"], db);
    expect(res.code).not.toBe(0);
    expect(res.json.rebuilds[0].outcome).toBe("refused");
    expect(res.json.rebuilds[0].detail).toContain("older than the 0-minute limit");
  }, T);

  it("completes an authorized rebuild in one transaction, preserving every row and constraint", async () => {
    const db = await freshCopy("rebuild");
    const before = { audit: count(db, "audit_logs"), users: count(db, "users"), jobs: count(db, "operation_jobs") };
    const res = await run(["--allow-rebuild", "--backup", goodBackup], db);
    expect(res.code, res.raw).toBe(0);
    expect(res.json.ok).toBe(true);
    expect(res.json.rebuilds[0].outcome).toBe("applied");
    expect(res.json.rebuilds[0].rowsPreserved).toEqual({ operation_jobs: before.jobs, audit_logs: before.audit });

    expect(count(db, "audit_logs")).toBe(before.audit);
    expect(count(db, "users")).toBe(before.users);
    expect(columnInfo(db, "operation_jobs").find((c) => c.name === "websiteId")?.notnull).toBe(0);
    expect(tables(db).filter((t) => t.endsWith("_new"))).toEqual([]);

    const ddl = sqlite(db).prepare("SELECT sql FROM sqlite_master WHERE name='audit_logs'").get() as any;
    expect(String(ddl.sql)).toContain('REFERENCES "operation_jobs"');
    const integrity = sqlite(db).prepare("PRAGMA integrity_check").get() as any;
    expect(String(integrity.integrity_check)).toBe("ok");
  }, T);

  it("is idempotent: a second run applies nothing and reports the rebuild as already applied", async () => {
    const db = await freshCopy("idempotent");
    expect((await run(["--allow-rebuild", "--backup", goodBackup], db)).code).toBe(0);
    const second = await run([], db);
    expect(second.code, second.raw).toBe(0);
    expect(second.json.ok).toBe(true);
    expect(second.json.rebuilds[0].outcome).toBe("already-applied");
    expect(second.json.problems).toEqual([]);
  }, T);
});

// ─── Preconditions: never lose a column, never rebuild a missing table ──────

describe("rebuild preconditions", () => {
  it("refuses when the database carries a column the rebuild would silently drop", async () => {
    const db = await freshCopy("extracolumn");
    const d = sqlite(db, false);
    try {
      d.exec("ALTER TABLE operation_jobs ADD COLUMN operatorNote TEXT");
      d.exec("UPDATE operation_jobs SET operatorNote = 'hand-added, must survive'");
    } finally {
      d.close();
    }
    const res = await run(["--allow-rebuild", "--backup", goodBackup], db);
    expect(res.code).not.toBe(0);
    expect(res.json.rebuilds[0].outcome).toBe("refused");
    expect(res.json.rebuilds[0].detail).toContain("operation_jobs.operatorNote would be DROPPED");
    expect(columnInfo(db, "operation_jobs").some((c) => c.name === "operatorNote")).toBe(true);
  }, T);

  it("refuses when a source table is missing entirely, and reports it as a schema problem too", async () => {
    const db = await freshCopy("missingtable");
    const d = sqlite(db, false);
    try {
      d.exec("PRAGMA foreign_keys=OFF");
      d.exec("DROP TABLE audit_logs");
    } finally {
      d.close();
    }
    const res = await run(["--allow-rebuild", "--backup", goodBackup], db);
    expect(res.code).not.toBe(0);
    expect(res.json.ok).toBe(false);
    expect(res.json.rebuilds[0].outcome).toBe("damaged");
    expect(res.json.rebuilds[0].detail).toContain("missing table(s) audit_logs");
    expect(res.json.problems).toContain("missing table audit_logs");
  }, T);

  it("does not accept a drifted table as 'already rebuilt' just because one column is nullable", async () => {
    // `CREATE TABLE … AS SELECT` drops every NOT NULL, primary key and foreign
    // key. A postcondition that only checked nullability would call this done.
    const db = await freshCopy("drift");
    const d = sqlite(db, false);
    try {
      const cols = (d.prepare('PRAGMA table_info("operation_jobs")').all() as Array<{ name: string }>)
        .map((c) => `"${c.name}"`)
        .join(", ");
      d.exec(`CREATE TABLE oj_tmp AS SELECT ${cols} FROM operation_jobs`);
      d.exec("DROP TABLE operation_jobs");
      d.exec("ALTER TABLE oj_tmp RENAME TO operation_jobs");
    } finally {
      d.close();
    }
    expect(columnInfo(db, "operation_jobs").find((c) => c.name === "websiteId")?.notnull).toBe(0);
    const res = await run([], db);
    expect(res.json.rebuilds[0].outcome).not.toBe("already-applied");
  }, T);
});

// ─── Interrupted migrations: the two reproduced production failure modes ────

describe("interrupted rebuild recovery", () => {
  it("never reports success after an interruption that dropped audit_logs (Gate A scenario 2)", async () => {
    const db = await freshCopy("crash-audit");
    interruptRebuildAfter(db, 'DROP TABLE "audit_logs"');
    expect(tables(db)).not.toContain("audit_logs");
    expect(tables(db)).toContain("audit_logs_new");

    for (const args of [[], ["--verify"], ["--allow-rebuild", "--backup", goodBackup]]) {
      const res = await run(args, db);
      expect(res.code, `mode ${args.join(" ") || "default"}: ${res.raw}`).not.toBe(0);
      expect(res.json.ok).toBe(false);
      expect(res.json.rebuilds[0].outcome).toBe("damaged");
      expect(res.json.problems).toContain("missing table audit_logs");
      expect(res.json.problems.some((p: string) => p.includes("orphaned temporary table audit_logs_new"))).toBe(true);
      expect(res.json.rebuilds[0].detail).toContain("DATABASE-RECOVERY-RUNBOOK.md");
    }
    // The rows are still recoverable from the temporary table — the runbook
    // restores from backup, but the data is not silently gone without a trace.
    expect(count(db, "audit_logs_new")).toBeGreaterThan(0);
  }, T);

  it("recovers from the documented procedure: restore the verified backup, then re-run", async () => {
    const db = await freshCopy("recover");
    interruptRebuildAfter(db, 'DROP TABLE "audit_logs"');
    expect((await run([], db)).json.ok).toBe(false);

    await fs.copyFile(goodBackup, db);
    const res = await run(["--allow-rebuild", "--backup", goodBackup], db);
    expect(res.code, res.raw).toBe(0);
    expect(res.json.ok).toBe(true);
    expect(res.json.rebuilds[0].outcome).toBe("applied");
    expect(res.json.problems).toEqual([]);
    expect(tables(db)).toContain("audit_logs");
    expect(tables(db).filter((t) => t.endsWith("_new"))).toEqual([]);
  }, T);

  it("clears orphan debris once the rebuild is in effect, so a later deploy cannot wedge", async () => {
    const db = await freshCopy("orphan-applied");
    expect((await run(["--allow-rebuild", "--backup", goodBackup], db)).code).toBe(0);
    const d = sqlite(db, false);
    try {
      d.exec('CREATE TABLE "audit_logs_new" (id TEXT)');
    } finally {
      d.close();
    }
    const res = await run([], db);
    expect(res.code, res.raw).toBe(0);
    expect(res.json.ok).toBe(true);
    expect(res.json.rebuilds[0].outcome).toBe("already-applied");
    expect(res.json.rebuilds[0].orphansRemoved).toContain("audit_logs_new");
    expect(tables(db)).not.toContain("audit_logs_new");
  }, T);

  it("completes a pending rebuild whose temporary table was left behind (Gate A scenario 1)", async () => {
    const db = await freshCopy("orphan-pending");
    const d = sqlite(db, false);
    try {
      d.exec('CREATE TABLE "operation_jobs_new" (id TEXT)');
    } finally {
      d.close();
    }
    // An unauthorized run must not paper over it: it names the exact next step.
    const blocked = await run([], db);
    expect(blocked.code).not.toBe(0);
    expect(blocked.json.rebuilds[0].outcome).toBe("damaged");
    expect(blocked.json.rebuilds[0].detail).toContain("--allow-rebuild");

    const res = await run(["--allow-rebuild", "--backup", goodBackup], db);
    expect(res.code, res.raw).toBe(0);
    expect(res.json.ok).toBe(true);
    expect(res.json.rebuilds[0].outcome).toBe("applied");
    expect(res.json.rebuilds[0].orphansRemoved).toContain("operation_jobs_new");
    expect(tables(db).filter((t) => t.endsWith("_new"))).toEqual([]);
    expect(columnInfo(db, "operation_jobs").find((c) => c.name === "websiteId")?.notnull).toBe(0);
  }, T);

  it("rolls the whole rebuild back when a statement fails halfway through", async () => {
    const db = await freshCopy("rollback");
    // Make the audit_logs half of the rebuild fail by removing a column its
    // INSERT … SELECT reads, *after* operation_jobs would already be swapped.
    const d = sqlite(db, false);
    try {
      const cols = (d.prepare('PRAGMA table_info("audit_logs")').all() as Array<{ name: string }>)
        .map((c) => c.name)
        .filter((name) => name !== "durationMs");
      d.exec(`CREATE TABLE al_tmp AS SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM audit_logs`);
      d.exec("DROP TABLE audit_logs");
      d.exec("ALTER TABLE al_tmp RENAME TO audit_logs");
    } finally {
      d.close();
    }
    const res = await run(["--allow-rebuild", "--backup", goodBackup], db);
    expect(res.code).not.toBe(0);
    expect(res.json.ok).toBe(false);
    // The precondition catches it before any statement runs — either way the
    // database must still hold both original tables and no temporaries.
    expect(["refused", "failed-rolled-back"]).toContain(res.json.rebuilds[0].outcome);
    expect(tables(db)).toContain("operation_jobs");
    expect(tables(db)).toContain("audit_logs");
    expect(tables(db).filter((t) => t.endsWith("_new"))).toEqual([]);
  }, T);
});

// ─── Concurrency and read-only modes ────────────────────────────────────────

describe("migration locking and read-only modes", () => {
  it("refuses to run while another migration holds the lock", async () => {
    const db = await freshCopy("locked");
    await fs.writeFile(
      `${db}.migration-lock`,
      JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
    );
    const res = await run(["--lock-timeout-ms", "600"], db);
    expect(res.code).not.toBe(0);
    expect(res.raw).toContain("Another migration is in progress");
    expect(res.raw).toContain("migration-lock");
    await fs.rm(`${db}.migration-lock`, { force: true });
  }, T);

  it("clears a lock left behind by a crashed run and then completes, leaving no lock", async () => {
    const db = await freshCopy("stalelock");
    await fs.writeFile(`${db}.migration-lock`, JSON.stringify({ pid: 999999, startedAt: "2020-01-01T00:00:00Z" }));
    const res = await run(["--lock-timeout-ms", "600"], db);
    expect(res.code, res.raw).toBe(0);
    expect(res.json.ok).toBe(true);
    await expect(fs.stat(`${db}.migration-lock`)).rejects.toThrow();
  }, T);

  it("--check reports what would happen without writing", async () => {
    const db = await freshCopy("check");
    const before = await fs.readFile(db);
    const res = await run(["--check"], db);
    expect(res.code, res.raw).toBe(0);
    expect(res.json.mode).toBe("check");
    expect(res.json.statementsApplied).toBe(0);
    expect(await fs.readFile(db)).toEqual(before);
  }, T);

  it("--verify reports the real state of a healthy and a damaged database without writing", async () => {
    const healthy = await freshCopy("verify-ok");
    expect((await run(["--allow-rebuild", "--backup", goodBackup], healthy)).code).toBe(0);
    const okRes = await run(["--verify"], healthy);
    expect(okRes.code, okRes.raw).toBe(0);
    expect(okRes.json.mode).toBe("verify");
    expect(okRes.json.ok).toBe(true);
    expect(okRes.json.rebuilds[0].outcome).toBe("already-applied");

    const damaged = await freshCopy("verify-bad");
    interruptRebuildAfter(damaged, 'DROP TABLE "audit_logs"');
    const badRes = await run(["--verify"], damaged);
    expect(badRes.code).not.toBe(0);
    expect(badRes.json.ok).toBe(false);
    expect(badRes.json.problems).toContain("missing table audit_logs");
  }, T);

  it("verifies audit_logs as part of the required schema, not only operation_jobs", async () => {
    const db = await freshCopy("required-schema");
    const d = sqlite(db, false);
    try {
      d.exec("PRAGMA foreign_keys=OFF");
      d.exec("DROP TABLE audit_logs");
    } finally {
      d.close();
    }
    // Additive-only run: it must still fail, because the required-schema check
    // includes the audit table.
    const res = await run([], db);
    expect(res.code).not.toBe(0);
    expect(res.json.ok).toBe(false);
    expect(res.json.problems).toContain("missing table audit_logs");
  }, T);

  it("leaves no lock file behind after a successful run", async () => {
    const db = await freshCopy("nolock");
    expect((await run([], db)).code).toBe(0);
    await expect(fs.stat(`${db}.migration-lock`)).rejects.toThrow();
  }, T);
});

describe("the tracked database is never a migration target", () => {
  it("does not modify db/custom.db when the suite runs", async () => {
    const before = await fs.readFile(SOURCE_DB);
    const db = await freshCopy("untouched");
    await run(["--allow-rebuild", "--backup", goodBackup], db);
    expect(await fs.readFile(SOURCE_DB)).toEqual(before);
  }, T);
});
