# Appwrite-Inspired Cloud BaaS Reconstruction Guided by REA

Date: 2026-11-02
Status: **First-party additive implementation verified locally. Upstream Appwrite/REA containers and binaries were NOT installed or executed. Production manual-only hold remains in effect.**

## 1. Purpose & Methodology

The owner requested inspecting [`appwrite/appwrite`](https://github.com/appwrite/appwrite) and [`morluto/rea`](https://github.com/morluto/rea) and building an Appwrite-like unified developer & agent cloud experience in `Hosting-Portal`.

Following `morluto/rea`'s own `.agents/skills/reverse-engineer-anything/SKILL.md` (v59) and `AGENTS.md`:
1. **Source-first routing**: Because `appwrite/appwrite` is a complete open-source repository (BSD-3-Clause), inspection used direct pinned-commit repository analysis rather than native binary decompilation (`Ghidra`/`Hopper`) or executing upstream installers.
2. **Evidence provenance**: Every architectural conclusion in `src/lib/ai/rea/reconstruction-ledger.ts` carries a stable `evidenceId`, an explicit kind (`observation`, `derivation`, `inference`, or `unknown`), a 40-character commit SHA, a source file path, and stated limitations.
3. **First-party clean-room implementation**: All code delivered in `Hosting-Portal` is authored first-party in TypeScript/React/Prisma over SQLite, preserving existing routes, migrations, RBAC, and host security rules (notably **never** mounting `/var/run/docker.sock` into web-facing processes).

## 2. Pinned Upstream Evidence Baselines

| Repository | Pinned Commit | License | Key Inspected Paths |
| --- | --- | --- | --- |
| [`appwrite/appwrite`](https://github.com/appwrite/appwrite/tree/da8e595a804834ffcf63b83140ff09b29ce77140) | `da8e595a804834ffcf63b83140ff09b29ce77140` | BSD-3-Clause | `README.md`, `LICENSE`, `AGENTS.md`, `docker-compose.yml`, `app/config/services.php`, `app/config/scopes/project.php`, `app/config/frameworks.php`, `src/Appwrite/Platform/Modules/{Sites,Functions,Projects,Advisor}`, `apps/console/README.md` |
| [`morluto/rea`](https://github.com/morluto/rea/tree/26c3e9e4134971c79e822bbcb16fb42bb7dd8e8d) | `26c3e9e4134971c79e822bbcb16fb42bb7dd8e8d` (adapter protocol baseline `d9e01e5af2dda46f9c7adb6cfde82805845651e9`) | MIT | `README.md`, `AGENTS.md`, `package.json` (`rea-agents@6.8.0`), `.agents/skills/reverse-engineer-anything/SKILL.md` (v59), `src/contracts/` |

Attribution note: Appwrite is Copyright (c) 2019 Appwrite (`https://appwrite.io`) and individual contributors under the BSD 3-Clause License; no Appwrite source files, binary images, or trademarked logos were copied into `Hosting-Portal`. REA is MIT-licensed by `morluto`; no upstream `rea-agents` runtime was bundled.

## 3. Reconstructed First-Party Capabilities vs Operational Boundaries

| Appwrite Subsystem | First-Party Surface in `Hosting-Portal` | Operational State | Boundary / Remaining Gate |
| --- | --- | --- | --- |
| Organization → Project Console (`apps/console`) | `/cloud` (`CloudProjectsConsole`), `/api/cloud/projects`, App Center `cloud-baas` | `AVAILABLE` | Apply additive migration `20261102120000_cloud_baas_projects` via `scripts/apply-deploy-schema.mjs`. |
| Granular Project API Keys (`app/config/scopes/project.php`) | `cloud_project_keys`, `POST /api/cloud/projects/[id]/keys`, `GET /api/cloud/v1/health` | `AVAILABLE` | 17 scopes; `alok_live_` CSPRNG secret shown once; SHA-256 digest + constant-time check at rest. |
| Client Platforms (`platforms.*`) | `cloud_project_platforms`, `POST /api/cloud/projects/[id]/platforms` | `AVAILABLE` | Validates Web/Next.js hostnames (`localhost` blocked on `production` stage) and iOS/Android reverse-DNS bundle IDs. |
| Event Webhooks (`Modules/Webhooks`) | `cloud_project_webhooks`, `POST /api/cloud/projects/[id]/webhooks` | `AVAILABLE` | Strict HTTPS + SSRF rejection (loopback, RFC1918, CGNAT, `169.254.169.254`, IPv6 literals); one-time HMAC-SHA256 signing secret. Outbound worker queue remains a separate step. |
| Appwrite Sites (`Modules/Sites`, `frameworks.php`) | 10 framework presets (`nextjs`, `tanstack-start`, `sveltekit`, `astro`, `nuxt`, `vue`, `angular`, `analog`, `react`, `static`) linked to `Website` / `/deployments` | `AVAILABLE` | Reuses ALO's atomic-symlink Git deployment pipeline rather than Docker-in-Docker site containers. |
| Databases & Storage Buckets (`Databases`, `Storage`) | Tenant-verified binding to `DatabaseInstance` (`/databases`) and `StorageBucket` (`/storage`) | `AVAILABLE` | Cross-tenant resource linking is rejected (`403 FORBIDDEN`). |
| Cloud Functions (`Modules/Functions`, `src/Executor`) | `cloud_project_functions`, `POST /api/cloud/projects/[id]/functions` | `REQUIRES_SETUP` | Specs, pinned runtimes (`node-22`, `bun-1.4`, `deno-2.1`, `python-3.12`, `go-1.23`, `php-8.4`), and cron schedules persist durably, but isolated container execution is **not** attached on the web host. |
| Posture Advisor & Agent/MCP Onboarding (`Modules/Advisor`, `README.md#agents`) | Deterministic `evaluateCloudProjectPosture()`, secret-free SDK/cURL/Agent snippets, read-only workflow node `hosting.cloudProjects` | `AVAILABLE` | Zero fabricated metrics and zero plaintext secret interpolation. |

## 4. Security & Migration Guarantees

- **Additive-only SQL**: `prisma/migrations/20261102120000_cloud_baas_projects/migration.sql` contains exclusively `CREATE TABLE IF NOT EXISTS` and `CREATE [UNIQUE] INDEX IF NOT EXISTS` statements, registered as `ADDITIVE` in `scripts/apply-deploy-schema.mjs`. Tracked `db/custom.db` is untouched.
- **Atomic audit trail**: Every write in `src/lib/cloud/cloud-service.ts` runs inside `db.$transaction` alongside `tx.auditLog.create({ domain: "cloud-baas" })`; if audit persistence fails, the write rolls back.
- **Proposal-path protection**: `src/lib/cloud/*` and `src/lib/ai/rea/*` are blocked from agent-authored edits in `src/lib/ai/code-change-proposal.ts`.
- **Production release policy**: Unchanged — `.github/workflows/ci-cd.yml` keeps the manual `workflow_dispatch` `APPROVED` + `release_ticket` hold.
