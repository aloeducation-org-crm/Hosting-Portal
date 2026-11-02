# Merge and release status — 2026-11-02

Repository: `aloeducation-org-crm/Hosting-Portal`
Working branch: `arena/13edf05e-hosting-portal`
Baseline `main`: `808e649d0a2459a990da47405f9da028072624a0` (merge of PR #23)
Consolidation pull request: [#24](https://github.com/aloeducation-org-crm/Hosting-Portal/pull/24)

## 1. Why no PR was waiting to be merged

A read-only GitHub check found **23 closed/merged PRs and zero open PRs**. Every merge commit from PR #1 through PR #23 is in `main`. The working branch started exactly at `origin/main`, so there was no unmerged PR to merge. The one leftover remote branch, `arena/6987c648-hosting-portal`, is `ahead_by: 0, behind_by: 67`; it contains no commits missing from `main`.

The red/cancelled historical workflow runs were not merge blockers:

- run `41340723944` failed because an obsolete queued deployment had been superseded by a newer head of `main`. The release guard correctly refused it.
- run `41342143433` was cancelled by the per-ref CI concurrency group when PR #22 merged.
- earlier failures were the stale shallow-ref guard and a duplicate unsafe check that PR #21 removed.
- PR #23's own check run `41408382978` succeeded.

## 2. The real error behind the latest main run

Run `41408412785` (merge of PR #23) passed `Lint, typecheck, and tests` and `Production build`. Its self-hosted read-only preflight then failed with:

```text
host-checkout: /home/alamin/projects/Hosting-Portal is NOT safe to deploy
host-checkout: blocking change: untracked: aerus-usage-hud/
host-checkout: blocking change: untracked: alo-hosting-portal/aerus-usage-hud/
```

The deploy job was skipped. This was a fail-closed host-state guard, not a TypeScript, lint, test or build error. The two directories are local UI/UX reference clones documented in `docs/ECOSYSTEM-INTEGRATION-ANALYSIS.md`; they are not tracked source or deployment output.

## 3. Fixes in this consolidation

- `scripts/host-checkout-status.sh` now tolerates only those exact untracked paths when each is its own non-symlink Git work tree whose `origin` remote is the documented `xAerux/aerus-usage-hud` repository. Plain directories, wrong remotes, symlinks and genuine uncommitted work still block.
- `scripts/deploy-release.sh` re-checks the checkout through the same classifier instead of a bare `git status`, so a tolerated path cannot be rejected immediately before the host pulls the fix.
- `.gitignore` covers both reference-clone paths after that pull.
- `.github/workflows/ci-cd.yml` now requires an explicit `workflow_dispatch` on `main` with `release_approval=APPROVED` and a bounded `release_ticket` before uploading a deployable payload, preflighting the host or running the mutating job. A plain merge/push verifies and builds but skips deployment. This is an additional code-level hold because the production environment still has `protection_rules: []` and the integration token received `403` when attempting to add a required reviewer.
- An administrator must still configure required reviewers for the `production` environment and protect `main` in GitHub Settings. The workflow hold does not replace those controls.

## 4. External AI-agent references added

All supplied references were added as 13 typed, non-executable records in `src/lib/ai/external-tool-catalog.ts` and documented in `docs/design/EXTERNAL-AI-CAPABILITY-CATALOG.md`:

1. REA — feature reconstruction baseline, bounded first-party adapter already present.
2. Claude Plugins Official — canonicalized from the truncated alias.
3. Ruflo — multi-agent coding patterns.
4. Android Skills — domain skills.
5. Scientific Agent Skills — canonicalized from the truncated alias.
6. OpenCode — coding-agent permission patterns.
7. CLI-Anything — desktop-app connector patterns.
8. Cursor Plugins — skills/tools/integration patterns.
9. AI Memory — canonicalized to `akitaonrails/ai-memory`.
10. VoiceStudio — voice cloning, consent and AGPL gates.
11. Container — Linux sandbox boundary.
12. treg.to — tool-gateway research; linked `superdesigndev/treg` recorded.
13. WiFi-Password-Cracker-Pro — recorded and **excluded** from the agent.

They are exposed through a read-only authenticated workflow tool, a `hosting.externalToolCatalog` node, a review-only workflow template and the administrator research UI. No external package, plugin, model, endpoint, account, API key, voice service, MCP server or shell command was installed or executed. The catalogue module is protected from agent-authored proposal edits.

## 5. Verification actually performed

Local, in this checkout:

- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm test` — **927 tests / 58 files PASS**
- `npm run build` with CI-only credentials — PASS; `.next/standalone/server.js` present
- shell syntax gate — **70 programs** validated
- `git diff --check` — PASS
- `npm audit --omit=dev` — 0 production advisories. `npm audit` reports 16 moderate dev-tool advisories whose suggested fixes require breaking major changes; no forced downgrade was applied.

GitHub PR checks on runs `41426813472` and final-head run `41427502765` (`c9435e6`): `Lint, typecheck, and tests` and `Production build` **PASS**; `Read-only production preflight` and `Deploy canonical root portal to production server` are **intentionally skipped** on pull requests. The workflow-level release hold also prevents a plain merge/push from deploying.

## 6. Production status

No production deployment, host cleanup, DNS change, database migration, workload migration or release approval was performed. Production remains **NO-GO / manual-only** until the acceptance gates in `docs/SELF-HOSTED-ACCEPTANCE-GATE.md` are complete and an owner explicitly approves a release. Merging this consolidation into `main` must not be interpreted as that approval.
