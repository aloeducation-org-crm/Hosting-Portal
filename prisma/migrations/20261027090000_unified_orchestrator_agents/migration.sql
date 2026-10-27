-- Unified platform: durable job orchestrator + secure server agents.
--
-- Applied on existing installs with:
--   node scripts/apply-deploy-schema.mjs
-- (the runner is idempotent and needs no Prisma schema-engine binary, which
-- cannot be downloaded on an offline / egress-filtered server).
--
-- No DROP, no DELETE, no data rewrite. Every ALTER adds a NULLable column or a
-- column with a safe default, so existing rows keep their values and the
-- running deployment pipeline is unaffected.

-- ── 1. Durable orchestrator columns on the existing job table ───────────────
-- `websiteId` stays NOT NULL because `audit_logs.operationJobId` points at this
-- table and a SQLite table rebuild would break that FK. Platform-wide jobs
-- therefore use the existing 'system' sentinel, exactly as `enqueueOperation`
-- in src/lib/operations.ts already does. Nothing is dropped or rewritten.
ALTER TABLE "operation_jobs" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "workerKind" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "riskLevel" TEXT NOT NULL DEFAULT 'READ_ONLY';
ALTER TABLE "operation_jobs" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "operation_jobs" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "operation_jobs" ADD COLUMN "retryPolicy" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "lastError" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "operation_jobs" ADD COLUMN "leaseExpiresAt" DATETIME;
ALTER TABLE "operation_jobs" ADD COLUMN "leasedBy" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "lockKey" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "operation_jobs" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "operation_jobs" ADD COLUMN "approvalNote" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "deadLetteredAt" DATETIME;
ALTER TABLE "operation_jobs" ADD COLUMN "deadLetterReason" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "operation_jobs" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "operation_jobs" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- SQLite cannot ADD COLUMN ... UNIQUE, so uniqueness lives in its own index.
-- (Multiple NULLs are allowed, which is exactly what "no key supplied" needs.)
CREATE UNIQUE INDEX IF NOT EXISTS "operation_jobs_idempotencyKey_key" ON "operation_jobs"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "operation_jobs_status_availableAt_idx" ON "operation_jobs"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "operation_jobs_lockKey_idx" ON "operation_jobs"("lockKey");
CREATE INDEX IF NOT EXISTS "operation_jobs_correlationId_idx" ON "operation_jobs"("correlationId");
CREATE INDEX IF NOT EXISTS "operation_jobs_leaseExpiresAt_idx" ON "operation_jobs"("leaseExpiresAt");

-- ── 2. Secure server agents ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "server_agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT,
    "name" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" TEXT,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "lastHeartbeat" DATETIME,
    "lastSeenIp" TEXT,
    "enrolledAt" DATETIME,
    "revokedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "server_agents_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "server_agents_agentKey_key" ON "server_agents"("agentKey");
CREATE INDEX IF NOT EXISTS "server_agents_status_idx" ON "server_agents"("status");
CREATE INDEX IF NOT EXISTS "server_agents_serverId_idx" ON "server_agents"("serverId");
CREATE INDEX IF NOT EXISTS "server_agents_lastHeartbeat_idx" ON "server_agents"("lastHeartbeat");

-- ── 3. Short-lived single-use enrollment tokens ────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_enrollment_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL UNIQUE,
    "prefix" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "serverId" TEXT,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "usedByIp" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "agent_enrollment_tokens_expiresAt_idx" ON "agent_enrollment_tokens"("expiresAt");

-- ── 4. Allowlisted agent tasks ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "jobId" TEXT,
    "correlationId" TEXT,
    "command" TEXT NOT NULL,
    "args" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "dispatchedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "exitCode" INTEGER,
    "result" TEXT,
    "logs" TEXT,
    "error" TEXT,
    "refuseReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "server_agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "agent_tasks_agentId_status_idx" ON "agent_tasks"("agentId", "status");
CREATE INDEX IF NOT EXISTS "agent_tasks_status_createdAt_idx" ON "agent_tasks"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "agent_tasks_jobId_idx" ON "agent_tasks"("jobId");

-- ── 5. Real metrics reported by agents ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "cpuPercent" REAL,
    "memoryUsedMb" REAL,
    "memoryTotalMb" REAL,
    "diskUsedGb" REAL,
    "diskTotalGb" REAL,
    "loadAvg1m" REAL,
    "uptimeSeconds" REAL,
    "netInKbps" REAL,
    "netOutKbps" REAL,
    "services" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_metrics_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "server_agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "agent_metrics_agentId_recordedAt_idx" ON "agent_metrics"("agentId", "recordedAt");

-- ── 6. Observed replication state (never assumed) ──────────────────────────
CREATE TABLE IF NOT EXISTS "replication_status" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT,
    "host" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "version" TEXT,
    "role" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "binlogEnabled" BOOLEAN,
    "gtidMode" TEXT,
    "binlogPosition" TEXT,
    "replicaOf" TEXT,
    "lagSeconds" INTEGER,
    "lastCheckedAt" DATETIME,
    "healthy" BOOLEAN,
    "detail" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "replication_status_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "replication_status_host_key" ON "replication_status"("host");
CREATE INDEX IF NOT EXISTS "replication_status_engine_idx" ON "replication_status"("engine");
