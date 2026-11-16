# Backup and Restore Runbook

**Maintained:** 2026-11-16 · **Status: mechanism implemented and drill-tested locally; NOT yet operational on production hosts. Disaster-recovery readiness is NOT claimed.**

Two parallel backup systems exist. Do not conflate them:

| System | Scope | Status |
|---|---|---|
| Per-site backups (`/api/backups`, `helpers/alo-site-backup` / `alo-site-restore`) | Files of one hosted customer website | Implemented; site restore is checksum-verified; execution against production hosts unverified from this workspace |
| Control-plane DR (`scripts/encrypted-backup.mjs` / `scripts/encrypted-restore.mjs` / `scripts/backup-monitor.mjs`) | The panel's own database and the artifacts listed below | Scripts + automated tests in repo. **Executed only in a local sandbox drill (scratch data). Not installed on any host.** |

This document describes both. For incident scenarios, priorities and verification see
[`docs/operations/DISASTER-RECOVERY.md`](./DISASTER-RECOVERY.md).

---

## 1. What the control-plane DR backup contains (and refuses)

Categories (archive format `alobak/1`; every file sha256'd into the in-archive manifest):

| Category | Contents | Notes |
|---|---|---|
| control-plane | `SQLite VACUUM INTO` snapshot of `DATABASE_URL` (`file:` URLs) | `PRAGMA integrity_check` + required core tables (`users`, `audit_logs`, `servers`, `hosting_sites`) verified before the archive is created. PostgreSQL/MariaDB control planes are **not** supported by this path yet |
| audit | JSONL export of the 5,000 most recent `audit_logs` rows | Best-effort; the archive records a warning if the table is unreadable |
| customer-db | `--customer-db-url` — SQLite (`file:`) snapshot or `pg_dump` of one customer database | One customer database per invocation; repeat per database |
| application-data | `--application-data-dir` tree | Persistent app data |
| artifacts | `--artifacts-dir` tree | Deployment artifacts (releases, dist/) |
| uploads | `--uploads-dir` tree | Customer uploads |
| config | `--config-file` (repeatable) — explicitly named non-secret files | Basename secret denylist (`.env*`, `*secret*`, `*token*`, `*credential*`, `*.pem`, `*.key`, `id_rsa`, `*.p12`) is enforced in code; a config file whose name looks secret is **refused**, never archived |
| infrastructure | `--infrastructure-file` (repeatable) — e.g. systemd units, reverse-proxy config | Same denylist as config |

**Secrets are never placed in archives.** The denylist is name-based and enforced at
both ingest and restore. Secret material (KEK, `.env` values, API tokens) lives
outside the backup set entirely — see §3. If a secret is found inside a staged
directory tree it is skipped and recorded in the manifest's `skipped[]` array, and
the archive itself carries no secret values.

The payload manifest also records `hostname`, timestamps and sizes — no environment
variable *values* are read, captured or stored. Sidecar `<file>.manifest.json` next
to each archive is non-secret (file name, categories, sizes, sha256, KEK **id** — never
key material or key file paths).

## 2. Encryption

Authenticated envelope encryption — no custom primitives:

- **Payload**: AES-256-GCM with a fresh random 256-bit data-encryption key (DEK) and 96-bit nonce per archive.
- **Key wrap**: the DEK is wrapped with a key-encryption key (KEK), AES-256-GCM, AAD-bound to the archive header and a magic prefix (`ALOBAK01`); the payload GCM's AAD binds the encrypted bytes to the header (including the claimed `plaintextSha256`) so any tampering with the header, wrap or payload fails authentication.
- **Integrity**: GCM tag for the payload *and* wrap; plaintext SHA-256 re-verified after decrypt; outer `<file>.sha256` sidecar for transport; per-file SHA-256 re-verified from the decrypted manifest during every restore audit.
- **KEK source**: `ALO_BACKUP_ENCRYPTION_KEY` (64 hex chars) or `ALO_BACKUP_KEY_FILE` (file must be mode 0600 and is refused if group/world-readable). Never logged, never written to the archive, never beside the encrypted file by default. KEK id recorded via `--kek-id` (default `kek-1`) for rotation bookkeeping.
- **Self-check before keep**: after encryption the script immediately decrypts the archive and byte-compares SHA-256 of plaintext; on mismatch nothing is kept. Finalize is atomic (`.partial` → rename) so a failed run never replaces the last valid backup.
- **Fail closed**: wrong KEK, tampered header/payload, bad sidecar, truncated file, or manifest mismatch all abort with a non-zero exit; no partial output is left behind (temp staging is always removed).

### KEK rotation procedure

1. Generate a new 256-bit KEK; install it as `.../backup-kek-2` (mode 0600) or in your secret store; set `ALO_BACKUP_KEK_ID=kek-2`.
2. Keep `kek-1` available until every archive encrypted with it is past its retention window.
3. Re-wrap existing archives to the new KEK without touching the live database:
   ```bash
   node scripts/backup-rewrap-kek.mjs --from /var/backups/alo/alo-backup-<stamp>.alobak \
     --new-key-file /etc/alo-hosting/backup-kek-2 --new-kek-id kek-2
   # writes <stem>.rewrapped-kek-2.alobak (+ .sha256, .manifest.json); the original is byte-for-byte untouched
   ```
   The re-wrapped archive authenticates only under kek-2; the original stays valid under kek-1. `tests/backup-rewrap-kek.test.ts` covers this path end to end.
4. Inventory archives by `kekId` in their `.manifest.json` sidecars. Do not delete `kek-1` before the oldest `kek-1` archive ages out of retention.
5. Emergency rotation (KEK compromise): rotate as in 1–3, treat ALL prior backups as confidentiality-compromised, rotate every credential stored inside backed-up hosts, and destroy old KEKs after the retention window. See DISASTER-RECOVERY.md scenario 6.

### If KMS is unavailable (current state)

This repository does not have access to a managed KMS. The approved alternative is a
**file-based KEK with strict 0600 permissions, stored separately from the backup
archives and managed by the host's secret tooling** (e.g. a root-only file outside
the backup directory, delivered via configuration management). Operational risks you
accept with this design, explicitly:

- Compromise of the host that holds both KEK and archives breaks confidentiality.
- The KEK is a static secret; rotation is manual (procedure above).
- No hardware-backed non-exportability, no audit trail of KEK use, no automatic rotation.
- Backups located on the same host as the KEK are single-point failures for both availability and confidentiality.

Moving to a managed KMS (AWS KMS / GCP KMS / HashiCorp Vault transit) closes these and
is an **operator decision**; the envelope format records `kekId` so a KMS-backed KEK
can be introduced without changing the archive format.

## 3. Key storage rules (binding)

- The KEK is **never** committed to git, written into manifests, printed to logs, or stored beside the encrypted archive.
- Backups on shared storage must not live on the same volume as the live database *and* the KEK.
- Restoring a backup requires the KEK; losing the KEK makes every archive encrypted with it permanently unrecoverable. Keep an escrowed copy in a sealed, access-audited offline location (documented by the operator; not in this repo).

## 4. Taking a backup

```bash
# minimum viable: control-plane + audit + any categories whose sources are given
export DATABASE_URL=file:/var/lib/alo-hosting/production.db
export ALO_BACKUP_ENCRYPTION_KEY=<64 hex chars>        # or: --key-file /etc/alo-hosting/backup-kek
node scripts/encrypted-backup.mjs --out /var/backups/alo --label manual --json

# typical scheduled run (adds app data, artifacts, uploads, config, infra, offsite copy)
node scripts/encrypted-backup.mjs --out /var/backups/alo --label scheduled \
  --application-data-dir /var/lib/alo-hosting/data \
  --artifacts-dir /opt/alo-hosting/current \
  --uploads-dir /var/lib/alo-hosting/uploads \
  --config-file /etc/alo-hosting/panel.env.example   # example: a NON-secret file only
  --infrastructure-file deploy/systemd/alo-hosting-panel.service \
  --offsite-dir /mnt/offsite-backups                  # must be a MOUNTED REMOTE — see §6
```

Useful flags: `--keep N` (default `BACKUP_RETENTION_COUNT` or 14), `--category <name>`
(repeatable; default = control-plane + every category whose source was provided),
`--skip-audit`, `--status` (print current `backup-status.json` and exit),
`--kek-id`, `--env-file` (read DATABASE_URL / ALO_BACKUP_ENCRYPTION_KEY from an env
file without echoing it).

A successful run prints JSON: archive path, size, sha256, categories, files, duration.
`backup-status.json` (mode 0600) beside the archives is the machine-readable state the
monitor reads.

## 5. Verifying and restoring

