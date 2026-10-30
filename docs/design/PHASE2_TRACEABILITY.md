# Phase 2 — threat → acceptance criterion → test traceability

**Date:** 2026-10-29
**Companions:** `PHASE2_AGENT_ENROLLMENT.md` (design), `PHASE2_TEST_PLAN.md` (49 cases).
**Status:** design only. No Phase 2 feature code written.

This document closes the review requirement that "each acceptance criterion traces
to at least one test". Every AC below names the tests that would fail if it were
not met. Where an AC cannot yet be tested, it says so and says why.

---

## 1. Threat → AC → test

| Threat | AC | Acceptance criterion (falsifiable) | Tests |
|---|---|---|---|
| T-2 Replay of a captured heartbeat | AC-1 | A replayed `(agentId, nonce)` is rejected and writes no metric | #20 |
| T-3 Forged measurement | AC-2 | No unauthenticated caller can write a metric; the attempt returns 401 | #16, #26 |
| T-1 Stolen enrollment token | AC-3 | A used or expired token cannot enrol a second agent | #23, #24 |
| T-1 (brute force) | AC-4 | The 11th attempt from one IP in 10 min returns 429 | #25 |
| T-10 Revoked agent | AC-5 | A revoked agent is rejected on its **next** request, not at next heartbeat interval | #22, #36 |
| T-6 Stale data shown as current | AC-6 | Every value is rendered with its age unless it is VERIFIED and current | #13, #14, #44 |
| T-6 | AC-7 | A heartbeat older than the live window is not `healthy` | #3, #4 |
| T-6 (skew) | AC-8 | A future-dated heartbeat is not `healthy` | #9 |
| Missing telemetry | AC-9 | A `null` metric is `not-reported` and never `0` | #12, #13, #15 |
| T-4 Command injection | AC-10 | Shell metacharacters in an argument never reach `exec` | #32 |
| T-4 / T-12 Approval bypass | AC-11 | A dangerous command does not execute without an approval record | #30, #31 |
| T-7 Secret leakage | AC-12 | No response ever contains `secretEnc`; the secret appears exactly once | #45, #46, #47, #48, #49 |
| T-8 Cross-tenant observation | AC-13 | Org A cannot observe org B's server | #33 |
| T-5 Telemetry flooding | AC-14 | Per-agent ingestion is rate-limited | #25 (enrol), needs an ingest counterpart |
| T-9 Clock skew | AC-15 | Timestamps outside the skew bound are rejected; receipt time is stored separately | #19 |
| (Phase 0 regression) | AC-16 | A GET performs no create/update/delete | #39, #40 |
| (Phase 0 regression) | AC-17 | An unknown status renders non-operational and is never green | #42, #43 |

---

## 2. Required design properties → where implemented

| Property the review asked for | Where it lives | Verified by |
|---|---|---|
| Record when each metric was observed | `Fact.observedAt` — required for any value-bearing status | `server-inventory-evidence.test.ts` ("drops a value that has no timestamp") |
| Distinguish current / stale / unavailable / unknown / invalid | `FactStatus` (7 members) + `AgentDataState` | same file, "downgrades VERIFIED…", "marks a value older than the window as STALE" |
| Never present an old measurement as current | `describeFact` — OBSERVED and STALE always embed age | "shows an observed value with its age, not bare" |
| Keep missing measurements `null` | `normaliseFact` nulls any non-value-bearing status | "does not let a missing-state status carry a value" |
| One freshness policy, no inline windows | `DEFAULT_FRESHNESS` exported; `3 * 60_000` literals to be replaced (P2-3) | pending P2-3 parity test |
| Delayed heartbeat / skew / disconnection / partial telemetry | design §3.2–3.4 | planned #9, #14, #34, #35 |

**Already enforced in code and passing (32 tests) — Phase 2's honesty core is
built, not merely designed:**
`src/lib/infrastructure/inventory.ts` (evidence classes, `normaliseFact`,
`describeFact`) and `src/lib/infrastructure/server-inventory.ts` (the four-server
registry). This is the part of Phase 2 that does not need host access, so it was
implemented rather than deferred.

---

## 3. ACs that cannot be evidenced yet

| AC | Blocked by | What would evidence it |
|---|---|---|
| Real agent enrols against a deployed control plane | B-1, B-7 | a live enrolment from Server A or B |
| Heartbeat latency and skew tolerable on Server A (Wi-Fi laptop) | B-1 | measured `x-alo-timestamp` vs receipt time |
| Server B's Core2 Duo runs the agent runtime at all | B-1 | `uname -m`, node `--version`, one heartbeat |
| Enrolment survives a PM2 restart | B-1 | restart, then confirm the agent key persists and reconnects |
| Revocation propagates within one interval in practice | B-1 | revoke, then observe the next request fail |
| Disk-full / power-loss behaviour | B-1 | cannot be simulated honestly without the hosts |

Marked `[BLOCKED]`, not mocked. A mock that always succeeds would produce a green
suite and zero information.

---

## 4. Count reconciliation

The review asked to verify the reported 49 tests / 10 ACs rather than accept them.

| Claim | Actual |
|---|---|
| "49 test cases" | **49** numbered cases (#1–#49) across §2.1–§2.6 — **confirmed** |
| "10 acceptance criteria" | **10** in `PHASE2_TEST_PLAN.md` §4 — **confirmed** |
| "31 new tests from Phase 0" | **31** (`server-registry-honesty` 14 + `server-presentation-honesty` 17) — confirmed by run |
| Phase 2 honesty core implemented this session | **32** new tests (`server-inventory-evidence`) |

The 49 are a *plan*; only the 32 inventory tests have actually run. The two must
not be conflated in any status claim.
