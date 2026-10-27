#!/usr/bin/env node
/**
 * Idempotent schema applier for the Git-connected deployment layer and the
 * unified orchestrator / server-agent layer.
 *
 * Why this exists instead of `prisma migrate deploy`:
 *   - this application ships `engineType = "client"` and the Prisma
 *     schema-engine binary cannot be downloaded on an offline/egress-filtered
 *     server (binaries.prisma.sh is unreachable);
 *   - existing installs have no `_prisma_migrations` table, so `migrate deploy`
 *     would try to replay the unrelated 0_init migration on top of live data.
 *
 * ── SAFETY MODEL ────────────────────────────────────────────────────────────
 * Two classes of migration are handled differently, because they are not
 * equally dangerous:
 *
 *   ADDITIVE  only creates tables/indexes and adds NULLable or defaulted
 *             columns. It never drops, deletes, truncates or rewrites a row, it
 *             is idempotent, and it runs by default.
 *
 *   REBUILD   rewrites an existing table (SQLite cannot drop a NOT NULL
 *             constraint, so the table has to be recreated). This *touches*
 *             data. It therefore never runs by default. It requires:
 *               --allow-rebuild          explicit human authorization
 *               --backup <file>          a verified SQLite backup of THIS db
 *             and it then runs inside a single `BEGIN IMMEDIATE` transaction,
 *             with a precondition check, orphan cleanup, and postconditions on
 *             table existence, columns, row counts, foreign-key text, indexes,
 *             `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
 *
 * The target database must be named explicitly and must be an absolute
 * `file:` (or `libsql://`) URL. There is deliberately NO fallback to
 * `file:./db/custom.db`: a deploy that does not know which database it is
 * allowed to change must not change one. Unsupported engines fail closed.
 *
 * An exclusive lock file next to the database prevents two deploys from
 * migrating concurrently.
 *
 * A zero exit code is never the only proof: the run prints a structured result
 * and `--verify` re-checks every postcondition without applying anything.
 *
 * Usage:
 *   DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs --check
 *   DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
 *   DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs --verify
 *   DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs \
 *     --allow-rebuild --backup /var/backups/alo-2026-10-27.db
 *   DATABASE_URL="..." node scripts/apply-deploy-schema.mjs --migration 20261027090000_unified_orchestrator_agents
 *
 * It prints no environment values and no credentials.
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@libsql/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "prisma", "migrations");

// ─── CLI ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
};

const checkOnly = has("--check");
const verifyOnly = has("--verify");
const allowRebuild = has("--allow-rebuild");
const backupPath = valueOf("--backup");
const maxBackupAgeMinutes = Number(valueOf("--max-backup-age-minutes") ?? 1440);
const lockTimeoutMs = Number(valueOf("--lock-timeout-ms") ?? 30_000);
const selected = valueOf("--migration");

/** Every option that must be spelled exactly; a typo must not pass silently. */
const KNOWN_FLAGS = new Set([
  "--check", "--verify", "--allow-rebuild", "--backup", "--max-backup-age-minutes",
  "--lock-timeout-ms", "--migration",
]);
const unknown = argv.filter((a, i) => a.startsWith("--") && !KNOWN_FLAGS.has(a) && argv[i - 1] !== "--backup"
  && argv[i - 1] !== "--max-backup-age-minutes" && argv[i - 1] !== "--lock-timeout-ms" && argv[i - 1] !== "--migration");
