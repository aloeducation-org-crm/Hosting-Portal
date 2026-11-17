# ADR-001: Control-Plane Database Architecture

**Status:** Accepted (2026-11-16)
**Deciders:** Platform engineering (this audit) — ratified by the owner on merge of this document
**Supersedes:** implicit "SQLite because that's what the schema says" (was never a written decision)
**Related:** `docs/DATABASE-RECOVERY-RUNBOOK.md`, `docs/PHASE-0-VERIFIED-BASELINE-2026-11-16.md`, `prisma/schema.prisma`, `scripts/apply-deploy-schema.mjs`, `scripts/db-backup.mjs`, `scripts/db-restore.mjs`, `src/lib/db.ts`

---

## 1. Problem statement

The master build brief requires a written decision comparing SQLite, libSQL, MySQL,
MariaDB and PostgreSQL for the ALO control plane, selected on real compatibility,
concurrency, operational, backup/recovery and hosting constraints — and forbids
"switching databases by changing `DATABASE_URL`".

The repository today is **not** engine-agnostic:

- `prisma/schema.prisma` declares `provider = "sqlite"` with `url = env("DATABASE_URL")` and `engineType = "client"`.
- All 19 migrations under `prisma/migrations/` are **SQLite dialect** (inline `PRAGMA`-adjacent constructs, table-rebuild migrations for constraint changes, `WITHOUT ROWID`-free DDL, `DATETIME` columns).
- The runtime uses `@prisma/adapter-libsql` + `@libsql/client`, plus a pooled-connection patch in `src/lib/db.ts` (`PRAGMA busy_timeout`, `BEGIN IMMEDIATE`) that exists specifically because of SQLite locking semantics.
- Two production-relevant scripts are SQLite-specific: `scripts/apply-deploy-schema.mjs` (idempotent applier; `prisma migrate deploy` cannot run where `binaries.prisma.sh` is blocked) and `scripts/db-backup.mjs` (`VACUUM INTO` + `integrity_check` + sha256 manifest).
- `DatabaseEngine` in the schema enumerates `MARIADB | POSTGRESQL` — those are the **customer-facing database-as-a-service** engines, not the control-plane engine.

## 2. Options considered

### 2.1 SQLite (file, via libsql driver adapter) — *current*
- **Compatibility:** exact. Schema, migrations, applier, backup tooling and the `db.ts` pooling patch are all built for it. 124 models, 19 migrations, zero dialect drift.
- **Concurrency:** single writer; readers scale with WAL. The repo mitigates contention explicitly (`busy_timeout=5000` default via `DATABASE_BUSY_TIMEOUT_MS`, `BEGIN IMMEDIATE` for interactive transactions, `DEAD_LETTER`/retry in the orchestrator so a busy write becomes a retried job, not a corrupted state).
- **Operations:** no server process, no ports, no credentials to rotate for the DB itself; backup = consistent file snapshot (`VACUUM INTO`), restore = copy back + verify. Drill executed 2026-11-16 (backup sha256 `e8ee69079aa5…` matched after isolated restore).
- **Limits:** one node; no online schema rewrites at scale; write throughput ceiling; no native replication (libSQL adds it, see 2.2).

### 2.2 libSQL (remote protocol, same SQLite dialect)
- **Compatibility:** highest of any non-file option — identical DDL, identical migrations. `@libsql/client` is already the driver; only the URL scheme changes (`file:` → `libsql://`) plus auth token handling in the secret store.
- **Concurrency:** embedded-replica mode gives local reads with a primary for writes; async replication is asynchronous — **not** zero RPO.
- **Operations:** removes the "restore overwrites the only file" hazard; enables a standby. Adds a network dependency and a token to manage.
- **Limits:** still SQLite semantics (single writer); hosted replicas are a third-party dependency unless self-hosted.

### 2.3 MySQL 8 / MariaDB 10.11+
- **Compatibility:** **poor for the control plane.** Every migration is SQLite DDL; Prisma would require `provider = "mysql"` and a full migration squash/replay; `apply-deploy-schema.mjs`'s safety model (rebuild preconditions, `PRAGMA foreign_key_check`) has no meaning there; `db.ts` pooling patch is SQLite-specific. Customer DBaaS already targets MariaDB/PostgreSQL — forcing the control plane onto it conflates two different concerns.
- **Concurrency:** MVCC, mature connection pooling, good write scalability.
- **Operations:** another stateful service to run, patch, back up (`mysqldump`/mariabackup + binlog PITR) and secure; a second backup toolchain to maintain and drill.
- **Verdict as control-plane engine:** rejected for now (huge migration risk for zero functional gain at current scale). **Accepted and required for customer DBaaS** (MariaDB is an offered engine).

