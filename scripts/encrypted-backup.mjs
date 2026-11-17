#!/usr/bin/env node
/**
 * Encrypted, verified, retention-aware backup for the ALO Hosting Portal.
 *
 * Categories (staged under <staging>/<category>/, packed into one archive):
 *   control-plane     SQLite VACUUM INTO snapshot of the panel database (DATABASE_URL)
 *   customer-db       Snapshot of ONE customer database (--customer-db-url; separate run)
 *   application-data  A directory tree of application persistent data (--application-data-dir)
 *   artifacts         A directory tree of deployment artifacts (--artifacts-dir)
 *   uploads           A directory tree of customer uploads (--uploads-dir)
 *   config            Explicitly listed non-secret config files (--config-file, repeatable).
 *                     Any path whose basename looks secret (.env*, *secret*, *token*,
 *                     *key*, *.pem, *.key, *credential*) is REFUSED, always.
 *   infrastructure    Explicitly listed infra files (--infrastructure-file, repeatable),
 *                     same secret denylist as config.
 *   audit             JSONL export of the audit_logs table (default on when readable;
 *                     disable with --skip-audit)
 *
 * Properties:
 *   - AES-256-GCM envelope encryption (scripts/lib/envelope.mjs). KEK from
 *     ALO_BACKUP_ENCRYPTION_KEY or --key-file (mode 0600 enforced). Never logged.
 *   - Every staged file is sha256'd into the in-archive manifest; the archive is
 *     verified by decrypting it after encryption and re-checking those hashes.
 *   - Atomic finalize: written to .partial, verified, then renamed. A failed run
 *     never replaces the last valid backup.
 *   - Lock file prevents duplicate concurrent scheduled runs (stale locks are
 *     detected by pid liveness and a max age).
 *   - Retention: keep the newest N verified backups (--keep, default
 *     BACKUP_RETENTION_COUNT or 14). Pruning happens ONLY after the new backup is
 *     verified, and never removes the single newest valid backup.
 *   - Outer transport integrity: <file>.sha256 sidecar + <file>.manifest.json
 *     (non-secret summary) next to the archive.
 *   - Status: <out>/backup-status.json — lastSuccess/lastFailure/durationMs/
 *     sizeBytes/counts. Feed it to your alerting (docs/DISASTER-RECOVERY.md §7).
 *   - --offsite-dir <dir>: after local verification, copy archive+sidecars and
 *     re-verify sha256 at the destination; prune destination with the same policy.
 *     A second folder on the same disk is NOT offsite — point this at a mounted
 *     remote (sshfs/rclone mount) or copy to the approved destination afterwards.
 *
 * Usage:
 *   node scripts/encrypted-backup.mjs [--out DIR] [--label NAME] [--keep N]
 *       [--category control-plane|customer-db|application-data|artifacts|uploads|config|infrastructure|audit] ...
 *       [--customer-db-url URL] [--application-data-dir DIR] [--artifacts-dir DIR]
 *       [--uploads-dir DIR] [--config-file FILE]... [--infrastructure-file FILE]...
 *       [--skip-audit] [--db URL] [--env-file FILE] [--key-file FILE] [--offsite-dir DIR]
 *       [--json] [--status]
 *
 * Exit codes: 0 ok, 1 backup/verification failed, 2 usage/configuration error, 3 nothing to back up.
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadKek, encryptEnvelope, decryptEnvelope, sha256Buffer, sha256File, sha256Matches } from "./lib/envelope.mjs";

const TOOL_VERSION = "1.0.0";
const MAGIC_NOTE = "ALO encrypted backup archive — decrypt with scripts/encrypted-restore.mjs";
const CORE_TABLES = ["users", "audit_logs", "servers", "hosting_sites"];
const SECRET_NAME = /(\.env(\.|$)|secret|token|credential|\.pem$|\.key$|id_rsa|\.p12$)/i;
const DEFAULT_KEEP = Number(process.env.BACKUP_RETENTION_COUNT ?? 14) || 14;

function parseArgs(argv) {
  const a = {
    out: process.env.ALO_BACKUP_DIR || path.resolve(process.cwd(), "backups"),
    label: "backup",
    keep: DEFAULT_KEEP,
    dbUrl: process.env.DATABASE_URL || "",
    envFile: "",
    keyFile: process.env.ALO_BACKUP_KEY_FILE || "",
    categories: [],
    customerDbUrl: "",
    applicationDataDir: "",
    artifactsDir: "",
    uploadsDir: "",
    configFiles: [],
    infrastructureFiles: [],
    skipAudit: false,
    offsiteDir: "",
    kekId: process.env.ALO_BACKUP_KEK_ID || "kek-1",
    json: false,
    status: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--out") a.out = next();
    else if (arg.startsWith("--out=")) a.out = arg.slice(6);
    else if (arg === "--label") a.label = next();
    else if (arg.startsWith("--label=")) a.label = arg.slice(8);
    else if (arg === "--keep") a.keep = Number(next());
    else if (arg.startsWith("--keep=")) a.keep = Number(arg.slice(7));
    else if (arg === "--db") a.dbUrl = next();
    else if (arg === "--env-file") a.envFile = next();
    else if (arg === "--key-file") a.keyFile = next();
    else if (arg === "--category") a.categories.push(next());
    else if (arg.startsWith("--category=")) a.categories.push(arg.slice(11));
    else if (arg === "--customer-db-url") a.customerDbUrl = next();
    else if (arg === "--application-data-dir") a.applicationDataDir = next();
    else if (arg === "--artifacts-dir") a.artifactsDir = next();
    else if (arg === "--uploads-dir") a.uploadsDir = next();
    else if (arg === "--config-file") a.configFiles.push(next());
    else if (arg === "--infrastructure-file") a.infrastructureFiles.push(next());
    else if (arg === "--skip-audit") a.skipAudit = true;
    else if (arg === "--offsite-dir") a.offsiteDir = next();
    else if (arg === "--kek-id") a.kekId = next();
    else if (arg.startsWith("--kek-id=")) a.kekId = arg.slice(9);
    else if (arg === "--json") a.json = true;
    else if (arg === "--status") a.status = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("usage: encrypted-backup.mjs [--out DIR] [--label NAME] [--keep N] [--category CAT]... [--json] [--status]\n");
      process.exit(0);
    } else {
      process.stderr.write(`encrypted-backup: unknown argument '${arg}'\n`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(a.keep) || a.keep < 1) {
    process.stderr.write("encrypted-backup: --keep must be a positive integer\n");
    process.exit(2);
  }
  return a;
}

function readEnvFile(file) {
  const out = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function fail(message, code = 1) {
  process.stderr.write(`encrypted-backup: ${message}\n`);
  process.exit(code);
}

const nowStamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
const sha256Buf = (b) => createHash("sha256").update(b).digest("hex");

function sqlitePath(dbUrl) {
  if (!dbUrl.startsWith("file:")) return null;
  const target = dbUrl.slice("file:".length);
  if (!path.isAbsolute(target)) fail("DATABASE_URL is a relative SQLite path; backups need an absolute path", 2);
  return target;
}

async function snapshotSqlite(dbPath, destFile) {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${dbPath}` });
  try {
    await client.execute({ sql: "VACUUM INTO ?", args: [destFile] });
  } finally {
    await client.close();
  }
}

async function verifySqlite(file) {
  const problems = [];
  const sizeBytes = fs.statSync(file).size;
  const header = Buffer.alloc(16);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (header.toString("latin1") !== "SQLite format 3\u0000") problems.push("not a SQLite database");
  try {
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: `file:${file}` });
    try {
      const r = await client.execute("PRAGMA integrity_check");
      const verdict = String(Object.values(r.rows[0] ?? {})[0] ?? "");
      if (verdict.toLowerCase() !== "ok") problems.push(`integrity_check: ${verdict}`);
      const listed = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
      const tables = listed.rows.map((row) => String(row.name ?? ""));
      for (const t of CORE_TABLES) if (!tables.includes(t)) problems.push(`required table "${t}" missing`);
    } finally { await client.close(); }
  } catch (error) {
    problems.push(`unreadable snapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { problems, sizeBytes };
}

function denySecretFiles(files, kind) {
  for (const f of files) {
    const base = path.basename(f);
    if (SECRET_NAME.test(base)) {
      fail(`refusing to back up ${kind} file that looks secret by name: ${base} (secrets are never placed in backup archives)`, 2);
    }
    if (!fs.existsSync(f)) fail(`${kind} file not found: ${f}`, 2);
  }
}

function copyTree(srcDir, destDir, manifest, category) {
  if (!fs.existsSync(srcDir)) fail(`${category} directory not found: ${srcDir}`, 2);
  let count = 0;
  const walk = (rel) => {
    const from = path.join(srcDir, rel);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const childRel = rel === "." ? entry.name : `${rel}/${entry.name}`;
      const childFrom = path.join(srcDir, childRel);
      if (SECRET_NAME.test(entry.name)) {
        manifest.skipped.push({ category, path: `${category}/${childRel}`, reason: "secret-by-name" });
        continue;
      }
      if (entry.isDirectory()) { walk(childRel); continue; }
      if (!entry.isFile()) continue;
      const dest = path.join(destDir, childRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      fs.copyFileSync(childFrom, dest);
      const size = fs.statSync(dest).size;
      // Manifest paths are always <category>/<relative-path> so the restore
      // audit can locate the staged file inside the archive payload.
      manifest.files.push({ category, path: `${category}/${childRel}`, size, sha256: sha256File(dest) });
      count += 1;
    }
  };
  walk(".");
  return count;
}

function acquireLock(lockPath) {
  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.closeSync(fd);
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const st = fs.statSync(lockPath);
      const ageMs = Date.now() - st.mtimeMs;
      let stale = ageMs > 6 * 3600_000;
      try {
        const holder = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        try { process.kill(holder.pid, 0); stale = false; } catch (e) { if (e.code === "EPERM") stale = false; }
      } catch { /* unreadable lock: fall back to age */ }
      if (!stale) fail("another backup run is in progress (lock held); refusing to duplicate it", 3);
      fs.rmSync(lockPath, { force: true });
      return acquireLock(lockPath);
    } catch (nested) {
      if (nested instanceof Error && nested.message.startsWith("another backup")) throw nested;
      fail("could not evaluate the backup lock; refusing to proceed", 3);
    }
  }
}

