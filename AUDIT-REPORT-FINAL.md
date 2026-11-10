# Complete Post-Fix Re-Audit — ALO Hosting Portal (Corrected Final)

**Audit date:** 2026-11-10 (UTC)  
**Branch:** `arena/6379732a-hosting-portal` at `8cf1b482f93beb10da8632e19c2249faac4ef12a`  
**Status:** source, tests, build, configuration and standalone HTTP checks are complete. Host-dependent operations are explicitly **BLOCKED / NOT VERIFIED**.  
**Companion baseline:** [`AUDIT-REPORT.md`](AUDIT-REPORT.md)  
**No-loss evidence:** [`SEMANTIC-DIFF.md`](archive/retired-2026-11-09/SEMANTIC-DIFF.md) and [`semantic-diff.json`](archive/retired-2026-11-09/semantic-diff.json)

---

## 0. Honesty rule and scope

This report replaces the earlier post-fix draft. Its previous claims of 64 suites /
984 tests, 221 build pages and “zero errors” were stale and are corrected here.
An item is called complete only when a command, a test, a static invariant or a
live HTTP response proved it. Source presence alone is never reported as runtime
operation. The large negative line count in the consolidation diff is not a
loss metric: every retired HEAD blob was inventoried, preserved and compared.

The baseline report is a point-in-time narrative originally written before the
tracked edits; its local links were normalized during documentation
consolidation, so it is not a byte-pristine HEAD file. Its command-derived
baseline findings are preserved. The machine-readable semantic map is the
authoritative no-loss comparison.

---

## 1. Before / after

| Metric | Baseline | Final |
| --- | ---: | ---: |
| Tracked files at HEAD | 1,262 | unchanged baseline |
| Folders (baseline report walk) | 618 | 645 on disk |
| Files on disk, excluding generated output | 1,263 | 1,332 (897 active + 435 archive) |
| Active canonical files | 1,263 | 897 |
| Retired paths removed from active tree | 0 | 431 |
| Retired HEAD paths preserved | 0 | **431 / 431** |
| Byte-identical HEAD content still active | — | 222 |
| Paths without a byte-identical active copy | — | 209 semantically reviewed |
| First semantic snapshot / additional current divergence | — | 208 / 1 |
| Archived security adjustments | — | 9 |
| Legacy API route paths active | 93 of 93 | 93 of 93, 0 missing methods |
| Active API route paths | 246 | 248 |
| Legacy page routes active | 16 of 16 | 16 of 16 |
| Active page routes | 77 | 77 |
| Legacy component paths active | 91 of 91 | 91 of 91 |
| Legacy library paths active | 19 of 19 | 19 of 19 |
| Duplicate content groups / redundant files | 181 / 203 | 0 large byte-identical active duplicates |
| npm advisories | 8 moderate | **0** |
| Prisma tables in `db/custom.db` | 91 / 119 | **119 / 119**, integrity `ok`, FK violations `0` |
| Vitest | 61 files / 969 tests, 1 timeout; later 62 / 979 with 5 failures | **63 files / 987 tests, 0 failures** |
| Production build | 221 static pages, 2 tracing warnings, 1 middleware deprecation | **222 / 222 static pages, 0 build warnings**, `ƒ Proxy (Middleware)` |
| Repeatable repo audit | did not exist | **17 / 17** |
| Shell syntax gate | 106 programs | shell-gate programs=60 failures=0 |
| Config validation | accepted unset secrets | ambient fails closed; generated env: 0 errors / 0 warnings / 1 info |
| Live HTTP probe | 10 endpoints, no CSP, published default login succeeded | 23 asserted checks; CSP/security headers; published default login 401 |

The final full `npm run verify` exited 0 at `2026-11-10T04:26:42.032Z`. The only warning-like
test output is Node’s experimental SQLite notice; one expected Prisma log line
comes from a pre-migration 503 test. Neither is a test failure or a build
warning. The build’s “Turbopack” text is the compiler banner, not a warning.

---

## 2. No-functionality-loss result

The strict requirement was applied to paths and behaviour, not to raw deleted
line count:

1. All **431** retired HEAD paths are preserved under
   `archive/retired-2026-11-09/`; [`manifest.json`](archive/retired-2026-11-09/manifest.json)
   maps each to a canonical replacement.
