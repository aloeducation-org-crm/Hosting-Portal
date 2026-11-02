# Durable AI capability intake and review

Updated: 2026-11-02. Internal development increment; **not a production activation or an execution grant**.

## Implemented

- Administrator navigation and `/ai/research` UI for authorized reverse-engineering or code-evolution intake. Middleware limits this UI to ADMIN/SUPER_ADMIN. API handlers independently reload the current user's role, active and locked state through `requireAdmin`.
- `GET/POST /api/ai/capability-requests`, `PATCH /api/ai/capability-requests/[id]`. Strict schemas reject unknown fields. Streamed request parsing cancels bodies over 12,000 bytes (create) / 5,000 bytes (review). Existing application CSRF and AI mutation rate-limit middleware remain in place.
- Additive `AiCapabilityRequest` storage with project reference, target kind/reference, asserted SHA-256, objective, authorization evidence, scope digest, requester, status, reviewer/reason and expiry. Scope cannot be modified or deleted through these endpoints.
- Existing-project validation; code evolution requires a source-repository snapshot. Website references must be HTTPS without credentials, query or fragment. References are **data only**, never fetched, opened, passed to a shell or sent to a provider.
- Independent administrator approval, 1–60 minutes (UI uses 15 minutes); rejection and revocation. Stale scope/replayed state transitions fail. Conditional status/digest updates prevent unconditional overwrites. Expired approvals are presented as EXPIRED, not silently renewed.
- Creation/review and audit writes share a transaction. Audit failure rolls back the request mutation. Review audit metadata retains reason, prior state and approval duration; revocation does not erase earlier audit events.
- Capability service, HTTP helper and request-route paths are excluded by the proposal admission protected-path policy.

## What approval does NOT mean

Every response has `executable: false`. An unexpired APPROVED record reports `REQUIRES_SETUP`, not running/completed. No runner consumes these records, and they are not bridged to REA inspection grants or source-disclosure grants. User-entered SHA-256 and authorization evidence are assertions, not independently verified artifact integrity, ownership or legal permission. A future trusted runner must revalidate authority, target identity, immutable snapshot and expiry at execution time, with separately bounded/signed execution authorization and isolated resources.

No Claude Code connection, actual REA/Ghidra process, sandbox launcher, Mac companion, voice capture/narration, self-edit applicator or release promotion was added in this increment. Existing REA tests use a protocol fixture, not upstream compatibility proof. Existing code-evolution support generates review proposals only. No DRM/licensing/authentication/access-control bypass is in scope.

## Storage setup and verification boundary

Migration: `prisma/migrations/20261031090000_ai_capability_requests/migration.sql`, registered ADDITIVE in `scripts/apply-deploy-schema.mjs`. It creates one table and two indexes; no existing table is altered. Registration makes it available to the existing schema applier during a later authorized deployment; **no deployment or current database migration was performed here**. Do not replay all Prisma migrations against an existing install without following the established backup/acceptance procedure.

`tests/ai-capability-requests.test.ts` imports the isolated-database helper first, then runs the actual schema applier with this migration selected: check, apply, repeat apply, verify. All operations target a disposable database copy. API tests use real signed next-auth test cookies and database users, not mocked authorization. Transactional audit failure is injected inside a real transaction to verify rollback.

29 new tests cover validation, non-admin/disabled-user denial, independent review, expiry/revoke/replay/stale scope, non-executable responses, audit rollback, stream cancellation and storage-unavailable responses. Two proposal-protection regressions cover the new service/helper. Full repository verification: **869 tests / 53 files PASS; lint, typecheck, production build and `git diff --check` PASS**. Build contains the UI and both API routes. No browser interaction/accessibility test, actual target analysis, host deployment, rollback or restoration acceptance was performed. Tracked `db/custom.db` remains unchanged.

Until an administrator explicitly authorizes and verifies schema setup on the intended environment, the API may return `503 CAPABILITY_STORAGE_UNAVAILABLE`. The UI displays that failure; it does not fabricate tasks or results. Production remains **NO-GO/manual-only**; hosting acceptance blockers documented in `docs/SELF-HOSTED-ACCEPTANCE-GATE.md` are unchanged.
