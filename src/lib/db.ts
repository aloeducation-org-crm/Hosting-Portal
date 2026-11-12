import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Resolve the database URL, or refuse to start.
 *
 * SEC-12: an unset `DATABASE_URL` fell back to `file:./db/custom.db` — the
 * tracked development fixture, which is shipped inside the release payload. In
 * production that means a missing environment variable produces a running panel
 * backed by a database of seeded accounts, silently. `scripts/validate-prod-config.mjs`
 * caught it, but only at deploy time and only along that one path.
 *
 * A production process now refuses to start without an explicit database URL.
 * Build-time workers are exempt: `next build` evaluates modules without a
 * production database and must not need one.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.DATABASE_URL ?? "").trim();
  const isBuildWorker =
    !!env.NEXT_WORKER_ID ||
    !!env.BUILD_ID ||
    env.NEXT_PHASE === "phase-production-build" ||
    env.npm_lifecycle_event === "build";
  if (configured) return configured;
  if (env.NODE_ENV === "production" && !isBuildWorker) {
    // Fail loudly and specifically. `process.exit(1)` matches how env.ts treats
    // placeholder secrets: a broken configuration must not serve traffic.
    console.error("[SECURITY] FATAL: DATABASE_URL is not set. Refusing to start in production.");
    console.error("[SECURITY] Set DATABASE_URL=file:/var/lib/alo-hosting/alo.db (or your server URL) in the process environment.");
    process.exit(1);
  }
  return "file:./db/custom.db";
}

export function createPrismaClient(): PrismaClient {
  const databaseUrl = resolveDatabaseUrl();
  if (databaseUrl.startsWith("file:")) {
    const adapter = new PrismaLibSQL({ url: databaseUrl });
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
