# Phase 0 — Verified Baseline Audit — ALO Hosting Portal

**Date:** 2026-11-11 (UTC)
**Branch:** `arena/997e5761-hosting-portal` (based on `origin/main` @ `80318b4`)
**Scope:** repository audit + operational-readiness assessment + prioritized roadmap.
**Method:** real command execution in a fresh checkout (Node v22.22.3 / npm 10.9.8), GitHub API reads (PRs, workflow runs, deployments, environments), static scans, and cross-checking existing audit artifacts. **No production host, daemon, DNS, certificate, or provider console was reachable from this workspace** — host-level claims are reported as `REPORTED`, `BLOCKED`, or `NOT VERIFIED`, never as fact. Public-IP and internal-network specifics that appear in committed docs are deliberately not repeated here.

**Honesty legend:** `VERIFIED` = command run in this workspace today proved it · `REPORTED` = owner/prior doc, not re-measurable here · `BLOCKED` = needs credentials/host access this workspace lacks · `NOT VERIFIED` = exists in source, never exercised live · `FAILED` = command/record shows a defect.

---

## 1. Baseline record (as required before any change)

| Item | Value | Evidence |
|---|---|---|
| Current branch | `arena/997e5761-hosting-portal` | `git branch -vv` |
| Current commit SHA | `80318b4b6d3a31c5c1ea849513510b9f70958bbf` | `git rev-parse HEAD` |
| `origin/main` SHA | `80318b4b6d3a31c5c1ea849513510b9f70958bbf` (branch in sync, 0 ahead / 0 behind) | `git fetch --prune` + `rev-list --left-right --count` |
| Uncommitted changes | **none** — working tree clean | `git status` |
| Staged changes | **none** | `git diff --cached` |
| Untracked files | **none** | `git status --porcelain`, `git ls-files --others` |
| `git stash list` | empty | `git stash list` |
| Protected local dirs `aerus-usage-hud/`, `alo-hosting-portal/aerus-usage-hud/` | **absent from this checkout** (documented as expected-untracked on the production host; `.gitignore` and `scripts/host-checkout-status.sh` rules preserved and untouched) | `ls` |
| Open pull requests | **0** | `gh pr list --state open` |
| Recent merged PRs | #30 (2026-11-10, production-HTTPS session fix), #29, #28, #27, #26 … | `gh pr list --state merged` |
| Latest CI run on `main` | run `42906584271` — **success** (~3m12s), jobs: `Lint, typecheck, and tests` success, `Production build` success, `Read-only production preflight` **skipped**, `Deploy … to production server` **skipped** | `gh run list/view` |
| Latest production release SHA (GitHub deployments) | `54e34548f229` — latest status **failure** (2026-10-28T13:46:56Z); five recorded production deployments, all SHA `54e34548…`, last one failed; **no successful GitHub-recorded production deployment since** | `gh api …/deployments` |
| Production-environment protection | `protection_rules: []` (recorded 2026-10-31); required-reviewer API returned **403** for the integration token; release is **manual-only by workflow-level hold** (`release_approval=APPROVED` + `release_ticket` dispatch required) | `docs/MERGE-AND-RELEASE-STATUS-2026-11-02.md`, `docs/SELF-HOSTED-ACCEPTANCE-GATE.md` |
| Current production release SHA (host) | **UNKNOWN** — no host access; release-identity of the live host was never captured from this workspace | `docs/audit/UNVERIFIED-FACTS-AND-ACCESS-BLOCKERS.md` U-18 |
| Tracked `db/custom.db` | byte-identical to `HEAD` (`git diff --exit-code` clean) | verified today |
| Tracked files / archive | 1,333 tracked files; 435 under `archive/retired-2026-11-09/` (verbatim no-loss snapshot); 6.5 MB | `git ls-files` |

---

## 2. Verification runs performed today (2026-11-11)

