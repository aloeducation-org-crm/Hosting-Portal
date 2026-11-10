# Documentation index

This directory contains the design documents, runbooks and **historical** audit
records of the ALO Hosting Portal. Current status is not inferred from old
reports: use the commands below.

## Current, authoritative documents

| Document | Purpose |
| --- | --- |
| [`../README.md`](../README.md) | what the unified project is and how to run it |
| [`../DEPLOY.md`](../DEPLOY.md) | canonical Ubuntu / container / Git-release deployment |
| [`../AUDIT-REPORT.md`](../AUDIT-REPORT.md) | complete pre-fix baseline audit (2026-11-09) |
| [`../AUDIT-REPORT-FINAL.md`](../AUDIT-REPORT-FINAL.md) | complete post-fix re-audit, with verification evidence |
| [`../archive/retired-2026-11-09/MANIFEST.md`](../archive/retired-2026-11-09/MANIFEST.md) | immutable verbatim snapshot of all 431 retired paths and their canonical replacements |
| [`UNIFIED_PROJECT_ENVIRONMENT_VARIABLES.md`](UNIFIED_PROJECT_ENVIRONMENT_VARIABLES.md) | environment variable contract |
| [`DEPLOYMENT-AND-ROLLBACK.md`](DEPLOYMENT-AND-ROLLBACK.md) | release activation and rollback runbook |
| [`GIT-AUTODEPLOY.md`](GIT-AUTODEPLOY.md) | GitHub push → verified release pipeline |
| [`DATABASE-RECOVERY-RUNBOOK.md`](DATABASE-RECOVERY-RUNBOOK.md) | SQLite recovery and drift handling |
| [`ROADMAP-STATUS.md`](ROADMAP-STATUS.md) | honest capability status |
| `../.env.example`, `../deploy/env/alo-hosting-panel.env.example` | the two environment templates |

## Historical records (do not read as current status)

`UNIFIED_PROJECT_BASELINE_AUDIT.md`, `UNIFIED_PROJECT_FINAL_AUDIT.md`,
`UNIFIED_PROJECT_MERGE_MAP.md`, `UNIFIED_PROJECT_REPAIR_LOG.md`,
`UNIFIED_PROJECT_TEST_MATRIX.md`, `PRODUCTION-READINESS-REPORT.md`,
`FINAL_HANDOVER_REPORT.md`, `audit/*`, `design/*` and the dated incident reports
describe earlier commits. They are kept for traceability and may mention paths
or package trees that were retired in the 2026-11-09 unification
(`alo-hosting-portal/`, `alo-server-kit/`, `server-helpers/`, `server-config/`,
`install-scripts/`, `Dockerfile.node20`, `docs/SERVER-SPEC.md`,
`src/middleware.ts`, `vitest.config.ts`). Canonical replacements are described
in `../README.md`.

## Always verify, never assume

```bash
npm run verify          # lint + typecheck + tests + build
npm run audit:repo      # 16 repository invariants
npm run config:validate # env/secrets/DB preflight
npm audit               # dependency advisories
bash scripts/server-doctor.sh
```

Host-level operations (Ubuntu, UFW, systemd/PM2, nginx/Caddy, Certbot,
Cloudflare Tunnel, DNS, mail, Docker, self-hosted runner, live AI providers)
cannot be proven from this checkout; they remain explicitly `NOT VERIFIED` in
the final audit until an operator rehearses them on a staging host.
