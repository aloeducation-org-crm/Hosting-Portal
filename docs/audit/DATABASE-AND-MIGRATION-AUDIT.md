# Database and Migration Audit

> Measured at `d1dc3d0`. No database was created, migrated, restored, or written
> outside a disposable temp copy. The tracked fixture `db/custom.db` is
> byte-identical to `HEAD` after this session (`git status --porcelain db/` is
> empty), including after the migration suite ran against copies.

## 1. Engine — what is actually true

| Question | Answer | Evidence |
|---|---|---|
| Declared provider | **SQLite** (`provider = "sqlite"`) | `prisma/schema.prisma:7` |
| Client engine | `engineType = "client"` with `@prisma/adapter-libsql` | `schema.prisma:3`, `src/lib/db.ts` |
| PostgreSQL / MySQL driver installed | **No** | `package.json` has no `pg`, `mysql2` or `mariadb` |
| Production location (documented) | a file under `/var/lib/alo-hosting/` | `deploy/`, prior audit. **Not verified from here.** |
| Application-layer raw SQL | 2 statements, both in the health probe | `src/lib/health.ts` |
| `$queryRawUnsafe` | 2, both over compile-time constants, identifier-validated | `requireIdentifier()` added this pass |
| Schema drift control | `scripts/apply-deploy-schema.mjs` (additive-by-default) | see §4 |

**SQLite, PostgreSQL and MariaDB are not interchangeable here.** The hosting
product's *database management* feature provisions MariaDB and PostgreSQL
instances for customers through `helpers/alo-database-helper`, but the control
plane's own data lives in one SQLite file. `tests/database-provisioning.test.ts`
covers the helper contract; no MySQL/PostgreSQL server exists in this environment,
so the helper's server side is **unverified**.

## 2. Schema facts

| Metric | Value |
|---|---|
| Models | 124 |
| Enums | 17 |
| `@@index` declarations | 245 |
| `@@unique` constraints | 35 |
| `@relation` foreign keys | 128 |

## 3. Migration history

16 directories under `prisma/migrations`, oldest first:

```
0_init                                      20261025180000_ai_workflow_runs
20260721052322_init                         20261026130000_github_autodeploy
20261027090000_unified_orchestrator_agents  20261027093000_operation_jobs_platform_scope
20261027120000_agent_request_nonces         20261028100000_app_center
20261028130000_software_factory             20261029090000_storage_pools_documents
20261029120000_service_credentials          20261031090000_ai_capability_requests
20261102120000_cloud_baas_projects          20261104090000_cloud_platform_full
20261104110000_cloud_foundation_v2          20261111190000_central_automation
```

**No historical migration was edited or deleted by this pass.** The schema was
not changed: SEC-03 reused existing `Subscription`/`Order`/`Invoice` columns, so
**zero migrations are required for this branch**. That is deliberate — a security
fix must not force a production migration.

## 4. The migration applier, and why it is the right tool here

`prisma migrate deploy` is not used in production because (a) the schema engine
binary cannot be fetched on an egress-filtered host with `engineType = "client"`,
and (b) existing installs have no `_prisma_migrations` table, so a replay of
`0_init` would run against live data.

`scripts/apply-deploy-schema.mjs` instead classifies every change:

| Class | Behaviour |
|---|---|
| **ADDITIVE** | create table/index, add nullable/defaulted column. Idempotent. Runs by default. |
| **REBUILD** | SQLite table rewrite. **Never** runs by default. Requires `--allow-rebuild` **and** `--backup <file>` of *this* database, then runs in one `BEGIN IMMEDIATE` with preconditions, orphan cleanup, and postconditions on table existence, columns, row counts, foreign-key text, `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. |

Verified by running `npx vitest run tests/migration-safety.test.ts`:

```
✓ table-rebuild authorization (7)
✓ interrupted rebuild recovery (5)
   ✓ never reports success after an interruption that dropped audit_logs
   ✓ recovers from the documented procedure: restore the verified backup, then re-run
   ✓ clears orphan debris once the rebuild is in effect, so a later deploy cannot wedge
   ✓ completes a pending rebuild whose temporary table was left behind
✓ migration locking and read-only modes (6)
   ✓ refuses to run while another migration holds the lock
   ✓ --check reports what would happen without writing
   ✓ --verify reports the real state of a healthy and a damaged database without writing
✓ the tracked database is never a migration target (1)
   ✓ does not modify db/custom.db when the suite runs

27 passed
```

This is the strongest evidence in the repository that migrations are handled
safely, and it predates this pass.

## 5. Risk register

| Risk | Severity | State |
|---|---|---|
| Single writer on one SQLite file; no second control-plane instance possible | High | **Open.** Architectural. Master brief Phase 1 (Postgres evaluation). |
| Production schema state unknown | High | **Blocked.** Needs host access. `npm run db:sync -- --verify` settles it (read-only). |
| Destructive `operation_jobs` rebuild pending on some installs | Medium | **Mitigated** by the applier's authorization gate. Not executed here. |
| Mixed tenancy: 8 models carry `organizationId`; legacy models key on `ownerId` | Medium | **Open.** Architectural. |
| Several newer tables reference rows by plain string id with no FK | Medium | **Open.** Prior audit; not changed. |
| Platform-wide unique rules where per-tenant is intended | Medium | **Open.** Named privately to the owner by the prior audit. |
| Fixture database shipped in the release payload | **Fixed** | SEC-12: production now refuses to start without `DATABASE_URL`. |
| Health cannot distinguish schema-behind from unreachable | **Fixed** | SEC-13. |

## 6. Backup and restore

| Item | State |
|---|---|
| Backup script | `scripts/db-backup.mjs` exists and is tested |
| Restore script | `scripts/db-restore.mjs` exists and is tested |
| Restore rehearsal evidence | `tests/migration-safety.test.ts` restores a verified backup into a temp target |
| **Off-host destination** | **None.** Local disk only. |
| Nightly cron | present in the server kit; **not verified running on any host** |
| RPO / RTO | **Unpublished.** Cannot be measured without a host. |

See `docs/operations/BACKUP-RESTORE.md` for the procedure and the exact
limitations.

## 7. What this audit does not claim

- That the production database is healthy or that its schema matches the code.
  The health endpoint returns a distinct reason code now, but nothing in this
  workspace can read production.
- That PostgreSQL is a good or bad move for the control plane. That needs a
  measured spike with production-shaped data, which is Phase 1.
- That a customer MariaDB/PostgreSQL instance actually provisions on a host.
  Only the helper contract and its failure path are tested.
