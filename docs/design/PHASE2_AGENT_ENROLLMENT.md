# Phase 2 — Agent Enrollment: architecture, threat model, API contract

**Status:** DESIGN. No Phase 2 feature code has been written.
**Date:** 2026-10-29
**Precondition satisfied:** deployment baseline uncertainty is documented in
`docs/audit/DEPLOYMENT_RECONCILIATION_2026-10-29.md` §6 (`UNVERIFIED`), and the
approval gate is documented in `docs/audit/PRODUCTION_APPROVAL_GATE.md`.

**Scope constraint:** everything below is safe, non-production work — pure
modules, API contracts and tests. No live server is contacted, no server is
modified, and no credential is created.

> **Design principle for this phase.** The goal is to replace `Not reported`
> values with *observed* values, never with new defaults. Phase 0 removed
> fabricated numbers (`?? 4`, `?? 15`, `|| "ONLINE"`). If Phase 2 replaces those
> with a different set of plausible constants — a 3-minute-window fallback, a
> zero, a cached last-known-good presented without age — it will have re-created
> the same defect in a subtler form. Every rule below is written to prevent that.

---

## 1. What already exists — reuse, do not rebuild

Read from source at `67d7f7d`. All `[SRC]`.

| Capability | Where | State |
|---|---|---|
| Enroll / heartbeat / claim / result / approve / revoke / rotate routes | `src/app/api/agents/**` (13 route files) | implemented |
| HMAC-signed request auth (agent key + signature + timestamp + nonce) | `src/lib/agents/http.ts` → `authenticateAgentRequest` | implemented |
| Replay protection store | `AgentNonce` (`@@unique([agentId, nonce])`, `expiresAt`) | implemented |
| Single-use enrollment token, hashed at rest, TTL, bound server/scopes/capabilities | `AgentEnrollmentToken` (`tokenHash @unique`, `usedAt`, `expiresAt`, `prefix`) | implemented |
| Encrypted agent secret | `ServerAgent.secretEnc` | implemented |
| Agent lifecycle status | `ServerAgent.status` ∈ `pending｜active｜revoked` | implemented |
| Metric persistence | `recordHeartbeat` → `AgentMetric.create` + selective mirror to `Server.cpuUsage/memoryUsage/diskUsage` only when non-null | implemented |
| Command allowlist / trust boundary | `src/lib/agents/allowlist.ts` (argv-only, per-command Zod, risk level, timeout, sudo flag, scopes) | implemented |
| Rate limiting on enroll (per `x-real-ip`, not spoofable `x-forwarded-for`) | `api/agents/enroll/route.ts` | implemented |
| `dataState` concept (`live` / `stale` / `unavailable` / `revoked`) | `api/infrastructure/topology`, `api/orchestrator/status` | implemented, **not shared** |

**Conclusion: the security-critical machinery is already built and correct in
shape.** Phase 2 is an extension of the observation *read path*, not a rebuild of
the agent system. Rebuilding it would risk the trust boundary for no gain.

---

## 2. The actual gap

| # | Gap | Evidence |
|---|---|---|
| G-1 | The servers registry (`GET /api/servers`) does **not** expose freshness. It returns raw `status` plus `metrics` from `ServerMetric` — a model with **zero writers** — so the UI cannot tell fresh from stale from never-measured. | `[SRC]` |
| G-2 | Freshness windows are **duplicated and inline**: `3 * 60_000` in `orchestrator/status`, a separate comparison in `infrastructure/topology`. Two definitions of "online" will drift. | `[SRC]` |
| G-3 | There is no **per-metric** state. A host can report CPU but not disk; today the UI cannot distinguish "disk never reported" from "disk is 0%". | `[SRC]` |
| G-4 | `dataState` names differ between surfaces (`live/stale/unavailable/revoked` vs `onlineWindowMs` vs nothing), so a UI must special-case each. | `[SRC]` |
| G-5 | `Server.cpuUsage/memoryUsage/diskUsage` are denormalised mirrors that default to `0`. A read that uses them without an age cannot tell a stale mirror from a real reading. | `[SRC]` |

G-1..G-5 are the whole of Phase 2's *observability* work. None requires a schema
change.

---

## 3. Architecture

**Observation flows one way.** An agent measures and pushes; the control plane
stores and evaluates; the dashboard reads and renders. No surface infers state
from configuration, and no read path writes.

