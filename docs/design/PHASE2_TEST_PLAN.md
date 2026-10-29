# Phase 2 — Test plan and acceptance criteria

**Status:** PLAN. No Phase 2 test has been written yet.
Companion: `PHASE2_AGENT_ENROLLMENT.md`.

Test runner: existing `vitest run` (`npm test`), `tests/*.test.ts`, node
environment, `@/` alias to `src`. New suites follow the Phase 0 pattern —
**behavioural assertions**, not source-text matching, because a text assertion
passes for any rewrite that reintroduces the defect with different literals.

---

## 1. Required categories → where they are covered

| Required category | Suite | Notes |
|---|---|---|
| Authentication failures | `phase2-agent-auth.test.ts` | bad signature, missing headers, stale timestamp, replayed nonce, revoked agent, unknown key |
| Authorisation denials | `phase2-agent-authz.test.ts` | scope not held, command not allowlisted, dangerous op without approval, cross-tenant read |
| Stale telemetry | `phase2-observation-state.test.ts` | window boundaries, skew, absent timestamps |
| Missing fields | `phase2-observation-state.test.ts` | null preserved end to end |
| Agent disconnection | `phase2-agent-lifecycle.test.ts` | active→stale→offline→recover |
| Read-path purity | `phase2-read-purity.test.ts` | GET performs no writes |
| Secret leakage | `phase2-secret-redaction.test.ts` | `secretEnc` never serialised; token shown once |

---

## 2. Test cases

### 2.1 `observation-state` (pure; P2-1)

| # | Case | Expected |
|---|---|---|
| 1 | active agent, heartbeat 30 s ago | `healthy` |
| 2 | heartbeat exactly at `liveWindowMs` | `healthy` (boundary inclusive) |
| 3 | heartbeat `liveWindowMs + 1 ms` | `stale` |
| 4 | heartbeat `staleWindowMs + 1 ms` | `offline` |
| 5 | `lastHeartbeat = null`, agent active | `unavailable` — **not** `offline`, not `healthy` |
| 6 | no agent row at all | `unavailable` |
| 7 | agent `revoked` | `revoked` — data historical, never `healthy` |
| 8 | agent `pending` | `pending` — never `healthy` |
| 9 | heartbeat timestamp in the future (skew) | not `healthy`; clock-skew state surfaced |
| 10 | windows overridden by env | policy follows override, defaults unchanged |
| 11 | metric present | `present` with `measuredAt` |
| 12 | metric `null` | `not-reported` — **assert it is never `0`** |
| 13 | metric absent from payload | `not-reported` (same as null) |
| 14 | agent `offline` with last value present | value returned **with age** and stale marker |
| 15 | `NaN`/`Infinity`/negative value | `not-reported`, not rendered |

### 2.2 Authentication failures (T-1, T-2, T-3, T-10)

| # | Case | Expected |
|---|---|---|
| 16 | no `x-alo-*` headers | `401 MISSING_AGENT_AUTH` |
| 17 | wrong signature | `401 AGENT_AUTH_FAILED`, body not trusted |
| 18 | signature over a different body | rejected (signature covers exact bytes) |
| 19 | timestamp older than skew window | `401` |
| 20 | replayed `(agentId, nonce)` | `401`; nonce store rejects |
| 21 | unknown `agentKey` | `401`, identical generic message to #17 (no enumeration) |
| 22 | agent status `revoked` | `401` and **no** metric row written |
| 23 | enrollment token reused | `401 ENROLLMENT_FAILED`, generic message |
| 24 | enrollment token expired | `401`, same generic message |
| 25 | enrollment with 11th attempt from one IP in 10 min | `429 RATE_LIMITED` |
| 26 | unauthenticated POST to any metric ingest path | `401` — no unauthenticated ingest exists |

> Assertion style for #17/#21/#23/#24: **the response bodies are byte-identical.**
> A rejected caller must not learn whether a key exists, is revoked, or is expired.

### 2.3 Authorisation denials (T-4, T-12)

| # | Case | Expected |
|---|---|---|
| 27 | command not in allowlist | denied before execution; nothing spawned |
| 28 | allowlisted command, actor lacks scope | `403` |
| 29 | READ_ONLY capability agent asked to run a mutating command | denied |
| 30 | dangerous command without approval record | queued as awaiting approval, not executed |
| 31 | approval granted by an actor without the approving role | `403` |
| 32 | argv injection attempt (`;`, `&&`, newline) in an argument | rejected by Zod schema; never reaches exec |
| 33 | org A reading org B's server observation | `404`-equivalent: not visible (not `403`, to avoid enumeration) |

