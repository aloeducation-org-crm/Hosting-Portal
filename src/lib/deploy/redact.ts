/**
 * Log redaction. Every byte that reaches a deployment log goes through here.
 *
 * Rules:
 *  - known secret values are collected from the environment at call time;
 *  - common credential shapes (GitHub tokens, Bearer tokens, private keys,
 *    URL userinfo) are masked even when the value was not explicitly registered;
 *  - redaction is applied before persistence AND before any console output.
 */

const PATTERNS: Array<[RegExp, string]> = [
  [/gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/x-access-token:[^@/\s]+@/gi, "x-access-token:[REDACTED]@"],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[REDACTED]@"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]"],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, "$1[REDACTED]$2"],
  [/((?:token|secret|password|api[_-]?key|authorization)\s*[:=]\s*)(["']?)[^\s"',;}{]{6,}\2/gi, "$1[REDACTED]"],
];

const SECRET_ENV_NAMES = [
  "GITHUB_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "JWT_SECRET",
  "APP_ENCRYPTION_KEY",
  "DATABASE_URL",
  "UNOROUTER_API_KEY",
  "OPENAI_API_KEY",
];

/**
 * Suffixes/substrings that make an environment variable name a platform secret.
 *
 * Used twice: to collect values for redaction, and (by `engine.ts`) to assert
 * that a customer build's environment contains no platform credential before
 * the build starts. Keeping one list means a new secret added to configuration
 * is automatically both redacted and refused in a build environment.
 *
 * `_URL` variables are matched only for known credential-bearing schemes
 * (`DATABASE_URL`, `REDIS_URL`) because a customer build legitimately needs
 * something like `API_URL`.
 */
const SECRET_NAME_SUFFIXES = [
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "PRIVATE_KEY",
  "PRIVATE_KEY_B64",
  "API_KEY",
  "ACCESS_TOKEN",
  "REFRESH_TOKEN",
  "SESSION_TOKEN",
  "CLIENT_SECRET",
  "ENCRYPTION_KEY",
  "SIGNING_KEY",
  "WEBHOOK_SECRET",
  "MASTER_KEY",
  "SALT_KEY",
];

const SECRET_NAME_EXACT = new Set([
  "DATABASE_URL",
  "DB_URL",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
  "JWT_SECRET",
  "APP_ENCRYPTION_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "SSH_PRIVATE_KEY",
]);

/** True when the variable name denotes a platform credential. */
export function matchesPlatformSecretName(name: string): boolean {
  const upper = name.trim().toUpperCase();
  if (!upper) return false;
  if (SECRET_NAME_EXACT.has(upper)) return true;
  return SECRET_NAME_SUFFIXES.some((suffix) => upper === suffix || upper.endsWith(`_${suffix}`));
}

export function collectSecrets(extra: Array<string | undefined | null> = []): string[] {
  const values = new Set<string>();
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.length >= 6) values.add(value);
  }
  for (const value of extra) {
    if (value && value.length >= 6) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function redact(text: string, extraSecrets: Array<string | undefined | null> = []): string {
  if (!text) return text;
  let out = text;
  for (const secret of collectSecrets(extraSecrets)) {
    out = out.split(secret).join("[REDACTED]");
  }
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Safe to log: executable name only, plus arguments that contain no secrets. */
export function redactCommand(argv: string[], extraSecrets: string[] = []): string {
  if (!argv.length) return "";
  return [argv[0], ...argv.slice(1).map((arg) => redact(arg, extraSecrets))].join(" ");
}
