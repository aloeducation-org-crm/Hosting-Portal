# Verification record — session 2 (2026-10-29)

**Purpose:** independently re-verify the claims in the previous report before
relying on them, and record the exact reason no host inspection was performed.

---

## 1. Repository reconciliation

The execution sandbox was re-created between sessions. Local `HEAD` had reverted to
`7fc3d15` while the pushed work remained on the remote. `[CI]`/`[HOST-local]`

| Fact | Value | Evidence |
|---|---|---|
| Sandbox local HEAD before reconcile | `7fc3d15` (reverted) | local git |
| Remote branch | `arena/c04ebe8c-hosting-portal` @ **`45d20de`** | `git ls-remote` |
| `main` | `7fc3d15` — unchanged | `git ls-remote` |
| Comparison method | blob hash of **every tracked file** vs `origin/…` | `git hash-object` |
| Result | **ALL TRACKED FILES IDENTICAL** → no work lost | — |
| Action taken | `git reset --hard origin/arena/c04ebe8c-hosting-portal` | safe: content proven identical first |

No force-push, no history rewrite, no discarded commit.

---

## 2. Re-verification of the previous report's claims

| # | Prior claim | Re-verified? | Current result |
|---|---|---|---|
| 1 | All 6 `production` deployment records → run `40256080253` (#31, `54e3454`) | **CONFIRMED** | all six `log_url`s resolve to `40256080253` |
| 2 | Run #43 (`ec7ff40`) succeeded but created no environment record | **CONFIRMED** | deployment list still contains only the six #31 records |
| 3 | `environment:` present at `54e3454` and `7fc3d15` across nine commits | **CONFIRMED but scoping was incomplete** | sampling 12 commits: present at `54e3454`, `7fc3d15`, **and also `88fb789`, `46bb044`, `123d558`**. Absent at `adeeb15`, `3d94abe`, `a86df6f`, `12ac1c4`, `ec7ff40`, `9533375`, `3dd3986`. The conclusion is unaffected — every successful deploy is in the "absent" set — but the original wording implied only two commits had it |
| 4 | Four successful deploy jobs, all without `environment:` | **CONFIRMED** | `3d94abe` #33, `adeeb15` #32, `a86df6f` #36, `ec7ff40` #43 — exactly four, all in the absent set |
| 5 | Workflow used `git pull --ff-only origin main`, not a pinned SHA | **CONFIRMED** | workflow at `ec7ff40` |
| 6 | `/api/health` at `ec7ff40` returned package version, no SHA | **CONFIRMED** | route source at that ref |
| 7 | Run #54 failed and may have mutated the host; logs inaccessible | **PARTIALLY CONFIRMED** | failure confirmed (22:50:42→22:54:54, 4m12s). Host mutation still **UNKNOWN**. Logs still inaccessible (`*.blob.core.windows.net` outside egress allowlist) |
| 8 | PR #19 open, unmerged, checks green, mergeable | **CONFIRMED** | `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, head `a4c9b32`, tests+build `SUCCESS`, deploy jobs `SKIPPED`, `reviewDecision: ""` |
| 9 | `production` has no protection rules | **CONFIRMED, unchanged** | `protection_rules: []`, `can_admins_bypass: true`, `deployment_branch_policy: null` |

**Correction issued for #3.** Recorded rather than quietly fixed, because the
point of this document is that claims are re-derived.

---

## 3. Host-side verification — NOT PERFORMED, and why

The instruction was to proceed with authorised read-only host verification. It
could not be performed. The reasons are mechanical, not discretionary:

| Check | Result |
|---|---|
| `getent hosts alo-server-lap` | **no DNS** |
| `getent hosts 100.94.234.101`, `100.85.239.114` (Tailscale) | **no DNS** |
| `getent hosts 192.168.0.197`, `192.168.0.24` (LAN) | **no DNS** |
| `tailscale` binary | **absent** — no tailnet membership from this sandbox |
| `ssh` binary | present, but no route and no credential |
| `hosting.alolabs.net` | resolves — **not contacted**; resolution is not identity, and A-6 authorises a *host* inspection, not a probe of a public endpoint |

**A-6 has not been granted**, and the instruction states explicitly that the
existence of an approval request is not authorisation. Therefore no connection was
attempted to any of the four servers. B-1 stays **BLOCKED** and B-7 stays **OPEN
/unverified**.

The five read-only commands from reconciliation §7 remain the single next action,
for an operator with access.

---

## 4. Code produced this session

| File | Purpose | Tests |
|---|---|---|
| `src/lib/infrastructure/inventory.ts` | evidence classes, `normaliseFact`, `describeFact`, freshness policy | — |
| `src/lib/infrastructure/server-inventory.ts` | the four-server registry, seeded from owner-reported leads only | — |
| `tests/server-inventory-evidence.test.ts` | 32 tests enforcing the invariants | **32 pass** |

**The invariant these enforce:** `VERIFIED` requires a verifying source
(`HOST_OBSERVATION`/`PROVIDER_API`) **and** a parseable timestamp inside the
freshness window. Everything else downgrades. Consequently the registry reports
**zero VERIFIED facts** today, which is the correct answer while no host has been
observed — and that fact is itself asserted by a test.

Owner-reported leads are `OWNER_PROVIDED` → best status `OBSERVED` → automatically
`STALE` after 24 h. So Server A's "16 GB RAM" will stop looking current on its own,
without anyone remembering to invalidate it.

---

## 5. Documents produced this session

| File | Content |
|---|---|
| `docs/audit/B9-APPLICATION-DEPLOY-PATH.md` | call graph, 9 findings, 7-threat model, 5 remediation options, 7 proposed tests |
| `docs/audit/B12-MALWARE-SCAN-COVERAGE.md` | 12 write primitives classified; 2 of 9 ingest paths scanned; remediation plan |
| `docs/design/PHASE2_TRACEABILITY.md` | threat → AC → test; count reconciliation |
| `docs/audit/BLOCKER_REGISTER.md` | updated B-1…B-14 |

**Not produced, deliberately:** the 17-document deliverable set was largely
host-dependent. Writing them as empty skeletons would have added 14 files of
"UNKNOWN" and no information. The evidence-bearing subset was produced; the
host-dependent remainder is itemised in the blocker register with the exact
command or credential that would populate it. That is a judgement call, stated
here so it can be overruled.

---

## 6. Gate

| Check | Command | Result |
|---|---|---|
| Lint | `eslint src/` | **0 problems** |
| Typecheck | `tsc --noEmit` | **0 errors** |
| Tests | `vitest run` | **595 / 595 pass, 41 files** (563 + 32 new) |
| Dependencies | `npm ci --include=dev` | 0 vulnerabilities |
| Build | `next build` | **pass**, standalone `server.js` present |

Before this session: 563 / 40 files. After: 595 / 41. No existing test skipped,
weakened or deleted.
