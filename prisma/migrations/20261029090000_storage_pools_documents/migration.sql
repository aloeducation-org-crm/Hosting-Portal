-- Phase 3 — §12 logical storage pools + §13 document management.
-- Additive only: new columns on storage_buckets (existing rows keep working
-- with kind defaulting to 'bucket') and a brand-new document_files table.
-- No data is dropped, rewritten or reformatted.

ALTER TABLE "storage_buckets" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'bucket';
ALTER TABLE "storage_buckets" ADD COLUMN "quotaBytes" BIGINT;
ALTER TABLE "storage_buckets" ADD COLUMN "policy" TEXT;
CREATE INDEX IF NOT EXISTS "storage_buckets_kind_idx" ON "storage_buckets"("kind");

CREATE TABLE IF NOT EXISTS "document_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poolKey" TEXT NOT NULL,
    "ownerId" TEXT,
    "organizationId" TEXT,
    "category" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_files_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "document_files_poolKey_ownerId_idx" ON "document_files"("poolKey", "ownerId");
CREATE INDEX IF NOT EXISTS "document_files_organizationId_idx" ON "document_files"("organizationId");
CREATE INDEX IF NOT EXISTS "document_files_category_idx" ON "document_files"("category");
