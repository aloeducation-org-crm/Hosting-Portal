/**
 * Backup and restore drill — real SQLite databases, real scripts, real recovery.
 *
 * The repository shipped `pg_dump`/`psql` scripts against a Prisma datasource that
 * declares `provider = "sqlite"`, and the documented production database is
 * `file:/…/hosting.db`. On the actual host the backup would fail outright, and the
 * only restore path overwrote production after a single prompt — with no way to
 * rehearse, so nobody could know a backup was usable without risking the live
 * database to find out.
 *
 * These tests perform the drill: create a database with real rows, take a verified
 * snapshot, restore it into an *isolated* target, and prove the rows came back
 * while the live database was untouched. They also prove the refusals — a corrupt
 * file, a file missing the tables the application needs, and an unconfirmed
 * overwrite of production.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = process.cwd();
const BACKUP = path.join(REPO, "scripts/backup.sh");
const RESTORE = path.join(REPO, "scripts/restore.sh");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): RunResult {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: REPO,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** A real SQLite database with the tables the application needs. */
async function makeDatabase(file: string, email: string): Promise<void> {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${file}` });
  try {
    await client.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL)");
    await client.execute("CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT)");
    await client.execute("CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY)");
    await client.execute("CREATE TABLE IF NOT EXISTS hosting_sites (id TEXT PRIMARY KEY)");
    await client.execute({ sql: "INSERT OR REPLACE INTO users (id, email) VALUES (?, ?)", args: ["u1", email] });
  } finally {
    await client.close();
  }
}

async function emailsIn(file: string): Promise<string[]> {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${file}` });
  try {
    const result = await client.execute("SELECT email FROM users ORDER BY email");
    return result.rows.map((row) => String(row.email));
  } finally {
    await client.close();
  }
}

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alo-backup-"));
}

