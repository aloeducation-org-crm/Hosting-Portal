-- Full Appwrite-style Cloud Platform additive tables (Phases 1 to 6).
-- Additive only: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- No existing tables, columns, or data are altered or removed.
-- Keep semicolons out of comment lines so scripts/apply-deploy-schema.mjs splits cleanly.

CREATE TABLE IF NOT EXISTS "cloud_environments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "branchPattern" TEXT NOT NULL DEFAULT 'main',
  "isProtected" BOOLEAN NOT NULL DEFAULT false,
  "requireApproval" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_environments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_environments_projectId_slug_key" ON "cloud_environments"("projectId", "slug");
CREATE INDEX IF NOT EXISTS "cloud_environments_projectId_idx" ON "cloud_environments"("projectId");

CREATE TABLE IF NOT EXISTS "cloud_secrets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "environmentSlug" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "sealedValue" TEXT NOT NULL,
  "isSecret" BOOLEAN NOT NULL DEFAULT true,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "accessScope" TEXT NOT NULL DEFAULT 'build_and_runtime',
  "rotatedAt" DATETIME,
  "updatedBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_secrets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_secrets_projectId_environmentSlug_key_key" ON "cloud_secrets"("projectId", "environmentSlug", "key");
CREATE INDEX IF NOT EXISTS "cloud_secrets_projectId_environmentSlug_idx" ON "cloud_secrets"("projectId", "environmentSlug");

CREATE TABLE IF NOT EXISTS "cloud_secret_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "secretId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "sealedValue" TEXT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_secret_versions_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "cloud_secrets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_secret_versions_secretId_version_key" ON "cloud_secret_versions"("secretId", "version");
CREATE INDEX IF NOT EXISTS "cloud_secret_versions_secretId_idx" ON "cloud_secret_versions"("secretId");

CREATE TABLE IF NOT EXISTS "cloud_key_usage_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "scopeUsed" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_key_usage_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cloud_key_usage_events_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "cloud_project_keys" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cloud_key_usage_events_projectId_createdAt_idx" ON "cloud_key_usage_events"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "cloud_key_usage_events_keyId_createdAt_idx" ON "cloud_key_usage_events"("keyId", "createdAt");

CREATE TABLE IF NOT EXISTS "cloud_key_rotations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "oldKeyId" TEXT NOT NULL,
  "newKeyId" TEXT NOT NULL,
  "graceExpiresAt" DATETIME,
  "rotatedBy" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_key_rotations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cloud_key_rotations_projectId_idx" ON "cloud_key_rotations"("projectId");
CREATE INDEX IF NOT EXISTS "cloud_key_rotations_oldKeyId_idx" ON "cloud_key_rotations"("oldKeyId");

CREATE TABLE IF NOT EXISTS "cloud_project_members" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'DEVELOPER',
  "scopes" TEXT NOT NULL DEFAULT '[]',
  "expiresAt" DATETIME,
  "addedBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_project_members_projectId_userId_key" ON "cloud_project_members"("projectId", "userId");
CREATE INDEX IF NOT EXISTS "cloud_project_members_projectId_idx" ON "cloud_project_members"("projectId");
CREATE INDEX IF NOT EXISTS "cloud_project_members_userId_idx" ON "cloud_project_members"("userId");

CREATE TABLE IF NOT EXISTS "cloud_worker_nodes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workerKey" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "pid" INTEGER NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'ISOLATED_SUBPROCESS',
  "capabilities" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'ONLINE',
  "activeJobs" INTEGER NOT NULL DEFAULT 0,
  "maxConcurrency" INTEGER NOT NULL DEFAULT 2,
  "cpuCores" INTEGER,
  "memoryTotalMb" INTEGER,
  "lastHeartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_worker_nodes_workerKey_key" ON "cloud_worker_nodes"("workerKey");
