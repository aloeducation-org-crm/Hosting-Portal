/**
 * Cloud Projects (Appwrite-style BaaS & Sites Workspace) — Pure Domain Catalog
 *
 * Browser- and server-safe (no `node:*`, Prisma, or `next-auth` imports).
 * Reconstructs core developer-platform contracts inspected from `appwrite/appwrite`
 * (`da8e595a804834ffcf63b83140ff09b29ce77140`, BSD-3-Clause) using REA's
 * evidence-bound methodology (`morluto/rea`, MIT).
 */

import { z } from "zod";

// ─── Regions & Environment Stages ─────────────────────────────────────────────

export const CLOUD_REGIONS = [
  { id: "local-primary", label: "Local Primary Host (Self-Hosted)" },
  { id: "ap-south-1", label: "Asia Pacific South (Dhaka / Mumbai)" },
  { id: "eu-central-1", label: "Europe Central (Frankfurt)" },
  { id: "us-east-1", label: "US East (N. Virginia)" },
] as const;

export type CloudRegionId = (typeof CLOUD_REGIONS)[number]["id"];
export const CLOUD_REGION_IDS = CLOUD_REGIONS.map((r) => r.id);

export const CLOUD_STAGES = ["development", "staging", "production"] as const;
export type CloudStage = (typeof CLOUD_STAGES)[number];

// ─── Verified Appwrite Sites Framework Adapters (`app/config/frameworks.php`) ─

export interface CloudFrameworkAdapterSpec {
  readonly mode: "ssr" | "static";
  readonly installCommand: string;
  readonly buildCommand: string;
  readonly outputDirectory: string;
  readonly fallbackFile?: string;
}

export interface CloudSiteFramework {
  readonly key: string;
  readonly name: string;
  readonly buildRuntime: string;
  readonly defaultMode: "ssr" | "static";
  readonly adapters: readonly CloudFrameworkAdapterSpec[];
}

