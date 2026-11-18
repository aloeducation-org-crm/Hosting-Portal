# Route and API Inventory

> Generated from the tree at `d1dc3d0`. 252 route files, 386 exported handlers.
> Every path below exists in `src/`. Methods are the ones the file exports.

## 1. Authorisation model per class

| Class | Edge gate | In-handler check |
|---|---|---|
| `PUBLIC_API_PATHS` (auth flows, health, CSRF issue, public forms, signed webhooks) | session not required | route-specific (signature, origin) |
| `HMAC_AUTHENTICATED_API_PATHS` (agents, orchestrator tick, automation, cloud v1, internal CRM) | HMAC instead of session | `requireAgent` / service token |
| Everything else under `/api` | session + verification gate | `requireSession` + ownership filter |
| `ADMIN_API_PREFIXES` | admin role at the edge | `requireSession` + role check |

## 2. Endpoints

| Methods | Path |
|---|---|
| `GET` | `/api/activity/recent` |
| `POST` | `/api/agents/[slug]/revoke` |
| `POST` | `/api/agents/[slug]/rotate` |
| `GET` | `/api/agents/[slug]` |
| `POST` | `/api/agents/[slug]/run` |
| `POST` | `/api/agents/enroll` |
| `GET,POST` | `/api/agents/enrollment-tokens` |
| `POST` | `/api/agents/heartbeat` |
| `GET,POST` | `/api/agents` |
| `GET` | `/api/agents/runs` |
| `POST` | `/api/agents/seed` |
| `POST` | `/api/agents/tasks/[id]/approve` |
| `POST` | `/api/agents/tasks/claim` |
| `POST` | `/api/agents/tasks/result` |
| `POST` | `/api/agents/tasks/start` |
| `GET,POST` | `/api/ai/auto-deploy` |
| `PATCH` | `/api/ai/capability-requests/[id]` |
| `GET,POST` | `/api/ai/capability-requests` |
| `POST` | `/api/ai/chat` |
| `POST` | `/api/ai/code` |
| `GET,POST` | `/api/ai/deploy-assistant` |
| `POST` | `/api/ai/domain-advisor` |
| `GET` | `/api/ai/models` |
| `GET,POST` | `/api/ai/operator` |
| `DELETE,PUT` | `/api/ai/prompts/[id]` |
| `GET` | `/api/ai/prompts` |
| `GET,POST` | `/api/ai/providers` |
| `GET` | `/api/ai/status` |
| `GET` | `/api/ai/token-usage` |
| `GET` | `/api/ai/token` |
| `POST` | `/api/ai/website` |
| `DELETE,GET,PATCH` | `/api/ai/workflows/[id]` |
| `POST` | `/api/ai/workflows/[id]/run` |
| `GET` | `/api/ai/workflows/[id]/runs` |
| `GET,POST` | `/api/ai/workflows` |
| `GET,POST,PUT` | `/api/alerts` |
| `DELETE,GET,PUT` | `/api/alerts/rules/[id]` |
| `GET,POST` | `/api/alerts/rules` |
| `GET` | `/api/applications/[id]/logs` |
| `DELETE,GET,PUT` | `/api/applications/[id]` |
| `GET,POST` | `/api/applications` |
| `DELETE,PATCH,POST` | `/api/apps/[id]/install` |
| `DELETE,GET,PATCH` | `/api/apps/[id]` |
| `GET,POST` | `/api/apps` |
| `GET` | `/api/audit-logs` |
| `handlers-exported` | `/api/auth/[...nextauth]` |
| `POST` | `/api/auth/forgot-password` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/logout` |
| `POST` | `/api/auth/mfa-challenge` |
| `GET,POST` | `/api/auth/onboarding` |
| `GET` | `/api/auth/providers` |
| `handlers-exported` | `/api/auth/register` |
| `POST` | `/api/auth/reset-password` |
| `GET` | `/api/auth/session` |
| `POST` | `/api/auth/signup` |
| `GET,POST` | `/api/auth/verify-email` |
| `GET,POST` | `/api/automation/admin` |
| `GET` | `/api/automation/cron` |
| `POST` | `/api/automation/tool` |
| `GET` | `/api/backups` |
| `POST` | `/api/billing/invoices/generate` |
| `GET` | `/api/billing/usage/aggregate` |
| `GET,POST` | `/api/billing/usage` |
| `GET` | `/api/ci-cd/pipelines` |
| `GET,POST` | `/api/ci` |
| `DELETE,GET` | `/api/cloud/projects/[id]/buckets/[bucketId]/objects/[objectId]` |
| `POST` | `/api/cloud/projects/[id]/buckets/[bucketId]/objects/[objectId]/signed-url` |
| `GET,POST` | `/api/cloud/projects/[id]/buckets/[bucketId]/objects` |
| `GET,POST` | `/api/cloud/projects/[id]/buckets` |
| `POST` | `/api/cloud/projects/[id]/databases/[databaseId]/backup` |
| `POST` | `/api/cloud/projects/[id]/databases/[databaseId]/restore` |
| `POST` | `/api/cloud/projects/[id]/databases/[databaseId]/rotate` |
| `GET,POST` | `/api/cloud/projects/[id]/databases` |
| `GET` | `/api/cloud/projects/[id]/environments` |
| `DELETE` | `/api/cloud/projects/[id]/functions/[functionId]` |
| `POST` | `/api/cloud/projects/[id]/functions` |
| `POST` | `/api/cloud/projects/[id]/keys/[keyId]/rotate` |
| `DELETE` | `/api/cloud/projects/[id]/keys/[keyId]` |
| `POST` | `/api/cloud/projects/[id]/keys` |
| `GET` | `/api/cloud/projects/[id]/keys/usage` |
| `DELETE` | `/api/cloud/projects/[id]/members/[userId]` |
| `GET,PUT` | `/api/cloud/projects/[id]/members` |
| `DELETE` | `/api/cloud/projects/[id]/platforms/[platformId]` |
| `POST` | `/api/cloud/projects/[id]/platforms` |
| `DELETE,GET,PATCH` | `/api/cloud/projects/[id]` |
| `GET,PUT` | `/api/cloud/projects/[id]/secrets` |
| `DELETE` | `/api/cloud/projects/[id]/webhooks/[webhookId]` |
| `POST` | `/api/cloud/projects/[id]/webhooks` |
| `GET,POST` | `/api/cloud/projects` |
| `GET` | `/api/cloud/v1/health` |
| `GET` | `/api/cloud/v1/storage/[bucketId]/objects/[objectId]` |
| `POST` | `/api/cloud/workers/heartbeat` |
| `POST` | `/api/cloud/workers/register` |
| `GET,POST` | `/api/companies` |
| `POST` | `/api/contact` |
| `DELETE,GET,PUT` | `/api/containers/[id]` |
| `DELETE,GET,POST,PUT` | `/api/containers` |
| `DELETE,PUT` | `/api/crm/activities/[id]` |
| `GET,POST` | `/api/crm/activities` |
| `DELETE,GET,PUT` | `/api/crm/contacts/[id]` |
| `GET,POST` | `/api/crm/contacts` |
| `DELETE,PUT` | `/api/crm/deals/[id]` |
| `GET,POST` | `/api/crm/deals` |
| `DELETE,PUT` | `/api/crm/pipelines/[id]` |
| `GET,POST` | `/api/crm/pipelines` |
| `DELETE,GET,POST,PUT` | `/api/cron` |
| `GET` | `/api/csrf` |
| `GET` | `/api/dashboard/activity` |
| `GET` | `/api/dashboard/stats` |
| `DELETE,GET` | `/api/databases/[id]` |
| `GET,POST` | `/api/databases` |
| `GET` | `/api/deploy/deployments/[id]` |
| `POST` | `/api/deploy/projects/[id]/deploy` |
| `GET` | `/api/deploy/projects/[id]/deployments` |
| `POST` | `/api/deploy/projects/[id]/detect` |
| `POST` | `/api/deploy/projects/[id]/rollback` |
| `GET,PATCH` | `/api/deploy/projects/[id]` |
| `GET,POST` | `/api/deploy/projects` |
| `GET` | `/api/deploy/status` |
| `GET,POST` | `/api/deploy/webhook` |
| `GET` | `/api/deployments/[id]` |
| `GET,POST` | `/api/deployments` |
| `DELETE,GET,POST` | `/api/domains/[id]` |
| `GET` | `/api/domains/mine` |
| `POST` | `/api/domains/purchase` |
| `GET` | `/api/domains/search` |
| `GET` | `/api/domains/suggestions` |
| `DELETE,GET,PUT` | `/api/email/accounts/[id]` |
| `DELETE,GET,POST,PUT` | `/api/email/accounts` |
| `GET,POST` | `/api/email/campaigns` |
| `GET` | `/api/email/dns-records` |
| `POST` | `/api/email/send` |
| `POST` | `/api/email/verify` |
| `DELETE,GET,POST` | `/api/file-manager` |
| `GET` | `/api/github/callback` |
| `GET` | `/api/github/connect` |
| `POST` | `/api/github/disconnect` |
| `GET` | `/api/github/repos` |
| `GET` | `/api/github/status` |
| `GET,POST` | `/api/github/webhook` |
| `GET` | `/api/health` |
| `DELETE,GET,PATCH` | `/api/industries/[id]` |
| `GET,POST` | `/api/industries` |
| `GET` | `/api/infrastructure/inventory` |
| `GET` | `/api/infrastructure/topology` |
| `GET` | `/api/internal/crm/documents/[id]/content` |
| `POST` | `/api/internal/crm/documents/[id]/download-url` |
| `GET` | `/api/internal/crm/documents/[id]/download` |
| `GET` | `/api/internal/crm/documents/[id]` |
| `POST` | `/api/internal/crm/documents` |
| `GET` | `/api/internal/crm/storage/backup` |
| `GET` | `/api/internal/crm/storage/health` |
| `GET` | `/api/internal/crm/storage/quota` |
| `POST` | `/api/internal/sites/ssl-status` |
| `GET` | `/api/invoices/[id]` |
| `GET,PUT` | `/api/invoices` |
| `GET` | `/api/logs/center` |
| `GET` | `/api/logs` |
| `GET` | `/api/marketing/domain-check` |
| `GET,POST` | `/api/marketing` |
| `POST` | `/api/monitoring/check` |
| `POST` | `/api/monitoring/collect` |
| `GET` | `/api/monitoring/metrics` |
| `DELETE,PUT` | `/api/network/dns/[id]` |
| `GET,POST` | `/api/network/dns` |
| `GET` | `/api/network/dns/status` |
| `GET,POST` | `/api/network/load-balancers` |
| `GET` | `/api/network/load` |
| `POST` | `/api/newsletter` |
| `DELETE,PUT` | `/api/notifications/[id]` |
| `GET,POST` | `/api/notifications` |
| `DELETE,GET,POST` | `/api/operations/[id]` |
| `GET,POST` | `/api/operations` |
| `GET` | `/api/operations/worker` |
| `POST` | `/api/orchestrator/jobs/[id]/approve` |
| `POST` | `/api/orchestrator/jobs/[id]/cancel` |
| `POST` | `/api/orchestrator/jobs/[id]/requeue` |
| `GET` | `/api/orchestrator/jobs/[id]` |
| `GET,POST` | `/api/orchestrator/jobs` |
| `POST` | `/api/orchestrator/run` |
| `GET` | `/api/orchestrator/status` |
| `GET` | `/api/orders/[id]` |
| `GET,POST` | `/api/orders` |
| `GET,POST` | `/api/platform/cron-jobs` |
| `GET,POST` | `/api/platform/secrets` |
| `DELETE` | `/api/platform/webhooks/[id]` |
| `GET,POST` | `/api/platform/webhooks` |
| `GET,POST,PUT` | `/api/pricing/plans` |
| `handlers-exported` | `/api/pricing` |
| `GET,POST` | `/api/projects` |
| `GET,POST` | `/api/providers` |
| `GET,POST` | `/api/roles` |
| `GET` | `/api` |
| `GET` | `/api/security/audit-export` |
| `GET` | `/api/security/audit-logs` |
| `POST` | `/api/security/encrypt` |
| `GET,POST,PUT` | `/api/security/firewall` |
| `GET,POST` | `/api/security/lockout` |
| `GET` | `/api/security/rate-limits` |
| `DELETE,GET` | `/api/security/sessions` |
| `DELETE` | `/api/security/ssh-keys/[id]` |
| `GET,POST` | `/api/security/ssh-keys` |
| `DELETE,GET,POST` | `/api/security/ssh` |
| `GET` | `/api/servers/discover` |
| `GET` | `/api/servers/health` |
| `POST` | `/api/servers/provision` |
| `GET` | `/api/servers/reconcile` |
| `GET,PATCH,POST` | `/api/servers` |
| `DELETE,GET,PATCH` | `/api/services/[id]` |
| `GET,POST` | `/api/services` |
| `GET,POST` | `/api/settings/api-keys` |
| `DELETE,GET,POST` | `/api/settings/api` |
| `GET,PUT` | `/api/settings` |
| `GET,POST` | `/api/sites` |
| `DELETE,GET,PUT` | `/api/ssl/[id]` |
| `GET` | `/api/ssl/check` |
| `GET` | `/api/ssl/expiring` |
| `POST` | `/api/ssl/renew` |
| `DELETE,GET,POST,PUT` | `/api/ssl` |
| `GET,POST` | `/api/sso` |
| `GET,POST` | `/api/storage/buckets` |
| `GET` | `/api/storage/documents/[id]/content` |
| `DELETE` | `/api/storage/documents/[id]` |
| `GET,POST` | `/api/storage/documents` |
| `GET,POST` | `/api/storage/pools` |
| `GET,POST` | `/api/subscriptions` |
| `GET,POST` | `/api/support-tickets` |
| `GET` | `/api/system/info` |
| `GET` | `/api/system/resources` |
| `GET` | `/api/system/services` |
| `GET,POST` | `/api/tasks` |
| `POST` | `/api/user/mfa/backup-codes` |
| `POST` | `/api/user/mfa/disable` |
| `GET,POST` | `/api/user/mfa` |
| `POST` | `/api/user/mfa/verify` |
| `PUT` | `/api/user/password` |
| `DELETE,GET,PUT` | `/api/user/profile` |
| `DELETE,GET,PUT` | `/api/users/[id]` |
| `GET,POST` | `/api/users` |
| `POST` | `/api/websites/[id]/backups/[backupId]/restore` |
| `GET,POST` | `/api/websites/[id]/backups` |
| `POST` | `/api/websites/[id]/deploy` |
| `POST` | `/api/websites/[id]/destroy` |
| `GET,PUT` | `/api/websites/[id]/env` |
| `GET` | `/api/websites/[id]/logs` |
| `POST` | `/api/websites/[id]/restart` |
| `POST` | `/api/websites/[id]/resume` |
| `DELETE,GET,PUT` | `/api/websites/[id]` |
| `GET,POST` | `/api/websites/[id]/ssl` |
| `POST` | `/api/websites/[id]/suspend` |
| `GET,POST` | `/api/websites` |

## 3. Page routes

| Tree | Pages |
|---|---|
| `src/app/(auth)` | 5 |
| `src/app/(dashboard)` | 26 |
| `src/app/dashboard` | 23 |
| `src/app/(admin)` | 5 |
| `hosting/` | 9 (retired storefront, redirected by `next.config.ts`) |
| `projects/`, `industries/` | 4 |
| marketing roots (`/`, `/privacy`, `/terms`, `/services`, `/pricing`, `/domains`, `/email`, `/ssl`) | 8 |

## 4. Changes in this pass

| Change | Path |
|---|---|
| Added | `POST /api/agents/tasks/start` — claim check + RUNNING transition (SEC-07) |
| Changed | `GET /api/health` — structured reason, real uptime (SEC-13) |
| Changed | `/api/subscriptions`, `/api/auth/onboarding`, `/api/ai/operator` — single entitlement writer (SEC-03) |
| Changed | `/api/github/status`, `/api/github/repos` — scoped to the caller (SEC-02) |
| Changed | `/api/websites`, `/api/databases` — plan limit before helper (SEC-03) |
| Changed | `/api/agents/tasks/claim` — signs the complete task document (SEC-07) |