if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(", ")}. Refusing to run with an unrecognized flag.`);
  process.exit(2);
}

function fail(message, details) {
  console.error(JSON.stringify({ ok: false, error: message, ...(details ? { details } : {}) }, null, 2));
  process.exit(1);
}

// ─── Migration registry ─────────────────────────────────────────────────────

/**
 * ADDITIVE migrations run in this order. REBUILD entries declare the tables
 * they rewrite so the applier can verify them before and after.
 */
const MIGRATIONS = [
  { name: "20261026130000_github_autodeploy", kind: "ADDITIVE" },
  { name: "20261027090000_unified_orchestrator_agents", kind: "ADDITIVE" },
  { name: "20261027120000_agent_request_nonces", kind: "ADDITIVE" },
  {
    name: "20261027093000_operation_jobs_platform_scope",
    kind: "REBUILD",
    // operation_jobs.websiteId became NULLable so platform-wide jobs need no
    // fake website. SQLite can only do that by recreating the table, and the
    // rename rewrites the stored FK text in audit_logs, so audit_logs is
    // rebuilt afterwards. Both tables are verified before and after.
    rebuild: {
      tables: ["operation_jobs", "audit_logs"],
      tempTables: ["operation_jobs_new", "audit_logs_new"],
      /** Columns the INSERT … SELECT reads from the *current* table. */
      requiresColumns: {
        operation_jobs: [
          "id", "websiteId", "type", "status", "priority", "progress", "input", "output",
          "resourceId", "resourceType", "requestId", "exitCode", "stdout", "stderr", "error",
          "actorId", "actorEmail", "actorRole", "startedAt", "finishedAt", "completedAt",
          "durationMs", "createdAt", "idempotencyKey", "correlationId", "workerKind",
          "riskLevel", "attempts", "maxAttempts", "retryPolicy", "lastError", "availableAt",
          "leaseExpiresAt", "leasedBy", "lockKey", "requiresApproval", "approvedBy",
          "approvedAt", "approvalNote", "deadLetteredAt", "deadLetterReason", "cancelledAt",
          "cancelledBy", "updatedAt",
        ],
        audit_logs: [
          "id", "actorUserId", "actorEmail", "actorRole", "action", "resourceType",
          "resourceId", "domain", "result", "requestId", "ipAddress", "userAgent",
          "timestamp", "metadata", "errorCode", "durationMs", "operationJobId",
        ],
      },
      requiredIndexes: [
        "operation_jobs_websiteId_idx", "operation_jobs_status_idx", "operation_jobs_type_idx",
        "operation_jobs_requestId_idx", "operation_jobs_createdAt_idx",
        "operation_jobs_status_availableAt_idx", "operation_jobs_lockKey_idx",
        "operation_jobs_correlationId_idx", "operation_jobs_leaseExpiresAt_idx",
        "operation_jobs_idempotencyKey_key",
        "audit_logs_actorUserId_idx", "audit_logs_action_idx",
        "audit_logs_resourceType_resourceId_idx", "audit_logs_timestamp_idx",
        "audit_logs_requestId_idx",
      ],
      requiredForeignKeys: { audit_logs: "operation_jobs" },
      /**
       * The whole point of the rebuild: websiteId must accept NULL.
       *
       * Nullability alone is not sufficient evidence. A table recreated by
       * `CREATE TABLE … AS SELECT` (drift, a hand repair, a partial restore)
       * loses every NOT NULL, so it would also report websiteId as nullable and
       * the rebuild would be skipped as "already applied". The postcondition
       * therefore also requires the primary key and the foreign keys that the
       * declared rebuild target carries.
       */
      postcondition: async () => {
        if ((await columnNotNull("operation_jobs", "websiteId")) !== 0) return false;
        const cols = await columns("operation_jobs");
        if (!cols.some((c) => c.name === "id" && c.pk > 0)) return false;
        const ddl = await tableDdl("operation_jobs");
        return ddl.includes('REFERENCES "websites"') && ddl.includes('REFERENCES "users"');
      },
    },
  },
];

function registry() {
  if (selected) {
    const entry = MIGRATIONS.find((m) => m.name === selected);
    if (!entry) fail(`Unknown migration "${selected}"`, { known: MIGRATIONS.map((m) => m.name) });
    return [entry];
  }
  // Only migrations that actually exist on disk, so a partial checkout never
  // fails the whole run.
  return MIGRATIONS.filter((m) => existsSync(path.join(migrationsDir, m.name, "migration.sql")));
}

const SQLITE_MAGIC = "SQLite format 3\0";

/** Read the 16-byte header without loading the file; "" when unreadable. */
function sqliteMagic(file) {
  const buf = Buffer.alloc(16);
  let fd;
  try {
    fd = openSync(file, "r");
    const n = readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n).toString("latin1");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ─── Target validation (fail closed) ────────────────────────────────────────

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl || !rawUrl.trim()) {
  fail(
    "DATABASE_URL is not set. This script no longer falls back to file:./db/custom.db, because a deploy that has not been told which database to change must not change one.",
    { hint: 'DATABASE_URL="file:/absolute/path/to/panel.db" node scripts/apply-deploy-schema.mjs' },
  );
}
if (!rawUrl.startsWith("file:") && !rawUrl.startsWith("libsql://")) {
  fail(
    "DATABASE_URL is not a SQLite/libSQL target. This applier only understands file: and libsql:// URLs and will not attempt schema changes against another engine.",
    { scheme: rawUrl.split(":")[0] || "unknown" },
  );
}

let dbPath = null;
if (rawUrl.startsWith("file:")) {
  dbPath = rawUrl.slice("file:".length);
  if (!path.isAbsolute(dbPath)) {
    fail(
      "DATABASE_URL is a relative file: path. Relative paths resolve against the process working directory, which differs under PM2, systemd and CI — this already broke a production deployment once.",
      { hint: "Use an absolute path, e.g. file:/var/lib/alo-hosting/alo.db" },
    );
  }
  if (!existsSync(dbPath)) {
    fail("The target database file does not exist.", { path: dbPath });
  }
  if (sqliteMagic(dbPath) !== SQLITE_MAGIC) {
    fail("The target file is not a SQLite database (magic header mismatch). Refusing to run schema changes against an unknown engine.", { path: dbPath });
  }
}

const client = createClient({ url: rawUrl });

// ─── Small SQL helpers ──────────────────────────────────────────────────────

async function listTables() {
  const res = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  return new Set(res.rows.map((r) => String(r.name)));
}

async function columns(table) {
  const res = await client.execute(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
  return res.rows.map((r) => ({ name: String(r.name), notnull: Number(r.notnull), pk: Number(r.pk ?? 0) }));
}

/**
 * NOT NULL flag for one column, or null when the table/column is absent.
 * Deliberately async: the rebuild postcondition is awaited, and returning a
 * bare Promise here would make every truthiness check pass by accident.
 */
async function columnNotNull(table, column) {
  const found = (await columns(table)).find((c) => c.name === column);
  return found ? found.notnull : null;
}

async function rowCount(table) {
  const res = await client.execute(`SELECT COUNT(*) AS c FROM "${table.replace(/"/g, '""')}"`);
  return Number(res.rows[0]?.c ?? 0);
}

