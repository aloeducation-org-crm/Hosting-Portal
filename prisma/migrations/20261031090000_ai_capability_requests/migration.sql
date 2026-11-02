-- Additive only. Internal review records, NOT execution permissions by themselves.
-- No existing tables, configuration, project files or records are changed.
CREATE TABLE IF NOT EXISTS "ai_capability_requests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetReference" TEXT NOT NULL,
  "targetSha256" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "authorizationEvidence" TEXT NOT NULL,
  "scopeDigest" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "requestedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewedAt" DATETIME,
  "expiresAt" DATETIME,
  "reviewReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ai_capability_requests_projectId_createdAt_idx" ON "ai_capability_requests"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_capability_requests_status_expiresAt_idx" ON "ai_capability_requests"("status", "expiresAt");
