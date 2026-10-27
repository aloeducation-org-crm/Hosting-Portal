# Agent Security

The trust boundary between the control plane and a managed Linux host.
Implementation: `agent/alo-agent.mjs` (host side) and `src/lib/agents/*` (panel
side). Tests: `tests/server-agent.test.ts` (46).

**Nothing described here is deployed.** No agent is enrolled on any host. Every
statement below is about code and tests, not about a running system.

---

## 1. Threat model

| Assumption | Consequence for the design |
| --- | --- |
| The network between agent and panel is hostile | Every request is signed; nothing is trusted because it arrived on a "private" network |
| The control plane could be compromised | The agent re-validates every command against its **own compiled-in allowlist**; a rogue panel cannot widen what a host will run |
| An agent binary could be read | It holds a signing secret, not credentials to anything else; revocation is immediate and per-agent |
| An operator could be tricked into approving something | Approvals are named, audited, and **expire** |
| The AI layer could be prompt-injected | It has no path to a shell, a Docker socket, an SSH key or a database port; privileged work needs a human |

---

## 2. Enrollment

```
admin → POST /api/agents/enrollment-tokens   (requireAdmin)
      → alo_enroll_… token, 15-minute TTL, sha256 hash stored, plaintext shown once
host  → POST /api/agents/enroll              (unauthenticated by design: the token IS the auth)
      → alo_agt_… key + alo_ags_… secret, returned once, stored encrypted
```

- The token is consumed by an **atomic conditional update**, so two concurrent
  enrollments cannot both win; the loser is told the token was already used.
- Unknown scopes and capabilities supplied at creation are dropped, not stored.
- A new agent receives **read-only capabilities only**
  (`DEFAULT_AGENT_CAPABILITIES`). `service.restart` and `backup.database` must be
  granted explicitly in the dashboard.
- The enrollment endpoint rate-limits per peer IP and is exempt from the session
  guard only because it has its own credential.
- `/api/agents/enroll` is listed in `HMAC_AUTHENTICATED_API_PATHS` in
  `src/middleware.ts`; without that, the session guard would 401 it.

**Trusted proxy.** The rate-limit bucket is keyed on `x-real-ip`, which
nginx/Caddy overwrite from the actual peer — never on the leftmost
`x-forwarded-for`, which a caller can rotate to get a fresh bucket per request.
The forwarded chain is still recorded as diagnostic `lastSeenIp`, because that is
evidence, not an authorization decision. `src/middleware.ts` documents the same
rule; the two were inconsistent and the agent route now follows it.

---

## 3. Request authentication

Signature: `HMAC-SHA256(secret, "{timestamp}.{nonce}.sha256(body)")`, sent as
`x-alo-agent-key`, `x-alo-signature`, `x-alo-timestamp`, `x-alo-nonce`.

The raw body is read **once** and hashed, so the signature covers exactly the
bytes that were sent — there is no JSON re-serialization step that could make the
verified bytes differ from the processed bytes.

Checks, in order:

1. All four headers present → else `401 MISSING_AGENT_AUTH`.
2. Agent key exists → else `Unknown agent key`.
3. Agent status is `active` → else rejected (a revoked agent cannot authenticate,
   dispatch, claim or be considered online).
4. Secret decrypts → else the agent is told to rotate it.
5. Timestamp within ±5 minutes → else `timestamp outside the replay window`.
6. Nonce present and ≥ 8 characters.
7. Signature matches, compared in constant time.
8. **Nonce has not been used by this agent before.**

Steps 5–7 alone were not replay prevention: a captured request stayed valid for
the rest of the window. Step 8 is the actual guard.

### Nonce single use

`agent_nonces` has a unique index on `(agentId, nonce)`. `consumeRequestNonce()`
performs the insert and treats the unique violation as the replay verdict — there
is no read-then-write window, so six concurrent replays of one captured request
produce exactly one success (asserted by test). Rows are scoped per agent, expire
with the signature window they belong to, and are pruned on each authentication,
so the table stays bounded; an expired nonce needs no row because the timestamp
check already rejects the request.

The nonce is consumed **after** signature verification, so an attacker who cannot
sign cannot burn a victim's nonce space. Replays are audited as
`AGENT_AUTH_FAILURE` / `NONCE_REPLAY`.

Why it matters concretely: `POST /api/agents/tasks/result` is how an agent reports
an outcome. Without step 8, a captured "SUCCEEDED" could be replayed to overwrite
an honest result. The test for this replays a captured report and asserts the
recorded `FAILED` result still stands.

---

## 4. The allowlist

Nine commands. Argv only — never a shell string, never `sh -c`.

