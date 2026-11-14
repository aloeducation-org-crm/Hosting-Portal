# `hosting.alolabs.net` — routing, HTTPS and verification

**Goal:** the public domain reaches the control-plane panel, over HTTPS, on one canonical hostname,
with the path verified rather than assumed.

**Last updated:** 2026-11-14

---

## 1. The intended request path

```
browser
  → Cloudflare edge            (DNS is proxied; SSL mode must be Full)
  → Cloudflare Tunnel          (cloudflared, running on the origin host)
  → https://127.0.0.1:443      (nginx, TLS terminated with a Let's Encrypt cert)
  → http://127.0.0.1:3051      (Next.js standalone, bound to loopback only)
```

| Layer | Value | Source |
|---|---|---|
| Domain | `hosting.alolabs.net` | `.env.example` (`APP_URL`, `NEXTAUTH_URL`) |
| Origin host | `alo-server-lap` @ `103.231.239.79` | `src/lib/deploy/server-spec.ts` |
| App port | `3051` | `server-spec.ts` → `controlPlane.port`; `.env.example` `PORT=3051` |
| Process manager | PM2 app `alo-hosting` | `server-spec.ts` |
| Reverse proxy | nginx | `deploy/nginx/hosting.alolabs.net.conf` |
| Tunnel | cloudflared → `https://127.0.0.1:443`, `noTLSVerify: true` | `deploy/cloudflared/config.yml` |
| CDN / DNS | Cloudflare, proxied | `server-spec.ts` |

Two detail that are easy to get wrong and are load-bearing:

- `noTLSVerify: true` is **required**, not laziness. cloudflared dials `127.0.0.1` while the certificate
  is issued for `hosting.alolabs.net`, so the loopback name never matches a SAN. The connection does not
  leave the host. The alternative is `originServerName: hosting.alolabs.net`.
- Reserved ports include `3051`, so a tenant app is never allocated the control-plane port
  (`assertTenantPortAllowed`).

---

## 2. The failure this configuration exists to prevent

The symptom is a browser reporting **HTTP 530** or `ERR_TOO_MANY_REDIRECTS` while
`curl http://127.0.0.1:3051` on the server cheerfully returns 200. The app is healthy; the *path to it* is not.

Two independent settings each reproduce it:

| Setting | What happens |
|---|---|
| cloudflared ingress → `http://localhost:80` | nginx answers the tunnel's HTTP request with certbot's `301 → https://hosting.alolabs.net/`. The browser follows it, Cloudflare routes back into the same tunnel on port 80, nginx 301s again — forever. |
| Cloudflare SSL/TLS mode = **Flexible** | Cloudflare speaks HTTPS to the browser but **HTTP to the origin**. Same 301-to-https loop, from a different direction. |

The fix is the pair, and both halves are needed:

1. cloudflared terminates on **`https://127.0.0.1:443`** (never `:80`).
2. Cloudflare → SSL/TLS → Overview is set to **Full** — not Flexible, and not Full (strict).
   Full (strict) is wrong here because it rejects the origin certificate chain cloudflared presents for a
   loopback SNI.

`nginx -t` passing and `/api/health` returning 200 on loopback are both **consistent with this outage**.
Only a check that goes out through the edge and back proves the path works.

---

## 3. What is actually verified, and what is not

Measured on 2026-11-14 from a host with working DNS resolution (control: `github.com` resolves).

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1 | `hosting.alolabs.net` resolves | **VERIFIED** | `104.21.34.58`, `2606:4700:3031::ac43:9b20` — both Cloudflare ranges, so DNS is **proxied** |
| 2 | `www.hosting.alolabs.net` resolves | **VERIFIED ABSENT** | No A/AAAA/CNAME record returned. It is not misrouted — it does not exist. |
| 3 | HTTPS serves the app | **NOT VERIFIABLE HERE** | Requires egress to the origin; this environment has no outbound network except GitHub/npm/PyPI |
| 4 | Certificate identity and expiry | **NOT VERIFIABLE HERE** | Needs a TLS handshake with `hosting.alolabs.net:443` |
| 5 | Cloudflare SSL/TLS mode | **NOT VERIFIABLE HERE** | Needs `CF_API_TOKEN` + `CF_ZONE_ID`; it is a dashboard setting, not something in this repo |
| 6 | nginx / cloudflared state on the host | **NOT VERIFIABLE HERE** | No SSH access to the origin |

