-- Software Factory foundations: Industry System Registry, Service Catalog and
-- the industry-to-service applicability map.
--
-- industry_systems holds the 20 distinct industry software product families.
-- Each row carries structured JSON (modules, feature catalogue, challenges,
-- workflow, FAQs, reports) consumed by the Super Admin registry and by the
-- public /industries landing pages, so industry content is data, not markup.
--
-- service_catalog holds sellable deliverables separately from applications.
-- Pricing is deliberately quotation-based: there are no price columns, so no
-- unverified number can ever be displayed.
--
-- service_industries is the §9 mapping: which services are core, recommended
-- or optional for each industry family. Cascade both ways keeps the map clean
-- when an admin retires a record.
--
-- The contacts ALTERs add nullable funnel columns (source, industry, service,
-- status) so public enquiries can flow into the Client CRM without rewriting
-- existing rows. Additive only: CREATE/INDEX IF NOT EXISTS and nullable
-- ADD COLUMN, no DROP, no DELETE, no data rewrite.

CREATE TABLE IF NOT EXISTS "industry_systems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Building2',
    "accentFrom" TEXT NOT NULL DEFAULT '#4f46e5',
    "accentTo" TEXT NOT NULL DEFAULT '#9333ea',
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'published',
    "modules" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "challenges" JSONB NOT NULL,
    "workflow" JSONB NOT NULL,
    "faqs" JSONB NOT NULL,
    "reports" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "industry_systems_slug_key" ON "industry_systems"("slug");

CREATE INDEX IF NOT EXISTS "industry_systems_status_idx" ON "industry_systems"("status");

CREATE TABLE IF NOT EXISTS "service_catalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "deliverables" JSONB NOT NULL,
    "prerequisites" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL,
    "requiredApps" JSONB NOT NULL,
    "priceMode" TEXT NOT NULL DEFAULT 'quotation',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "status" TEXT NOT NULL DEFAULT 'published',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_catalog_slug_key" ON "service_catalog"("slug");

CREATE INDEX IF NOT EXISTS "service_catalog_status_idx" ON "service_catalog"("status");

CREATE INDEX IF NOT EXISTS "service_catalog_category_idx" ON "service_catalog"("category");

CREATE TABLE IF NOT EXISTS "service_industries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'recommended',
    CONSTRAINT "service_industries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service_catalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "service_industries_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industry_systems" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_industries_serviceId_industryId_key" ON "service_industries"("serviceId", "industryId");

CREATE INDEX IF NOT EXISTS "service_industries_industryId_idx" ON "service_industries"("industryId");

ALTER TABLE "contacts" ADD COLUMN "source" TEXT;

ALTER TABLE "contacts" ADD COLUMN "industry" TEXT;

ALTER TABLE "contacts" ADD COLUMN "service" TEXT;

ALTER TABLE "contacts" ADD COLUMN "status" TEXT;
