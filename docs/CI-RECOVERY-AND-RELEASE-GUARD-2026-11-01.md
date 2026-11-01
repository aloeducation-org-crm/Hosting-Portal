# CI recovery, release-guard repair and audit — 2026-11-01

Branch: `arena/f8510b1e-hosting-portal`
Base: `main` @ `64d1dea596459ae13fb4060c4c02d195008a1903` (merge of PR #20)
Pull request: <https://github.com/aloeducation-org-crm/Hosting-Portal/pull/21>

Everything below is separated into what was **implemented**, what was **tested
locally**, what was **tested in CI**, what was **deployed**, and what is **blocked
by missing access**. Nothing is reported as production-verified that was not.

---

## A. Baseline findings (before any change)

| Fact | Value |
| --- | --- |
| Repository | `aloeducation-org-crm/Hosting-Portal` |
| Working branch | `arena/f8510b1e-hosting-portal`, branched from `main` |
| HEAD at start | `64d1dea` (clean tree, no local commits) |
| Remote `main` | `64d1dea` — the PR #20 merge |
| Failing CI | run `41058844163` (push to `main`, PR #20 merge), job `124081509591` — `verify` failed, so `build`/`deploy` **never ran** |
| Test runner | `vitest run`, 48 files / 761 tests at baseline (2 failing) |
| Stack | Next.js 16 (App Router, standalone output), React 19, Prisma 6.19.3, **SQLite via `@prisma/adapter-libsql`**, NextAuth 4, pm2 |
| Datasource | `prisma/schema.prisma`: `provider = "sqlite"`; `src/lib/db.ts` picks the libSQL adapter for `file:` URLs, Prisma's default engine otherwise |
| Pages / API surface | ~40 pages and ~45 API route groups under `src/app/api/**` (activity, agents, ai, alerts, applications, apps, audit-logs, auth, backups, billing, ci, ci-cd, companies, contact, containers, crm, cron, csrf, dashboard, databases, deploy, deployments, domains, email, file-manager, github, health, industries, infrastructure, internal, invoices, logs, marketing, monitoring, network, newsletter, notifications, operations, orchestrator, orders …) |
| Existing safety tests | 48 files covering SSRF, CSRF, RBAC, CRM tenant auth, storage pools, DNS honesty, AI honesty, migration safety, deploy pipeline, release activation, agents |
| Actions used | `actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`, `download-artifact@v4` — all **Node 20**, which GitHub flags as deprecated on runners |
| Production DB per documented baseline | `file:/home/alamin/Hosting-Portal/prisma/db/hosting.db` — **inside the Git checkout** |

### Baseline defects confirmed by inspection

1. **`scripts/deploy-release.sh` contained a duplicate of the unsafe staleness
   guard** added below the correct one (shipped in PR #20). Root cause of both CI
   failures and, more importantly, of a guard that could pass for the exact stale
   run it exists to reject.
2. `tests/deploy-pipeline.test.ts` asserted that the unsafe pattern must be
   **present**, contradicting its own earlier assertion that it must be absent.
   An obsolete assertion, not a weakened test.
3. `scripts/latest-main-sha.mjs` was correct in approach but unguarded on input:
   no `--ref` validation, no timeout on `git ls-remote`, no non-interactive
   credential suppression, no redaction of a token that git can echo inside a
   remote URL.
4. `scripts/backup.sh` / `scripts/restore.sh` were `pg_dump`/`psql` wrappers
   against a **SQLite** datasource — they cannot work on the documented production
   baseline. The deploy path used a plain `cp` of a live SQLite file instead, and
   there was no way to rehearse a restore.
5. `scripts/verify.sh` required `DATABASE_URL=postgresql://`, failing on the
   documented SQLite baseline.
6. No redacted configuration report existed, so nothing answered "is this host
   configured as documented, and is anything dangerous on?" before a release.
7. Workflow: two unreachable lines after `exit "$failed"` in the shell-syntax gate
   (contradicting the shebang-based selection above them), plus Node 20 actions.

---

## B. Root cause of each original CI failure

| Test file | Reported test | Reported line | What actually failed | Verdict |
| --- | --- | --- | --- | --- |
| `tests/release-activation.test.ts` | "resolving the head of main" | 495 | `expect(releaseScript).not.toContain('LATEST_MAIN_SHA="$(git rev-parse origin/main)"')` — the script **did** contain it | **implementation defect** |
| `tests/deploy-pipeline.test.ts` | "refuses stale queued runs and backwards releases unless rollback is explicitly authorized" | 451 | `expect(releaseScript).toContain('LATEST_MAIN_SHA="$(git rev-parse origin/main)"')`, four lines after asserting the same string is absent | **obsolete assertion** |

Both were reproduced locally before any edit:

```
npx vitest run tests/release-activation.test.ts tests/deploy-pipeline.test.ts
→ Test Files 2 failed (2) | Tests 2 failed | 63 passed
```

Both failures came from **one hunk** in `scripts/deploy-release.sh`:

```bash
git fetch origin main
LATEST_MAIN_SHA="$(git rev-parse origin/main)"
[[ "$SHA" == "$LATEST_MAIN_SHA" ]] || fail "… stale …"
git merge-base --is-ancestor "$SHA" origin/main || fail "… not merged …"
```

Why it mattered beyond CI: in a shallow checkout `origin/main` is pinned to the
run's own commit, so the comparison is true for the obsolete run it should reject;
and because the assignment ran *after* section 0, it overwrote the authoritative
head — corrupting `mainHeadAtDecision` in the rollback audit record as well.

---

## C. Files changed and why

| File | Change |
| --- | --- |
| `scripts/deploy-release.sh` | Deleted the duplicate guard. `LATEST_MAIN_SHA` now has exactly one writer (`latest-main-sha.mjs`); staleness stays fail-closed (`[[ -n "$LATEST_MAIN_SHA" && … ]]`); merged-in-main ancestry and the independent backwards-release assertion are kept. |
| `scripts/latest-main-sha.mjs` | Hardened resolver: `--ref` validated before it reaches git; SHA validated and normalised (40-hex, all-zero refused); per-source timeouts; `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS`; API redirects refused; token and URL userinfo redacted from its own messages; still fails closed (exit 1, empty stdout). |
| `scripts/validate-prod-config.mjs`, `src/lib/config/production-config.ts` (new) | Redacted production-configuration report; never emits a value; parses env files instead of sourcing them. |
| `scripts/db-backup.mjs`, `scripts/db-restore.mjs` (new) | Verified SQLite snapshot (`VACUUM INTO` + `integrity_check` + core tables + sha256, mode 0600) and a restore that rehearses into an isolated target, and only overwrites production with `--yes` after taking a verified safety copy. |
| `scripts/backup.sh`, `scripts/restore.sh` | Rewritten as thin wrappers over the above, preserving the documented command lines; PostgreSQL still supported. |
| `scripts/verify.sh` | Accepts the documented SQLite `file:/` database (was postgres-only). |
| `.github/workflows/ci-cd.yml` | `checkout@v5`, `setup-node@v5`, `upload-artifact@v5`, `download-artifact@v6` (first node24 majors), runner/migration notes, two unreachable lines removed. |
| `tests/latest-main-sha.test.ts` (new) | 8 behavioural tests: stale shallow clone vs. remote head, JSON source, ls-remote fallback, fail-closed, malformed/absent/all-zero SHA, unusable refs, credential redaction, and `deploy-release.sh` refusing an unverifiable release before touching anything. |
| `tests/production-config.test.ts` (new) | 12 tests: baseline passes; no secret/URL ever printed; in-checkout DB error vs. accepted warning; relative path; URL disagreement / non-https; secret via `NEXT_PUBLIC_*`; hardening flags; SSO/boot-restore warnings; CLI exit codes; env file parsed, not executed (canary file). |
| `tests/backup-restore.test.ts` (new) | 8 tests: real backup drill (restore into an isolated target, live file byte-identical), corrupt/missing-table refusal, relative URL refusal, unconfirmed production overwrite refused, safety copy on `--yes`, no database URL printed. |
| `tests/deploy-pipeline.test.ts` | Obsolete assertion replaced by a check of **every** executable assignment to `LATEST_MAIN_SHA` (so a duplicate anywhere fails the suite) plus the fail-closed comparison form. |
| `tests/release-activation.test.ts` | New test: every workflow action must be at or above its first node24 major. |
| `docs/DEPLOYMENT-AND-ROLLBACK.md` | §7 single writer for main's head + the PR #20 root cause; §8 action versions and the self-hosted runner requirement; §9 configuration preflight. |
| `docs/PRODUCTION-CONFIG-VALIDATION.md` (new) | What the report checks, the redaction guarantee, and the in-checkout database remediation. |
| `docs/DATABASE-RECOVERY-RUNBOOK.md` | §5.1: repaired backup/restore tooling, the drill, and the applier `--backup` hand-off. |
| `DEPLOY.md` | Backup & Restore section rewritten for the actual SQLite engine and the safe order of operations. |
| `package.json` | `config:validate` script. |

No file was deleted, no route, API, model, integration, environment variable or
script was removed, and no database was touched.

---

## D. Existing features preserved

All existing pages, API routes, Prisma models, authentication/authorization,
middleware, helpers, agents, scheduled tasks, integrations (GitHub, AI providers,
DNS, storage pools, CRM, Stripe, SMTP), deployment scripts
(`deploy-release.sh`, `deploy-production.sh`, `deploy-preflight.sh`,
`apply-deploy-schema.mjs`, `rollback.sh`, `bootstrap-*`), documentation and
environment-variable names are unchanged except where listed in §C. The two
scripts that were rewritten (`backup.sh`, `restore.sh`) keep their documented
command lines, and their previous PostgreSQL behaviour is retained.

---

## E. Features repaired or implemented

* **Staleness guard** — one authoritative writer, fail-closed on an unknown head,
  re-validated immediately before the irreversible `git reset --hard`.
* **Authoritative head resolution** — validated, timed out, non-interactive,
  redacting, with an `ls-remote` fallback and a strict fail-closed exit.
* **Redacted configuration report** — new, exit-code bearing, with 12 tests.
* **Backup and restore** — new verified snapshot and drilled restore, 8 tests.
* **CI actions** — off the deprecated Node 20 runtime.
* **`verify.sh`** — no longer contradicts the shipped engine.

---

## F. Security fixes

| Area | Change |
| --- | --- |
| Deployment guard | A vacuous check that could pass for a superseded run is gone; the authoritative head has one writer, and a duplicate placed anywhere in the script now fails the test suite. |
| Command/argument injection | The resolver refuses `--ref` values that are not plain branch names (`--upload-pack=…`, `../main`, `main..x`, `-x`), so nothing user-supplied reaches a git argument position. |
| Credential leakage | The resolver scrubs the ambient token and any `scheme://user:pass@` userinfo out of its error text; git runs with `GIT_TERMINAL_PROMPT=0` and `GIT_ASKPASS=/bin/true`; API responses are never logged. |
| Backup hygiene | Snapshots and metadata are mode 0600; the disaster-recovery path can no longer overwrite the last good copy. |
| Configuration exposure | `NEXT_PUBLIC_*` variables that carry a server secret, or whose name says secret, are errors; placeholder/CI-only secrets are errors. |
| Insecure flags | `ALLOW_INSECURE_WEBHOOK_HTTP`, `ALLOW_PREVIEW_EMBED`, `DEPLOY_ALLOW_LOCAL_SOURCE`, wildcard CORS, non-loopback `DEPLOY_BIND_HOST` and `AI_ALLOW_ANONYMOUS` are release-blocking in the report. |

Existing controls were **verified, not replaced**: `src/lib/security/url-guard.ts`
(SSRF: private/loopback/link-local/cloud-metadata), CSRF, RBAC, `execFile`-only
subprocess use (no shell), `--` before the clone URL, `DEPLOY_ALLOW_LOCAL_SOURCE`
enforced server-side in `src/app/api/deploy/projects/route.ts`, build-env file
containment under an allowed base, and secret redaction in deploy error responses.

---

## G. Database and migration findings

* Engine is **SQLite** (`provider = "sqlite"`, libSQL adapter). No PostgreSQL, no
  MySQL. Nothing was migrated, reset or recreated in this work.
* `scripts/apply-deploy-schema.mjs` applies **additive** migrations only; a
  rebuild requires `--allow-rebuild` **and** a verified `--backup` (magic header,
  freshness, tables present). The deployment scripts never pass
  `--allow-rebuild` — asserted by `tests/deploy-pipeline.test.ts`.
* **Open risk — the documented production database is inside the Git checkout**
  (`/home/alamin/Hosting-Portal/prisma/db/hosting.db`). `deploy-release.sh`
  refuses to deploy over it unless `ALLOW_DB_IN_CHECKOUT=1`, and the new config
  report reports it as an error. Moving it is an operator action on the host; the
  procedure is in `docs/PRODUCTION-CONFIG-VALIDATION.md`.
* Backups: previously impossible via `pg_dump`; now a verified, consistent
  snapshot with a rehearsed restore path (`tests/backup-restore.test.ts`).

---

## H. Commands actually executed (local, this checkout)

```
git status / git log / gh run list / gh run view
npx vitest run tests/release-activation.test.ts tests/deploy-pipeline.test.ts   # reproduced 2 failures
npx vitest run                                                                  # repeated: 761 → 773 → 781 tests
npm run lint                    
npx tsc --noEmit
npm run build                   # NODE_ENV=production + CI credentials; standalone server emitted
bash -n over scripts/ helpers/ server-helpers/ install-scripts/ deploy/ agent/  # 70 programs
node scripts/latest-main-sha.mjs --ref main
node scripts/validate-prod-config.mjs
bash scripts/backup.sh /tmp/bk/out --json ; bash scripts/backup.sh --verify <file>
bash scripts/restore.sh <file> --target /tmp/bk/drill.db ; … --yes
node -e '…@libsql/client…'      # fixture databases for the drill
```

---

## I. Exact test results

| Run | Result |
| --- | --- |
| Baseline, the two reported files | **2 failed**, 63 passed |
| After the fix, the two reported files | **65 passed** (0 failed) |
| New suites alone | `latest-main-sha` 8/8, `production-config` 12/12, `backup-restore` 8/8 |
| Full suite (final) | **50 files, 781 tests, all passed**, 0 skipped |

---

## J. Build and typecheck

* `npm run lint` → clean (exit 0)
* `npx tsc --noEmit` → clean (exit 0)
* `npm run build` → success; `.next/standalone/server.js` present
* Shell gate in CI style → 70 programs parse

---

## K. GitHub Actions

| Run | Commit | Status |
| --- | --- | --- |
| `41058844163` (baseline, push to `main`) | `64d1dea` | **failure** — `verify` failed on the two test files; `build`/`deploy` never ran |
| `41338154769` (PR run) | `9ae3076` | **success** — `verify` 2m15s, `build` 1m24s; the Node 20 deprecation annotation is gone |
| `41338529011` (PR run) | `fc7f1ac` | `verify` **passed** (2m56s); `build` was **cancelled**, not failed — the PR concurrency group cancels an in-progress run when a newer push lands on the same ref |
| `41338862141` (PR run) | `e91ecef` | **success** — `verify` 2m29s, `build` 1m59s |
| `41339293366` (PR run) | `091a5b2` | **success** — `verify` 2m58s, `build` 1m59s; this is the run at which the branch became green end to end |

`deploy-preflight` and `deploy` are skipped on pull requests **by design** (they
require `refs/heads/main`), so no PR run can reach production.

---

## L. Branch and commits

* Branch: `arena/f8510b1e-hosting-portal` (pushed to the same name)
* `9ae3076` — fix(deploy,ci): remove duplicate shallow-ref staleness guard, harden
  main-head resolution, restore CI
* `fc7f1ac` — fix(backup,restore): replace postgres-only scripts with verified
  SQLite snapshot + drilled restore
* `091a5b2` — documentation correction to the CI table above

Documentation-only commits are ordinary commits here: none carries `[skip ci]`, so
each one runs the same gate. The head-of-branch run is always the authoritative
one — see the PR's Checks tab, or `gh run list --branch arena/f8510b1e-hosting-portal`.

---

## M. Pull request

<https://github.com/aloeducation-org-crm/Hosting-Portal/pull/21> → base `main`.
Not merged: merging is a maintainer decision, and a merge to `main` is also what
triggers a production deployment.

---

## N. Production deployment status

**Not deployed.** No change in this work reached `hosting.alolabs.net`, and no
claim is made that it did. This environment has no access to the production host,
pm2, nginx or the production database.

## O. Production release identity

**Not verified.** `/api/health` reports `release.commitSha` from
`release-identity.json`, and `deploy-release.sh` refuses to report success unless
that SHA equals the deployed commit — but reading it requires host access.

## P. Smoke tests

**Not run against production.** The health contract itself was exercised in CI via
`tests/deploy-pipeline.test.ts` (route imported, identity round-trip, 503 on
database failure), not against a live process.

## Q. Outstanding external configuration or credentials

1. **Self-hosted runner ≥ 2.327.1** — required by the node24 actions used by
   `deploy-preflight` and `deploy`. If it is older those jobs fail immediately,
   before any production change.
2. **Move the SQLite database out of the Git checkout** (operator action; see
   §G). Until then a deployment needs `ALLOW_DB_IN_CHECKOUT=1`, which takes a
   restore copy first.
3. **Environment `production` has no required reviewer** (`protection_rules: []`),
   and branch protection on `main` returns 403 to this token — so a merge to
   `main` still deploys without human approval. Administrator action.
4. **Offsite encrypted backup copy and a real restore drill** against production —
   not done (`docs/DATABASE-RECOVERY-RUNBOOK.md` §6 still says "not run").
5. No AI provider is configured (`AI_PROVIDER=none`, `AI_PROVIDER_ORDER=none`), so
   AI endpoints must keep reporting `UNCONFIGURED`. No end-to-end inference test was
   performed, and none is claimed.
6. `DNS_PROVIDER_MODE=none`: DNS automation must keep reporting "no provider
   configured". Unchanged.

## R. Remaining risks

* The repair restores a **fail-closed** guard, which means a transient GitHub API
  or `ls-remote` outage will refuse a deployment. That is intended, and the failure
  is loud and non-destructive.
* `deploy-release.sh` still supports an inline (in-place) shape for hosts without
  the canonical release layout. It captures the previous commit, `.next`, the
  identity file and a database copy before moving, and restores automatically on a
  failed verification — but only the drill in `tests/backup-restore.test.ts` proves
  the database copy is recoverable; the inline restore of the *application* is
  asserted statically, never executed on a host here.
* The `production` environment and branch protection remain unverified-by-API and
  unenforced until an administrator configures them.
* Nothing in this report should be read as "production ready": the release gates
  that require host access (deploy, release identity, smoke tests) are **not
  verified**.
