-- Cloud Foundation v2 forward-only additions (Phases 1 through 6 hardening).
-- This migration is additive: it only adds nullable columns and indexes.
-- Existing Cloud Platform installs remain fully readable and no row is deleted.
-- Keep semicolons out of comment lines for scripts/apply-deploy-schema.mjs.

ALTER TABLE "cloud_projects" ADD COLUMN "gitConnectionId" TEXT;
ALTER TABLE "cloud_projects" ADD COLUMN "gitProjectId" TEXT;
ALTER TABLE "cloud_projects" ADD COLUMN "deletionRequestedAt" DATETIME;
ALTER TABLE "cloud_projects" ADD COLUMN "deletionRequestedBy" TEXT;
ALTER TABLE "cloud_projects" ADD COLUMN "deletionTokenHash" TEXT;
CREATE INDEX IF NOT EXISTS "cloud_projects_gitConnectionId_idx" ON "cloud_projects"("gitConnectionId");
CREATE INDEX IF NOT EXISTS "cloud_projects_gitProjectId_idx" ON "cloud_projects"("gitProjectId");
CREATE INDEX IF NOT EXISTS "cloud_projects_deletionRequestedAt_idx" ON "cloud_projects"("deletionRequestedAt");

ALTER TABLE "cloud_project_webhooks" ADD COLUMN "signingSecretSealed" TEXT;

ALTER TABLE "cloud_worker_nodes" ADD COLUMN "workerSecretHash" TEXT;
ALTER TABLE "cloud_worker_nodes" ADD COLUMN "workerSecretPrefix" TEXT;
CREATE INDEX IF NOT EXISTS "cloud_worker_nodes_workerSecretPrefix_idx" ON "cloud_worker_nodes"("workerSecretPrefix");

ALTER TABLE "cloud_site_deployments" ADD COLUMN "cancellationRequestedAt" DATETIME;
CREATE INDEX IF NOT EXISTS "cloud_site_deployments_cancellationRequestedAt_idx" ON "cloud_site_deployments"("cancellationRequestedAt");

ALTER TABLE "cloud_function_executions" ADD COLUMN "maxRssKb" INTEGER;
