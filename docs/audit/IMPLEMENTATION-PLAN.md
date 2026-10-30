# Implementation plan — ALO Hosting AI

**Date:** 2026-10-29 · **Baseline:** `cbf56fb`
Companion: `IMPLEMENTATION-AUDIT.md`, `BLOCKER_REGISTER.md`.

The plan is ordered by **dependency**, not by the phase numbering in the brief,
because three phases cannot start until an access or approval arrives. Work that
needs nothing external has been moved ahead of work that does.

---

## 1. Sequencing decision

The brief orders Phase 0 → 1 → 2 … Phase 1 is host discovery and is entirely
`[BLOCKED]`. Rather than idle, the unblocked subset of later phases was pulled
forward:

```
DONE   Phase 0  reconcile state, deployment truth, approval gate       ✅
DONE   Phase 2a evidence-classed inventory + route (no host needed)    ✅
BLOCKED Phase 1 read-only discovery of A/B/C/D                         ⛔ A-6, A-3, A-4
OPEN   Phase 2b freshness windows + per-metric state                   ▶ no blocker
OPEN   Phase 3  dashboard + COMMAND over the inventory                 ▶ after 2b
BLOCKED Phase 4  deployment safety                                      ⛔ A-2, A-8
OPEN   Phase 4b malware coverage (CRM repo)                            ▶ separate repo
BLOCKED Phase 5  verification on real infrastructure                    ⛔ everything
```

---

## 2. Work items

### W-1 · Phase 1 discovery — `[BLOCKED]` on A-6

Blocked. The five read-only commands are specified in
`DEPLOYMENT_RECONCILIATION_2026-10-29.md` §7; per-server refresh checklists are in
`SERVER-A…D-FULL-CONFIGURATION.md`. An operator with access runs them and returns
output; nothing else can substitute.

**Why not mocked:** a mock inventory would produce a green dashboard showing four
servers that have never been contacted. That is the exact failure this project
exists to eliminate.

### W-2 · Phase 2b freshness consolidation — `OPEN`, no blocker

| Step | Deliverable | Test |
|---|---|---|
| W-2.1 | Move `3 * 60_000` and the topology comparison onto one exported policy | parity test: same verdicts before/after |
| W-2.2 | Per-metric `present / not-reported` state on `/api/servers` | null never becomes `0` |
| W-2.3 | Render age + stale marker in the dashboard | stale value never bare |
| W-2.4 | Delete the dead `ServersView` or fold it into the live tree | see A-9 |

Design and 49 planned cases already exist (`docs/design/PHASE2_*`). AC→test
traceability is complete (`PHASE2_TRACEABILITY.md`).

### W-3 · Phase 3 dashboard + COMMAND — `OPEN` after W-2

Serve `/api/infrastructure/inventory` (built) into a real view: four server cards,
per-fact evidence badges, `Not reported` / `Access required` states, and the
absence of aggregate capacity that implies interchangeability.

COMMAND surface reuses the existing 31-command allowlist. **No new command engine.**

### W-4 · Phase 4a deployment governance — `OPEN`, needs A-2 and a decision

From `B9-APPLICATION-DEPLOY-PATH.md`:

| Option | Addresses | Recommendation |
|---|---|---|
| R-2 `DEPLOY_INLINE_WORKER=false` + supervised worker | synchronous in-request deploy | **do first** — configuration, not code |
| R-1 approval record before executing | `WEBSITE_DEPLOY` alone deploys | decide |
| R-3 commit ancestry check | deploying a SHA off the branch | cheap |
| R-4 webhook HMAC + nonce | replay | breaking for callers |

### W-5 · Phase 4b malware coverage — `OPEN`, separate repository

`B12-MALWARE-SCAN-COVERAGE.md`: 2 of 9 externally-fed ingest paths scan. Proposal
S-1…S-6 moves enforcement into `storePrivateFile` so the unsafe path stops
existing, rather than adding seven route-level calls that an eighth route can
forget. Vault stays **disabled**.

### W-6 · Database migration — `[BLOCKED]` on A-7

SQLite → MySQL 8 is a migration project, not a config edit. Its own plan, backup,
compatibility review, tests and rollback. **Not** bundled with feature work.

### W-7 · Duplicate-tree removal — `[BLOCKED]` on A-9

Evidence gathered (`D-1`). Needs maintainer sign-off and its own PR.

---

## 3. Critical path

```
A-6 (host access)
   └─► W-1 discovery ─► real inventory ─► B-7 resolved
                                          └─► B-6 gate ─► A-8 merge │ PR #19
                                                          └─► first verified deploy
```

Everything on that path is blocked by a human action, not by code. The code work
available today (W-2, W-3) improves truthfulness of the dashboard but cannot
substitute for it.

---

## 4. Definition of done per phase

| Phase | Done means |
|---|---|
| 2 | every metric carries `observedAt` + state; one freshness policy; `null` never `0`; AC-1…AC-17 pass |
| 3 | four server profiles visible; every status shows evidence + timestamp; COMMAND only via allowlist |
| 4 | production baseline verified; gate verified by a *pending* deployment; both deploy paths governed |
| 5 | `PRODUCTION VERIFIED` only after the running release, identity, health and rollback are all evidenced |

---

## 5. Explicitly not planned

- A parallel command engine (the allowlist is the boundary).
- Speculative writers for `ServerMetric`, `LoadBalancer`, `ReplicationStatus`
  until product behaviour and data ownership are decided.
- Automatic failover, before real failure simulation.
- Any claim of production readiness while B-6 and B-7 are open.