### 2.4 PostgreSQL 15+
- **Compatibility:** none of the migrations apply; all 124 models would need a `provider = "postgresql"` schema and a reviewed squash. No PostgreSQL tooling exists in this repo for the control plane (the backup script can *invoke* `pg_dump` for hosts already on PG, but nothing in the app runs against PG today).
- **Concurrency:** best-in-class MVCC, connection pooling (PgBouncer), partial indexes, row-level security available for tenant hardening.
- **Operations:** one more service, but the standard industry answer; binlog-equivalent PITR (WAL archiving) beats file-copy backups for RPO.
- **Verdict as control-plane engine:** **the correct scale-out target, not a same-week switch.** Adopt when either trigger fires: (a) sustained write contention / `SQLITE_BUSY` retries observed in production metrics, (b) RPO requirement tighter than file-snapshot cadence, or (c) multi-node/HA control plane is scheduled.

## 3. Decision

1. **Control plane (this node, today): SQLite over the libsql driver adapter, single-node, WAL-friendly configuration with the existing pooling patch.** It is the only engine the entire codebase, migration history, backup/restore drills and operational scripts were built and tested against. Switching engines now would trade verified behavior for unverified risk.
2. **libSQL remote mode (`libsql://`) is the approved incremental step** to a replicated control plane: same dialect, same migrations, add standby + rehearse failover before cutover. Do this before PostgreSQL if replication (not write scaling) is the first pressure point.
3. **PostgreSQL is the approved strategic target.** Adoption requires, in order: schema provider squash + reviewed diff; CI job running the suite against ephemeral PostgreSQL; re-written backup/restore runbook (`pg_dump`/WAL + PITR drill); connection pooling; then a rehearsed production migration. None of that may be skipped or simulated.
4. **MySQL/MariaDB is rejected as the control-plane engine** and retained exclusively as a **customer database-as-a-service engine** (with PostgreSQL), behind the existing database-provisioning layer and isolated credentials.
5. **Changing `DATABASE_URL` alone is explicitly forbidden** as a migration strategy. Only `scripts/apply-deploy-schema.mjs` (SQLite/libSQL) may alter a real database in this phase; `prisma migrate deploy` becomes usable only where the Prisma schema engine is reachable (see §5).

## 4. Consequences

**Positive:** zero-downtime continuation of verified tooling; single-artifact backup/restore; no new service to secure; deployment stays possible on egress-filtered hosts.
**Negative / accepted:** single-writer ceiling; no online HA; backup RPO = snapshot interval (minutes), not WAL; control plane availability tied to one node's disk.
**Required compensations (tracked):** scheduled off-host encrypted snapshots; weekly isolated restore drill (this session's drill is the template: `scripts/db-backup.mjs` → verify → `scripts/db-restore.mjs --target`); monitoring of `SQLITE_BUSY*` rates and `operation_jobs` `DEAD_LETTER` counts as the early scale-out signal.

## 5. Migration paths (only when triggered)

**To libSQL replica (days, low risk):** provision primary → set `DATABASE_URL=libsql://…` + `DATABASE_AUTH_TOKEN` (secret store) → rehearse read-replica failover in staging → update runbooks. No DDL changes.

**To PostgreSQL (weeks, gated):**
1. Branch `feat/control-plane-postgres` — never on `main`.
2. `provider = "postgresql"` schema; regenerate one squashed baseline migration; **drop** the SQLite-specific applier for PG hosts only after CI proves the full suite against `postgres:15` service containers.
3. Replace `db.ts` pooling patch with a `pg`-backed adapter and PgBouncer; delete `busy_timeout` logic (dead code on PG).
4. Rewrite backup/restore for WAL archiving + `pg_dump`; run the same drill matrix (backup → isolated restore → integrity/sha256 equivalence) before any production cutover.
5. Final rehearsal on a staging copy of production data; owner sign-off; then cutover with the release-approval workflow. Rollback = previous SQLite snapshot + previous release (both preserved).

## 6. Verification performed for this ADR

| Check | Result |
| --- | --- |
| Migrations apply cleanly to a copy of the shipped fixture (`apply-deploy-schema.mjs --check/--allow-rebuild --backup/--verify`) | PASS — `"problems": []` on 2026-11-16 |
| Backup → isolated restore with matching sha256 | PASS — 2026-11-16 |
| Live production-build boot with this database | PASS — `/api/health` 200, `schemaStatus:"current"` |
| `prisma migrate deploy` | NOT RUN — Prisma schema-engine binary unreachable (`binaries.prisma.sh` egress-blocked); repo's documented offline applier used instead |
| Suite against PostgreSQL | NOT RUN — no PG schema exists yet; this ADR forbids implying otherwise |

## 7. Review triggers

Re-open this ADR when any of these is observed in production: sustained `SQLITE_BUSY`/`P1008` rates, `operation_jobs` dead-letter growth, control-plane restore drill failure, RPO requirement < snapshot interval, or a scheduled move to multi-node control plane.
