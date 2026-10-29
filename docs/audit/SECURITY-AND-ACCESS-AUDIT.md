# Security and access audit

**Date:** 2026-10-29 · **Baseline:** `cbf56fb`
This document contains the findings that are *independently verified*. Host-level
security posture is almost entirely `[BLOCKED]`.

## 1. Verified findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| S-1 | **No required reviewer on the `production` environment.** `protection_rules: []`, `can_admins_bypass: true`, `deployment_branch_policy: null`. A push to `main` deploys unattended. | **High** | `[CI]` |
| S-2 | **No successful deploy has ever passed that gate.** All four successful deploy jobs ran under workflows with no `environment:` declaration. The gate has only ever seen failures and skips — so its correctness is unproven as well as its existence. | High | `[CI]` |
| S-3 | **A second, ungated production deploy path.** `WEBSITE_DEPLOY` alone triggers file replacement + `restartExternalService`, synchronously in-request, inline worker on by default. | **High** | `[SRC]` |
| S-4 | **Webhook uses a static shared secret**, no HMAC over body, no timestamp, no nonce — unlike the agent path, which has all three. | Medium | `[SRC]` |
| S-5 | **CRM malware scanning enforced on 2 of 9 externally-fed ingest paths.** WhatsApp — the nominated vault wiring point — does magic-byte sniffing only. | **High** | `[SRC]` |
| S-6 | **Branch protection on `main` unreadable** (`403`, token lacks scope). Recorded unverified rather than assumed either way. | — | `[CI]` |

## 2. Controls that are correctly built (preserve — do not rebuild)

| Control | Where | Why it is sound |
|---|---|---|
| Command allowlist | `lib/agents/allowlist.ts` (588 lines, 31 commands) | argv-only, never shell strings; per-command Zod re-validated **agent-side**; risk level; timeout; explicit sudo flag; required scopes |
| Agent request signing | `lib/agents/http.ts` → `authenticateAgentRequest` | HMAC over the exact raw body, which closes body-mutation between parse and verify |
| Replay protection | `AgentNonce @@unique([agentId, nonce])` + `expiresAt` | server-side, not client-asserted |
| Enrolment token | `AgentEnrollmentToken.tokenHash @unique`, `usedAt`, `expiresAt` | hashed at rest, single use, plaintext shown once |
| Agent secret | `ServerAgent.secretEnc` | encrypted, never returned after creation |
| Service credential (CRM) | `service_credentials` | sha256 digest only + 12-char prefix; single generic auth failure message prevents enumeration |
| Secret redaction | audit path | key-name matching at any depth |
| SSRF guard | `lib/security/url-guard.ts` | applied to health-probe base *and* composed URLs |
| Storage traversal | `resolveWithinRoot` | pool-root containment |
| Rate limiting | enrol route | keys on `x-real-ip`, explicitly **not** the spoofable leftmost `x-forwarded-for` |

That last detail is a good example of a control that was designed rather than
copied — the comment explains the reasoning.

## 3. Credential-handling rules in force

- No secret is committed. `.env.example` carries placeholders only.
- No secret is entered into the dashboard, and none is logged.
- Provider tokens (cPanel, Hostinger) are **not** to be pasted into chat, a
  dashboard form, or a repository file. They are issued by the provider and held in
  the secret store.
- Rotation for service credentials is provision-new → switch → revoke-old, so there
  is never a window with no valid credential.

## 4. Access matrix

| Principal | Can reach | Can mutate |
|---|---|---|
| ALO control plane | nothing on A/B/C/D beyond HTTP | no |
| GitHub Actions deploy job | the production host, filesystem + PM2 | **yes** (main merge, no approval) |
| `WEBSITE_DEPLOY` holder | deploy endpoints | **yes**, no approval (S-3) |
| `BACKUP_RESTORE` holder | rollback endpoint | **yes**, no approval |
| webhook secret holder | deploy webhook | creates a PENDING record (executes if worker runs) |

The middle three rows are the governance problem, not the technical controls.

## 5. Blocked — cannot assess

`[BLOCKED]` on A-6 / A-3 / A-4:

- SSH configuration on A and B (`PermitRootLogin`, password vs key, fail2ban);
- firewall state and open ports on either host;
- TLS termination and certificate validity for any public domain;
- whether `hosting.alolabs.net` exposes an admin surface publicly;
- cPanel account isolation and mailbox security;
- whether any production secrets are stored in plaintext outside the secret store;
- security-update posture on both hosts.

No claim is made about any of these in either direction.

## 6. Priority order

1. **S-1/S-2** — configure and *verify* the gate before anything merges. Blocks A-8.
2. **S-5** — coverage before the vault is enabled. Vault stays off.
3. **S-3** — decide R-1/R-2 from `B9-APPLICATION-DEPLOY-PATH.md`.
4. **S-4** — align the webhook with the agent's signing scheme.
5. Host posture — only measurable once A-6 exists.
