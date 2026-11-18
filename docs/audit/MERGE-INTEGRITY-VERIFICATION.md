# Merge-integrity verification — every merged PR is fully present in `main`

**Generated:** 2026-11-14
**Scope:** pull requests #1–#39 in `aloeducation-org-crm/Hosting-Portal`
**Question answered:** *are all merge requests actually merged, is any merged file missing from `main`, and are any files broken?*

> **Re-run note (2026-11-14).** This report was refreshed after PR #39 merged, so the scope is now
> 39 PRs / 45 merge commits. It additionally closes the last gap in the first run: four paths that
> were removed *before* the 2026-11-09 unification are now recorded in the guard (§3, §4) instead of
> being explained only by commit history. Verdict is unchanged — **nothing is missing**.

---

## 1. Verdict

| Question | Answer | Evidence |
|---|---|---|
| Are all merge requests merged? | **Yes — 39 of 39.** No open or closed-unmerged PRs exist. | `gh pr list --state all` |
| Is any PR head or merge commit absent from `main`? | **No.** Every PR's `headRefOid` *and* `mergeCommit.oid` is an ancestor of `main`. | `git merge-base --is-ancestor <sha> main` → true for 39/39 heads and 39/39 merges |
| Did this branch hold work that never reached `main`? | **No.** `arena/427e0528-hosting-portal` was branched from `8f020ee` and started with **0 commits / 0 files** of its own. | `git diff --stat main` (empty at branch point) |
| Was any file introduced by a merge later dropped without trace? | **No.** Of 1,098 files added by the 45 reachable merge commits, **1,080 are present in `HEAD`** and the remaining **18 are accounted for individually** (§3). **0 unexplained.** | `npm run audit:merges` |
| Are there broken files? | **No.** Lint, typecheck, 1,241 tests, production build, worker build, and the repository audit all pass (§2). | commands in §2 |

Because nothing was missing, **nothing had to be restored**. No application code was changed by this audit; the only additions are the repeatable guard in §4 and this report.

---

## 2. Gate results (run against `main` @ `8f020ee`)

| Gate | Command | Result |
|---|---|---|
| ESLint | `npm run lint` | Pass — no findings |
| TypeScript (`src`) + scripts project | `npm run typecheck` | Pass — `tsc --noEmit` and `tsc -p tsconfig.scripts.json` |
| Unit/integration tests | `npm test` | **77 files, 1,241 passed, 1 skipped, 0 failed** |
| Production build | `npm run build` | Pass — full route table emitted, no warnings |
| Automation/deploy worker bundles | `npm run build:worker` | Pass — `automation-worker.cjs` 495.5 kB, `deploy-worker.cjs` 495.3 kB |
| Repository audit | `npm run audit:repo` | Pass — **18/18 checks** |
| Shell syntax (repo-wide) | CI step "Validate all shell scripts parse" | Pass — 40+ programs matched by shebang |
| JSON/YAML parse | scripted parse of all 28 tracked `.json`/`.yml` files | Pass — 0 invalid |
| Merge conflict markers | `git grep -nE '^(<<<<<<< |=======$|>>>>>>> )'` | None |
| Empty tracked files | size scan | Only 3 intentional `.gitkeep` markers |

CI on `main` is green: the run for `8f020ee` (2026-11-13T19:26Z, run `43491702424`) **succeeded**.

### 2.1 The two failures that preceded this report, and their root cause

| Failing run | What it was | Failure |
|---|---|---|
| `43383998607` — push to `main`, merge of PR #35 | "Merge pull request #35 from … feat/native-cmake-build-pipeline" | job *Lint, typecheck, and tests* |
| `43420443168` — PR #37 (`arena/374447c3-hosting-portal`) | "Remote-node deployment: verified lifecycle, self-heal, and root-cause acceptance fixes" | `npm test` → `tests/marketing-operator-and-providers.test.ts:383` — `expected 400 to be 200`, then `expected 0 to be greater than 100` |

Both were the **same root cause: schema drift, not missing files.**

PR #37 added migration `20261112120000_remote_node_deployment`, which adds `git_projects.agentId`. It updated the Prisma schema and the migration file, but **not** the two places CI actually derives its test database from:

- `REQUIRED_SCHEMA` in `scripts/apply-deploy-schema.mjs` — still listed `git_projects` without `agentId`, so the column was never created in the CI database;
- `SCHEMA_PROBES` in `src/lib/health.ts` — did not probe the new column.

