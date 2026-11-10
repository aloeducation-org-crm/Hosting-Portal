# No-loss semantic comparison — retired paths

Generated: `2026-11-10T04:24:11.306032Z`  
Machine-readable evidence: `semantic-diff.json` (431 entries, SHA-256 hashes, canonical mappings, classifications and signature comparisons).

## Result

| Check | Count | Outcome |
| --- | ---: | --- |
| Retired HEAD paths | 431 | all inventoried |
| Archived paths present | 431 | all preserved |
| Byte-identical HEAD content present in the active tree | 222 | exact copies retained |
| Paths without a byte-identical active copy | 209 | all semantically reviewed and classified |
| First snapshot semantic candidates | 208 | reviewed |
| Additional current divergence | 1 | reviewed after compatibility edits |
| Intentional security adjustments in archive | 9 | published credentials redacted; legacy DB hashes rotated |
| Legacy API route paths | 93 | 0 missing active paths |
| Legacy API route methods | — | 0 missing after compatibility merge |
| Legacy page routes | 16 | 0 missing active routes |
| Legacy component paths | 91 | 0 missing active paths |
| Legacy library paths | 19 | 0 missing active paths |
| Active API routes / pages / components / library modules | 248 / 77 / 130 / 113 | canonical supersets |

`semantic_review_complete` is `true`. The comparison was not limited to claiming that a similarly named canonical file exists: each HEAD blob was hashed against the archive and active tree, and every non-exact path received a canonical mapping, nearest-active-file similarity, exported-symbol/HTTP-method/env/API signature comparison and a classification.

## Active compatibility carry-forward

1. `src/lib/deploy/detector.ts` preserves the retired synchronous `detectFramework(repoPath)` call and `FrameworkDetectionResult`; `detectFrameworkAsync` exposes the broader canonical detector from `src/lib/deploy/detect.ts`.
2. `src/app/api/deploy/webhook/route.ts` restores the retired `GET` health probe and dispatches GitHub `push`, `workflow_dispatch` and `ping` events carrying `X-Hub-Signature-256` to the canonical HMAC, dedupe and deployment-queue implementation. The canonical `DEPLOY_WEBHOOK_SECRET` / `INTERNAL_SECRET` manual JSON mode remains unchanged.
3. `src/lib/deploy/webhook.ts` accepts the retired `CRON_SECRET` fallback only as a strong, fail-closed HMAC candidate; `GITHUB_WEBHOOK_SECRET` remains the canonical setting. `workflow_dispatch` with a pinned 40-character commit SHA is queued like a push.
4. `src/lib/audit.ts` honours the retired `TEMP_DIR` fallback and `automation-audit.log` filename before using `ALO_BACKUP_DIR` or the OS temp directory.
5. `src/proxy.ts` exports `proxy as middleware` so legacy named imports resolve, while the file and primary export follow the Next.js 16 `proxy` convention.
6. The two machine-to-machine automation routes, the three library shims, three drifted privileged helpers, and `scripts/legacy/compat.sh` remain active compatibility entrypoints.

## Classification of archived-only material

The following material is preserved verbatim (apart from the 9 documented security adjustments) but intentionally is not part of the active build, test or deployment path:

- ten retired nested test suites, superseded by the canonical Vitest suite;
- one-off ZIP/PDF/documentation generators, source rewriters and historical install scripts, discoverable through `scripts/legacy/compat.sh`;
- the retired PostgreSQL schema, Bun lockfile, duplicate Docker/Caddy/systemd/sudoers configurations, WebSocket examples and worklog;
- the retired SQLite database snapshot, retained with rotated user hashes.

Diagnostic signature gaps in those generator files are historical string literals and generated sample environment names, not missing live runtime endpoints. Runtime environment aliases used by the canonical app are present in `.env.example`; all 93 legacy API route paths and all legacy HTTP methods are present in the active tree.

## Caveats

- Host-dependent Ubuntu, Docker, PM2, Nginx/Caddy, systemd, Certbot, UFW, DNS, mail, backup/restore and monitoring operations remain `BLOCKED` / `NOT VERIFIED` from a source checkout.
- Security redactions and hash rotation deliberately alter 9 archived files from their HEAD bytes. Every other archived file is byte-identical to HEAD.
- The archive is excluded from build tracing, the CI shell gate and `npm run audit:repo`; `semantic-diff.json` is checked explicitly by the audit gate and by the canonical test suite.
