# Database Recovery Runbook

Applies to the panel database: **SQLite / libSQL**, accessed through Prisma with
`engineType = "client"` and the libSQL adapter. The production *service* database
reported by the operator as MySQL/MariaDB is a **different system** and is covered
by §7.

Every command here is written to be run by a human who has decided to run it.
Nothing in this runbook is executed by a deployment.

---

## 1. First: find out what state you are in

Read-only. Run this before touching anything.

```bash
DATABASE_URL="file:/absolute/path/panel.db" node scripts/apply-deploy-schema.mjs --verify
```

It reports, without applying anything:

- every required table and column that is missing (including `audit_logs`);
- orphaned `*_new` temporary tables left by an interrupted rebuild;
- `PRAGMA integrity_check` and `PRAGMA foreign_key_check` results;
- for each rebuild migration: `already-applied` (intact), `pending`, `damaged`,
  or `refused` (schema does not match what the rebuild expects).

`ok: true` means the schema is whole. Anything else: **stop and read §4 before
changing anything.** A non-zero exit code is the point — never treat exit 0 as the
only proof of success.

Also worth knowing, without printing any value:

```bash
node scripts/audit-database.mjs --json     # engine, version, log_bin, GTID, server_id, capacity
bash scripts/server-doctor.sh              # app → nginx → tunnel → DNS → cert → DB
```

---

## 2. Backups

A file that exists is not a backup. A backup is a file that has been restored.

| Copy | Where | How | Verified by |
| --- | --- | --- | --- |
| Pre-deployment | `~/.alo-hosting/deploy-backup/<sha12>/database-<utc>.db` | `scripts/deploy-release.sh` copies it before any change | existence is logged; content is **not** verified automatically |
| Scheduled local | `/opt/backups` | `scripts/backup.sh` | checksum recorded on the `backups` row |
| Second local copy | Office B | rsync over the office LAN | restore drill |
| Offsite, encrypted | independent storage | daily full (+ binary-log shipping only if `log_bin=ON` was proven) | **monthly restore drill — mandatory** |

Before any authorized data-changing operation:

```bash
sudo bash scripts/backup.sh /opt/backups
```

then prove the copy is usable:

```bash
node scripts/apply-deploy-schema.mjs --check            # shape check, read-only
python3 - <<'PY'
# integrity + row counts, without printing any content
import sqlite3, sys
db = sqlite3.connect("file:/opt/backups/<backup>.db?mode=ro", uri=True)
print("integrity:", db.execute("PRAGMA integrity_check").fetchone()[0])
for t in ("users","websites","deployments","git_projects","audit_logs","operation_jobs"):
    try: print(t, db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0])
    except Exception as e: print(t, "MISSING", e)
PY
```

SQLite note: copying the file while the application is writing can produce a torn
copy. Stop the panel, or use `sqlite3 panel.db ".backup '/path/copy.db'"`, or use
`VACUUM INTO`. If a `-wal` file exists, copy it alongside the database file.

---

## 3. Migration model

`scripts/apply-deploy-schema.mjs` exists because `prisma migrate deploy` cannot be
used here: the app ships `engineType = "client"`, the schema-engine binary cannot
be downloaded on an egress-filtered host, and existing installs have no
`_prisma_migrations` table (so `migrate deploy` would replay the unrelated
`0_init` migration over live data).

Two classes:

| Class | Behaviour | Runs during a deploy? |
| --- | --- | --- |
| **ADDITIVE** | `CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN` (NULLable or safely defaulted). Never drops, deletes, truncates or rewrites a row. Idempotent: re-running skips what exists. | **Yes** |
| **REBUILD** | Recreates an existing table (SQLite cannot drop a `NOT NULL`). Touches data. | **Never** |

A rebuild requires all of:

```bash
DATABASE_URL="file:/absolute/path/panel.db" \
  node scripts/apply-deploy-schema.mjs \
  --allow-rebuild \
  --backup /opt/backups/<verified>.db
```

and then, in order:

