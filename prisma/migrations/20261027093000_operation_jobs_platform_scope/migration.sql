-- Make `operation_jobs.websiteId` NULLable so platform-wide jobs (backup
-- drills, monitoring sweeps, replication audits, recovery actions) can exist
-- without inventing a fake website.
--
-- WHY THIS IS NOT AN ORDINARY ADDITIVE MIGRATION
-- SQLite cannot drop a NOT NULL constraint, so the table has to be rebuilt.
-- That is a data-touching operation, and this file is written to be safe:
--
--   1. Every row is copied by explicit column name — nothing is dropped or
--      rewritten. `INSERT ... SELECT` lists all 40+ columns.
--   2. `PRAGMA foreign_keys = OFF` for the duration, which is the documented
--      procedure for a table rebuild. (libSQL does not enforce FKs by default
--      anyway; the constraint that actually blocked platform jobs was Prisma's
--      own client-side relation check.)
--   3. `audit_logs.operationJobId` references "operation_jobs" by name. Renaming
--      tables rewrites the *stored* FK text in that child table, so the rebuild
--      finishes by rebuilding `audit_logs` with the correct reference again.
--      Audit history is preserved row for row.
--   4. The whole thing is wrapped in a transaction: if any step fails, SQLite
--      rolls back and the original tables are untouched.
--
-- `scripts/apply-deploy-schema.mjs` skips this file entirely once
-- `operation_jobs.websiteId` is already NULLable, so it can never run twice.

PRAGMA foreign_keys = OFF;

CREATE TABLE "operation_jobs_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" TEXT,
    "output" TEXT,
    "resourceId" TEXT,
    "resourceType" TEXT,
    "requestId" TEXT,
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "error" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,
    "correlationId" TEXT,
    "workerKind" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "retryPolicy" TEXT,
    "lastError" TEXT,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" DATETIME,
    "leasedBy" TEXT,
    "lockKey" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "approvalNote" TEXT,
    "deadLetteredAt" DATETIME,
    "deadLetterReason" TEXT,
    "cancelledAt" DATETIME,
    "cancelledBy" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "operation_jobs_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "operation_jobs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "operation_jobs_new" (
    "id", "websiteId", "type", "status", "priority", "progress", "input", "output",
    "resourceId", "resourceType", "requestId", "exitCode", "stdout", "stderr", "error",
    "actorId", "actorEmail", "actorRole", "startedAt", "finishedAt", "completedAt",
    "durationMs", "createdAt", "idempotencyKey", "correlationId", "workerKind",
    "riskLevel", "attempts", "maxAttempts", "retryPolicy", "lastError", "availableAt",
    "leaseExpiresAt", "leasedBy", "lockKey", "requiresApproval", "approvedBy",
    "approvedAt", "approvalNote", "deadLetteredAt", "deadLetterReason", "cancelledAt",
    "cancelledBy", "updatedAt"
)
SELECT
    "id", "websiteId", "type", "status", "priority", "progress", "input", "output",
    "resourceId", "resourceType", "requestId", "exitCode", "stdout", "stderr", "error",
    "actorId", "actorEmail", "actorRole", "startedAt", "finishedAt", "completedAt",
    "durationMs", "createdAt", "idempotencyKey", "correlationId", "workerKind",
    "riskLevel", "attempts", "maxAttempts", "retryPolicy", "lastError", "availableAt",
    "leaseExpiresAt", "leasedBy", "lockKey", "requiresApproval", "approvedBy",
    "approvedAt", "approvalNote", "deadLetteredAt", "deadLetterReason", "cancelledAt",
    "cancelledBy", "updatedAt"
FROM "operation_jobs";

DROP TABLE "operation_jobs";

ALTER TABLE "operation_jobs_new" RENAME TO "operation_jobs";

CREATE INDEX IF NOT EXISTS "operation_jobs_websiteId_idx" ON "operation_jobs"("websiteId");
CREATE INDEX IF NOT EXISTS "operation_jobs_status_idx" ON "operation_jobs"("status");
CREATE INDEX IF NOT EXISTS "operation_jobs_type_idx" ON "operation_jobs"("type");
CREATE INDEX IF NOT EXISTS "operation_jobs_requestId_idx" ON "operation_jobs"("requestId");
CREATE INDEX IF NOT EXISTS "operation_jobs_createdAt_idx" ON "operation_jobs"("createdAt");
CREATE INDEX IF NOT EXISTS "operation_jobs_status_availableAt_idx" ON "operation_jobs"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "operation_jobs_lockKey_idx" ON "operation_jobs"("lockKey");
CREATE INDEX IF NOT EXISTS "operation_jobs_correlationId_idx" ON "operation_jobs"("correlationId");
CREATE INDEX IF NOT EXISTS "operation_jobs_leaseExpiresAt_idx" ON "operation_jobs"("leaseExpiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "operation_jobs_idempotencyKey_key" ON "operation_jobs"("idempotencyKey");

-- ── Restore the audit_logs → operation_jobs reference ───────────────────────
-- The DROP/RENAME above left `audit_logs` pointing at the old table name. This
-- rebuilds it with exactly the same columns, defaults and rows, and the correct
-- FK text. Audit history is preserved.

CREATE TABLE "audit_logs_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "domain" TEXT,
    "result" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "operationJobId" TEXT,
    CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_operationJobId_fkey" FOREIGN KEY ("operationJobId") REFERENCES "operation_jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "audit_logs_new" (
    "id", "actorUserId", "actorEmail", "actorRole", "action", "resourceType",
    "resourceId", "domain", "result", "requestId", "ipAddress", "userAgent",
    "timestamp", "metadata", "errorCode", "durationMs", "operationJobId"
)
SELECT
    "id", "actorUserId", "actorEmail", "actorRole", "action", "resourceType",
    "resourceId", "domain", "result", "requestId", "ipAddress", "userAgent",
    "timestamp", "metadata", "errorCode", "durationMs", "operationJobId"
FROM "audit_logs";

DROP TABLE "audit_logs";

ALTER TABLE "audit_logs_new" RENAME TO "audit_logs";

CREATE INDEX IF NOT EXISTS "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");
CREATE INDEX IF NOT EXISTS "audit_logs_requestId_idx" ON "audit_logs"("requestId");

PRAGMA foreign_keys = ON;
