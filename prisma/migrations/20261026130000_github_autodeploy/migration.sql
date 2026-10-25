-- Git-connected automatic deployment — additive, non-destructive.
--
-- Applied on existing installs with:
--   node scripts/apply-deploy-schema.mjs
-- (that runner is idempotent and works without the Prisma schema-engine
-- binary, which cannot be downloaded on an offline server).
--
-- No DROP, no DELETE, no data rewrite. Every ALTER adds a NULLable column or a
-- column with a safe default, so existing rows keep their values.

-- ── 1. Git connections ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "git_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "mode" TEXT NOT NULL DEFAULT 'app',
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT,
    "installationId" TEXT,
    "tokenEncrypted" TEXT,
    "scopes" TEXT,
    "connectedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "git_connections_provider_accountLogin_key"
    ON "git_connections"("provider", "accountLogin");
CREATE INDEX IF NOT EXISTS "git_connections_installationId_idx"
    ON "git_connections"("installationId");

-- ── 2. Imported repositories / projects ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "git_projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "connectionId" TEXT,
    "repository" TEXT NOT NULL,
    "cloneUrl" TEXT NOT NULL,
    "productionBranch" TEXT NOT NULL DEFAULT 'main',
    "previewBranches" TEXT NOT NULL DEFAULT '[]',
    "autoDeploy" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "detection" TEXT,
    "config" TEXT,
    "detectionStatus" TEXT NOT NULL DEFAULT 'pending',
    "healthPath" TEXT NOT NULL DEFAULT '/',
    "healthUrl" TEXT,
    "serviceManager" TEXT NOT NULL DEFAULT 'static',
    "serviceName" TEXT,
    "releaseRoot" TEXT,
    "port" INTEGER,
    "webhookSecretEnc" TEXT,
    "webhookId" TEXT,
    "lastCommitSha" TEXT,
    "lastCommitMessage" TEXT,
    "lastCommitAuthor" TEXT,
    "lastDeployStatus" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "git_projects_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "git_projects_websiteId_key" ON "git_projects"("websiteId");
CREATE UNIQUE INDEX IF NOT EXISTS "git_projects_repository_productionBranch_key"
    ON "git_projects"("repository", "productionBranch");
CREATE INDEX IF NOT EXISTS "git_projects_connectionId_idx" ON "git_projects"("connectionId");

-- ── 3. Webhook delivery ledger (dedup + replay evidence) ────────────────────
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "repository" TEXT,
    "installationId" TEXT,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "projectId" TEXT,
    "deploymentId" TEXT,
    "payloadSha" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_deliveryId_key"
    ON "webhook_deliveries"("deliveryId");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_createdAt_idx" ON "webhook_deliveries"("createdAt");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_repository_idx" ON "webhook_deliveries"("repository");

-- ── 4. Extra deployment metadata ────────────────────────────────────────────
ALTER TABLE "deployments" ADD COLUMN "projectId" TEXT;
ALTER TABLE "deployments" ADD COLUMN "deliveryId" TEXT;
ALTER TABLE "deployments" ADD COLUMN "branch" TEXT;
ALTER TABLE "deployments" ADD COLUMN "commitMessage" TEXT;
ALTER TABLE "deployments" ADD COLUMN "commitAuthor" TEXT;
ALTER TABLE "deployments" ADD COLUMN "trigger" TEXT;
ALTER TABLE "deployments" ADD COLUMN "stage" TEXT;
ALTER TABLE "deployments" ADD COLUMN "failureStage" TEXT;
ALTER TABLE "deployments" ADD COLUMN "verifiedCommitSha" TEXT;
ALTER TABLE "deployments" ADD COLUMN "configSnapshot" TEXT;
ALTER TABLE "deployments" ADD COLUMN "durationMs" INTEGER;
CREATE INDEX IF NOT EXISTS "deployments_projectId_createdAt_idx" ON "deployments"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "deployments_deliveryId_idx" ON "deployments"("deliveryId");

-- ── 5. Repair pre-existing schema drift that makes /api/health report 503 ───
-- The committed db/custom.db predates these additive columns/table. Creating
-- them here is a schema fix, not a data change.
CREATE TABLE IF NOT EXISTS "hosting_sites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domainName" TEXT NOT NULL,
    "sslStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "provisioningStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "vhostPath" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hosting_sites_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "hosting_sites_domainName_key" ON "hosting_sites"("domainName");
CREATE INDEX IF NOT EXISTS "hosting_sites_serverId_idx" ON "hosting_sites"("serverId");
ALTER TABLE "servers" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "servers" ADD COLUMN "cpuUsage" REAL NOT NULL DEFAULT 0;
ALTER TABLE "servers" ADD COLUMN "memoryUsage" REAL NOT NULL DEFAULT 0;
ALTER TABLE "servers" ADD COLUMN "diskUsage" REAL NOT NULL DEFAULT 0;
