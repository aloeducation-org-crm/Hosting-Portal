# Backup and Restore Runbook

> **Current capability: PARTIAL, with the two halves in very different states.**
>
> - **Site files: implemented.** `helpers/alo-site-backup` writes a checksummed
>   archive; `helpers/alo-site-restore` verifies the SHA-256 before restoring and
>   aborts on mismatch. That is a real restore path.
> - **Database: not implemented as an automated drill.** The orchestrated database
>   restore returns `NOT_IMPLEMENTED` rather than reporting a restore it did not
>   perform. Database restore is therefore a manual, verified procedure (§3).
>
> Treat this document as the procedure to follow *and* as the list of what still
> has to be built.

## 1. What is backed up

| Asset | Mechanism | Location | Verified? |
|---|---|---|---|
| SQLite database | file copy / `/api/backups` | `/var/backups/alo-sites` | Creation tested; restore **not** |
| Site files | `helpers/alo-site-backup create <domain>` → SHA-256 checksummed archive | `/var/backups/alo-sites/<domain>/` | **Implemented**; restore verifies the checksum and aborts on mismatch. Not executed as root here. |
| Database restore (automated) | orchestrated worker | — | **`NOT_IMPLEMENTED`** — refuses rather than faking success |
| Configuration | `/etc/alo-hosting/panel.env` | host only | **Not included** in any backup — copy it separately |
| Certificates | `/etc/letsencrypt` | host | **Not included** |
| Off-host copy | — | — | **Does not exist (REL-05, BLOCKED)** |

**RPO/RTO cannot be stated**, because there is no off-host destination and no
timed drill. Any number would be invented.

## 2. Taking a backup

```bash
# helper path -- <domain>, not a site id; destination is fixed at
# /var/backups/alo-sites/<domain>/
sudo helpers/alo-site-backup create <domain>
sudo helpers/alo-site-backup list <domain>

# database (sqlite, consistent copy)
sqlite3 "$DB_PATH" ".backup '/var/backups/alo-sites/alo-$(date -u +%Y%m%dT%H%M%SZ).db'"
```

Verify the copy before trusting it:

```bash
sqlite3 /var/backups/alo-sites/alo-<stamp>.db "PRAGMA integrity_check;"
# expected: ok
```

Do **not** copy a live SQLite file with `cp`; a mid-write copy can be torn. Use
`.backup` or stop the writer.

## 3. Restore — the honest procedure

The product's automated restore refuses to run. Until REL-05 lands, restore is a
manual, verified, rehearsal-first procedure:

1. **Take a backup of the current state first**, even if it is broken. This is the
   step people skip and later regret.
2. Stop the writers:
   ```bash
   sudo systemctl stop alo-hosting-panel alo-automation-worker
   ```
3. For a **site** restore, use the helper instead of the manual steps below —
   it verifies the checksum itself and aborts if it does not match:
   ```bash
   sudo helpers/alo-site-backup create <domain>
   sudo helpers/alo-site-restore <domain> /var/backups/alo-sites/<domain>/<archive>.tar.gz
   ```

   The backup helper's actions are `create`, `list`, `cleanup` and `delete-one`,
   all taking a validated domain. The restore helper takes the domain first and
   the archive second, verifies `<archive>.sha256`, and health-checks the site
   afterwards.
   For a **database** restore, continue with the manual procedure.

4. Verify the backup you intend to restore:
   ```bash
   sqlite3 /path/to/backup.db "PRAGMA integrity_check;"
   ```
5. Move the live database aside — **never overwrite it**:
   ```bash
   sudo mv "$DB_PATH" "$DB_PATH.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
   ```
6. Copy the verified backup into place and fix ownership (`1001:1001` for the
   Docker layout, `alo-panel` for systemd):
   ```bash
   sudo install -o alo-panel -g alo-panel -m 0640 /path/to/backup.db "$DB_PATH"
   ```
7. Start and verify:
   ```bash
   sudo systemctl start alo-hosting-panel alo-automation-worker
   curl -fsS http://127.0.0.1:3000/api/health | jq .
   ```
   `/api/health` must report reason `OK`. `SCHEMA_OUT_OF_DATE` means the restored
   database predates the code — do **not** run a rebuild migration to fix it
   without reading `DATABASE-AND-MIGRATION-AUDIT.md` first.
8. Spot-check real data: log in, open a dashboard, confirm a recent deployment row
   and a website exist.

## 4. Restore rehearsal (required before trusting backups)

A backup is unverified until it has been restored. Rehearse on a scratch database:

```bash
export DATABASE_URL="file:/tmp/rehearsal.db"
node scripts/apply-deploy-schema.mjs
# restore the backup into /tmp/rehearsal.db following steps 3–5 above,
# then run the suite against it
DATABASE_URL="file:/tmp/rehearsal.db" npm test
```

Record the date and the result. There is no scheduled drill in CI yet — this is
gap #6 in `docs/audit/TEST-AND-COVERAGE-REPORT.md`.

## 5. Disaster scenarios

| Scenario | Action |
|---|---|
| Database corrupt | restore from the last verified backup; accept data loss back to that point |
| Site files lost | `helpers/alo-site-restore <domain> <archive>` — checksum-verified |
| Whole host lost | rebuild from `INSTALLATION.md`, restore DB and sites, re-issue certificates, re-enroll the agent |
| Backup itself missing | **nothing can be recovered.** This is why the off-host destination is the highest-priority BLOCKED item |

## 6. What must be built (REL-05)

1. An off-host destination interface with at least one implementation (S3-
   compatible, or rsync over SSH), credentials supplied by the operator.
2. A restore **drill** worker that restores into a scratch database, runs
   `PRAGMA integrity_check`, counts rows in a few known tables, and records the
   result — replacing the current `NOT_IMPLEMENTED` refusal.
3. A scheduled drill in CI or a timer, with the result surfaced on `/api/health`
   or the monitoring endpoint.
4. A published RPO/RTO derived from the drill, not from an intention.

Until then, no document in this repository may claim a recovery capability.