1. **Lock** — an exclusive `<db>.migration-lock` file (`O_EXCL`, pid + timestamp).
   A second run refuses instead of racing. A lock older than
   `max(--lock-timeout-ms, 10 min)` is treated as crashed and cleared.
2. **State check** — if the rebuild is already in effect *and* every table it owns
   is intact, it is skipped. "Already applied" never means merely "the one column
   we care about is nullable": a table recreated by `CREATE TABLE … AS SELECT`
   loses every `NOT NULL`, primary key and foreign key, and that is detected.
3. **Precondition** — every table must exist, every column the `INSERT … SELECT`
   reads must exist, and any *unexpected* column is refused rather than silently
   dropped.
4. **Backup verification** — the file must exist, be non-empty, start with the
   SQLite magic header, be within `--max-backup-age-minutes` (default 1440), pass
   `PRAGMA integrity_check`, and contain every table about to be rewritten.
5. **Transaction** — the whole rebuild runs inside one `BEGIN IMMEDIATE` …
   `COMMIT` with `ROLLBACK` on error. Orphaned temporaries from a previous crashed
   attempt are dropped inside the same transaction.
6. **Postcondition** — table existence, row-count equality, foreign-key text
   (SQLite rewrites stored FK text on `RENAME`, so `audit_logs` is rebuilt after
   `operation_jobs`), required indexes, absence of `*_new` orphans, the rebuild's
   own predicate, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, and the
   required-schema map — which includes `audit_logs`.

Target rules, all fail-closed: no `DATABASE_URL` → refuse (there is deliberately
**no** `file:./db/custom.db` fallback any more); a relative `file:` path → refuse
(this already broke a production deploy once, because the path resolves against
the process working directory, which differs under PM2, systemd and CI); a
non-`file:`/`libsql://` scheme → refuse; a file without the SQLite magic header →
refuse. Nothing prints a connection string or credential.

---

## 4. Recovering a failed or interrupted migration

### 4.1 `damaged` — an interrupted rebuild

`--verify` reports something like:

```
missing table audit_logs
orphaned temporary table audit_logs_new (an earlier rebuild did not complete)
```

Do **not** re-run the migration over this state, and do not deploy.

1. Confirm the data is still recoverable. In the interrupted case the rows are
   usually sitting in the temporary table:
   ```sql
   SELECT COUNT(*) FROM audit_logs_new;
   ```
2. Restore from the verified backup taken before the run:
   ```bash
   sudo systemctl stop alo-hosting-panel      # or: pm2 stop alo-hosting-portal
   cp -a /opt/backups/<verified>.db /absolute/path/panel.db
   rm -f /absolute/path/panel.db-wal /absolute/path/panel.db-shm
   ```
3. Re-check: `node scripts/apply-deploy-schema.mjs --verify` → `ok: true`.
4. Re-apply, authorized and with a backup:
   ```bash
   DATABASE_URL="file:/absolute/path/panel.db" \
     node scripts/apply-deploy-schema.mjs --allow-rebuild --backup /opt/backups/<verified>.db
   ```
5. Start the panel and confirm `/api/health` reports `databaseStatus: connected`,
   `schemaStatus: current`.

If the backup is older than acceptable, and only `audit_logs` was lost while
`audit_logs_new` still holds the rows, a targeted rename is possible — but it is a
hand repair on production. Take a fresh copy first, do it inside a transaction,
and re-run `--verify` afterwards. Prefer the restore.

### 4.2 `refused` — precondition failed

Nothing was changed; the run stopped before the transaction. The message names the
exact problem:

- *missing column …* → the schema drifted. Reconcile it (usually the additive
  migration that owns that column has not been applied) and re-run.
- *unexpected column(s) … would be DROPPED* → someone added a column by hand, or
  an older/newer schema is in play. **Do not force it.** Extend the migration to
  carry the column, or drop it deliberately after confirming nothing uses it.
- *no verified backup* → take one and pass `--backup`.

### 4.3 Orphaned temporary table, rebuild already in effect

`--verify` reports the orphan but the postcondition holds. A normal run clears the
debris inside a transaction and reports `orphansRemoved`. This is the state that
used to wedge every subsequent deploy on `CREATE TABLE`; it no longer does.