async function listIndexes() {
  const res = await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'");
  return new Set(res.rows.map((r) => String(r.name)));
}

async function tableDdl(table) {
  const res = await client.execute(`SELECT COALESCE(MAX(sql), '') AS ddl FROM sqlite_master WHERE type='table' AND name = '${table.replace(/'/g, "''")}'`);
  return String(res.rows[0]?.ddl ?? "");
}

async function scalarPragma(name) {
  try {
    const res = await client.execute(`PRAGMA ${name}`);
    return String(res.rows[0]?.[Object.keys(res.rows[0] ?? {})[0]] ?? "");
  } catch {
    return "";
  }
}

function parseStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const alterRe = /^ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+COLUMN\s+"([^"]+)"/i;

// ─── Backup verification (rebuild migrations only) ──────────────────────────

function verifyBackup() {
  const problems = [];
  if (!backupPath) {
    problems.push("--backup <file> is required before a rebuild migration may run");
  } else if (!existsSync(backupPath)) {
    problems.push(`backup file does not exist: ${backupPath}`);
  } else {
    const st = statSync(backupPath);
    if (st.size === 0) problems.push("backup file is empty");
    const ageMinutes = (Date.now() - st.mtimeMs) / 60_000;
    if (ageMinutes > maxBackupAgeMinutes) {
      problems.push(`backup is ${Math.round(ageMinutes)} minutes old, older than the ${maxBackupAgeMinutes}-minute limit`);
    }
    if (sqliteMagic(backupPath) !== SQLITE_MAGIC) problems.push("backup is not a SQLite database (magic header mismatch)");
  }
  return problems;
}

