/**
 * Backup monitor — the alerting half of the backup system.
 * Healthy backups must stay silent; stale/failed/corrupt backups must alert,
 * and the SUPER_ADMIN notification must be written exactly once per alert.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REPO = process.cwd();
const MONITOR = path.join(REPO, "scripts/backup-monitor.mjs");
const BACKUP = path.join(REPO, "scripts/encrypted-backup.mjs");

let workDir: string;
let dbUrl: string;

interface RunResult { status: number; stdout: string; stderr: string }
function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [MONITOR, ...args], {
      cwd: REPO, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-backup-monitor-"));
  // A minimal panel database with one SUPER_ADMIN user and the notifications table.
  const { createClient } = await import("@libsql/client");
  dbUrl = `file:${path.join(workDir, "panel.db")}`;
  const client = createClient({ url: dbUrl });
  try {
    await client.execute("CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    await client.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, isActive INTEGER NOT NULL DEFAULT 1, roleId TEXT NOT NULL)");
    await client.execute("CREATE TABLE notifications (id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT, read INTEGER NOT NULL DEFAULT 0, link TEXT, createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await client.execute({ sql: "INSERT INTO roles VALUES ('r-sa', 'SUPER_ADMIN')", args: [] });
    await client.execute({ sql: "INSERT INTO users VALUES ('u-sa', 'root@example.com', 1, 'r-sa')", args: [] });
  } finally {
    await client.close();
  }
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const writeStatus = (dir: string, patch: Record<string, unknown>) => {
  fs.mkdirSync(dir, { recursive: true });
  const status = {
    lastSuccess: {
      at: new Date().toISOString(),
      file: "test.alobak",
      sizeBytes: 1234,
      categories: ["control-plane"],
      sha256: "0".repeat(64),
      offsite: { dir: "/somewhere", verified: true },
    },
    lastFailure: null,
    updatedAt: new Date().toISOString(),
    ...patch,
  };
  const file = path.join(dir, "backup-status.json");
  fs.writeFileSync(file, JSON.stringify(status), { mode: 0o600 });
  return file;
};

describe("backup-monitor", () => {
  it("exits 0 and raises no alerts for a fresh, verified backup", () => {
    const dir = path.join(workDir, "fresh");
    const statusFile = writeStatus(dir, {});
    const res = run(["--status", statusFile, "--no-verify-archive", "--json"]);
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.healthy).toBe(true);
    expect(report.alerts).toEqual([]);
  });

  it("exits 1 when the status file is missing", () => {
    const res = run(["--status", path.join(workDir, "nope", "backup-status.json"), "--json"]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).healthy).toBe(false);
  });

  it("exits 1 when the last success is older than the threshold", () => {
    const dir = path.join(workDir, "stale");
    const old = new Date(Date.now() - 72 * 3600_000).toISOString();
    const statusFile = writeStatus(dir, { lastSuccess: { at: old, file: "old.alobak", sizeBytes: 10, offsite: null } });
    const res = run(["--status", statusFile, "--no-verify-archive", "--json"]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).alerts.join(" ")).toMatch(/72\.0h old|stale/i);
  });

  it("exits 1 when the last failure is newer than the last success", () => {
    const dir = path.join(workDir, "failed");
    const statusFile = writeStatus(dir, {
      lastSuccess: { at: new Date(Date.now() - 48 * 3600_000).toISOString(), file: "old.alobak", sizeBytes: 10, offsite: null },
      lastFailure: { at: new Date().toISOString(), error: "boom", durationMs: 5 },
    });
    const res = run(["--status", statusFile, "--no-verify-archive", "--json"]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).alerts.join(" ")).toMatch(/FAILED.*boom/);
  });

  it("detects a tampered archive via the sidecar and notifies SUPER_ADMIN exactly once", async () => {
    const dir = path.join(workDir, "tampered");
    fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, "t.alobak");
    fs.writeFileSync(archive, crypto.randomBytes(256));
    fs.writeFileSync(`${archive}.sha256`, `${"0".repeat(64)}  t.alobak\n`);
    const statusFile = writeStatus(dir, {
      lastSuccess: { at: new Date().toISOString(), file: "t.alobak", sizeBytes: 256, offsite: { dir: "/somewhere", verified: true } },
    });
    const res = run(["--status", statusFile, "--notify-db", dbUrl, "--json"]);
    expect(res.status).toBe(1);
    const report = JSON.parse(res.stdout);
    expect(report.alerts.join(" ")).toMatch(/sha256/);
    expect(report.notification?.superAdminsNotified).toBe(1);

    // Re-run: the deterministic alert id must not create a second row.
    const res2 = run(["--status", statusFile, "--notify-db", dbUrl, "--json"]);
    expect(res2.status).toBe(1);
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: dbUrl });
    try {
      const r = await client.execute("SELECT COUNT(*) AS n FROM notifications WHERE userId = 'u-sa'");
      expect(Number(r.rows[0]?.n ?? 0)).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("exits 1 when the archive sidecar does not exist", () => {
    const dir = path.join(workDir, "nosidecar");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "t2.alobak"), crypto.randomBytes(64));
    const statusFile = writeStatus(dir, {
      lastSuccess: { at: new Date().toISOString(), file: "t2.alobak", sizeBytes: 64, offsite: null },
    });
    const res = run(["--status", statusFile, "--json"]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).alerts.join(" ")).toMatch(/sidecar/);
  });
});

describe("backup-monitor — M8 restore-drill history", () => {
  it("exits 0 when a recent successful drill is recorded", () => {
    const dir = path.join(workDir, "drill-ok");
    const drillLog = path.join(dir, "restore-drills.jsonl");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(drillLog, `${JSON.stringify({ at: new Date().toISOString(), ok: true, archive: "t.alobak", durationMs: 900 })}\n`);
    const statusFile = writeStatus(dir, {});
    const res = run(["--status", statusFile, "--no-verify-archive", "--restore-test-log", drillLog, "--json"]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).observations.restoreTest.ageDays).toBeLessThan(1);
  });

  it("exits 1 when the drill log is missing", () => {
    const dir = path.join(workDir, "drill-missing");
    const statusFile = writeStatus(dir, {});
    const res = run(["--status", statusFile, "--no-verify-archive", "--restore-test-log", path.join(dir, "nope.jsonl"), "--json"]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).alerts.join(" ")).toMatch(/restore-test log/i);
  });

  it("exits 1 when the newest successful drill is older than the threshold", () => {
    const dir = path.join(workDir, "drill-stale");
    const drillLog = path.join(dir, "restore-drills.jsonl");
    fs.mkdirSync(dir, { recursive: true });
    const stale = new Date(Date.now() - 45 * 86_400_000).toISOString();
    fs.writeFileSync(drillLog, `${JSON.stringify({ at: stale, ok: true })}\n`);
    const statusFile = writeStatus(dir, {});
    const res = run(["--status", statusFile, "--no-verify-archive", "--restore-test-log", drillLog, "--restore-test-max-days", "31", "--json"]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).alerts.join(" ")).toMatch(/restore drill was 45\.0 days ago/i);
  });

  it("exits 1 when the log has no successful drill on record", () => {
    const dir = path.join(workDir, "drill-none-ok");
    const drillLog = path.join(dir, "restore-drills.jsonl");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(drillLog, `${JSON.stringify({ at: new Date().toISOString(), ok: false, error: "verify failed" })}\n`);
    const statusFile = writeStatus(dir, {});
    const res = run(["--status", statusFile, "--no-verify-archive", "--restore-test-log", drillLog, "--json"]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).alerts.join(" ")).toMatch(/no successful restore drill/i);
  });
});