### 2.4 Lifecycle / disconnection

| # | Case | Expected |
|---|---|---|
| 34 | heartbeats stop | `healthy` → `stale` → `offline` at the documented boundaries |
| 35 | heartbeat resumes | returns to `healthy`; no duplicate agent created |
| 36 | revoke during outage | next request `401`; observation state `revoked` |
| 37 | rotation | old secret rejected after rotation; new secret accepted |
| 38 | two agents claim the same `serverId` | second enrolment refused or explicitly supersedes; never two `active` agents silently |

### 2.5 Read-path purity and rendering (P2-2, P2-4)

| # | Case | Expected |
|---|---|---|
| 39 | `GET /api/servers` on empty DB | returns empty registry; **no row created** (Phase 0 regression guard) |
| 40 | `GET /api/servers` twice | identical payload; no writes |
| 41 | server with no metrics | `capacity` all `null`, every metric `not-reported` |
| 42 | server status `OFFLINE` | rendered `down` tone, non-operational (Phase 0 guard) |
| 43 | unknown status string | `UNKNOWN`, grey, non-operational |
| 44 | stale metric rendered | shows value **and** age; never presented as current |

### 2.6 Secret handling (T-7)

| # | Case | Expected |
|---|---|---|
| 45 | `GET /api/agents` | no `secretEnc`, no plaintext secret in any response |
| 46 | enrolment response | secret present **once**; a later `GET` does not return it |
| 47 | audit row for enrolment | no token, no secret |
| 48 | logger output on failed auth | no secret, no signature value echoed |
| 49 | metadata redaction | keys matching `secret|token|signature|key` redacted at depth |

---

## 3. Failure scenarios required by the brief — mapped

| Brief scenario | Coverage | Status |
|---|---|---|
| Server offline | #4, #34 | planned |
| Agent disconnected | #34, #35 | planned |
| Database unavailable | existing `/api/health` 503 path (Phase 0 era) | **existing** |
| Disk full | agent-side `ENOSPC` handling | **`[BLOCKED]`** needs a host |
| Build failure | `deploy-pipeline.test.ts` | **existing** |
| Deployment failure | `deploy-e2e.test.ts` | **existing** |
| Invalid DNS record | `dns-provider.test.ts` | **existing** |
| SSL issuance failure | not covered | `[BLOCKED]` needs provider |
| GitHub webhook replay | `deploy-github-api.test.ts` | **existing** |
| Unauthorized file access | `storage-pools.test.ts` traversal cases | **existing** |
| Backup corruption | not covered | **missing** |
| Network outage | #34/#35 approximate at the API boundary | partial |
| Power outage | — | **`[BLOCKED]`** needs hosts |
| Replication conflict | — | **missing** (feature absent; no speculative test) |
| Failed rollback | `release-activation.test.ts` | **existing** |

---

## 4. Acceptance criteria for Phase 2

Phase 2 is **verified** only when all of the following hold. Each is stated so it
can be failed.

1. `observation-state.ts` exists, is pure, and has no I/O or clock dependency
   outside an injected `now`.
2. All 15 cases in §2.1 pass, including boundary-inclusive windows and the
   `null → "not-reported"` rule.
3. `GET /api/servers` performs **no** create/update/delete — asserted by test #39/#40.
4. Every metric in every API response carries `value`, `state`, and
   `measuredAt`; `state: "not-reported"` is rendered as `Not reported` in the UI.
5. No response anywhere serialises `secretEnc`; enrolment secret appears exactly
   once (tests #45–#46).
6. Auth failures are byte-identical across unknown / expired / revoked / replayed
   causes (tests #17–#24).
7. Freshness windows are defined **once** and imported by `topology`,
   `orchestrator/status`, and `/api/servers` (§2.3 of the design; regression
   parity test).
8. The full gate passes: `eslint` 0, `tsc --noEmit` 0, `vitest run` all pass,
   `next build` succeeds, standalone entrypoint present.
9. No existing test is skipped, weakened, or deleted; any changed assertion is
   itemised with the preserved property named.
10. A real agent enrols and reports against a deployed control plane — **only
    then** may Phase 2 be called *deployment-verified*. Until B-1 clears, Phase 2
    is at most *test-verified* and must be described that way.

---

## 5. What will NOT be claimed

- Not "production-ready" on the strength of a green suite.
- Not "agent connected" — no agent has ever been enrolled against a live
  deployment from this environment.
- Not "monitoring works" — no live telemetry has been observed.
- Not "failover tested" — no failure simulation has been run.
- Any test that cannot run without host access is marked `[BLOCKED]` above rather
  than replaced by a mock that would pass vacuously.