/** A backup only counts if it can actually restore the tables being rebuilt. */
async function verifyBackupContents(tables) {
  if (!backupPath || !existsSync(backupPath)) return ["backup unavailable"];
  const probe = createClient({ url: `file:${backupPath}` });
  const problems = [];
  try {
    const res = await probe.execute("SELECT name FROM sqlite_master WHERE type='table'");
    const present = new Set(res.rows.map((r) => String(r.name)));
    for (const t of tables) {
      if (!present.has(t)) problems.push(`backup does not contain table ${t}`);
      else {
        const c = await probe.execute(`SELECT COUNT(*) AS c FROM "${t}"`);
        if (Number(c.rows[0]?.c ?? 0) < 0) problems.push(`backup table ${t} is unreadable`);
      }
    }
    const integrity = await probe.execute("PRAGMA integrity_check");
    const verdict = String(integrity.rows[0]?.integrity_check ?? "");
    if (verdict !== "ok") problems.push(`backup integrity_check returned "${verdict}"`);
  } catch (error) {
    problems.push(`backup could not be opened: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try { probe.close(); } catch { /* already closed */ }
  }
  return problems;
}

// ─── Migration lock ─────────────────────────────────────────────────────────

const lockPath = dbPath ? `${dbPath}.migration-lock` : null;
let lockHeld = false;

function acquireLock() {
  if (!lockPath) return; // remote libsql target: no local lock file possible
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch { /* directory already exists or is unwritable; the write below reports it */ }
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx"); // fails if the file exists: atomic
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(fd);
      lockHeld = true;
      return;
    } catch (error) {
      if (error.code !== "EEXIST") fail(`Could not create the migration lock ${lockPath}`, { error: String(error.message) });
      let holder = null;
      try { holder = JSON.parse(readFileSync(lockPath, "utf8")); } catch { holder = null; }
      const ageMs = holder?.startedAt ? Date.now() - Date.parse(holder.startedAt) : Infinity;
      const staleMs = Math.max(lockTimeoutMs, 600_000);
      if (ageMs > staleMs) {
        // A crashed run left the lock behind. Removing it is safe: the holder is
        // older than the timeout and the rebuild itself is transactional.
        try { unlinkSync(lockPath); } catch { /* retried below */ }
        continue;
      }
      if (Date.now() >= deadline) {
        fail("Another migration is in progress (lock held). Refusing to run concurrently.", {
          lockPath, holder, waitedMs: lockTimeoutMs,
        });
      }
      const until = Date.now() + 250;
      while (Date.now() < until) { /* short synchronous wait */ }
    }
  }
}

function releaseLock() {
  if (!lockHeld || !lockPath) return;
  try { unlinkSync(lockPath); } catch { /* already gone */ }
  lockHeld = false;
}

// ─── Postconditions ─────────────────────────────────────────────────────────

/**
 * The tables/columns the deployment, health, orchestration and agent layers
 * need. `audit_logs` is here because a rebuild that loses the audit table must
 * never be reported as success.
 */
const REQUIRED_SCHEMA = {
  git_connections: ["id", "accountLogin", "tokenEncrypted"],
  git_projects: ["id", "websiteId", "repository", "config", "port"],
  webhook_deliveries: ["id", "deliveryId", "signatureValid", "result"],
  deployments: ["id", "stage", "verifiedCommitSha", "configSnapshot"],
  hosting_sites: ["id", "domainName", "sslStatus", "vhostPath", "serverId"],
  servers: ["id", "hostname", "ipAddress", "cpuUsage", "memoryUsage", "diskUsage"],
  audit_logs: ["id", "action", "actorEmail", "resourceType", "resourceId", "timestamp", "operationJobId"],
  operation_jobs: [
    "id", "status", "websiteId", "idempotencyKey", "correlationId", "workerKind", "riskLevel",
    "attempts", "maxAttempts", "availableAt", "leaseExpiresAt", "leasedBy",
    "lockKey", "requiresApproval", "deadLetteredAt",
  ],
  server_agents: ["id", "agentKey", "secretEnc", "status", "capabilities", "scopes", "lastHeartbeat"],
  agent_enrollment_tokens: ["id", "tokenHash", "expiresAt", "usedAt"],
  agent_tasks: ["id", "agentId", "command", "args", "status", "timeoutMs", "requiresApproval"],
  agent_metrics: ["id", "agentId", "cpuPercent", "memoryUsedMb", "recordedAt"],
  agent_nonces: ["id", "agentId", "nonce", "expiresAt"],
  replication_status: ["id", "host", "engine", "role", "binlogEnabled", "gtidMode", "lagSeconds"],
};

async function verifySchema() {
  const problems = [];
  const tables = await listTables();
  for (const [table, cols] of Object.entries(REQUIRED_SCHEMA)) {
    if (!tables.has(table)) { problems.push(`missing table ${table}`); continue; }
    const have = new Set((await columns(table)).map((c) => c.name));
    for (const col of cols) if (!have.has(col)) problems.push(`missing column ${table}.${col}`);
  }
  // Orphaned rebuild temporaries mean a previous attempt died mid-flight.
  for (const m of MIGRATIONS) {
    for (const temp of m.rebuild?.tempTables ?? []) {
      if (tables.has(temp)) problems.push(`orphaned temporary table ${temp} (an earlier rebuild did not complete)`);
    }
  }
  const integrity = await scalarPragma("integrity_check");
  if (integrity && integrity !== "ok") problems.push(`PRAGMA integrity_check returned "${integrity}"`);
  const fkRows = await client.execute("PRAGMA foreign_key_check").catch(() => ({ rows: [] }));
  if (fkRows.rows.length) problems.push(`PRAGMA foreign_key_check reported ${fkRows.rows.length} violation(s)`);
  return problems;
}

/**
 * "Already applied" must mean *intact*, not merely "the one column we care
 * about is nullable". A rebuild interrupted halfway can satisfy its
 * postcondition while `audit_logs` is gone and a temporary table is orphaned, so
 * the state of every table the rebuild owns is checked before skipping it.
 */
async function rebuildState(migration, opts = {}) {
  const spec = migration.rebuild;
  const tables = await listTables();
  const orphans = spec.tempTables.filter((t) => tables.has(t));
  const absent = spec.tables.filter((t) => !tables.has(t));

  // Column precondition, checked before the postcondition in every mode. An
  // unexpected column would be silently dropped by the INSERT … SELECT, and a
  // missing one would make the rebuild fail halfway, so neither may proceed.
  if (!absent.length) {
    const missing = [];
    const unexpected = [];
    for (const [table, cols] of Object.entries(spec.requiresColumns)) {
      const have = (await columns(table)).map((c) => c.name);
      const haveSet = new Set(have);
      for (const col of cols) if (!haveSet.has(col)) missing.push(`${table}.${col}`);
      for (const col of have) if (!cols.includes(col)) unexpected.push(`${table}.${col}`);
    }
    if (missing.length || unexpected.length) {
      return {
        outcome: "refused",
        detail: `${migration.name}: this database does not match the schema the rebuild expects`
          + (missing.length ? ` (missing ${missing.join(", ")})` : "")
          + (unexpected.length ? ` (unexpected column(s) ${unexpected.join(", ")} would be DROPPED by the rebuild)` : "")
          + `. Nothing was changed. Reconcile the schema — and if a column was added deliberately, extend the migration to carry it — then re-run with --allow-rebuild.`,
      };
    }
  }

  const holds = spec.postcondition ? await spec.postcondition() : true;

  // A rebuilt table that is simply gone cannot be repaired by re-running: the
  // rows are only in the backup. Refuse and send the operator there.
  if (absent.length) {
    return {
      outcome: "damaged",
      detail: `${migration.name}: an earlier rebuild did not complete — missing table(s) ${absent.join(", ")}`
        + (orphans.length ? ` and orphaned temporary table(s) ${orphans.join(", ")}` : "")
        + `. Nothing was changed. Restore from a verified backup and re-run (docs/DATABASE-RECOVERY-RUNBOOK.md); do not deploy over this state.`,
    };
  }

  if (holds) {
    // The rebuild is already in effect. Leftover temporaries are debris from a
    // rolled-back attempt, not data: drop them so the next run cannot wedge on
    // `CREATE TABLE` (that wedge is what made every later deploy fail).
    if (orphans.length) await dropOrphans(orphans);
    return {
      outcome: "already-applied",
      detail: `${migration.name}: postcondition holds and all rebuilt tables are intact`
        + (orphans.length ? `; removed orphaned temporary table(s) ${orphans.join(", ")}` : ""),
      orphansRemoved: orphans,
    };
  }

  // Not applied yet, but an orphan would make CREATE TABLE fail and wedge every
  // later deploy. An *authorized* run removes it inside its own transaction, so
  // it proceeds; an unauthorized run is told exactly what to do next.
  if (orphans.length && !opts.willRepairOrphans) {
    return {
      outcome: "damaged",
      detail: `${migration.name}: an earlier rebuild did not complete — orphaned temporary table(s) ${orphans.join(", ")}. `
        + `Re-run with --allow-rebuild and a verified --backup to complete it in one transaction.`,
    };
  }
  return null; // not applied yet
}

/** Drop leftover `*_new` temporaries. Only ever called for declared temp names. */
async function dropOrphans(orphans) {
  let tx = null;
  try {
    tx = await client.transaction();
    for (const t of orphans) await tx.execute(`DROP TABLE IF EXISTS "${t}"`);
    await tx.commit();
  } catch {
    try { await tx?.rollback(); } catch { /* best effort */ }
  }
}

// ─── Rebuild execution (transactional) ──────────────────────────────────────

async function applyRebuild(migration) {
  const spec = migration.rebuild;
  const sql = readFileSync(path.join(migrationsDir, migration.name, "migration.sql"), "utf8");
  const tables = await listTables();

  // 1. Already satisfied *and intact*? Then skip the file — a rebuild must
  //    never replay. A half-finished rebuild is reported as damaged instead.
  const state = await rebuildState(migration, { willRepairOrphans: true });
  if (state) return state;

  // 2. Preconditions: every column the INSERT … SELECT reads must exist, and
  //    every table being rebuilt must exist.
  for (const table of spec.tables) {
    if (!tables.has(table)) return { outcome: "refused", detail: `${migration.name}: source table ${table} does not exist` };
  }
  // 3. Backup must exist, be a readable SQLite db, be recent, and contain the
  //    tables about to be rewritten.
  const backupProblems = [...verifyBackup(), ...(await verifyBackupContents(spec.tables))];
  if (backupProblems.length) {
    return { outcome: "refused", detail: `${migration.name}: no verified backup — ${backupProblems.join("; ")}` };
  }

  // 4. Orphaned temporaries from a crashed earlier attempt would make CREATE
  //    TABLE fail and wedge every later deploy. Inside the transaction, so a
  //    failure here changes nothing.
  const orphans = spec.tempTables.filter((t) => tables.has(t));

  // 5. Row counts captured before, compared after.
  const before = {};
  for (const table of spec.tables) before[table] = await rowCount(table);

  // PRAGMAs are no-ops inside a transaction in SQLite, so they stay outside it.
  // libSQL does not enforce foreign keys by default; the constraint that
  // actually blocked platform-wide jobs was Prisma's client-side relation check.
  await client.execute("PRAGMA foreign_keys = OFF").catch(() => {});

  const statements = parseStatements(sql).filter((s) => !/^PRAGMA\b/i.test(s));
  let tx = null;
  try {
    tx = await client.transaction();
    for (const orphan of orphans) await tx.execute(`DROP TABLE IF EXISTS "${orphan}"`);
    for (const statement of statements) await tx.execute(statement);
    await tx.commit();
  } catch (error) {
    try { await tx?.rollback(); } catch { /* rollback is best-effort; the journal also recovers */ }
    return {
      outcome: "failed-rolled-back",
      detail: `${migration.name}: ${error instanceof Error ? error.message : String(error)} — transaction rolled back, original tables untouched`,
    };
  } finally {
    await client.execute("PRAGMA foreign_keys = ON").catch(() => {});
  }

  // 6. Postconditions. A rebuild that does not satisfy these is a failure even
  //    though the transaction committed.
  const problems = [];
  const afterTables = await listTables();
  for (const table of spec.tables) if (!afterTables.has(table)) problems.push(`${table} is missing after the rebuild`);
  for (const temp of spec.tempTables) if (afterTables.has(temp)) problems.push(`${temp} still exists after the rebuild`);
  for (const [table, count] of Object.entries(before)) {
    if (!afterTables.has(table)) continue;
    const after = await rowCount(table);
    if (after !== count) problems.push(`${table} row count changed from ${count} to ${after}`);
  }
  const indexes = await listIndexes();
  for (const index of spec.requiredIndexes ?? []) if (!indexes.has(index)) problems.push(`index ${index} is missing after the rebuild`);
  for (const [table, referenced] of Object.entries(spec.requiredForeignKeys ?? {})) {
    const ddl = await tableDdl(table);
    if (!ddl.includes(`REFERENCES "${referenced}"`)) problems.push(`${table} no longer references ${referenced} (stored FK text was lost)`);
  }
  if (spec.postcondition && !(await spec.postcondition(client))) problems.push("the rebuild postcondition does not hold");
  problems.push(...(await verifySchema()));

  if (problems.length) {
    return {
      outcome: "committed-but-unverified",
      detail: `${migration.name}: the transaction committed but verification failed — ${problems.join("; ")}. Restore from ${backupPath} and investigate before deploying again.`,
    };
  }
  return {
    outcome: "applied",
    detail: `${migration.name}: rebuilt ${spec.tables.join(", ")} in one transaction`,
    rowsPreserved: before,
    orphansRemoved: orphans,
    backupVerified: path.basename(backupPath),
  };
}

// ─── Additive execution ─────────────────────────────────────────────────────

async function applyAdditive(migration) {
  const file = path.join(migrationsDir, migration.name, "migration.sql");
  const applied = [];
  let created = 0;
  let skipped = 0;
  for (const statement of parseStatements(readFileSync(file, "utf8"))) {
    const match = statement.match(alterRe);
    if (match) {
      const [, table, column] = match;
      const have = new Set((await columns(table)).map((c) => c.name));
      if (have.has(column)) { skipped++; applied.push(`${migration.name}: ALTER ${table}.${column} (already present)`); continue; }
    }
    if (checkOnly) { skipped++; applied.push(`${migration.name}: would apply ${statement.split("\n")[0].slice(0, 80)}`); continue; }
    await client.execute(statement);
    created++;
    applied.push(`${migration.name}: ${statement.split("\n")[0].slice(0, 90)}`);
  }
  return { created, skipped, applied };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const summary = {
  ok: false,
  mode: verifyOnly ? "verify" : checkOnly ? "check" : "apply",
  target: dbPath ? { kind: "file", absolute: true } : { kind: "libsql-remote" },
  migrations: registry().map((m) => m.name),
  rebuildAuthorized: allowRebuild,
  statementsApplied: 0,
  statementsSkipped: 0,
  rebuilds: [],
  verified: [],
  problems: [],
};

try {
  if (verifyOnly) {
    summary.problems = await verifySchema();
    for (const migration of registry()) {
      if (migration.kind !== "REBUILD") continue;
      const state = await rebuildState(migration);
      summary.rebuilds.push({
        name: migration.name,
        outcome: state?.outcome ?? "pending",
        detail: state?.detail ?? `${migration.name}: not applied yet; needs --allow-rebuild and a verified --backup`,
      });
    }
    summary.ok = summary.problems.length === 0;
  } else {
    acquireLock();
    try {
      for (const migration of registry()) {
        if (migration.kind === "REBUILD") {
          // Rebuilds are opt-in. A default deploy run is additive-only, so an
          // unattended deploy can never rewrite a production table.
          if (!allowRebuild) {
            const state = await rebuildState(migration);
            summary.rebuilds.push(
              state ?? {
                name: migration.name,
                outcome: "not-authorized",
                detail: `${migration.name}: skipped. Table-rebuild migrations need --allow-rebuild plus a verified --backup. This deploy applied additive changes only.`,
              },
            );
            if (!state) summary.rebuilds[summary.rebuilds.length - 1].name = migration.name;
            continue;
          }
          if (checkOnly) {
            summary.rebuilds.push({ name: migration.name, outcome: "would-rebuild", detail: `${migration.name}: authorized; would run in one transaction after verifying ${backupPath ?? "<backup>"}` });
            continue;
          }
          const result = await applyRebuild(migration);
          summary.rebuilds.push({ name: migration.name, ...result });
          continue;
        }
        const res = await applyAdditive(migration);
        summary.statementsApplied += res.created;
        summary.statementsSkipped += res.skipped;
        summary.verified.push(...res.applied.slice(0, 3));
      }

      summary.problems = checkOnly ? [] : await verifySchema();
      const rebuildFailed = summary.rebuilds.some((r) =>
        ["refused", "failed-rolled-back", "committed-but-unverified", "damaged"].includes(r.outcome),
      );
      summary.ok = !checkOnly ? summary.problems.length === 0 && !rebuildFailed : true;
    } finally {
      releaseLock();
    }
  }

  console.log(JSON.stringify({ ...summary, verified: Object.keys(REQUIRED_SCHEMA) }, null, 2));
  if (!summary.ok) process.exitCode = 1;
} catch (error) {
  releaseLock();
  fail(`Migration failed: ${error instanceof Error ? error.message : String(error)}`, {
    hint: "Re-run with --verify to inspect the current state. For a partial rebuild, restore from the verified backup; see docs/DATABASE-RECOVERY-RUNBOOK.md.",
  });
} finally {
  releaseLock();
  try { client.close(); } catch { /* already closed */ }
}