CREATE INDEX IF NOT EXISTS "cloud_worker_nodes_status_idx" ON "cloud_worker_nodes"("status");
CREATE INDEX IF NOT EXISTS "cloud_worker_nodes_lastHeartbeatAt_idx" ON "cloud_worker_nodes"("lastHeartbeatAt");

CREATE TABLE IF NOT EXISTS "cloud_site_repositories" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'github',
  "repository" TEXT NOT NULL,
  "cloneUrl" TEXT NOT NULL,
  "productionBranch" TEXT NOT NULL DEFAULT 'main',
  "previewBranches" TEXT NOT NULL DEFAULT '["*"]',
  "autoDeploy" BOOLEAN NOT NULL DEFAULT true,
  "webhookSecretSealed" TEXT,
  "detectedFramework" TEXT NOT NULL DEFAULT '{}',
  "overrideConfig" TEXT NOT NULL DEFAULT '{}',
  "cacheKey" TEXT,
  "lastCommitSha" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_site_repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_site_repositories_projectId_key" ON "cloud_site_repositories"("projectId");
CREATE INDEX IF NOT EXISTS "cloud_site_repositories_repository_idx" ON "cloud_site_repositories"("repository");

CREATE TABLE IF NOT EXISTS "cloud_site_deployments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "environmentSlug" TEXT NOT NULL DEFAULT 'production',
  "releaseImmutableId" TEXT NOT NULL,
  "commitSha" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "pullRequestNumber" INTEGER,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "promotedFromDeploymentId" TEXT,
  "rollbackOfDeploymentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "jobId" TEXT,
  "workerId" TEXT,
  "artifactPath" TEXT,
  "previewSubdomain" TEXT,
  "buildDurationMs" INTEGER,
  "buildCacheHit" BOOLEAN NOT NULL DEFAULT false,
  "healthCheckPassed" BOOLEAN NOT NULL DEFAULT false,
  "buildLogs" TEXT NOT NULL DEFAULT '',
  "errorSummary" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "maxAttempts" INTEGER NOT NULL DEFAULT 2,
  "createdBy" TEXT NOT NULL,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_site_deployments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_site_deployments_releaseImmutableId_key" ON "cloud_site_deployments"("releaseImmutableId");
CREATE INDEX IF NOT EXISTS "cloud_site_deployments_projectId_environmentSlug_createdAt_idx" ON "cloud_site_deployments"("projectId", "environmentSlug", "createdAt");
CREATE INDEX IF NOT EXISTS "cloud_site_deployments_projectId_status_idx" ON "cloud_site_deployments"("projectId", "status");

CREATE TABLE IF NOT EXISTS "cloud_custom_domains" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "environmentSlug" TEXT NOT NULL DEFAULT 'production',
  "hostname" TEXT NOT NULL,
  "isPlatformSubdomain" BOOLEAN NOT NULL DEFAULT false,
  "verificationTxtName" TEXT NOT NULL,
  "verificationTxtValue" TEXT NOT NULL,
  "dnsVerified" BOOLEAN NOT NULL DEFAULT false,
  "dnsVerifiedAt" DATETIME,
  "tlsStatus" TEXT NOT NULL DEFAULT 'PENDING_DNS',
  "tlsVerifiedAt" DATETIME,
  "certExpiresAt" DATETIME,
  "redirectToHost" TEXT,
  "redirectStatusCode" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "lastCheckedAt" DATETIME,
  "lastError" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_custom_domains_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_custom_domains_hostname_key" ON "cloud_custom_domains"("hostname");
CREATE INDEX IF NOT EXISTS "cloud_custom_domains_projectId_idx" ON "cloud_custom_domains"("projectId");
CREATE INDEX IF NOT EXISTS "cloud_custom_domains_status_idx" ON "cloud_custom_domains"("status");

