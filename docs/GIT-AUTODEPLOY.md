# Git-connected automatic deployment

Implemented on top of the existing ALO Labs panel. **No existing route, table
column, environment file, domain or running service is replaced.** The three new
tables and the extra `deployments` columns are additive.

```
GitHub push
   │  X-Hub-Signature-256 (HMAC-SHA256, timing-safe)
   ▼
POST /api/github/webhook
   • verify signature  • dedup by X-GitHub-Delivery (unique index)
   • authorize: repository + production branch + installation id + autoDeploy
   ▼
deployments row (PENDING)  ── per-project lock + atomic PENDING→RUNNING claim
   ▼
checkout exact SHA (git clone --no-checkout, detached HEAD, argv only)
   ▼
detect framework again from THIS commit → resolve effective config
   ▼
install → lint → typecheck → test → build   (allowlisted argv, no shell,
                                             minimal env, hard timeout)
   ▼
immutable release dir + alo-deploy.json marker
   ▼
atomic `current` symlink swap → start/reload service
   ▼
health check (HTTP 2xx) **and** HTTP release marker with matching commit SHA
and deployment id → SUCCESS. Otherwise restore previous symlink → ROLLED_BACK.
```

## 1. Files

| Area | Files |
|---|---|
| Migration | `prisma/migrations/20261026130000_github_autodeploy/migration.sql`, `scripts/apply-deploy-schema.mjs` |
| Schema | `prisma/schema.prisma` (`GitConnection`, `GitProject`, `WebhookDelivery`, additive `Deployment` fields) |
| Detection | `src/lib/deploy/detect.ts`, `config.ts` (command allowlist), `types.ts` |
| GitHub | `src/lib/deploy/github.ts` (App JWT, installation token, OAuth, repos, branches, manifests, hooks) |
| Webhook | `src/lib/deploy/webhook.ts`, `signature.ts` |
| Pipeline | `src/lib/deploy/engine.ts`, `queue.ts`, `service.ts`, `redact.ts` |
| APIs | `src/app/api/github/*`, `src/app/api/deploy/*` |
| UI | `src/components/deploy/DeploymentsManager.tsx`, `src/app/(dashboard)/deployments/page.tsx`, nav link in `DashboardShell.tsx` |
| Worker | `scripts/deploy-worker.ts` |
| Tests | `tests/deploy-detect.test.ts`, `tests/deploy-config.test.ts`, `tests/deploy-e2e.test.ts`, `tests/helpers/deploy-harness.ts` |

Existing `/api/deploy/webhook`, `/api/deployments`, `/api/ci`, `/api/websites/[id]/deploy`
and the whole `CICDView` remain untouched. The new UI reads only the new APIs.

## 2. Apply the migration (no Prisma engine download needed)

```bash
cd ~/projects/Hosting-Portal
git pull
npm ci
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs --check
npm run db:generate
```

The applier is idempotent, only creates missing tables/indexes and adds missing
NULLable/defaulted columns, and also repairs the pre-existing drift that made
`/api/health` return 503 (`hosting_sites` table and `servers` metric columns).
It never prints environment values. Take a backup first:
`bash scripts/backup.sh /opt/backups`.

## 3. Configure GitHub (choose one)

### A. GitHub App — recommended (least privilege)

1. Create a GitHub App with **Contents: read-only**, **Metadata: read-only**,
   **Webhooks: read/write** and subscribe to `push`, `pull_request`, `ping`.
2. Set the webhook URL to `https://hosting.alolabs.net/api/github/webhook`
   and generate a webhook secret.
3. Install the app on the owner/organization, note the installation id.
4. Put `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM or base64 PEM),
   `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET` in
   `/etc/alo-hosting/panel.env`. Installation access tokens are minted per use,
   cached for <1h, and never stored.

With an App webhook, no per-repository hook needs to be created.

### B. OAuth "Connect GitHub"

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` and
`APP_URL`. The user clicks **Connect GitHub** (`GET /api/github/connect`); the
state-bound callback stores the token AES-256-GCM encrypted in
`git_connections.tokenEncrypted`. `POST /api/deploy/projects` then creates the
repository hook automatically. Revoke from `/api/github/disconnect`.

### C. Staging token

`GITHUB_TOKEN=<PAT>` works without a UI connection. `GITHUB_API_URL`,
`GITHUB_CLONE_BASE_URL` and `DEPLOY_ALLOW_LOCAL_SOURCE=true` allow a fully local
end-to-end test with a `file`-path repository (see §6).

Other variables: `DEPLOY_RELEASE_BASE`, `DEPLOY_BIND_HOST`,
`DEPLOY_STATIC_PORT_BASE`, `DEPLOY_PUBLIC_URL_TEMPLATE`,
`DEPLOY_COMMAND_TIMEOUT_MS`, `DEPLOY_INLINE_WORKER`, `DEPLOY_DOMAIN_SUFFIX`,
`DEPLOY_ENV_FILE_BASE`. See `.env.example`.

## 4. Use it

