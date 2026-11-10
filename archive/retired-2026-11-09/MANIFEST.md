# Immutable no-loss archive — 2026-11-09 unification

This directory contains a verbatim snapshot of **all 431 paths** that were
retired when the three overlapping project trees were merged into one canonical
application. The active project remains a single tree; this archive is a
historical, non-deployed record so that **no file or function was simply
deleted**. `manifest.json` maps every archived path to its canonical
replacement and records its original byte size and mode.

## What is here

| Archived top-level | Count | Canonical home |
| --- | ---: | --- |
| `alo-hosting-portal/` (legacy PostgreSQL snapshot) | 325 | `src/`, `prisma/`, `public/`, `tests/`, `deploy/` — see per-file mapping |
| `alo-server-kit/` | 47 | `deploy/server-kit/` (renamed, not lost) |
| `scripts/` one-off generators/installers | 25 | `scripts/legacy/compat.sh` + `deploy/ubuntu-setup.sh` |
| `server-helpers/` | 19 | `helpers/` (3 drifted helpers merged from the superior copies) |
| `server-config/` | 5 | `deploy/sudoers/`, `deploy/systemd/`, `deploy/nginx/` |
| `install-scripts/` | 4 | `deploy/server-kit/scripts/configure-email.sh`, `scripts/rollback.sh`, `deploy/ubuntu-setup.sh` |
| root duplicates / renames | 6 | `Dockerfile`, `docker-compose.yml`, `vitest.config.mts`, `src/proxy.ts`, `deploy/sudoers/alo-hosting-portal`, `SERVER-SPEC.md` |

## Active functionality explicitly carried forward

- `/api/automation/cron` (bearer `CRON_SECRET` trigger) and
  `/api/automation/tool` (allowlisted internal service commands) were re-added
  to the canonical `src/app/api/` tree, adapted to `alo-hosting-panel` and a
  configurable `systemd`/`pm2` service manager.
- `src/lib/automation/audit.ts`, `src/lib/deploy/detector.ts` and
  `src/lib/deploy/orchestrator.ts` are compatibility paths. The canonical
  `src/lib/audit.ts`, `src/lib/deploy/detect.ts` and `src/lib/deploy/engine.ts`
  are strict supersets: file-fallback audit trail, 20+ framework detection, and
  execFile-based clone → build → verify → rollback.
- The three drifted `server-helpers` scripts (`alo-deploy-helper`,
  `alo-dns-helper`, `alo-ssl-helper`) were merged into `helpers/` because they
  contained fixes absent from the canonical copies (apex `@` DNS records,
  correct older-release rollback, honest build exit codes, path containment).
- `scripts/legacy/compat.sh` dispatches every removed `scripts/` name to its
  canonical replacement or to its archived original.

## Safety notes

- Published seed credentials are redacted in archived text files. The archived legacy
  `alo-hosting-portal/db/custom.db` had its bcrypt hash rotated to a random
  secret; no published default verifies against it.
- This directory is excluded from the active `npm run audit:repo` invariants
  (imports, duplicate content, credential scan, link check) and from the CI
  shell-syntax gate. It is **not** imported, built, deployed or executed.
- `tests/unified-project.test.ts` asserts that all 431 paths exist here and that
  each has a non-empty canonical mapping, so a future change cannot silently
  drop the archive.

## Historical docs

`docs/` contains older audit reports that describe the pre-merge repository.
They are kept for traceability but are not statements of current status; see
`AUDIT-REPORT.md` (baseline) and `AUDIT-REPORT-FINAL.md` (post-fix).

## Semantic comparison addendum

`SEMANTIC-DIFF.md` and `semantic-diff.json` are the completed no-loss comparison
for all 431 retired HEAD paths. They include SHA-256 hashes, byte-identical
active-copy detection, canonical mappings, similarity/signature evidence, a
classification and a resolution for every path. The map is checked by
`npm run audit:repo` and by the canonical test suite.

The review found and actively restored four compatibility gaps: the synchronous
framework-detector API, the legacy deploy-webhook `GET` and GitHub-event
entrypoint, the `TEMP_DIR` audit fallback, and the legacy `middleware` named
export. All 93 legacy API route paths, 16 page routes, 91 component paths and
19 library paths have active canonical counterparts; no legacy API route path
or HTTP method is missing.