| Command | Executable | Risk | sudo |
| --- | --- | --- | --- |
| `metrics.collect` | internal (`/proc`, `df`) | READ_ONLY | no |
| `service.status` | `systemctl is-active` | READ_ONLY | no |
| `service.restart` | `systemctl restart` | **PRIVILEGED** | yes |
| `process.list` | `pm2 jlist` | READ_ONLY | no |
| `health.probe` | internal (`fetch`) | READ_ONLY | no |
| `disk.usage` | `df -P` | READ_ONLY | no |
| `backup.database` | `alo-site-backup` | **REVERSIBLE** | yes |
| `backup.verify` | `sha256sum` | READ_ONLY | no |
| `db.replication-status` | internal | READ_ONLY | no |

`executable` and the fixed argv prefix come from the allowlist entry, **never from
the request**. Arguments are validated by a Zod schema on the panel and by the
agent's own `validate()` on the host, and every built argv token is rejected if it
contains a shell metacharacter — on both sides.

**Two copies, deliberately.** `src/lib/agents/allowlist.ts` (panel) and
`AGENT_ALLOWLIST` in `agent/alo-agent.mjs` (host). A test asserts the command sets
are identical and that every risk level agrees, so the copies cannot drift
silently. The host copy is the one that actually gates execution.

`sudo` is used as `sudo -n <fixed path>` for exactly the two entries that declare
it. There is no interactive sudo, no root shell, no unrestricted Docker socket,
no SSH key access and no database port reachable through this path.

`db.replication-status` **refuses** unless credentials exist on the host in
`/etc/alo-agent/db.cnf`. It will not accept credentials from the panel or from
argv, and it does not guess an engine or a version.

---

## 5. Authorization to dispatch

`authorizeCommand()` refuses, with a dashboard-safe reason, when:

- the command is not in the allowlist (`REFUSED_BY_ALLOWLIST`);
- the agent has not been granted that command;
- the actor lacks a required scope;
- the arguments fail the schema;
- any built argv token contains a shell metacharacter.

Refusals are recorded as an `AgentTask` in state `REFUSED` plus an
`AGENT_TASK_REFUSED` audit row — the refusal is evidence, not a silent drop.

Every route is guarded: `requireAdmin` on enrollment-token creation, rotate,
revoke and task approval; `requireAgent` (HMAC) on heartbeat, claim and result;
`requireSession`/`requireAdmin` on the listing and topology routes. The middleware
additionally makes every non-GET on `/api/agents` admin-only through a
method-specific rule, so the legacy AI-agent catalogue still serves signed-in
clients while task dispatch does not.

---

## 6. Approval gate for privileged tasks

A PRIVILEGED or DESTRUCTIVE task is created with `requiresApproval: true` and
`approvedBy: null`, and `claimTask()` only hands out tasks that are ungated or
already approved. **Without a human decision the task never reaches a host.**

- `POST /api/agents/tasks/{id}/approve` — `requireAdmin`, plus the middleware
  write guard. `{decision: "approve" | "reject", note?}`.
- Approval is a conditional update, so two admins clicking at once produce one
  winner; the loser gets a conflict, not a silent success.
- `rejectAgentTask()` marks the task `REFUSED` so it can never be claimed.
- Every decision is audited with the actor's identity (`AGENT_TASK_APPROVED`,
  `AGENT_TASK_REJECTED`), and gating itself is audited as `AGENT_TASK_GATED`.
- Approving a task that is not gated is refused rather than silently accepted.

**Approval expiry.** `approvedAt` is recorded and `claimTask()` requires the
approval to be within `AGENT_APPROVAL_TTL_MS` (1 hour). An operator approved a
specific host state at a specific moment; a task that sits unclaimed past that
window must be re-approved. `expireStaleTasks()` clears aged approvals so the
dashboard shows the task as waiting for a human instead of apparently approved
forever, and audits `AGENT_TASK_APPROVAL_EXPIRED`.

Orchestrator jobs have their own equivalent gate (`/api/orchestrator/jobs/{id}/approve`),
and a caller can never lower a worker's declared risk level.

---

## 7. Task lifecycle

```
dispatch → PENDING ──(gated? wait for approval)──→ claim (atomic) → ASSIGNED
         → agent verifies the task signature → executes from its own allowlist
         → POST result → SUCCEEDED | FAILED | REFUSED
         → unclaimed past TASK_CLAIM_TTL_MS → TIMED_OUT
```

- The claim response is signed with the agent's own secret over
  `{taskId, command, args, timeoutMs}`, and the agent verifies it before
  executing — so a task can only come from a control plane that already holds
  that secret, and even then the allowlist applies.
- Claiming is a conditional `updateMany`; five simultaneous claims hand the task
  to exactly one claimant (asserted by test).