2. 222 HEAD blobs have byte-identical content somewhere in the active
   tree. The remaining 209 files received a semantic review:
   208 from the first snapshot plus 1 additional divergence found
   after compatibility edits.
3. All 93 legacy API route paths and all legacy HTTP methods are active.
   All 16 page routes, 91 component paths and
   19 library paths have active canonical counterparts.
4. Active compatibility entrypoints include the two machine-to-machine
   automation routes, three library shims, three merged privileged helpers,
   `scripts/legacy/compat.sh`, the synchronous legacy detector API, the retired
   webhook `GET`/GitHub-event entrypoint, the `TEMP_DIR` audit fallback and the
   legacy `middleware` named export.
5. One-off ZIP/PDF generators, the retired PostgreSQL schema, historical
   tests/docs, WebSocket examples and the retired SQLite snapshot are
   archived-only historical artifacts, not active runtime paths. They remain
   discoverable through [`MANIFEST.md`](archive/retired-2026-11-09/MANIFEST.md)
   and the compatibility dispatcher.

9 archived files intentionally differ from their HEAD bytes: published
credential literals were redacted and the legacy database user hashes were
rotated. No published default authenticates against the active or archived
database. Two active scripts intentionally retain historical default strings
for detection and scanner rules; they are documented exclusions in the
credential gate and do not create usable demo accounts.

---

## 3. Consolidation and resolved defects

| Area | Action | Evidence |
| --- | --- | --- |
| Files / folders | Retired duplicate trees from the active build; moved the Ubuntu toolkit to `deploy/server-kit/`; preserved all retired paths in the archive | `manifest.json`, `SEMANTIC-DIFF.md` |
| Dependencies | Declared `js-yaml` and types; scoped `minimatch` override; removed the advisory chain without downgrading `eslint-config-next` | `npm ci`, `npm audit` |
| Config | One `.env.example`, one deploy env template, one `next.config.ts`, one `vitest.config.mts`, one `proxy.ts` | `audit:repo`, `config:validate` |
| APIs / pages / components | Canonical supersets retained; legacy paths and methods restored; duplicate site tabs became aliases | build route table, semantic map |
| Database | Single SQLite/libSQL schema; additive applier applied; 119/119 parity, integrity `ok`, FK violations `0`; `apply-deploy-schema.mjs --verify` `ok` | DB parity output |
| Auth / security | Fail-closed secrets, random seed passwords, rotated tracked and archived DB hashes, no demo login autofill, CSP plus report-only CSP, strict headers | live HTTP probe, `audit:repo` |
| Automation | `CRON_SECRET` cron trigger and `INTERNAL_SECRET` allowlisted tool route restored; proxy exemption fixed so correct bearer tokens reach route-level checks | live HTTP probe, `tests/no-loss-merge.test.ts` |
| Webhook compatibility | `GET /api/deploy/webhook` returns the legacy health message; signed GitHub `ping`, `workflow_dispatch` and `push` events dispatch to the canonical HMAC/dedupe/queue; manual `DEPLOY_WEBHOOK_SECRET` mode preserved | live HTTP probe |
| Detector / audit compatibility | Sync `detectFramework(repoPath)` and `FrameworkDetectionResult` restored; async canonical detector exposed separately; `TEMP_DIR` file audit fallback restored | `tests/no-loss-merge.test.ts` |
| Deployment | One Ubuntu entrypoint, one Node 22 Docker pair, merged helpers, CI paths rewired, compatibility dispatcher for 25 retired scripts | `deploy/ubuntu-setup.sh`, `scripts/legacy/README.md` |
| Docs / reports | Canonical README/DEPLOY/docs index, 21 stale docs rewired, broken link fixed, semantic map and this corrected report added | link scan, `audit:repo` |

Baseline defects resolved: 28 missing tables, 8 moderate advisories, missing
`js-yaml`, duplicate/undocumented env keys, published working demo credentials,
CSP absence, one broken markdown link, five competing installers, duplicate
Docker/sudoers/spec files, a wrong-depth backup/restore source path, 25 dead
generators, three drifted helpers, two Turbopack tracing warnings, the Next 16
middleware deprecation, the Vitest config warning and shell-gate timeout.

---

## 4. Verification matrix

