<<<<<<< HEAD
# ALO Labs — Complete Project Bundle

This is the **merged master package** containing both halves of the ALO Labs
platform, delivered as a single ZIP.

## What's inside

```
alo-master/
├── README.md                          ← this file
│
├── alo-hosting-portal/                ← Part A: the Next.js web platform
│   ├── src/                           (218 source files)
│   ├── prisma/                        (schema + migrations + seed)
│   ├── helpers/                       (8 privileged admin helpers)
│   ├── server-config/                 (Caddy, systemd, nginx templates)
│   ├── server-helpers/                (7 server-side scripts)
│   ├── install-scripts/               (install.sh, update.sh, rollback.sh)
│   ├── deploy/                        (sudoers + systemd units)
│   ├── mini-services/                 (sidecar microservices)
│   ├── public/                        (logos + screenshots)
│   ├── tests/                         (vitest suites)
│   ├── examples/                      (sample configs)
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── eslint.config.mjs
│   ├── vitest.config.ts
│   ├── postcss.config.mjs
│   ├── components.json                (shadcn/ui config)
│   ├── Caddyfile
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── bun.lock + package-lock.json
│   ├── seed-platform.ts
│   ├── DEPLOY.md
│   └── README.md
│
└── alo-server-kit/                    ← Part B: 7-layer Ubuntu server setup
    ├── setup.sh                       (one-command orchestrator)
    ├── verify.sh                      (per-layer audit ✅/⚠️/❌)
    ├── status.sh                      (live snapshot)
    ├── backup.sh + restore.sh
    ├── config.env.example
    ├── lib/common.sh                  (shared helpers)
    ├── stages/
    │   ├── 00-preflight.sh             (TZ, swap, unattended-upgrades, LVM audit)
    │   ├── 01-security.sh              (SSH 2244, UFW, Fail2Ban, sysctl)
    │   ├── 02-webapp.sh                (NVM, Node LTS, PM2, Nginx, Certbot)
    │   ├── 03-databases.sh             (PG scram, MySQL validate_password, 7/30/365 backups)
    │   ├── 04-ai-infra.sh               (Ollama, LiteLLM, Open WebUI)
    │   ├── 05-ai-tools.sh              (Aider, VS Code, Continue.dev, Cline)
    │   ├── 06-ops.sh                    (Netdata, cron, Telegram, GitHub Actions)
    │   └── 07-filesync.sh              (Syncthing, Samba, basic-auth Nginx)
    ├── scripts/                       (close-ssh-22, ssh-key, rotate-litellm-key, ollama-add-model)
    ├── configs/                       (nginx, systemd, litellm, pm2, ai-tools, github-actions)
    └── demo-app/                      (Next.js 14 demo, end-to-end test target)
```

---

## Part A · alo-hosting-portal (the web app)

A full enterprise hosting control panel — Next.js 16 App Router + Prisma +
TypeScript + Tailwind + shadcn/ui. 91 API routes, 55 Prisma models, MFA, SSO,
billing, monitoring, CI/CD, SSL lifecycle, email/DNS, audit log, RBAC with 30
fine-grained permissions.

### Quick start
```bash
cd alo-hosting-portal
cp .env.example .env            # edit DB URL + secrets
npm install                     # or: bun install
npx prisma migrate deploy
npx prisma db seed
npm run dev                    # http://localhost:3000
```

### Production
- Caddy (auto-HTTPS) or Nginx reverse proxy
- PM2 cluster mode (`pm2 start ecosystem.config.cjs`)
- PostgreSQL 14 + Redis 7
- Deployed via `install-scripts/install.sh` on a fresh Ubuntu 22.04

See `alo-hosting-portal/README.md` and `DEPLOY.md` for details.

---

## Part B · alo-server-kit (the server setup)

A 7-layer staged bash kit that turns a fresh Ubuntu 22.04 box into a fully
configured dev/production server with one command. Designed for `alo-server-lap`
(Ubuntu 22.04, 15 GB RAM, user `alamin`, Tailscale IP `100.94.234.101`).

### The 7 layers
1. **Security** — SSH 2244, key-only, root disabled, UFW, Fail2Ban 3→24h, sysctl hardening
2. **Web/App** — NVM + Node LTS, PM2 cluster, Nginx, Certbot, Python venv-only
3. **Databases** — PostgreSQL (scram), MySQL 8 (validate_password), 7/30/365 backups
4. **AI Infra** — Ollama (3 models, MemoryMax=8G), LiteLLM proxy with Gemini→Groq→CF→Ollama fallbacks, Open WebUI
5. **AI Coding** — VS Code + Continue.dev + Cline + Aider, all pointing at LiteLLM
6. **Ops** — Netdata, 5-min cron health checks, Telegram alerts, GitHub Actions → SSH deploy
7. **File Sync** — Syncthing + Samba (LAN-only RW docs/projects, RO backups)

### Quick start
```bash
cd alo-server-kit
cp config.env.example config.env     # edit domain, LAN CIDR, API keys, Telegram bot
sudo ./setup.sh                     # runs all 8 stages idempotently
ssh -p 2244 alamin@100.94.234.101    # verify SSH on the new port
sudo ./scripts/close-ssh-22.sh      # close temp port 22 (lockout protection)
sudo ./verify.sh                    # audit every layer
```

