# BLOCKED-ISSUES — Operational unblock guide

One section per BLOCKED or PARTIAL row in [`docs/ROADMAP-STATUS.md`](./ROADMAP-STATUS.md). Each section has the **exact command** to run on `alo-server-lap` and (where useful) the GitHub issue text to file. This document is the companion to the four scripts this PR adds:

- `scripts/go-live.sh` — the orchestrator that runs steps 1–7 below
- `scripts/install-github-runner.sh` — issue #1
- `scripts/install-public-ingress.sh` — issues #3, #4
- `src/lib/registrar/cloudflare.ts` — issue #8

Status legend matches `ROADMAP-STATUS.md`: **PASS** = verified with recorded evidence; **PARTIAL** = works in part, missing pieces listed; **BLOCKED** = credential, permission, dependency or external service unavailable; **NOT TESTED** = no verification performed.

---

## Issue #1 — Self-hosted GitHub Actions runner not registered  *(BLOCKED → PASS)*

**Symptom.** The deploy job from 2026-10-27 11:09 UTC has been sitting in `queued` forever; no runner ever picked it up. The CI/CD workflow's `deploy` job cannot run.

**Root cause.** No self-hosted runner is registered for `aloeducation-org-crm/Hosting-Portal`. GitHub-hosted runners are deliberately not used because the deploy job SSHes to `alo-server-lap` and runs sudo commands — only a runner on the box itself has the right identity.

**Unblock.**

```bash
# 1. As repo admin, get a runner registration token (expires in ~1h):
curl -fsS -X POST \
  -H "Authorization: token ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/aloeducation-org-crm/Hosting-Portal/actions/runners/registration-token \
  | jq -r .token

# 2. On alo-server-lap, with that token:
sudo ACTIONS_RUNNER_TOKEN=<token-from-step-1> \
  bash scripts/install-github-runner.sh
```

**Verify.** Open https://github.com/aloeducation-org-crm/Hosting-Portal/settings/actions/runners — `alo-server-lap` should be listed as `Idle` (or `Active` if a job is running).

**Then** cancel the stuck queued run and re-trigger:

```bash
gh run list --repo aloeducation-org-crm/Hosting-Portal --status queued --json databaseId -q '.[].databaseId' \
  | xargs -I{} gh run cancel {} --repo aloeducation-org-crm/Hosting-Portal
gh workflow run ci-cd.yml --repo aloeducation-org-crm/Hosting-Portal --ref main
```

**Evidence to record for PASS.** The `runner list` JSON showing `alo-server-lap` with `status: online`; the previously-queued run completing with `conclusion: success`.

---

## Issue #2 — Branch protection on `main` returns 403  *(BLOCKED → PASS)*

**Symptom.** `GET /repos/.../branches/main/protection` returns 403; `protection_rules: []` is empty so there are no required reviewers on production deploys.

**Root cause.** The token in use has `repo` scope but the call is being made in a context that does not pass `admin:repo_hook`; or the branch has never had protection set and the API returns 404-with-403-shadow. Either way, no required approvals exist.

**Unblock.** Use the GitHub web UI (Settings → Branches → Add rule for `main`) or the API directly with a token that has admin on the repo:

```bash
gh api -X PUT /repos/aloeducation-org-crm/Hosting-Portal/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify", "build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

**Verify.**

```bash
gh api /repos/aloeducation-org-crm/Hosting-Portal/branches/main/protection \
  | jq '.required_pull_request_reviews.required_approving_review_count'
# expect: 1
```

**Evidence to record for PASS.** The protection JSON above; a screenshot of a PR blocked on review.

---

## Issue #3 — Production DB migrations never applied  *(NOT TESTED → PASS)*

**Symptom.** Migrations `20261027090000_unified_orchestrator_agents` and `20261027093000_operation_jobs_platform_scope` are present in `prisma/migrations/` but were never applied to a production database, because none existed in the sandbox where they were authored.

**Root cause.** No `/var/lib/alo-hosting/alo.db` had ever been created, so `prisma migrate deploy` had no target.

**Unblock.** After running `scripts/go-live.sh` (which creates the DB via `init-production-db.sh`), apply any migrations newer than the seed:

```bash
sudo DATABASE_URL="file:/var/lib/alo-hosting/alo.db" \
  node scripts/apply-deploy-schema.mjs \
  --backup /var/lib/alo-hosting/alo.db.pre-migration.$(date +%Y%m%d-%H%M%S)