| Gate | Baseline | Final |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | 648 packages | 650 packages, Prisma Client 6.19.3 generated |
| `npm audit` | 8 moderate | 0 vulnerabilities |
| `npm run lint` | exit 0 | exit 0 |
| `npm run typecheck` | exit 0 | exit 0 |
| `npm test` | 61 / 969, 1 timeout; later 62 / 979, 5 failures | **63 / 987 passed** |
| `npm run build` | 221 pages, warnings + deprecation | **222 / 222 pages, 0 warnings** |
| `npm run audit:repo` | absent | **17 / 17** |
| `npm run verify` | absent | **exit 0** at `2026-11-10T04:26:42.032Z` |
| `config:validate` with generated valid env | did not exist / baseline accepted unset secrets | 0 errors, 0 warnings, 1 info |
| CI shell gate | 106 checked | **shell-gate programs=60 failures=0** |
| Prisma/SQLite parity | 91 / 119 | 119 / 119, missing `[]`, integrity `ok`, FK `0` |
| `apply-deploy-schema.mjs --verify` | — | `mode: verify`, `ok: true`, `problems: []` |
| Standalone HTTP probe | no CSP, published default login 200 | **23 asserted checks, 0 probe errors** |

Final live probe details: public pages, `/api/csrf` and `/api/health` returned
200; protected APIs returned 401; `/api/health` reported `databaseStatus:
connected` and `schemaStatus: current`; the published default login returned
401; automation no-auth/wrong-secret returned 401, correct cron returned 200,
correct tool invalid action returned 403 and unapproved restart returned 409;
deploy-webhook `GET` returned 200, signed ping returned `pong`, bad signature
returned 401, signed workflow dispatch returned 200 and manual webhook without /
with the correct secret returned 401 / 404 as designed. CSP, CSP-Report-Only,
HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
`Permissions-Policy` were present; `X-Powered-By` was absent. No server error
appeared in the probe log.

---

## 5. Remaining errors and explicit limits

No verified active-source build, TypeScript, ESLint, test, deployment-config,
security-audit, broken-import, missing-dependency, DB-parity or standalone HTTP
error remains. `config:validate` returning 1 with no production env is expected
fail-closed behaviour. Health reports connection-level status, not a full
119-table parity assertion; parity is verified separately.

The following are **BLOCKED / NOT VERIFIED** because this source checkout has no
host, daemon, DNS, certificate or operator credentials:

- Ubuntu 22.04/24.04 package installation, UFW, SSH port migration,
  `fail2ban` and systemd unit activation.
- PM2 process supervision, nginx/Caddy runtime, `nginx -t`, Certbot
  issuance/renewal and Cloudflare Tunnel.
- DNS/registrar, Postfix/Dovecot mail delivery, Docker daemon image build and
  container run, and the self-hosted GitHub Actions runner.
- Live external AI providers, multi-node rate-limit state, production load or
  long-running memory soak.
- Real backup → restore and release → rollback rehearsals on a staging host.
- Full 119-table health semantics under a live production database.

Their configuration, syntax and static invariants pass; operation requires an
authorized operator on a disposable staging host. Historical docs and
archived generators are traceability artifacts, not statements of current
runtime status.

---

## 6. Deliverables

- [`AUDIT-REPORT.md`](AUDIT-REPORT.md) — baseline report (link-normalized point-in-time artifact).
- `AUDIT-REPORT-FINAL.md` — this corrected post-fix report.
- [`SEMANTIC-DIFF.md`](archive/retired-2026-11-09/SEMANTIC-DIFF.md), [`semantic-diff.json`](archive/retired-2026-11-09/semantic-diff.json), [`MANIFEST.md`](archive/retired-2026-11-09/MANIFEST.md) and [`manifest.json`](archive/retired-2026-11-09/manifest.json) — complete no-loss comparison.
- [`scripts/repo-audit.mjs`](scripts/repo-audit.mjs) — repeatable 17-invariant gate.
- [`scripts/legacy/compat.sh`](scripts/legacy/compat.sh) — no-loss dispatcher.
- [`tests/unified-project.test.ts`](tests/unified-project.test.ts) and [`tests/no-loss-merge.test.ts`](tests/no-loss-merge.test.ts) — executable merge proof.
- [`README.md`](README.md), [`DEPLOY.md`](DEPLOY.md) and [`docs/README.md`](docs/README.md) — canonical documentation.
