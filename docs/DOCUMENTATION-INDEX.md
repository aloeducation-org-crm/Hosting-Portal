# Documentation Index — Master Brief 24 Required Documents

Status legend: **CURRENT** = maintained and accurate · **PARTIAL** = substance exists (code/tests/runbook) but no standalone narrative guide, or guide predates current code · **HISTORICAL** = kept for traceability, not current status · **MISSING** = not yet written.

| # | Required document | Where it lives | Status |
| --- | --- | --- | --- |
| 1 | System Architecture | `README.md`, `docs/audit/ARCHITECTURE-AND-DATA-FLOW.md` (historical baseline), `docs/AI-AUTOMATED-PLATFORM-MAP.md` | PARTIAL — README current; full diagram doc needs refresh |
| 2 | Database Architecture | `docs/DATABASE-ARCHITECTURE.md` (ADR-001, 2026-11-16) | CURRENT |
| 3 | Database Migration Guide | `docs/DATABASE-RECOVERY-RUNBOOK.md`, header of `scripts/apply-deploy-schema.mjs`, `tests/deploy-schema-sync.test.ts` | PARTIAL — recovery runbook doubles as migration guide; dedicated guide MISSING |
| 4 | Environment Configuration Guide | `docs/UNIFIED_PROJECT_ENVIRONMENT_VARIABLES.md`, `docs/PRODUCTION-CONFIG-VALIDATION.md`, `.env.example`, `deploy/env/alo-hosting-panel.env.example` | CURRENT |
| 5 | Local Development Guide | `README.md` (Quick start) | PARTIAL — README covers it; no deeper dev guide |
| 6 | Production Deployment Guide | `DEPLOY.md`, `docs/DEPLOYMENT-AND-ROLLBACK.md` | CURRENT |
| 7 | Worker Installation Guide | `scripts/install-agent.sh`, `agent/alo-agent.mjs`, `docs/REMOTE-NODE-DEPLOYMENT.md` | PARTIAL |
| 8 | Worker Enrollment Guide | `docs/audit/PHASE-2-AGENT-ENROLLMENT-DESIGN.md` (design), `src/app/api/agents/enroll/route.ts`, `tests/agent-bootstrap.test.ts` | PARTIAL — design doc, no ops narrative |
| 9 | Build Isolation Guide | `docs/BUILD-ISOLATION.md` (2026-11-16) | CURRENT |
| 10 | Runtime Adapter Guide | `docs/RUNTIME-ADAPTERS.md` (2026-11-16), `src/lib/deploy/detect.ts` | CURRENT |
| 11 | Deployment Lifecycle Guide | `docs/DEPLOYMENT-AND-ROLLBACK.md`, `docs/UNIFIED_PROJECT_DEPLOYMENT_AND_ROLLBACK.md` | CURRENT |
| 12 | Domain and DNS Guide | `docs/RECOVERY-hosting.alolabs.net.md`, `src/lib/dns-provider.ts`, `tests/dns-provider.test.ts` | PARTIAL — recovery/case notes; no end-to-end customer guide; **no live DNS evidence** |
| 13 | SSL Guide | `helpers/alo-ssl-helper`, `helpers/ssl-lifecycle.sh`, Caddy/nginx templates in `deploy/` | PARTIAL — helper scripts exist; narrative SSL/renewal guide MISSING; **no live certificate evidence** |
| 14 | Database Provisioning Guide | `src/app/api/databases/`, `scripts/init-production-db.sh`, `docs/audit/DATABASE-AND-MIGRATION-AUDIT.md` (historical) | PARTIAL |
| 15 | Backup and Restore Guide | `docs/operations/BACKUP-RESTORE.md`, `scripts/db-backup.mjs`, `scripts/db-restore.mjs`, backup drill 2026-11-16 (see `docs/PHASE-0-VERIFIED-BASELINE-2026-11-16.md` V8/V12) | CURRENT |
| 16 | Disaster Recovery Guide | `docs/operations/INCIDENT-RESPONSE.md`, `docs/DATABASE-RECOVERY-RUNBOOK.md`, `docs/operations/RELEASE-AND-ROLLBACK.md` | CURRENT |
| 17 | Monitoring Guide | `docs/operations/`, `src/app/api/monitoring/`, `src/app/api/alerts/`, `tests/health-reporting.test.ts` | PARTIAL — implementation exists; narrative monitoring/alerting guide PARTIAL |
| 18 | Security and Threat Model | `docs/SECURITY-THREAT-MODEL.md` (2026-11-16), `docs/AGENT-SECURITY.md`, `docs/audit/SECURITY_AUDIT.md` (historical) | CURRENT |
| 19 | AI Agent Permission Guide | `docs/AGENT-SECURITY.md`, `docs/AI-AUTOMATION.md`, `docs/SELF-HOSTED-AI-AGENTS.md`, `tests/operator-authorization.test.ts` | CURRENT |
| 20 | Billing and Entitlement Guide | `src/lib/billing/entitlements.ts`, `tests/billing-entitlements.test.ts`, `docs/ROADMAP-STATUS.md` | PARTIAL — code+tests; guide MISSING |
| 21 | Troubleshooting Guide | `docs/operations/INSTALLATION.md` (partial), `DEPLOY.md` troubleshooting sections, `scripts/server-doctor.sh` | PARTIAL — no consolidated troubleshooting guide; MISSING as a standalone |
| 22 | Rollback Guide | `docs/operations/RELEASE-AND-ROLLBACK.md`, `docs/DEPLOYMENT-AND-ROLLBACK.md`, `scripts/rollback.sh` | CURRENT |
| 23 | Production Readiness Checklist | `docs/audit/PRODUCTION_READINESS.md`, `docs/audit/PRODUCTION-READINESS.md`, `docs/PRODUCTION-READINESS-REPORT.md`, this phase's gates in `docs/SECURITY-THREAT-MODEL.md §6` | PARTIAL — exists but predates 2026-11-16 verification; do not treat old checkmarks as current |
| 24 | Known Limitations Register | `docs/KNOWN-LIMITATIONS.md` (2026-11-16) | CURRENT |

## Rules for this index

1. **CURRENT** docs describe verified behavior; where behavior is unverified they say so explicitly.
2. **HISTORICAL** docs are kept for traceability and are labeled as such in `docs/README.md`.
3. Nothing in this repo may document a feature as operational that has not been verified — see `docs/KNOWN-LIMITATIONS.md` and the evidence rules in `docs/PHASE-0-VERIFIED-BASELINE-2026-11-16.md`.
4. When a **PARTIAL** guide is written or a limitation closes, update this index in the same change.