| Gate | Result | Evidence |
|---|---|---|
| `npm ci --no-audit --no-fund` | **PASS** (exit 0) | fresh install |
| `npm run typecheck` (`tsc --noEmit`) | **PASS** (exit 0) | |
| `npm run lint` (`eslint src/`) | **PASS** (exit 0) | |
| `npm test` (vitest) | **PASS — 64 files / 990 tests / 0 failures** (~78 s) | |
| `npm run build` (Next.js 16.4.3 Turbopack) | **PASS — exit 0, 222/222 static pages, standalone output** | |
| `npm run audit:repo` | **PASS — 17/17** (after build; 16/17 before `.next` existed — the one failure was the pre-build absence of generated `.next/types`, not a source defect) | |
| `npm run config:validate` (no production env) | **fail-closed, expected** — reports unset secrets as `not-configured`, no fabricated defaults | |
| `npm audit` | last recorded **0** known advisories (2026-11-10 re-audit); not re-asserted today beyond install success | `AUDIT-REPORT-FINAL.md` |

**Bottom line: source, tests, types, lint, build and repo-audit gates are green on this branch. No host-dependent capability is verified by this.** A green build is not a production release, and CI being green is not approval to deploy — the manual-only release hold remains in force.

---

## 3. What the platform actually is today

An honest capability map against the target architecture (Components A–E):

### Component A — Control Plane (this application) — **IMPLEMENTED (code), NOT PRODUCTION-VERIFIED**
- Next.js 16 / React 19 / TypeScript; App Router; standalone output; security headers incl. enforcing CSP + report-only CSP; `poweredByHeader` off.
- Auth: NextAuth v4 (credentials + Google/GitHub OAuth), MFA (`otpauth`), RBAC (`UserRole` SUPER_ADMIN…VIEWER + granular `Permission` catalogue, `Role`/`Organization`/`Team`/`Membership`), CSRF origin checks, rate limiting, lockout, audit logs (`AuditLog`, `db-audit`), session cookies hardened.
- Domain models for the full commercial surface exist in Prisma (**119 models**): organizations/tenants, projects, sites, deployments, releases, domains, certificates, databases, buckets, plans, subscriptions, invoices, usage events, support tickets, agents, operation jobs, audit logs.
- Admin surfaces exist: `(admin)` route group (audit, plans, servers, users) + `/dashboard/*`; customer dashboard `(dashboard)` with apps, billing, databases, domains, monitoring, infrastructure, AI modules.
- Multi-tenancy: org/project scoping consistently enforced in code and asserted by security/IDOR test suites — **but no independent penetration test or full cross-tenant sweep has been evidenced**.

### Component B — AI Orchestration Engine — **IMPLEMENTED (code), NOT LIVE-VERIFIED**
- Ordered OpenAI-compatible provider chain with failover, retries, circuit breaker, SSRF/redirect guards (`src/lib/ai/providers.ts`); AI routes return `503 AI_NOT_CONFIGURED` when no provider is reachable — no fake answers.
- AI workflows (`/api/ai/workflows/*`) with graph validation, run history, token usage accounting; capability-request governance; code-change proposal admission (`REQUIRES_APPROVAL`, `executable: false` by design); deploy-assistant; domain advisor; framework-aware deployment planning.
- **No AI provider call has been verified from this workspace**; provider chain health is unproven. AI is proposal-only; there is no autonomous infrastructure mutation, which is correct and must remain policy-gated.

### Component C — Job Orchestrator — **IMPLEMENTED (code + tests), NEVER EXECUTED ON A REAL HOST**
- `operation_jobs` durable table: idempotency keys, conditional-claim leases, per-`lockKey` serialization, exponential backoff, `DEAD_LETTER`, `WAITING_APPROVAL` gates, approval TTL, full audit.
- 10 typed workers (repo discovery → … → backup/restore); allowlisted, argv-only execution; cancel/requeue/approve APIs; 32+ orchestrator tests green.
- **Limits:** single-process in-app execution (no separate worker fleet); in-memory `lockKey` serialization is per-process only; multi-process contention, kill/restart, lease-expiry and reboot drills **NOT TESTED**; not deployed anywhere.

### Component D — Node Agent — **IMPLEMENTED (code + tests), ZERO NODES ENROLLED**
- `agent/alo-agent.mjs` v1.2.0: zero-dependency, enrollment tokens (short-lived), HMAC-signed heartbeats with nonce replay protection, hardware inventory (`/proc`, `df`, `os`), task polling, argv-only allowlisted commands (compiled-in copy mirrored by `src/lib/agents/allowlist.ts`), redaction, loopback/private-only egress.
- Install path: `scripts/install-agent.sh` (`--dry-run` tested); enrollment design: `docs/design/PHASE2_AGENT_ENROLLMENT.md`.
- **Reality:** no server (A/B/C/D) has ever been enrolled from this workspace; no heartbeat, inventory, or task execution has been observed on a real host. **Hardware inventory of all three known machines is REPORTED-only.**

