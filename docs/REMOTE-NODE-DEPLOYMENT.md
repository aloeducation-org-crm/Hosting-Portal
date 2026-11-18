# Remote Node Deployment — design record (2026-11-12)

## Problem

The central automation engine could build and verify releases **only on the host
running the panel** (`src/lib/deploy/engine.ts`). When a workflow selected an
enrolled compute node, `prepare-deployment` failed honestly with
`NOT_IMPLEMENTED` ("remote release execution is not implemented for this
engine"), and no remote application lifecycle — runtime, proxy, TLS, health
recovery, backup — could run end to end. The fleet therefore had one working
deploy target: the panel host itself.

This document records the design that closes that gap. Everything below is
executed by the central orchestrator through allowlisted node agents; nothing
requires an interactive SSH session per project.

## Architecture

```
┌────────────────────────────┐        signed tasks         ┌──────────────────────────┐
│  Control plane (this app)  │ ──────────────────────────▶ │  ALO Node Agent           │
│  orchestrator + workers    │ ◀────────────────────────── │  (agent/alo-agent.mjs)    │
│  scheduler (capacity)      │        signed results       │   │ sudo, argv-only       │
└────────────┬───────────────┘                             │   ▼
             │ Prisma (deployments, jobs, runs, audits)    │ /usr/local/sbin helpers
             │                                             │   alo-deploy-helper  clone / build-release /
             │                                             │                     marker / switch / rollback
             │                                             │   alo-app-helper     up / down / restart / status (PM2)
             │                                             │   alo-domain-helper  edge fragment (or Caddy)
             │                                             │   alo-ssl-helper     ACME or internal CA + verify-tls
             │                                             │   alo-dns-helper     local JSON zone records
             │                                             │   alo-site-backup    checksummed artifacts
             │                                             │   ▼
             │                                             │  Node runtime kit (deploy/node-kit)
             │                                             │   alo-static-server.mjs (PM2, per site)
             │                                             │   alo-edge.mjs        (PM2, reverse proxy + TLS)
             └─────────────────────────────────────────────┴── /srv/alo-sites/<domain>/releases/<ts>
```

* **Node runtime kit** (`deploy/node-kit/`): one-time install per host. It brings
  the platform's own static server and edge reverse proxy (both plain Node, run
  under PM2 as the unprivileged `alo-panel` user) so a host does not need Caddy,
  nginx or systemd units per site. Hosts that already run Caddy keep using it:
  `alo-domain-helper` prefers Caddy when the binary exists.
* **Process management**: PM2 (already the platform's design for non-systemd
  hosts — `process.list`, `restartExternalService("pm2")`) supervises every
  site process with restart-on-crash. On real Ubuntu hosts the PM2 daemon and
  the edge run under the provided systemd units; on hosts without a systemd bus
  they run as plain supervised daemons.
* **Compute node identity**: an enrolled agent + its site tree. Multiple agents
  may share one physical host (as in the acceptance sandbox); scheduling,
  dispatch, verification and recovery still flow exclusively through the
  selected node's agent.

## Remote release sequence (each stage verified before the next)

1. `deploy.clone` — credential-free `https://` clone of the production branch
   into `/srv/alo-sites/<domain>/releases/<timestamp>`. Nothing is activated.
2. `deploy.build-release` — validated package-manager command inside **that
   release directory** (install / lint / typecheck / test / build), so the live
   `current` release is never touched by a build.
3. `deploy.marker` — verifies the cloned tree's git HEAD equals the pinned
   commit SHA, then writes `alo-deploy.json` (deploymentId + commitSha) into
   the release and hands ownership to the `alo-panel` runtime user.
4. `deploy.switch` — atomic `current` symlink flip to the built release.
5. `app.up` — starts (or updates) the site's supervised process: the platform
   static server for static outputs, `node <startCmd>` for server apps, bound
   to `127.0.0.1:<port>` with `PORT`/`HOST` env.
6. Verification through the same agent: `health.probe` (real HTTP against the
   node's loopback) **and** `deploy.read-marker` (the release identity served
   by the deployed tree). Both must match; an HTTP 200 alone is not success.
7. On failure the previous release is restored (`deploy.rollback`), the process
   is restarted and re-verified, and the deployment is recorded `ROLLED_BACK`.

Domain, DNS and TLS follow in the workflow: `domain.add` (edge/Caddy fragment +
reload + probe), `dns.add`/`dns.verify` (the node's authoritative local zone for
platform-internal domains; public resolvers for real domains),
`ssl.issue` + `ssl.info` + `ssl.verify-tls` (ACME where the CA and DNS are
authorized, otherwise a clearly-labelled internal CA certificate — never a fake
"issued" state).

## Scheduling

`src/lib/orchestrator/scheduler.ts` selects the target node when a project has
no pinned profile: candidates are online, active agents whose capabilities cover
the deployment command set; they are scored by measured capacity (latest
heartbeat metrics: CPU, memory headroom, disk headroom), workload fit, region
preference and existing load (projects already assigned). The score breakdown is
recorded in the deployment log and audit trail — a scheduling decision is
explainable after the fact, not a black box.

## Authorization policy (who may run privileged agent commands)

Gated (`PRIVILEGED`) agent commands remain gated. Two explicit authorization
sources are recognised, both recorded on the agent task row and in the audit
log:

1. **Requester authorization** — a deployment triggered by an authenticated
   actor holding `build:run`, `release:write` and `server:execute` scopes. The
   actor's email is recorded as the approver of the deployment's own activation
   commands (`deploy.switch`, `app.up`). This is propagation of a human's
   explicit deploy request, not a bypass; argument validation, capability
   checks and audit are unchanged.
2. **Recovery policy** — the self-healing workflow's two preapproved, bounded
   verbs (`app.restart`/`service.restart`, `deploy.rollback`) may be
   auto-authorized by `AUTOMATION_AUTONOMOUS_RECOVERY` (default on) because the
   workflow definition itself documents them as the permitted safe recovery
   actions. Every other privileged command still requires a human approval.

DESTRUCTIVE commands (`dns.delete`, restores) are never auto-authorized.