See `alo-server-kit/README.md` for full details.

---

## How the two parts fit together

`alo-server-kit` provisions the underlying server (security, web stack,
databases, AI infra, monitoring, file sync). `alo-hosting-portal` is the
Next.js application that runs **on top of** that server — typically deployed to
`/srv/alo-app` (which `alo-server-kit/stages/02-webapp.sh` creates by default).

Deployment flow:
1. Run `alo-server-kit/setup.sh` on a fresh Ubuntu 22.04 box.
2. Push `alo-hosting-portal` to GitHub.
3. The kit's GitHub Actions workflow (in `alo-server-kit/configs/github-actions/deploy.yml`)
   SSH-deploys on every push to `main`:
   `git pull → npm ci → npm run build → pm2 reload`.
4. The hosting portal talks to PostgreSQL via `DATABASE_URL`
   (the kit provisions an `alo_app` user with a generated password saved to
   `/root/.alo-secrets/postgres-app.txt`).

---

## Constraints honored

- **$0 budget** — only OSS + free-tier cloud (Gemini/Groq/Cloudflare Workers AI).
- **15 GB RAM ceiling** — Ollama is `MemoryMax=8G`-capped; PM2 cluster maxes
  at 2×512 MB; Netdata/Open-WebUI/LiteLLM each ≤2 GB.
- **Nothing public except 80/443** — UFW explicitly denies Ollama (11434),
  LiteLLM (4000), Open-WebUI (3001), Netdata (19999), and DB ports (5432/3306).
- **All configs in version control** — every nginx snippet, systemd unit,
  litellm model_list, PM2 ecosystem, and GitHub Actions workflow lives in
  `alo-server-kit/configs/`.

---

## License

MIT — both halves. Fork, modify, deploy.

## Acknowledgements

Built on top of excellent open-source projects: Next.js, Prisma, Tailwind,
shadcn/ui, Nginx, Caddy, PostgreSQL, MySQL, Ollama, LiteLLM, Open WebUI,
Netdata, Syncthing, PM2, Fail2Ban, Certbot.
=======
# ALO Labs — Hosting Platform

A full-featured, production-ready web hosting platform built with modern technologies. Includes domain registration, website builder, AI agents, CRM, billing, support tickets, and more.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16+, React 19, TypeScript, TailwindCSS 4, shadcn/UI, Framer Motion |
| Backend | Next.js API Routes, Node.js 22 LTS |
| Database | PostgreSQL 17, Prisma ORM |
| Authentication | Auth.js (NextAuth), JWT, RBAC (5 roles), bcrypt, HTTP-only Cookies |
| Cache | Redis (ioredis) |
| Storage | AWS S3 Compatible |
| Logging | Pino |
| Security | Helmet, Rate Limiting, CSP, XSS Protection, Zod Validation |
| Deployment | Docker, Caddy, Systemd, Ubuntu 24.04 LTS |

## Features

### Dashboard Modules
- **Dashboard** — Overview stats, recent activity, quick actions
- **Customers** — User management with RBAC (Super Admin, Admin, Manager, Staff, Customer)
- **CRM** — Contacts, deals, pipelines, activities with Kanban board
- **Projects** — Project management with task tracking
- **Tasks** — Todo, in-progress, done with priority levels
- **Calendar** — Activity scheduling
- **Invoices** — Auto-generated with orders, status tracking
- **Subscriptions** — Plan management (Starter $2.99, Premium $3.99, Business $7.99)
- **Hosting** — Website management and deployment
- **Domains** — Search, register, DNS management
- **Websites** — AI-powered website builder
- **AI Agents** — 14+ AI agents (coding, SEO, security, marketing, design, DevOps)
- **AI Automation** — Chat with Nova AI assistant
- **Marketing** — Email campaigns, newsletter, social media
- **Email** — Email account management
- **Support Tickets** — Full ticketing system with staff assignment
- **Reports** — Analytics and reporting
- **Notifications** — Real-time notification system
- **Settings** — User profile, API keys, preferences
- **Users** — Admin user management
- **Roles & Permissions** — 5-tier RBAC system
- **Audit Log** — Track all user actions
- **Backups** — Database backup and restore

## Quick Start

### Prerequisites
- Node.js 22 LTS
- PostgreSQL 17
- Redis 7 (optional, for caching)
- npm or yarn

### 1. Clone and Install

```bash
git clone <repo-url>
cd alolabs-hosting-platform
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Random 64-character string
- `NEXTAUTH_SECRET` — Random 64-character string
- `NEXTAUTH_URL` — Your application URL

### 3. Setup Database

```bash
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

### 4. Run Development Server

```bash
npm run dev
```

The application will start at `http://127.0.0.1:3000` (or PORT from .env).

