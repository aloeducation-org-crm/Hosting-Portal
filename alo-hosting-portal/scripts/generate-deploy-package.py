#!/usr/bin/env python3
"""
ALO Labs AgentOS — Complete Production Deployment Package Generator
Generates 60+ files for a production-ready Ubuntu 22.04 deployment.
"""

import os

BASE = "/home/z/my-project/download/alolabs-deployment-package"

def w(path, content):
    """Write file, creating dirs as needed."""
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content)
    print(f"  ✓ {path}")

# ═══════════════════════════════════════════════════════════════════════════════
# 1. ROOT CONFIG FILES
# ═══════════════════════════════════════════════════════════════════════════════

w(".env.example", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Environment Configuration Template
# Copy this file to .env and fill in production values
# ══════════════════════════════════════════════════════════════

# ── Application ───────────────────────────────────────────────
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
APP_URL=https://alolabs.net
APP_NAME="ALO Labs AgentOS"

# ── Database (SQLite) ─────────────────────────────────────────
DATABASE_URL=file:./db/agentos.db

# ── Authentication ────────────────────────────────────────────
TOKEN_SECRET=CHANGE-ME-USE-openssl-rand-hex-32-HERE
TOKEN_EXPIRY=168h

# ── Admin Account (created on first run) ──────────────────────
ADMIN_EMAIL=admin@alolabs.net
ADMIN_PASSWORD=CHANGE-ME-STRONG-PASSWORD-HERE

# ── Email (SMTP) ─────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="ALO Labs <noreply@alolabs.net>"

# ── Caddy Reverse Proxy ───────────────────────────────────────
CADDY_DOMAIN=alolabs.net
CADDY_EMAIL=admin@alolabs.net

# ── Backups ───────────────────────────────────────────────────
BACKUP_DIR=/opt/alolabs/backups
BACKUP_RETENTION_DAYS=30
AUTO_BACKUP_HOUR=3

# ── Monitoring ────────────────────────────────────────────────
HEALTH_CHECK_PORT=3000
HEALTH_CHECK_PATH=/api/health
LOG_LEVEL=info

# ── Security ──────────────────────────────────────────────────
CORS_ORIGIN=https://alolabs.net
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=15m
CSRF_SECRET=CHANGE-ME-CSRF-SECRET-HERE
""")

w(".env.production", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Production Environment
# ⚠️  DO NOT commit this file to version control
# ══════════════════════════════════════════════════════════════

NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
APP_URL=https://alolabs.net
APP_NAME="ALO Labs AgentOS"

DATABASE_URL=file:./db/agentos.db

# Generate with: openssl rand -hex 32
TOKEN_SECRET=REPLACE_WITH_GENERATED_SECRET
TOKEN_EXPIRY=168h

ADMIN_EMAIL=admin@alolabs.net
ADMIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=REPLACE_WITH_EMAIL
SMTP_PASS=REPLACE_WITH_APP_PASSWORD
SMTP_FROM="ALO Labs <noreply@alolabs.net>"

CADDY_DOMAIN=alolabs.net
CADDY_EMAIL=admin@alolabs.net

BACKUP_DIR=/opt/alolabs/backups
BACKUP_RETENTION_DAYS=30
AUTO_BACKUP_HOUR=3

HEALTH_CHECK_PORT=3000
HEALTH_CHECK_PATH=/api/health
LOG_LEVEL=info

CORS_ORIGIN=https://alolabs.net
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=15m
CSRF_SECRET=REPLACE_WITH_GENERATED_SECRET
""")

