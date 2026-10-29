# Deployment reconciliation

This path exists to satisfy the required deliverable name. The authoritative
content lives in a dated record so that evidence keeps its collection date:

**→ [`DEPLOYMENT_RECONCILIATION_2026-10-29.md`](./DEPLOYMENT_RECONCILIATION_2026-10-29.md)**

It is not duplicated here, deliberately: two copies of an evidence record drift,
and the newer one silently becomes authoritative.

## Summary of the current conclusion

| Question | Answer | Evidence |
|---|---|---|
| Is the running release verified? | **No** | `[BLOCKED]` — no release identity artefact on the host |
| Leading hypothesis | `ec7ff40` | `[CI]` — last successful deploy job, 2026-10-27T02:47:01Z |
| Is `54e3454` the baseline? | **No** | it is the subject of six failed re-runs, nine commits behind |
| Did a successful deploy ever pass the `production` gate? | **No, never** | `[CI]` |
| May the host have been mutated since? | **Unknown** | run #54, failed, logs inaccessible |

Re-verification of all claims in that report, including one scoping correction, is
recorded in [`VERIFICATION-2026-10-29-SESSION2.md`](./VERIFICATION-2026-10-29-SESSION2.md) §2.

The function that formalises the current state is
`src/lib/infrastructure/server-inventory.ts`; its test asserts the registry reports
**zero VERIFIED facts** while no host has been observed.
