# Unified ALO Labs roadmap — honest status (2026-10-26)

Status meanings: **PASS** = implemented and verified with recorded evidence;
**PARTIAL** = works in part, missing pieces listed; **BLOCKED** = credential,
permission, dependency or external service unavailable; **NOT TESTED** = no
verification performed.

Evidence for the deployment column: `npm test` (83+ tests including
`tests/deploy-e2e.test.ts`), `node scripts/verify-deploy-http.mjs` (25 HTTP
checks, 0 failed), `docs/GIT-AUTODEPLOY.md`.

| Platform capability | Status | What exists now | What is still missing |
|---|---|---|---|
| Hostwares-style AI deployment | **PARTIAL** | Git-connected projects, isolated `mkdtemp()` builds, exact-SHA releases, real framework detection, deployment queue, static service manager, startup restore, AI provider chain (incl. OpenRouter/Qwen adapters) | Ollama self-hosting on the deploy host, AI-authored config proposals, mutating AI tools (intentionally not enabled) |
| Cloudways-style monitoring | **PARTIAL** | `/api/health` now returns 200 on the migrated DB; HTTP health + release-marker verification per deploy; deployment logs/history; existing monitoring/alert routes retained | Real resource graphs wired to the new release ports, alert delivery with a real provider, tunnel status probe |
| Mozello-style AI website builder | **PARTIAL** | Existing `/ai/builder`, prompt/website AI routes and workflow engine | Live provider call unverified here; editable preview → approval → publish lifecycle not end-to-end verified |
| Kinsta-style recovery | **PASS for deploys / PARTIAL overall** | Atomic symlink swap, automatic restore on failed verification, manual approval-gated rollback, verified backup of the previous release directory | Verified full-system backups/restore drills, approval UI for self-healing actions beyond rollback |
| Vercel-style deployment | **PASS (staging)** | GitHub App/OAuth integration code, signed webhook + dedup, framework detection, pinned commits, logs, rollback, two automatic pushes verified over HTTP | Real GitHub App installation/OAuth credentials → live GitHub push not verified; PR preview deployments are recorded and ignored, not built |
| Railway-style sandbox (`agents.alolabs.net`) | **BLOCKED** | AI workflow engine, tool allowlist and run history exist in this repo | The separate `agents.alolabs.net` host/application was not available in this checkout; no SSH/DNS/process access |
| DigitalOcean-style management | **PARTIAL** | Existing domain, DNS, storage, firewall, application APIs and helpers; new projects get a domain record and a bound port | No live DNS/SSL/firewall verification; no credentials for Cloudflare/registrar; DNS records were NOT changed |
| Wix-style security | **PASS for the new surface** | HMAC signature + timing-safe compare, delivery dedup, command allowlist, RBAC + project ownership, audit logs, secret redaction, rate limiting, same-origin CORS, httpOnly state cookie | Full CSRF token on every mutation (NextAuth session + same-origin check is used), complete route-by-route penetration test |
| Bluehost-style marketing AI (`marketing.alolabs.net`) | **BLOCKED** | Existing CRM/email-campaign models and APIs | Separate `marketing.alolabs.net` app not present in this checkout; no campaign publishing integration |
| GCP-inspired scaling | **PARTIAL** | Multiple projects each with its own port, release root and immutable releases (two projects verified live simultaneously); queue serializes per project | No container orchestration, no autoscaling, no hardware-capacity planner; single-host process-local lock only |

## Domain / service inventory (verification limits)

`hosting.alolabs.net`, `panel.alolabs.net`, `agents.alolabs.net` and
`marketing.alolabs.net` are referenced by `DEPLOY.md`,
`docs/RECOVERY-hosting.alolabs.net.md` and `.env.example`. **No DNS, nginx,
Caddy, Cloudflare Tunnel, PM2 or systemd state was available from this
sandbox.** Nothing was changed for those hosts; no reverse-proxy config,
certificate or running application was touched. Verifying they still work
requires running `bash scripts/server-doctor.sh` on `alo-server-lap`.

The live preview in this session is the sandbox's `*.e2b.app` proxy of the
standalone Next.js server on port 3101 plus the deployed static releases on
ports 4100/4101 — it is **not** a public production deployment of
`hosting.alolabs.net`.

## Exact remaining manual setup

```bash
# 1. On the server, after pulling this branch:
cd ~/projects/Hosting-Portal
npm ci
sudo bash scripts/backup.sh /opt/backups
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
npm run db:generate && npm run build

# 2. Add GitHub App or OAuth credentials to /etc/alo-hosting/panel.env
#    (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET ...)
#    and restart: sudo systemctl restart alo-hosting-panel

# 3. Point the GitHub webhook at https://hosting.alolabs.net/api/github/webhook
#    (or click Connect GitHub + import in /deployments to create the hook).

# 4. Verify with the existing infrastructure and the new HTTP harness:
bash scripts/server-doctor.sh
set -a; . /etc/alo-hosting/panel.env; set +a
node scripts/verify-deploy-http.mjs
```

`scripts/verify-deploy-http.mjs` needs `PANEL_PASSWORD`,
`GITHUB_WEBHOOK_SECRET`, `LOCAL_SOURCE` (a real git repo with 2 commits) and
`SOURCE_PORT`. It performs a real login, import, signed webhooks, deploy,
rollback and redeploy, and prints only status codes, ids and commit SHAs.
