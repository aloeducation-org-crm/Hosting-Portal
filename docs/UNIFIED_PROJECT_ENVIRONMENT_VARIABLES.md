# Unified Project Environment Variables Reference (`docs/UNIFIED_PROJECT_ENVIRONMENT_VARIABLES.md`)

- **Date**: `2026-10-27` (`Asia/Dhaka`, UTC+6)
- **Canonical Validation Module**: `src/lib/env.ts` (Zod v4 schema + production fail-closed secret guard)
- **Canonical Templates**: `.env.example` (application root), `deploy/env/alo-hosting-panel.env.example` (systemd / Ubuntu host deployment)
- **Redaction Policy**: Zero live secret values appear in this document. Generate production secrets exclusively on the target host via `openssl rand -hex 32` with file mode `0600`.

---

## 1. Production Fail-Closed Secret Policy

When `NODE_ENV=production` (outside `next build`), `src/lib/env.ts` inspects four mandatory cryptographic secrets via `findUnsafeProductionSecrets()` and **terminates startup (`process.exit(1)`)** if any of them is empty, matches a development default, or begins with `replace-with-` / `replace_with_`:

| Variable | Required in Prod | Purpose | Generation Command |
|---|:---:|---|---|
| `NEXTAUTH_SECRET` | **YES (Fail-Closed)** | Signs and encrypts NextAuth session JWTs (`src/lib/auth-options.ts`, `src/middleware.ts`) | `openssl rand -hex 32` |
| `JWT_SECRET` | **YES (Fail-Closed)** | Signs auxiliary platform JWT tokens (must be distinct from `NEXTAUTH_SECRET`) | `openssl rand -hex 32` |
| `APP_ENCRYPTION_KEY` | **YES (Fail-Closed)** | Master key material for AES-256-GCM at-rest secret encryption (`src/lib/encryption.ts`, `/api/security/encrypt`, GitHub OAuth tokens, site `.env` secrets) | `openssl rand -hex 32` |
| `INTERNAL_SECRET` | **YES (Fail-Closed)** | Authenticates internal background worker/collector endpoints (`/api/operations/worker`, `/api/monitoring/collect`) via constant-time SHA-256 `timingSafeEqual` (`>=16` chars) | `openssl rand -hex 32` |

---

## 2. Core Application, Network & Database Variables

| Variable | Required | Default (`src/lib/env.ts`) | Description |
|---|:---:|---|---|
| `NODE_ENV` | Yes | `development` | Runtime mode (`development`, `production`, `test`) |
| `HOSTNAME` | No | `127.0.0.1` | Bind address (`127.0.0.1` behind Nginx/Caddy/Cloudflared on Ubuntu; `0.0.0.0` inside Docker container) |
| `PORT` | No | `3101` | HTTP listen port (`1`–`65535`) |
| `APP_URL` | Yes (Prod) | `http://localhost:3101` | Canonical public URL (`https://hosting.alolabs.net` in production) |
| `NEXTAUTH_URL` | Yes (Prod) | `http://localhost:3101` | NextAuth callback base URL (must match `APP_URL` in production) |
| `DATABASE_URL` | Yes | `file:./db/custom.db` | LibSQL / SQLite connection URL. **Use an absolute path** (e.g., `file:/var/lib/alo-hosting-panel/custom.db` or `file:/opt/alo-hosting/db/custom.db`) when running `.next/standalone/server.js` so working-directory differences cannot split the DB file |
| `CORS_ALLOWED_ORIGINS` | No | `""` (same-origin only) | Comma-separated exact origins allowed on `/api/*` (wildcard `*` is never permitted) |
| `CROSS_ORIGIN_OPENER_POLICY` | No | `same-origin` | Value for `Cross-Origin-Opener-Policy` response header |
| `CROSS_ORIGIN_RESOURCE_POLICY` | No | `same-site` | Value for `Cross-Origin-Resource-Policy` response header |

---