### 4.4 Lock held

```
Another migration is in progress (lock held). Refusing to run concurrently.
```

Check the holder printed in the error (pid + startedAt). If that process is
genuously gone, either wait for the staleness threshold or remove
`<db>.migration-lock` by hand — the rebuild itself is transactional, so a crashed
holder cannot have left a half-applied change.

### 4.5 The deploy restored the previous commit but the database moved forward

This is expected and safe: additive migrations are backward-compatible, so the
older application keeps working against the newer schema. Do **not** try to
"roll back" an additive migration by dropping columns. If you must, restore the
pre-deployment database copy that `scripts/deploy-release.sh` captured, with the
panel stopped, and accept the loss of everything written since.

A **rebuild** migration is never applied by a deploy, so this situation cannot be
caused by one.

---

## 5. Full database restore

```bash
sudo systemctl stop alo-hosting-panel            # or pm2 stop alo-hosting-portal
cp -a /absolute/path/panel.db /absolute/path/panel.db.pre-restore.$(date -u +%s)
cp -a /opt/backups/<verified>.db /absolute/path/panel.db
rm -f /absolute/path/panel.db-wal /absolute/path/panel.db-shm
DATABASE_URL="file:/absolute/path/panel.db" node scripts/apply-deploy-schema.mjs --verify
DATABASE_URL="file:/absolute/path/panel.db" node scripts/apply-deploy-schema.mjs
sudo systemctl start alo-hosting-panel
curl -s http://127.0.0.1:3051/api/health
```

Then verify data, not just health: known users can log in, a known website is
listed, `audit_logs` has rows, deployment history is present.

---

## 6. Restore drill (never run — required)

| Field | Value |
| --- | --- |
| Date | — |
| Source | offsite encrypted copy |
| Target | Office A, isolated |
| Backup size / rows | — |
| Time to download + decrypt | — |
| Time to restore + verify | — |
| Data verified (which records) | — |
| Result | **not run** |

Until this table has a date, no offsite copy counts as a backup and no recovery
time may be quoted.

---

## 7. The MySQL/MariaDB question — unresolved

The Prisma schema in this repository declares `provider = "sqlite"` and the code
uses the libSQL adapter for `file:` URLs. The operator reports the production
service database as MySQL/MariaDB. Both can be true — they are **two different
databases** — and this repository must not assume otherwise.

- `scripts/apply-deploy-schema.mjs` refuses any non-`file:`/`libsql://` target, so
  it can never be pointed at MySQL by accident.
- `scripts/audit-database.mjs` is read-only (`SELECT VERSION()`, `SHOW VARIABLES`,
  `SHOW REPLICA STATUS`, `SHOW wal_level`) and answers the question on the host:
  engine, version, `log_bin`, `binlog_format`, `gtid_mode`, `server_id`.
- A migration that succeeds on SQLite proves **nothing** about MySQL/MariaDB.
- Converting the panel from SQLite to another engine is a separate project with
  its own plan, backups, staging rehearsal, cutover and rollback limits. It has
  not been started and must not be done silently.

---

## 8. Test evidence for this runbook's claims

`tests/migration-safety.test.ts` (27 tests) runs the real applier as a child
process against throwaway copies of `db/custom.db` and asserts:

- all four fail-closed target rules and unknown-flag rejection;
- default run is additive-only and reports the rebuild as `not-authorized`;
- rebuild refused without a backup / with a non-database backup / with a backup
  missing the rebuilt tables / with a too-old backup;
- authorized rebuild preserves row counts, FK text and `integrity_check`;
- repeated runs are idempotent;
- an extra column that would be dropped is refused and survives;
- a missing source table is refused and reported;
- a `CREATE TABLE … AS SELECT` drift is **not** accepted as already-rebuilt;
- the two reproduced Gate A failure scenarios, in every mode, always exit
  non-zero and name the runbook;
- the documented restore-then-re-run recovery works;
- orphan cleanup, transactional rollback, lock held, stale lock cleared;
- `--check` and `--verify` write nothing;
- `db/custom.db` is byte-identical after the whole suite.
