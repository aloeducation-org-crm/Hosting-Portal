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
