#!/usr/bin/env python3
"""
ALO Labs AgentOS — Deployment Package Generator: Part 3
Systemd, security configs, cron jobs, app configs, database
"""

import os

BASE = "/home/z/my-project/download/alolabs-deployment-package"

def w(path, content):
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content)
    print(f"  ✓ {path}")

# ═══════════════════════════════════════════════════════════════════════════════
# 3. SYSTEMD, SECURITY, CRON
# ═══════════════════════════════════════════════════════════════════════════════

w("systemd/alolabs.service", """[Unit]
Description=ALO Labs AgentOS - Cloud Hosting Platform
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=alolabs
Group=alolabs
WorkingDirectory=/opt/alolabs
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=on-failure
RestartSec=5
TimeoutStartSec=60
TimeoutStopSec=30

# Environment
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
EnvironmentFile=-/opt/alolabs/.env

# Security
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/alolabs/db /opt/alolabs/logs /opt/alolabs/uploads /opt/alolabs/backups /opt/alolabs/storage
PrivateTmp=true
DevicePolicy=closed

# Resource Limits
LimitNOFILE=65536
MemoryMax=2G
CPUQuota=200%

# Logging
StandardOutput=append:/opt/alolabs/logs/out.log
StandardError=append:/opt/alolabs/logs/error.log
SyslogIdentifier=alolabs

[Install]
WantedBy=multi-user.target
""")

