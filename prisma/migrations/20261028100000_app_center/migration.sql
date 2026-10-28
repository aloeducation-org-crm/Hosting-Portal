-- App Center: one catalog definition per app, one installation row per company.
--
-- `app_definitions` holds each app exactly once (Odoo-style): Accounting, CRM,
-- HR, Projects, Helpdesk, AI, Documents, Website and friends. Built-ins are
-- seeded with `isSystem = true` so the catalog survives per-tenant churn.
--
-- `company_apps` is the per-tenant layer: every organization that installs an
-- app gets its own row with independent `branding` (display name, logo, accent
-- colour) and `settings` overrides over the definition's `configSchema` /
-- `defaultSettings`. The unique (appId, organizationId) pair makes install an
-- upsert and guarantees the same app can be reused across any number of
-- companies without shared mutable state.
--
-- JSON payloads are stored as JSONB (Prisma Json on SQLite) exactly like
-- `applications.config`. The deploy applier executes this file statement by
-- statement, so it stays additive -- CREATE/INDEX IF NOT EXISTS only, no DROP,
-- no DELETE, no data rewrite.

CREATE TABLE IF NOT EXISTS "app_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'productivity',
    "icon" TEXT,
    "accentColor" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "route" TEXT,
    "configSchema" JSONB,
    "defaultSettings" JSONB,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_definitions_slug_key" ON "app_definitions"("slug");

CREATE INDEX IF NOT EXISTS "app_definitions_category_idx" ON "app_definitions"("category");

CREATE INDEX IF NOT EXISTS "app_definitions_status_idx" ON "app_definitions"("status");

CREATE TABLE IF NOT EXISTS "company_apps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "branding" JSONB,
    "settings" JSONB,
    "installedBy" TEXT,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_apps_appId_fkey" FOREIGN KEY ("appId") REFERENCES "app_definitions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "company_apps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_apps_appId_organizationId_key" ON "company_apps"("appId", "organizationId");

CREATE INDEX IF NOT EXISTS "company_apps_organizationId_idx" ON "company_apps"("organizationId");

CREATE INDEX IF NOT EXISTS "company_apps_appId_idx" ON "company_apps"("appId");
