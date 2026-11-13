# Merge-integrity verification — every merged PR is fully present in `main`

**Generated:** 2026-11-13
**Scope:** pull requests #1–#38 in `aloeducation-org-crm/Hosting-Portal`
**Question answered:** *are all merge requests actually merged, is any merged file missing from `main`, and are any files broken?*

---

## 1. Verdict

| Question | Answer | Evidence |
|---|---|---|
| Are all merge requests merged? | **Yes — 38 of 38.** No open or closed-unmerged PRs exist. | `gh pr list --state all` |
| Is any PR head or merge commit absent from `main`? | **No.** Every PR's `headRefOid` *and* `mergeCommit.oid` is an ancestor of `main`. | `git merge-base --is-ancestor <sha> main` → true for 38/38 |
| Did this branch hold work that never reached `main`? | **No.** `arena/9304b44c-hosting-portal` was branched from `07c34ad` and differs from `main` by **0 commits / 0 files**. | `git diff --stat main` (empty) |
| Was any file introduced by a merge later dropped without trace? | **No.** Of 1,096 files added by the 44 reachable merge commits, **1,078 are present in `HEAD`** and the remaining **18 are accounted for individually** (§3). **0 unexplained.** | `npm run audit:merges` |
| Are there broken files? | **No.** Lint, typecheck, 1,241 tests, production build, worker build, and the repository audit all pass (§2). | commands in §2 |

Because nothing was missing, **nothing had to be restored**. No application code was changed by this audit; the only additions are the repeatable guard in §4 and this report.

---

## 2. Gate results (run against `main` @ `07c34ad`)

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

CI on `main` is green: the run for `07c34ad` (2026-11-13T19:08Z) **succeeded**. The two earlier failures on `main` (11:52Z and 07:11Z) were fixed by PR #38 itself, which merged at 19:08Z.

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

Notes on the three that are not in the retirement manifest and are therefore pinned explicitly in the guard:

- `src/app/api/agents/[id]/revoke|rotate/route.ts` → now `[slug]/…`. The diff is only the dynamic-segment name plus an explanatory comment; handler bodies are unchanged.
- `.github/workflows/deploy.yml` → superseded by `.github/workflows/ci-cd.yml`. The retired file ran an unattended `git pull` + `pm2 restart` over SSH on every push to `main`; the replacement requires an attributable release approval and verifies the artifact digest, so restoring the old file would re-open that hole.

---

## 4. New guard: `npm run audit:merges`

`scripts/verify-merge-integrity.mjs` makes this verification repeatable instead of a one-off claim. For every merge commit reachable from `HEAD` it collects the files that merge **added** (rename detection disabled, so moves appear as explicit add/delete) and requires each to be either present in `HEAD`, replaced by a canonical path in `archive/retired-2026-11-09/semantic-diff.json`, covered by the explicit `[id] → [slug]` route-rename rule, or covered by the explicit workflow-consolidation rule. Anything else fails the audit with the file, its introducing commit(s), and the instruction to restore it or record a reviewed retirement.

It is wired into:

- `npm run audit:merges` (standalone)
- `npm run verify` (end of the local gate chain)
- the CI `verify` job, which now checks out with `fetch-depth: 0` so the gate cannot silently skip itself

Behaviour was validated in both directions:

- **Positive:** current `main` → `ok: true`, 1,096 added / 1,078 present / 18 explained / 0 unexplained.
- **Negative:** deleting a merged file and committing it → `ok: false`, exit code 1, naming `SERVER-SPEC.md` and its introducing commits.
- **Shallow clone:** prints a `skipped` report and exits 0, so shallow developer clones and server checkouts are never broken.

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