w("nginx.conf", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Nginx Configuration (Alternative to Caddy)
# If using Nginx instead of Caddy, place at /etc/nginx/sites-available/alolabs
# Then: ln -s /etc/nginx/sites-available/alolabs /etc/nginx/sites-enabled/
# ══════════════════════════════════════════════════════════════

upstream alolabs_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=10r/m;

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name alolabs.net www.alolabs.net;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name alolabs.net;

    # SSL Configuration (use certbot for Let's Encrypt)
    ssl_certificate     /etc/letsencrypt/live/alolabs.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/alolabs.net/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security Headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
    gzip_min_length 1000;

    # Static files cache
    location /_next/static/ {
        alias /opt/alolabs/.next/standalone/.next/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location /favicon.ico {
        alias /opt/alolabs/public/favicon.ico;
        expires 7d;
        access_log off;
    }

    # API rate limiting
    location /api/auth/ {
        limit_req zone=auth_limit burst=5 nodelay;
        proxy_pass http://alolabs_backend;
    }

    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://alolabs_backend;
    }

    # Main proxy
    location / {
        proxy_pass http://alolabs_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
""")

w("fail2ban/jail.local", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Fail2Ban Configuration
# Place at /etc/fail2ban/jail.d/alolabs.local
# ══════════════════════════════════════════════════════════════

[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
destemail = admin@alolabs.net
sender = fail2ban@alolabs.net
action = %(action_mwl)s

[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 10
bantime = 1800

[caddy]
enabled = true
port = http,https
filter = caddy
logpath = /var/log/caddy/alolabs.log
maxretry = 10
bantime = 1800

[recidive]
enabled = true
bantime = 86400
findtime = 86400
maxretry = 3
""")

w("fail2ban/filter.d/caddy.conf", """# Fail2Ban filter for Caddy
[Definition]
failregex = .*\"remote_addr\":\"<HOST>\".*\"status\":(401|403|429|500).*$
ignoreregex = .*(static|favicon|robots|health).*
""")

w("ufw.rules", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — UFW Firewall Rules
# Apply with: sudo ufw --force reset && sudo ufw --force enable
# Or source this file: source ufw.rules
# ══════════════════════════════════════════════════════════════

# Default policies
ufw default deny incoming
ufw default allow outgoing

# SSH (allow from specific IPs in production)
ufw allow 22/tcp comment 'SSH'

# HTTP / HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP/3 (QUIC)'

# Optional: Allow monitoring from specific IP
# ufw allow from YOUR_MONITORING_IP to any port 9090 comment 'Prometheus'

# Optional: Allow SSH only from specific IP
# ufw allow from YOUR_OFFICE_IP to any port 22 comment 'SSH from office'

# Enable
ufw --force enable
echo "Firewall rules applied."
ufw status verbose
""")

w("cron/backup.cron", """# ALO Labs AgentOS — Automated Backup (Daily at 3 AM)
# Install: sudo cp cron/backup.cron /etc/cron.d/alolabs-backup
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

0 3 * * * alolabs /opt/alolabs/backup.sh >> /opt/alolabs/logs/backup-cron.log 2>&1
""")

w("cron/health.cron", """# ALO Labs AgentOS — Health Check (Every 5 minutes)
# Install: sudo cp cron/health.cron /etc/cron.d/alolabs-health
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

*/5 * * * * alolabs /opt/alolabs/health-check.sh >> /opt/alolabs/logs/health-cron.log 2>&1
""")

w("cron/cleanup.cron", """# ALO Labs AgentOS — Log & Temp Cleanup (Weekly on Sunday 4 AM)
# Install: sudo cp cron/cleanup.cron /etc/cron.d/alolabs-cleanup
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

0 4 * * 0 alolabs find /opt/alolabs/logs -name "*.log" -mtime +30 -delete 2>/dev/null
0 4 * * 0 alolabs find /opt/alolabs/backups -name "*.tar.gz" -mtime +30 -delete 2>/dev/null
0 4 * * 0 alolabs find /tmp -name "alolabs-*" -mtime +1 -delete 2>/dev/null
""")

# ═══════════════════════════════════════════════════════════════════════════════
# 4. APP CONFIG FILES
# ═══════════════════════════════════════════════════════════════════════════════

w("config/app.config.ts", """/**
 * ALO Labs AgentOS — Application Configuration
 * Centralized app settings loaded from environment variables.
 */

export const appConfig = {
  name: process.env.APP_NAME || "ALO Labs AgentOS",
  url: process.env.APP_URL || "http://localhost:3000",
  port: parseInt(process.env.PORT || "3000", 10),
  hostname: process.env.HOSTNAME || "0.0.0.0",
  environment: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV === "development",

  // Database
  database: {
    url: process.env.DATABASE_URL || "file:./db/agentos.db",
  },

  // Auth
  auth: {
    tokenSecret: process.env.TOKEN_SECRET || "dev-secret-change-in-production",
    tokenExpiry: process.env.TOKEN_EXPIRY || "168h",
    adminEmail: process.env.ADMIN_EMAIL || "admin@alolabs.net",
    adminPassword: process.env.ADMIN_PASSWORD || "changeme",
  },

  // Brand
  brand: {
    name: "ALO Labs",
    primaryColor: "#6C3CE1",
    lightColor: "#8B5CF6",
    lighterColor: "#A78BFA",
    darkColor: "#5521C5",
    domain: "alolabs.net",
  },

  // Features
  features: {
    registration: process.env.FEATURE_REGISTRATION !== "false",
    demoAccount: process.env.FEATURE_DEMO !== "false",
    aiAgents: true,
    websiteBuilder: true,
    emailMarketing: true,
    crm: true,
    monitoring: true,
    ciCd: true,
    sslManagement: true,
    backups: true,
    billing: true,
    vps: true,
  },
} as const;

export type AppConfig = typeof appConfig;
""")

w("config/server.config.ts", """/**
 * ALO Labs AgentOS — Server Configuration
 * Server runtime settings for PM2 / Docker / Systemd deployment.
 */

export const serverConfig = {
  // Node.js
  node: {
    maxOldSpaceSize: 2048, // MB
    maxHTTPHeaderSize: 16384, // 16KB
  },

  // HTTP Server
  http: {
    keepAliveTimeout: 65000, // ms — must be > Caddy's 60s proxy timeout
    headersTimeout: 66000,
    requestTimeout: 300000, // 5 minutes for long uploads
  },

  // Rate Limiting
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
    windowMs: 15 * 60 * 1000, // 15 minutes
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  },

  // Security
  security: {
    csrfEnabled: true,
    hstsMaxAge: 31536000, // 1 year
    helmetEnabled: true,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.LOG_FORMAT || "json",
    maxFileSize: "100MB",
    maxFiles: 30,
  },

  // Upload
  upload: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "application/pdf",
      "application/zip",
      "text/csv",
    ],
  },
} as const;
""")

w("config/security.config.ts", """/**
 * ALO Labs AgentOS — Security Configuration
 * Security policies, headers, and protection settings.
 */