```
host (Server A/B)                                     control plane
┌──────────────────┐   HMAC-signed HTTPS   ┌──────────────────────────────────┐
│ alo-agent.mjs    │ ────────────────────► │ /api/agents/heartbeat            │
│  - measures      │   key+sig+ts+nonce    │   requireAgent()  ── nonce store │
│  - inventory     │                       │   recordHeartbeat()              │
│  - services      │                       │     → AgentMetric (nulls kept)   │
└──────────────────┘                       │     → Server mirrors (if non-null)│
                                           └───────────────┬──────────────────┘
                                                           │
                                    ┌──────────────────────▼──────────────────┐
                                    │  observation-state.ts  (NEW, pure)      │
                                    │  one canonical freshness policy         │
                                    │  agent state + per-metric state         │
                                    └──────────────────────┬──────────────────┘
                                                           │ null-preserving
                                    ┌──────────────────────▼──────────────────┐
                                    │ GET /api/servers, /infrastructure/*     │
                                    │   read-only: no create/update on GET    │
                                    └──────────────────────┬──────────────────┘
                                                           │
                                    ┌──────────────────────▼──────────────────┐
                                    │ dashboard: "Not reported" / "Stale 42s" │
                                    │  never 0, never green-by-default        │
                                    └─────────────────────────────────────────┘
```

### 3.1 New module (pure, testable, no I/O)

`src/lib/infrastructure/observation-state.ts`

```ts
export type AgentDataState =
  | "healthy"      // active agent, heartbeat inside liveWindow
  | "stale"        // active agent, heartbeat inside staleWindow but past liveWindow
  | "offline"      // active agent, heartbeat past staleWindow
  | "unavailable"  // no agent, or agent never reported a heartbeat
  | "revoked"      // credentials withdrawn; data is historical, not live
  | "pending";     // enrolled but not yet activated
```

Sits alongside the Phase 0 modules `server-registry.ts` and
`server-presentation.ts`, which already establish the "absent is not zero" rule.

### 3.2 Canonical windows

| Window | Default | Meaning |
|---|---|---|
| `liveWindowMs` | **180_000** (3 min) | matches the existing `orchestrator/status` precedent |
| `staleWindowMs` | **900_000** (15 min) | beyond live, still attributable to a running agent |
| heartbeat interval | 60 s (agent side) | 3 missed beats ⇒ stale, 15 ⇒ offline |

Single definition, imported everywhere. Env override allowed for tests; the
**defaults are the policy**, not a fallback value, and a missing timestamp
yields `unavailable`, never a default time.

### 3.3 Per-metric state

A host that reports CPU but not disk must not render disk as `0`.

```ts
export type MetricState = "present" | "not-reported" | "not-applicable";
```

Rules:
- value `null`/absent ⇒ `not-reported` ⇒ UI shows **"Not reported"** (Phase 0
  wording) — never `0`, never `—%`, never a spinner that implies pending.
- value present but agent `offline` ⇒ render the value **with its age** and a
  stale marker; never as current.
- value present, agent `revoked` ⇒ historical; must be labelled as such.

### 3.4 Read-path invariants (non-negotiable)

1. **A GET never creates or mutates an operational record.** Phase 0 removed one
   violation (`GET /api/servers` inserting a fabricated server). This is now a
   standing invariant with a test.
2. **No read returns an invented value.** Absent → `null` → "Not reported".
3. **Every value carries its age.** A metric without `measuredAt` is not
   renderable as current.
4. **State is evaluated at read time**, from stored timestamps, not stored as a
   derived column that can go stale.

---

## 4. Threat model

Assets: control-plane integrity, the production hosts, student/partner document
data, agent credentials, and the operator's trust in the dashboard.

