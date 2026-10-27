# ALO Labs Production Server Specification (`alo-server-lap`)

> **Share-Ready Canonical Specification** — Integrated with **ALO Hosting Portal** (`https://hosting.alolabs.net` / `/ai/auto-deploy`).

---

## 1. Server Environment

| Attribute | Production Specification |
|---|---|
| **Host Node** | `alo-server-lap` — Ubuntu 22.04 LTS @ `103.231.239.79` |
| **Node.js Runtime** | `v24.22.1` (managed via NVM) |
| **Package Manager** | `npm 11.19.1` |
| **Process Manager** | `PM2 7.1.1` (`/home/alamin/.pm2/logs/[app-name]-*.log`) |
| **Reverse Proxy** | `Nginx 1.18.0` (`/etc/nginx/sites-available/<domain>`) |
| **Database Options** | `PostgreSQL 14` (shared) \| `Redis 6` (shared) \| `SQLite 3.37` (standalone) |
| **CDN / DNS** | `Cloudflare` (Proxied `A` records -> `103.231.239.79`) |
| **SSL Mode** | `Cloudflare Flexible` *(upgrade to `Full (Strict)` pending — see Section 5)* |
| **Primary Framework** | `Next.js 16.x` (App Router) + Multi-Workload Web / Server / Mobile via Portal |

---

## 2. Active Domain, PM2 & Port Registry

| Domain | PM2 App | Loopback Port | Role | Notes |
|---|---|---|---|---|
| `hosting.alolabs.net` | `alo-hosting` | `3051` | **Control Plane (Reserved)** | ALO Hosting Portal & AI Automation Server |
| `*.alolabs.net` *(next)* | `<project-slug>` | `3062+` (`3062–3999`) | **Auto-Allocated Project Pool** | Automatically assigned by `/ai/auto-deploy` or `deploy-new-site.sh auto` |

> **Port Reservation Policy:** Port `3051` (`alo-hosting`), `3000` (dev), `5432` (PostgreSQL 14), `6379` (Redis 6), `7011` (Odysseus), and `8080` (internal validator) are permanently excluded from tenant auto-allocation.

---

## 3. Zero-Terminal Dashboard Deploy vs. Hardened CLI Script

### Option A — Recommended: Zero-Terminal AI Auto-Deploy Studio (No SSH Required)
1. Open **`https://hosting.alolabs.net/ai/auto-deploy`** (**AI Auto-Deploy** in the left sidebar).
2. Select **Web App**, **Server / API**, or **Mobile App**, enter your project name / `owner/repo` / domain (e.g., `blog.alolabs.net`).
3. Click **Generate AI Zero-Terminal Deploy Plan** — the portal automatically assigns the next free port starting at **`3062`**, generates your **Shareable Project Brief YAML**, **Nginx vhost**, and **Cloudflare DNS record**, encrypts secrets, and queues deployment in 1 click.

### Option B — Hardened CLI Script (`scripts/deploy-new-site.sh`)
If deploying directly from `~/projects/<app>` on `alo-server-lap`, install or invoke the hardened script (includes input sanitization, port `3051` collision guard, `npm ci`, idempotent PM2 reload, and automatic Nginx rollback if `nginx -t` fails):

```bash
cp scripts/deploy-new-site.sh ~/deploy-new-site.sh
chmod +x ~/deploy-new-site.sh

# Explicit port (3062):
~/deploy-new-site.sh blog blog.alolabs.net 3062

# Or auto-pick next free port >= 3062:
~/deploy-new-site.sh blog blog.alolabs.net auto
```

---

## 4. Shareable Project Brief Template (Developer / Client Hand-off)

*(Tip: `/ai/auto-deploy` now auto-generates this exact YAML populated for each new project with 1-click Copy!)*

```yaml
Project: [Project Name]
Deploy Target: alo-server-lap (103.231.239.79)
Domain: xxx.alolabs.net
Allocated Port: 3062 (next available)
Stack Required:
  Runtime: Node.js v24.22.1
  Framework: Next.js 16+ (App Router)
  Database: PostgreSQL 14 (shared) OR SQLite (standalone)
  Cache: Redis 6 (optional, shared)
  Package Manager: npm
Deliverables:
  - package.json with "start" script using $PORT env var
  - .env.example file
  - Working build: `npm run build`
  - Repository access
Deployment:
  Process: PM2 + Nginx reverse proxy + Cloudflare DNS
  SSL: Let's Encrypt (auto-renewed) + Cloudflare proxy
  Logs: /home/alamin/.pm2/logs/[app-name]-*.log
```

---

## 5. Safe Upgrade Checklist: Cloudflare `Flexible` -> `Full (Strict)`

> **Why upgrade?** Under Cloudflare `Flexible`, traffic between Cloudflare and `103.231.239.79:80` travels over unencrypted HTTP, and enabling HTTP->HTTPS redirects in Nginx before switching Cloudflare to `Full (Strict)` causes `ERR_TOO_MANY_REDIRECTS`!

1. **Ensure ACME challenge path is served on port 80** (already included in `scripts/deploy-new-site.sh` and `deploy/nginx/hosting.alolabs.net.conf` via `/.well-known/acme-challenge/`).
2. **Issue Let's Encrypt certificate on `alo-server-lap`** (or install a Cloudflare Origin CA certificate):
   ```bash
   sudo mkdir -p /var/www/certbot
   sudo certbot --nginx -d blog.alolabs.net
   ```
3. **Switch Cloudflare SSL/TLS mode to `Full (Strict)`** (use a Cloudflare **Configuration Rule** per hostname first if other subdomains on `alolabs.net` do not yet have origin certificates on `:443`!).
4. **Verify end-to-end TLS**:
   ```bash
   curl -I http://127.0.0.1:3062
   curl -I https://blog.alolabs.net
   ```

---

## 6. Saving a Standalone Git-Versioned Copy on `alo-server-lap`

```bash
mkdir -p ~/server-docs
cp docs/SERVER-SPEC.md ~/SERVER-SPEC.md
cp docs/SERVER-SPEC.md ~/server-docs/SERVER-SPEC.md
cd ~/server-docs
git init
git add SERVER-SPEC.md
git commit -m "Initial server spec audit (alo-server-lap 103.231.239.79)"
```