describe("database backup", () => {
  it("takes a verified, consistent snapshot and records its digest", async () => {
    const dir = scratch();
    try {
      const live = path.join(dir, "live.db");
      await makeDatabase(live, "first@example.invalid");
      const outDir = path.join(dir, "backups");

      const result = run("bash", [BACKUP, outDir, "--json"], { DATABASE_URL: `file:${live}` });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);

      const payload = JSON.parse(result.stdout) as {
        success: boolean;
        verified: boolean;
        file: string;
        sha256: string;
        sizeBytes: number;
      };
      expect(payload).toMatchObject({ success: true, verified: true });
      expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(payload.sizeBytes).toBeGreaterThan(0);

      const backupFile = path.join(outDir, payload.file);
      expect(fs.existsSync(backupFile)).toBe(true);
      // The snapshot holds the data, and the metadata sits beside it.
      expect(await emailsIn(backupFile)).toEqual(["first@example.invalid"]);
      const metadata = JSON.parse(fs.readFileSync(`${backupFile}.json`, "utf8")) as {
        sha256: string;
        verified: boolean;
      };
      expect(metadata.sha256).toBe(payload.sha256);
      expect(metadata.verified).toBe(true);
      // A database dump is customer data: owner-only.
      if (process.platform !== "win32") {
        expect(fs.statSync(backupFile).mode & 0o077).toBe(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to report success for a corrupt or unusable file", async () => {
    const dir = scratch();
    try {
      const corrupt = path.join(dir, "corrupt.db");
      fs.writeFileSync(corrupt, "definitely not a database\n");

      const bad = run("bash", [BACKUP, "--verify", corrupt]);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("NOT restorable");
      expect(bad.stderr).toContain("header mismatch");

      // A file that *is* SQLite but cannot restore the application is not a backup.
      const thin = path.join(dir, "thin.db");
      const { createClient } = await import("@libsql/client");
      const client = createClient({ url: `file:${thin}` });
      await client.execute("CREATE TABLE unrelated (id TEXT)");
      await client.close();

      const missingTables = run("bash", [BACKUP, "--verify", thin]);
      expect(missingTables.status).toBe(1);
      expect(missingTables.stderr).toContain('required table "users" is missing');

      // And the historical `backup.sh <output_dir>` interface still works.
      const live = path.join(dir, "live.db");
      await makeDatabase(live, "kept@example.invalid");
      const good = path.join(dir, "good");
      expect(run("bash", [BACKUP, good], { DATABASE_URL: `file:${live}` }).status).toBe(0);
      expect(fs.readdirSync(good).some((name) => name.endsWith(".db"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a relative SQLite URL instead of guessing which file to back up", async () => {
    const dir = scratch();
    try {
      const result = run("bash", [BACKUP, path.join(dir, "out")], { DATABASE_URL: "file:./relative.db" });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("relative SQLite path");
      expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("database restore", () => {
  it("recovers real rows into an isolated target and leaves production untouched", async () => {
    const dir = scratch();
    try {
      const live = path.join(dir, "live.db");
      await makeDatabase(live, "before@example.invalid");
      const outDir = path.join(dir, "backups");
      const backup = run("bash", [BACKUP, outDir, "--json"], { DATABASE_URL: `file:${live}` });
      const backupFile = path.join(outDir, (JSON.parse(backup.stdout) as { file: string }).file);

      // Production moves on after the snapshot was taken.
      await makeDatabase(live, "after@example.invalid");
      expect(await emailsIn(live)).toEqual(["after@example.invalid"]);
      const liveBytes = fs.readFileSync(live);

      const drill = path.join(dir, "drill.db");
      const restored = run("bash", [RESTORE, backupFile, "--target", drill, "--json"], {
        DATABASE_URL: `file:${live}`,
      });
      expect(restored.stderr).toBe("");
      expect(restored.status).toBe(0);
      const payload = JSON.parse(restored.stdout) as { restoredTo: string; production: boolean };
      expect(payload.production).toBe(false);
      expect(payload.restoredTo).toBe(drill);

      // The drill recovered the snapshot's data…
      expect(await emailsIn(drill)).toEqual(["before@example.invalid"]);
      // …and the live database was never written to.
      expect(fs.readFileSync(live).equals(liveBytes)).toBe(true);
      expect(await emailsIn(live)).toEqual(["after@example.invalid"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite the live database without explicit confirmation", async () => {
    const dir = scratch();
    try {
      const live = path.join(dir, "live.db");
      await makeDatabase(live, "keep-me@example.invalid");
      const outDir = path.join(dir, "backups");
      const backup = run("bash", [BACKUP, outDir, "--json"], { DATABASE_URL: `file:${live}` });
      const backupFile = path.join(outDir, (JSON.parse(backup.stdout) as { file: string }).file);

      const refused = run("bash", [RESTORE, backupFile], { DATABASE_URL: `file:${live}` });
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain("live database");
      expect(refused.stderr).toContain("--target");
      expect(await emailsIn(live)).toEqual(["keep-me@example.invalid"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes a verified safety snapshot before a confirmed production restore", async () => {
    const dir = scratch();
    try {
      const live = path.join(dir, "live.db");
      await makeDatabase(live, "old@example.invalid");
      const outDir = path.join(dir, "backups");
      const backup = run("bash", [BACKUP, outDir, "--json"], { DATABASE_URL: `file:${live}` });
      const backupFile = path.join(outDir, (JSON.parse(backup.stdout) as { file: string }).file);

      await makeDatabase(live, "new@example.invalid");

      const confirmed = run("bash", [RESTORE, backupFile, "--yes", "--json"], {
        DATABASE_URL: `file:${live}`,
      });
      expect(confirmed.stderr).toBe("");
      expect(confirmed.status).toBe(0);
      const payload = JSON.parse(confirmed.stdout) as { production: boolean; safetySnapshot: string };
      expect(payload.production).toBe(true);

      // Production now holds the snapshot's data…
      expect(await emailsIn(live)).toEqual(["old@example.invalid"]);
      // …and the state that was overwritten is recoverable from the safety copy.
      expect(fs.existsSync(payload.safetySnapshot)).toBe(true);
      expect(await emailsIn(payload.safetySnapshot)).toEqual(["new@example.invalid"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a snapshot that is not restorable before touching anything", async () => {
    const dir = scratch();
    try {
      const live = path.join(dir, "live.db");
      await makeDatabase(live, "untouched@example.invalid");
      const corrupt = path.join(dir, "corrupt.db");
      fs.writeFileSync(corrupt, "nope");

      const result = run("bash", [RESTORE, corrupt, "--target", path.join(dir, "x.db")], {
        DATABASE_URL: `file:${live}`,
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("not restorable");
      expect(fs.existsSync(path.join(dir, "x.db"))).toBe(false);
      expect(await emailsIn(live)).toEqual(["untouched@example.invalid"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never prints the database URL", async () => {
    const dir = scratch();
    try {
      const live = path.join(dir, "secret-path.db");
      await makeDatabase(live, "quiet@example.invalid");
      const result = run("bash", [BACKUP, path.join(dir, "out"), "--json"], {
        DATABASE_URL: `file:${live}`,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain(live);
      expect(result.stderr).not.toContain(live);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