function updateStatus(statusPath, patch) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(statusPath, "utf8")); } catch { /* first run */ }
  const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const tmp = `${statusPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, statusPath);
  return merged;
}

function prune(outDir, keep, protectedFile) {
  const entries = fs.readdirSync(outDir)
    .filter((n) => n.endsWith(".alobak"))
    .map((n) => ({ name: n, file: path.join(outDir, n), mtime: fs.statSync(path.join(outDir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  let removed = 0;
  for (let i = keep; i < entries.length; i += 1) {
    if (entries[i].file === protectedFile) continue;
    for (const ext of [".alobak", ".sha256", ".manifest.json"]) {
      fs.rmSync(path.join(outDir, entries[i].name.replace(/\.alobak$/, ext)), { force: true });
    }
    removed += 1;
  }
  return removed;
}

const args = parseArgs(process.argv.slice(2));
if (args.envFile) {
  const fromFile = readEnvFile(args.envFile);
  args.dbUrl = args.dbUrl || fromFile.DATABASE_URL || "";
  process.env.ALO_BACKUP_ENCRYPTION_KEY = process.env.ALO_BACKUP_ENCRYPTION_KEY || fromFile.ALO_BACKUP_ENCRYPTION_KEY || "";
}

const statusPath = path.join(args.out, "backup-status.json");
if (args.status) {
  if (!fs.existsSync(statusPath)) { process.stdout.write('{"lastSuccess":null,"lastFailure":null,"note":"no backups recorded yet"}\n'); process.exit(0); }
  process.stdout.write(fs.readFileSync(statusPath, "utf8"));
  process.exit(0);
}

const startedAt = Date.now();
fs.mkdirSync(args.out, { recursive: true, mode: 0o700 });
const lockPath = path.join(args.out, ".encrypted-backup.lock");
acquireLock(lockPath);
process.on("exit", () => { try { fs.rmSync(lockPath, { force: true }); } catch { /* best effort */ } });

let kek;
try {
  kek = loadKek({ keyFile: args.keyFile, envValue: process.env.ALO_BACKUP_ENCRYPTION_KEY || "" });
} catch (error) {
  fail(error.message, 2);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "alo-backup-"));
const stagingPayload = path.join(staging, "payload");
fs.mkdirSync(stagingPayload, { recursive: true, mode: 0o700 });

const manifest = {
  tool: "encrypted-backup.mjs",
  toolVersion: TOOL_VERSION,
  format: "alobak/1",
  createdAt: new Date().toISOString(),
  hostname: os.hostname(),
  categories: [],
  files: [],
  skipped: [],
  warnings: [],
};

// No explicit --category: back up the control plane plus every category whose source was provided.
const wanted = args.categories.length > 0
  ? new Set(args.categories)
  : new Set([
      "control-plane",
      ...(args.customerDbUrl ? ["customer-db"] : []),
      ...(args.applicationDataDir ? ["application-data"] : []),
      ...(args.artifactsDir ? ["artifacts"] : []),
      ...(args.uploadsDir ? ["uploads"] : []),
      ...(args.configFiles.length ? ["config"] : []),
      ...(args.infrastructureFiles.length ? ["infrastructure"] : []),
    ]);
const denySecretFilesList = (files, kind) => denySecretFiles(files, kind);

try {
  if (wanted.has("control-plane")) {
    const dbFile = sqlitePath(args.dbUrl);
    if (!dbFile) fail("control-plane backup currently supports SQLite file: URLs only (customer PostgreSQL/MariaDB uses pg_dump via customer-db category)", 2);
    if (!fs.existsSync(dbFile)) fail("the configured SQLite database file does not exist", 2);
    const dest = path.join(stagingPayload, "control-plane", "app.db");
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    await snapshotSqlite(dbFile, dest);
    const check = await verifySqlite(dest);
    if (check.problems.length) fail(`control-plane snapshot failed verification: ${check.problems.join("; ")}`);
    const buf = fs.readFileSync(dest);
    manifest.files.push({ category: "control-plane", path: "control-plane/app.db", size: buf.length, sha256: sha256Buf(buf) });
    manifest.categories.push("control-plane");
    if (!args.skipAudit) {
      try {
        const { createClient } = await import("@libsql/client");
        const client = createClient({ url: `file:${dbFile}` });
        try {
          const rows = await client.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 5000");
          const auditPath = path.join(stagingPayload, "audit", "audit_logs.jsonl");
          fs.mkdirSync(path.dirname(auditPath), { recursive: true, mode: 0o700 });
          const lines = rows.rows.map((r) => JSON.stringify(r));
          fs.writeFileSync(auditPath, lines.join("\n") + (lines.length ? "\n" : ""), { mode: 0o600 });
          const buf2 = fs.readFileSync(auditPath);
          manifest.files.push({ category: "audit", path: "audit/audit_logs.jsonl", size: buf2.length, sha256: sha256Buf(buf2), rows: rows.rows.length });
          manifest.categories.push("audit");
        } finally { await client.close(); }
      } catch (error) {
        manifest.warnings.push(`audit export skipped: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
      }
    }
  }
  if (wanted.has("customer-db")) {
    const url = args.customerDbUrl;
    if (!url) fail("--customer-db-url is required for the customer-db category", 2);
    const destDir = path.join(stagingPayload, "customer-db");
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    if (url.startsWith("file:")) {
      const dbFile = sqlitePath(url);
      if (!dbFile || !fs.existsSync(dbFile)) fail("customer-db SQLite file does not exist", 2);
      const dest = path.join(destDir, "customer.db");
      await snapshotSqlite(dbFile, dest);
      const buf = fs.readFileSync(dest);
      manifest.files.push({ category: "customer-db", path: "customer-db/customer.db", size: buf.length, sha256: sha256Buf(buf) });
      manifest.categories.push("customer-db");
    } else if (/^postgres(ql)?:\/\//.test(url)) {
      const dest = path.join(destDir, "customer.sql");
      execFileSync("pg_dump", ["--no-owner", "--no-privileges", "-f", dest, url], { stdio: ["ignore", "ignore", "pipe"], timeout: 30 * 60_000 });
      const buf = fs.readFileSync(dest);
      if (buf.length === 0) fail("pg_dump produced an empty file");
      manifest.files.push({ category: "customer-db", path: "customer-db/customer.sql", size: buf.length, sha256: sha256Buf(buf) });
      manifest.categories.push("customer-db");
    } else {
      fail("customer-db supports file: and postgres:// URLs only", 2);
    }
  }
  if (wanted.has("application-data")) {
    if (!args.applicationDataDir) fail("--application-data-dir is required for the application-data category", 2);
    copyTree(args.applicationDataDir, path.join(stagingPayload, "application-data"), manifest, "application-data");
    manifest.categories.push("application-data");
  }
  if (wanted.has("artifacts")) {
    if (!args.artifactsDir) fail("--artifacts-dir is required for the artifacts category", 2);
    copyTree(args.artifactsDir, path.join(stagingPayload, "artifacts"), manifest, "artifacts");
    manifest.categories.push("artifacts");
  }
  if (wanted.has("uploads")) {
    if (!args.uploadsDir) fail("--uploads-dir is required for the uploads category", 2);
    copyTree(args.uploadsDir, path.join(stagingPayload, "uploads"), manifest, "uploads");
    manifest.categories.push("uploads");
  }
  if (wanted.has("config")) {
    if (args.configFiles.length === 0) fail("--config-file is required for the config category (repeatable)", 2);
    denySecretFilesList(args.configFiles, "config");
    const destDir = path.join(stagingPayload, "config");
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    for (const f of args.configFiles) {
      const base = path.basename(f);
      const dest = path.join(destDir, base);
      fs.copyFileSync(f, dest);
      const buf = fs.readFileSync(dest);
      manifest.files.push({ category: "config", path: `config/${base}`, size: buf.length, sha256: sha256Buf(buf) });
    }
    manifest.categories.push("config");
  }
  if (wanted.has("infrastructure")) {
    if (args.infrastructureFiles.length === 0) fail("--infrastructure-file is required for the infrastructure category (repeatable)", 2);
    denySecretFilesList(args.infrastructureFiles, "infrastructure");
    const destDir = path.join(stagingPayload, "infrastructure");
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    for (const f of args.infrastructureFiles) {
      const base = path.basename(f);
      const dest = path.join(destDir, base);
      fs.copyFileSync(f, dest);
      const buf = fs.readFileSync(dest);
      manifest.files.push({ category: "infrastructure", path: `infrastructure/${base}`, size: buf.length, sha256: sha256Buf(buf) });
    }
    manifest.categories.push("infrastructure");
  }

  if (manifest.files.length === 0) {
    console.error(JSON.stringify({ ok: false, error: "nothing to back up", wanted: [...wanted] }));
    process.exit(3);
  }
  manifest.totals = { files: manifest.files.length, bytes: manifest.files.reduce((n, f) => n + f.size, 0) };
  fs.writeFileSync(path.join(stagingPayload, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  // Pack.
  const tarPath = path.join(staging, "payload.tar.gz");
  execFileSync("tar", ["-czf", tarPath, "-C", stagingPayload, "."], { stdio: ["ignore", "ignore", "pipe"], timeout: 30 * 60_000 });
  const plaintext = fs.readFileSync(tarPath);

  // Encrypt and immediately prove we can decrypt what we wrote.
  const encrypted = encryptEnvelope(plaintext, kek, args.kekId);
  const check = decryptEnvelope(encrypted, kek);
  if (sha256Buffer(check.plaintext) !== sha256Buffer(plaintext)) {
    fail("post-encryption self-check failed; refusing to keep the archive");
  }

  const stem = `alo-backup-${nowStamp()}-${args.label}`;
  const tmpFinal = path.join(args.out, `.${stem}.alobak.partial`);
  const finalPath = path.join(args.out, `${stem}.alobak`);
  fs.writeFileSync(tmpFinal, encrypted, { mode: 0o600 });
  fs.renameSync(tmpFinal, finalPath);
  const outerSha = sha256File(finalPath);
  fs.writeFileSync(`${finalPath}.sha256`, `${outerSha}  ${path.basename(finalPath)}\n`, { mode: 0o600 });
  const sidecar = {
    file: path.basename(finalPath),
    createdAt: manifest.createdAt,
    categories: manifest.categories,
    files: manifest.totals.files,
    plaintextBytes: plaintext.length,
    sizeBytes: encrypted.length,
    sha256: outerSha,
    encrypted: true,
    kekId: args.kekId,
    verified: true,
  };
  fs.writeFileSync(`${finalPath}.manifest.json`, `${JSON.stringify(sidecar, null, 2)}\n`, { mode: 0o600 });

  // Offsite copy + re-verify, only after local verification succeeded.
  let offsite = null;
  if (args.offsiteDir) {
    fs.mkdirSync(args.offsiteDir, { recursive: true, mode: 0o700 });
    const offFinal = path.join(args.offsiteDir, path.basename(finalPath));
    fs.copyFileSync(finalPath, offFinal);
    fs.copyFileSync(`${finalPath}.sha256`, `${offFinal}.sha256`);
    fs.copyFileSync(`${finalPath}.manifest.json`, `${offFinal}.manifest.json`);
    const offSha = sha256File(offFinal);
    if (!sha256Matches(offSha, outerSha)) fail("offsite copy failed sha256 re-verification; local backup kept, offsite copy untrusted");
    const offRemoved = prune(args.offsiteDir, args.keep, offFinal);
    offsite = { dir: args.offsiteDir, file: path.basename(offFinal), sha256: offSha, verified: true, pruned: offRemoved };
  }

  const removed = prune(args.out, args.keep, finalPath);
  const durationMs = Date.now() - startedAt;
  const status = updateStatus(statusPath, {
    lastSuccess: {
      at: new Date().toISOString(),
      file: path.basename(finalPath),
      sizeBytes: encrypted.length,
      stages: manifest.files.length,
      categories: manifest.categories,
      sha256: outerSha,
      durationMs,
      offsite: offsite ? { dir: offsite.dir, verified: offsite.verified } : null,
    },
    lastFailure: null,
  });

  const result = {
    ok: true,
    note: MAGIC_NOTE,
    file: finalPath,
    sizeBytes: encrypted.length,
    plaintextBytes: plaintext.length,
    sha256: outerSha,
    categories: manifest.categories,
    stagedFiles: manifest.totals.files,
    skipped: manifest.skipped,
    warnings: manifest.warnings,
    durationMs,
    pruned: removed,
    offsite,
    status: args.json ? status : undefined,
  };
  fs.rmSync(staging, { recursive: true, force: true });
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`encrypted-backup: OK ${path.basename(finalPath)} (${encrypted.length} bytes, ${manifest.files.length} files, ${manifest.categories.join("+")}, ${durationMs}ms, sha256 ${outerSha.slice(0, 16)}…)\n`);
  process.exit(0);
} catch (error) {
  updateStatus(statusPath, {
    lastFailure: { at: new Date().toISOString(), error: error instanceof Error ? error.message.slice(0, 300) : "unknown", durationMs: Date.now() - startedAt },
  });
  fs.rmSync(staging, { recursive: true, force: true });
  fail(error instanceof Error ? error.message : String(error));
}