## 3. Host Provisioning, Deployment & Helper Variables

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `SITE_BASE` | No | `/srv/alo-sites` | Root directory for provisioned tenant websites and atomic git release directories |
| `BACKUP_BASE` | No | `/var/backups/alo-sites` | Root directory for website and database archive backups |
| `CADDY_CONFIG_DIR` | No | `/etc/caddy/sites-enabled` | Per-site Caddy virtual-host configuration directory |
| `CADDY_LOG_DIR` | No | `/var/log/caddy/alo-sites` | Per-site Caddy access/error log directory |
| `HELPER_DIR` | No | `/usr/local/sbin` | Directory containing `root:root` (`0750`) `alo-*-helper` scripts invoked via `sudo -n` |
| `HELPER_USE_SUDO` | No | `true` (when non-root) | Set `false` only in unit tests or root-less mock harnesses |
| `HELPER_TIMEOUT_SECONDS` | No | `120` | Max execution timeout (`5`–`3600`s) per privileged helper call |
| `DEPLOY_TIMEOUT_SECONDS` | No | `1800` | Max timeout (`30`–`7200`s) per Git build/deploy pipeline run |
| `DEPLOY_WEBHOOK_SECRET` | Recommended | Falls back to `INTERNAL_SECRET` | Dedicated secret (`>=16` chars) verified via `x-webhook-secret` header on `POST /api/deploy/webhook` |
| `CRON_SECRET` | Recommended | None (fails closed if unset) | Secret (`>=16` chars) for scheduled cron trigger endpoints |
| `BACKUP_RETENTION_COUNT` | No | `14` | Number of per-site backups retained before rotation (`1`–`365`) |
| `MAX_UPLOAD_SIZE_MB` | No | `500` | Maximum File Manager upload size (`1`–`5120` MB) |
| `RATE_LIMIT_WINDOW_SECONDS` | No | `60` | General API rate-limit window |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | General API max requests per IP per window (auth/public forms strictly capped at `10/min`; `POST /api/ai/*` capped at `30/min` per user) |
| `ALLOW_STATIC` / `ALLOW_PHP` / `ALLOW_NODE` / `ALLOW_NEXTJS` | No | `true` | Toggle allowed tenant site runtimes |
| `COMMERCIAL_HOSTING` | No | `false` | Enables multi-tenant commercial license guardrails in `/ai/self-hosted` |

---

## 4. Optional OAuth, GitHub Autodeploy, Email, Redis & AI Providers

All external integrations are **optional**. Missing keys never block application startup; unconfigured subsystems fail closed with explicit status codes (`501`/`503`) or fall back cleanly.

| Subsystem | Variables | Notes |
|---|---|---|
| **GitHub OAuth & Autodeploy** | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` | Used by `/api/github/{connect,callback,repos,webhook}` (`HMAC-SHA256` signature check on webhooks) |
| **Google OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional social login in `src/lib/auth-options.ts` |
| **AI Provider Chain (`src/lib/ai/providers.ts`)** | `AI_PROVIDER_ORDER`, `AI_ALLOW_ANONYMOUS`, `AI_REQUEST_TIMEOUT_MS`, `UNOROUTER_API_KEY`, `UNOROUTER_BASE_URL`, `LLM7_API_KEY`, `LLM7_BASE_URL`, `GROQ_API_KEY`, `AI_GATEWAY_URL`, `AI_GATEWAY_API_KEY`, `OLLAMA_BASE_URL`, `LOCALAI_BASE_URL`, `LOCALAI_API_KEY`, `OPENROUTER_API_KEY`, `QWEN_API_KEY`, `GLM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Custom base URLs are SSRF-validated (cloud metadata `169.254.169.254`, `100.100.100.200`, `metadata.google.internal`, and wildcard `0.0.0.0`/`[::]` are blocked). All AI calls enforce `AbortSignal` timeouts |
| **Transactional SMTP** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional email verification, password reset, and alert delivery |
| **Redis (Optional)** | `REDIS_URL`, `REDIS_PASSWORD` | Optional distributed cache / rate-limit backend |
| **Cloudflare Tunnel (Optional)** | `CLOUDFLARE_TUNNEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` | Used by `deploy/cloudflared/` and `alo-server-kit` when origin runs behind Cloudflare Tunnel |

---

## 5. Historical Secret Exposure Remediation Notice (`SEC-01`)

During Phase One auditing, plaintext credentials were discovered inside `alo-server-kit/scripts/auto-env-fixer.js` (introduced in historical commit `fa37b00`). Phase Two scrubbed all hardcoded values and replaced them with CSPRNG generation (`0o600` permissions). **Before production cutover**, an authorized operator must rotate any database, LiteLLM, or cron credentials on hosts that ever executed the legacy `auto-env-fixer.js` script, and optionally purge historical commit blobs only under an explicitly approved Git maintenance window.
