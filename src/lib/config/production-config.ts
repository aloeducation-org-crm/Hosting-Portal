/**
 * Redacted production-configuration validation — pure logic, no secret output.
 *
 * The deployment baseline for this application is a specific set of environment
 * variables (PORT, APP_URL, NEXTAUTH_URL, the SQLite DATABASE_URL, the deploy
 * directories, the AI flags, the hardening flags). `src/lib/env.ts` already
 * refuses to *start* in production when a secret is a placeholder, but nothing
 * answered the operator's question before a release: "is this host configured the
 * way we think it is, and is anything dangerous switched on?"
 *
 * This module answers it without ever printing a value. Every finding names a
 * KEY and describes a property of it — "must be https", "agrees with APP_URL",
 * "is a placeholder", "is inside the Git checkout" — so the report can be pasted
 * into a ticket, a CI log or an incident review without leaking a credential, a
 * connection string, a cookie secret or a private key. The only values that
 * appear are things that are public by definition (the scheme of a URL, the
 * application port, a boolean flag) or structurally derived (the host of the
 * public application URL).
 *
 * Severity contract:
 *   error   — a release must not be promoted on this configuration.
 *   warning — the host will run, but this is a deviation worth a human's eyes.
 *   info    — honest reporting of a deliberately disabled capability, e.g. "no AI
 *             provider is configured", so the UI's not-configured state has a
 *             server-side explanation rather than an invented success.
 *
 * Nothing here mutates the environment, touches the network, or writes a file.
 */
import fs from "node:fs";
import path from "node:path";

export type ConfigSeverity = "error" | "warning" | "info";

export interface ConfigFinding {
  /** Environment variable (or configuration area) the finding is about. */
  key: string;
  severity: ConfigSeverity;
  /** Human-readable and value-free: it must never contain the value itself. */
  message: string;
}

export type SecretState = "set" | "unset" | "placeholder" | "weak";

export interface ProductionConfigReport {
  ok: boolean;
  counts: { errors: number; warnings: number; info: number };
  findings: ConfigFinding[];
  facts: {
    application: {
      port: number | null;
      https: boolean;
      /** Origins of APP_URL / NEXT_PUBLIC_APP_URL / NEXTAUTH_URL all equal. */
      urlsAgree: boolean;
      /** Public host, which is not a secret (it is the site's own domain). */
      publicHost: string | null;
    };
    database: {
      scheme: string;
      absolute: boolean;
      exists: boolean | null;
      insideCheckout: boolean | null;
    };
    secrets: Record<string, SecretState>;
    directories: Record<string, "present" | "missing" | "not-writable" | "unchecked">;
    ai: {
      state: "configured" | "not-configured";
      freeOnly: boolean;
      allowAnonymous: boolean;
      provider: string;
    };
    flags: Record<string, boolean>;
  };
}

export interface ValidateOptions {
  /** Application checkout, used to answer "is the database inside the tree?". */
  appDir?: string;
  /** Stat the configured directories and the database file. Read-only. */
  checkFilesystem?: boolean;
}

/** Values that mean "nobody configured this" — kept in sync with src/lib/env.ts. */
const PLACEHOLDER_MARKERS = [
  "dev-secret-change-in-production",
  "dev-jwt-secret-change-in-production",
  "change-me-in-production",
  "change-me-internal-secret",
  "alo-internal-secret-change-me",
  "alo-encryption-key-change-in-production-32b",
  "generate-with-openssl-rand-hex-32",
  "replace-with-openssl-rand-hex-32",
  "replace-with-a-different-openssl-rand-hex-32",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "ci-only-not-a-real",
];

const SECRET_KEYS = ["NEXTAUTH_SECRET", "JWT_SECRET", "APP_ENCRYPTION_KEY", "INTERNAL_SECRET"] as const;
const URL_KEYS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL"] as const;
const DIRECTORY_KEYS = ["ALO_BACKUP_DIR", "ALO_SITES_DIR", "DEPLOY_RELEASE_BASE"] as const;
/** Any of these being set means an AI provider could actually be reached. */
const AI_PROVIDER_ENV_KEYS = [
  "OLLAMA_BASE_URL",
  "LOCALAI_BASE_URL",
  "LLAMACPP_BASE_URL",
  "AI_GATEWAY_URL_KEY",
  "AI_GATEWAY_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "GLM_API_KEY",
];

