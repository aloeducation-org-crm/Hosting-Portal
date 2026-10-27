# Production Deployment Audit — 2026-10-27

## Scope and evidence

This audit used the repository files and GitHub Actions workflow/job logs available through GitHub. It did not access the production host over SSH, inspect its live database, or change services, DNS, firewall rules, or production data.

Canonical application: repository root (`package.json`, `src/`, `prisma/schema.prisma`). The nested `alo-hosting-portal/` directory is a legacy snapshot and must not be selected as the canonical application.

## Verified workflow findings

- Workflow run [#38](https://github.com/aloeducation-org-crm/Hosting-Portal/actions/runs/40427809789): lint, typecheck, tests and build passed, but production deployment failed at `npm ci` because the production checkout had no `package-lock.json`.
- Workflow run [#31](https://github.com/aloeducation-org-crm/Hosting-Portal/actions/runs/40256080253): the deployment helper refused to continue because `/etc/alo-hosting/panel.env` was missing or unreadable.
- Workflow run [#43](https://github.com/aloeducation-org-crm/Hosting-Portal/actions/runs/40439634377): CI, build and deployment steps reported success. The logs show the fallback PM2 process name `alo-hosting` was restarted and `/api/health` returned database-connected status. This does not independently prove that the process working directory, release SHA, login route, registration route, or public request path match the intended release.

## Change in this branch

The production workflow now performs a read-only preflight before its deployment script:
- checks that the expected production checkout exists;
- checks the canonical root `package.json` and `package-lock.json`;
- refuses to continue if the production checkout contains tracked or untracked local changes, instead of silently checking out or pulling over them.

This is intentionally fail-closed. It does not repair a missing lockfile or environment file, run migrations, restart services, or deploy anything. Those actions need an operator to reconcile the production host after inspecting its state.

## Database compatibility

The checked-in Prisma schema declares SQLite and uses the libSQL adapter for `file:` URLs. A PostgreSQL or MySQL/MariaDB service may exist for another workload, but it must not be assumed to be this panel's production database. Verify the live `DATABASE_URL` scheme without printing its value, the actual DB path, schema drift and restore process on the host before any database change.

## Required next server-side checks

Run `bash scripts/server-doctor.sh` from the canonical repository root on the production host. Review its output before making changes. Specifically verify:
- the actual process manager and working directory;
- the active release identity and health, login and registration routes;
- whether `/etc/alo-hosting/panel.env` exists with correct ownership and permissions, without printing its contents;
- whether the absolute SQLite DB file exists outside the repository and matches the configured URL;
- schema drift, backup freshness, restore evidence, reverse proxy and tunnel routing.

Do not run a checkout reset, database reset, migration, DNS change or service restart as part of this read-only audit.

## Limits

No claim is made that production is currently healthy, that any live database migration ran, that a backup was restored, or that 500+ concurrent users are supported. Those require live-host evidence and load/restore testing.
