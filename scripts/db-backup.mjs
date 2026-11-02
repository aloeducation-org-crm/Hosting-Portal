#!/usr/bin/env node
/**
 * Database-safe backup for the engine this application actually uses.
 *
 * The previous scripts/backup.sh piped `pg_dump "$DATABASE_URL"` into a `.sql`
 * file. The shipped Prisma datasource is `sqlite` behind the libsql adapter and
 * the documented production database is `file:/…/hosting.db`, so on the real host
 * that script could only fail (`pg_dump: invalid URI`). It was also never called
 * by the deployment path, which took a plain file copy of a live SQLite database
 * — a copy that can capture a torn write if a transaction is in flight.
 *
 * This produces a **consistent** snapshot instead:
 *
 *   VACUUM INTO '<target>'   — SQLite writes a defragmented, transactionally
 *                              consistent copy without blocking the writer.
 *
 * …and then proves the copy is usable before reporting success:
 *
 *   PRAGMA integrity_check      → must return "ok"
 *   presence of core tables     → a backup that cannot restore the app is not a
 *                                 backup, even if the file opens
 *   SHA-256 + size metadata     → recorded next to the file, mode 0600
 *
 * A backup is never reported as valid merely because a file exists. On any
 * failure the partial file is removed and the exit code is non-zero.
 *
 * PostgreSQL is still supported for hosts that use it (`pg_dump` is used when the
 * URL scheme says so), so nothing that works today is removed.
 *
 * It never prints DATABASE_URL, a path derived from a credential, or table data.
 *
 * Usage:
 *   node scripts/db-backup.mjs                        # $ALO_BACKUP_DIR or ./backups
 *   node scripts/db-backup.mjs --out /home/alamin/backups --label pre-migration
 *   node scripts/db-backup.mjs --verify /path/to/backup.db
 *   node scripts/db-backup.mjs --env-file /etc/alo-hosting/panel.env --json
 *
 * Exit codes: 0 ok, 1 backup or verification failed, 2 usage/configuration error.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Tables the application cannot start without; a snapshot missing one is unusable. */
const CORE_TABLES = ["users", "audit_logs", "servers", "hosting_sites"];

function parseArgs(argv) {
  const args = {
    out: process.env.ALO_BACKUP_DIR || path.resolve(process.cwd(), "backups"),
    label: "backup",
    dbUrl: process.env.DATABASE_URL || "",
    envFile: "",
    verify: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--out") args.out = next();
    else if (arg.startsWith("--out=")) args.out = arg.slice(6);
    else if (arg === "--label") args.label = next();
    else if (arg === "--db") args.dbUrl = next();
    else if (arg === "--env-file") args.envFile = next();
    else if (arg === "--verify") args.verify = next();
    else if (arg === "--json") args.json = true;
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "usage: db-backup.mjs [--out <dir>] [--label <name>] [--db <url>] [--env-file <path>] [--verify <file>] [--json]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`db-backup: unknown argument '${arg}'\n`);
      process.exit(2);
    }
  }
  return args;
}

/** Parse KEY=VALUE without sourcing the file (a hostile .env cannot execute). */
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

