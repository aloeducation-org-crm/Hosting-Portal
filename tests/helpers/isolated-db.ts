/**
 * Per-test-file database isolation.
 *
 * `src/lib/db` resolves DATABASE_URL once, when the module is first evaluated,
 * and caches the client on `globalThis`. Any test file that imports it (even
 * transitively, through a route handler) without first pointing DATABASE_URL at
 * a scratch copy writes straight into the tracked development database
 * `db/custom.db` — which is how audit rows from test runs ended up committed in
 * the repository.
 *
 * Importing this module *first* in a test file installs that scratch copy.
 * Static imports are hoisted in source order, so the side effect runs before
 * `@/lib/db` is evaluated by anything else in the file. Vitest runs each file
 * with its own module registry and its own `globalThis`, so one copy per file is
 * both sufficient and necessary.
 *
 * Nothing here creates or migrates tables: the copy already contains the real
 * schema and the real seed rows (users, roles, permissions, websites), so tests
 * keep seeing exactly what they saw before — they just cannot damage it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const installed = globalThis as unknown as { __aloIsolatedDbRoot?: string };

function install(): string {
  if (installed.__aloIsolatedDbRoot) return installed.__aloIsolatedDbRoot;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alo-test-db-"));
  const target = path.join(root, "custom.db");
  const source = path.resolve("db/custom.db");
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
    // SQLite sidecars, when present, must travel with the database file.
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, target + suffix);
    }
  }

  process.env.DATABASE_URL = `file:${target}`;
  process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || "a".repeat(64);
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "t".repeat(64);
  process.env.JWT_SECRET = process.env.JWT_SECRET || "j".repeat(64);
  installed.__aloIsolatedDbRoot = root;
  return root;
}

/** Absolute path of this file's scratch database copy. */
export const isolatedDbPath = path.join(install(), "custom.db");

/** The DATABASE_URL now in force, for assertions and child processes. */
export const isolatedDbUrl = `file:${isolatedDbPath}`;

/**
 * Disconnect and delete the scratch copy. Call from `afterAll`.
 * Safe to call even when no test opened the database.
 */
export async function teardownIsolatedDb(): Promise<void> {
  const root = installed.__aloIsolatedDbRoot;
  if (!root) return;
  try {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  } catch {
    // Never opened — nothing to disconnect.
  }
  fs.rmSync(root, { recursive: true, force: true });
  delete installed.__aloIsolatedDbRoot;
}
