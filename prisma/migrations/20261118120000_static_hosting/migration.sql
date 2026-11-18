-- Add only: no existing records or tables are rewritten.
CREATE TABLE IF NOT EXISTS "static_hosting_sites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "requestedRef" TEXT,
    "sourceBranch" TEXT,
    "commitSha" TEXT,
    "treeSha" TEXT,
    "initialJobId" TEXT,
    "withdrawnAt" DATETIME,
    "queueError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "static_hosting_sites_hostname_key" ON "static_hosting_sites"("hostname");
CREATE UNIQUE INDEX IF NOT EXISTS "static_hosting_sites_initialJobId_key" ON "static_hosting_sites"("initialJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "static_hosting_sites_ownerId_requestId_key" ON "static_hosting_sites"("ownerId", "requestId");
CREATE INDEX IF NOT EXISTS "static_hosting_sites_ownerId_createdAt_idx" ON "static_hosting_sites"("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "static_hosting_sites_initialJobId_queueError_createdAt_idx" ON "static_hosting_sites"("initialJobId", "queueError", "createdAt");
CREATE INDEX IF NOT EXISTS "operation_jobs_resourceType_resourceId_type_createdAt_idx" ON "operation_jobs"("resourceType", "resourceId", "type", "createdAt");
