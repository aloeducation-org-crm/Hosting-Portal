# Release and Rollback Runbook

> Describes the pipeline that exists (`.github/workflows/ci-cd.yml`) and the
> manual equivalents. Where the automation is stronger than the documentation
> that preceded it, this file follows the automation.

## 1. Pipeline shape

```
verify ──► build ──► deploy-preflight ──► deploy
```

| Job | Gate | Proves |
|---|---|---|
| `verify` | every push and PR | lint, typecheck, tests, **every shell script parses** (`bash -n`) |
| `build` | after verify | production build with **non-production CI credentials**; both standalone entrypoints exist; records a payload digest |
| `deploy-preflight` | before deploy | read-only host inspection; refuses if `main` moved past the built commit; re-verifies the digest |
| `deploy` | manual approval | explicit release approval for **this commit**; re-validates against `main` **after** taking the deploy slot; re-verifies the digest on the deploying runner; activates and verifies the running commit; **restores on failure** |

The pipeline is digest-pinned and re-validates the commit after acquiring the
deploy lock. That closes the usual "approved commit A, deployed commit B" race.

## 2. Cutting a release (automated path)

1. Merge to `main` through a PR. `verify` and `build` must be green.
2. The `build` job uploads `hosting-release-<sha>` with a recorded digest.
3. Approve the `production` environment for that commit.
4. `deploy` activates and **verifies the running commit matches** the approved
   one. On mismatch or activation failure it restores automatically.
5. Confirm:
   ```bash
   curl -fsS https://<host>/api/health | jq .
   curl -fsS https://<host>/api/health | jq -r '.release.commitSha'
   ```

   `/api/health` reports `release.commitSha` and the pipeline's own
   `scripts/deploy-release.sh` verifies that exact field (along with database and
   schema health and a `/login` HTTP 200) before it keeps a release. A commit that
   does not match is rolled back automatically.

**Caveat that must be stated:** `main` is currently **unprotected** and the
`production` environment has **no required reviewers** (SEC-04). Until that is
fixed, step 3 depends on discipline, not on the platform. Treat this as a P0
operations gap.

## 3. Manual release (when CI cannot be used)

```bash
git fetch origin && git checkout <approved-sha>
npm ci --no-audit --no-fund
npm run verify
npm run build
npm run build:worker          # produces .next/standalone/automation-worker.cjs
RELEASE="/opt/alo-hosting/releases/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RELEASE" && cp -a .next/standalone/. "$RELEASE"/
ln -sfn "$RELEASE" /opt/alo-hosting/current.new && mv -Tf /opt/alo-hosting/current.new /opt/alo-hosting/current
sudo systemctl restart alo-hosting-panel alo-automation-worker
curl -fsS http://127.0.0.1:3000/api/health | jq .
```

Use a symlink swap, not an in-place copy: activation becomes atomic and rollback
is a single symlink change.

## 4. Rollback

### Automatic
The `deploy` job restores the previous release when activation or verification
fails. Trust it only for activation failures — it does not undo a bad **data**
migration.

### Manual

```bash
# 1. Point back at the previous release (never delete the current one yet)
ls -1dt /opt/alo-hosting/releases/* | head -3
ln -sfn /opt/alo-hosting/releases/<previous> /opt/alo-hosting/current.new
mv -Tf /opt/alo-hosting/current.new /opt/alo-hosting/current

# 2. Restart both units together -- a new panel with an old worker (or vice versa)
#    is its own outage
sudo systemctl restart alo-hosting-panel alo-automation-worker

# 3. Verify
curl -fsS http://127.0.0.1:3000/api/health | jq .
journalctl -u alo-hosting-panel -n 50 --no-pager
```

### Rollback and the database

This is the part that bites:

- **Additive** migrations (new table/column) are backward compatible — roll back
  code and leave the schema.
- **Rebuild** migrations are not. Rolling back code against a rebuilt schema can
  lose data. Read `docs/audit/DATABASE-AND-MIGRATION-AUDIT.md` before rolling back
  across any migration boundary.
- If a release performed a rebuild migration, the only correct rollback is:
  restore the pre-release database backup, then point at the previous release.
  Both steps, in that order.
- `SCHEMA_OUT_OF_DATE` from `/api/health` after a rollback is expected and means
  the schema is ahead of the code — it is not necessarily an error, but it is a
  reason to verify before accepting traffic.

## 5. Release checklist

| # | Item | Evidence |
|---|---|---|
| 1 | `npm run verify` green | job log |
| 2 | Release digest recorded and re-verified | `build` + `deploy-preflight` logs |
| 3 | Commit re-validated after taking the deploy slot | `deploy` log |
| 4 | `/api/health` returns `OK` | curl output |
| 5 | Running commit matches the approved SHA | deploy verification step |
| 6 | Worker active with a fresh heartbeat | `systemctl is-active`, `stat` |
| 7 | A pre-release DB backup exists if any migration ran | backup file + integrity check |
| 8 | Rollback target identified (`releases/<previous>`) | `ls -1dt` |

Items 7 and 8 are the ones skipped under pressure. Skipping 7 makes a rollback
unable to restore data; skipping 8 turns a rollback into a rebuild.

## 6. What the pipeline does not do

- No image or dependency scanning, no SBOM, no secret scanning (gap, §5 of the
  deployment audit).
- No post-deploy smoke test beyond the release marker and health check.
- No automatic restore drill or backup verification.
- No canary or staged rollout — activation is all-at-once on one host.
