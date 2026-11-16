/**
 * Encrypted backup and restore drill — real archives, real keys, real tampering.
 *
 * Envelope encryption is only trustworthy if the failure modes fail CLOSED:
 * a wrong key, a flipped bit in the payload, a reordered header, or a truncated
 * sidecar must all produce a hard error, never a plausible-looking restore.
 * These tests exercise the CLI end to end (like backup-restore.test.ts) plus
 * the refusal policies (live restore without approval, secret-named files,
 * concurrent lock, retention protection for the newest backup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REPO = process.cwd();
const BACKUP = path.join(REPO, "scripts/encrypted-backup.mjs");
const RESTORE = path.join(REPO, "scripts/encrypted-restore.mjs");

let workDir: string;
let kekFile: string;
let scratchDb: string;

interface RunResult { status: number; stdout: string; stderr: string }
function run(script: string, args: string[], env: Record<string, string> = {}): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: REPO, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-enc-backup-test-"));
  kekFile = path.join(workDir, "kek.hex");
  fs.writeFileSync(kekFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  scratchDb = path.join(workDir, "scratch.db");
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${scratchDb}` });
  try {
    await client.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL)");
    await client.execute("CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
    await client.execute("CREATE TABLE servers (id TEXT PRIMARY KEY)");
    await client.execute("CREATE TABLE hosting_sites (id TEXT PRIMARY KEY)");
    await client.execute({ sql: "INSERT INTO users VALUES (?, ?)", args: ["u1", "drill@example.com"] });
    await client.execute({ sql: "INSERT INTO audit_logs (id, action) VALUES ('a1', 'backup-test')" });
  } finally {
    await client.close();
  }
  // A tiny payload tree to back up alongside the database.
  fs.mkdirSync(path.join(workDir, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(workDir, "uploads", "hello.txt"), "customer-content-\n");
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const backupArgs = (outDir: string, extra: string[] = []) => [
  "--out", outDir,
  "--label", "test",
  "--key-file", kekFile,
  "--uploads-dir", path.join(workDir, "uploads"),
  "--json",
  ...extra,
];

describe("encrypted backup — happy path", () => {
  it("creates an archive, verifies it, and restores byte-identically into an isolated target", () => {
    const outDir = path.join(workDir, "bak1");
    const created = run(BACKUP, backupArgs(outDir), { DATABASE_URL: `file:${scratchDb}` });
    expect(created.status).toBe(0);
    const summary = JSON.parse(created.stdout);
    expect(summary.ok).toBe(true);
    expect(summary.categories).toContain("control-plane");
    expect(summary.categories).toContain("uploads");
    expect(fs.existsSync(summary.file)).toBe(true);
    expect(fs.existsSync(`${summary.file}.sha256`)).toBe(true);
    expect(fs.existsSync(`${summary.file}.manifest.json`)).toBe(true);

    // The archive must not contain plaintext database bytes.
    const raw = fs.readFileSync(summary.file);
    expect(raw.includes(Buffer.from("drill@example.com"))).toBe(false);

    const verified = run(RESTORE, ["--from", summary.file, "--verify-only", "--key-file", kekFile, "--json"]);
    expect(verified.status).toBe(0);
    expect(JSON.parse(verified.stdout).filesVerified).toBeGreaterThan(0);

    const target = path.join(workDir, "restore1");
    const restored = run(RESTORE, ["--from", summary.file, "--target", target, "--key-file", kekFile, "--json"]);
    expect(restored.status).toBe(0);
    expect(fs.readFileSync(path.join(target, "uploads", "hello.txt"), "utf8")).toBe("customer-content-\n");
  });

  it("writes a non-secret manifest and a backup-status.json", () => {
    const outDir = path.join(workDir, "bak2");
    const created = run(BACKUP, backupArgs(outDir), { DATABASE_URL: `file:${scratchDb}` });
    expect(created.status).toBe(0);
    const summary = JSON.parse(created.stdout);
    const sidecar = JSON.parse(fs.readFileSync(`${summary.file}.manifest.json`, "utf8"));
    expect(sidecar.encrypted).toBe(true);
    expect(sidecar.kekId).toBeTruthy();
    // The sidecar names a key ID, never the key file path, the environment variable, or any key material.
    expect(JSON.stringify(sidecar)).not.toMatch(/drill@example\.com|kek\.hex|ALO_BACKUP_ENCRYPTION_KEY|\.hex/i);
    const status = JSON.parse(fs.readFileSync(path.join(outDir, "backup-status.json"), "utf8"));
    expect(status.lastSuccess.file).toBe(path.basename(summary.file));
    expect(status.lastFailure).toBeNull();
  });
});

describe("encrypted backup — tampering and wrong keys fail closed", () => {
  let archive: string;
  let outDir: string;

  beforeAll(() => {
    outDir = path.join(workDir, "bak3");
    const created = run(BACKUP, backupArgs(outDir), { DATABASE_URL: `file:${scratchDb}` });
    archive = JSON.parse(created.stdout).file;
  });

  const tampered = (fn: (buf: Buffer) => Buffer) => {
    const copy = path.join(workDir, `tampered-${crypto.randomBytes(4).toString("hex")}.alobak`);
    fs.writeFileSync(copy, fn(Buffer.from(fs.readFileSync(archive))));
    return copy;
  };

  it("rejects a wrong key", () => {
    const wrongKek = path.join(workDir, "wrong-kek.hex");
    fs.writeFileSync(wrongKek, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    const res = run(RESTORE, ["--from", archive, "--verify-only", "--key-file", wrongKek]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/key unwrap failed|wrong KEK/i);
  });

  it("rejects a flipped payload bit", () => {
    const copy = tampered((buf) => { buf[buf.length - 1] ^= 0x01; return buf; });
    const res = run(RESTORE, ["--from", copy, "--verify-only", "--key-file", kekFile]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/authentication failed|tampered|sha256/i);
  });

  it("rejects a flipped header byte", () => {
    const copy = tampered((buf) => { const i = buf.indexOf("plaintextSha256"); buf[i] = buf[i] ^ 0x01; return buf; });
    const res = run(RESTORE, ["--from", copy, "--verify-only", "--key-file", kekFile]);
    expect(res.status).not.toBe(0);
  });

  it("rejects a corrupted outer sidecar without decrypting", () => {
    const copy = tampered((buf) => buf);
    fs.writeFileSync(`${copy}.sha256`, `${"0".repeat(64)}  tampered.alobak\n`);
    const res = run(RESTORE, ["--from", copy, "--verify-only", "--key-file", kekFile]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/outer sha256 mismatch/i);
  });

  it("rejects a truncated archive", () => {
    const copy = tampered((buf) => buf.subarray(0, Math.floor(buf.length / 2)));
    const res = run(RESTORE, ["--from", copy, "--verify-only", "--key-file", kekFile]);
    expect(res.status).not.toBe(0);
  });

  it("refuses to overwrite anything in live mode without --yes", () => {
    const res = run(RESTORE, ["--from", archive, "--live", "--db", `file:${scratchDb}`, "--key-file", kekFile]);
    expect(res.status).toBe(3);
  });

  it("refuses a group-readable key file", () => {
    const openKek = path.join(workDir, "open-kek.hex");
    fs.writeFileSync(openKek, crypto.randomBytes(32).toString("hex"), { mode: 0o644 });
    const res = run(BACKUP, ["--out", path.join(workDir, "bak4"), "--key-file", openKek, "--json"], { DATABASE_URL: `file:${scratchDb}` });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/group\/others|chmod 600/i);
  });

  it("refuses secret-named files in the config category", () => {
    const secret = path.join(workDir, "production.env");
    fs.writeFileSync(secret, "TOP_SECRET=1\n");
    const res = run(BACKUP, ["--out", path.join(workDir, "bak5"), "--key-file", kekFile, "--config-file", secret], { DATABASE_URL: `file:${scratchDb}` });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/secret by name/i);
  });
});

describe("encrypted backup — retention and concurrency", () => {
  it("prunes beyond --keep but never the newest valid backup", () => {
    const outDir = path.join(workDir, "bak-retain");
    for (let n = 0; n < 3; n += 1) {
      const res = run(BACKUP, backupArgs(outDir, ["--keep", "1", "--label", `r${n}`]), { DATABASE_URL: `file:${scratchDb}` });
      expect(res.status).toBe(0);
    }
    const archives = fs.readdirSync(outDir).filter((f) => f.endsWith(".alobak"));
    expect(archives.length).toBe(1);
  });

  it("a stale lock (dead pid, old mtime) is taken over; a live lock refuses to duplicate the run", () => {
    const outDir = path.join(workDir, "bak-lock");
    fs.mkdirSync(outDir, { recursive: true });
    const lock = path.join(outDir, ".encrypted-backup.lock");
    fs.writeFileSync(lock, JSON.stringify({ pid: 999_999_999, at: new Date(0).toISOString() }), { mode: 0o600 });
    const past = new Date(Date.now() - 7 * 3600_000);
    fs.utimesSync(lock, past, past);
    const res = run(BACKUP, backupArgs(outDir), { DATABASE_URL: `file:${scratchDb}` });
    expect(res.status).toBe(0);

    // Now a lock held by this very process must refuse a concurrent run.
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
    const res2 = run(BACKUP, backupArgs(outDir), { DATABASE_URL: `file:${scratchDb}` });
    expect(res2.status).toBe(3);
    expect(res2.stderr).toMatch(/another backup run is in progress/i);
  });
});
