-- CRM ↔ Hosting-Portal service-to-service document vault integration.
-- Additive only: one brand-new table. No existing table is altered, rewritten,
-- dropped or reformatted, and no row is touched, so this cannot affect the
-- browser-session storage endpoints that already depend on document_files and
-- storage_buckets.
--
-- The credential secret is never stored — only its sha256 hex digest. A read of
-- this table therefore does not yield a usable credential.

CREATE TABLE IF NOT EXISTS "service_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceName" TEXT NOT NULL,
    "organizationId" TEXT,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedBy" TEXT,
    "revokeReason" TEXT,
    "lastUsedAt" DATETIME,
    "lastUsedService" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_credentials_keyHash_key" ON "service_credentials"("keyHash");
CREATE INDEX IF NOT EXISTS "service_credentials_organizationId_idx" ON "service_credentials"("organizationId");
CREATE INDEX IF NOT EXISTS "service_credentials_prefix_idx" ON "service_credentials"("prefix");
CREATE INDEX IF NOT EXISTS "service_credentials_isActive_idx" ON "service_credentials"("isActive");

-- Idempotency ledger. Its own table rather than a new column on document_files,
-- so the existing browser-session upload path is not altered at all. A unique
-- key makes a retried upload return the first attempt's stored response instead
-- of writing a second document.
CREATE TABLE IF NOT EXISTS "service_operation_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "resourceId" TEXT,
    "statusCode" INTEGER NOT NULL,
    "responseJson" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_operation_records_idempotencyKey_key" ON "service_operation_records"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "service_operation_records_organizationId_idx" ON "service_operation_records"("organizationId");
CREATE INDEX IF NOT EXISTS "service_operation_records_serviceName_idx" ON "service_operation_records"("serviceName");