- `INFRASTRUCTURE` worker behaviour: an agent task is not synchronous, so the
  worker throws a retryable `WorkerError("AGENT_TASK_PENDING", …, {taskId})` and
  later attempts poll `agentTask` using `mergeInput`. It never re-dispatches per
  attempt.

---

## 8. Network target validation

`health.probe` is the only command that makes an outbound request, and
`isPrivateTarget()` is the SSRF guard.

Allowed: `127.0.0.0/8`, `localhost`, `::1`, `10.0.0.0/8`, `192.168.0.0/16`,
`172.16.0.0/12`, `100.64.0.0/10` (CGNAT/Tailscale).

Refused:

- **cloud metadata**, even though it is link-local and therefore "private":
  `169.254.0.0/16` including `169.254.169.254`, `100.100.100.200`,
  `metadata.google.internal` and subdomains, `metadata.azure.com`, `metadata`,
  `instance-data`, `fd00:ec2::254`, `fe80::/10` (`fe80`/`fe90`/`fea0`/`feb0`).
  An agent that could reach these could read the host's cloud credentials.
- `0.0.0.0/8` and `::` (unspecified, not private).
- **every hostname**, because a name can resolve anywhere. This makes DNS
  rebinding structurally impossible rather than mitigated: there is no
  resolve-then-connect step to race.
- any non-`http`/`https` scheme (`file:`, `ftp:`, `gopher:`…), malformed octets,
  and octets outside 0–255.
- redirects: the probe uses `redirect: "error"`, so a private target cannot be
  bounced to a public one.

This mirrors the panel's own policy in `src/lib/security/url-guard.ts`
(`isCloudMetadataOrLinkLocalHost`). The agent originally allowed
`169.254.0.0/16`; CI caught it, and the tests now assert
`http://169.254.169.254/latest/meta-data/` is **refused**.

---

## 9. Secrets and output

- Agent secrets are stored encrypted (`encryptSecret` / `decryptSecret`); the
  plaintext is returned exactly once at enrollment or rotation.
- Rotation invalidates the old secret immediately (tested).
- Revocation is a conditional update: idempotent, honestly reported, and it stops
  authentication, dispatch, claiming and the online flag.
- The agent redacts before anything leaves the host: GitHub tokens (`ghp_`,
  `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), AWS access keys
  (`AKIA`/`ASIA`), PEM private-key bodies, `mysql://user:pass@` style URLs, and
  `password|passwd|pwd|secret|token|api_key = value` pairs, plus any extra
  secrets passed in.
- The panel redacts again on write (`recordTaskResult`, job events, audit
  metadata), so a compromise on one side does not leak through the other.
- `describeAgents()` returns no secret material; a test asserts the serialized
  view contains neither `secretEnc` nor the secret prefix, while still containing
  the public `agentKey` (safe to display).
- No log, audit row, error message or test output prints a credential or a full
  database URL.

---

## 10. Rollout (Gate D — not started, needs explicit approval)

One host at a time, non-root service account, least privilege:

1. Create an enrollment token in the dashboard for one host. Tokens expire in 15
   minutes and are single-use, so create it immediately before use.
2. Install the agent under systemd as a **non-root** user:
   ```bash
   ALO_PANEL_URL=https://<panel-host> ALO_ENROLL_TOKEN=alo_enroll_… \
     node agent/alo-agent.mjs --name office-a --enroll
   ```
3. Grant read-only capabilities first. Verify heartbeats turn the node `live` in
   `/infrastructure` and that the Server row shows real CPU/RAM/disk.
4. Run one read-only task (`metrics.collect`) end to end.
5. Run one PRIVILEGED task and confirm it is **refused by the gate**, then approve
   it as a named admin and confirm it executes and is audited.
6. Add `sudo -n` entries for exactly `systemctl restart <unit>` and the backup
   helper — nothing broader.
7. Only then consider `service.restart` / `backup.database` capabilities.

Rollback: revoke the agent from the dashboard. Revocation takes effect on the next
request.

Do not open inbound ports on the host: the agent polls out. Do not expose a Docker
socket, SSH or a database port to the panel or to the AI layer.

---

## 11. Known gaps

| Gap | Severity | Note |
| --- | --- | --- |
| No agent enrolled anywhere | — | Nothing here is production-verified |
| `db.replication-status` unusable until `/etc/alo-agent/db.cnf` exists on the host | Medium | Deliberate: it refuses rather than takes credentials from the panel |
| Nonce table grows with request volume | Low | Pruned to the signature window on each authentication |
| The agent's own state file holds its secret | Medium | Written `0600`; host filesystem access is out of scope of this design |
| No mutual TLS; relies on the panel's TLS | Low | Signature covers the body, so a MITM cannot alter it, but can observe metadata |
| `health.probe` cannot target a hostname | Low | Correct trade-off; add an explicit allowlist of names if staging needs it |