w(".gitignore", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS
# ══════════════════════════════════════════════════════════════

# Dependencies
node_modules/
.pnp/
.pnp.js

# Build output
.next/
out/
dist/
build/
*.tsbuildinfo
next-env.d.ts

# Database
db/*.db
db/*.db-journal
db/*.db-wal
*.sqlite
*.sqlite3
sqlite/agentos.db

# Environment
.env
.env.local
.env.production
.env.*.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
dev.log
server.log

# Backup files
backups/
*.bak
*.backup

# Uploads & storage
uploads/
storage/
*.tmp

# IDE
.vscode/
!.vscode/settings.json
!.vscode/extensions.json
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# PM2
.pm2/
pids/

# Docker
docker-compose.override.yml

# Testing
coverage/
.nyc_output/

# Misc
.cache/
.temp/
*.tgz
""")

w("docker-compose.yml", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Docker Compose (Production)
# Usage: docker compose up -d --build
# ══════════════════════════════════════════════════════════════

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: alolabs-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/data/db/agentos.db
      - TOKEN_SECRET=${TOKEN_SECRET}
      - TOKEN_EXPIRY=${TOKEN_EXPIRY:-168h}
      - ADMIN_EMAIL=${ADMIN_EMAIL:-admin@alolabs.net}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_PORT=${SMTP_PORT:-587}
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASS=${SMTP_PASS}
      - SMTP_FROM=${SMTP_FROM:-"ALO Labs <noreply@alolabs.net>"}
      - APP_URL=${APP_URL:-https://alolabs.net}
      - CORS_ORIGIN=${CORS_ORIGIN:-https://alolabs.net}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    volumes:
      - app-data:/data/db
      - uploads-data:/data/uploads
      - logs-data:/data/logs
    networks:
      - alolabs-net
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"
        reservations:
          memory: 512M
          cpus: "0.5"

  caddy:
    image: caddy:2-alpine
    container_name: alolabs-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - alolabs-net
    depends_on:
      app:
        condition: service_healthy

volumes:
  app-data:
    driver: local
  uploads-data:
    driver: local
  logs-data:
    driver: local
  caddy-data:
    driver: local
  caddy-config:
    driver: local

networks:
  alolabs-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
""")

w("Dockerfile", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Production Dockerfile (multi-stage)
# ══════════════════════════════════════════════════════════════

# ── Stage 1: Dependencies ─────────────────────────────────────
FROM node:24-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \\
    openssl \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# ── Stage 2: Build ────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npx prisma generate
RUN npm run build

# ── Stage 3: Production ───────────────────────────────────────
FROM node:24-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \\
    openssl \\
    curl \\
    tini \\
    && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs \\
    && adduser --system --uid 1001 nextjs

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN mkdir -p /data/db /data/uploads /data/logs \\
    && chown -R nextjs:nodejs /data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \\
    CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
""")

w("Dockerfile.dev", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Development Dockerfile
# Usage: docker compose -f docker-compose.dev.yml up --build
# ══════════════════════════════════════════════════════════════

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \\
    openssl \\
    git \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate
RUN npx prisma db push

COPY . .

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["npm", "run", "dev"]
""")

w("Caddyfile", """# ══════════════════════════════════════════════════════════════
# ALO Labs AgentOS — Caddy Reverse Proxy Configuration
# Place at /etc/caddy/Caddyfile or mount in Docker
# ══════════════════════════════════════════════════════════════

{
    # Global options
    email admin@alolabs.net
    admin off

    # Logging
    log {
        output file /var/log/caddy/alolabs.log {
            roll_size 100mb
            roll_keep 5
        }
        format json
    }
}

# ── Main Domain ───────────────────────────────────────────────
alolabs.net {
    # Automatic HTTPS via Let's Encrypt
    encode gzip zstd

    # Security headers
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    }

    # Rate limiting
    rate_limit {
        zone api {
            key {remote_host}
            events 100
            window 15m
        }
    }

    # Reverse proxy to Next.js app
    reverse_proxy app:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up Connection ""
        transport http {
            pool max_idle_conns 20
            pool max_idle_conns_per_host 10
        }
    }

    # Static files cache
    @static path /_next/static/* /favicon.ico /robots.txt
    header @static Cache-Control "public, max-age=31536000, immutable"

    # Health check bypass
    @health path /api/health
    header @health Cache-Control "no-cache, no-store"
}

# ── Redirect www to apex ─────────────────────────────────────
www.alolabs.net {
    redir https://alolabs.net{uri} permanent
}

# ── HTTP to HTTPS redirect ────────────────────────────────────
:80 {
    redir https://alolabs.net{uri} permanent
}
""")

w("pm2.config.js", """// ══════════════════════════════════════════════════════════════
// ALO Labs AgentOS — PM2 Configuration
// Usage: pm2 start pm2.config.js
// ══════════════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: "alolabs-agentos",
      script: ".next/standalone/server.js",
      cwd: "/opt/alolabs",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
        DATABASE_URL: "file:/opt/alolabs/db/agentos.db",
      },
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "/opt/alolabs/logs/pm2-error.log",
      out_file: "/opt/alolabs/logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
    },
  ],
};
""")

w("ecosystem.config.js", """// ══════════════════════════════════════════════════════════════
// ALO Labs AgentOS — PM2 Ecosystem Config (Extended)
// Usage: pm2 start ecosystem.config.js --env production
// ══════════════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: "alolabs-agentos",
      script: ".next/standalone/server.js",
      cwd: "/opt/alolabs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 4000,

      env: {
        NODE_ENV: "development",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
        DATABASE_URL: "file:/opt/alolabs/db/agentos.db",
        TOKEN_SECRET: "dev-secret-change-in-production",
        TOKEN_EXPIRY: "168h",
        LOG_LEVEL: "debug",
      },

      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
        DATABASE_URL: "file:/opt/alolabs/db/agentos.db",
        TOKEN_SECRET: "REPLACE_WITH_PROD_SECRET",
        TOKEN_EXPIRY: "168h",
        LOG_LEVEL: "info",
        CORS_ORIGIN: "https://alolabs.net",
        APP_URL: "https://alolabs.net",
      },

      // Logging
      error_file: "/opt/alolabs/logs/error.log",
      out_file: "/opt/alolabs/logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,

      // Cron restart (weekly)
      cron_restart: "0 4 * * 0",
    },
  ],

  deploy: {
    production: {
      user: "alolabs",
      host: "alolabs.net",
      ref: "origin/main",
      repo: "git@github.com:alolabs/agentos.git",
      path: "/opt/alolabs",
      "pre-deploy-local": "",
      "post-deploy":
        "npm install --production && npm run build && pm2 reload ecosystem.config.js --env production",
      "pre-setup": "",
    },
  },
};
""")

w("next.config.js", """// ══════════════════════════════════════════════════════════════
// ALO Labs AgentOS — Next.js Configuration
// ══════════════════════════════════════════════════════════════

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for Docker / PM2 deployment
  output: "standalone",

  // TypeScript — strict in production
  typescript: {
    ignoreBuildErrors: false,
  },

  // React strict mode
  reactStrictMode: false,

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.alolabs.net",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },

  // Webpack config
  webpack: (config, { isServer }) => {
    // Optimize bundle size
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },

  // Experimental features
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "@radix-ui/react-icons",
    ],
  },
};

module.exports = nextConfig;
""")

w("tsconfig.json", """{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      { "name": "next" }
    ],
    "paths": {
      "@/*": ["./src/*"]
    },
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "db", "scripts", "backups"]
}
""")

w("tailwind.config.js", """// ══════════════════════════════════════════════════════════════
// ALO Labs AgentOS — Tailwind CSS Configuration
// ══════════════════════════════════════════════════════════════

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // ALO Labs brand colors
        alo: {
          purple: "#6C3CE1",
          "purple-light": "#8B5CF6",
          "purple-lighter": "#A78BFA",
          "purple-dark": "#5521C5",
          "purple-darker": "#3B1580",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
""")

w("postcss.config.js", """// ══════════════════════════════════════════════════════════════
// ALO Labs AgentOS — PostCSS Configuration
// ══════════════════════════════════════════════════════════════

module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
""")

print("\n[1/8] Root config files done.")