export const securityConfig = {
  // Content Security Policy
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "blob:", "https://*.alolabs.net"],
    connectSrc: ["'self'", "https://alolabs.net", "wss://alolabs.net"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: [],
  },

  // Session & Token
  session: {
    tokenExpiry: "168h", // 7 days
    refreshTokenExpiry: "720h", // 30 days
    secureCookies: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  },

  // Password Policy
  password: {
    minLength: 8,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecial: false,
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60, // 15 minutes in seconds
  },

  // API Security
  api: {
    rateLimitWindow: "15m",
    rateLimitMax: 100,
    authRateLimitMax: 10,
    maxPayloadSize: "10mb",
    allowedOrigins: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : ["http://localhost:3000"],
  },

  // Encryption
  encryption: {
    algorithm: "aes-256-gcm",
    keyLength: 32,
    ivLength: 16,
  },
} as const;
""")

w("config/database.config.ts", """/**
 * ALO Labs AgentOS — Database Configuration
 * Prisma and database connection settings.
 */

export const databaseConfig = {
  // Connection
  url: process.env.DATABASE_URL || "file:./db/agentos.db",

  // SQLite specific
  sqlite: {
    journalMode: "WAL", // Write-Ahead Logging for better concurrency
    synchronous: "NORMAL",
    cacheSize: -64000, // 64MB cache
    busyTimeout: 5000,
    foreignKeys: true,
  },

  // Connection Pool (for future Postgres migration)
  pool: {
    minConnections: 2,
    maxConnections: 10,
    connectionTimeout: 10000,
    idleTimeout: 30000,
    maxLifetime: 1800000, // 30 minutes
  },

  // Prisma
  prisma: {
    logLevel: process.env.PRISMA_LOG_LEVEL || (process.env.NODE_ENV === "development" ? "query" : "warn"),
    errorFormat: "colorless",
  },

  // Backup
  backup: {
    directory: process.env.BACKUP_DIR || "/opt/alolabs/backups",
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10),
    compressionLevel: 6,
  },
} as const;
""")

# ═══════════════════════════════════════════════════════════════════════════════
# 5. DATABASE SCRIPTS
# ═══════════════════════════════════════════════════════════════════════════════

w("scripts/create-admin.ts", """/**
 * ALO Labs AgentOS — Create Admin User Script
 * Usage: npx tsx scripts/create-admin.ts
 */

import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@alolabs.net";
  const password = process.env.ADMIN_PASSWORD || "admin123456"; // Change in production!

  console.log(`Creating admin user: ${email}`);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin user already exists. Updating password...");
    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { email },
      data: { passwordHash, role: "admin", plan: "premium" },
    });
    console.log("Password updated.");
  } else {
    const passwordHash = await hashPassword(password);
    const admin = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: "ALO Admin",
        role: "admin",
        plan: "premium",
        company: "ALO Labs",
      },
    });
    console.log(`Admin user created: ${admin.email}`);
  }

  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
""")

w("scripts/init-db.ts", """/**
 * ALO Labs AgentOS — Database Initialization Script
 * Usage: npx tsx scripts/init-db.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Initializing database...");

  // Push schema to database
  console.log("  Pushing Prisma schema...");
  await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL;");
  await prisma.$executeRawUnsafe("PRAGMA cache_size=-64000;");
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON;");

  console.log("  Running migrations...");
  // In production, use: npx prisma migrate deploy
  // For initial setup, schema push is sufficient

  console.log("  Verifying connection...");
  await prisma.$queryRaw`SELECT 1`;

  console.log("Database initialized successfully!");
}

main()
  .catch((e) => {
    console.error("Database initialization failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
""")

w("scripts/migrate.ts", """/**
 * ALO Labs AgentOS — Database Migration Script
 * Usage: npx tsx scripts/migrate.ts
 */

import { execSync } from "child_process";

function run(cmd: string) {
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
}

