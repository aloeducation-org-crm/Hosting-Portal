/**
 * Server presentation — ALO Hosting AI
 * ====================================
 *
 * Turns observed server state into what an operator sees. The rule is the same
 * one the registry follows: **absent is not zero, and unknown is not healthy.**
 *
 * This module exists because the servers page previously filled every gap with
 * a plausible-looking literal:
 *
 *   {srv.cpuCores ?? 4}      → claimed 4 vCPU when none were reported
 *   {srv.ramGb   ?? 15}      → claimed 15 GB RAM
 *   {srv.diskGb  ?? 100}     → claimed a 100 GB disk
 *   {srv.ip || "127.0.0.1"}  → claimed loopback as the server's address
 *   {srv.status || "ONLINE"} → claimed a healthy host, and painted the badge
 *                              green for OFFLINE and ERROR because only
 *                              MAINTENANCE was styled differently
 *
 * Each of those renders a confident number where the system had no reading. An
 * operator cannot distinguish them from real data, so they are not placeholders
 * — they are wrong answers. Here they become explicit "Not reported" states,
 * and an unrecognised status becomes grey, never green.
 */

/** Status enum members from `prisma/schema.prisma` (`ServerStatus`). */
export type ServerStatusKey =
  | "ONLINE"
  | "ACTIVE"
  | "PROVISIONING"
  | "MAINTENANCE"
  | "OFFLINE"
  | "ERROR"
  | "UNKNOWN";

export type StatusTone = "healthy" | "attention" | "down" | "unknown";

export interface ServerStatusDisplay {
  /** Status as reported, or "UNKNOWN" when the value was not one we recognise. */
  key: ServerStatusKey;
  /** Operator-facing label. */
  label: string;
  tone: StatusTone;
  /** Tailwind classes for the badge. */
  className: string;
  /** True only for statuses that mean the host is reachable and serving. */
  operational: boolean;
}

const STATUS_DISPLAY: Record<ServerStatusKey, Omit<ServerStatusDisplay, "key" | "operational">> = {
  ONLINE: {
    label: "Online",
    tone: "healthy",
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  ACTIVE: {
    label: "Active",
    tone: "healthy",
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  PROVISIONING: {
    label: "Provisioning",
    tone: "attention",
    className: "bg-sky-100 text-sky-800 border-sky-200",
  },
  MAINTENANCE: {
    label: "Maintenance",
    tone: "attention",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  OFFLINE: {
    label: "Offline",
    tone: "down",
    className: "bg-rose-100 text-rose-800 border-rose-200",
  },
  ERROR: {
    label: "Error",
    tone: "down",
    className: "bg-rose-100 text-rose-800 border-rose-200",
  },
  UNKNOWN: {
    label: "Unknown",
    tone: "unknown",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

const OPERATIONAL: ReadonlySet<ServerStatusKey> = new Set<ServerStatusKey>(["ONLINE", "ACTIVE"]);

/**
 * Maps any reported status to a display. An unrecognised value is `UNKNOWN`,
 * never a healthy default — an API that starts emitting a new status must show
 * up as unknown rather than silently rendering as green.
 */
export function describeServerStatus(status: unknown): ServerStatusDisplay {
  const raw = typeof status === "string" ? status.trim().toUpperCase() : "";
  const key: ServerStatusKey =
    raw in STATUS_DISPLAY ? (raw as ServerStatusKey) : "UNKNOWN";

  return {
    key,
    operational: OPERATIONAL.has(key),
    ...STATUS_DISPLAY[key],
  };
}

/** Label used wherever a value was never reported. */
export const NOT_REPORTED = "Not reported";

/**
 * Formats a capacity reading.
 *
 * Returns `NOT_REPORTED` for absent, non-finite, negative or zero values — a
 * zero-core or zero-gigabyte host is not a fact a real agent reports, it is a
 * column default, and printing it would assert hardware that was never seen.
 */
export function formatCapacity(
  value: unknown,
  unit: string,
  options: { allowZero?: boolean } = {},
): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return NOT_REPORTED;
  if (n < 0) return NOT_REPORTED;
  if (n === 0 && !options.allowZero) return NOT_REPORTED;

  // Trim float noise (e.g. 15.000000000000002) without inventing precision.
  const rendered = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  return `${rendered} ${unit}`;
}

/** Formats a free-text inventory field, e.g. OS or role. */
export function formatReported(value: unknown): string {
  if (typeof value !== "string") return NOT_REPORTED;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : NOT_REPORTED;
}

/**
 * Formats an address. Never substitutes a loopback or example address: showing
 * 127.0.0.1 for a server that has none is a false statement about where it is.
 */
export function formatAddress(value: unknown): string {
  if (typeof value !== "string") return "No address reported";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "No address reported";
}

/**
 * Summary line for the registry when it is empty or entirely unavailable.
 * Returns `null` when there is nothing to warn about.
 */
export function describeRegistryState(state: {
  servers: readonly unknown[];
  allServersUnavailable: boolean;
}): { tone: "empty" | "warning"; message: string } | null {
  if (state.servers.length === 0) {
    return {
      tone: "empty",
      message:
        "No servers are registered. This panel shows observed state only, so it stays empty until a server is enrolled. No capacity, address or status is assumed.",
    };
  }
  if (state.allServersUnavailable) {
    return {
      tone: "warning",
      message:
        "Every registered server is offline, in error, provisioning or in maintenance. Capacity shown describes hardware, not availability.",
    };
  }
  return null;
}
