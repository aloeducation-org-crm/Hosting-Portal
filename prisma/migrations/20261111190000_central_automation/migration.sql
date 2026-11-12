-- Additive central automation persistence. No customer rows are rewritten.
CREATE TABLE IF NOT EXISTS "automation_workflows" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "ownerId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "definition" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "eventName" TEXT,
  "intervalSeconds" INTEGER,
  "nextRunAt" DATETIME,
  "lastRunAt" DATETIME,
  "scheduleInput" TEXT NOT NULL DEFAULT '{}',
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_workflows_key_key" ON "automation_workflows"("key");
CREATE INDEX IF NOT EXISTS "automation_workflows_enabled_trigger_nextRunAt_idx" ON "automation_workflows"("enabled", "trigger", "nextRunAt");
CREATE INDEX IF NOT EXISTS "automation_workflows_eventName_idx" ON "automation_workflows"("eventName");
CREATE INDEX IF NOT EXISTS "automation_workflows_ownerId_idx" ON "automation_workflows"("ownerId");

CREATE TABLE IF NOT EXISTS "automation_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowId" TEXT NOT NULL,
  "workflowVersion" INTEGER NOT NULL,
  "snapshot" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "input" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "output" TEXT,
  "error" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT 0,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "actorRole" TEXT,
  "actorScopes" TEXT NOT NULL DEFAULT '[]',
  "resourceId" TEXT,
  "resourceType" TEXT,
  "notificationId" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "durationMs" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "automation_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_runs_idempotencyKey_key" ON "automation_runs"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "automation_runs_workflowId_createdAt_idx" ON "automation_runs"("workflowId", "createdAt");
CREATE INDEX IF NOT EXISTS "automation_runs_status_idx" ON "automation_runs"("status");
CREATE INDEX IF NOT EXISTS "automation_runs_resourceType_resourceId_idx" ON "automation_runs"("resourceType", "resourceId");

CREATE TABLE IF NOT EXISTS "automation_steps" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "handler" TEXT NOT NULL,
  "dependsOn" TEXT NOT NULL DEFAULT '[]',
  "inputTemplate" TEXT NOT NULL DEFAULT '{}',
  "condition" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "jobId" TEXT,
  "output" TEXT,
  "error" TEXT,
  "verified" BOOLEAN,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_steps_runId_key_key" ON "automation_steps"("runId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "automation_steps_jobId_key" ON "automation_steps"("jobId");
CREATE INDEX IF NOT EXISTS "automation_steps_runId_ordinal_idx" ON "automation_steps"("runId", "ordinal");
CREATE INDEX IF NOT EXISTS "automation_steps_status_idx" ON "automation_steps"("status");

CREATE TABLE IF NOT EXISTS "automation_profiles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "framework" TEXT,
  "ownerId" TEXT,
  "activeVersion" INTEGER,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_profiles_key_key" ON "automation_profiles"("key");
CREATE INDEX IF NOT EXISTS "automation_profiles_kind_framework_ownerId_idx" ON "automation_profiles"("kind", "framework", "ownerId");

CREATE TABLE IF NOT EXISTS "automation_profile_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "profileId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "config" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VALIDATED',
  "changeNote" TEXT,
  "verificationJobId" TEXT,
  "verificationError" TEXT,
  "verifiedById" TEXT,
  "verifiedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_profile_versions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "automation_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "automation_profile_versions_profileId_version_key" ON "automation_profile_versions"("profileId", "version");
CREATE INDEX IF NOT EXISTS "automation_profile_versions_status_idx" ON "automation_profile_versions"("status");
