import type { WorkloadCategory } from "./types";

const SAFE_APP_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const SAFE_DOMAIN_NAME_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i;

/**
 * Canonical production specification for `alo-server-lap` (103.231.239.79).
 * Matches the operator's share-ready server audit and port registry.
 */
export const ALO_SERVER_SPEC = {
  hostName: "alo-server-lap",
  os: "Ubuntu 22.04 LTS",
  publicIp: "103.231.239.79",
  baseDomain: "alolabs.net",
  nodeVersion: "v24.22.1 (NVM)",
  npmVersion: "11.19.1",
  processManager: "PM2 7.1.1",
  reverseProxy: "Nginx 1.18.0",
  databaseOptions: ["PostgreSQL 14", "Redis 6", "SQLite 3.37"] as const,
  cdnDns: "Cloudflare (Proxied)",
  sslStatus: "Cloudflare Flexible (upgrade to Full/Strict pending)",
  primaryFramework: "Next.js 16.x (App Router)",
  controlPlane: {
    domain: "hosting.alolabs.net",
    pm2App: "alo-hosting",
    port: 3051,
  },
  portAllocation: {
    nextStartPort: 3062,
    rangeEnd: 3999,
    /** Ports reserved by system services or the control plane; never allocate to tenant apps. */
    reservedPorts: [80, 443, 22, 3000, 3051, 5432, 6379, 7011, 8080] as readonly number[],
  },
  paths: {
    projectsDirPattern: "~/projects/[app-name]",
    panelReleaseDirPattern: "/srv/alo-sites/[domain]",
    nginxSitesAvailablePattern: "/etc/nginx/sites-available/[domain]",
    nginxSitesEnabledPattern: "/etc/nginx/sites-enabled/[domain]",
    pm2LogsPattern: "/home/alamin/.pm2/logs/[app-name]-*.log",
  },
} as const;

export interface PortRegistryEntry {
  domain: string;
  pm2App: string;
  port: number;
  role: "control-plane" | "tenant-app";
  status: string;
}

/**
 * Allocates the next available loopback TCP port on `alo-server-lap`, starting
 * at 3062 by default and skipping reserved ports (including 3051 `alo-hosting`).
 */
export function allocateNextAvailablePort(
  usedPorts: Iterable<number> = [],
  preferredStart: number = ALO_SERVER_SPEC.portAllocation.nextStartPort,
): number {
  const occupied = new Set<number>(ALO_SERVER_SPEC.portAllocation.reservedPorts);
  for (const p of usedPorts) {
    if (Number.isInteger(p) && p > 0) {
      occupied.add(p);
    }
  }

  const start = Math.max(1024, Math.trunc(preferredStart));
  for (let candidate = start; candidate <= ALO_SERVER_SPEC.portAllocation.rangeEnd; candidate++) {
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }

  for (let fallback = 4000; fallback <= 49_151; fallback++) {
    if (!occupied.has(fallback)) {
      return fallback;
    }
  }

  throw new Error("No free application port available in allowed range");
}

