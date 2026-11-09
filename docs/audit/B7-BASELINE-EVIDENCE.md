# B-7 — production release baseline: narrowed, still open

**Date:** evidence gathered 2026-11-09 (GitHub API, current `main` = `d6404d8`)
**Prior state:** `OPEN` — "Production release baseline unverified"
**New state:** `OPEN` — but the **CI half is now closed**. What remains is host-side drift.

This document does not close B-7. It removes most of the uncertainty around it,
and it corrects a statement this project made earlier.

---

## 1. What was previously believed

From `DEPLOYMENT_RECONCILIATION_2026-10-29.md`:

- the six `production` deployment records are re-runs of run #31 (`54e3454`), all failed — the history is not a deployment log;
- the last successful deploy job was `ec7ff40`, 2026-10-27, under a workflow with no `environment:`;
- run #54 may have mutated the host afterwards;
- therefore the running release is `UNVERIFIED`.

All of that still holds. What was missing was confirmation that **nothing has
deployed since**. That is now confirmed.

---

## 2. New evidence: the last deploy that actually executed

Two runs on 2026-10-27 had the deploy job **execute and succeed** — not skip:

| Run | Commit | Created | Deploy job | Status |
|---|---|---|---|---|
| `40424767745` | `a86df6f` | 2026-10-27T00:11:15Z | `completed/success` | deployed |
| `40439634377` | **`ec7ff40`** | 2026-10-27T02:38:48Z | **`completed/success`** | **deployed — latest** |

`ec7ff40` is the **last commit CI has ever deployed**, confirmed by the job's own
conclusion rather than by inference from the workflow file. `[CI]`

---

## 3. New evidence: nothing has deployed since

Every push-to-`main` run after `ec7ff40`, with the deploy job's actual outcome:

| Created | Commit | Run | Deploy job |
|---|---|---|---|
| 2026-10-27T05:25 | `9533375` | failure | skipped (build failed) |
| 2026-10-27T11:06 | `3dd3986` | failure | skipped |
| 2026-10-27T13:47 | `46bb044` | cancelled | skipped |
| 2026-10-28T09:11 | `88fb789` | cancelled | skipped |
| 2026-10-28T22:31 | `123d558` | failure | skipped |
| 2026-10-29T00:25 | `7fc3d15` | failure | skipped |
| 2026-10-30T12:48 | `721b7aa` | cancelled | skipped |
| 2026-10-30T12:53 | `64d1dea` | failure | skipped |
| 2026-11-01T19:14 | `25354c9` | failure | skipped |
| 2026-11-01T19:31 | `00df3e3` | cancelled | skipped |
| 2026-11-02T10:39 | `74b5461` | success | **skipped** |
| 2026-11-03T19:57 | `afd802c` | success | **skipped** |
| 2026-11-04T21:08 | `d6404d8` | success | **skipped** |

The three "successful" workflows are the trap: **workflow success does not mean
deployed.** In all three the deploy job was skipped outright. `[CI]`

### Why it skips

The workflow was restructured at `0976085` (2026-11-02T10:11:31Z,
*"fix(ci,ai): enforce manual release hold…"*):

```yaml
deploy:
  needs: [build, deploy-preflight]
  if: >-
    github.ref == 'refs/heads/main' &&
    github.event_name == 'workflow_dispatch' &&
    github.event.inputs.release_approval == 'APPROVED' &&
    github.event.inputs.release_ticket != ''
```

A push to `main` can no longer deploy. Release requires a human to dispatch the
workflow, type `APPROVED`, and supply a ticket reference.

**Zero `workflow_dispatch` runs exist** — none among the 100 most recent runs,
which reach back to 2026-10-25T05:27:34Z. So the dispatch path has never been
used either. `[CI]`

---

## 4. What this establishes

**CI could not have changed production after 2026-10-27T02:38Z.**

The confident statement is *narrow* on purpose:

- ✅ No deploy job executed after `ec7ff40`. Enumerated above, all 13 runs.
- ✅ The dispatch path exists but has never fired.
- ❌ This does **not** prove the host runs `ec7ff40`.

B-7 stays open because a green deploy job never proved running code:

| Reason | Reference |
|---|---|
| At `ec7ff40` the job ran `git pull --ff-only origin main`, not a pinned SHA | **B-10** |
| The health check at `ec7ff40` reported no commit identity | **B-11**, C-4 |
| Run #54 (2026-10-28, failed) may have partially mutated the host | C-5, unresolved |
| A human can change the host at any time; CI is blind to that | inherent |
| The host has never been probed | C-6, **B-1** |

So B-7 has collapsed from *"some unknown release, possibly several deploys ago"*
to a single question:

> **Is the host running `ec7ff40`, or has it drifted since 2026-10-27?**

That is answerable with one read-only SSH session.

---

## 5. How to close it

From `DEPLOYMENT_RECONCILIATION_2026-10-29.md` §7 — unchanged, and now worth
running because the expected answer is known in advance. On `alo-server-lap`:

```bash
# 1. Release identity written by the commit-verifying deploy path.
cat ~/projects/Hosting-Portal/release-identity.json

# 2. The checkout the running build came from.
git -C ~/projects/Hosting-Portal rev-parse HEAD
git -C ~/projects/Hosting-Portal status --porcelain

# 3. Process start time brackets the release.
pm2 jlist | jq '.[] | select(.name|test("alo-hosting")) |
  {name, cwd: .pm2_env.pm_cwd, status: .pm2_env.status,
   restarts: .pm2_env.restart_time, uptime: .pm2_env.pm_uptime}'

# 4. Commit identity, if the running build supports it.
curl -s http://127.0.0.1:3051/api/health

# 5. Classifier.
bash scripts/host-checkout-status.sh "$HOME/projects/Hosting-Portal"; echo "exit=$?"
```

### Decision rule

| Observation | Conclusion |
|---|---|
| `rev-parse HEAD` = `ec7ff40` **and** `status --porcelain` empty | **B-7 CLOSED** — baseline `ec7ff40`, clean |
| `rev-parse HEAD` = `ec7ff40` **and** dirty tree | B-7 stays open — running code is not `ec7ff40`; record the diff |
| `rev-parse HEAD` = anything else | B-7 stays open — **and the baseline is that commit**, which becomes the new known state |
| `release-identity.json` absent | expected at `ec7ff40`; consistent with B-11 |
| `/api/health` returns no `commitSha` | expected; confirms the running build predates release identity |
| Host unreachable | B-7 stays `BLOCKED` on B-1 |

Record the raw output in this file, not a summary of it.

---

## 6. Corrections to prior statements

**1. "Merging to `main` triggers an immediate production deploy."**
True at `7fc3d15`, **false now.** Verified both:

```
7fc3d15 → if: github.event_name == 'push' && github.ref == 'refs/heads/main'
d6404d8 → if: … workflow_dispatch && release_approval == 'APPROVED' && release_ticket != ''
```

The hold landed in `0976085` on 2026-11-02. Any risk assessment of a merge to
`main` written before that date is stale. `[SRC]` `[CI]`

**2. B-6 is now partly mitigated, by a different mechanism.**
`environments/production` still has `protection_rules: []` — but the workflow
itself refuses to deploy without a typed approval and ticket. That is a
workflow-level control, not an environment protection rule. It is weaker: it
lives in a file a merge could change, whereas an environment rule does not.
**Keep B-6 open.** `[SRC]` `[CI]`

---

## 7. New operational finding (not B-7)

Run `41408412785` (`808e649`, created 2026-11-02T07:46:01Z) is still
`in_progress`, with *Read-only production preflight* `in_progress`. It has been
hung for roughly a week on the self-hosted runner.

It is not a deploy and has deployed nothing. But a stuck job can hold a
self-hosted runner slot, and it should be cancelled deliberately rather than
left. Not actioned here — cancelling a run is a repository change, and this
document is evidence only.

---

## 8. Evidence classes

| Class | Used for |
|---|---|
| `[CI]` | Every run id, timestamp, commit, and job conclusion in §2–§4 |
| `[SRC]` | The two workflow `if:` blocks, at `7fc3d15` and `d6404d8` |
| `[REPORTED]` | Nothing. No claim here rests on a prior document |
| `[BLOCKED]` | Anything about the host itself — §5 has not been run |

No host was contacted. No deploy, re-run, dispatch, cancel, or repository
setting was changed. Every figure above came from `gh` against
`api.github.com`.
