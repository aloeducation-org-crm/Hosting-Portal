/**
 * KEK re-wrap — rotation must work without re-taking a backup from a live DB.
 * The original archive stays byte-for-byte intact; the re-wrapped archive
 * authenticates under the new KEK, fails under the old one, and never embeds
 * key material.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REPO = process.cwd();
const REWRAP = path.join(REPO, "scripts/backup-rewrap-kek.mjs");
const BACKUP = path.join(REPO, "scripts/encrypted-backup.mjs");
const RESTORE = path.join(REPO, "scripts/encrypted-restore.mjs");

let workDir: string;
let kekA: string;
let kekB: string;
let scratchDb: string;
let archive: string;
let archiveShaBefore: string;

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-rewrap-test-"));
  kekA = path.join(workDir, "kek-a.hex");
  kekB = path.join(workDir, "kek-b.hex");
  fs.writeFileSync(kekA, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  fs.writeFileSync(kekB, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  scratchDb = path.join(workDir, "scratch.db");
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${scratchDb}` });
  try {
    await client.execute("CREATE TABLE users (id TEXT PRIMARY KEY)");
    await client.execute("CREATE TABLE audit_logs (id TEXT PRIMARY KEY)");
    await client.execute("CREATE TABLE servers (id TEXT PRIMARY KEY)");
    await client.execute("CREATE TABLE hosting_sites (id TEXT PRIMARY KEY)");
  } finally {
    await client.close();
  }
  const outDir = path.join(workDir, "bak");
  const res = run(BACKUP, ["--out", outDir, "--label", "rewrap-src", "--key-file", kekA, "--json"], { DATABASE_URL: `file:${scratchDb}` });
  expect(res.status).toBe(0);
  archive = JSON.parse(res.stdout).file;
  archiveShaBefore = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("backup-rewrap-kek", () => {
  it("re-wraps to a new KEK; new archive verifies with the new KEK and not the old", () => {
    const res = run(REWRAP, ["--from", archive, "--key-file", kekA, "--new-key-file", kekB, "--new-kek-id", "kek-2", "--json"]);
    expect(res.status).toBe(0);
    const rewrapped = JSON.parse(res.stdout).file;
    expect(rewrapped).not.toBe(archive);
    expect(fs.existsSync(`${rewrapped}.sha256`)).toBe(true);
    expect(fs.existsSync(`${rewrapped}.manifest.json`)).toBe(true);

    // Old KEK must NOT decrypt the re-wrapped archive.
    const withOld = run(RESTORE, ["--from", rewrapped, "--verify-only", "--key-file", kekA]);
    expect(withOld.status).not.toBe(0);

    // New KEK verifies it, byte-for-byte payload.
    const withNew = run(RESTORE, ["--from", rewrapped, "--verify-only", "--key-file", kekB, "--json"]);
    expect(withNew.status).toBe(0);

    const sidecar = JSON.parse(fs.readFileSync(`${rewrapped}.manifest.json`, "utf8"));
    expect(sidecar.kekId).toBe("kek-2");
    expect(sidecar.reWrappedFrom).toBe(path.basename(archive));
    expect(JSON.stringify(sidecar)).not.toContain(fs.readFileSync(kekB, "utf8").trim());

    // The original archive must remain byte-for-byte intact and still valid.
    const archiveShaAfter = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    expect(archiveShaAfter).toBe(archiveShaBefore);
    const stillGood = run(RESTORE, ["--from", archive, "--verify-only", "--key-file", kekA, "--json"]);
    expect(stillGood.status).toBe(0);
  });

  it("refuses a group-readable new KEK file", () => {
    const openKek = path.join(workDir, "new-kek-open.hex");
    fs.writeFileSync(openKek, crypto.randomBytes(32).toString("hex"), { mode: 0o644 });
    const res = run(REWRAP, ["--from", archive, "--key-file", kekA, "--new-key-file", openKek]);
    expect(res.status).toBe(2);
  });

  it("refuses to overwrite an existing target", () => {
    const res1 = run(REWRAP, ["--from", archive, "--key-file", kekA, "--new-key-file", kekB, "--new-kek-id", "kek-3", "--json"]);
    expect(res1.status).toBe(0);
    const res2 = run(REWRAP, ["--from", archive, "--key-file", kekA, "--new-key-file", kekB, "--new-kek-id", "kek-3"]);
    expect(res2.status).toBe(3);
    expect(res2.stderr).toMatch(/refusing to overwrite/i);
  });

  it("a tampered source archive fails closed and writes nothing", () => {
    const tampered = path.join(workDir, "tampered.alobak");
    const buf = Buffer.from(fs.readFileSync(archive));
    buf[buf.length - 1] ^= 0x01;
    fs.writeFileSync(tampered, buf);
    const before = fs.readdirSync(workDir).filter((f) => f.startsWith("tampered.rewrapped"));
    const res = run(REWRAP, ["--from", tampered, "--key-file", kekA, "--new-key-file", kekB, "--new-kek-id", "kek-9", "--json"]);
    expect(res.status).toBe(3);
    const after = fs.readdirSync(workDir).filter((f) => f.startsWith("tampered.rewrapped"));
    expect(after).toEqual(before);
  });
});