export function assertTenantPortAllowed(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid port ${port}: must be an integer between 1024 and 65535`);
  }
  if (port === ALO_SERVER_SPEC.controlPlane.port) {
    throw new Error(
      `Port ${port} is reserved for control-plane "${ALO_SERVER_SPEC.controlPlane.pm2App}" (${ALO_SERVER_SPEC.controlPlane.domain})`,
    );
  }
}

export interface NginxSiteConfigInput {
  domain: string;
  port: number;
  /**
   * "cloudflare-http80": matches current Cloudflare Flexible (:80 origin) + ACME webroot ready for Certbot.
   * "letsencrypt-strict": full 80->443 redirect + TLS block for Cloudflare Full (Strict).
   */
  sslMode?: "cloudflare-http80" | "letsencrypt-strict";
}

export function generateNginxSiteConfig(input: NginxSiteConfigInput): string {
  const domain = input.domain.trim().toLowerCase();
  if (!SAFE_DOMAIN_NAME_REGEX.test(domain)) {
    throw new Error(`Invalid domain "${input.domain}" for Nginx configuration`);
  }
  assertTenantPortAllowed(input.port);
  const mode = input.sslMode ?? "cloudflare-http80";

  if (mode === "letsencrypt-strict") {
    return [
      `# Managed by ALO Hosting Panel (${ALO_SERVER_SPEC.hostName} @ ${ALO_SERVER_SPEC.publicIp})`,
      `# SSL Mode: Cloudflare Full (Strict) + Let's Encrypt`,
      `server {`,
      `    listen 80;`,
      `    listen [::]:80;`,
      `    server_name ${domain};`,
      ``,
      `    location /.well-known/acme-challenge/ {`,
      `        root /var/www/certbot;`,
      `        default_type "text/plain";`,
      `    }`,
      ``,
      `    location / {`,
      `        return 301 https://$host$request_uri;`,
      `    }`,
      `}`,
      ``,
      `server {`,
      `    listen 443 ssl;`,
      `    listen [::]:443 ssl;`,
      `    http2 on;`,
      `    server_name ${domain};`,
      ``,
      `    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;`,
      `    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;`,
      `    server_tokens off;`,
      `    client_max_body_size 50M;`,
      ``,
      `    location / {`,
      `        proxy_pass http://127.0.0.1:${input.port};`,
      `        proxy_http_version 1.1;`,
      `        proxy_set_header Upgrade $http_upgrade;`,
      `        proxy_set_header Connection 'upgrade';`,
      `        proxy_set_header Host $host;`,
      `        proxy_set_header X-Real-IP $remote_addr;`,
      `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
      `        proxy_set_header X-Forwarded-Proto $scheme;`,
      `        proxy_cache_bypass $http_upgrade;`,
      `    }`,
      `}`,
    ].join("\n");
  }

  return [
    `# Managed by ALO Hosting Panel (${ALO_SERVER_SPEC.hostName} @ ${ALO_SERVER_SPEC.publicIp})`,
    `# File: /etc/nginx/sites-available/${domain}`,
    `server {`,
    `    listen 80;`,
    `    listen [::]:80;`,
    `    server_name ${domain};`,
    `    server_tokens off;`,
    `    client_max_body_size 50M;`,
    ``,
    `    location /.well-known/acme-challenge/ {`,
    `        root /var/www/certbot;`,
    `        default_type "text/plain";`,
    `    }`,
    ``,
    `    location / {`,
    `        proxy_pass http://127.0.0.1:${input.port};`,
    `        proxy_http_version 1.1;`,
    `        proxy_set_header Upgrade $http_upgrade;`,
    `        proxy_set_header Connection 'upgrade';`,
    `        proxy_set_header Host $host;`,
    `        proxy_set_header X-Real-IP $remote_addr;`,
    `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
    `        proxy_set_header X-Forwarded-Proto $scheme;`,
    `        proxy_cache_bypass $http_upgrade;`,
    `    }`,
    `}`,
  ].join("\n");
}

export interface ShareableBriefInput {
  projectName: string;
  appSlug: string;
  domain: string;
  port: number;
  workloadCategory: WorkloadCategory;
  framework: string;
  runtime: string;
  databaseOption?: "PostgreSQL 14 (shared)" | "SQLite (standalone)" | "PostgreSQL 14 (shared) OR SQLite (standalone)";
  useRedis?: boolean;
}

export function generateShareableProjectBriefYaml(input: ShareableBriefInput): string {
  const safeApp = SAFE_APP_NAME_REGEX.test(input.appSlug)
    ? input.appSlug
    : input.appSlug.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "app";
  const domain = input.domain.trim().toLowerCase();
  const runtimeLabel =
    input.runtime === "node" || input.runtime === "static"
      ? "Node.js v24.22.1"
      : input.runtime;
  const frameworkLabel =
    input.framework === "nextjs"
      ? "Next.js 16+ (App Router)"
      : `${input.framework} (${input.workloadCategory.toUpperCase()})`;
  const dbChoice =
    input.databaseOption ?? "PostgreSQL 14 (shared) OR SQLite (standalone)";
  const redisChoice =
    input.useRedis === true ? "Redis 6 (shared, enabled)" : "Redis 6 (optional, shared)";

  const deliverableStartLine =
    input.workloadCategory === "mobile"
      ? `- Mobile/Web export script producing static/OTA bundle (${input.framework})`
      : `- package.json / start entrypoint honoring $PORT env var (bound to 127.0.0.1:${input.port})`;

  return [
    `Project: ${input.projectName}`,
    `Deploy Target: ${ALO_SERVER_SPEC.hostName} (${ALO_SERVER_SPEC.publicIp})`,
    `Domain: ${domain}`,
    `Allocated Port: ${input.port} (next available)`,
    `Workload Category: ${input.workloadCategory}`,
    `Stack Required:`,
    `  Runtime: ${runtimeLabel}`,
    `  Framework: ${frameworkLabel}`,
    `  Database: ${dbChoice}`,
    `  Cache: ${redisChoice}`,
    `  Package Manager: npm (${ALO_SERVER_SPEC.npmVersion})`,
    `Deliverables:`,
    `  ${deliverableStartLine}`,
    `  - .env.example file`,
    `  - Working build: \`npm run build\``,
    `  - Repository access`,
    `Deployment:`,
    `  Process: PM2 (${ALO_SERVER_SPEC.processManager}) + Nginx reverse proxy + Cloudflare DNS`,
    `  SSL: Let's Encrypt (auto-renewed) + Cloudflare proxy`,
    `  Logs: /home/alamin/.pm2/logs/${safeApp}-*.log`,
  ].join("\n");
}

export function generateCloudflareAndCliChecklist(params: {
  appSlug: string;
  domain: string;
  port: number;
}) {
  const safeApp = SAFE_APP_NAME_REGEX.test(params.appSlug)
    ? params.appSlug
    : params.appSlug.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "app";
  const domain = params.domain.trim().toLowerCase();

  return {
    dnsRecord: {
      type: "A" as const,
      name: domain,
      content: ALO_SERVER_SPEC.publicIp,
      proxied: true,
    },
    cliCommand: `./scripts/deploy-new-site.sh ${safeApp} ${domain} ${params.port}`,
    verificationCommands: [
      `curl -I http://127.0.0.1:${params.port}`,
      `curl -I https://${domain}`,
    ],
  };
}
