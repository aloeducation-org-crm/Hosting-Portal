# Deployment and Infrastructure Audit

> Measured at `d1dc3d0`: 23 helper scripts, 18 passwordless sudo grants across
> 57 lines in `deploy/sudoers/alo-hosting-deploy`, one workflow
> (`.github/workflows/ci-cd.yml`), a four-stage `Dockerfile`, Compose with four
> services, and five systemd units.

## 1. Deployment topologies shipped

| Topology | Artifact | Verified? |
|---|---|---|
| Bare-metal systemd on Ubuntu | `deploy/ubuntu-setup.sh`, `deploy/systemd/*.service`, `deploy/sudoers/alo-hosting-deploy` | Documented + unit-testable; **not executed in this pass** |
| Docker Compose | `Dockerfile` (base → deps → builder → runner, `USER nextjs`, `EXPOSE 8080`), `docker-compose.yml` (`db-init`, `alo-hosting-panel`, `automation-worker`, plus the site runtime) | `docker build` **not run** in this sandbox (no daemon) |
| Reverse proxy | nginx configs in `deploy/nginx/`, Caddy paths writable by units, `cloudflared/config.yml` | Config present; not applied |
| CI/CD | GitHub Actions → self-hosted runner on the production host | Live on `main`; **not exercised on this branch** |

Honest position: the topology is *described and scripted*, not *executed*. The
`Dockerfile` build and the systemd install path are unverified in this
environment. That is why the installation runbook (`docs/operations/INSTALLATION.md`)
marks each step with whether CI proves it or only the source supports it.

## 2. Privilege model

```
customer request → panel (user alo-panel) → allowlisted helper (root-owned)
                        │                         │
                        └── sudo NOPASSWD ────────┘  (18 grants)
```

- The panel runs as `alo-panel` but the units set `NoNewPrivileges=false`
  because they must `sudo` into helpers.
- 18 passwordless grants exist. Each must name an absolute path; `install-helpers.sh`
  is the only supported way to place them root-owned and non-writable.
- **Residual risk (open, architectural):** this makes a panel compromise
  root-equivalent. The containment strategy is (a) allowlist-only, argv-only
  helper invocation, (b) every customer-reachable capability checked *before* the
  helper call, (c) hardening flags on the units (`ProtectSystem=strict`,
  `ProtectHome=read-only`, `PrivateTmp`, `MemoryMax`, `OOMPolicy=kill`).
  Moving the helpers behind the agent is the real fix and is Phase 2 of the
  master brief.

## 3. Environment and configuration

| Concern | State |
|---|---|
| Env documentation | `.env.example` covers every variable the code reads; `npm run audit:repo` fails the build otherwise (17/17 at `d1dc3d0`) |
| Config validation | `npm run config:validate` |
| Secret storage | mode-0600 root-owned env files (`/etc/alo-hosting/panel.env`) and Compose `env_file` marked `required: false`; the file is not in Git |
| `DATABASE_URL` | required in production — unset ⇒ `process.exit(1)` (SEC-12) |
| Session cookies | `secure` in production |
| Build isolation | `DEPLOY_BUILD_ISOLATION` defaults to `required` in production (SEC-01) |

## 4. Release pipeline

`.github/workflows/ci-cd.yml`:

| Job | What it proves |
|---|---|
| `verify` | lint, typecheck, tests, **and that every shell script parses** (`bash -n`) |
| `build` | production build with non-production CI credentials; asserts both standalone entrypoints exist; records a release payload digest; uploads the artifact |
| `deploy-preflight` | read-only host inspection; refuses if `main` moved past the built commit; re-verifies the artifact digest |
| `deploy` | requires an explicit release approval for the commit; re-validates against `main` after taking the deploy slot; re-verifies the digest on the deploying runner; activates and verifies the running commit, **restoring on failure** |

This is a genuinely strong pipeline: digest pinning, commit re-validation, and
automatic rollback on activation failure. It is stronger than most self-hosted
products.

**What it does not prove:** that the built artifact was *tested against a
database with real data*, or that a restore works. There is no backup-verify step
in the pipeline and no restore drill, so a rollback is proven only at the
artifact level.

## 5. CI/CD findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-04 | High | `main` is unprotected; the `production` environment has **no required reviewers**; `deploy` targets a self-hosted runner **on the production host** | **OPEN** — repository/GitHub settings, owner action. A push to `main` that satisfies the approval check reaches the host. |
| — | Medium | Only one workflow file; no dependency scanning, no image scanning, no SBOM, no secret scanning in CI | **OPEN** |
| — | Low | No scheduled restore drill | **OPEN** (REL-05) |
| — | Low | The sandbox has no Docker, so the image path is unverified | Documented, not a product defect |

## 6. DNS, TLS and networking

| Concern | State |
|---|---|
| DNS provider integration | `alo-dns-helper`, `alo-domain-helper`; **no provider API is configured in this checkout**, so domain registration is **BLOCKED** |
| TLS issuance | `alo-ssl-helper`; the orchestrated certificate worker returns `NOT_IMPLEMENTED` rather than claiming issuance |
| Reverse proxy | nginx config present with `hosting.alolabs.net.conf`; binding to 0.0.0.0:80/443 |
| Egress control | not implemented beyond host firewall helper |
| Email deliverability (SPF/DKIM/DMARC) | no records managed in this checkout → **BLOCKED** |

## 7. Ports and processes (redacted)

The prior audit recorded historical ports (`127.0.0.1:3012`, `3051`). Those
values must not be assumed current. Observed in configuration at this commit:

| Port | Who | Source |
|---|---|---|
| 8080 | panel (Docker) | `docker-compose.yml`, `Dockerfile` |
| 3000 | panel (systemd default) + port validator | `alo-hosting-panel.service`, `alo-port-8080-validator` |
| — | 3051 appears only in a README sentence as loopback | do not treat as authoritative |

The separate ALO Education application, its directory and port 3015 are out of
scope and were not touched.

## 8. Recommendations

1. **SEC-04:** protect `main`, require reviewers on the `production` environment,
   and move the production runner off the production host or restrict its
   reachability.
2. Add `bash -n` coverage confirmation for any new helper (already in CI) and a
   restore drill to the pipeline.
3. Ship the `deploy-worker` unit (REL-03).
4. Publish the exact host requirements (Ubuntu version, kernel, cgroup v2,
   user-namespace availability for `bwrap`) in the installation runbook.
