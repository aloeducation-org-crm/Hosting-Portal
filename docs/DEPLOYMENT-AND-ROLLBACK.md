# Deployment and Rollback

**Status of this document:** describes the pipeline as it exists on branch
`arena/b2ec9268-hosting-portal` at commit `994d737` and later. Sections marked
**BLOCKED** require an action nobody has taken yet. Nothing in here has been
executed against the production host.

---

## 1. What can trigger a production deployment

| Trigger | Can it deploy production? | Evidence |
| --- | --- | --- |
| `pull_request` | **No.** The artifact upload, the preflight job and the deploy job are all conditioned on `github.event_name == 'push' && github.ref == 'refs/heads/main'`. | `.github/workflows/ci-cd.yml`, asserted by `tests/deploy-pipeline.test.ts` |
| `push` to `main` | **Yes.** | same |
| `push` to `develop` | Runs `verify` and `build` only. No artifact upload, no deploy. | `on.push.branches: [main, develop]` + the `if:` conditions |
| `push` to any other branch | **Nothing runs.** The previous `on: push` had no branch filter and ran the whole pipeline for every branch. | same |
| `workflow_dispatch` | Not defined. | no such key in the workflow |
| Tag push | Not defined. | `on.push` has no `tags:` |
| Reusable workflow / other workflow file | None. `.github/workflows/` contains only `ci-cd.yml`. | `ls .github/workflows` |

### 1.1 The approval gate — **BLOCKED, administrator action required**

The deploy job now declares:

```yaml
environment: production
```

That is the hook. But an environment only requires human approval when it has a
**required reviewer** protection rule, and as of this writing:

```
GET /repos/aloeducation-org-crm/Hosting-Portal/environments
→ [{"name":"production","protection_rules":[]}]      # empty

PUT /repos/.../environments/production  (with reviewers)
→ 403 Resource not accessible by integration          # this token lacks administration scope

GET /repos/.../branches/main/protection
→ 403 Resource not accessible by integration          # branch protection therefore UNVERIFIED
GET /repos/.../rulesets
→ []                                                  # no rulesets exist
```

**Therefore: a merge or push to `main` still starts a production deployment with
no human approval.** This document does not claim otherwise.

What an administrator must do (Settings → Environments → `production`):

1. Add **Required reviewers** and name at least one person who is not the usual
   pusher; enable *Prevent self-review*.
2. Optionally set a wait timer of 0 and restrict deployment branches to
   protected branches only.
3. Under Settings → Branches, protect `main`: require the `Lint, typecheck, and
   tests` and `Production build` checks, require a pull request, and forbid
   force pushes and deletions.

Until step 1 exists, treat every merge to `main` as a production release.

### 1.2 A queued deployment is outstanding right now

