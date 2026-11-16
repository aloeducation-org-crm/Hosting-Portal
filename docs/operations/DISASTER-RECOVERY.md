# Disaster Recovery Plan — ALO Hosting Portal

**Maintained:** 2026-11-16 · **Verdict: NOT READY for production disaster recovery.**
**Reason:** no production/staging restore drill has been executed on real infrastructure; no offsite destination exists; RPO/RTO are unmeasured. What exists is a verified local mechanism (encrypted backup → encrypted offsite-style copy → sha256 verification → decrypt → isolated restore), exercised end-to-end on scratch data. Do not advertise RPO/RTO until a timed staging drill proves them (§10).

Companion documents: [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) (runbook),
[`docs/DATABASE-RECOVERY-RUNBOOK.md`](../DATABASE-RECOVERY-RUNBOOK.md),
[`docs/KNOWN-LIMITATIONS.md`](../KNOWN-LIMITATIONS.md) (L9, L16, L21–L23),
[`.github/workflows/ci-cd.yml`](../../.github/workflows/ci-cd.yml).

---

## 1. Recovery objectives — unmeasured, do not advertise

| Objective | Status | Evidence needed to publish |
|---|---|---|
| RPO (max data loss) | **UNMEASURED** — target design: ≤ 24 h (nightly) + manual pre-migration backups | Timed staging drill: back up, destroy, restore, measure last-recoverable transaction timestamp |
| RTO (max time to restore service) | **UNMEASURED** — mechanism measured at ~0.2 s locally for a 156 KB scratch archive; production-scale archives (GBs) untested | Timed staging drill on production-like data: time from incident declared → `/api/health` reason `OK` |
| Drill cadence | Not scheduled | Monthly isolated-restore drill + quarterly full staging simulation (operator action) |

Publishing numbers from local scratch runs would be fabrication. Any stakeholder
asking for RPO/RTO today gets this paragraph, not a number.

## 2. Backup classification (8 categories)

Contents, handling and restore semantics per category. Secrets **never** enter archives;
the in-archive manifest stores only names/sizes/hashes.

| # | Category | Contents | Sensitivity | Backup source | Restore semantics |
|---|---|---|---|---|---|
| 1 | **control-plane DB** | `app.db` VACUUM INTO snapshot; core tables required (users, audit_logs, servers, hosting_sites) | PII, credentials hashes, customer metadata | `scripts/encrypted-backup.mjs` (SQLite; PG unsupported yet) | Replace live DB only via `--live --yes` (§6) |
| 2 | **customer DB** | One customer database per run: SQLite snapshot or `pg_dump` | Customer PII/business data | `--customer-db-url` (run once per customer DB) | Restore into isolated env; per-customer cutover with customer comms |
| 3 | **application persistent data** | `--application-data-dir` tree (uploads metadata, generated state) | Medium | tree copy | `--target` restore; diff against live; cutover after verification |
| 4 | **deployment artifacts** | `--artifacts-dir` (built releases, dist/, worker bundles) | Low | tree copy | Redeploy from archive or rebuild from git (preferred — source of truth is git) |
| 5 | **customer uploads** | `--uploads-dir` tree | Customer content; treat as confidential | tree copy | `--target` restore; checksum per file; spot-check N random files |
| 6 | **essential config (NON-secret)** | Explicitly listed files (e.g. `Caddyfile`, `ecosystem.config.cjs`) | Low — secrets by name are refused | `--config-file` | Reinstall; secret values re-issued from operator secret store, never from backup |
| 7 | **infrastructure config** | systemd units, proxy config, cron definitions | Low–Medium | `--infrastructure-file` | Reinstall; verify with `systemd-analyze verify` / `caddy validate` |
| 8 | **audit / operational records** | `audit/audit_logs.jsonl` (latest 5,000 rows) | Operational metadata; may contain IPs/emails | automatic with control-plane | Forensic reference; append-only consumers must re-import |

Secret handling is architectural: the KEK and env values live **outside** the backup
set. If a `.env` is needed to rebuild a host, it is re-materialized from the operator's
secret store — never from a backup.

## 3. Backup architecture

```
host ──▶ scripts/encrypted-backup.mjs
            ├─ stage (mkdtemp, 0700) → per-category payloads → tar.gz
            ├─ envelope: DEK(AES-256-GCM) wrapped by KEK(AES-256-GCM)  [scripts/lib/envelope.mjs]
            ├─ self-check: decrypt + sha256 compare before keep
            ├─ atomic rename .partial → <out>/alo-backup-<stamp>-<label>.alobak  (0600)
            ├─ write <file>.sha256 + <file>.manifest.json (non-secret)
            ├─ prune --keep (only AFTER verification; never the newest)
            └─ optional --offsite-dir copy → sha256 re-verify at destination

scripts/backup-monitor.mjs (hourly) ──▶ backup-status.json + newest archive sidecar
            ├─ alert conditions (§7) → SUPER_ADMIN in-app Notification (type backup-alert)
            └─ optional webhook / --notify-db

scripts/encrypted-restore.mjs
            ├─ --verify-only   : decrypt + manifest re-audit, nothing written
            ├─ --target DIR    : isolated restore (default for drills)
            └─ --live --yes    : destructive; takes fresh verified pre-restore snapshot; refuses otherwise
```

