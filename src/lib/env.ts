import { z } from "zod";

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOSTNAME: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3101),
  APP_URL: z.string().default("http://localhost:3101"),

  // Auth — defaults for build-time compat; override in .env for production
  NEXTAUTH_URL: z.string().default("http://localhost:3101"),
  NEXTAUTH_SECRET: z.string().default("dev-secret-change-in-production"),
  JWT_SECRET: z.string().default("dev-jwt-secret-change-in-production"),

  // Database
  DATABASE_URL: z.string().min(1).default("file:./db/custom.db"),

  // Filesystem paths
  SITE_BASE: z.string().default("/srv/alo-sites"),
  BACKUP_BASE: z.string().default("/var/backups/alo-sites"),
  CADDY_CONFIG_DIR: z.string().default("/etc/caddy/sites-enabled"),
  CADDY_LOG_DIR: z.string().default("/var/log/caddy/alo-sites"),

  // Timeouts & Limits
  HELPER_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),
  DEPLOY_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(7200).default(1800),
  BACKUP_RETENTION_COUNT: z.coerce.number().int().min(1).max(365).default(14),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(5120).default(500),

  // Rate Limiting
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(10000).default(100),

  // Feature flags
  ALLOW_STATIC: z.coerce.boolean().default(true),
  ALLOW_PHP: z.coerce.boolean().default(true),
  ALLOW_NODE: z.coerce.boolean().default(true),
  ALLOW_NEXTJS: z.coerce.boolean().default(true),
  COMMERCIAL_HOSTING: z.coerce.boolean().default(false),

  // OAuth Providers
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),

  // AI & LiteLLM Gateway
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  AI_GATEWAY_URL: z.string().default("http://localhost:4000/v1"),
  AI_GATEWAY_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().default("gpt-4o-mini"),

  // Billing & Stripe
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),

  // Cloudflare DNS & SSL
  CLOUDFLARE_API_TOKEN: z.string().optional().default(""),
  CLOUDFLARE_ZONE_ID: z.string().optional().default(""),

  // Encryption
  APP_ENCRYPTION_KEY: z.string().default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),

  // Redis
  REDIS_URL: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("noreply@alolabs.net"),

  // Internal
  INTERNAL_SECRET: z.string().default("change-me-internal-secret"),
});

type EnvInput = Record<string, string | undefined>;

function loadEnv(input?: EnvInput) {
  const raw: EnvInput = input ?? process.env;
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    console.error("\nInvalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nSee .env.example for required variables.\n");
    throw new Error("Invalid environment configuration");
  }

  // Runtime security: block server startup (not build) if production uses default secrets
  const isBuildWorker =
    !!process.env.NEXT_WORKER_ID ||
    !!process.env.BUILD_ID ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build";
  const data = result.data;
  if (data.NODE_ENV === 'production' && !isBuildWorker) {
    if (data.NEXTAUTH_SECRET === 'dev-secret-change-in-production') {
      console.error('[SECURITY] FATAL: NEXTAUTH_SECRET is using the default value. Refusing to start in production.');
      console.error('[SECURITY] Set a strong random secret (64+ chars) in your .env file.');
      process.exit(1);
    }
    if (data.JWT_SECRET === 'dev-jwt-secret-change-in-production') {
      console.error('[SECURITY] FATAL: JWT_SECRET is using the default value. Refusing to start in production.');
      console.error('[SECURITY] Set a strong random secret (64+ chars) in your .env file.');
      process.exit(1);
    }
  }

  return data;
}

export const env = loadEnv();

export type Env = z.infer<typeof envSchema>;