### Component E — Infrastructure Engine — **PARTIAL: single-host helpers exist; KVM/libvirt does not exist at all**
- 22 privileged bash helpers in `helpers/` (site lifecycle, SSL, database, firewall, docker, backup/restore, DNS, email, file-manager, log, encryption, ssh) + `deploy/server-kit/` staged Ubuntu scripts + `scripts/deploy-*.{sh,mjs}` pipeline; Caddyfile; nginx vhost; sudoers policies; systemd units; Dockerfile (non-root, read-only, cap-dropped) + compose.
- **KVM/QEMU/libvirt/cloud-init: nothing.** No VPS provisioning code, no VM templates, no virtual network, no snapshot logic — only marketing copy (retired/redirected) and a hardware-sizing heuristic (`hardware-sizing.ts`).
- Docker exists in CI-shaped config and compose, but **no Docker build/run has been executed in this workspace** (no docker daemon), and Docker is (correctly) not a VPS substitute.

### Database (control plane) — **SQLite / libSQL, single-file, proven locally**
- Prisma 6.19.3, `provider = "sqlite"`, `engineType = "client"`, `@prisma/adapter-libsql`; **119 models, 15 migrations** (+`0_init`); `db/custom.db` is a tracked **development fixture** (random seeded credentials), not production.
- Production DB documented at `/var/lib/alo-hosting/alo.db`; additive applier `scripts/apply-deploy-schema.mjs` (refuses relative paths; `--allow-rebuild --backup` required for rebuilds); **never applied to production in this workspace; production schema/data volume NOT VERIFIED.**
- Customer-database provisioning: `SQLITE_ISOLATED` (per-project SQLite, works locally) and `MARIADB`/`POSTGRESQL` via enrolled `alo-database-helper` agents — honestly reports `REQUIRES_INFRASTRUCTURE` with no database host enrolled. **No MySQL/MariaDB/PostgreSQL server is currently provisioned anywhere we can verify.**
- **PostgreSQL for the control plane: not adopted.** A client generated for SQLite cannot open `postgresql://…`; migration would require provider change, migration rehearsal, backup, and an approved maintenance window. Evaluate in Phase 1/4 — do not assume.
- Backups: `scripts/db-backup.mjs` / `db-restore.mjs` / `backup.sh` exist; **no backup has been produced or restored by this workspace; RPO/RTO undefined.**

### Billing & commerce — **SCHEMA + UI PRESENT, NEVER RUN AGAINST A REAL PAYMENT PROVIDER**
- `Plan` (Starter/Business/Enterprise seeded), `Subscription`, `Invoice`, `InvoiceItem`?, usage aggregation, Stripe client via raw `fetch` (`src/lib/stripe.ts`, enabled only when `STRIPE_SECRET_KEY` starts with `sk_`), webhook route, suspension-related status fields.
- Seeded plan feature claims ("10 Managed databases", "Automated daily backups", "Free Cloudflare SSL") are **not all operationally true**; storefront is retired and storefront URLs redirect to the projects showcase in `next.config.ts`.
- **The `/hosting/vps` marketing page and `hosting-catalog.ts` still describe KVM VPSs (dedicated vCPUs, DDR5, "AMD EPYC", "10 Gbps", "12 regions", "provisioned in under a minute", prices from $4.99) that no owned infrastructure can deliver.** They are unreachable through the public site today (redirects), but the content and plans remain in the tree and must be retired or re-labeled "planned / not available" before any commercial reactivation.

### Public site — **projects showcase (storefront retired)**
- `/`, `/projects`, `/projects/[slug]` showcase internal projects; `/pricing`, `/hosting/*`, `/domains`, `/email`, `/ssl` redirect (non-permanent) to the showcase. `GET /api/marketing/domain-check` (real RDAP) remains. This is the correct current posture and must not be quietly reversed.

---

## 4. Infrastructure (office-first) — verified status

