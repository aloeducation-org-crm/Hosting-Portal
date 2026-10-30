# Deployment Runbook

Operational procedure for deploying the ALO Hosting Portal to production, and for
diagnosing the failures that actually occurred between runs #53 and #64.

**Read this before touching the production host.** Two rules are absolute:

1. **Never bypass a preflight check to force a deployment.** Every block in this
   pipeline exists because something worse happened, or would happen, without it.
2. **Never manually edit the production checkout to make a deploy pass.** If the
   checkout is dirty, find out *why* — the answer is either "the deployment wrote
   it" (safe, and now tolerated automatically) or "someone's uncommitted work is
   on this host" (must not be destroyed).

---

## 1. How a release reaches production

```
merge to main
  └─ verify            lint, typecheck, tests, 70 shell programs parsed
  └─ build             production build + release payload + sha256 digest
       └─ deploy-preflight   [self-hosted] READ-ONLY, before any approval gate
            ├─ reject obsolete run (before downloading the payload)
            ├─ download artifact, verify digest against what CI built
            └─ classify the host checkout, choose canonical | inline | blocked
       └─ deploy       [self-hosted] environment: production, single-flight
            ├─ fetch-depth 0 checkout
            ├─ re-validate main's head AFTER acquiring the deploy slot
            ├─ re-verify artifact digest
            └─ scripts/deploy-release.sh
                 ├─ §0 release guard  ← authoritative, covers both shapes
                 ├─ §1 preflight decides the shape
                 ├─ canonical → scripts/deploy-production.sh
                 │              immutable release dir + atomic symlink swap
                 └─ inline    → capture state, additive migrations, rebuild,
                                write release identity, restart, prove it
```

**Nothing reports success until** `/api/health` names the exact deployed commit
SHA *and* reports the database connected *and* the schema current, *and* `/login`
returns HTTP 200. A 200 from a stale process is rejected by comparing the release
marker's `commitSha` and `deploymentId`.

---

## 2. Preflight

Run it by hand on the host at any time. **It is read-only** — no checkout, no
install into the app directory, no build, no migration, no restart, no
firewall/DNS/SSH change. It prints no secret and no database URL.

```bash
DEPLOY_COMMIT_SHA=$(git rev-parse HEAD) bash scripts/deploy-preflight.sh          # human
DEPLOY_COMMIT_SHA=$(git rev-parse HEAD) bash scripts/deploy-preflight.sh --json   # machine
```

Exit codes: `0` canonical or inline is safe · `1` blocked · `2` usage or
evaluation error.

It reports the deployment mode and which canonical prerequisites are missing.
The decision is made by `src/lib/deploy/preflight.ts` — a pure, unit-tested
function — so the shell cannot drift from the tested behaviour.

### The two shapes

| | **canonical** (intended) | **inline** (what the host runs today) |
|---|---|---|
| Requires | `/etc/alo-hosting/panel.env`, external DB file, writable releases dir, systemd unit, canonical root, usable artifact | Git work tree, classified-clean checkout, `pm2` |
| Build | Promotes the CI artifact; **no build on the host** | Rebuilds on the host |
| Activation | Immutable release dir + atomic symlink swap | `git reset --hard` in place |
| Database | External, absolute path, outside the checkout | Resolved from env, must be absolute and outside the checkout |
| On failure | Restores the previous symlink and restarts | Restores the previous commit, reinstalls, rebuilds, restarts, re-verifies |

Migrate the host to canonical by running `scripts/bootstrap-server.sh`; that
creates the env file, the external database location, the systemd unit and the
scoped sudoers rule.

---

## 3. Release guard

Before anything is touched, and before the shape is chosen, `§0` of
`scripts/deploy-release.sh` decides whether this release may activate at all. The
decision is made by `src/lib/deploy/release-guard.ts`, a pure function, through
`scripts/decide-release-activation.mjs`.

| Outcome | Meaning | Operator action |
|---|---|---|
| `authorize` | Forward release, main's current head | none |
| `already-running` | Same release already serving | none — idempotent retry |
| `stale-target` | This run carries an older commit than main | **Re-run the workflow for the new head.** Do not retry this run. |
| `unknown-main-head` | Main's head could not be resolved | Check network/API reachability from the runner. **Do not** work around it. |
| `unmerged-target` | Target is not an ancestor of main | The commit was never merged. Investigate. |
| `backward-release` | Target is an ancestor of the running release | Refused. See §5 for an authorized rollback. |
| `unattributed-rollback` | Rollback flag set without operator or reason | Supply both. See §5. |

**Why main's head is not read from `git rev-parse origin/main`.** GitHub Actions
checks out with `fetch-depth: 1`. In a shallow clone, `git fetch origin main`
leaves `origin/main` pointing at the run's own commit, so that comparison is true
for exactly the stale run it exists to reject. `scripts/latest-main-sha.mjs`
resolves the head from the GitHub REST API, falling back to `git ls-remote`
(depth-independent). If neither works it prints nothing and exits non-zero, and
the guard **fails closed**.