CREATE TABLE IF NOT EXISTS "cloud_database_instances" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "engine" TEXT NOT NULL,
  "environmentSlug" TEXT NOT NULL DEFAULT 'development',
  "status" TEXT NOT NULL DEFAULT 'PROVISIONING',
  "isolatedFilePath" TEXT,
  "host" TEXT,
  "port" INTEGER,
  "databaseName" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordSealed" TEXT NOT NULL,
  "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  "maxConnections" INTEGER NOT NULL DEFAULT 20,
  "storageLimitMb" INTEGER NOT NULL DEFAULT 512,
  "storageUsedBytes" INTEGER NOT NULL DEFAULT 0,
  "healthStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "lastHealthCheckAt" DATETIME,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_database_instances_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_database_instances_projectId_slug_key" ON "cloud_database_instances"("projectId", "slug");
CREATE INDEX IF NOT EXISTS "cloud_database_instances_projectId_idx" ON "cloud_database_instances"("projectId");

CREATE TABLE IF NOT EXISTS "cloud_database_backups" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "databaseId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "archivePath" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "credentialVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "restoredCount" INTEGER NOT NULL DEFAULT 0,
  "lastRestoredAt" DATETIME,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_database_backups_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "cloud_database_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cloud_database_backups_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cloud_database_backups_databaseId_createdAt_idx" ON "cloud_database_backups"("databaseId", "createdAt");
CREATE INDEX IF NOT EXISTS "cloud_database_backups_projectId_idx" ON "cloud_database_backups"("projectId");

CREATE TABLE IF NOT EXISTS "cloud_storage_buckets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "allowedMimeTypes" TEXT NOT NULL DEFAULT '[]',
  "maxFileSizeBytes" INTEGER NOT NULL DEFAULT 26214400,
  "quotaBytes" INTEGER NOT NULL DEFAULT 536870912,
  "usedBytes" INTEGER NOT NULL DEFAULT 0,
  "objectCount" INTEGER NOT NULL DEFAULT 0,
  "lifecycleDeleteDays" INTEGER,
  "versioningEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_buckets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_storage_buckets_projectId_slug_key" ON "cloud_storage_buckets"("projectId", "slug");
CREATE INDEX IF NOT EXISTS "cloud_storage_buckets_projectId_idx" ON "cloud_storage_buckets"("projectId");

CREATE TABLE IF NOT EXISTS "cloud_storage_objects" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bucketId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "storageRelPath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "expiresAt" DATETIME,
  "uploadedBy" TEXT NOT NULL,
  "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_objects_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "cloud_storage_buckets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cloud_storage_objects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_storage_objects_bucketId_objectKey_key" ON "cloud_storage_objects"("bucketId", "objectKey");
CREATE INDEX IF NOT EXISTS "cloud_storage_objects_projectId_idx" ON "cloud_storage_objects"("projectId");
CREATE INDEX IF NOT EXISTS "cloud_storage_objects_expiresAt_idx" ON "cloud_storage_objects"("expiresAt");

CREATE TABLE IF NOT EXISTS "cloud_storage_backups" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bucketId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "manifestJson" TEXT NOT NULL,
  "archiveDir" TEXT NOT NULL,
  "objectCount" INTEGER NOT NULL,
  "totalBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_backups_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "cloud_storage_buckets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cloud_storage_backups_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cloud_storage_backups_bucketId_createdAt_idx" ON "cloud_storage_backups"("bucketId", "createdAt");
CREATE INDEX IF NOT EXISTS "cloud_storage_backups_projectId_idx" ON "cloud_storage_backups"("projectId");

CREATE TABLE IF NOT EXISTS "cloud_function_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "functionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "runtime" TEXT NOT NULL,
  "entrypoint" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL DEFAULT 'inline',
  "sourceCode" TEXT NOT NULL,
  "codeSha256" TEXT NOT NULL,
  "memoryLimitMb" INTEGER NOT NULL DEFAULT 128,
  "cpuLimitSeconds" INTEGER NOT NULL DEFAULT 5,
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "maxRetries" INTEGER NOT NULL DEFAULT 0,
  "environmentSlug" TEXT NOT NULL DEFAULT 'production',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "verifiedCompatible" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_function_versions_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "cloud_project_functions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_function_versions_functionId_version_key" ON "cloud_function_versions"("functionId", "version");