| # | Threat | Impact | Mitigation | State |
|---|---|---|---|---|
| T-1 | **Stolen enrollment token** used to enrol a rogue agent | rogue host appears as a real server; forged telemetry | token is single-use (`usedAt`), short TTL, hashed at rest, bound to `serverId` + scopes + capabilities, rate-limited per trusted IP | **existing** — verify with tests |
| T-2 | **Replay of a captured heartbeat** | stale reading presented as live; or metric history corrupted | HMAC over raw body + `x-alo-timestamp` freshness + `AgentNonce` unique per agent | **existing** — verify window + replay |
| T-3 | **Forged measurement** from an unauthenticated caller | fabricated capacity and health — the Phase 0 defect re-introduced over the network | all ingest requires `requireAgent`; no unauthenticated metric endpoint | **existing** — add negative test |
| T-4 | **Compromised agent host** issuing arbitrary commands | lateral movement / host takeover | allowlist: argv-only, no shell, per-command Zod re-validated agent-side, risk level, sudo only where declared, scopes per command, approval for dangerous ops | **existing** — do not weaken |
| T-5 | **Telemetry flooding / DoS** | control-plane exhaustion, cost | per-agent rate limit + payload caps (`.max()` on arrays and numbers already present) | **partial** — add explicit per-agent limit |
| T-6 | **Stale data presented as current** | operator acts on old numbers (the most likely *operational* failure) | canonical windows, mandatory age, `stale`/`offline` states, UI markers | **NEW (G-1..G-4)** |
| T-7 | **Secret leakage in logs or responses** | agent HMAC keys or scope lists exposed | never serialise `secretEnc`; redact in logs; response DTOs must whitelist fields | **partial** — add response-shape test |
| T-8 | **Cross-tenant observation** | one org sees another's hosts | every read scoped by organisation; agent → `serverId` → org | **partial** — needs explicit test |
| T-9 | **Timestamp forgery / clock skew** | replay window bypass | reject timestamps outside a small skew window; store server-side receipt time separately | **partial** — confirm skew bound |
| T-10 | **Revoked agent still ingesting** | decommissioned host keeps writing | `status === "revoked"` must reject at `requireAgent`, not just in the UI | **existing** — verify |
| T-11 | **Enrollment token brute force** | rogue enrolment | 10 attempts / 10 min per trusted IP; ≥128-bit token entropy | **existing** |
| T-12 | **Approval bypass for risky commands** | unauthorised host change | `AgentTask` approval route; risk level decides whether approval is required | **existing** — verify dangerous ops require it |

**T-6 is the threat this phase primarily exists to close.** Every other item is
already mitigated in code and needs *evidence*, not new design.

### 4.1 Trust boundary statement

The control plane never trusts a client-supplied identity, hostname, or role.
`agentKey` identifies the credential; `serverId` binds it to infrastructure; role
and region are configuration, and "is this role actually being fulfilled" is a
separate, evidence-backed field — the distinction `topology/route.ts` already
documents.

---

## 5. Enrollment API contract

Existing endpoints, with the contract pinned. All responses use the shared
envelope (`status`, `success`, `message`, `data`, `error`, `requestId`).

### 5.1 Issue an enrollment token — `POST /api/agents/enrollment-tokens`

Admin-authenticated. Request: `{ agentName, serverId?, scopes[], capabilities[],
ttlSeconds? }`. Response `201`: `{ token: "aloenr_…", expiresAt, prefix }` —
**plaintext returned exactly once**, never retrievable again.