The target is re-validated a second time immediately before `git reset --hard`,
because a run can sit in the single-flight queue for hours — run #62 waited two —
so "was current when the run started" is not evidence of "is current now".

---

## 4. Troubleshooting

### Blocked: "production checkout has local changes"

**This blocked runs #54, #58, #60, #62 and #64.** Diagnose before acting:

```bash
bash scripts/host-checkout-status.sh "$HOME/projects/Hosting-Portal"          # human
bash scripts/host-checkout-status.sh "$HOME/projects/Hosting-Portal" --json   # machine
```

Exit `0` safe · `1` blocked, offending paths printed · `2` not a work tree.
**Read-only:** it never cleans, stashes, resets or writes.

The classifier distinguishes two cases that a bare `git status` test cannot:

- **Deployment output.** `release-identity.json` is written into the checkout
  root on purpose: the running application reads it from `process.cwd()` to report
  its commit through `/api/health`. It is tolerated **only** when it is untracked,
  on the explicit allowlist, *and* parses as a well-formed release identity record
  (40-hex `commitSha`, `mode` canonical or inline, parseable `activatedAt`,
  non-empty `deploymentId`). A file with that name containing anything else
  **blocks** — the allowlist is not a way to smuggle a payload past the check.
- **Real uncommitted work.** Any modified or staged tracked file, or any other
  untracked file, blocks and is printed by name.

**If it reports tolerated deployment output:** nothing to do. The deployment
proceeds and self-heals — it pulls the commit whose `.gitignore` covers the file.
This is why tolerance is content-validated rather than `.gitignore`-dependent: the
ignore rule cannot take effect until the host checks out the commit containing it,
and that checkout is precisely what the file was blocking.

**If it reports real changes:** stop and investigate. Someone has uncommitted work
on the production host. Do not `git checkout .`, `git clean -fd`, or `git stash`
as a reflex — that destroys it. Establish what it is and whether it belongs in a
commit, then resolve it deliberately. If it turns out to be a stray artifact of an
older deployment, record that in the audit trail before removing it.

### Failed: "artifact carries no digest" / digest mismatch inside the digest step

Seen on run #62 attempt 3. A queued run outlived the artifact's
`retention-days: 2` and downloaded nothing. **Do not retry the old run.** Re-run
the workflow for the current head of main. The preflight job now rejects an
obsolete run *before* downloading the payload, so this should present as a clear
"main has moved to <sha>" message instead.

### Failed: job exceeded the maximum execution time

Runs #58 and #60 died at `timeout-minutes: 5` on a self-hosted job that runs
`npm ci` (~1 min) and then downloads a large artifact (~4–6 min on this runner).
Fixed by PR #17 (`timeout-minutes: 20`). If it recurs, the artifact download is
the slow part — check runner bandwidth to Actions blob storage before raising the
timeout further.

### Deploy succeeded but health reports a different commit

The verification step already treats this as failure and restores automatically.
If restore also failed, the log says `MANUAL RECOVERY REQUIRED` and points at
`docs/DATABASE-RECOVERY-RUNBOOK.md`. The pre-deployment capture is at
`${ALO_DEPLOY_BACKUP_DIR:-~/.alo-hosting/deploy-backup/<sha12>}` and contains the
previous `.next`, the previous release identity, and a timestamped copy of the
database.

---

## 5. Authorized rollback

A rollback is the only deployment that knowingly moves production backwards. It is
refused by default.

**Read this first: a rollback is a code rollback only.** Migrations in this
repository are additive and are applied by deployment; activating an older release
does **not** reverse them. Never assume a migration can be undone. Before rolling
back, confirm the older release is compatible with the schema the newer one
already applied. If it is not, the correct action is a forward fix, not a rollback.

### Procedure

1. Confirm the running release and the target:
   ```bash
   curl -s http://127.0.0.1:3051/api/health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).data.release;console.log(r.commitSha, r.mode, r.activatedAt)})'
   git -C "$HOME/projects/Hosting-Portal" log --oneline -5 main
   ```
2. Confirm the target **is an ancestor of main** — a rollback moves to an older
   *reviewed* commit, never to something unmerged.
3. Verify schema compatibility with the currently-applied migrations.
4. Dispatch the workflow from `main` (**Actions → CI and production deploy → Run
   workflow**), setting all three inputs:
   - `allow_rollback` = `1`
   - `rollback_operator` = who authorized this
   - `rollback_reason` = why the newer release must be withdrawn

   These are dispatch-time inputs on purpose. A rollback cannot be armed
   permanently by a stored repository variable someone forgets, and the operator
   and reason are captured rather than inferred.
5. After the run, verify the audit record:
   ```bash
   tail -n 5 ~/.alo-hosting/deploy-logs/rollback-audit.jsonl
   ```
   Each line records event, timestamp, operator, reason, source release, target
   release, main head at decision time, deployment id and result. The file lives
   **outside** the Git checkout — inside it, the record would make the next
   deployment's dirty-tree check fail.