```

The script is idempotent and refuses relative paths. If the `operation_jobs` migration needs a table rebuild (it does — it changes a column type), pass `--allow-rebuild`:

```bash
sudo DATABASE_URL="file:/var/lib/alo-hosting/alo.db" \
  node scripts/apply-deploy-schema.mjs \
  --backup /var/lib/alo-hosting/alo.db.pre-rebuild.$(date +%Y%m%d-%H%M%S) \
  --allow-rebuild
```

**Verify.**

```bash
sudo sqlite3 /var/lib/alo-hosting/alo.db \
  "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
# expect both 20261027 migrations with non-null finished_at
```

**Evidence to record for PASS.** The `_prisma_migrations` query output above; the JSON health check showing `db.migrations.applied == true`.

---

## Issue #4 — Cloudflare Tunnel / DNS not wired  *(BLOCKED → PASS)*

**Symptom.** `https://hosting.alolabs.net` does not resolve, or resolves but returns 530 / `ERR_TOO_MANY_REDIRECTS`.

**Root cause.** Either no tunnel exists, or the tunnel exists but the DNS CNAME was never created, or the DNS exists but the Cloudflare zone SSL mode is `Flexible` (which re-encrypts to port 80 and creates an infinite 301 loop — see `deploy/cloudflared/config.yml` for the full reasoning).

**Unblock.**