Trust boundaries: the KEK (`/etc/alo-hosting/backup-kek` or secret store, 0600,
root/alo-panel only) is held separately from archives. Archives on shared/offsite
storage are useless without the KEK; the KEK alone decrypts nothing on its own.

## 4. Retention and deletion protection

- Local: newest **14** verified archives (`--keep`, override `BACKUP_RETENTION_COUNT`). Pruning runs **only after** the new archive is verified and never removes the newest valid backup.
- Offsite: same `--keep` policy applied at destination; copies pruned only after destination sha256 re-verification of the new copy.
- **Never delete an old backup before its successor is verified.** The code enforces this ordering; operators must not hand-prune "to save space."
- Deletion protection where available: S3 object-lock/versioning (when configured), offsite copies immutable. Current local-only retention has **no deletion protection**.
- Failed backups are kept for forensics until one successful run later supersedes them; they never overwrite a valid archive (atomic rename).

## 5. Key management

See BACKUP-RESTORE.md §2–3 for design, rotation and the KMS-unavailable alternative
and its accepted risks. Summary for incident responders:

- KEK compromise ⇒ treat every archive as confidentiality-lost; rotate KEK immediately; rotate all host/customer credentials stored on backed-up hosts; deletion of old KEKs only after retention expiry.
- KEK loss ⇒ all archives encrypted with it are unrecoverable. Offline escrow is mandatory for any production use (operator action; not implemented by this repo).
- `kekId` in each sidecar lets you identify which archives a compromised KEK covers.

## 6. Restore authority and change control

| Action | Who | Preconditions |
|---|---|---|
| `--verify-only`, `--target` drills on any host | Any on-call admin with KEK access | None — read-only against the archive, writes only to the scratch target |
| Live restoring a customer DB | Incident lead + customer comms | Customer notification; per-customer approval recorded |
| **Live control-plane restore (`--live --yes`)** | **SUPER_ADMIN + second approver** | Incident declared; fresh verified pre-restore snapshot taken by the tool itself; maintenance window; `/api/health` verification plan |
| Deleting any backup | SUPER_ADMIN | New successor verified at destination; written record |
| KEK rotation | SUPER_ADMIN + security owner | Rotation runbook (BACKUP-RESTORE.md §2) |

## 7. Monitoring and alerting

`scripts/backup-monitor.mjs` — hourly via `deploy/systemd/alo-backup-monitor.timer`
(template; not installed) or cron (see BACKUP-RESTORE.md §7). Exits 0 healthy, 1 alert.
Alert conditions (all → SUPER_ADMIN in-app Notification, type `backup-alert`):

| # | Condition | Severity |
|---|---|---|
| M1 | No `backup-status.json` / unreadable / no successful backup recorded | Critical |
| M2 | `lastFailure` newer than `lastSuccess` | Critical |
| M3 | Last success older than `--max-age-hours` (default 26h — one missed daily) | High |
| M4 | Newest archive sha256 sidecar mismatch | Critical |
| M5 | Newest archive missing sidecar | High |
| M6 | `sizeBytes` zero / verification incomplete | High |
| M7 | No `offsite.verified: true` recorded | Warning (standing REL-05 gap) |

Also monitored on the panel: `/api/health` `databaseStatus`/`schemaStatus`; the
monitor's alerts appear in the same notification bell as other SUPER_ADMIN events.
Thresholds: backup age > 26 h alerts; page-worthy = M1/M2/M4. An operator must
acknowledge by running a manual backup + monitor; the alert self-clears on the next
successful run (deterministic alert ids prevent re-spam of the same alert).

**Not yet monitored:** restore-drill history, offsite storage availability, KEK age,
retention compliance. These are gaps owned by the operator once a real offsite
destination exists.

## 8. Disaster scenarios

Roles: **Incident Lead** (SUPER_ADMIN on call), **DB Operator**, **Comms**. Credentials
referenced by name only — the KEK lives at `ALO_BACKUP_KEY_FILE` / secret store;
panel env at `/etc/alo-hosting/panel.env`; never paste secrets into tickets or chat.