6. Verify the running release reports the target SHA, and that `/login` returns 200.

Manual equivalent on the host:
```bash
ALLOW_RELEASE_ROLLBACK=1 \
RELEASE_ROLLBACK_OPERATOR="<name>" \
RELEASE_ROLLBACK_REASON="<why>" \
DEPLOY_COMMIT_SHA=<40-hex target> \
DEPLOY_PAYLOAD_DIR="$PWD/.deploy-artifact" \
bash scripts/deploy-release.sh
```

---

## 6. Pre-deployment checklist

Before any production deployment, confirm and record:

- [ ] The exact target commit (full 40-hex SHA) is identified.
- [ ] It is the current head of `main` — or this is an authorized rollback under §5.
- [ ] `bash scripts/host-checkout-status.sh <app-dir>` exits 0.
- [ ] `bash scripts/deploy-preflight.sh` exits 0 and reports the expected mode.
- [ ] The artifact digest matches what CI built (the workflow verifies this twice:
      in preflight and again on the deploying runner).
- [ ] A database backup exists, is recent, and is outside the Git checkout.
- [ ] No other deployment is in flight (`hosting-production-deploy` is
      single-flight and never cancels mid-flight; a queued run will wait).
- [ ] The rollback procedure in §5 has been read, and schema compatibility
      confirmed if a rollback might be needed.
- [ ] Application and infrastructure health are currently green.
- [ ] Deployment approval has been recorded where the `production` environment
      requires a reviewer. **As of this writing it does not** — see
      `PRODUCTION_READINESS.md` R-06.

---

## 7. Post-deployment verification

A merged PR is not a deployed release, and a green run is not a working
application. Verify independently:

```bash
# The running release must name the exact commit.
curl -s http://127.0.0.1:3051/api/health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;console.log(JSON.stringify({success:JSON.parse(s).success,release:d.release,databaseStatus:d.databaseStatus,schemaStatus:d.schemaStatus},null,2))})'

# The login page must actually serve.
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:3051/login
```

Expect `success: true`, `release.commitSha` equal to the target,
`databaseStatus: "connected"`, `schemaStatus: "current"`, and HTTP `200`.

Then confirm in the Actions run that the `deploy` job — not merely `verify` and
`build` — completed successfully, and record the run id and commit in the
deployment log.

---

## 8. Environment and configuration

| Variable | Purpose |
|---|---|
| `ALO_INLINE_APP_DIR` | Inline checkout; defaults to `~/projects/Hosting-Portal`, falls back to `~/Hosting-Portal` |
| `ALO_HOSTING_ROOT` | Canonical release root; default `~/alo-hosting` |
| `PANEL_ENV_FILE` | Default `/etc/alo-hosting/panel.env` |
| `PRODUCTION_DB_FILE` | Default `/var/lib/alo-hosting/alo.db`; must be absolute and outside the checkout |
| `ALO_DEPLOY_LOG_DIR` | Default `~/.alo-hosting/deploy-logs`; holds the run log and `rollback-audit.jsonl` |
| `ALO_DEPLOY_BACKUP_DIR` | Default `~/.alo-hosting/deploy-backup/<sha12>` |
| `DEPLOY_MODE` | Supplied by the workflow's read-only preflight job; standalone runs compute it |
| `ALLOW_RELEASE_ROLLBACK`, `RELEASE_ROLLBACK_OPERATOR`, `RELEASE_ROLLBACK_REASON` | Rollback authorization; all three required together |
| `GITHUB_REPOSITORY`, `GITHUB_TOKEN`, `GITHUB_API_URL` | Used by `scripts/latest-main-sha.mjs`; the token is optional on a public repository and only raises the rate limit |
| `PORT` | Default `3051` |

**Node versions.** The deploy job prepends `~/.nvm/versions/node/v24.22.1/bin` then
`v22.0.0/bin` to `PATH`; CI builds on Node 22; root `package.json` requires
`>=20.9.0`. This is unreconciled and undocumented (R-10). It has not been shown to
cause a failure, but a build-time and run-time Node mismatch is a class of failure
that presents confusingly, so pin it deliberately.

---

## 9. What this pipeline will not do

Understanding the refusals is part of operating it:

- It will not deploy a commit that is not the current head of `main` (except an
  authorized, attributed rollback).
- It will not deploy a commit that was never merged to `main`.
- It will not pull over uncommitted work on the host.
- It will not apply a table-rebuild migration. `--allow-rebuild` requires a human
  and a verified backup, and no deployment path passes it.
- It will not accept a database inside the Git checkout, or a relative
  `DATABASE_URL`.
- It will not report success on a health endpoint that merely answers.
- It will not probe a cloud metadata or link-local address, whatever
  `healthUrl` says.
- It will not run two deployments at once, and it will not cancel one in flight.
- It will not deploy from pull-request code: the deploy jobs require
  `github.ref == 'refs/heads/main'`, and the release artifact is only ever
  uploaded on `main`.
