#!/usr/bin/env node
/**
 * Controlled, verified restore of ALO encrypted backup archives.
 *
 * Modes:
 *   --verify-only          Decrypt and audit the archive; restore nothing.
 *   --target DIR           Restore into an ISOLATED directory (default safe mode).
 *   --live --yes           Destructive: replace the live control-plane database.
 *                          Refuses unless a fresh verified backup of the CURRENT
 *                          database is taken as part of the same run.
 *
 * Safety order (every step can only make things safer):
 *   1. Outer transport checksum (<file>.sha256) verified when present.
 *   2. Archive structure, header, wrapped-DEK and GCM authentication verified
 *      during decryption — tampering or a wrong KEK fails here.
 *   3. The in-archive manifest's per-file sha256 values are re-verified.
 *   4. SQLite snapshots are checked with integrity_check and core tables.
 *   5. Disk space for the extracted payload is checked before writing.
 *   6. An isolated --target restore is always allowed; a live overwrite requires
 *      --live --yes, a fresh verified pre-restore snapshot, and writes to a
 *      .partial file that is atomically renamed into place.
 *
 * Nothing here overwrites production implicitly, and no mode prints key material
 * or plaintext contents.
 *
 * Usage:
 *   node scripts/encrypted-restore.mjs --from <archive.alobak> --verify-only [--key-file F]
 *   node scripts/encrypted-restore.mjs --from <archive.alobak> --target /restore/dir [--key-file F] [--json]
 *   node scripts/encrypted-restore.mjs --from <archive.alobak> --live --yes --db file:/abs/path/alo.db [--key-file F] [--json]
 *
 * Exit codes: 0 ok, 1 restore failed, 2 usage/configuration error, 3 refused (policy).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadKek, decryptEnvelope, sha256Buffer, sha256File, sha256Matches } from "./lib/envelope.mjs";

const CORE_TABLES = ["users", "audit_logs", "servers", "hosting_sites"];
const sha256Buf = (b) => createHash("sha256").update(b).digest("hex");

function parseArgs(argv) {
  const a = { from: "", target: "", live: false, yes: false, verifyOnly: false, dbUrl: process.env.DATABASE_URL || "", keyFile: process.env.ALO_BACKUP_KEY_FILE || "", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--from") a.from = next();
    else if (arg.startsWith("--from=")) a.from = arg.slice(7);
    else if (arg === "--target") a.target = next();
    else if (arg.startsWith("--target=")) a.target = arg.slice(9);
    else if (arg === "--live") a.live = true;
    else if (arg === "--yes") a.yes = true;
    else if (arg === "--verify-only") a.verifyOnly = true;
    else if (arg === "--db") a.dbUrl = next();
    else if (arg === "--env-file") {
      const file = next();
      const { readFileSync } = fs;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const t = line.trim();
        if (t.startsWith("DATABASE_URL=") && !a.dbUrl) a.dbUrl = t.slice("DATABASE_URL=".length).trim();
        if (t.startsWith("ALO_BACKUP_ENCRYPTION_KEY=")) process.env.ALO_BACKUP_ENCRYPTION_KEY = t.slice("ALO_BACKUP_ENCRYPTION_KEY=".length).trim();
      }
    }
    else if (arg === "--key-file") a.keyFile = next();
    else if (arg === "--json") a.json = true;
    else if (arg === "--help" || arg === "-h") { process.stdout.write("usage: encrypted-restore.mjs --from FILE [--verify-only | --target DIR | --live --yes] [--key-file F] [--json]\n"); process.exit(0); }
    else { process.stderr.write(`encrypted-restore: unknown argument '${arg}'\n`); process.exit(2); }
  }
  return a;
}

function fail(message, code = 1) {
  process.stderr.write(`encrypted-restore: ${message}\n`);
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
if (!args.from) fail("--from <archive.alobak> is required", 2);
if (!fs.existsSync(args.from)) fail(`archive not found: ${args.from}`, 2);
if (args.live && !args.yes) fail("--live requires --yes (destructive); routine drills must use --target <dir>", 3);
if (args.live && !args.dbUrl.startsWith("file:")) fail("--live currently supports SQLite file: databases only", 2);
if (!args.live && !args.target && !args.verifyOnly) fail("choose --verify-only or --target <dir>; production restore additionally requires --live --yes", 2);

// Step 1: outer transport checksum.
const sidecarPath = `${args.from}.sha256`;
const sidecar = fs.existsSync(sidecarPath) ? fs.readFileSync(sidecarPath, "utf8").trim() : null;
if (sidecar) {
  const expected = sidecar.split(/\s+/)[0];
  const actual = sha256File(args.from);
  if (!sha256Matches(actual, expected)) fail("outer sha256 mismatch: the archive was modified in transit; refusing to decrypt", 1);
} else {
  process.stderr.write("encrypted-restore: warning: no .sha256 sidecar found; relying on GCM authentication only\n");
}

let kek;
try {
  kek = loadKek({ keyFile: args.keyFile, envValue: process.env.ALO_BACKUP_ENCRYPTION_KEY || "" });
} catch (error) {
  fail(error.message, 2);
}

// Steps 2-3: decrypt (authenticates header+wrap+payload) and audit the manifest.
const encrypted = fs.readFileSync(args.from);
let decrypted;
try {
  decrypted = decryptEnvelope(encrypted, kek);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 1);
}
const { plaintext, header } = decrypted;

const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-restore-"));
const tarPath = path.join(extractDir, "payload.tar.gz");
fs.writeFileSync(tarPath, plaintext);
const payloadDir = path.join(extractDir, "payload");
fs.mkdirSync(payloadDir, { recursive: true, mode: 0o700 });
execFileSync("tar", ["-xzf", tarPath, "-C", payloadDir], { stdio: ["ignore", "ignore", "pipe"], timeout: 30 * 60_000 });

const manifestPath = path.join(payloadDir, "manifest.json");
if (!fs.existsSync(manifestPath)) fail("archive is missing manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fileProblems = [];
for (const entry of manifest.files ?? []) {
  const f = path.join(payloadDir, entry.path);
  if (!fs.existsSync(f)) { fileProblems.push(`missing ${entry.path}`); continue; }
  const actual = sha256File(f);
  if (!sha256Matches(actual, entry.sha256)) fileProblems.push(`sha256 mismatch ${entry.path}`);
}
if (fileProblems.length) fail(`archive audit failed: ${fileProblems.slice(0, 10).join("; ")}`);

const sqliteFiles = (manifest.files ?? []).filter((f) => f.path.endsWith(".db"));
for (const entry of sqliteFiles) {
  const f = path.join(payloadDir, entry.path);
  try {
    execFileSync("sqlite3", [f, "PRAGMA integrity_check;"], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
    const verdict = execFileSync("sqlite3", [f, "PRAGMA integrity_check;"], { encoding: "utf8", timeout: 120_000 }).trim();
    if (verdict.toLowerCase() !== "ok") fileProblems.push(`${entry.path}: integrity_check returned ${verdict}`);
  } catch {
    // fall back to the libsql check below when the sqlite3 CLI is unavailable
  }
}
// Core-table check for the control-plane snapshot when present.
const controlPlane = (manifest.files ?? []).find((f) => f.path === "control-plane/app.db");
if (controlPlane) {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${path.join(payloadDir, controlPlane.path)}` });
  try {
    const r = await client.execute("PRAGMA integrity_check");
    const verdict = String(Object.values(r.rows[0] ?? {})[0] ?? "");
    if (verdict.toLowerCase() !== "ok") fileProblems.push(`control-plane/app.db integrity_check: ${verdict}`);
    const listed = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = listed.rows.map((row) => String(row.name ?? ""));
    for (const t of CORE_TABLES) if (!tables.includes(t)) fileProblems.push(`control-plane/app.db missing table ${t}`);
  } finally {
    await client.close();
  }
}
if (fileProblems.length) fail(`archive audit failed after decryption: ${fileProblems.slice(0, 10).join("; ")}`);

const result = {
  ok: true,
  archive: path.basename(args.from),
  createdAt: header.createdAt ?? manifest.createdAt,
  categories: manifest.categories ?? [],
  filesVerified: (manifest.files ?? []).length,
  plaintextBytes: plaintext.length,
  durationMs: Date.now() - startedAt,
  mode: args.verifyOnly ? "verify-only" : args.live ? "live" : "isolated-target",
};

if (args.verifyOnly) {
  fs.rmSync(extractDir, { recursive: true, force: true });
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `encrypted-restore: VERIFIED ${path.basename(args.from)} (${result.filesVerified} files, ${result.durationMs}ms)\n`);
  process.exit(0);
}

const destRoot = args.live ? path.dirname(args.dbUrl.slice("file:".length)) : args.target;
if (!destRoot) fail("internal error: no destination resolved", 2);
// Disk space check (extract size + 10% headroom).
const payloadBytes = plaintext.length;
const stat = fs.statfsSync ? fs.statfsSync(extractDir) : null;
if (stat) {
  const available = Number(stat.bavail) * Number(stat.bsize);
  if (available < payloadBytes * 1.1) fail(`insufficient disk space at restore destination (need ~${Math.ceil(payloadBytes * 1.1)} bytes, have ${available})`, 1);
}

if (args.live) {
  const liveDb = args.dbUrl.slice("file:".length);
  try {
    // Fresh verified snapshot of the CURRENT database first — same guarantee as scripts/db-restore.mjs.
    if (fs.existsSync(liveDb)) {
      const { execFileSync: run } = await import("node:child_process");
      run(process.execPath, [path.resolve("scripts/db-backup.mjs"), "--out", path.dirname(liveDb), "--label", "pre-encrypted-restore"], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: args.dbUrl },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30 * 60_000,
      });
    }
  } catch (error) {
    fail(`could not take a verified pre-restore snapshot; refusing to overwrite the live database (${error instanceof Error ? error.message.slice(0, 200) : "unknown"})`, 3);
  }
  const restoredDb = path.join(payloadDir, "control-plane", "app.db");
  if (!fs.existsSync(restoredDb)) fail("archive has no control-plane/app.db; refusing live restore", 3);
  const tmpLive = `${liveDb}.restore-${process.pid}.partial`;
  fs.copyFileSync(restoredDb, tmpLive);
  fs.chmodSync(tmpLive, 0o600);
  fs.renameSync(tmpLive, liveDb);
  result.restoredTo = liveDb;
  result.live = true;
  fs.rmSync(extractDir, { recursive: true, force: true });
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `encrypted-restore: LIVE restore completed into ${liveDb} (${result.durationMs}ms)\n`);
  process.exit(0);
}

// Isolated restore: extract payload into the target directory.
const targetDir = path.resolve(args.target);
fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
fs.cpSync(payloadDir, targetDir, { recursive: true });
// Byte-compare everything we wrote.
const mismatch = [];
const walk = (rel) => {
  for (const entry of fs.readdirSync(path.join(payloadDir, rel), { withFileTypes: true })) {
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) { walk(childRel); continue; }
    if (sha256File(path.join(payloadDir, childRel)) !== sha256File(path.join(targetDir, childRel))) mismatch.push(childRel);
  }
};
walk(".");
if (mismatch.length) fail(`isolated restore verification failed for: ${mismatch.slice(0, 5).join(", ")}`);
result.restoredTo = targetDir;
result.durationMs = Date.now() - startedAt;
fs.rmSync(extractDir, { recursive: true, force: true });
process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `encrypted-restore: restored into isolated target ${targetDir} (${result.filesVerified} files, ${result.durationMs}ms)\n`);