1. In the Cloudflare dashboard (https://one.dash.cloudflare.com/):
   - Networks → Tunnels → Create tunnel → name it `alo-hosting`
   - Copy the **tunnel token** (a long JWT-like string)
2. Add to `/etc/alo-hosting/panel.env`:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=<from step 1>
   CLOUDFLARE_API_TOKEN=<scoped to Zone:DNS:Edit + Account:Registrar:Edit>
   CLOUDFLARE_ZONE_ID=<from Cloudflare dashboard → Overview (right sidebar)>
   CLOUDFLARE_ACCOUNT_ID=<from Cloudflare dashboard → Overview (right sidebar)>
   ```
3. Run on alo-server-lap:
   ```bash
   sudo bash scripts/install-public-ingress.sh
   ```
4. In the Cloudflare dashboard → SSL/TLS → Overview, set the mode to **Full**
   (not Flexible, not Full (strict)).

**Verify.**

```bash
curl -fsS https://hosting.alolabs.net/api/health | jq .status
# expect: "ok"
```

**Evidence to record for PASS.** The `curl` output above; `cloudflared tunnel info alo-hosting` showing 2+ connectors; a screenshot of the Cloudflare SSL/TLS mode set to Full.

---

## Issue #5 — GitHub App credentials not installed  *(BLOCKED → PASS)*

**Symptom.** Customer repo webhooks cannot be received/signed/verified; the panel's "Connect GitHub" flow 404s. The deploy job works (issue #1) but only because the workflow polls — pushes from arbitrary customer repos do not trigger deploys.

**Root cause.** `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` are not set in `/etc/alo-hosting/panel.env`.

**Unblock.**

1. Create a GitHub App at the org level:
   https://github.com/organizations/aloeducation-org-crm/settings/apps
   - **Webhook URL:** `https://hosting.alolabs.net/api/github/webhook`
   - **Webhook secret:** generate with `openssl rand -hex 32`
   - **Repository permissions:** Contents (R), Metadata (R), Pull requests (R), Push (R), Webhooks (R)
   - **Subscribe to events:** Push, Pull request, Create, Delete, Repository
2. After creating the app:
   - Note the **App ID** (numeric, on the app's General page)
   - Generate a **private key** (downloads a `.pem` file)
3. Install the app on the `aloeducation-org-crm` org (or just on `Hosting-Portal`).
4. Add to `/etc/alo-hosting/panel.env` (paste the `.pem` contents on one line with `\n`):
   ```env
   GITHUB_APP_ID=<digits>
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
   GITHUB_WEBHOOK_SECRET=<from step 1>
   ```
5. Restart the panel and run the HTTP verification harness:
   ```bash
   sudo systemctl restart alo-hosting-panel
   sudo bash scripts/verify-deploy-http.mjs
   ```

**Verify.** Push to a test repo connected via the panel — the webhook should arrive within seconds and a deploy should start. `journalctl -u alo-hosting-panel -f | grep webhook` should show signed payloads being accepted (HMAC matches).

**Evidence to record for PASS.** A successful webhook delivery in the GitHub App's "Advanced" tab; the panel's deployment history showing the triggered deploy.

---

## Issue #6 — `agents.alolabs.net` sandbox host unavailable  *(BLOCKED)*

**Symptom.** Railway-style sandbox deferred.

**Root cause.** A second host/application was never provisioned.

**Unblock.** Provision a second Ubuntu box (or an LXC container on `alo-server-lap` — recommended, lower cost), then run the same `deploy/ubuntu-setup.sh` + `scripts/go-live.sh` against `agents.alolabs.net` instead of `hosting.alolabs.net`. The two panels share the same code but separate databases and separate systemd units.

```bash
# On the new host (or in the container):
sudo DOMAIN=agents.alolabs.net PANEL_PORT=3052 APP_USER=alo-agents \
  bash scripts/go-live.sh
sudo DOMAIN=agents.alolabs.net \
  bash scripts/install-public-ingress.sh
```

**Evidence to record for PASS.** `curl https://agents.alolabs.net/api/health` → `{"status":"ok"}`.

---

## Issue #7 — `marketing.alolabs.net` campaign publisher not present  *(BLOCKED)*

**Symptom.** Existing CRM + email-campaign models and APIs, but no live campaign sender.

**Root cause.** The marketing app was never deployed as a separate site.

**Unblock.** Same pattern as issue #6 — provision a third site on the same host (different port, e.g. 3053), deploy the marketing app, wire via Cloudflare Tunnel to `marketing.alolabs.net`.

```bash
sudo DOMAIN=marketing.alolabs.net PANEL_PORT=3053 APP_USER=alo-marketing \
  bash scripts/go-live.sh
sudo DOMAIN=marketing.alolabs.net \
  bash scripts/install-public-ingress.sh
```

**Evidence to record for PASS.** A test campaign delivered to a real mailbox; the campaign's row in the DB with `delivered_at` set.

---

## Issue #8 — No live DNS/SSL/firewall verification + no real registrar  *(PARTIAL → PASS)*

**Symptom.** DigitalOcean-style management routes exist in code but were never tested live. Domain purchases were stubbed with a hard-coded `$12.99` and no real registrar call.

**Root cause.** No registrar API credentials; `DNS_PROVIDER_MODE=local` so DNS mutations never reached an authoritative nameserver.

**Unblock.** This PR adds `src/lib/registrar/cloudflare.ts` (real Cloudflare Registrar API client) and wires it into `src/app/api/domains/search/route.ts` and `src/app/api/domains/purchase/route.ts`. To activate:

1. Set in `/etc/alo-hosting/panel.env`:
   ```env
   DNS_PROVIDER_MODE=cloudflare
   CLOUDFLARE_ACCOUNT_ID=<from Cloudflare dashboard>
   CLOUDFLARE_API_TOKEN=<must carry Zone:DNS:Edit + Account:Registrar:Edit>
   CLOUDFLARE_ZONE_ID=<the alolabs.net zone id>
   ```
2. Restart the panel:
   ```bash
   sudo systemctl restart alo-hosting-panel
   ```
3. Verify the search endpoint:
   ```bash
   curl -fsS -H "Cookie: <auth-cookie>" \
     https://hosting.alolabs.net/api/domains/search?q=example.com | jq .
   # expect: success: true, provider: "cloudflare-registrar", available: <true|false>
   ```
4. Verify a purchase end-to-end (use a domain you actually want to buy — this charges a card on file at Cloudflare):
   ```bash
   curl -fsS -X POST -H "Cookie: <auth-cookie>" -H "Content-Type: application/json" \
     https://hosting.alolabs.net/api/domains/purchase \
     -d '{"domain":"<your-test>.com","years":1,"auto_renew":false,"whois_privacy":true,"contact":{"first_name":"...","last_name":"...","email":"...","phone":"...","address":"...","city":"...","state":"...","zip":"...","country":"US"}}' \
     | jq .
   # expect: registrar.submitted: true, registrar.orderId: "<cloudflare-order-id>"
   ```

**Honesty contract.** If the registrar is not configured, the purchase route still creates an Order row (so the customer's intent is durable) but returns `registrar.submitted: false` with the missing env vars listed — it never fabricates a success.

**Evidence to record for PASS.** The two `curl` outputs above; the Cloudflare dashboard showing the new domain in the Registrar list; the DNS records created by `provisionDefaultDns` (A, CNAME, MX, TXT) visible in the zone.

---

## After all 8 are unblocked

Run the full verification suite:

```bash
bash scripts/server-doctor.sh
node scripts/verify-deploy-http.mjs https://hosting.alolabs.net
node scripts/e2e-smoke.mjs https://hosting.alolabs.net
```

All three should exit 0. Then update `docs/ROADMAP-STATUS.md` to flip each row from BLOCKED/PARTIAL to PASS, with the evidence captured above linked from the table cell.