```bash
# 1) transport checksum (fast, catches transport corruption)
sha256sum -c /var/backups/alo/alo-backup-<stamp>.alobak.sha256

# 2) cryptographic + semantic verify, restores nothing
node scripts/encrypted-restore.mjs --from <archive> --verify-only --key-file /etc/alo-hosting/backup-kek --json

# 3) isolated restore into a scratch directory (SAFE — never touches the live system)
node scripts/encrypted-restore.mjs --from <archive> --target /tmp/restore-check --key-file ... --json

# 4) destructive live restore — requires --yes, an explicit --db, and takes a
#    fresh verified snapshot of the CURRENT database first; refuses otherwise
node scripts/encrypted-restore.mjs --from <archive> --live --yes --db file:/var/lib/alo-hosting/production.db --key-file ...
```

Every restore mode performs, in order: outer sidecar check → decrypt (authenticates
header/wrap/payload) → per-file SHA-256 re-verify from the in-archive manifest →
`PRAGMA integrity_check` and core-table presence for SQLite snapshots → disk-space
check with 10% headroom. The live mode additionally refuses if restoring would drop
core tables that exist in the current database, and writes `.partial` then atomically
renames into place.

**Never overwrite production during routine testing.** Use `--target` for drills. Live
restores are for actual incidents and require explicit human approval (§6 of
DISASTER-RECOVERY.md).

## 6. Offsite destination

A second directory on the same disk **is not offsite**. `--offsite-dir` exists so the
destination can be a mounted remote (sshfs/rclone mount of an object bucket, NAS, or a
different host over NFS); after copying, the destination copy is sha256 re-verified
end-to-end and `backup-status.json` records `offsite.verified`.

**Current status (2026-11-16): no production offsite destination is designated. REL-05
remains open.** A drill-level offsite transfer to the operator-connected Google Drive
was executed and verified 2026-11-16 (see the drill evidence below). The only connector
reachable from the build workspace is Google Drive, whose authenticated account is a
personal account with unrelated personal content — it is being used for drill artifacts
only, and its use for production backups requires the owner's written decision. To
close REL-05 the operator must choose and provision one of:

- S3-compatible object storage in a second provider/region (recommended; versioning + object-lock for deletion protection), or
- rsync/rclone over SSH to a host in a different failure domain, or
- a managed snapshot service for the host volume plus this repository's archives for logical portability.

Once provisioned: point `--offsite-dir` at the mount (or add an upload step after the
run), confirm `.sha256` re-verification in `backup-status.json`, and configure retention
and alerting. Until then, this backup protects against accidental deletion and local
file loss only — **not** against loss of the host or ransomware.

**2026-11-16 Drive offsite drill (evidence).** With the operator-connected Google
Drive account, the drill archive `alo-backup-20261116T210531Z-drill3.alobak`
(155,961 bytes) was uploaded to the new Drive folder `ALO Encrypted Backups
(DRILL)` (`1Ymx7hQaqlIJQZyZDgP4ffHt-zq6hCrYK`) together with its `.sha256` and
`.manifest.json` sidecars. Drive-attested checksums match the local archive
byte-for-byte (`sha256 4310fc07…`, `md5 c7e3179b…`, size 155,961); the sidecars
were read back successfully; and those same bytes were decrypt-verified and
isolated-restored (see §9). This proves the transfer-verify-restore path end to
end — but it is **evidence for the mechanism**, not approval of consumer Drive as
the production destination: it has no object-lock/versioning and concentrates
backup custody in one personal account. The production destination remains the
owner's decision (S3 object-lock in a second provider is recommended).

Retention rules (binding): keep the newest 14 verified archives (`--keep`), prune only
**after** the new archive is verified, never prune the newest valid backup, and never
delete an offsite copy while any local copy still depends on it for verification.

## 7. Scheduling, retention and failure behavior

Templates are provided under `deploy/systemd/` — `alo-encrypted-backup.service/.timer`
(daily 02:30, `Persistent=true`) and `alo-backup-monitor.service/.timer` (hourly). They
are **templates**: they are not installed or enabled anywhere and enable nothing by
themselves. To schedule: install the units, set `ALO_BACKUP_DIR`, `ALO_BACKUP_OFFSITE_DIR`,
`ALO_BACKUP_KEY_FILE` (or `ALO_BACKUP_ENCRYPTION_KEY`) in `/etc/alo-hosting/panel.env`, then
`systemctl enable --now alo-encrypted-backup.timer`.