Errors: `400 VALIDATION_ERROR` · `401 UNAUTHORIZED` · `403 INSUFFICIENT_SCOPE`
(scopes requested exceed the caller's) · `409` if `serverId` already has an
active agent.

### 5.2 Enrol — `POST /api/agents/enroll`

Unauthenticated **by design** — the token *is* the credential. Rate limit: 10 per
10 min per `x-real-ip`.

Request: `{ token, name?, version?, hostname? }`.
Response `201`: `{ agentKey, secret, serverId, scopes, capabilities }` — secret
shown once, stored encrypted as `secretEnc`.

Errors: `400 VALIDATION_ERROR` (missing/malformed token) · `401 ENROLLMENT_FAILED`
(single generic message for unknown, expired, already-used, or mismatched token —
never discloses which) · `429 RATE_LIMITED`.

> `hostname` is **advisory metadata**, accepted for operator display and never
> used for identity or authorisation. Identity is `agentKey`.

### 5.3 Heartbeat — `POST /api/agents/heartbeat`

HMAC-signed. Headers: `x-alo-agent-key`, `x-alo-signature` (HMAC over the raw
body), `x-alo-timestamp`, `x-alo-nonce`.

Request: `{ version?, capabilities?, metrics?, inventory? }` — every metric
`nullish`; **an omitted metric stays `null` and is never coerced to 0**.

Response `200`: `{ ok: true, serverTime, pendingTasks }`.
Errors: `401 MISSING_AGENT_AUTH` / `AGENT_AUTH_FAILED` (covers bad signature,
stale timestamp, replayed nonce, revoked agent — one generic message) ·
`400 VALIDATION_ERROR` · `429 RATE_LIMITED`.

### 5.4 Read surface — `GET /api/servers` (changed shape)

Additive; no existing field removed.

```jsonc
{
  "servers": [{
    "id": "…", "hostname": "server-b.office.lan", "status": "ONLINE",
    "dataState": "stale",            // NEW — canonical §3.1
    "lastHeartbeat": "2026-10-29T09:12:00.000Z",
    "heartbeatAgeMs": 780000,        // NEW — mandatory age
    "metrics": {
      "cpuPercent":  { "value": 37.2, "state": "present",      "measuredAt": "…" },
      "diskPercent": { "value": null,  "state": "not-reported", "measuredAt": null }
    },
    "capacity": { "cpuCores": null, "ramGb": null, "diskGb": null }  // null, not defaults
  }],
  "primary": null,
  "enrollmentRequired": false,
  "allServersUnavailable": false,
  "stateDetail": null
}
```

Rules: `value: null` ⇒ `state: "not-reported"`; `dataState` is computed at read
time; the route performs **no writes**.

### 5.5 Rotation and revocation

- `POST /api/agents/{slug}/rotate` — issue a new secret; old secret valid for a
  bounded overlap window or invalidated immediately (choose explicitly and
  document; recommended: immediate, with rotation performed during a maintenance
  window).
- `POST /api/agents/{slug}/revoke` — sets `status = revoked`, `revokedAt`. Must
  take effect on the **next request** (T-10), not at next heartbeat interval.

---

## 6. Credential lifecycle

```
issue token ──► enroll ──► active ──► rotate ──► active
   │              │          │                     │
   │              │          └──── revoke ─────────┴──► revoked (terminal)
   └── expire     └── token consumed (single use)
```

| Stage | Stored | At rest | Lifetime | Revocable |
|---|---|---|---|---|
| Enrollment token | `tokenHash` (sha256) + `prefix` | hashed; plaintext shown once | short TTL (recommend ≤ 1 h) | yes — delete row |
| Agent credential | `agentKey` (public) + `secretEnc` | encrypted | until rotated/revoked | yes — `revoke` |
| Nonce | `AgentNonce` | opaque | `expiresAt` | expired by sweep |

Rules:
- No credential is ever written to a log, an audit row, an API response after
  creation, or a git-tracked file.
- Rotation never leaves a window where the agent holds no valid credential
  (issue new → agent adopts → revoke old).
- Revocation is terminal; re-enrolment requires a new token.
- Least privilege: scopes and capabilities default to the **read-only** subset
  (`DEFAULT_AGENT_CAPABILITIES` already derives from `risk === "READ_ONLY"`).
  Dangerous commands require explicit grant **and** per-task approval (T-12).

---

## 7. Implementation plan (small, reviewable increments)

Each step is independently testable and touches no live host.

| Step | Deliverable | Tests | Risk |
|---|---|---|---|
| P2-1 | `observation-state.ts` — canonical windows, `AgentDataState`, per-metric state | unit: boundaries, clock skew, absent timestamps | none (pure) |
| P2-2 | Serve `dataState` + `heartbeatAgeMs` + per-metric states from `GET /api/servers`; no writes | unit + route shape | none (read) |
| P2-3 | Replace inline windows in `topology`/`orchestrator` with the shared module | regression parity | none |
| P2-4 | Dashboard: render `stale`/`offline`/`not-reported` with age; never a zero | presentation unit tests | none |
| P2-5 | Negative-path API tests (T-1..T-3, T-10, T-12) | auth/authz suite | none |
| P2-6 | Response-DTO whitelist so `secretEnc` can never be serialised (T-7) | serialisation test | none |

**Explicitly deferred** (needs product decision + schema):
`AgentMetric` retention/rollup; consolidating `ServerMetric` (0 writers) and the
denormalised `Server.*Usage` mirrors; `LoadBalancer` and `ReplicationStatus`
wiring. Per the reviewer's instruction, no speculative writers will be added.

---

## 8. What Phase 2 cannot verify without host access

`[BLOCKED]` on B-1:

- that a real agent enrols end to end against the deployed control plane;
- that heartbeat latency and clock skew are tolerable on Server A (laptop, Wi-Fi)
  and Server B (Core2 Duo);
- that Server B's CPU/instruction set runs the agent's Node runtime at all —
  the brief correctly warns this must be checked, not assumed;
- that PM2 restarts do not lose enrolment (credential persistence on disk);
- that revocation propagates within one heartbeat interval in practice.

Until then, Phase 2 acceptance is limited to unit, integration (mocked
transport) and route-shape evidence — which must be labelled as such.