CREATE INDEX IF NOT EXISTS "cloud_function_versions_functionId_isActive_idx" ON "cloud_function_versions"("functionId", "isActive");

CREATE TABLE IF NOT EXISTS "cloud_function_executions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "functionId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "triggerKind" TEXT NOT NULL DEFAULT 'http',
  "triggerEvent" TEXT,
  "requestPayloadJson" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  "workerId" TEXT,
  "exitCode" INTEGER,
  "durationMs" INTEGER,
  "memoryLimitMb" INTEGER NOT NULL DEFAULT 128,
  "responseBody" TEXT,
  "stdoutLog" TEXT NOT NULL DEFAULT '',
  "stderrLog" TEXT NOT NULL DEFAULT '',
  "errorCode" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_function_executions_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "cloud_project_functions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cloud_function_executions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "cloud_function_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cloud_function_executions_functionId_createdAt_idx" ON "cloud_function_executions"("functionId", "createdAt");
CREATE INDEX IF NOT EXISTS "cloud_function_executions_projectId_status_idx" ON "cloud_function_executions"("projectId", "status");

CREATE TABLE IF NOT EXISTS "cloud_webhook_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "webhookId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "signatureHeader" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" DATETIME,
  "resolvedIp" TEXT,
  "httpStatus" INTEGER,
  "durationMs" INTEGER,
  "responseSnippet" TEXT,
  "failureReason" TEXT,
  "deliveredAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "cloud_project_webhooks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cloud_webhook_deliveries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cloud_webhook_deliveries_webhookId_createdAt_idx" ON "cloud_webhook_deliveries"("webhookId", "createdAt");
CREATE INDEX IF NOT EXISTS "cloud_webhook_deliveries_projectId_status_nextAttemptAt_idx" ON "cloud_webhook_deliveries"("projectId", "status", "nextAttemptAt");

CREATE TABLE IF NOT EXISTS "cloud_usage_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "idempotencyKey" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "quantity" REAL NOT NULL,
  "unit" TEXT NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_usage_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_usage_events_idempotencyKey_key" ON "cloud_usage_events"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "cloud_usage_events_projectId_metric_recordedAt_idx" ON "cloud_usage_events"("projectId", "metric", "recordedAt");
CREATE INDEX IF NOT EXISTS "cloud_usage_events_ownerId_recordedAt_idx" ON "cloud_usage_events"("ownerId", "recordedAt");

CREATE TABLE IF NOT EXISTS "cloud_project_quotas" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "planCode" TEXT NOT NULL DEFAULT 'standard-configurable',
  "maxBuildMinutesMonthly" REAL NOT NULL DEFAULT 300,
  "maxFunctionExecMsMonthly" REAL NOT NULL DEFAULT 600000,
  "maxDatabaseBytes" INTEGER NOT NULL DEFAULT 1073741824,
  "maxStorageBytes" INTEGER NOT NULL DEFAULT 2147483648,
  "maxStorageBandwidthBytes" INTEGER NOT NULL DEFAULT 10737418240,
  "maxDeploymentsMonthly" INTEGER NOT NULL DEFAULT 200,
  "maxFunctions" INTEGER NOT NULL DEFAULT 25,
  "maxDatabases" INTEGER NOT NULL DEFAULT 10,
  "maxBuckets" INTEGER NOT NULL DEFAULT 20,
  "hardEnforce" BOOLEAN NOT NULL DEFAULT true,
  "updatedBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_project_quotas_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cloud_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloud_project_quotas_projectId_key" ON "cloud_project_quotas"("projectId");
