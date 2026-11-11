# Phase 0 — Independent Re-Audit — ALO Hosting Portal

**Date:** 2026-11-11 (UTC)
**Branch:** `arena/30b1a218-hosting-portal` @ `e8ab07467d9a3a90e3bc40a04588ea87d1f2cb03`
**Base:** `origin/main` @ `e8ab074` (merge of PR #31)
**Author role:** Principal Cloud Architect / DevOps / Security / Backend / SaaS Product
**Status of this document:** audit + one security fix. **No production action, no migration, no deploy.**

---

## 0. Why a second Phase 0 document exists

`docs/PHASE-0-VERIFIED-BASELINE-2026-11-11.md` was merged hours ago in PR #31. It is a good
document and this one does **not** overwrite it. It exists because a baseline that is inherited
unverified is not a baseline. Three things differed when the claims were re-run today:

| Claim in the merged baseline | Re-measured today | Verdict |
|---|---|---|
| `npm test` → **990** tests | **996** tests (65 files) | stale count |
| `npm run build` → **222** static pages | **224** static pages | stale count |
| 119 models / 15 migrations | 119 models / 16 migration dirs incl. `0_init` | consistent |
| Source + tests + lint + type + build + repo-audit green | **all green, independently re-run** | confirmed |
| Agent protocol HMAC + nonce replay protection | **read and confirmed in code** | confirmed |
| VPS/KVM = 0% implemented | **confirmed by independent scan** | confirmed |
| `aerus-usage-hud/` dirs absent, protection preserved | **confirmed absent; rules intact** | confirmed |

The two counts are the least interesting difference and the most instructive: **documentation in
this repository drifts within hours.** Any figure below is dated and reproducible by command.

Six findings in §4 are **new** — absent from the merged baseline. One (§4.1) is live-reachable.

---

## 1. Baseline record (recorded before any change, per brief §4)

| Item | Value | Evidence |
|---|---|---|
| Current branch | `arena/30b1a218-hosting-portal` | `git branch --show-current` |
| Current commit SHA | `e8ab07467d9a3a90e3bc40a04588ea87d1f2cb03` | `git rev-parse HEAD` |
| Remote | `origin` → `github.com/aloeducation-org-crm/Hosting-Portal.git` | `git remote -v` |
| Upstream tracking | **none set** for this branch | `rev-parse @{u}` |
| Uncommitted changes | **none** | `git status --porcelain` |
| Staged changes | **none** | `git diff --cached` |
| Untracked files | **none** | `git status --porcelain` |
| Open pull requests | **0** | `gh pr list --state open` |
| Latest CI on `main` | run `42961431963` — **success** (~3m16s) | `gh run list` |
| Latest PR CI (#31) | run `42955353772` — verify **pass**, build **pass**, preflight **skipped**, deploy **skipped** | `gh pr checks 31` |
| Production env protection | `protection_rules: []`; deploy gated only by workflow-level `release_approval=APPROVED` + `release_ticket` | `docs/MERGE-AND-RELEASE-STATUS-2026-11-02.md`, workflow `ci-cd.yml` |
| Current production release SHA | **UNKNOWN** — no host access from this workspace | not measurable here |
| Local git object store | **shallow**, depth 1 (`.git/shallow` = `e8ab074`) | `git rev-list --count HEAD` → 1 |
| Preserved local dirs | `aerus-usage-hud/`, `alo-hosting-portal/aerus-usage-hud/` — **absent from this checkout**; `.gitignore` rules (lines 82–83) and `scripts/host-checkout-status.sh` toleration logic **untouched** | `ls`, `grep` |
| Tracked fixture DB | `db/custom.db`, 2,588,672 bytes, **119 tables, 3 users** | libsql query |

**Non-destructive rules honoured:** no `reset --hard`, no `clean -fd`, no file deleted, no
migration run, nothing deployed, no service restarted, no force-push.

---

## 2. Verification gates re-run today (not inherited)

Executed in a fresh clone, Node v22.22.3 / npm 10.9.8, Linux x86_64. `prisma generate` was run
via the repository's own `db:generate` script, which stubs the query-engine download — the plain
`npx prisma generate` cannot reach `binaries.prisma.sh` from this sandbox and is **not** a defect.

| Gate | Result |
|---|---|
| `npm ci --include=dev` | **PASS** |
| `npm run db:generate` | **PASS** (client v6.19.3) |
| `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| `npm run lint` (`eslint src/`) | **PASS** |
| `npm test` (vitest) | **PASS — 65 files / 996 tests / 0 failures** (~62 s) — *before this PR* |
| `npm test` (vitest) | **PASS — 66 files / 1005 tests / 0 failures** — *after this PR (+9 regression tests)* |
| `npm run build` (Next 16, standalone) | **PASS — 224/224 pages** (before and after) |
| `npm run audit:repo` | **PASS — 17/17 checks** (before and after) |
| `npm audit` | **0 vulnerabilities** (0 low / 0 moderate / 0 high / 0 critical) |
| `bash scripts/install-agent.sh --dry-run` | **PASS** — `writesPerformed: false`, correct host detection, docker correctly reported absent |

Environmental facts (this sandbox, **not** a claim about your servers): 2 vCPU / 3.8 GB,
kernel 6.1, **no `/dev/kvm`**, **no virtualization flags**, **no docker daemon**.

**A green build proves compilation and prerendering. It does not prove runtime health, and CI
being green is not approval to deploy.** The manual-only release hold remains in force.

---

## 3. What the platform verifiably is

Scale, measured: **586 TS/TSX modules, 107,236 lines under `src/`, 250 API routes, 79 pages**,
119 Prisma models, 27 allowlisted agent commands, 22 privileged bash helpers.

| Component (brief §7) | Real status |
|---|---|
| **A. Control Plane** | **IMPLEMENTED / not production-verified.** 250 routes; 217 carry an auth guard (`requireSuperAdmin` / `requireAdmin` / `requireSession` / `getToken` / `auth()`). The remaining 33 are public **by design** and each was checked: agent enroll (token-as-auth + 10/10min IP rate limit), agent heartbeat/claim/result (HMAC), NextAuth handlers, health, csrf, GitHub webhook (HMAC), CRM internal routes (**scoped service credentials** via `requireServiceAuth`), cloud object GET (**HMAC-signed or session actor**, `timingSafeEqual`, ±1 h expiry window). **No unauthenticated route was found that should have been authenticated.** |
| **B. AI Orchestration** | **IMPLEMENTED / provider unverified.** Ordered failover chain, circuit breaker, SSRF guard, `503 AI_NOT_CONFIGURED` instead of fake answers. Correctly proposal-only. |
| **C. Job Orchestrator** | **IMPLEMENTED / never run on a real host.** 10 typed workers, idempotency keys, conditional-claim leases, backoff, `DEAD_LETTER`, `WAITING_APPROVAL`. **Single-process**: the `lockKey` serialization is in-memory and per-process; no worker fleet. |
| **D. Node Agent** | **IMPLEMENTED / zero nodes enrolled.** `agent/alo-agent.mjs`, zero-dependency. Verified in code: HMAC over `timestamp.nonce.sha256(body)`, ±skew window, **atomic single-use nonce via unique index** (concurrent replays race on insert, not read-then-write), single-use expiring enrollment tokens, 27 argv-only allowlisted commands. **No heartbeat from any real host has ever been observed from this workspace.** |
| **E. Infrastructure Engine** | **PARTIAL, host-side only.** Helpers, `deploy/server-kit`, Caddyfile, nginx vhost, systemd, Dockerfile (non-root, `cap_drop: ALL`, `read_only`, tmpfs, pids/mem limits). **KVM/QEMU/libvirt/cloud-init: 0 lines. Zero VPS capability.** |
| **Database** | **SQLite/libSQL, single file.** See §4.2 — the production wiring is raw `PrismaClient` while the schema declares `engineType = "client"`. |
| **Billing** | **Schema + UI only, and unsafe** — see §4.1. **No Stripe webhook route exists; `src/lib/stripe.ts` is imported by nothing.** |
| **Object storage** | **NOT IMPLEMENTED.** No S3/MinIO SDK in `package.json`; storage is local-filesystem via `resolveWithinRoot`. |
| **Backups** | Scripts exist and are well-guarded (`VACUUM INTO` → `PRAGMA integrity_check` → SHA-256; restore rehearses to an isolated target and snapshots before overwrite). **No offsite destination, no encryption, no drill ever performed.** |
| **Preview deployments** | **NOT IMPLEMENTED** — webhook explicitly returns `result: "ignored", reason: "preview deployments are not enabled"`. |
| **Load testing** | **NONE.** No k6/artillery/autocannon anywhere. **"500 concurrent users" is unmeasured and must never be claimed.** |

---

## 4. NEW findings (not in the merged baseline)

### 4.1 CRITICAL — any authenticated customer can grant themselves a paid plan, for free

`POST /api/ai/operator` resolves the actor with `requireSession` — which **any CLIENT account
satisfies** — and then dispatches eight commands. It computes `isAdmin` and uses it **only as a
row filter**, never as an authorisation gate:

- `activate_plan` (`route.ts` ~L364): creates a `Subscription` marked `active`, an `Order` with
  `status: "completed"`, and an `Invoice` with `status: "paid"`, `paidAt: now` — **no payment is
  taken and no admin check is made**. It also cancels the caller's existing active subscriptions.
- `generate_invoice` (~L442): lets the caller set `status` to **`paid`** directly via
  `params.markPaid === true`.
- `mark_invoice_paid` (~L461): correct ownership check (`isAdmin ? {} : { userId }`), so
  cross-tenant is blocked — but a customer can still mark **their own** invoice paid.
- `natural_language` (~L351) infers intent from free text, so a prompt containing "upgrade" or
  "activate" reaches `activate_plan` with no explicit command at all.

**Reachability chain:** anonymous → `POST /api/auth/signup` (only an active admin may assign a
privileged role; a super admin token needs full `User` scope) → CLIENT account → sign in →
`POST /api/ai/operator {"command":"activate_plan","params":{"planSlug":"enterprise"}}` →
**Enterprise plan active, invoice marked paid.**

The existing test (`tests/marketing-operator-and-providers.test.ts` L240) exercises this path with
an **admin** API key, which is why the suite is green and the hole was never seen.

**Impact:** direct revenue loss and unauthorised resource entitlement — the exact failure mode
brief §16 forbids ("never display a price or a resource the infrastructure cannot deliver", and
never grant what was not paid for). It also silently bypasses whatever suspension policy exists.

**Fix applied in this PR:** a command-level authorisation gate. `activate_plan`,
`generate_invoice` and `mark_invoice_paid` become admin-only; a customer may still *read* status.
`auto_deploy_site`, `create_crm_lead`, `launch_marketing_campaign` and `status_report` keep
working for customers but are scoped to the caller's own rows. Self-service plan changes must go
through a real payment handler (`/api/subscriptions`, Stripe), not the AI operator. Regression
tests added for the customer-denied and admin-allowed cases.

### 4.2 HIGH — the production DB wiring does not match the schema's declared client mode

`prisma/schema.prisma` declares `engineType = "client"`. `src/lib/db.ts` uses the libSQL adapter
**only when** `DATABASE_URL` starts with `file:`; otherwise it returns a bare
`new PrismaClient()`. With `provider = "sqlite"` + `engineType = "client"`, a bare client has no
engine to talk to. So the `postgresql://` branch that `production-config.ts` tolerates cannot
actually work, and the code fails at a place unrelated to the misconfiguration.

Related: `src/lib/db.ts` falls back to `"file:./db/custom.db"` when `DATABASE_URL` is unset, and
nothing in `src/` calls `production-config.ts` at boot — only `scripts/validate-prod-config.mjs`
does. The **only** enforced guard is `scripts/deploy-release.sh`, which refuses to deploy without
an absolute `file:` path outside the checkout. That is good, but it means a process started by
anything other than that deploy path (pm2 restart, systemd, a manual `npm start`) would run the
app on the committed fixture database — three seeded users, no customer data.

**Not fixed in this PR**: this is a database-strategy decision (Phase 1), and changing datasource
or adapter mode is exactly the class of change the brief says needs approval and a rehearsal.

### 4.3 HIGH — public marketing pages contradict the platform's real capability

`next.config.ts` redirects `/pricing`, `/hosting/*`, `/domains`, `/email`, `/ssl` to the project
showcase — the *links* are retired. But the **pages still exist and still render**
(`src/app/pricing/page.tsx`, `src/app/hosting/page.tsx`), and `src/lib/marketing/hosting-catalog.ts`
still ships:

- KVM VPS on "AMD EPYC hosts with NVMe storage and a 10 Gbps network", plans `kvm-1/2/4`, while
  **KVM support is 0 lines of code and no owned host is KVM-capable.**
- Hosting plans advertising "100 GB NVMe", "LiteSpeed", "free CDN", "weekly backups", "10 managed
  databases" — none of which is deliverable today.

A redirect is not a withdrawal: direct URL access, search indexing, and any future redirect
removal re-publish claims that would constitute mis-selling. **Recommend deleting or hard-gating
the copy, not merely redirecting it** — but that is a product/branding decision, so this PR does
not touch it.

### 4.4 MEDIUM — rate limiting and job locking do not survive a restart or a second replica

`src/lib/rate-limit.ts` is an in-process `Map`. `ioredis` and `REDIS_URL` exist but the limiter
does not use them. Two consequences: a restart clears every bucket (login/enrolment throttles
included), and any second instance has an independent view. Combined with the in-memory `lockKey`
serialization in the orchestrator (§3, C), the platform is **structurally single-instance**, which
is consistent with the brief's "one active control plane" guidance — but it must be stated, not
assumed, and it blocks the Phase 8 standby until both move to a shared backend.

### 4.5 MEDIUM — committed fixture database is a live credential-bearing artifact

`db/custom.db` is tracked and contains **3 users** (`admin@alolabs.net`, `reseller@`, `client@`)
with real bcrypt hashes. `prisma/seed.ts` is careful — random passwords unless `SEED_*_PASSWORD`
is set, and it never prints them — but the committed file is a standing offline-cracking target
and an accidental "production" database (§4.2). It should be moved to a generated fixture built at
test time.

### 4.6 MEDIUM — `SERVER-SPEC.md` publishes the production host's public IPv4 and port map

Confirmed present: the public IP appears 6 times plus the internal port map. This is a
reconnaissance gift for anyone who reads the repository. Carried over from the merged baseline as
R8 and **still open**; redaction needs an owner decision on where the operator copy lives.

---

## 5. Test-coverage reality (brief §19 matrix)

Counts are test files touching each area, not assertions:

| Area | Files | Area | Files |
|---|---|---|---|
| auth | 40 | firewall | **1** |
| database/provisioning | 33 | billing/invoice/subscription | **2** |
| build/pipeline | 31 | heartbeat | **3** |
| deploy | 35 | VPS/KVM/VM | **3 (honesty tests only)** |
| quota/usage/limit | 25 | job/orchestrator | 10 |
| agent/enrolment | 23 | rollback | 10 |
| backup/restore | 21 | retry/requeue | 5 |
| domain | 18 | cancel | 6 |
| github | 16 | docker/container | 8 |
| tenant/isolation/IDOR | 15 | rbac/permission | 9 |

**Strong where the code is strong** (auth, deployment, agent protocol, DB provisioning logic).
**Thin exactly where the missing subsystems are** (billing 2, firewall 1, VPS 3 — and those 3 are
honesty assertions that the feature is *absent*). Coverage tracks implementation, as expected; the
gap to worry about is that **billing has real code and only 2 test files**, which is how §4.1
survived.

**Failure tests required by the brief §19 that have never been run against a real system:**
node offline, control plane down, DB down, disk full, network drop, backup failure, SSL expiry,
agent token expiry, 500 concurrent users, simultaneous deployments. Each is a *planned Phase 2+
drill*, not a passing test.

---

## 6. Ranked risk register

| # | Risk | Sev | Status |
|---|---|---|---|
| **R1** | **Free paid-plan activation via `/api/ai/operator`** (§4.1) | **Critical** | **fixed in this PR** |
| R2 | Selling/imply undeliverable services — KVM catalogue, plan side-effects (§4.3) | Severe | open, owner decision |
| R3 | Production release SHA unknown; last GitHub prod deploy **failed** 2026-10-28 | Severe | open, needs host access |
| R4 | Zero verified backups / zero offsite / zero restore drill | Severe | open |
| R5 | DB wiring ≠ declared engine mode; unguarded fixture fallback (§4.2) | High | open, Phase 1 |
| R6 | Single failure domain (office power+ISP shared by A and B) | High | open, infra |
| R7 | Carnival public IPv4 arrangement unverified — any exposure is blind | High | open, owner |
| R8 | `production` environment has **no** required reviewers; manual-only hold is the sole barrier | High | open, admin action |
| R9 | Structurally single-instance (in-memory rate limit + job locks) (§4.4) | Medium | open, Phase 8 |
| R10 | Fixture DB with real hashes committed (§4.5) | Medium | open |
| R11 | `SERVER-SPEC.md` publishes IP + port map (§4.6) | Medium | open |
| R12 | AI is 503 without a provider — features silently no-op | Medium | open, Phase 5 |
| R13 | Tenant isolation strong in code, **never adversarially tested live** | Medium | open |
| R14 | Documentation drift — already demonstrable within hours (§0) | Low-Med | mitigated by dating every claim |

---

## 7. Prioritized roadmap (revised)

Changes from the merged baseline are marked ▶.

### Phase 1 — architecture foundation (code only, no hosts) — **NEXT**
1. **PostgreSQL decision for the control plane** with a measured spike, and in the same change fix the adapter/engine mismatch (§4.2). Until then, label SQLite a single-writer development engine.
2. ▶ **Billing authorisation model**: a single explicit permission (`BILLING_MANAGE`, `PLAN_ASSIGN`) checked on every entitlement-changing path; a written rule that *no* AI/operator command may create a paid entitlement; self-service plan changes only through the payment handler.
3. **Boot-time config enforcement** — call `production-config.ts` at process start in production, refusing to start on a relative/absent DB path or a fixture fallback (§4.2).
4. **Permission-matrix test** across all 250 routes (route × role × ownership), plus an automated cross-tenant IDOR sweep (§4.4-adjacent, R13).
5. ▶ **Redis-backed rate limiting and job leases** — prerequisite for the standby in Phase 8 (§4.4).
6. **Repository hygiene**: redact `SERVER-SPEC.md` (§4.6); replace the committed fixture DB with a generated one (§4.5); ▶ **delete or hard-gate the KVM/hosting catalogue copy** (§4.3).
7. ▶ **CI: add a `docker build` job** (no push) so the non-root container shape is actually proven, and an `npm audit --audit-level=high` gate.

### Phase 2 — node agent (needs read-only host access)
Unchanged: read-only SSH verification of A/B/C/D (`lscpu`, `free`, `findmnt`, `df -hT`, `ss -lntup`, LVM), then enrol **Server A** first, B in monitoring-only mode. Record every result against REPORTED values. **No VPS claims from either.**

### Phase 6 — public entry (prerequisite for any public traffic)
Unchanged and **blocking**: Carnival IP fact-finding (static/CGNAT/forwarding/80-443/IPv6) before a single port is opened. Then one reverse proxy, TLS, firewall, alerting with proven delivery.

### Phase 3 — managed application hosting (own projects first)
Unchanged: dedicated build worker, deploy ALO's own projects through the full path, close detection gaps (**Go/Java absent; PHP `composer.json` shallow**), preview deployments, backup/restore drill with published RPO/RTO.

### Phases 4/5/7/8/9
Unchanged from the merged baseline. **Phase 7 (VPS) stays gated** behind a verified KVM host, and no price may be published until one reference VM completes create → boot → SSH → snapshot → restore → delete.

**Critical path:** 1 → 2 → 6 → 3 → 4 → 8 → 9.

---

## 8. Go / no-go gates (unchanged, plus two)

| Claim | Gate |
|---|---|
| "Live in production at SHA X" | Host `release-identity.json` == approved SHA **and** external HTTP probe passes |
| "Backups exist and restore" | One full restore rehearsal, evidenced |
| "Server A/B/C specs are …" | One read-only SSH session per host, recorded |
| "500 concurrent users" | Published load-test report |
| "VPS available for purchase" | KVM host verified + lifecycle drill passed |
| "AI operates the infrastructure" | Closed-loop propose → approve → execute → verify on a disposable target |
| **"Self-service billing works"** | ▶ Paid entitlement reachable **only** through the payment handler; every operator command covered by an authorisation test |
| Any production deploy | ▶ Explicit owner approval + verified pre-deploy backup + working rollback |

---

## 9. Questions blocking Phase 1/2 (unchanged from baseline §12, still unanswered)

1. Which host serves `hosting.alolabs.net` today, at which SHA? (or authorise a read-only SSH session)
2. Carnival IPv4: static or dynamic, routed or NAT, 80/443 forwardable, IPv6, more IPs?
3. Willingness to place a **dedicated external KVM VPS** for customer workloads/builds?
4. Backup destination of record — separate disk or S3-compatible (which provider)?
5. Approval chain + maintenance window for (a) production release, (b) DB engine change, (c) DNS/TLS cutover?
6. Should `SERVER-SPEC.md` be redacted and moved to operator-only storage?
7. Billing: which Stripe account/mode is authoritative; who approves suspension/dunning policy?
8. **New:** should the KVM/hosting catalogue copy be **deleted**, or re-labelled "planned / not available"?

---

## 10. Deliverable checklist (brief §20)

| # | Item | Where |
|---|---|---|
| 1 | Current-state audit | this document |
| 2 | Architecture diagram | §11 |
| 3 | Implementation plan | §7 |
| 4 | Files changed | §12 |
| 5 | Database impact | **none** — no schema, migration, or data change |
| 6 | Security impact | **positive** — closes §4.1; no safeguard weakened |
| 7 | Infrastructure impact | **none** — no host, network, DNS, TLS, or service touched |
| 8 | Test plan | §12 (regression tests added for the fix) |
| 9 | Completed changes | §12 |
| 10 | Test results | §2 (all gates green; 1005 tests) + §12 |
| 11 | Known limitations | §2 note, §5, §9 |
| 12 | Rollback plan | revert the single commit; no data/state to unwind |
| 13 | PR link | see PR body |
| 14 | Deployment readiness | **NOT READY** — Phase 0/1 gates in §8 are unmet |

---

## 11. Target architecture (unchanged by this audit, restated for completeness)

```
Internet
   |
Carnival public IPv4  ← UNVERIFIED (static? CGNAT? 80/443?)
   |
Office router / firewall   ← forwards 80,443 only (+22 restricted, +51820/udp if WG)
   |
ALO reverse proxy (Caddy or nginx, single host)   ← TLS, per-vhost routing
   |
Private network (Tailscale/WireGuard)   ── no compute node exposed directly
   |
   ├── Control Plane (Next.js, single active + tested standby)   [Phase 8]
   ├── Job Orchestrator (single leader via DB lease)             [exists, in-process]
   ├── Compute nodes + Node Agent (+ /dev/kvm ONLY on a verified host)  [Phase 2/7]
   └── Database host (Postgres for control plane, MariaDB/PG for customers)  [Phase 1/4]
```

One public IPv4 serves many hostnames by hostname-based routing. **Do not promise an independent
public IPv4 per VPS.**

---

## 12. Files changed in this PR

| File | Change |
|---|---|
| `src/lib/operator/command-policy.ts` | **new** — the single authorisation table for operator commands (required role, entitlement-changing flag) |
| `src/app/api/ai/operator/route.ts` | gate `activate_plan`, `generate_invoice`, `mark_invoice_paid` behind admin; audit-log every operator command |
| `tests/operator-authorization.test.ts` | **new** — customer denied, admin allowed, no-entitlement-write guarantee |
| `docs/audit/PHASE-0-INDEPENDENT-REAUDIT-2026-11-11.md` | **new** — this document |

No schema change. No migration. No production configuration. No dependency added.

---

*Prepared as the Phase 0 deliverable. Nothing was deployed, migrated, restarted, or deleted.
Every figure is reproducible by the command cited.*
