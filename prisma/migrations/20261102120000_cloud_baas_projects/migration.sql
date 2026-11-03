-- Cloud Projects (Appwrite-style BaaS and Sites console workspace).
-- Additive only: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- No existing tables, rows, foreign keys or configurations are altered.
-- Keep semicolons out of comment lines so the deploy applier splits cleanly.

CREATE TABLE IF NOT EXISTS "cloud_projects" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "organizationId" TEXT,
  "ownerId" TEXT NOT NULL,
  "region" TEXT NOT NULL DEFAULT 'local-primary',
  "stage" TEXT NOT NULL DEFAULT 'development',
  "frameworkPreset" TEXT NOT NULL DEFAULT 'nextjs',
  "renderingMode" TEXT NOT NULL DEFAULT 'ssr',
  "installCommand" TEXT NOT NULL DEFAULT 'npm ci',
  "buildCommand" TEXT NOT NULL DEFAULT 'npm run build',
  "outputDirectory" TEXT NOT NULL DEFAULT './.next',
  "linkedWebsiteId" TEXT,
  "linkedDatabaseId" TEXT,
  "linkedBucketId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_projects_slug_key" ON "cloud_projects"("slug");
CREATE INDEX IF NOT EXISTS "cloud_projects_ownerId_idx" ON "cloud_projects"("ownerId");
CREATE INDEX IF NOT EXISTS "cloud_projects_organizationId_idx" ON "cloud_projects"("organizationId");
CREATE INDEX IF NOT EXISTS "cloud_projects_status_idx" ON "cloud_projects"("status");

CREATE TABLE IF NOT EXISTS "cloud_project_keys" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT NOT NULL,
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  "lastUsedAt" DATETIME,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_project_keys_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_project_keys_keyHash_key" ON "cloud_project_keys"("keyHash");
CREATE INDEX IF NOT EXISTS "cloud_project_keys_projectId_idx" ON "cloud_project_keys"("projectId");
CREATE INDEX IF NOT EXISTS "cloud_project_keys_prefix_idx" ON "cloud_project_keys"("prefix");

CREATE TABLE IF NOT EXISTS "cloud_project_platforms" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_project_platforms_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_project_platforms_projectId_type_identifier_key" ON "cloud_project_platforms"("projectId", "type", "identifier");
CREATE INDEX IF NOT EXISTS "cloud_project_platforms_projectId_idx" ON "cloud_project_platforms"("projectId");

CREATE TABLE IF NOT EXISTS "cloud_project_webhooks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "events" TEXT NOT NULL,
  "signingKeyHash" TEXT NOT NULL,
  "signingKeyPrefix" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "tlsVerify" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_project_webhooks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cloud_project_webhooks_projectId_idx" ON "cloud_project_webhooks"("projectId");

CREATE TABLE IF NOT EXISTS "cloud_project_functions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "runtime" TEXT NOT NULL,
  "entrypoint" TEXT NOT NULL DEFAULT 'src/main.ts',
  "commands" TEXT,
  "events" TEXT NOT NULL DEFAULT '[]',
  "schedule" TEXT,
  "timeoutSeconds" INTEGER NOT NULL DEFAULT 15,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "executionState" TEXT NOT NULL DEFAULT 'REQUIRES_SETUP',
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_project_functions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_project_functions_projectId_slug_key" ON "cloud_project_functions"("projectId", "slug");
CREATE INDEX IF NOT EXISTS "cloud_project_functions_projectId_idx" ON "cloud_project_functions"("projectId");
