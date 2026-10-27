/**
 * Container security, argument validation, and secret redaction helpers.
 *
 * Every container created through the Hosting Portal or the Self-Hosted Agent
 * Deployment Assistant passes through these checks before `alo-docker-helper`
 * is invoked, preventing:
 *   - CLI flag injection (`--privileged`, `-v /var/run/docker.sock:...`),
 *   - unintended public host port binding (`0.0.0.0`),
 *   - privileged port binding (`< 1024`),
 *   - environment variable injection (`LD_PRELOAD`, `DOCKER_HOST`, null bytes),
 *   - plaintext secret leakage in API responses (`redactContainerRecord`).
 */

const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/;
const IMAGE_REF_RE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}|@sha256:[a-f0-9]{64})?$/i;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const FORBIDDEN_ENV_KEYS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  "NODE_OPTIONS",
]);

export interface PortValidationOptions {
  /** Allow binding to 0.0.0.0 instead of loopback 127.0.0.1. Default: false. */
  allowPublicBind?: boolean;
}

export class ContainerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerValidationError";
  }
}

export function validateContainerName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || !CONTAINER_NAME_RE.test(name)) {
    throw new ContainerValidationError(
      "Invalid container name: must be 2–63 alphanumeric characters (plus '.', '_', '-') and start with an alphanumeric character.",
    );
  }
  return name;
}

export function validateContainerImage(
  raw: unknown,
  options: { requireExplicitTag?: boolean } = {},
): string {
  const image = typeof raw === "string" ? raw.trim() : "";
  if (!image || image.startsWith("-") || !IMAGE_REF_RE.test(image)) {
    throw new ContainerValidationError(
      "Invalid container image reference: flags, spaces, and shell metacharacters are forbidden.",
    );
  }
  if (options.requireExplicitTag) {
    const lastSegment = image.split("/").pop() ?? "";
    const hasDigest = image.includes("@sha256:");
    const tagPart = lastSegment.includes(":") ? lastSegment.split(":")[1] : "";
    if (!hasDigest && (!tagPart || tagPart.toLowerCase() === "latest")) {
      throw new ContainerValidationError(
        `Container image "${image}" must specify a pinned version tag or sha256 digest (":latest" is not permitted).`,
      );
    }
  }
  return image;
}

/**
 * Normalize a port mapping to loopback (`127.0.0.1:<hostPort>:<containerPort>`)
 * unless `allowPublicBind` is explicitly enabled. Rejects privileged host ports `< 1024`.
 */
export function normalizeSafePortMapping(
  raw: unknown,
  options: PortValidationOptions = {},
): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || text.startsWith("-")) {
    throw new ContainerValidationError("Invalid port mapping format.");
  }

  // Accepted forms:
  //   "3105:8080"                -> normalized to "127.0.0.1:3105:8080"
  //   "127.0.0.1:3105:8080"      -> kept
  //   "0.0.0.0:3105:8080"        -> rejected unless allowPublicBind === true
  const parts = text.split(":");
  let bindHost = "127.0.0.1";
  let hostPortStr: string;
  let containerPortStr: string;

  if (parts.length === 2) {
    [hostPortStr, containerPortStr] = parts as [string, string];
  } else if (parts.length === 3) {
    [bindHost, hostPortStr, containerPortStr] = parts as [string, string, string];
  } else {
    throw new ContainerValidationError(
      'Port mapping must be "<hostPort>:<containerPort>" or "127.0.0.1:<hostPort>:<containerPort>".',
    );
  }

  if (bindHost !== "127.0.0.1" && !(options.allowPublicBind && bindHost === "0.0.0.0")) {
    throw new ContainerValidationError(
      'Containers must bind to loopback ("127.0.0.1") by default; public host bindings require reverse-proxy authorization.',
    );
  }

  // Strip optional /tcp suffix on container port
  const cleanContainerPort = containerPortStr.replace(/\/tcp$/i, "");
  if (!/^\d+$/.test(hostPortStr) || !/^\d+$/.test(cleanContainerPort)) {
    throw new ContainerValidationError("Port numbers must be positive integers.");
  }

  const hostPort = Number.parseInt(hostPortStr, 10);
  const containerPort = Number.parseInt(cleanContainerPort, 10);

  if (hostPort < 1024 || hostPort > 65535) {
    throw new ContainerValidationError("Host port must be in the unprivileged range 1024–65535.");
  }
  if (containerPort < 1 || containerPort > 65535) {
    throw new ContainerValidationError("Container port must be in the range 1–65535.");
  }

  return `${bindHost}:${hostPort}:${containerPort}`;
}

export function validateEnvVarMap(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ContainerValidationError("envVars must be a key-value object of strings.");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 64) {
    throw new ContainerValidationError("Too many environment variables (max 64).");
  }
  const validated: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!ENV_KEY_RE.test(key)) {
      throw new ContainerValidationError(`Invalid environment variable name "${key}".`);
    }
    if (FORBIDDEN_ENV_KEYS.has(key.toUpperCase())) {
      throw new ContainerValidationError(`Environment variable "${key}" is restricted for security reasons.`);
    }
    if (typeof value !== "string") {
      throw new ContainerValidationError(`Environment variable "${key}" must have a string value.`);
    }
    if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
      throw new ContainerValidationError(`Environment variable "${key}" contains disallowed control characters.`);
    }
    if (value.length > 8192) {
      throw new ContainerValidationError(`Environment variable "${key}" exceeds 8KB limit.`);
    }
    validated[key] = value;
  }
  return validated;
}

/**
 * Strip secret values from a DockerContainer record before serializing it in
 * any API response. Keys remain visible so operators know which variables are
 * configured without exposing credentials.
 */
export function redactContainerRecord<T extends { envVars?: unknown }>(
  container: T,
): Omit<T, "envVars"> & { envVars: Record<string, string> | null; envVarKeys: string[] } {
  let rawEnv = container.envVars;
  if (typeof rawEnv === "string" && rawEnv.trim().startsWith("{")) {
    try {
      rawEnv = JSON.parse(rawEnv);
    } catch {
      rawEnv = null;
    }
  }
  if (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) {
    return { ...container, envVars: null, envVarKeys: [] };
  }
  const keys = Object.keys(rawEnv as Record<string, unknown>).sort();
  const masked: Record<string, string> = {};
  for (const key of keys) {
    masked[key] = "[REDACTED]";
  }
  return {
    ...container,
    envVars: masked,
    envVarKeys: keys,
  };
}