Merging PR #13 created run
[`40493667038`](https://github.com/aloeducation-org-crm/Hosting-Portal/actions/runs/40493667038).
Its `verify` and `build` jobs succeeded; its **deploy job has been `queued`
since 2026-10-27 11:09 UTC** and no self-hosted runner has picked it up, so
production has not been modified.

That queued job carries the **old** workflow (a run always uses the workflow from
its own commit). If a runner comes online it will execute the unsafe path:
`git pull`, `npm ci`, `node scripts/apply-deploy-schema.mjs` **with no backup, no
transaction, no lock and the rebuild migration enabled by default**, `npm run
build`, `pm2 restart`, `curl /api/health`.

Options, in order of preference — **all of them need someone with repository or
runner access; none has been performed**:

1. Cancel the run (`gh run cancel 40493667038`) and re-run the deploy after the
   fixes in this branch are merged. Cancelling a *queued* job is safe: it has
   executed no steps.
2. Keep the runner offline until the fixed workflow is on `main`.
3. Let it run and accept the risk described in §3.1 — not recommended.

---

## 2. How a deployment works now

```
push to main
  ├─ verify      lint + typecheck + tests                      (ubuntu, no secrets)
  ├─ build       production build with CI-only credentials,
  │              publishes .deploy-digest + artifact            (ubuntu)
  ├─ deploy-preflight   READ-ONLY, on the production runner:
  │                     · artifact digest must match CI's
  │                     · production checkout must have no local changes
  │                     · decides canonical | inline | blocked
  └─ deploy      environment: production   ← approval gate belongs here
                 single-flight concurrency group
                 · re-verifies the artifact digest
                 · bash scripts/deploy-release.sh
```

`scripts/deploy-release.sh` is the only thing that changes the host. Its order of
operations on the **inline** path:

1. Require a 40-hex `DEPLOY_COMMIT_SHA`; refuse anything else.
2. Resolve the database target: explicit `DATABASE_URL`, else read it from
   `/etc/alo-hosting/panel.env` (parsed, never sourced, never printed). Refuse if
   it is not an absolute `file:` path, if the file does not exist, or if it lives
   inside the Git checkout (`ALLOW_DB_IN_CHECKOUT=1` overrides only that last
   rule, loudly).
3. Capture: previous commit SHA, previous `.next`, previous `release-identity.json`,
   and a copy of the database file, under `~/.alo-hosting/deploy-backup/<sha12>/`.
4. Refuse if the checkout gained local changes since preflight.
5. `git fetch`, verify the SHA is an ancestor of `origin/main`, `git reset --hard <sha>`.
6. `npm ci`, `npx prisma generate`.
7. **Additive migrations only** + `--verify`. A rebuild migration is never applied
   by a deployment (see `DATABASE-RECOVERY-RUNBOOK.md`).
8. `npm run build`.
9. Write `release-identity.json` (commit SHA, mode, artifact digest, activation
   time, deployment id).
10. Restart PM2.
11. **Prove it**: poll `/api/health` until it reports `databaseStatus: connected`,
    `schemaStatus: current` **and `release.commitSha` equal to the deployed SHA**;
    then require `/login` to return 200.
12. On any failure after step 5: restore the previous commit, reinstall, rebuild,
    restore the identity file, restart, re-verify — and report plainly if the
    restore did not verify.

The **canonical** path (`scripts/deploy-production.sh`) is preferred whenever the
host supports it: it promotes the CI-built artifact into
`~/alo-hosting/releases/<sha>`, swaps the `current` symlink with `mv -Tf`
(atomic), restarts systemd, runs the same release-identity health probe plus
`/login`, and restores the previous release automatically when verification
fails. It refuses to run if `/etc/alo-hosting/panel.env` is unreadable, if the
production database is missing, if the database would live inside the checkout,
or if the configured `DATABASE_URL` does not match the expected external path.

`scripts/deploy-preflight.sh` chooses between them from read-only facts, using
the pure function in `src/lib/deploy/preflight.ts` (unit-tested). It can answer
**blocked**, in which case nothing is changed and the operator is told which fact
failed.

---

## 3. What was wrong before, and what each fix addresses

### 3.1 Migration ran unconditionally, unbacked — critical

`node scripts/apply-deploy-schema.mjs` ran inside the deploy with no
`DATABASE_URL` set in the job, so the applier fell back to `file:./db/custom.db`,
and the table-rebuild migration was in the default list. Two failure modes were
reproduced on disposable copies (see `tests/migration-safety.test.ts`):

- a schema mismatch orphaned `operation_jobs_new`, and every later deploy then
  failed on `CREATE TABLE` — wedging the pipeline;
- an interruption after `DROP TABLE "audit_logs"` removed the audit table while
  the applier printed `{"ok": true}` and exited 0.

Fixed by: rebuilds opt-in (`--allow-rebuild` + verified `--backup`), one
transaction per rebuild, precondition and postcondition verification including
`audit_logs`, orphan detection and cleanup, a lock file, an explicit absolute
database target, and a `--verify` mode. **A zero exit code is never the only
evidence.**

### 3.2 The deployed release was not the tested release

CI built and uploaded an artifact; the deploy job ignored it, ran `git pull` and
rebuilt on the host with a different Node major (the runner PATH prefers
`v24.22.1`; CI uses `22`). Fixed by: digest recorded at build, verified in
preflight and again on the deploying runner; the canonical path now runs the
CI-built artifact instead of rebuilding. The inline path still rebuilds — that is
a deliberate, documented compromise until the host is bootstrapped for the
canonical shape, and the digest at least proves which payload was delivered.

### 3.3 "Health check passed" did not mean "the right release is serving"

The old check was `curl -sf /api/health`. It could not distinguish the new
release from the old one, or from a process that never restarted.
`DEPLOY_COMMIT_SHA` was exported and never used. Fixed by: release identity +
`/api/health` reporting `release.commitSha`, required to match.

### 3.4 No rollback

Fixed by: capture-before-change plus `restore()` and re-verification on the
inline path; the canonical path already had automatic symlink restore.

### 3.5 No single-flight protection

The old concurrency group was per-`ref`, so two pushes to `main` could deploy
concurrently. Fixed by: `hosting-production-deploy` group with
`cancel-in-progress: false`.

---

## 4. Manual rollback

Application only (no database change involved):

```bash
# canonical shape
ln -sfn ~/alo-hosting/releases/<previous-sha> ~/alo-hosting/.current-rollback \
  && mv -Tf ~/alo-hosting/.current-rollback ~/alo-hosting/current
sudo systemctl restart alo-hosting-panel
curl -s http://127.0.0.1:3051/api/health | jq '.data.release'

# inline shape
cd ~/projects/Hosting-Portal
git reset --hard <previous-sha> && npm ci && npx prisma generate && npm run build
pm2 restart alo-hosting-portal && pm2 save
curl -s http://127.0.0.1:3051/api/health | jq '.data.release'
```

The deploy leaves the pre-change state in `~/.alo-hosting/deploy-backup/<sha12>/`
(previous `.next`, previous `release-identity.json`, and a copy of the database
file), and a full log in `~/.alo-hosting/deploy-logs/<sha>-<timestamp>.log`.

**Rolling the application back does not roll the database back.** Additive
migrations are backward-compatible by construction, so an older application
normally keeps working against a newer schema. A rebuild migration is not
reversible by re-running anything: recovery means restoring the verified backup.
That procedure, with its decision points, is in
[`DATABASE-RECOVERY-RUNBOOK.md`](DATABASE-RECOVERY-RUNBOOK.md).

---

## 5. Release checklist

Before approving a deployment:

- [ ] `verify` and `build` passed **on the exact commit being deployed**.
- [ ] `deploy-preflight` reported `canonical` or `inline`, not `blocked`, and you
      have read *why*.
- [ ] The artifact digest matched in preflight.
- [ ] If this release contains a **rebuild** migration: it has been applied
      separately, by a human, with a verified backup — never by the deploy.
- [ ] A backup of the production database exists and is newer than the last
      schema change.
- [ ] You know the previous commit SHA, so a rollback is a command and not a
      search.

After a deployment:

- [ ] `/api/health` reports the expected `release.commitSha`.
- [ ] `/login` returns 200.
- [ ] `scripts/apply-deploy-schema.mjs --verify` passes against the production
      database (read-only).
- [ ] The deploy log is retained.

---

## 6. Unverified

| Item | Why it is unverified |
| --- | --- |
| Branch protection on `main` | API returns 403 for this token |
| Whether the `production` environment requires a reviewer | `protection_rules: []`, and configuring it returns 403 |
| The canonical path end to end | Needs a bootstrapped host (`/etc/alo-hosting/panel.env`, external DB, systemd unit, scoped sudoers). None exists in this sandbox. |
| The inline path end to end | Needs a host with `pm2` and the panel running. Not available here; every step is asserted statically and the decision logic is unit-tested. |
| The production database path and engine | `docs/PRODUCTION-DEPLOYMENT-AUDIT-2026-10-27.md` records that this was never confirmed on the host. Run `scripts/audit-database.mjs --json` and `scripts/server-doctor.sh` there. |
| Restore of a production backup | No drill has been run. See `DATABASE-RECOVERY-RUNBOOK.md` §Drill. |