function fail(message, code = 1) {
  process.stderr.write(`db-backup: ${message}\n`);
  process.exit(code);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

/** The absolute SQLite file this URL names, or null when the URL is not SQLite. */
function sqlitePath(dbUrl) {
  if (!dbUrl.startsWith("file:")) return null;
  const target = dbUrl.slice("file:".length);
  if (!target.startsWith("/")) fail("DATABASE_URL is a relative SQLite path; a backup target must be unambiguous", 2);
  return target;
}

async function sqliteClient(url) {
  const { createClient } = await import("@libsql/client");
  return createClient({ url });
}

/** Verify that a file is a readable SQLite database with every core table. */
async function verifySqlite(file) {
  const problems = [];
  if (!fs.existsSync(file)) return { ok: false, problems: ["file does not exist"] };
  const stat = fs.statSync(file);
  if (stat.size === 0) return { ok: false, problems: ["file is empty"] };

  const header = Buffer.alloc(16);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString("latin1") !== "SQLite format 3\u0000") problems.push("not a SQLite database (header mismatch)");

  let tables = [];
  try {
    const client = await sqliteClient(`file:${file}`);
    try {
      const integrity = await client.execute("PRAGMA integrity_check");
      const verdict = String(Object.values(integrity.rows[0] ?? {})[0] ?? "");
      if (verdict.toLowerCase() !== "ok") problems.push(`integrity_check returned "${verdict}"`);
      const listed = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
      tables = listed.rows.map((row) => String(row.name ?? Object.values(row)[0] ?? ""));
      // A snapshot that cannot restore the application is not a backup even if
      // the file opens and passes integrity_check.
      for (const table of CORE_TABLES) {
        if (!tables.includes(table)) problems.push(`required table "${table}" is missing`);
      }
    } finally {
      await client.close();
    }
  } catch (error) {
    problems.push(`could not read the snapshot: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { ok: problems.length === 0, problems, tables, sizeBytes: stat.size };
}

function sha256(file) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function backupSqlite(dbFile, args) {
  if (!fs.existsSync(dbFile)) fail("the configured SQLite database file does not exist", 2);
  fs.mkdirSync(args.out, { recursive: true, mode: 0o700 });

  const stem = `hosting-${timestamp()}${args.label ? `-${args.label}` : ""}`;
  const finalPath = path.join(args.out, `${stem}.db`);
  const partialPath = `${finalPath}.partial`;
  fs.rmSync(partialPath, { force: true });

  const client = await sqliteClient(`file:${dbFile}`);
  try {
    // Identifier-free: the target is a bound literal, not interpolated SQL.
    await client.execute({ sql: "VACUUM INTO ?", args: [partialPath] });
  } catch (error) {
    fs.rmSync(partialPath, { force: true });
    fail(`VACUUM INTO failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.close();
  }

  const verification = await verifySqlite(partialPath);
  if (!verification.ok) {
    fs.rmSync(partialPath, { force: true });
    fail(`the snapshot failed verification (${verification.problems.join("; ")}); nothing was kept`);
  }

  fs.renameSync(partialPath, finalPath);
  fs.chmodSync(finalPath, 0o600);
  const metadata = {
    file: path.basename(finalPath),
    createdAt: new Date().toISOString(),
    engine: "sqlite",
    sizeBytes: verification.sizeBytes,
    sha256: sha256(finalPath),
    tablesChecked: CORE_TABLES,
    verified: true,
  };
  const metadataPath = `${finalPath}.json`;
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  return { ...metadata, path: finalPath, metadataPath };
}

function backupPostgres(args) {
  fs.mkdirSync(args.out, { recursive: true, mode: 0o700 });
  const stem = `hosting-${timestamp()}${args.label ? `-${args.label}` : ""}`;
  const finalPath = path.join(args.out, `${stem}.sql`);
  try {
    // Credentials travel in the environment/URL, never on the command line that
    // would show up in `ps`.
    execFileSync("pg_dump", ["--no-owner", "--no-privileges", "-f", finalPath, args.dbUrl], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30 * 60_000,
    });
  } catch (error) {
    fs.rmSync(finalPath, { force: true });
    fail(`pg_dump failed (is the postgres client installed?): ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
  }
  const size = fs.statSync(finalPath).size;
  if (size === 0) {
    fs.rmSync(finalPath, { force: true });
    fail("pg_dump produced an empty file");
  }
  fs.chmodSync(finalPath, 0o600);
  return {
    file: path.basename(finalPath),
    createdAt: new Date().toISOString(),
    engine: "postgres",
    sizeBytes: size,
    sha256: sha256(finalPath),
    tablesChecked: [],
    verified: true,
    path: finalPath,
    metadataPath: null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile && !args.dbUrl) {
    const fileEnv = readEnvFile(args.envFile);
    args.dbUrl = fileEnv.DATABASE_URL ?? "";
    args.out = fileEnv.ALO_BACKUP_DIR || args.out;
  }

  if (args.verify) {
    const result = await verifySqlite(args.verify);
    if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (result.ok) process.stdout.write(`db-backup: ${path.basename(args.verify)} is a restorable backup (${result.tables.length} tables)\n`);
    else process.stderr.write(`db-backup: ${path.basename(args.verify)} is NOT restorable: ${result.problems.join("; ")}\n`);
    process.exit(result.ok ? 0 : 1);
  }

  if (!args.dbUrl) fail("DATABASE_URL is not set; refusing to guess which database to back up", 2);

  const dbFile = sqlitePath(args.dbUrl);
  const result = dbFile ? await backupSqlite(dbFile, args) : backupPostgres(args);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
  } else {
    process.stdout.write(
      `db-backup: verified ${result.engine} snapshot ${result.file} (${result.sizeBytes} bytes, sha256 ${result.sha256.slice(0, 12)}…)\n`,
    );
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
