# Architecture and Data Flow

> Current-state architecture of the ALO LABS Hosting Portal, with the parts this
> pass changed marked **[0.5]**. Target architecture is deliberately not
> described here; it lives in `docs/audit/PHASE-0-MASTER-AUDIT-2026-11-11.md` §11.

## 1. Components

```
                    ┌──────────────────────────────────────────────┐
  browser ──────────►  Caddy / nginx (single reverse proxy, TLS)     │
                    └───────────────┬──────────────────────────────┘
                                    │ 127.0.0.1:3051 (panel)
                    ┌───────────────▼──────────────────────────────┐
                    │  Next.js 16 control plane (one Node process)  │
                    │                                               │
                    │  src/proxy.ts ── edge gate               [0.5] │
                    │    session guard · CSRF · rate limit          │
                    │    admin guard · verification gate       [0.5] │
                    │    client identity                     [0.5]   │
                    │                                               │
                    │  src/app/api/** (252 route files)             │
                    │  src/app/** (80 pages, 5 trees)               │
                    └───┬───────┬────────┬────────┬────────┬────────┘
                        │       │        │        │        │
          ┌─────────────▼─┐ ┌───▼────┐ ┌─▼─────┐ ┌▼──────┐ ┌▼──────────┐
          │ Prisma 6.19.3 │ │ deploy │ │ job   │ │ AI    │ │ helpers/  │
          │ libSQL adapter│ │ engine │ │ orch. │ │ chain │ │ via sudo  │
          │  124 models   │ │  [0.5] │ │workers│ │       │ │ 23 bash   │
          └───────┬───────┘ └───┬────┘ └───┬───┘ └───┬───┘ └─────┬─────┘
                  │             │          │         │           │
             SQLite file   build sandbox  durable   provider   host system
            /var/lib/alo-   (namespaces)  job rows   HTTP      (root-equiv.)
             hosting/alo.db   [0.5]                            │
                                                               │
                              ┌────────────────────────────────▼──────┐
                              │  Node agent (alo-agent.mjs, per host)  │
                              │  HMAC in, allowlist, signed tasks [0.5]│
                              └───────────────────────────────────────┘
```

## 2. Request lifecycle (API)

1. **Edge gate** (`src/proxy.ts`) — ordered, first failure wins:
   CORS preflight → rate limit (`resolveClientIdentity[0.5]`) → origin check →
   session (`getToken`) → admin-route guard → **email verification gate[0.5]** →
   CSRF token binding for authenticated mutations.
2. **Route handler** — `requireSession`/`requirePermission` re-reads the user
   (so a lock or role change takes effect immediately), then Zod-validates input.
3. **Domain module** (`src/lib/**`) — opens a Prisma transaction where the
   operation must be atomic.
4. **Audit** — `createAuditLog` writes actor, tenant, action, resource, result and
   metadata. Redaction applies before persistence.
5. **Response** — `apiSuccess`/`apiError` with a stable `error.code`.

The edge gate is a defence-in-depth layer, **not** the authorisation decision.
Every sensitive handler re-checks in-process; the edge check is what stops a
request before a handler is even loaded.

## 3. Data flow — customer deployment

```
POST /api/deploy/projects
   → connections.ts: requireConnectionAccess(user, connectionId)   [0.5 SEC-02]
   → projects.ts: importRepository (validated owner/repo, clone URL derived)
   → signature check on push webhook
   → queue.enqueueDeployment (dedupe by delivery id, idempotency key)
   → engine.deploy:
        resolve database URL (no fixture fallback in prod)          [0.5 SEC-12]
        assertIsolationAvailable()  ← before any customer byte      [0.5 SEC-01]
        git clone --detach <pinned sha>   (trusted host-side)
        detect framework
        install → lint → typecheck → test → build
             each step via runIsolatedCommand (bwrap | unshare |
             sandbox-exec) with scrubbed env and process-group kill [0.5 SEC-01]
        package release → symlink activate → HTTP verify marker
        success: Release + Deployment rows; failure: restore previous
```

## 4. Data flow — agent task