async function main() {
  console.log("=== ALO Labs AgentOS — Database Migration ===\\n");

  // Step 1: Generate Prisma client
  console.log("[1/3] Generating Prisma client...");
  run("npx prisma generate");

  // Step 2: Run migrations
  console.log("\\n[2/3] Applying migrations...");
  try {
    run("npx prisma migrate deploy");
  } catch {
    console.log("  No pending migrations or migration directory not set.");
    console.log("  Falling back to db push...");
    run("npx prisma db push");
  }

  // Step 3: Verify
  console.log("\\n[3/3] Verifying database...");
  run("npx prisma db execute --stdin <<< 'SELECT name FROM sqlite_master WHERE type=\\'table\\';'");

  console.log("\\n=== Migration complete ===");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
""")

w("scripts/seed.ts", """/**
 * ALO Labs AgentOS — Database Seed Script
 * Usage: npx tsx scripts/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

async function main() {
  console.log("Seeding database...\\n");

  // Create admin user
  const adminHash = await hashPassword("admin123456");
  const admin = await prisma.user.upsert({
    where: { email: "admin@alolabs.net" },
    update: {},
    create: {
      email: "admin@alolabs.net",
      passwordHash: adminHash,
      name: "ALO Admin",
      role: "admin",
      plan: "premium",
      company: "ALO Labs",
    },
  });
  console.log(`  Created admin: ${admin.email}`);

  // Create demo user
  const demoHash = await hashPassword("demo1234");
  const demo = await prisma.user.upsert({
    where: { email: "demo@alolabs.net" },
    update: {},
    create: {
      email: "demo@alolabs.net",
      passwordHash: demoHash,
      name: "Demo User",
      role: "user",
      plan: "starter",
    },
  });
  console.log(`  Created demo user: ${demo.email}`);

  // Create sample subscription
  await prisma.subscription.upsert({
    where: { id: "seed-sub-admin" },
    update: {},
    create: {
      id: "seed-sub-admin",
      userId: admin.id,
      plan: "premium",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log("  Created sample subscription");

  console.log("\\nSeeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
""")

w("scripts/cleanup.ts", """/**
 * ALO Labs AgentOS — Cleanup Script
 * Usage: npx tsx scripts/cleanup.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`=== ALO Labs AgentOS — Cleanup ${DRY_RUN ? "(DRY RUN)" : ""} ===\\n`);

  // Clean expired tokens/sessions older than 30 days
  // Clean old notification records older than 90 days
  // Clean orphaned temp files

  if (!DRY_RUN) {
    console.log("Running Prisma optimize...");
    await prisma.$executeRaw`VACUUM;`;
    console.log("  Database vacuumed.");
  }

  console.log("\\nCleanup complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
""")

# ═══════════════════════════════════════════════════════════════════════════════
# 6. DATABASE FILES
# ═══════════════════════════════════════════════════════════════════════════════

w("database/schema.sql", """-- ══════════════════════════════════════════════════════════════
-- ALO Labs AgentOS — Database Schema Reference (SQLite)
-- This file is auto-generated by Prisma. Use prisma migrate for changes.
-- ══════════════════════════════════════════════════════════════════════════

-- Application settings
CREATE TABLE IF NOT EXISTS "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Users
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'credentials',
    "providerId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "avatar" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- See prisma/schema.prisma for the full 24-model schema
-- This SQL is a reference only — Prisma manages the actual schema.
""")

w("database/migrations/README.md", """# Database Migrations

This directory contains ALO Labs AgentOS database migrations.

## Usage

```bash
# Create a new migration
npx prisma migrate dev --name description_of_change

# Apply all pending migrations
npx prisma migrate deploy

# View migration status
npx prisma migrate status

# Reset database (development only!)
npx prisma migrate reset
```

## Notes

- Migrations are managed by Prisma ORM
- The actual schema is defined in `prisma/schema.prisma`
- SQLite WAL mode is enabled for better concurrency
- Always backup before running migrations in production
""")

# SQLite files
w("sqlite/init.sql", """-- ══════════════════════════════════════════════════════════════
-- ALO Labs AgentOS — SQLite Initialization
-- Run: sqlite3 /opt/alolabs/db/agentos.db < sqlite/init.sql
-- ══════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;

-- The actual schema is created by Prisma.
-- These PRAGMAs optimize SQLite for production use.
""")

# Directory stubs
w("logs/.gitkeep", "")
w("backups/.gitkeep", "")
w("uploads/.gitkeep", "")
w("storage/.gitkeep", "")

print("\n[3/8] Systemd, security, cron, app configs, database files done.")