export const CLOUD_SITE_FRAMEWORKS: readonly CloudSiteFramework[] = Object.freeze([
  {
    key: "nextjs",
    name: "Next.js",
    buildRuntime: "node-22",
    defaultMode: "ssr",
    adapters: [
      { mode: "ssr", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./.next" },
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./out" },
    ],
  },
  {
    key: "tanstack-start",
    name: "TanStack Start",
    buildRuntime: "node-22",
    defaultMode: "ssr",
    adapters: [
      { mode: "ssr", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./.output" },
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist/client", fallbackFile: "index.html" },
    ],
  },
  {
    key: "react",
    name: "React (Vite / SPA)",
    buildRuntime: "node-22",
    defaultMode: "static",
    adapters: [
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist", fallbackFile: "index.html" },
    ],
  },
  {
    key: "sveltekit",
    name: "SvelteKit",
    buildRuntime: "node-22",
    defaultMode: "ssr",
    adapters: [
      { mode: "ssr", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./build" },
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./build", fallbackFile: "index.html" },
    ],
  },
  {
    key: "astro",
    name: "Astro",
    buildRuntime: "node-22",
    defaultMode: "static",
    adapters: [
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist", fallbackFile: "404.html" },
      { mode: "ssr", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist" },
    ],
  },
  {
    key: "nuxt",
    name: "Nuxt",
    buildRuntime: "node-22",
    defaultMode: "ssr",
    adapters: [
      { mode: "ssr", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./.output" },
      { mode: "static", installCommand: "npm ci", buildCommand: "npx nuxi generate", outputDirectory: "./.output/public", fallbackFile: "200.html" },
    ],
  },
  {
    key: "vue",
    name: "Vue",
    buildRuntime: "node-22",
    defaultMode: "static",
    adapters: [
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist", fallbackFile: "index.html" },
    ],
  },
  {
    key: "angular",
    name: "Angular",
    buildRuntime: "node-22",
    defaultMode: "ssr",
    adapters: [
      { mode: "ssr", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist/angular" },
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist/angular/browser", fallbackFile: "index.csr.html" },
    ],
  },
  {
    key: "analog",
    name: "Analog",
    buildRuntime: "node-22",
    defaultMode: "ssr",
    adapters: [
      { mode: "ssr", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist/analog" },
      { mode: "static", installCommand: "npm ci", buildCommand: "npm run build", outputDirectory: "./dist/analog/public", fallbackFile: "index.html" },
    ],
  },
  {
    key: "static",
    name: "Static HTML / Assets",
    buildRuntime: "static",
    defaultMode: "static",
    adapters: [
      { mode: "static", installCommand: "true", buildCommand: "true", outputDirectory: "./public", fallbackFile: "index.html" },
    ],
  },
]);

export const CLOUD_FRAMEWORK_KEYS = CLOUD_SITE_FRAMEWORKS.map((f) => f.key);

export function getCloudFrameworkPreset(key: string, preferredMode?: "ssr" | "static") {
  const framework = CLOUD_SITE_FRAMEWORKS.find((f) => f.key === key);
  if (!framework) return null;
  const adapter =
    (preferredMode ? framework.adapters.find((a) => a.mode === preferredMode) : undefined) ??
    framework.adapters.find((a) => a.mode === framework.defaultMode) ??
    framework.adapters[0]!;
  return { framework, adapter };
}

// ─── Granular Project API Scopes (`app/config/scopes/project.php`) ────────────

export const CLOUD_PROJECT_SCOPES = [
  { id: "project.read", category: "Project", description: "Read project metadata, stage, and linked resources" },
  { id: "project.write", category: "Project", description: "Update project configuration and framework settings" },
  { id: "health.read", category: "Project", description: "Verify project health and linked service status via /api/cloud/v1/health" },
  { id: "sites.read", category: "Sites", description: "Read hosted sites, domains, and deployment status" },
  { id: "sites.write", category: "Sites", description: "Trigger and configure site deployments" },
  { id: "databases.read", category: "Databases", description: "Read linked database metadata and schemas" },
  { id: "databases.write", category: "Databases", description: "Manage database tables, indexes, and records" },
  { id: "storage.read", category: "Storage", description: "List and download files from project storage buckets" },
  { id: "storage.write", category: "Storage", description: "Upload and delete files in project storage buckets" },
  { id: "functions.read", category: "Functions", description: "Read serverless function definitions and logs" },
  { id: "functions.write", category: "Functions", description: "Configure serverless functions and schedules" },
  { id: "users.read", category: "Auth", description: "Read project user directory and session summaries" },
  { id: "users.write", category: "Auth", description: "Manage project users, teams, and memberships" },
  { id: "messaging.read", category: "Messaging", description: "Read email, SMS, and push topic configurations" },
  { id: "messaging.write", category: "Messaging", description: "Queue transactional messages through configured providers" },
  { id: "webhooks.read", category: "Webhooks", description: "Read project webhook subscriptions" },
  { id: "webhooks.write", category: "Webhooks", description: "Create, update, and rotate project webhooks" },
] as const;

export type CloudProjectScope = (typeof CLOUD_PROJECT_SCOPES)[number]["id"];
const VALID_SCOPE_SET = new Set<string>(CLOUD_PROJECT_SCOPES.map((s) => s.id));

export function isCloudScope(value: string): value is CloudProjectScope {
  return VALID_SCOPE_SET.has(value);
}

/** Parse space-, comma-, JSON-array-, or array-supplied scopes, dropping duplicates and unknown scopes. */
export function parseCloudScopes(raw: string | readonly string[] | null | undefined): CloudProjectScope[] {
  if (!raw) return [];
  let tokens: readonly unknown[];
  if (Array.isArray(raw)) {
    tokens = raw;
  } else {
    const str = String(raw).trim();
    if (str.startsWith("[")) {
      try {
        const parsed = JSON.parse(str);
        tokens = Array.isArray(parsed) ? parsed : str.split(/[\s,]+/);
      } catch {
        tokens = str.split(/[\s,]+/);
      }
    } else {
      tokens = str.split(/[\s,]+/);
    }
  }
  const out: CloudProjectScope[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const trimmed = String(token).trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (isCloudScope(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

// ─── Client Platforms (`platforms.read/write`) ────────────────────────────────

export const CLOUD_PLATFORM_TYPES = [
  { id: "web", label: "Web App (Browser CORS)", kind: "hostname" },
  { id: "nextjs", label: "Next.js Web App", kind: "hostname" },
  { id: "flutter-web", label: "Flutter Web", kind: "hostname" },
  { id: "flutter-ios", label: "Flutter iOS", kind: "bundle" },
  { id: "flutter-android", label: "Flutter Android", kind: "bundle" },
  { id: "apple-ios", label: "Apple iOS", kind: "bundle" },
  { id: "apple-macos", label: "Apple macOS", kind: "bundle" },
  { id: "android", label: "Android Native", kind: "bundle" },
  { id: "react-native", label: "React Native", kind: "bundle" },
] as const;

export type CloudPlatformType = (typeof CLOUD_PLATFORM_TYPES)[number]["id"];
export const CLOUD_PLATFORM_TYPE_IDS = CLOUD_PLATFORM_TYPES.map((p) => p.id);

const WEB_HOSTNAME_PATTERN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const BUNDLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/;

export function validatePlatformIdentifier(
  type: CloudPlatformType,
  identifier: string,
  projectStage: CloudStage = "development",
): { ok: true; normalized: string } | { ok: false; reason: string } {
  const meta = CLOUD_PLATFORM_TYPES.find((p) => p.id === type);
  if (!meta) return { ok: false, reason: "Unsupported platform type." };
  const trimmed = identifier.trim();
  if (!trimmed || trimmed.length > 253 || /[\s/\\:?#@]/.test(trimmed)) {
    return { ok: false, reason: "Identifier must be a bare hostname or bundle ID (no protocol, path, port, or credentials)." };
  }
  if (meta.kind === "hostname") {
    const lower = trimmed.toLowerCase();
    if (lower === "localhost") {
      if (projectStage === "production") {
        return { ok: false, reason: "Production projects cannot allowlist localhost origins." };
      }
      return { ok: true, normalized: lower };
    }
    if (lower.startsWith("*.") && projectStage === "production" && lower.split(".").length < 3) {
      return { ok: false, reason: "Wildcard hostname requires a registrable domain." };
    }
    if (!WEB_HOSTNAME_PATTERN.test(lower)) {
      return { ok: false, reason: "Enter a valid domain hostname such as app.alolabs.net or *.alolabs.net." };
    }
    return { ok: true, normalized: lower };
  }
  if (!BUNDLE_ID_PATTERN.test(trimmed)) {
    return { ok: false, reason: "Enter a reverse-DNS bundle/package ID such as net.alolabs.student." };
  }
  return { ok: true, normalized: trimmed };
}

// ─── Project Event Webhooks & Strict SSRF Validation ──────────────────────────

export const CLOUD_WEBHOOK_EVENTS = [
  "sites.deployments.created",
  "sites.deployments.ready",
  "sites.deployments.failed",
  "databases.rows.created",
  "databases.rows.updated",
  "databases.rows.deleted",
  "storage.files.uploaded",
  "storage.files.deleted",
  "functions.executions.queued",
  "users.sessions.created",
  "security.keys.rotated",
] as const;

export type CloudWebhookEvent = (typeof CLOUD_WEBHOOK_EVENTS)[number];
const VALID_WEBHOOK_EVENTS = new Set<string>(CLOUD_WEBHOOK_EVENTS);

function isPrivateOrReservedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => n < 0 || n > 255)) return true;
  const [a, b] = nums as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // Link-local & cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

export function validateWebhookTargetUrl(rawUrl: string): { ok: true; normalized: string } | { ok: false; reason: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) {
    return { ok: false, reason: "Webhook URL must be 1–500 characters." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Webhook URL must be a valid URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Webhook targets must use HTTPS." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Webhook URLs must not embed credentials." };
  }
  if (parsed.hash) {
    return { ok: false, reason: "Webhook URLs must not contain URL fragments." };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  ) {
    return { ok: false, reason: "Webhook hostname must be a public FQDN (loopback and internal suffixes are blocked)." };
  }
  if (/^\d+(\.\d+)*$/.test(host) || isPrivateOrReservedIpv4(host)) {
    if (isPrivateOrReservedIpv4(host) || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return { ok: false, reason: "Private, loopback, metadata, and non-standard numeric IPv4 addresses are blocked." };
    }
  }
  if (host.includes(":")) {
    // Reject all literal IPv6 webhook targets (loopback ::1, ULA fc00::/7, link-local fe80::/10, IPv4-mapped ::ffff:127.0.0.1).
    return { ok: false, reason: "Use a public DNS hostname rather than a literal IPv6 address." };
  }
  return { ok: true, normalized: parsed.toString() };
}

// ─── Cloud Functions Registry (`Modules/Functions`) ───────────────────────────

export const CLOUD_FUNCTION_RUNTIMES = [
  { id: "node-22", label: "Node.js 22 LTS", defaultEntrypoint: "src/main.ts" },
  { id: "bun-1.4", label: "Bun 1.4", defaultEntrypoint: "src/main.ts" },
  { id: "deno-2.1", label: "Deno 2.1", defaultEntrypoint: "src/main.ts" },
  { id: "python-3.12", label: "Python 3.12", defaultEntrypoint: "src/main.py" },
  { id: "go-1.23", label: "Go 1.23", defaultEntrypoint: "main.go" },
  { id: "php-8.4", label: "PHP 8.4", defaultEntrypoint: "src/index.php" },
] as const;

export type CloudFunctionRuntimeId = (typeof CLOUD_FUNCTION_RUNTIMES)[number]["id"];
export const CLOUD_FUNCTION_RUNTIME_IDS = CLOUD_FUNCTION_RUNTIMES.map((r) => r.id);

export function validateFunctionEntrypoint(entrypoint: string): boolean {
  const trimmed = entrypoint.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (/[\s\x00-\x1f\x7f;|&$`<>\\]/.test(trimmed) || trimmed.startsWith("/")) return false;
  return trimmed.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}

const CRON_FIELD_PATTERN = /^(\*|(\*\/\d{1,2})|(\d{1,2}(-\d{1,2})?(,\d{1,2}(-\d{1,2})?)*))$/;

export function validateCronSchedule(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((field) => CRON_FIELD_PATTERN.test(field));
}

// ─── Slug Helper & Request Schemas ────────────────────────────────────────────

export const CLOUD_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugifyCloudIdentifier(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const safeCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((v) => !/[\x00-\x1f\x7f;|&$`<>]/.test(v), "Shell metacharacters and pipes are not allowed in build commands.");

const safeOutputDirSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (v) =>
      /^\.?\/?[A-Za-z0-9_./-]+$/.test(v) &&
      !v.startsWith("/") &&
      v.split("/").every((seg) => seg !== ".."),
    "Output directory must be a relative project path without '..' segments.",
  );

export const createCloudProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(48)
      .regex(CLOUD_SLUG_PATTERN, "Slug must use lowercase letters, numbers, and single hyphens.")
      .optional(),
    description: z.string().trim().max(500).optional(),
    organizationId: z.string().trim().min(1).max(128).nullable().optional(),
    region: z.enum(CLOUD_REGION_IDS as [string, ...string[]]).default("local-primary"),
    stage: z.enum(CLOUD_STAGES).default("development"),
    frameworkPreset: z.enum(CLOUD_FRAMEWORK_KEYS as [string, ...string[]]).default("nextjs"),
    renderingMode: z.enum(["ssr", "static"]).optional(),
    installCommand: safeCommandSchema.optional(),
    buildCommand: safeCommandSchema.optional(),
    outputDirectory: safeOutputDirSchema.optional(),
    linkedWebsiteId: z.string().trim().min(1).max(128).nullable().optional(),
    linkedDatabaseId: z.string().trim().min(1).max(128).nullable().optional(),
    linkedBucketId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();

export const updateCloudProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    stage: z.enum(CLOUD_STAGES).optional(),
    region: z.enum(CLOUD_REGION_IDS as [string, ...string[]]).optional(),
    frameworkPreset: z.enum(CLOUD_FRAMEWORK_KEYS as [string, ...string[]]).optional(),
    renderingMode: z.enum(["ssr", "static"]).optional(),
    installCommand: safeCommandSchema.optional(),
    buildCommand: safeCommandSchema.optional(),
    outputDirectory: safeOutputDirSchema.optional(),
    linkedWebsiteId: z.string().trim().min(1).max(128).nullable().optional(),
    linkedDatabaseId: z.string().trim().min(1).max(128).nullable().optional(),
    linkedBucketId: z.string().trim().min(1).max(128).nullable().optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .strict();

export const createCloudKeySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    scopes: z
      .array(z.string())
      .min(1, "Select at least one API scope.")
      .max(17)
      .refine((items) => items.every(isCloudScope), "One or more requested scopes are not recognized."),
    expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  })
  .strict();

export const createCloudPlatformSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    type: z.enum(CLOUD_PLATFORM_TYPE_IDS as [CloudPlatformType, ...CloudPlatformType[]]),
    identifier: z.string().trim().min(2).max(253),
  })
  .strict();

export const createCloudWebhookSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    url: z.string().trim().min(8).max(500),
    events: z
      .array(z.string())
      .min(1, "Select at least one event.")
      .max(11)
      .refine((items) => items.every((e) => VALID_WEBHOOK_EVENTS.has(e)), "Unrecognized webhook event."),
    tlsVerify: z.boolean().default(true),
  })
  .strict()
  .superRefine((val, ctx) => {
    const check = validateWebhookTargetUrl(val.url);
    if (!check.ok) {
      ctx.addIssue({ code: "custom", path: ["url"], message: check.reason });
    }
  });

export const createCloudFunctionSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(48)
      .regex(CLOUD_SLUG_PATTERN, "Function slug must use lowercase letters, numbers, and single hyphens.")
      .optional(),
    runtime: z.enum(CLOUD_FUNCTION_RUNTIME_IDS as [string, ...string[]]),
    entrypoint: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine(validateFunctionEntrypoint, "Entrypoint must be a relative file path without '..' or shell characters."),
    commands: safeCommandSchema.nullable().optional(),
    events: z
      .array(z.string())
      .max(11)
      .default([])
      .refine((items) => items.every((e) => VALID_WEBHOOK_EVENTS.has(e)), "Unrecognized trigger event."),
    schedule: z
      .string()
      .trim()
      .refine(validateCronSchedule, "Schedule must be a valid 5-field POSIX cron expression (e.g. '0 * * * *').")
      .nullable()
      .optional(),
    timeoutSeconds: z.number().int().min(1).max(900).default(15),
  })
  .strict();

// ─── Appwrite-Style Project Posture Advisor (`Modules/Advisor`) ───────────────

export type AdvisorTabTarget =
  | "overview"
  | "sites"
  | "resources"
  | "functions"
  | "keys"
  | "platforms"
  | "webhooks"
  | "agents";

export interface CloudAdvisorFinding {
  readonly code: string;
  readonly severity: "high" | "medium" | "info";
  readonly title: string;
  readonly detail: string;
  readonly remediationTab: AdvisorTabTarget;
  readonly ctaLabel: string;
}

export interface ProjectPostureInput {
  stage: string;
  linkedWebsite: { id: string; domain: string; sslEnabled?: boolean; status?: string } | null;
  linkedDatabase: { id: string; name: string; status?: string } | null;
  linkedBucket: { id: string; name: string; isPublic?: boolean } | null;
  keys: ReadonlyArray<{
    revokedAt: string | Date | null;
    expiresAt: string | Date | null;
    scopes: readonly string[];
  }>;
  platforms: ReadonlyArray<{ enabled: boolean; identifier: string }>;
  webhooks: ReadonlyArray<{ enabled: boolean; tlsVerify: boolean }>;
  functions: ReadonlyArray<{ enabled: boolean; executionState: string }>;
}

export function evaluateCloudProjectPosture(input: ProjectPostureInput, nowMs = Date.now()): CloudAdvisorFinding[] {
  const findings: CloudAdvisorFinding[] = [];
  const activeKeys = input.keys.filter((k) => {
    if (k.revokedAt) return false;
    if (k.expiresAt && new Date(k.expiresAt).getTime() <= nowMs) return false;
    return true;
  });

  const nonExpiringKeys = activeKeys.filter((k) => !k.expiresAt);
  if (nonExpiringKeys.length > 0) {
    findings.push({
      code: "KEY_NO_EXPIRATION",
      severity: input.stage === "production" ? "high" : "medium",
      title: `${nonExpiringKeys.length} active API key(s) have no expiration date`,
      detail: "Scoped server or agent keys without an expiry remain valid indefinitely until manually revoked.",
      remediationTab: "keys",
      ctaLabel: "Review API Keys",
    });
  }

  const overbroadKeys = activeKeys.filter((k) => k.scopes.length >= 12);
  if (overbroadKeys.length > 0) {
    findings.push({
      code: "KEY_OVERBROAD_SCOPES",
      severity: "medium",
      title: `${overbroadKeys.length} API key(s) grant 12+ scopes`,
      detail: "Follow Appwrite least-privilege key hygiene: issue separate keys for Sites deploy, Storage, and Health checks.",
      remediationTab: "keys",
      ctaLabel: "Tighten Key Scopes",
    });
  }

  if (input.platforms.filter((p) => p.enabled).length === 0) {
    findings.push({
      code: "NO_CLIENT_PLATFORMS",
      severity: input.stage === "production" ? "medium" : "info",
      title: "No client platform origins or mobile bundle IDs registered",
      detail: "Register allowed Web hostnames or iOS/Android bundle identifiers before connecting browser or mobile SDKs.",
      remediationTab: "platforms",
      ctaLabel: "Register Platform",
    });
  }

  const insecureWebhooks = input.webhooks.filter((w) => w.enabled && !w.tlsVerify);
  if (insecureWebhooks.length > 0) {
    findings.push({
      code: "WEBHOOK_TLS_DISABLED",
      severity: "high",
      title: `${insecureWebhooks.length} enabled webhook(s) disable TLS certificate verification`,
      detail: "Disabling TLS verification exposes signed event deliveries to man-in-the-middle interception.",
      remediationTab: "webhooks",
      ctaLabel: "Fix Webhook TLS",
    });
  }

  if (input.linkedWebsite && input.linkedWebsite.sslEnabled === false) {
    findings.push({
      code: "LINKED_SITE_SSL_INACTIVE",
      severity: input.stage === "production" ? "high" : "medium",
      title: `Linked site ${input.linkedWebsite.domain} does not report active TLS/SSL`,
      detail: "Provision or verify the certificate in Sites / Domains before serving authenticated client traffic.",
      remediationTab: "sites",
      ctaLabel: "Inspect Linked Site",
    });
  }

  if (input.linkedBucket?.isPublic) {
    findings.push({
      code: "PUBLIC_STORAGE_BUCKET",
      severity: "medium",
      title: `Linked storage bucket "${input.linkedBucket.name}" is marked public`,
      detail: "Public buckets allow unauthenticated reads; keep sensitive tenant or CRM documents in private buckets.",
      remediationTab: "resources",
      ctaLabel: "Review Storage",
    });
  }

  if (input.functions.length > 0) {
    findings.push({
      code: "FUNCTIONS_EXECUTOR_REQUIRES_SETUP",
      severity: "info",
      title: `${input.functions.length} serverless function definition(s) await an isolated container executor`,
      detail: "Function specs are stored durably, but isolated Open Runtimes execution is intentionally not attached on the web host.",
      remediationTab: "functions",
      ctaLabel: "View Functions Status",
    });
  }

  if (!input.linkedWebsite && !input.linkedDatabase && !input.linkedBucket) {
    findings.push({
      code: "NO_RESOURCES_LINKED",
      severity: "info",
      title: "No Hosting-Portal Site, Database, or Storage Bucket linked yet",
      detail: "Bind an existing Website, DatabaseInstance, or StorageBucket to unify project health and advisor checks.",
      remediationTab: "resources",
      ctaLabel: "Link Resources",
    });
  }

  return findings;
}

// ─── Secret-Free SDK & Agent/MCP Onboarding Snippets ──────────────────────────

export function buildProjectOnboardingConfig(params: {
  projectSlug: string;
  projectId: string;
  origin: string;
  frameworkPreset: string;
}) {
  const baseOrigin = params.origin.replace(/\/+$/, "");
  const healthEndpoint = `${baseOrigin}/api/cloud/v1/health`;

  const envSnippet = [
    `# .env.local — replace <YOUR_SCOPED_API_KEY> locally; never commit secrets`,
    `NEXT_PUBLIC_ALO_CLOUD_ENDPOINT="${baseOrigin}/api/cloud/v1"`,
    `NEXT_PUBLIC_ALO_CLOUD_PROJECT="${params.projectSlug}"`,
    `ALO_CLOUD_API_KEY="<YOUR_SCOPED_API_KEY>"`,
  ].join("\n");

  const typescriptSnippet = [
    `// Server-side health & resource check (${params.frameworkPreset})`,
    `const response = await fetch("${healthEndpoint}", {`,
    `  headers: {`,
    `    "x-alo-project": "${params.projectSlug}",`,
    `    "x-alo-key": process.env.ALO_CLOUD_API_KEY ?? "",`,
    `  },`,
    `  cache: "no-store",`,
    `});`,
    `const status = await response.json();`,
  ].join("\n");

  const curlSnippet = [
    `curl -fsS "${healthEndpoint}" \\`,
    `  -H "x-alo-project: ${params.projectSlug}" \\`,
    `  -H "x-alo-key: $ALO_CLOUD_API_KEY"`,
  ].join("\n");

  const agentWorkspaceManifest = JSON.stringify(
    {
      aloCloudProject: {
        id: params.projectId,
        slug: params.projectSlug,
        healthEndpoint,
        requiredHeaders: ["x-alo-project", "x-alo-key"],
        secretPolicy: "Supply ALO_CLOUD_API_KEY via local secret environment only; requires health.read or project.read scope.",
        hostedMcpServerEnabled: false,
      },
    },
    null,
    2,
  );

  return {
    healthEndpoint,
    envSnippet,
    typescriptSnippet,
    curlSnippet,
    agentWorkspaceManifest,
  };
}
