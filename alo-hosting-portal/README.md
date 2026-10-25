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