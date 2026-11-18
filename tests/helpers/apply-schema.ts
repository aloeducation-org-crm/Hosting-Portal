/**
 * Bring an isolated scratch database up to the full current schema.
 *
 * The committed `db/custom.db` is deliberately a pre-release fixture:
 * migration-safety.test.ts replays the real applier against it to prove the
 * first-run production behaviour, and deploy-harness.ts copies it while
 * promising to "never mutate it". Test files whose code paths touch tables or
 * columns added this release must therefore upgrade their own scratch copy —
 * with the very applier production hosts run, including the authorized
 * `operation_jobs` rebuild (platform-scope automation jobs store a NULL
 * `websiteId`, which the pre-rebuild column forbids).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function applyCurrentSchema(dbPath: string): void {
  // A byte copy of the pre-rebuild database is exactly the verified backup
  // `--allow-rebuild` demands: a real SQLite file containing every table the
  // rebuild rewrites.
  const backup = path.join(path.dirname(dbPath), "pre-rebuild-backup.db");
  fs.copyFileSync(dbPath, backup);
  execFileSync(
    process.execPath,
    [path.resolve("scripts/apply-deploy-schema.mjs"), "--allow-rebuild", "--backup", backup],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, stdio: "pipe" },
  );
}
