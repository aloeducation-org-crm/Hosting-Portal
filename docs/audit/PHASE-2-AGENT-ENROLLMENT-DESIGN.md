# Phase 2 — agent enrollment design

This path exists to satisfy the required deliverable name. The authoritative design
and test plan live under `docs/design/`, alongside the other design documents:

- **→ [`docs/design/PHASE2_AGENT_ENROLLMENT.md`](../design/PHASE2_AGENT_ENROLLMENT.md)** — architecture, threat model T-1…T-12, enrollment API contract, credential lifecycle
- **→ [`docs/design/PHASE2_TEST_PLAN.md`](../design/PHASE2_TEST_PLAN.md)** — 49 test cases, 10 acceptance criteria
- **→ [`docs/design/PHASE2_TRACEABILITY.md`](../design/PHASE2_TRACEABILITY.md)** — threat → AC → test, and count reconciliation

## Status

**Design complete. Core honesty layer implemented. No agent has ever enrolled.**

| Element | State |
|---|---|
| Design §1–§8 | complete |
| Threat model (12 threats) | complete; 11 already mitigated in existing code, needing evidence not design |
| Evidence/freshness core | **implemented** — `inventory.ts`, 44 passing tests |
| Enrollment API endpoints | **pre-existing** — 13 routes, not rebuilt |
| Live enrollment of A or B | `[BLOCKED]` on B-1 |

The Phase 2 work that needs no host access was built rather than deferred; the
remainder needs an authorised session and is tracked in `IMPLEMENTATION-PLAN.md` W-1.