### 5. Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
alolabs-hosting-platform/
├── app/                          # Next.js App Router pages
│   ├── page.tsx                  # Landing page (Hostinger-style)
│   ├── layout.tsx                # Root layout with metadata
│   ├── globals.css               # Global styles with Tailwind
│   ├── dashboard/                # Dashboard pages
│   │   ├── page.tsx              # Main dashboard
│   │   ├── layout.tsx            # Dashboard layout with sidebar
│   │   ├── agents/               # AI Agents pages
│   │   ├── billing/              # Billing & invoices
│   │   ├── crm/                  # CRM management
│   │   ├── domains/              # Domain management
│   │   ├── email/                # Email management
│   │   ├── settings/             # Settings page
│   │   └── websites/             # Website builder
│   └── api/                      # API Routes
│       ├── route.ts              # Health check endpoint
│       ├── auth/                 # Authentication (login, signup, session, NextAuth)
│       ├── ai/                   # AI endpoints (chat, code, website, domain-advisor)
│       ├── agents/               # AI Agent CRUD and execution
│       ├── backups/              # Database backup management
│       ├── contact/              # Contact form
│       ├── crm/                  # CRM (contacts, deals, pipelines, activities)
│       ├── dashboard/            # Dashboard stats and activity
│       ├── domains/              # Domain search, purchase, management
│       ├── email/                # Email accounts
│       ├── invoices/             # Invoice management
│       ├── newsletter/           # Newsletter subscription
│       ├── notifications/        # User notifications
│       ├── orders/               # Order management
│       ├── pricing/              # Pricing plans
│       ├── projects/             # Project management
│       ├── support-tickets/      # Support ticket system
│       ├── subscriptions/        # Subscription management
│       ├── tasks/                # Task management
│       ├── upload/               # File upload (100MB, S3)
│       ├── user/                 # User profile and password
│       └── websites/             # Website CRUD
├── components/                   # React components
│   ├── alolabs/                  # Landing page components
│   ├── dashboard/                # Dashboard components
│   └── ui/                       # shadcn/UI components
├── hooks/                        # Custom React hooks
├── lib/                          # Core libraries
│   ├── auth.ts                   # JWT token + RBAC roles
│   ├── db.ts                     # Prisma client (PostgreSQL)
│   ├── logger.ts                 # Pino logger
│   ├── nextauth.ts               # Auth.js configuration
│   ├── password.ts               # bcrypt password hashing
│   ├── redis.ts                  # Redis caching layer
│   ├── response.ts               # Standard API response helpers
│   ├── security.ts               # Rate limiting, auth helpers
│   ├── seed-agents.ts            # AI agent seed data
│   ├── storage.ts                # S3 file upload/management
│   └── utils.ts                  # Utility functions
├── middleware.ts                  # Next.js middleware (auth, security headers)
├── prisma/                       # Database
│   ├── schema.prisma             # 20+ models (PostgreSQL)
│   └── seed.ts                   # Database seed script
├── scripts/                      # Operational scripts
│   ├── alolabs.service           # Systemd service file
│   ├── backup.sh                 # Database backup script
│   ├── restore.sh                # Database restore script
│   └── healthcheck.sh            # Health check script
├── .github/workflows/            # CI/CD (GitHub Actions)
├── Dockerfile                    # Multi-stage Docker build
├── docker-compose.yml            # Full stack (app + PostgreSQL + Redis)
├── Caddyfile                     # Caddy reverse proxy config
├── .env.example                  # Environment variable template
└── package.json                  # Dependencies and scripts
```

## API Standards

### Response Format
Every API returns a standardized JSON response:

**Success:**
```json
{
  "status": 200,
  "success": true,
  "message": "Operation completed",
  "data": { ... }
}
```

**Error:**
```json
{
  "status": 401,
  "success": false,
  "message": "Authentication required",
  "error": "UNAUTHORIZED"
}
```

### Authentication
Protected endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

### RBAC Roles
| Role | Level | Access |
|------|-------|--------|
| super_admin | 5 | Full system access |
| admin | 4 | Manage users, settings, all data |
| manager | 3 | Manage team data, reports |
| staff | 2 | Handle tickets, basic CRUD |
| customer | 1 | Own data only |

## Security

- **Helmet** — Security headers via Next.js config
- **Rate Limiting** — 100 req/min general, 10/15min auth
- **CSP** — Content Security Policy headers
- **XSS Protection** — X-XSS-Protection, X-Content-Type-Options headers
- **CSRF** — NextAuth CSRF tokens, SameSite cookies
- **SQL Injection** — Prisma ORM parameterized queries
- **Input Validation** — Zod schemas on all endpoints
- **Secure Cookies** — HTTP-only, SameSite=Strict, Secure in production
- **HTTPS Only** — Enforced via headers and reverse proxy

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Start production server (standalone) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript compiler check |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Deploy migrations (production) |
| `npm run db:migrate:dev` | Create and apply migrations (dev) |
| `npm run db:seed` | Seed database with initial data |
| `npm run backup` | Create database backup |
| `npm run restore` | Restore from backup |

## Demo Accounts

| Email | Password | Role |
|-------|----------|------|
| admin@alolabs.net | admin1234 | Super Admin |
| demo@alolabs.net | demo1234 | Customer |
| staff@alolabs.net | staff1234 | Staff |

## License

Private — ALO Labs
>>>>>>> origin/main