function isTruthy(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * Classify a secret without retaining it. The returned state is the only thing
 * that ever leaves this module.
 */
export function classifySecret(value: string | undefined): SecretState {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "unset";
  const lower = trimmed.toLowerCase();
  if (
    PLACEHOLDER_MARKERS.some((marker) => lower === marker || lower.startsWith(marker)) ||
    lower.startsWith("replace-with-") ||
    lower.startsWith("replace_with_")
  ) {
    return "placeholder";
  }
  if (trimmed.length < 32) return "weak";
  return "set";
}

interface ParsedUrl {
  origin: string;
  host: string;
  port: string;
  https: boolean;
}

function parseUrl(raw: string | undefined): ParsedUrl | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { origin: url.origin, host: url.host, port: url.port, https: url.protocol === "https:" };
  } catch {
    return null;
  }
}

function loopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    trimmed === "127.0.0.1" ||
    trimmed === "::1" ||
    trimmed === "localhost" ||
    trimmed.startsWith("127.")
  );
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Validate the production configuration and return a redacted report.
 *
 * `ok` is the release gate: it is false when any finding is an `error`.
 */
export function validateProductionConfig(
  source: Record<string, string | undefined> = process.env,
  options: ValidateOptions = {},
): ProductionConfigReport {
  const findings: ConfigFinding[] = [];
  const add = (key: string, severity: ConfigSeverity, message: string) => {
    findings.push({ key, severity, message });
  };
  const production = (source.NODE_ENV ?? "").trim() === "production";

  // ── Application URLs ───────────────────────────────────────────────────────
  const parsed = new Map<string, ParsedUrl>();
  for (const key of URL_KEYS) {
    const raw = (source[key] ?? "").trim();
    if (!raw) {
      add(key, "error", `${key} is not set; the application would advertise the wrong origin in links, cookies and OAuth callbacks.`);
      continue;
    }
    const url = parseUrl(raw);
    if (!url) {
      add(key, "error", `${key} is not an absolute http(s) URL.`);
      continue;
    }
    parsed.set(key, url);
    if (production && !url.https) {
      add(key, "error", `${key} is not https but this is a production runtime; session cookies would be sent in the clear.`);
    }
  }
  const origins = new Set([...parsed.values()].map((url) => url.origin));
  const urlsAgree = origins.size <= 1;
  if (parsed.size > 1 && !urlsAgree) {
    // Names only: printing the origins would be harmless, but a mismatch report
    // that quotes values invites people to paste them into public issues.
    add(
      "APP_URL/NEXT_PUBLIC_APP_URL/NEXTAUTH_URL",
      "error",
      "the configured application origins disagree; NextAuth callbacks, absolute links and CORS would target different hosts.",
    );
  }

  const portRaw = (source.PORT ?? "").trim();
  const port = Number.parseInt(portRaw, 10);
  const validPort = Number.isInteger(port) && port > 0 && port < 65536;
  if (!validPort) {
    add("PORT", "error", "PORT is not a usable TCP port number.");
  } else if (production && portRaw !== String(port)) {
    add("PORT", "warning", "PORT is not written as a plain integer; some process managers will not parse it.");
  }

  // ── Secrets, and secrets that leaked into public variables ────────────────
  const secrets: Record<string, SecretState> = {};
  for (const key of SECRET_KEYS) {
    const state = classifySecret(source[key]);
    secrets[key] = state;
    if (state === "unset") add(key, "error", `${key} is not set.`);
    else if (state === "placeholder") add(key, "error", `${key} still holds a documented placeholder or CI-only value.`);
    else if (state === "weak") add(key, "warning", `${key} is shorter than 32 characters.`);
  }
  const secretValues = new Set(
    SECRET_KEYS.map((key) => (source[key] ?? "").trim()).filter((value) => value.length >= 8),
  );
  for (const [key, rawValue] of Object.entries(source)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    const value = (rawValue ?? "").trim();
    if (!value) continue;
    if (/SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY/i.test(key)) {
      add(key, "error", "a NEXT_PUBLIC_ variable is compiled into the browser bundle; its name says it is a secret.");
    } else if (secretValues.has(value)) {
      add(key, "error", "this NEXT_PUBLIC_ variable carries the same value as a server secret, which the browser would expose.");
    }
  }
  if (secretValues.has((source.NEXT_PUBLIC_NEXTAUTH_SECRET ?? "").trim())) {
    add("NEXT_PUBLIC_NEXTAUTH_SECRET", "error", "the session secret must never be exposed to the browser.");
  }

  // ── Database ───────────────────────────────────────────────────────────────
  const databaseUrl = (source.DATABASE_URL ?? "").trim();
  const scheme = databaseUrl.includes(":")
    ? databaseUrl.slice(0, databaseUrl.indexOf(":")).toLowerCase()
    : "unset";
  let absolute = false;
  let exists: boolean | null = null;
  let insideCheckout: boolean | null = null;

  if (!databaseUrl) {
    add("DATABASE_URL", "error", "DATABASE_URL is not set; the schema step would have to guess which database it may change.");
  } else if (scheme === "file") {
    const filePath = databaseUrl.slice("file:".length);
    absolute = filePath.startsWith("/");
    if (!absolute) {
      add("DATABASE_URL", "error", "the SQLite database must be addressed by an absolute file: path, not a path relative to the process working directory.");
    }
    const resolved = absolute ? filePath : path.resolve(options.appDir ?? process.cwd(), filePath);
    if (options.checkFilesystem) exists = fs.existsSync(resolved);
    if (options.appDir && isInside(resolved, options.appDir)) {
      insideCheckout = true;
      const accepted = isTruthy(source.ALLOW_DB_IN_CHECKOUT);
      // This is the configuration scripts/deploy-release.sh fails closed on: a
      // `git reset --hard` over a live database destroys production data.
      add(
        "DATABASE_URL",
        accepted ? "warning" : "error",
        accepted
          ? "the SQLite database is inside the Git checkout; ALLOW_DB_IN_CHECKOUT is set, so every deployment copies it first. Move it out of the tree when a maintenance window allows."
          : "the SQLite database is inside the Git checkout; a checkout reset would destroy live data, and deploy-release.sh will refuse to deploy over it unless ALLOW_DB_IN_CHECKOUT=1.",
      );
    } else if (options.appDir) {
      insideCheckout = false;
    }
    if (exists === false) {
      add("DATABASE_URL", "error", "the SQLite database file does not exist at the configured absolute path.");
    }
  } else if (scheme === "postgres" || scheme === "postgresql") {
    add(
      "DATABASE_URL",
      "warning",
      "a PostgreSQL URL is configured; the Prisma datasource declares sqlite and src/lib/db.ts selects the libsql adapter for file: URLs only, so verify the provider and adapter before promoting a release.",
    );
  } else {
    add("DATABASE_URL", "error", `unsupported database scheme \"${scheme}\"; this build supports file: (SQLite) or postgresql:.`);
  }

  // ── Directories the deployment and backup paths write to ───────────────────
  const directories: Record<string, "present" | "missing" | "not-writable" | "unchecked"> = {};
  for (const key of DIRECTORY_KEYS) {
    const configured = (source[key] ?? "").trim();
    if (!configured) {
      directories[key] = "unchecked";
      add(key, "warning", `${key} is not set; the corresponding feature falls back to a built-in default path.`);
      continue;
    }
    if (!configured.startsWith("/")) {
      directories[key] = "unchecked";
      add(key, "warning", `${key} is not an absolute path.`);
      continue;
    }
    if (!options.checkFilesystem) {
      directories[key] = "unchecked";
      continue;
    }
    if (!fs.existsSync(configured)) {
      directories[key] = "missing";
      add(key, "warning", `${key} does not exist on this host; it is created on first use, but a release that needs it may fail late.`);
      continue;
    }
    try {
      fs.accessSync(configured, fs.constants.W_OK);
      directories[key] = "present";
    } catch {
      directories[key] = "not-writable";
      add(key, "error", `${key} is not writable by the user running the application.`);
    }
  }

  // ── AI: report what is actually available, never what we wish were ─────────
  const aiProvider = (source.AI_PROVIDER ?? "").trim().toLowerCase();
  const aiOrder = (source.AI_PROVIDER_ORDER ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry && entry !== "none");
  const aiFreeOnly = isTruthy(source.AI_FREE_ONLY);
  const aiAllowAnonymous = isTruthy(source.AI_ALLOW_ANONYMOUS);
  const aiConfigured =
    (aiProvider !== "" && aiProvider !== "none") ||
    aiOrder.length > 0 ||
    AI_PROVIDER_ENV_KEYS.some((key) => (source[key] ?? "").trim().length > 0);

  if (!aiConfigured) {
    add(
      "AI_PROVIDER",
      "info",
      "no AI provider is configured: /api/ai/status reports UNCONFIGURED and AI requests must return an explicit not-configured state. This is a supported configuration, not a defect.",
    );
  }
  if (aiAllowAnonymous) {
    add(
      "AI_ALLOW_ANONYMOUS",
      "error",
      "anonymous AI use is enabled; inference would be available without an authenticated, attributed session.",
    );
  }
  if (aiFreeOnly && (source.OPENAI_API_KEY ?? "").trim()) {
    add(
      "AI_FREE_ONLY",
      "info",
      "a paid provider key is present but AI_FREE_ONLY=true, so paid providers must not be selected automatically.",
    );
  }
  if (aiConfigured && !aiFreeOnly) {
    add("AI_FREE_ONLY", "warning", "AI_FREE_ONLY is false; verify that a paid provider is intended and budgeted on this host.");
  }

  // ── Flags that must stay off, and deployment binding ──────────────────────
  const deployBindHost = (source.DEPLOY_BIND_HOST ?? "").trim();
  if (deployBindHost && !loopbackHost(deployBindHost)) {
    add(
      "DEPLOY_BIND_HOST",
      production ? "error" : "warning",
      "deployed customer sites are configured to bind to a non-loopback address; the supported architecture is 127.0.0.1 behind the reverse proxy.",
    );
  }

  const corsOrigins = (source.CORS_ALLOWED_ORIGINS ?? "").trim();
  if (corsOrigins === "*") {
    add("CORS_ALLOWED_ORIGINS", "error", "a wildcard CORS origin would expose the API to every site on the internet.");
  }

  const booleanFlags: Array<[string, string, ConfigSeverity, string]> = [
    ["ALLOW_INSECURE_WEBHOOK_HTTP", "true", "error", "insecure webhook delivery is enabled; webhook payloads and signatures would travel over plain HTTP."],
    ["ALLOW_PREVIEW_EMBED", "true", "error", "preview embedding is enabled; customer previews could be framed by third-party origins."],
    ["DEPLOY_ALLOW_LOCAL_SOURCE", "true", "error", "local filesystem deployment sources are enabled, which lets a request deploy code the operator never approved."],
    ["SSO_ENABLED", "true", "warning", "SSO is enabled; confirm the identity provider is configured and that this was an intentional change."],
    ["DEPLOY_DISABLE_BOOT_RESTORE", "false", "warning", "DEPLOY_DISABLE_BOOT_RESTORE is not true; a startup path may restore a previous release over the active one."],
  ];
  const flags: Record<string, boolean> = {};
  for (const [key, dangerousWhen, severity, message] of booleanFlags) {
    const value = isTruthy(source[key]);
    flags[key] = value;
    const dangerous = dangerousWhen === "true" ? value : !value;
    if (dangerous) add(key, severity, message);
  }

  if ((source.DNS_PROVIDER_MODE ?? "").trim().toLowerCase() === "none") {
    add("DNS_PROVIDER_MODE", "info", "no DNS provider is configured: DNS automation must report that honestly rather than claiming a record was created.");
  }

  const uploadSize = Number.parseInt((source.MAX_UPLOAD_SIZE_MB ?? "").trim(), 10);
  if (Number.isFinite(uploadSize) && uploadSize > 1024) {
    add("MAX_UPLOAD_SIZE_MB", "warning", "the upload limit exceeds 1 GiB, which is a denial-of-service surface on a shared host.");
  }
  const rateMax = Number.parseInt((source.RATE_LIMIT_MAX_REQUESTS ?? "").trim(), 10);
  if (Number.isFinite(rateMax) && rateMax > 10000) {
    add("RATE_LIMIT_MAX_REQUESTS", "warning", "the rate limit is high enough to stop being a limit.");
  }

  const counts = {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  return {
    ok: counts.errors === 0,
    counts,
    findings,
    facts: {
      application: {
        port: validPort ? port : null,
        https: [...parsed.values()].every((url) => url.https) && parsed.size > 0,
        urlsAgree,
        publicHost: parsed.get("NEXT_PUBLIC_APP_URL")?.host ?? parsed.get("APP_URL")?.host ?? null,
      },
      database: { scheme, absolute, exists, insideCheckout },
      secrets,
      directories,
      ai: {
        state: aiConfigured ? "configured" : "not-configured",
        freeOnly: aiFreeOnly,
        allowAnonymous: aiAllowAnonymous,
        provider: aiProvider || "unset",
      },
      flags,
    },
  };
}
