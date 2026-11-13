import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient, type Client, type TransactionMode } from "@libsql/client";
import Database from "libsql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * SQLite robustness for the pooled libsql driver.
 *
 * Two behaviours of the @libsql/client connection pool caused real outages:
 *
 * 1. Connections are opened without a busy timeout. When two processes (panel
 *    and worker) write concurrently, SQLite answers SQLITE_BUSY immediately —
 *    the Prisma adapter surfaces that as P1008 "Operation has timed out", so
 *    ordinary write contention looks like an infra failure.
 *
 * 2. A pooled connection can keep an open BEGIN DEFERRED read transaction
 *    across borrows. Once another process commits, that snapshot is stale and
 *    every later write on the connection fails with SQLITE_BUSY_SNAPSHOT —
 *    instantly, and immune to busy_timeout. Reads keep working, other
 *    processes keep writing: the process looks wedged until restart.
 *
 * The patches below set `PRAGMA busy_timeout` on every pooled connection (its
 * `prepare` is the single choke point the pool routes all statements through,
 * including the pool's own open-probe) and force Prisma's interactive
 * transactions to BEGIN IMMEDIATE — the write lock is taken before the first
 * read, so no stale snapshot can exist while the transaction runs and a busy
 * peer just makes it wait within the busy timeout instead of failing.
 */
const BUSY_TIMEOUT_MS = Math.min(60_000, Math.max(0, Number(process.env.DATABASE_BUSY_TIMEOUT_MS ?? 5000)));

let sqlitePatched = false;
function patchSqliteForPooling(): void {
  if (sqlitePatched || BUSY_TIMEOUT_MS === 0) return;
  const proto = (Database as unknown as { prototype?: Record<string, unknown> }).prototype;
  if (!proto) return;
  const origPrepare = proto.prepare as ((this: unknown, sql: string) => unknown) | undefined;
  if (typeof origPrepare !== "function" || (origPrepare as unknown as { __aloBusyTimeout?: boolean }).__aloBusyTimeout) return;
  const configured = new WeakSet<object>();
  const patched = function (this: object, sql: string) {
    if (!configured.has(this)) {
      configured.add(this);
      try {
        (origPrepare.call(this, `PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`) as { run?: () => unknown }).run?.();
      } catch {
        // A connection that cannot accept the pragma still works; it just
        // keeps SQLite's default behaviour.
      }
    }
    return origPrepare.call(this, sql);
  } as unknown as { __aloBusyTimeout: boolean };
  patched.__aloBusyTimeout = true;
  proto.prepare = patched;
  sqlitePatched = true;
}

class PrismaLibSQLPooled extends PrismaLibSQL {
  createClient(config: Parameters<typeof createClient>[0]): Client {
    const client = createClient(config);
    // Prisma's adapter opens interactive transactions as BEGIN DEFERRED
    // (e.g. for upsert). Deferred read snapshots are exactly what makes
    // BUSY_SNAPSHOT possible; the immediate variant serialises writers and
    // waits politely inside the busy timeout instead.
    const transaction = client.transaction.bind(client);
    client.transaction = ((mode?: TransactionMode) => transaction(mode === "deferred" ? "write" : mode)) as Client["transaction"];
    return client;
  }
}

export function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL || "file:./db/custom.db";
  if (databaseUrl.startsWith("file:")) {
    patchSqliteForPooling();
    const adapter = new PrismaLibSQLPooled({ url: databaseUrl });
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();
export const prisma = db;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