- Duplicate scheduled runs are prevented by a lock file (`.encrypted-backup.lock`, pid-liveness + 6h max age); a live lock refuses a second run.
- A failed run **never** replaces the last valid backup (atomic finalize; prune happens only after verification).
- Failed runs write `lastFailure` to `backup-status.json`; the hourly monitor reads it and alerts SUPER_ADMIN in-app (and optionally via webhook / `--notify-db`).
- Retry: reruns are idempotent; a persistent failure stays visible until a successful run overwrites `lastFailure: null`. There is no hidden retry queue — the systemd timer re-fires on its next calendar slot, which doubles as the retry. For faster retry, re-run the service manually.
- Size tracking and checksum are recorded per archive in `backup-status.json` and `<file>.manifest.json`; prune reports counts in the run output.
- Restore-drill history: append one JSON line per successful drill to `/var/backups/alo/restore-drills.jsonl`:
  ```bash
  echo "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ok\":true,\"archive\":\"<archive>\",\"durationMs\":1234}" \
    >> /var/backups/alo/restore-drills.jsonl
  ```
  The monitor (`--restore-test-log`, enabled in the shipped unit) alerts when the newest successful drill is older than `--restore-test-max-days` (default 31) — an untested backup is not a backup.

Cron alternative for hosts without systemd:

```cron
30 2 * * *  alo-panel  /usr/bin/node /opt/alo-hosting/current/scripts/encrypted-backup.mjs --out /var/backups/alo --label scheduled --offsite-dir /mnt/offsite-backups --key-file /etc/alo-hosting/backup-kek >> /var/log/alo-backup.log 2>&1
7 * * * *   alo-panel  /usr/bin/node /opt/alo-hosting/current/scripts/backup-monitor.mjs --status /var/backups/alo/backup-status.json --notify-db file:/var/lib/alo-hosting/production.db >> /var/log/alo-backup-monitor.log 2>&1
```

## 8. Site files (separate system, unchanged)

```bash
sudo helpers/alo-site-backup create <domain>
sudo helpers/alo-site-restore <domain> /var/backups/alo-sites/<domain>/<archive>.tar.gz
```

The site restore helper verifies SHA-256 before overwriting and health-checks the site
afterwards. Manual control-plane database restores (when the encrypted path cannot be
used): take a current-state snapshot **first**, stop writers
(`systemctl stop alo-hosting-panel alo-automation-worker`), `PRAGMA integrity_check` on
the backup, move the live DB aside — never overwrite — install the backup at `0640`
owned by `alo-panel`, start and require `/api/health` reason `OK`. Note
`SCHEMA_OUT_OF_DATE` means the backup predates the code; do not run migration to fix it
blindly (see `DATABASE-AND-MIGRATION-AUDIT.md`).

## 9. Regularly scheduled restore rehearsal

A backup is not a backup until it has been restored. The minimum honest rehearsal:

```bash
node scripts/encrypted-backup.mjs --out /var/backups/alo --label rehearsal --json
node scripts/encrypted-restore.mjs --from <archive> --target /tmp/rehearsal-restore --json
# then run the test suite against the restored snapshot if schema-compatible
```

Record the date, archive, duration and outcome in the ops log. There is **no CI-level
scheduled drill yet** — add one when a staging host with the timer installed exists.
The 2026-11-16 sandbox drill (scratch data) measured: archive ≈ 156 KB, 9 files,
encrypt+verify ≈ 0.2 s, isolated restore ≈ 0.13–0.18 s — **local scratch numbers only;
they say nothing about production RPO/RTO.**

## 10. Google Drive assessment (2026-11-16)

The operator re-connected Google Drive and approved using it for drill evidence at
2026-11-16 21:33Z. The drill archive above was uploaded to `ALO Encrypted Backups
(DRILL)` and verified by Drive-attested sha256. **This is not yet approval for
consumer Drive as the production destination** — which remains the owner's decision.
Consumer Drive lacks object versioning/object-lock semantics and deletion protection
comparable to S3 object-lock, and would concentrate backup custody in one personal
account. Do not wire production `ALO_BACKUP_OFFSITE_DIR` to it without a written
owner decision; if granted, schedule recurring uploads via `rclone --drive-root-folder-id`
and record it here with retention evidence. S3 object-lock in a second provider/region
remains the recommended destination.