The health probe therefore reported the schema as incomplete, the `/api/ai/operator` auto-deploy path rejected the request with **400**, and the assertion expecting **200** failed. No file was missing from `main`; every file PR #37 touched is present.

PR #38 ("sync remote-node deployment schema, audit gates, and worker supervision") fixed it at the root by:

- adding `agentId` to `REQUIRED_SCHEMA.git_projects` and `executedByAgentId` to `REQUIRED_SCHEMA.deployments`;
- adding the matching `git_projects` / `deployments` probes to `SCHEMA_PROBES`;
- extending the migration with `deployments.executedByAgentId`;
- adding `DATABASE_BUSY_TIMEOUT_MS` and `ORCHESTRATOR_MAX_TICK_FAILURES` to `.env.example`.

PR #38 did **not** delete or relax any test or any file from PR #37 — it changed 22 files, all of them schema/config/supervision, and it *added* coverage (`tests/native-build.test.ts` +21). Verified locally on `8f020ee`: **77 test files / 1,241 passed / 1 skipped / 0 failed**.

#### Review checklist when a PR adds a column

This failure class is only partly mechanical, so it needs a checklist as well as a test:

- [ ] `prisma/schema.prisma` — model field added
- [ ] `prisma/migrations/<timestamp>_<name>/migration.sql` — `ALTER TABLE … ADD COLUMN`
- [ ] `REQUIRED_SCHEMA` in `scripts/apply-deploy-schema.mjs` — **add it if the panel cannot start or deploy without it** (this is the step PR #37 missed)
- [ ] `SCHEMA_PROBES` in `src/lib/health.ts` — add it if drift must be visible to the health probe
- [ ] `.env.example` — add any new tuning variable it introduces

`tests/deploy-schema-sync.test.ts` enforces the parts that are mechanically decidable (migration → Prisma, and listed-entry → Prisma). It explicitly does **not** enforce "every migrated column must be required", because `REQUIRED_SCHEMA` is a curated minimal subset — 18 migrated columns are correctly absent from it today.

---

## 3. The 18 merge-added paths that are not at their original location

These are the *only* files that a merge commit added and that are absent from `HEAD`. Each one is a deliberate move, rename, or retirement with a recorded canonical replacement — none is a lost change.

| Path added by a merge | Resolution | Classification |
|---|---|---|
| `.github/workflows/deploy.yml` | consolidated → `.github/workflows/ci-cd.yml` | auto-deploy workflow superseded by the release-guarded CI and production deploy workflow |
| `Dockerfile.node20` | retired duplicate → `Dockerfile` | canonical-deployment-config-superset |
| `alo-hosting-portal/server-helpers/alo-cron-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-cron-helper` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-deploy-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-deploy-helper` | archived-historical-artifact-with-canonical-capability |
| `alo-hosting-portal/server-helpers/alo-dns-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-dns-helper` | archived-historical-artifact-with-canonical-capability |
| `alo-hosting-portal/server-helpers/alo-docker-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-docker-helper` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-email-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-email-helper` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-encryption-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-encryption-helper` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-firewall-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-firewall-helper` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-hosting-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-hosting-helper` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-site-backup` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-site-backup` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-site-lifecycle` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-site-lifecycle` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-ssh-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-ssh-helper` | byte-identical-active-copy |
| `alo-hosting-portal/server-helpers/alo-ssl-helper` | superseded capability; archived at `archive/retired-2026-11-09/alo-hosting-portal/server-helpers/alo-ssl-helper` | archived-historical-artifact-with-canonical-capability |
| `docker-compose.node20.yml` | retired duplicate → `docker-compose.yml` | canonical-deployment-config-superset |
| `docs/SERVER-SPEC.md` | retired duplicate → `SERVER-SPEC.md` | documentation-superseded-and-archived |
| `src/app/api/agents/[id]/revoke/route.ts` | renamed → `src/app/api/agents/[slug]/revoke/route.ts` | dynamic segment renamed [id] -> [slug] |
| `src/app/api/agents/[id]/rotate/route.ts` | renamed → `src/app/api/agents/[slug]/rotate/route.ts` | dynamic segment renamed [id] -> [slug] |

Notes on the entries that are not in the retirement manifest and are therefore pinned explicitly in the guard:

- `src/app/api/agents/[id]/revoke|rotate/route.ts` → now `[slug]/…`. The diff is only the dynamic-segment name plus an explanatory comment; handler bodies are unchanged.
- `.github/workflows/deploy.yml` → superseded by `.github/workflows/ci-cd.yml`. The retired file ran an unattended `git pull` + `pm2 restart` over SSH on every push to `main`; the replacement requires an attributable release approval and verifies the artifact digest, so restoring the old file would re-open that hole.

### 3.1 Four further paths: removed *before* the unification, now also recorded

Comparing the file tree of **every PR head** (not only merge-added files) against `HEAD` surfaces 438 paths that no longer sit at their original location. 431 are the 2026-11-09 retirement set. The other 7 are the routes and workflow above plus these four, which were removed by ordinary commits months earlier and so never appeared in `semantic-diff.json`. They were verified individually — each was **superseded, not lost** — and are now pinned in the guard's `CONSOLIDATED` map so their absence is a matter of record rather than of archaeology:

| Path | Removed by | Replacement that still exists in `HEAD` |
|---|---|---|
| `alo-hosting-portal/.github/workflows/ci-cd.yml` | `8eadfc1` — "fix: workflows at repo root with correct cache-dependency-path" (2026-10-25) | `.github/workflows/ci-cd.yml` |
| `alo-hosting-portal/.github/workflows/deploy.yml` | `8eadfc1` (same commit — nested app's workflows moved to the repository root) | `.github/workflows/ci-cd.yml` |
| `bun.lock` | `2023a1e` (2026-10-25) — project standardised on npm | `package-lock.json` |
| `src/app/login/page.tsx` | `4b81b35` — phase-1 auth rebuild | `src/app/(auth)/login/page.tsx` |

Each replacement was confirmed to exist in `HEAD` at the time of the audit. **Result: 438 absent paths, 438 accounted for, 0 unexplained.**

---

## 4. New guard: `npm run audit:merges`

`scripts/verify-merge-integrity.mjs` makes this verification repeatable instead of a one-off claim. For every merge commit reachable from `HEAD` it collects the files that merge **added** (rename detection disabled, so moves appear as explicit add/delete) and requires each to be either present in `HEAD`, replaced by a canonical path in `archive/retired-2026-11-09/semantic-diff.json`, covered by the explicit `[id] → [slug]` route-rename rule, or covered by the explicit `CONSOLIDATED` map (workflow consolidation plus the four pre-unification removals in §3.1). Anything else fails the audit with the file, its introducing commit(s), and the instruction to restore it or record a reviewed retirement.

It is wired into:

- `npm run audit:merges` (standalone)
- `npm run verify` (end of the local gate chain)
- the CI `verify` job, which now checks out with `fetch-depth: 0` so the gate cannot silently skip itself

Behaviour was validated in both directions:

- **Positive:** current `main` (`8f020ee`) → `ok: true`, exit 0 — **1,098 added / 1,080 present / 18 explained / 0 unexplained** across 45 merge commits.
- **Negative (retired file):** deleting a merged file and committing it → `ok: false`, exit code 1, naming `SERVER-SPEC.md` and its introducing commits.
- **Negative (pre-unification path):** re-adding `bun.lock` on a branch, merging it, then deleting it again → without the new `CONSOLIDATED` entry the guard fails with exit 1 (`unexplained: 1`, naming the merge commit); with the entry it passes and reports `via: "consolidated" → package-lock.json`. This is the test that proves the four paths in §3.1 are genuinely pinned rather than merely described.
- **Shallow clone:** prints a `skipped` report and exits 0, so shallow developer clones and server checkouts are never broken. CI pins `fetch-depth: 0` so the gate cannot silently no-op itself.

---

## 5. Reproduce

```bash
git fetch --unshallow            # history is required; the audit skips on shallow clones
npm run audit:merges             # merge-integrity report (JSON)
npm run audit:repo               # tree-shape audit (18 checks)
npm run verify                   # lint → typecheck → test → build → worker → audits
```

---

## 6. Not verified here

`prisma validate` / `prisma migrate diff` could not run in the audit sandbox: Prisma downloads its schema engine from `binaries.prisma.sh`, which is unreachable from this environment. The repository already works around engine availability with `PRISMA_*=/bin/true` for `db:generate`, and `npm run db:generate` succeeds. Schema/migration drift therefore remains covered by the existing `db:sync`/`db:push` deploy path rather than by this report.