| # | Scenario | Priority | Steps (summary — full detail in BACKUP-RESTORE.md) | Downtime | Data-loss exposure | Verification |
|---|---|---|---|---|---|---|
| 1 | **Control-plane DB corruption** | P1 | Declare incident → stop writers → fresh `--target` restore from newest verified archive → `PRAGMA integrity_check` + core tables + row counts → approval → `--live --yes` swap → start panel → `/api/health` reason `OK` → spot-check users/servers/sites | Hours (manual) | Up to 24h (or last backup) | integrity_check ok; health OK; audit log continuity; sampled logins |
| 2 | **App server failure (panel down)** | P2 | Replace/rebuild host → install from `INSTALLATION.md` → restore control-plane from archive (can use pre-built artifacts) → re-point DNS → health check | Hours | Zero if panel rebuilt from backup (no DB loss) | `/api/health` OK; login works; worker picks up queue |
| 3 | **Worker failure** | P2 | Restart worker (`systemctl restart alo-automation-worker`) → if corrupted state, restore app persistent data from archive into scratch, diff, cut over | Minutes–hours | In-flight jobs lost; DB safe if untouched | Worker heartbeat; queued jobs drain; no duplicate deployments |
| 4 | **Storage failure (lost volume)** | P1 | Provision new volume → restore control-plane + uploads + app-data + artifacts → permissions 0640/alo-panel → services up → health + spot-check files | Hours | Up to last backup for files | Per-file sha256 from manifest; API reads uploads; health OK |
| 5 | **Accidental deletion** (operator drops table/site) | P1→P3 | Freeze writers → identify last good backup before deletion → isolated `--target` restore → extract only affected rows/files → apply as forward fix (never restore blindly over newer state) | Minutes–hours | Deletion window only | Affected records present; unaffected records unchanged |
| 6 | **Credential compromise** | P1 | Rotate panel secrets (JWT/session, DB password, KEK) → revoke API keys → audit `audit_logs` for misuse → invalidate sessions → re-encrypt archives with new KEK per rotation runbook → forced re-auth | Hours | Audit gap covered by audit export | Failed-login metrics normalize; new KEK encrypts next backup; sessions invalidated |
| 7 | **Ransomware** | P1 | Isolate host (network) → do NOT pay → rebuild clean from git + `INSTALLATION.md` → restore latest verified offsite archive (local may be encrypted) → rotate every credential → integrity-audit restored files | Days | Everything since last offsite backup; local-only backups worthless if encrypted | Restored env passes security checks; health OK; no unexpected binaries; credentials all rotated |
| 8 | **Cloud/provider outage (whole host+network unreachable)** | P2 | Stand up replacement on alternate provider → restore from offsite (the ONLY reason offsite exists) → DNS cutover → health → customer comms | Hours–day | Up to offsite cadence | Full functional smoke on new host |
| 9 | **Office internet outage** | P3 | No action for hosted customers (panel is the service). Remote/office access unavailable → manage via provider console/SSH from alternate network; defer non-critical ops | None for customers | None | Service monitoring green throughout |
| 10 | **Control-plane failure** (panel logic/schema wedged, DB intact) | P1 | Stop writers → assess: code bug vs corruption → rollback release per RELEASE-AND-ROLLBACK.md → if schema damaged, treat as scenario 1 | Hours | Usually none (DB intact) | `/api/health` OK on rollback; audit log continuous |

Credentials needed for any of the above (operator must hold, in an audited secret store):
KEK escrow, root/panel SSH for rebuild hosts, provider console access, DNS control,
email/notification channel for customer comms.

## 9. Post-incident review

Every restore (drill or real) records: date, archive name, sha256, who approved, target,
duration (declared-incident → health OK), data-loss observed, verification results, and
follow-up actions. Store in the ops log and link from the incident ticket. Restore-test
history feeds the monitoring gap list (§7).

## 10. What closes "READY"

1. An offsite destination provisioned, configured, retention + deletion protection verified, uploaded copies re-verified.
2. A timed restore drill on the real staging host with production-like data; RPO/RTO published from that drill (not from this file).
3. `deploy/systemd/alo-encrypted-backup.timer` and `alo-backup-monitor.timer` installed and observed firing successfully ≥ 7 days.
4. One full `--live`-class rehearsal on staging with second-person approval and a measured timeline.
5. KEK escrow documented and tested (retrieve + decrypt an old archive from escrow).
6. L16/L21/L22 (KNOWN-LIMITATIONS) retired by evidence.

Until all six exist, the honest status of this document is: **a designed, locally
verified mechanism and an operations plan — not a functioning disaster-recovery capability.**

## 11. 2026-11-16 sandbox drill record (scratch data, not production)

Executed in an isolated workspace against a seeded scratch SQLite DB and synthetic
uploads/artifacts:

| Step | Result |
|---|---|
| Encrypted backup (9 files, 7 categories) | OK — archive 155,964 B, sha256 `602e804d…`, duration ≈ 171 ms |
| Post-encryption self-check (decrypt + sha256 compare) | Passed (built in) |
| Offsite-style copy to separate directory + sha256 re-verify | Passed (`offsite.verified: true`) |
| `--verify-only` restore audit | Passed, 9/9 files verified |
| Isolated `--target` restore | Passed; uploads/index.html, file-b.txt, persistent.txt, release.txt byte-identical; control-plane `app.db` passed `PRAGMA integrity_check` |
| Audit-table export | Initially failed (`createdAt` column) → fixed to `timestamp`; verified in drill 3 |
| Tamper tests (wrong KEK, flipped payload bit, header byte, bad sidecar, truncated file) | All fail closed (tests/encrypted-backup.test.ts) |
| Monitor stale/failure/tamper cases → SUPER_ADMIN notification | Passed (tests/backup-monitor.test.ts), idempotent |

These prove the mechanism on scratch fixtures. They do **not** prove production backup
or recovery capability (see §1, §10).
