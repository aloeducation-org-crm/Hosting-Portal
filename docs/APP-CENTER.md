# App Center

An Odoo-style app marketplace for the hosting portal: every app is **defined
once** in a global catalog and then **reused by every company** (tenant). Each
company installs the apps it wants with **its own branding and settings** —
nothing about one tenant's configuration is shared with another's.

Apps in the built-in catalog: **Accounting, CRM, HR, Projects, Helpdesk, AI,
Documents, Website, Inventory, Marketing** — plus any custom app a platform
admin creates.

## Data model

Two tables, added by migration `20261028100000_app_center` (registered as
`ADDITIVE` in `scripts/apply-deploy-schema.mjs`):

| Table | Role |
| --- | --- |
| `app_definitions` | The catalog. One row per app (`slug` unique): name, summary, category, icon, accent color, `route` (deep link into the portal), `configSchema` (setting-field descriptors), `defaultSettings`, `status` (`active`/`hidden`), `isSystem` (built-ins are permanent). |
| `company_apps` | One row per **(app, organization)** — unique index `company_apps_appId_organizationId_key`. Holds `enabled`, per-company `branding` overrides (`name`, `logoUrl`, `accentColor`) and `settings` overrides. FK cascade: deleting a definition or a company removes only its install rows. |

`Organization.companyApps` is the back-relation. 85 → 87 Prisma models.

**Effective view** (what a UI renders for a selected company) is computed by
merging, never stored:

```
effectiveSettings  = configSchema field defaults  ⊕  definition.defaultSettings  ⊕  company.settings overrides
effectiveBranding  = definition.name/accentColor  ⊕  company.branding overrides (null clears)
```

Overrides for keys outside the current `configSchema` are ignored, so stale
rows stay harmless after an app's schema evolves (`src/lib/app-center.ts`).

## API

All routes require a session (`requireSession`) and write actions emit an
`audit_logs` row (`domain: "app-center"`).

| Route | Methods | Access |
| --- | --- | --- |
| `/api/apps` | `GET` (catalog + optional `?organizationId=` install state), `POST` (create definition) | GET: any signed-in user; POST: platform admin only (409 on slug conflict) |
| `/api/apps/[id]` | `GET`, `PATCH`, `DELETE` | GET: admin sees all installs, others only their companies'; PATCH/DELETE: admin. DELETE refuses built-ins (403) and apps with live installations (409) |
| `/api/apps/[id]/install` | `POST` (upsert install), `PATCH` (`?organizationId=` reconfigure), `DELETE` (`?organizationId=` uninstall) | Platform admin **or** OWNER/ADMIN member of that company (`canManageCompany`) |
| `/api/companies` | `GET` (admin → all, otherwise owned + memberships), `POST` (create company, caller becomes OWNER) | Any signed-in user |

`[id]` accepts either the UUID or the slug. Settings are validated against the
app's `configSchema` before they are stored (unknown keys and wrong types →
400 with a per-key error map). Hidden apps (`status: hidden`) are filtered out
of tenant catalog reads but visible to admins.

### The reuse invariant

`POST /api/apps/[id]/install` never touches the shared definition — it
creates/updates only that company's `company_apps` row. Uninstalling removes
only that row; other companies keep running the app. That is the multi-tenant
story in one sentence, and `tests/app-center.test.ts` asserts it directly
(two companies install the same definition with different branding/settings,
reconfigure one without touching the other, uninstall one while the other and
the definition survive).

## Built-in catalog

`BUILTIN_APPS` in `src/lib/app-center.ts` is the source of truth for built-ins
(slugs, icons, `configSchema`, defaults). Two things consume it:

1. **`prisma/seed.ts` → `seedAppCenter()`** — seeds the catalog plus two demo
   companies (*ALO Labs Hosting* and *Acme Cloud Apps*) with overlapping
   installs carrying different branding/settings. Skips with a warning if the
   migration hasn't run yet (guarded by an `sqlite_master` check).
2. **`ensureBuiltinApps(db)`** — called on every `GET /api/apps`. Production
   never runs the seed, so the API self-seeds any missing built-in. Existing
   rows are never overwritten (`create` only), so admin edits to a built-in
   survive. Races collapse into a harmless P2002 via the unique slug.

## UI

- **`/apps`** (`src/app/(dashboard)/apps/page.tsx` + `src/components/app-center/AppCenter.tsx`)
  — company switcher, category chips, search, app card grid with per-company
  effective branding, Install / Configure (Branding + Settings tabs, generated
  from `configSchema`) / Uninstall, and a **New app** dialog for admins.
  A **New company** dialog drives the multi-tenant demo end to end.
- Sidebar: *App Center* (LayoutGrid) in `DashboardShell.clientNavItems`.
- Middleware: `/apps` added to `DASHBOARD_UI_PREFIXES` (session required).
  Deliberately **not** added to `ADMIN_API_WRITE_PREFIXES` — install/uninstall
  writes must reach non-admin org owners; role checks live in the handlers.
- CSRF needs no per-component code: `CsrfGuard` in the root layout patches
  same-origin `fetch` for unsafe methods.

## Migration & deploy

- Hand-written additive SQL: `prisma/migrations/20261028100000_app_center/migration.sql`
  (`CREATE TABLE/INDEX IF NOT EXISTS` only, no comment-line semicolons — the
  applier strips comments then splits statements on `;`).
- Registered as `{ name: "20261028100000_app_center", kind: "ADDITIVE" }` in
  the applier's `MIGRATIONS` array. Deploy applies it via
  `scripts/apply-deploy-schema.mjs`; it is intentionally **not** listed in
  `REQUIRED_SCHEMA` (postconditions stay focused on deploy-critical tables).
- JSON columns use `JSONB` (Prisma's Json type on SQLite), matching
  `applications.config`.
- After schema changes run `npm run db:generate` (never `npx prisma generate`
  — it fails offline; `db:generate` skips engine downloads).

## Tests

`tests/app-center.test.ts` (30 tests):

1. **Migration contract** — additive-only statement shapes, no comment-line
   semicolons, registered in the applier, and an end-to-end run proving the
   applier recreates the tables when missing.
2. **Domain library** — slugify, zod schemas, `validateSettings` rejections,
   effective-settings/branding merge semantics, `mergeOverrides` null-clears,
   catalog sanity (unique slugs, known categories, valid defaults),
   `ensureBuiltinApps` idempotence + admin-edit preservation.
3. **Authorization** — platform admin vs OWNER vs MEMBER vs stranger.
4. **API** — 401 unauthenticated, admin-only definition writes, 409 slug
   conflict, company-scoped reads (403 for foreign companies), the full
   two-company install/reconfigure/uninstall isolation lifecycle, settings
   validation, built-in hide/protect rules.
5. **Companies** — per-user scoping, creation with OWNER membership.
6. **Routing** — `/apps` is dashboard-protected but not admin-only.

Tests copy `db/custom.db` via `tests/helpers/isolated-db.ts` (first import)
and call route handlers directly with `next-auth/jwt` cookies, mirroring
`tests/phase2-security-and-routes.test.ts`.

## Verification gate

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