Rows 3–6 are gaps, not passes. This repository previously carried a fabricated server inventory
(removed in PR #20), so an unverifiable check is reported as unverifiable.

**To close rows 3–6, run the verifier on the origin host** — it measures all of them:

```bash
bash scripts/verify-production-routing.sh                 # human-readable
bash scripts/verify-production-routing.sh --json           # machine-readable
CF_API_TOKEN=... CF_ZONE_ID=... bash scripts/verify-production-routing.sh
```

Exit `0` = no failures, `1` = at least one failure, `2` = cannot run. `NOT VERIFIABLE` rows do not fail
the run; they are printed so nobody mistakes them for healthy.

---

## 4. `www` — corrected, but it needs a DNS record first

`www` was simply absent: no DNS record, and `deploy/nginx/hosting.alolabs.net.conf` declared
`server_name hosting.alolabs.net;` only, so a `www` request would have fallen through to nginx's default
vhost — the wrong service, or a 404.

Two hostnames serving the same app split cookies, search ranking and NextAuth callback URLs, so one name
must be canonical. `.env.example` already fixes the apex as canonical (`APP_URL`, `NEXTAUTH_URL`), so
`www` must redirect to it.

The config now has a `www` block, but **it stays inert until Cloudflare has a record for the name**:

1. **Cloudflare → DNS** — add a proxied CNAME:
   `CNAME` · name `www` · target `hosting.alolabs.net` · proxy **ON**

   Proxy ON matters: a "DNS only" record sends traffic to the origin IP directly, bypassing the tunnel
   and re-opening the redirect loop in §2.

2. **Certificate must cover both names**, or the browser rejects the connection during the TLS handshake
   and never receives the redirect:
   ```bash
   sudo certbot --nginx -d hosting.alolabs.net -d www.hosting.alolabs.net
   ```
   Both names on **one** `certbot` invocation is deliberate: certbot names the output directory after the
   first `-d`, so the paths already in the nginx config keep working and the SAN list covers both hosts.

3. **Install the config and reload:**
   ```bash
   sudo cp deploy/nginx/hosting.alolabs.net.conf /etc/nginx/sites-available/hosting.alolabs.net
   sudo ln -sfn /etc/nginx/sites-available/hosting.alolabs.net /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   ```

`deploy/nginx/conf.d/websocket-upgrade.conf` must be installed first — the site references
`$connection_upgrade`, and without that `map` nginx fails to start with
*"unknown connection_upgrade variable"*.

---

## 5. Applying the configuration

| Step | Command / location | Notes |
|---|---|---|
| 1 | `sudo cp deploy/nginx/conf.d/websocket-upgrade.conf /etc/nginx/conf.d/` | Defines `$connection_upgrade` in the `http{}` context |
| 2 | `sudo certbot --nginx -d hosting.alolabs.net -d www.hosting.alolabs.net` | Cover both names in one certificate |
| 3 | Install the nginx site (commands in §4.3) | Then `nginx -t` before `reload` |
| 4 | `deploy/cloudflared/config.yml` → `~/.cloudflared/config.yml` | Replace `<TUNNEL_UUID>`; origin stays `https://127.0.0.1:443` |
| 5 | `sudo systemctl restart cloudflared` | Then `cloudflared tunnel info alo-hosting` should show 2+ connectors |
| 6 | Cloudflare → SSL/TLS → Overview → **Full** | Not Flexible, not Full (strict) |
| 7 | `bash scripts/verify-production-routing.sh` | Every row should read PASS or an explained NOT VERIFIABLE |

---

## 6. Continuous verification

`scripts/verify-production-routing.sh` also runs as the **`verify-routing`** CI job, on the
self-hosted runner, for `workflow_dispatch` runs only. It is `continue-on-error: true` because some
findings depend on infrastructure CI cannot change (the Cloudflare SSL/TLS mode is a dashboard setting)
— a failure must be reported, not block a release an operator has separately approved.

Dispatch the workflow with `routing_domain` / `routing_port` to check a different target; the report is
uploaded as the `routing-report-<sha>` artifact.

---

## 7. What this document does not cover

- Whether the panel is currently **running** on `3051` (needs host access).
- Whether the Cloudflare tunnel currently has healthy **connectors** (needs `cloudflared tunnel info`).
- The tenant-app path (`3062`+ → per-domain nginx vhosts), which is separate from the control plane.
- Cloudflare account-level settings beyond SSL/TLS mode (WAF, caching, page rules).