| Asset | Claimed (owner reports, 2026-10-29…) | Verified today | Notes |
|---|---|---|---|
| **Server A — office laptop** HP ZBook Firefly 14 G7, i5-10310U, ~15–16 GB RAM, NVMe, Ubuntu 22.04.5, Tailscale | REPORTED | **NOT VERIFIED** — no route from this workspace | Single office failure domain with B (power + ISP). `/mnt` LVM: ~374 GB unallocated PV — **not usable without an approved LVM change**. Good candidate for: control-plane standby, monitoring, build worker — after measurement. |
| **Server B — office desktop** Core2 Duo E7500, ~8 GB RAM, 120 GB SSD + 520 GB HDD, Ubuntu 22.04.5 | REPORTED | **NOT VERIFIED** — same blocker | 2009-era 2-core CPU. ~99.6 % CPU snapshot unverified; `/mnt/ssd2` (~26 MB used / 117 GB) suspected **unmounted** — `findmnt` required before trust. Suitable **only** for monitoring/utility/staging, not customer workloads, not the control plane of record. |
| **Server C — cloud server (Hostinger)** ~4 vCPU / 4 GB / 100 GB | REPORTED | **NOT VERIFIED** — tier unclear (shared plan vs VPS) | Shared-plan ceilings (≈200 processes / inode limits) would forbid isolated build daemons. **Hosting target of `hosting.alolabs.net` is claimed but untraced.** |
| **Server D — cPanel host** | REPORTED | **NOT VERIFIED** | Reported for mail (aloeducation.com). Unknown quotas. |
| **Carnival public IPv4** | purchased | **NOT VERIFIED** — static/dynamic? CGNAT? upstream NAT? directly on router WAN? inbound 80/443? IPv6? additional IPv4 availability? | **Every public-serving plan is blocked on these answers.** Do not open ports or publish DNS until answered. |
| **Tailscale** | on Server A | REPORTED | WireGuard (UDP 51820) "if configured" — not configured/verified. |
| **KVM capability** | unknown | **NOT VERIFIED anywhere** | No `/dev/kvm` in this workspace; A (i5-10310U) very likely has VT-x but IOMMU/nested/thermal/availability unproven; B (E7500) VT-x yes but inadequate. **No VPS sale is possible until a dedicated KVM-capable host is verified.** |

**Single failure domain warning:** A and B share office power and ISP; C is one cloud account/plan. No verified offsite backup, no tested restore, no standby exists. Nothing measured supports "500 concurrent users" — that number is **not** a current capability and must not appear in customer-facing claims.

**Mapping to the required network architecture:**

```
Internet → Carnival Public IPv4 → Office Router/Firewall → ALO Reverse Proxy (Caddy/nginx)
        → Private Office Network → Control Plane + Compute Nodes
```

…is **designed but not built**: no router WAN check vs `https://api.ipify.org` has been performed, no port-forwarding confirmed, no reverse proxy deployed or verified on the public path, no DNS/TLS for production cutover verified from this workspace, and Server C's actual role (production host? separate?) is untraced.

---

## 5. Security posture

**Strong (implemented + test-evidenced):**
fail-closed env validation (no default secrets); AES-256-GCM sealing for env/DB secrets with `enc:v1:` envelopes; SHA-256 digests for API keys; HMAC + nonce-replay-protected agent protocol; argv-only allowlists (agent-side copy is the enforcement point); RBAC + org scoping; CSRF (origin-less mutations blocked); rate limiting; MFA (TOTP); audit logging for privileged ops; CSP (enforcing + report-only), HSTS, frame/ancestor/content-type/referrer/permissions headers; `X-Powered-By` removed; SSRF/DNS-rebinding connection-time guard with IP pinning; log redaction; non-root read-only container shape (`cap_drop: ALL`, `read_only: true`, `no-new-privileges`, tmpfs, pids/mem limits); CI **manual-only release hold** (push ≠ deploy); release guard scripts with ancestry/signature/payload-digest checks; rollback requires explicit attributable dispatch.