```
claim:  POST /api/agents/tasks/claim
        requireAgent (HMAC over timestamp.nonce.sha256(body), replay window,
        single-use nonce, per-agent credential)
        → claimTask (conditional update PENDING→ASSIGNED)
        → signTaskEnvelope(secret, full task document)              [0.5 SEC-07]

agent:  verifyClaimedTask(secret)  ← was never called before 0.5     [SEC-07]
        reject unknown fields, replay window, constant-time compare
        POST /api/agents/tasks/start  (ASSIGNED→RUNNING + claim check)[0.5]
        executeTask → allowlist (compiled-in, mirrored server-side)
        POST /api/agents/tasks/result (signed like every other request)
```

## 5. Data flow — entitlement change

```
POST /api/subscriptions | /api/auth/onboarding | /api/ai/operator | signup
   → src/lib/billing/entitlements.ts  ← the ONLY writer of Subscription [0.5]
        authorization must be one of:
          free_tier      → plan.priceCents === 0
          admin_grant    → named administrator; invoice left `pending`
          payment        → PaymentVerifier (rejects everything today)
        → one transaction: cancel prior, create subscription, order,
          and an invoice only when money is owed
   → audit log with source + amount
```

## 6. Trust boundaries

| Boundary | Inside | Outside | Enforced by |
|---|---|---|---|
| Anonymous → authenticated | — | internet | session cookie, edge gate |
| Customer A → Customer B | — | same process | `ownerId`/`createdById` filters, `requireConnectionAccess`, `canAccessProject` |
| Unverified → verified | — | same account | verification gate `[0.5]` |
| Customer → control plane | — | customer repo code | **build sandbox `[0.5]`**, scrubbed env, no capability token |
| Control plane → host root | panel process | `helpers/*` via sudo | sudoers allowlist of 21 executables |
| Control plane → agent | panel | network | HMAC + nonce + allowlist + signed task `[0.5]` |
| Tenant → payment state | — | provider | `PaymentVerifier` seam (no provider yet) |

**The privileged-helper boundary is the weakest remaining one.** The control
plane's own user is root-equivalent on its host by design (21 passwordless sudo
entries). Every customer-facing capability that reaches a helper therefore has to
be authorised correctly *before* the helper call, which is why this pass put the
plan-limit and verification checks before helper invocation rather than after.
Removing that boundary (moving helpers behind the agent) is Phase 2 in the master
brief and is **not** done here.

## 7. Deployment topology

| Element | Current |
|---|---|
| Process model | one Node process, `output: "standalone"`, `node .next/standalone/server.js` |
| Port | `127.0.0.1:3051` (`.env.example` `PORT`) |
| Reverse proxy | Caddy (`Caddyfile`) or nginx vhost; both proxy from loopback |
| Database | one SQLite file through the libSQL adapter; single writer |
| Background work | in-process inline worker by default (`DEPLOY_INLINE_WORKER`), plus optional standalone scripts with **no shipped supervision** |
| Static customer sites | HTTP listeners inside the control-plane process |
| CI | GitHub-hosted verify/build; self-hosted runner for preflight/deploy |

Verified only by reading configuration. Nothing here was exercised on a host.

## 8. Architectural inconsistencies (recorded, not fixed)

1. **Two customer dashboard trees** — `src/app/dashboard` (23 pages) and
   `src/app/(dashboard)` (26 pages), overlapping billing/onboarding/settings.
2. **Two execution architectures** — the durable orchestrator path (tested, used
   by 3 call sites) and direct `sudo` helper calls from route handlers (78 sites
   in 40 files). This pass did not add any new direct helper calls and moved
   entitlement writes fully to one module, but did not migrate the helper paths.
3. **Mixed tenancy** — legacy tables key on `ownerId`/`userId`; Cloud Project
   tables key on a project with a membership table; only 8 models carry
   `organizationId`.
4. **Scope dilution** — CRM, marketing, newsletter, industry catalogue, sales
   channels, app centre and "software factory" share the hosting control plane's
   codebase, database and attack surface.

These are architectural, not defects introduced here. Each is named so a later
pass can handle it deliberately rather than by accident.
