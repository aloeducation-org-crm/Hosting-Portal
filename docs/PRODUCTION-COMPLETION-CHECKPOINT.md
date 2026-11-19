# Production completion checkpoint — HOLD

Baseline: `f49f219fafad8d2fe78a8ded8f06ac09e48661f6` on `main`. The current patch
is a repository change, not proof of a deployed release.

| Gate | Repository evidence | Production evidence still required |
| --- | --- | --- |
| PM2/3062 | Both profiles load under tests; the production profile includes bundled deploy and automation workers when present. | Identify process owner, verify listener ownership and restart only the confirmed portal processes. |
| Ingress | Both portal vhost templates target `127.0.0.1:3062`; diagnostics default to the same port. | Determine which profile is active, review the exact vhost diff, run `nginx -t`, and verify public HTTPS, redirect policy, WebSocket behavior and certificate renewal. |
| Database | The checked-in Prisma schema and the PM2 preflight currently support SQLite. | Verify the panel and workers resolve the same existing database; record type/ownership, run integrity checks, and test restoring a verified backup on a separate host/path. |
| Tenant safety | New allocation skips `3062` and keeps legacy `3051` protected. No existing port or record is rewritten. | Check both live listeners and stored project/website assignments. If `3062` is already assigned, halt; do not stop or move that application. |
| Release and recovery | Local fixture tests exercise deployment and rollback. PM2 deploy script no longer performs schema writes. | Rehearse on staging with separate credentials and database. Do not dispatch the existing production Actions deployment yet: its legacy activation script still uses in-place destructive Git checkout/reset and automatic schema updates. |

## Next staging gates

1. Provision a representative staging host with a separate PM2 user, staging
   env, and disposable database. Check `ss -ltnp 'sport = :3062'` before any
   process start. Render a staging vhost without replacing shared configs.
2. Build the approved SHA outside any live checkout. Test standalone assets,
   PM2 and worker restarts, and an isolated DB backup/restore. Verify restored
   data using counts and integrity checks; do not log customer rows.
3. Use a dedicated GitHub installation/test repo. Record signed delivery,
   deduplication, verified SHA, deployment, and failed-release rollback. Run
   two-account dashboard/API/log/file isolation checks.
4. Set explicit staging load thresholds and an RTO/RPO with the operator. Run a
   realistic 500+ concurrent-user test including authenticated workflows and
   queue load; record p95/p99, errors, queue delay, CPU, and memory.
5. Obtain separate approval for any production migration and for the actual
   PM2/ingress cutover. Require independent public, worker, database, alerting,
   and rollback evidence before marking the release accepted.

A MySQL conversion is not a configuration toggle: it requires a separate
Prisma provider/migration and data-transfer project, with parity and restore
tests. Do not point this SQLite build at a MySQL URL or replace the live DB.

## Evidence recorded in the sandbox

- `npm ci`, lint, TypeScript, Next.js standalone build, and worker bundling passed.
- Vitest: 92 suites passed, 1,411 tests passed, 2 skipped. Targeted suites
  covered the PM2 profiles, port protection, tenant isolation, SQLite restore,
  deployment, and release activation. No production services were used.
- Standalone Node smoke against a temporary copy of the fixture: HTTP 200 for
  `/api/health`, `/login`, and a generated JavaScript chunk on `127.0.0.1:3062`.
  Health reported `database: connected` and `schema: current`. This did not
  start a PM2 daemon or exercise public ingress.
- Repository audit: 18/18. npm production dependency audit: zero reported
  advisories. Merge-integrity audit skipped because the checkout is shallow;
  historical filename checks are not a secret-content scan.

The isolated artifact preparation step is now available as
`bash scripts/prepare-pm2-release.sh SHA EXPECTED_DIGEST PAYLOAD RELEASES_DIR`.
Supply the SHA and directory digest from a trusted build record (not the payload
itself). The digest covers all regular files with paths relative to the payload
root and a `./` prefix. This is not the legacy workflow's digest format. The
script publishes a separate directory without starting PM2 or touching the DB;
it does not replace the legacy activation or rollback workflow yet.
