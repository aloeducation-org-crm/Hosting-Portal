#!/usr/bin/env node
/**
 * Restore a database snapshot — safely, and provably.
 *
 * scripts/restore.sh used to run `psql "$DATABASE_URL" < file.sql` after a single
 * "yes/no" prompt, against a host whose database is SQLite. It also had no way to
 * rehearse a restore, so the only way to find out whether a backup was usable was
 * to overwrite production with it.
 *
 * This script restores in this order, and refuses at every step that cannot be
 * proven:
 *
 *   1. verify the snapshot is a SQLite database, passes `PRAGMA integrity_check`
 *      and contains the tables the application needs;
 *   2. restore into an isolated target (a drill) by default — `--target` — which
 *      is how a backup is proven without touching production;
 *   3. only overwrite the *live* database when `--yes` is given AND a verified
 *      snapshot of the current database has just been taken, so "restore" cannot
 *      be the step that destroys the last good copy.
 *
 * It never prints DATABASE_URL, and never prints table data.
 *
 * Usage:
 *   node scripts/db-restore.mjs --from /backups/hosting-….db --target /tmp/drill.db
 *   node scripts/db-restore.mjs --from /backups/hosting-….db --verify-only
 *   node scripts/db-restore.mjs --from /backups/hosting-….db --yes     # production
 *
 * Exit codes: 0 ok, 1 restore failed, 2 refused / usage error.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CORE_TABLES = ["users", "audit_logs", "servers", "hosting_sites"];

function parseArgs(argv) {
  const args = {
    from: "",
    target: "",
    dbUrl: process.env.DATABASE_URL || "",
    envFile: "",
    yes: false,
    verifyOnly: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--from") args.from = next();
    else if (arg === "--target") args.target = next();
    else if (arg === "--db") args.dbUrl = next();
    else if (arg === "--env-file") args.envFile = next();
    else if (arg === "--yes" || arg === "--confirm") args.yes = true;
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "usage: db-restore.mjs --from <backup> [--target <path>] [--yes] [--verify-only] [--db <url>] [--env-file <path>] [--json]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`db-restore: unknown argument '${arg}'\n`);
      process.exit(2);
    }
  }
  return args;
}

function readEnvFile(file) {
  const out = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function refuse(message) {
  process.stderr.write(`db-restore: REFUSED: ${message}\n`);
  process.exit(2);
}

function fail(message) {
  process.stderr.write(`db-restore: ${message}\n`);
  process.exit(1);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function client(url) {
  const { createClient } = await import("@libsql/client");
  return createClient({ url });
}

/** Verify a SQLite snapshot: header, integrity_check, and the tables we need. */
async function verifySnapshot(file) {
  const problems = [];
  if (!fs.existsSync(file)) return { ok: false, problems: ["file does not exist"], tables: [] };
  if (fs.statSync(file).size === 0) return { ok: false, problems: ["file is empty"], tables: [] };

  const header = Buffer.alloc(16);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString("latin1") !== "SQLite format 3\u0000") problems.push("not a SQLite database (header mismatch)");

  let tables = [];
  if (problems.length === 0) {
    try {
      const db = await client(`file:${file}`);
      try {
        const integrity = await db.execute("PRAGMA integrity_check");
        const verdict = String(Object.values(integrity.rows[0] ?? {})[0] ?? "");
        if (verdict.toLowerCase() !== "ok") problems.push(`integrity_check returned "${verdict}"`);
        const listed = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
        tables = listed.rows.map((row) => String(row.name ?? Object.values(row)[0] ?? ""));
        for (const table of CORE_TABLES) {
          if (!tables.includes(table)) problems.push(`required table "${table}" is missing`);
        }
      } finally {
        await db.close();
      }
    } catch (error) {
      problems.push(`could not read the snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: problems.length === 0, problems, tables };
}

/** Replace `target` with `source` atomically, never writing over a live path. */
async function replaceSqlite(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = `${target}.restoring-${process.pid}`;
  fs.rmSync(staging, { force: true });
  fs.copyFileSync(source, staging);
  fs.chmodSync(staging, 0o640);
  const staged = await verifySnapshot(staging);
  if (!staged.ok) {
    fs.rmSync(staging, { force: true });
    fail(`the copy written to the restore target failed verification (${staged.problems.join("; ")})`);
  }
  fs.renameSync(staging, target);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile) {
    const fileEnv = readEnvFile(args.envFile);
    args.dbUrl = args.dbUrl || fileEnv.DATABASE_URL || "";
  }
  if (!args.from) refuse("--from <backup file> is required");

  const isSqlite = !args.dbUrl || args.dbUrl.startsWith("file:");
  const productionTarget = args.dbUrl.startsWith("file:") ? args.dbUrl.slice("file:".length) : "";

  // ── 1. Prove the snapshot before anything is replaced ─────────────────────
  let snapshot;
  if (isSqlite) {
    snapshot = await verifySnapshot(args.from);
    if (!snapshot.ok) refuse(`the snapshot is not restorable: ${snapshot.problems.join("; ")}`);
  } else {
    if (!fs.existsSync(args.from) || fs.statSync(args.from).size === 0) refuse("the snapshot is missing or empty");
    snapshot = { ok: true, problems: [], tables: [] };
  }

  if (args.verifyOnly) {
    const payload = { success: true, verified: true, tables: snapshot.tables, sha256: sha256(args.from) };
    process.stdout.write(args.json ? `${JSON.stringify(payload)}\n` : `db-restore: snapshot verified (${snapshot.tables.length} tables)\n`);
    return;
  }

  const target = args.target ? path.resolve(args.target) : productionTarget;
  if (!target) refuse("no restore target: pass --target <path> or configure DATABASE_URL=file:/absolute/path");
  const overwritesProduction = Boolean(productionTarget) && path.resolve(productionTarget) === target;

  // ── 2. A drill (isolated target) needs no further authorization ────────────
  if (!overwritesProduction) {
    await replaceSqlite(args.from, target);
    process.stdout.write(
      `${JSON.stringify({ success: true, verified: true, restoredTo: target, production: false, sha256: sha256(args.from) })}\n`,
    );
    return;
  }

  // ── 3. Overwriting the live database requires --yes and a fresh safety copy ─
  if (!args.yes) {
    refuse(
      "this target is the live database. Rehearse first with --target <isolated path>, then re-run with --yes. " +
        "Stop the panel (pm2 stop alo-hosting-portal) before restoring into production.",
    );
  }

  const safety = `${productionTarget}.pre-restore-${timestamp()}.db`;
  const db = await client(`file:${productionTarget}`);
  try {
    await db.execute({ sql: "VACUUM INTO ?", args: [safety] });
  } finally {
    await db.close();
  }
  fs.chmodSync(safety, 0o600);
  const safetyCheck = await verifySnapshot(safety);
  if (!safetyCheck.ok) {
    refuse(
      `a verified snapshot of the current database could not be taken (${safetyCheck.problems.join("; ")}); refusing to overwrite the only good copy`,
    );
  }

  await replaceSqlite(args.from, productionTarget);
  process.stdout.write(
    `${JSON.stringify({
      success: true,
      verified: true,
      restoredTo: productionTarget,
      production: true,
      safetySnapshot: safety,
      sha256: sha256(args.from),
      nextStep: "start the panel (pm2 restart alo-hosting-portal) and check /api/health",
    })}\n`,
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