**Gaps and risks:**
1. **Production human-approval control is not enforced by GitHub today** — `production` environment has zero protection rules and the token got 403 adding one; the workflow-level `release_approval` hold is the only barrier. An administrator must add required reviewers + `main` branch protection (outside this workspace's rights).
2. **No independent penetration test**, no repository-history secret scan evidence, no deployed TLS/firewall assessment. Historical credential literals exist in the archive (already redacted/rotated per 2026-11-10 re-audit) but remain in git history.
3. **`SERVER-SPEC.md` commits the production host's IP and internal port map into the repository.** Redact and move to operator-only storage (owner decision required — not changed silently in this pass).
4. **Archived legacy DB snapshot** (`archive/retired-2026-11-09/alo-hosting-portal/db/custom.db`) remains in git with rotated hashes; acceptable for fixture parity, but treat the archive as sensitive and keep it out of any production artifact (already excluded from standalone tracing).
5. **SSH host-key verification, sudoers policy breadth, build isolation (prlimit/namespace), and proxy trust** are implemented in places but none have been adversarially exercised on a real host.
6. **Release SHA of the running production service is unknown**; the last GitHub-recorded production deployment **failed** (2026-10-28). Whether an older, manually deployed build currently serves `hosting.alolabs.net` — and which SHA — is unverified.
7. **Queued production deploy from 2026-10-27** (documented as pending runner pickup) should be confirmed cancelled/superseded by a repository administrator.
8. In-memory rate limiting/locks lose state on restart and do not span replicas (Redis optional via `REDIS_URL`, unverified).
9. `.env.example` is clean (no literal secrets) — verified.

---

## 6. Missing capabilities vs. the master brief (honest inventory)

| Brief capability | Status |
|---|---|
| Detect framework/runtime/build/start commands (static, React, Next.js, Node/Express, Python/FastAPI/Django, PHP/Laravel/WordPress, Go, Java) | **PARTIAL** — detector covers static/Node/Next/PHP-class manifests well; Go/Java/Django/Laravel/WordPress detection is shallow-to-absent; ambiguity handling unproven on real repos |
| Provision DB only when required | **IMPLEMENTED (logic)** — executor reports `REQUIRES_INFRASTRUCTURE` honestly; nothing can actually provision until a database host is enrolled |
| Build + test + deploy + domain + SSL + monitor + logs + backups + rollback + diagnosis | **PARTIAL** — pipeline, release-guard, rollback, logs, history exist and are unit-tested; SSL/DNS/domain verification, monitoring with real alert delivery, and backup/restore are **never exercised**; failure diagnosis is manual |
| Preview deployments | **NOT IMPLEMENTED** (PR previews recorded and ignored per roadmap) |
| Auto-deploy on push | **IMPLEMENTED** (HMAC webhook, dedup, queue) — never fired from a real GitHub App against a real host in this workspace |
| Immutable release artifacts | **PARTIAL** — exact-SHA releases + symlink activation; artifact **storage** is host-local only, no registry/object store |
| AI-assisted operational support | **PARTIAL** — proposal-only tooling; no closed-loop diagnosis → approved action → verification |
| VPS: create/delete/CPU/RAM/disk/OS/SSH keys/root/network/firewall/console/monitoring/snapshots/backups/IP mgmt/billing/limits | **NOT IMPLEMENTED — 0%** |
| KVM/QEMU/libvirt/cloud-init | **NOT IMPLEMENTED — 0%** |
| Object storage (S3-compatible) | **NOT IMPLEMENTED** — local filesystem storage pools only (`resolveWithinRoot`), no S3 SDK/integration |
| Backup to **separate** storage + encryption + restore verification | **NOT EXECUTED** — scripts exist; untested; no offsite target designated |
| Distributed job execution / multiple compute nodes | **NOT IMPLEMENTED** — single-process orchestrator |
| Active Control Plane + tested standby + leader scheduler | **NOT IMPLEMENTED** — single instance; no standby; no leader election |
| 500 concurrent dashboard users | **NOT SUPPORTED / NOT MEASURED** — SQLite single-file writer + single host |
| Billing: plans, invoices, usage, overage, suspension, notifications | **PARTIAL** — schema/UI/Stripe-fetch client exist; never run against Stripe; suspension automation and proration/overage policy unimplemented; usage metering unverified |
| Super-admin: node registry, approve enrollment, capacity limits, workload assignment, sensitive-op approval, security alerts | **PARTIAL** — agent enrollment + approval gates exist in API/UI foundation; no real node to register; capacity limits/assignment unenforced |
| Monitoring/alerting: heartbeat, CPU/RAM/disk/network, SSL expiry, backup status, failure alerts | **PARTIAL (code)** — routes + honesty tests exist; no live agent → no real metrics; alert delivery provider unverified; no on-call path |
| Support tickets + AI support + diagnostic reports | **PARTIAL** — tickets model/API exist; AI support not closed-loop |
| Multi-region / 12 datacenters / "under a minute provisioning" | **NOT POSSIBLE** — must never be claimed |

---

## 7. Ranked risk register

**R1 — Selling or implying undeliverable services.** KVM VPS catalogue (AMD EPYC/DDR5/10 Gbps/12 regions, $4.99 entry) and plan side-effects ("Automated daily backups", "Managed databases") exceed real infrastructure. Storefront currently redirected — **do not reactivate** until §9 gates pass. *Probability: medium (catalogue remains in tree). Impact: severe (refunds, legal, trust).*

**R2 — Production state is untracked and possibly broken.** Last GitHub production deployment failed (2026-10-28); manual-only hold since 2026-11-02; live SHA unknown; queued 2026-10-27 deploy possibly outstanding. Any "deploy" without host verification could corrupt a working manual site. *Impact: severe.*

**R3 — Zero verified backups / restore.** Single control-plane SQLite file holds all customer/control data; no drill performed; no offsite copy known. *Impact: catastrophic on disk failure.*

**R4 — Single failure domains everywhere.** Office power/ISP shared by A+B; C is one shared plan; no standby; no failover; no capacity headroom measured.

**R5 — Public entry point unknown.** Carnival IP arrangement (static? CGNAT? forwarding? 80/443 open?) unverified — any attempt to expose services now is blind.

**R6 — Tenant isolation unproven at runtime.** Strong code-level controls, zero live multi-tenant adversarial testing; SSRF/egress guard unexercised against real network.

**R7 — Approval chain bypass.** No required reviewers on `production` environment; protection unreadable (403); an errant `workflow_dispatch release_approval=APPROVED` from a maintainer token would deploy without independent review.

**R8 — Credential & data hygiene.** History contains rotated-but-present credential material; SERVER-SPEC.md publishes host fingerprint; seed/dev fixture is fine but must never ship in a production image (it doesn't — compose uses `/var/lib/alo-hosting/alo.db`).

**R9 — Observability vacuum.** No live metrics, no alerting channel proven, no SLO/RPO/RTO. Recovery would be improvised.

**R10 — Documentation drift.** Many `docs/` reports are point-in-time; some figures (file counts, test counts, server specs) are stale; AGENTS reading them cold could act on obsolete claims. Keep this Phase 0 report authoritative for the audit state; mark superseded docs.

**R11 — AI 503 silence.** No provider configured/verified — "AI features" presented in UI will no-op; needs explicit degraded-mode UX and an operator runbook.

**R12 — Database growth & migration risk.** 15 additive migrations; production parity unproven; a rebuild migration without backup could wedge the control plane.

---

## 8. Prioritized implementation roadmap

Legend: **P0** = do now (this PR) · **P1** = next, after approval · **P2** = requires host/infra access · **P3** = requires commercial/hardware decisions · ⌂ = office-infra dependent.

### Phase 0 — Baseline (THIS REPORT)
- Record verified state (done); no code/infrastructure changes beyond this document; open PR; **wait for approval**. ⌂ none.

### Phase 1 — Architecture foundation (code + docs; no hosts required)
1. **Control-plane HA design doc**: single-writer DB, active control plane + standby, leader-elected scheduler (DB lease on `operation_jobs`), failover runbook.
2. **PostgreSQL evaluation for the control plane** — evidence-based: read/write contention of libSQL vs Postgres, migration rehearsal against a scratch copy of production-like data, cutover/rollback plan. Decide with a measured spike, not a preference. (If SQLite remains: WAL + file-lock discipline + rigorous single-writer enforcement, and explicit "not for 500 users" labeling.)
3. **Tenant/RBAC hardening**: complete permission matrix test across every route; cross-tenant IDOR sweep automation; MFA-enforcement policy for admins.
4. **Release/audit integrity**: single `release-identity.json` contract; deploy freeze procedure; signed audit export.
5. **Repository hygiene**: redact IP/port map from `SERVER-SPEC.md` (move to operator vault); annotate stale audit docs as superseded by this report; keep `archive/` sealed.
6. **CI**: add Docker image build job (no push) so the non-root container shape is proven in CI; keep manual-only production hold; request branch protection + required reviewers (admin action).

### Phase 2 — Node Agent (needs read-only host access) ⌂
1. SSH read-only verification of A/B/C/D: `uname -a`, `/etc/os-release`, `lscpu`, `free -b`, `df -hT`, `findmnt`, `ss -lntup`, `systemctl --failed`, LVM layout; record vs REPORTED values (incl. the `/mnt/ssd2` mount question).
2. Enroll **Server A** as the first node (`scripts/install-agent.sh`), verify heartbeat/inventory/allowlist refusal; enroll **B** in monitoring-only mode.
3. Enrollment token custody, rotation, expiry; disablement drill for a compromised node.

### Phase 3 — Managed application hosting (own projects first) ⌂
1. Stand up **one dedicated worker** (external KVM-capable VPS recommended; if denied, Server A with strict limits as interim) for untrusted builds; `prlimit` + namespace isolation; no control-plane secrets in build env.
2. Deploy **ALO's own projects** (e.g., aloeducation internal apps) through the full path: repo → detect → build → symlink release → Caddy/nginx → TLS → health gate → monitoring → rollback drill.
3. Close pipeline gaps: Go/Java/Python(Django/FastAPI)/PHP detection; PR **preview deployments**; deployment cancellation UX; failure-diagnosis loop (logs → classified error → suggested fix → human-approved action).
4. Backup/restore drill for releases + DB; publish measured RPO/RTO.

### Phase 4 — Database & storage ⌂
1. Designate a **database host** (Server A v. dedicated worker v. managed) — install MariaDB/PostgreSQL only there; wire `alo-database-helper` end-to-end with provisioning tests; least-privilege grants; automated dumps to **separate** storage with SHA-256 verification and a **restore rehearsal**.
2. S3-compatible object storage evaluation (MinIO on A/dedicated vs provider) for backups/artifacts/buckets; encryption at rest; retention policies.
3. Storage quotas + usage monitoring; per-tenant limits enforced at write time.

### Phase 5 — AI operations ⌂
1. Configure a **real provider** (self-hosted Ollama on an appropriately sized host, or approved cloud API) + verify `GET /api/ai/status?probe=1`.
2. Wire AI diagnosis into deployment failures: classified failure → allowlisted remediation proposal → `WAITING_APPROVAL` gate → execution → post-action verification → audit. AI never executes unrestricted shell — keep proposal/approve/execute split.
3. Capacity recommendation agent fed by real node metrics (post Phase 2/8).

### Phase 6 — Office infrastructure (public entry) ⌂ — **prerequisite for any public traffic**
1. Carnival IP fact-finding (static? CGNAT? forwarding? IPv6? more IPv4s?) + `curl -4 https://api.ipify.org` comparison — **owner/counsel action**.
2. Router/firewall: forward only 80/443 (+22 restricted, +51820/UDP if WireGuard); fail2ban; unattended security updates; disable password SSH.
3. Caddy or nginx as the **single** reverse proxy; per-site vhosts; TLS via ACME; HTTP→HTTPS; HSTS; per-vhost access logs; proxy for `hosting.alolabs.net` → control plane on `127.0.0.1:3051`-equivalent.
4. DNS/TLS cutover plan with rollback (restore prior A record; keep old vhost) — **only after** staging rehearsal on a disposable domain.
5. Monitoring: node_exporter-class metrics or agent heartbeats → alert rules (node offline, disk >85 %, RAM/CPU sustained, SSL <14 d, backup failure, deploy failure ×3) → tested delivery to a real channel (email/Slack).

### Phase 7 — VPS hosting ⌂ — **not before Phases 2, 4, 6 and dedicated KVM hardware**
1. Hardware gate: a verified KVM-capable host (VT-x/AMD-V, sufficient RAM/NVMe, IOMMU preferred, independent power/ISP). **Neither A, B nor C qualifies today as a customer-VPS host.** Server B may serve a KVM **lab** only after capacity proof.
2. Implement KVM/QEMU/libvirt/cloud-init subsystem: templates (Ubuntu/Debian), isolated NAT + routed-IPv6 networks, port-mapped shared-IPv4 tenancy, per-VM firewall, console (VNC/SPICE via proxy auth), snapshots/backups, IPAM, bandwidth accounting, usage-based billing meters, quota enforcement.
3. Verify: create → boot → SSH → snapshot → restore → delete on disposable VMs; never on production or customer data.
4. **Do not publish a single VPS price/spec until one reference VM passes the full lifecycle drill.** Retire or re-label the existing catalogue in the same change that gates billing to verified capacity.

### Phase 8 — Distributed reliability ⌂
1. Standby control plane (Server B if measured adequate, else A) + replicated/scheduled DB backup streaming; single-writer enforcement; leader election; failover runbook + **timed drill**.
2. Workload rescheduling on node failure (jobs re-queued via lease expiry); unhealthy-node isolation; capacity-aware assignment; node draining.
3. Load testing: **separately** 500 concurrent dashboard users (read-heavy) vs simultaneous deploys (write-heavy); publish measured ceilings; set rate limits from evidence; soak test.

### Phase 9 — Commercial launch ⌂
1. Stripe live mode in staging with real test cards; subscription lifecycle (upgrade/downgrade/proration/cancel), invoice finalization, webhook idempotency, suspension/grace-period automation, dunning notifications.
2. Plans rewritten to **only** what infrastructure delivers; quotas enforced in code per tenant; overage policy; status page; support-ticket SLAs; AI support deflection with human escalation.
3. Launch checklist: legal (ToS/Privacy/AUP), refund policy, data-processing terms, incident response, backup RPO/RTO published, monitoring/alerting proven, on-call, and **explicit owner go/no-go**.

**Critical path:** 1 → 2 → 6 → 3 → 4 → 8 → 9. Phase 7 is deliberately gated behind dedicated hardware and is **not** on the critical path to first revenue from managed application hosting.

---

## 9. Explicit go / no-go gates

| Claim/action | Gate |
|---|---|
| "Hosting portal is live in production at SHA X" | Host reports `release-identity.json` == approved SHA + external HTTP probe passes |
| "Backups exist and restore" | One full restore rehearsal into a scratch target, evidenced |
| "Server A/B/C specifications are …" | One read-only SSH session per host, recorded |
| "500 concurrent users supported" | Measured load test report |
| "VPS is available for purchase" | KVM host verified + lifecycle drill passed + capacity published |
| "AI operates the infrastructure" | Closed-loop drill: propose → approve → execute → verify, on a disposable target |
| Production deploy of any kind | Explicit owner approval + working rollback path + verified pre-deploy backup |

---

## 10. Known limitations of this audit

- No network path to production or office hosts (workspace egress limited to package registries/GitHub); **all host-level statements are unverified by construction**.
- `npm audit` not re-run with `--json` today (install log clean; last recorded 2026-11-10: 0 advisories).
- The build's success proves compilation and prerendering, not runtime health; no browser E2E was executed.
- GitHub API reads are point-in-time; deployment records may lag manual reality either way.
- Document figures from `docs/` dated earlier than 2026-11-10 are historical and partially superseded by this report.

## 11. Immediate next actions (require approval)

1. **Review & merge this audit PR** (docs only; zero runtime change).
2. **Owner answers the §12 questions** (they gate Phases 2/6).
3. **Administrator actions (outside repo):** cancel/confirm the stale 2026-10-27 queued deploy; add required reviewers to `production`; protect `main`; confirm current production SHA on the host; confirm the Carnival IP facts.
4. **Approve Phase 1 scope** (control-plane HA + PostgreSQL spike + permission-matrix tests + SERVER-SPEC redaction + CI docker-build job) as the next implementation PR.

## 12. Questions for the owner

1. Which host actually serves `hosting.alolabs.net` today, and what SHA? (or authorize a read-only SSH session to capture it)
2. Carnival public IPv4: static or dynamic? Routed/16-bit? directly on router WAN, or upstream NAT/CGNAT? Can Carnival sell more IPv4 or routed subnet? Is IPv6 available on the connection?
3. Are inbound TCP/80 and TCP/443 currently permitted and forwardable to the office network?
4. Is there willingness to place a **dedicated external KVM VPS** (recommended for customer workloads/builds) — or must everything run on office hardware for now?
5. Backup destination of record: local disk on a separate machine, or S3-compatible object storage (which provider)?
6. Approved maintenance window + approval chain for (a) production release, (b) control-plane DB strategy change (SQLite→Postgres spike), (c) DNS/TLS cutover?
7. Should `SERVER-SPEC.md` (IP/port map) be redacted in-repo and moved to an operator-only location?
8. Billing: which Stripe account/mode is authoritative, and who approves suspension/dunning policy?

---

*Prepared as the Phase 0 deliverable of the ALO Hosting Portal master brief. No production deployment, migration, restart, DNS, firewall, or destructive database action was performed or authorized by this document.*