1. `/deployments` → **Connect GitHub** → **List repos** → pick a repo.
2. **Import**: detection runs against the repository's real manifests through
   the GitHub API. It records language, framework, package manager, lockfile,
   runtime version, install/lint/typecheck/test/build/start commands, output
   dir, env **names**, port, health path and confidence.
3. Ambiguous detections (Next.js/NestJS/Express, PHP, Python, Docker, unknown)
   are **paused**: `autoDeploy=false`, `requiresApproval=true`. Review the JSON
   config in the UI and press **Approve config**. Nothing runs before that.
4. A signed push to the production branch enqueues exactly one deployment.
   Progress + logs are persisted in `deployment_logs` and polled by the UI.
5. **Deploy** redeploys a pinned SHA, **Rollback** restores the previous
   verified release, **Auto deploy** disables webhook-triggered builds.

### API map

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/github/webhook` | HMAC | push/PR/ping receiver |
| GET | `/api/github/status` | session | configuration state (no secrets) |
| GET | `/api/github/connect` | session | OAuth start (state cookie) |
| GET | `/api/github/callback` | state+cookie | OAuth finish |
| POST | `/api/github/disconnect` | session | revoke + unlink (projects preserved) |
| GET | `/api/github/repos` | session | repos / branches / detection preview |
| GET,POST | `/api/deploy/projects` | session / `WEBSITE_CREATE` | list / import |
| GET,PATCH | `/api/deploy/projects/:id` | session / `WEBSITE_UPDATE` | detail / editable config |
| POST | `/api/deploy/projects/:id/detect` | session | re-detect from repo |
| POST | `/api/deploy/projects/:id/deploy` | `WEBSITE_DEPLOY` | manual redeploy |
| POST | `/api/deploy/projects/:id/rollback` | `BACKUP_RESTORE` | approval-gated rollback |
| GET | `/api/deploy/projects/:id/deployments` | session | history |
| GET | `/api/deploy/deployments/:id` | session | detail + logs |
| GET | `/api/deploy/status` | session | queue + ports |

## 5. Security model

- **HMAC** verification is constant-time and happens before JSON parsing; a
  failed signature is rejected and recorded (`401`).
- **Dedup**: unique `webhook_deliveries.deliveryId` + a second fence on
  `(projectId, commitSha, trigger=webhook)` within 15 minutes. Retries after a
  genuine `failed` delivery are re-processed.
- **Authorization**: repository + branch are looked up in `git_projects`; the
  installation id must match the bound connection; `autoDeploy` can be disabled.
  A payload cannot choose a clone URL, path, command, branch or destination.
- **No arbitrary shell**: all commands are argv arrays validated against an
  executable allowlist; shell metacharacters, inline eval flags, absolute paths,
  traversal and unsafe script names are rejected. Builds run in `mkdtemp()`
  with a minimal env (no `DATABASE_URL`, no auth secrets); optional build env
  is filtered to declared names from an operator-owned file.
- **Verification**: HTTP 200 is not enough — `/__alo_release.json` served by the
  active release must report this deployment id and commit SHA.
- **Redaction**: every log line passes through `redact()`; tokens, bearer
  strings, URL userinfo, private keys and `key/secret/token=` values are masked.
- **RBAC**: project access = admin/devops, owner or creator; mutations require
  the matching permission. Mutating actions write `audit_logs`.
- **Rollback**: keep the previous symlink, restore on failure, verify again.

Not implemented / deliberately out of scope: unrestricted arbitrary command
execution, automatic DB migrations, firewall changes, Docker builds, PHP/Python
service wiring, preview deployments for PRs (PR events are recorded and
ignored), and cross-host distributed locking (the DB claim + per-project lock is
process-local; run ONE worker host per project).

## 6. Verify locally (no GitHub credentials required)

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build
npx vitest run tests/deploy-e2e.test.ts
```

`tests/deploy-e2e.test.ts` creates a **real git repository** with three commits,
a **real SQLite database** (a copy of `db/custom.db` with the additive
migration), a **real HTTP release server**, and signed webhooks. It proves:
invalid signature rejected; exactly one deployment per push; duplicate delivery
ignored; first and second commits verified live; failed build preserves the
previous release; rollback restores the expected release; logs contain no
secrets.

Long-running worker (optional, for `DEPLOY_INLINE_WORKER=false`):

```bash
DATABASE_URL="file:/var/lib/alo-hosting/alo.db" npx tsx scripts/deploy-worker.ts --once
```

## 7. Integration with existing infrastructure

`serviceManager=static` uses the built-in release server for static/Vite builds.
For a Node service already managed by PM2/systemd, set `serviceManager` to
`pm2`/`systemd` and `serviceName` to the existing unit; the engine performs a
`pm2 reload` / `systemctl restart` on the validated name and then verifies the
HTTP release marker. Put the marker behind your app at
`/__alo_release.json` (or set `healthUrl` to a service that serves it) — without
it, verification fails closed instead of reporting a false success. Reverse
proxy, domains, SSL, backups and the existing self-hosted Actions runner are
unchanged; this pipeline is additive and can run beside `deploy.yml`.
