/**
 * Health and readiness reporting (SEC-13, SEC-12).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * `GET /api/health` wrapped two `SELECT ... LIMIT 0` statements in a single
 * try/catch and reported one code, `DATABASE_UNAVAILABLE`, for every failure.
 * Its own comment admitted the problem: it "cannot tell those two apart". A
 * missing table (schema behind the code — the likely production state described
 * in the Phase 0 audit) and an unreachable database produced byte-identical
 * responses, so an operator could not know which repair to attempt.
 *
 * Separately, the route reported `uptime` as milliseconds since the first
 * request to that route rather than since process start, so the only liveness
 * signal it offered was wrong. The audit used it to (correctly) conclude the
 * process had not restarted, but only by reasoning about the artifact.
 *
 * And when `DATABASE_URL` was unset the application silently fell back to the
 * tracked fixture `file:./db/custom.db` — a database shipped in the release
 * payload. In production that turns a missing configuration into a running panel
 * backed by a development database with seeded accounts.
 *
 * ── What this module does ───────────────────────────────────────────────────
 * Produces a structured report with a distinct `reason` for each failure class,
 * a real process uptime, and an explicit `databaseConfigured` flag so "running
 * on the fixture" is visible without reading the environment. The route stays a
 * thin wrapper; everything testable lives here.
 *
 * The reason codes are the interface. They are stable strings so a monitoring
 * system can alert on `SCHEMA_MISSING` differently from `DATABASE_UNREACHABLE`,
 * and so the distinction survives refactoring.
 */
import { db } from "@/lib/db";

export type DatabaseStatus = "connected" | "disconnected";

export type HealthReason =
  /** Every probe passed. */
  | "OK"
  /** The client could not open the database file or reach the server at all. */
  | "DATABASE_UNREACHABLE"
  /** The database opened, but a table the application needs is absent. */
  | "SCHEMA_MISSING"
  /** The database opened and the table exists, but the expected columns are absent. */
  | "SCHEMA_OUT_OF_DATE"
  /** A query failed for a reason that is neither connectivity nor schema. */
  | "QUERY_FAILED";

export interface HealthReport {
  status: "healthy" | "unhealthy";
  reason: HealthReason;
  /** Safe, truncated detail for operators. Never contains a connection string. */
  detail?: string;
  uptimeSeconds: number;
  startedAt: string;
  timestamp: string;
  environment: string;
  version: string;
  databaseStatus: DatabaseStatus;
  schemaStatus: "current" | "stale" | "missing" | "unavailable";
  /** False when DATABASE_URL is unset and the fixture fallback is in use. */
  databaseConfigured: boolean;
}

/**
 * A schema probe: a table and the columns the application actually reads.
 *
 * The columns matter. `SELECT * FROM servers LIMIT 0` succeeds on an old table
 * that is missing every new column, which is exactly the "schema behind the
 * code" state the previous health check could not see.
 */
const SCHEMA_PROBES: Array<{ table: string; columns: string[] }> = [
  { table: "servers", columns: ["ipAddress", "cpuUsage", "memoryUsage", "diskUsage"] },
  { table: "hosting_sites", columns: ["domainName", "sslStatus", "vhostPath", "serverId"] },
  { table: "audit_logs", columns: ["action", "resourceType", "result"] },
  { table: "git_projects", columns: ["repository", "productionBranch", "cloneUrl"] },
];

/**
 * Classify a database error without echoing its text.
 *
 * Drivers disagree on wording; the classes below cover SQLite/libSQL ("no such
 * table", "no such column", "unable to open database file"), Postgres
 * ("relation ... does not exist", "column ... does not exist",
 * "connection refused") and generic socket failures. Matching is deliberately
 * narrow: an unrecognised message becomes QUERY_FAILED rather than being
 * optimistically labelled, because a wrong "healthy" is worse than a vague
 * "unhealthy".
 */
export function classifyDatabaseError(error: unknown): { reason: HealthReason; detail: string } {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.toLowerCase();
  const detail = sanitiseDetail(raw);

  if (/no such table|does not exist and could not be found|relation .* does not exist/.test(text)) {
    return { reason: "SCHEMA_MISSING", detail };
  }
  if (/no such column|column .* does not exist/.test(text)) {
    return { reason: "SCHEMA_OUT_OF_DATE", detail };
  }
  if (
    /unable to open database|can't open database|cannot open database|sqlite_cantopen|econnrefused|connection refused|connect econnrefused|enotfound|ehostunreach|etimedout|econnreset|epipe|server closed the connection|timed out|timeout|pool timeout|can't reach database server|network is unreachable/.test(
      text,
    )
  ) {
    return { reason: "DATABASE_UNREACHABLE", detail };
  }
  return { reason: "QUERY_FAILED", detail };
}

/**
 * Remove anything that could identify the deployment from an error string.
 *
 * Errors from a database driver routinely embed the connection URL, the
 * absolute path of the data file, the host and the port. This health endpoint is
 * reachable through the machine-credential list, so its body is not necessarily
 * private.
 */
export function sanitiseDetail(raw: string): string {
  let out = raw
    .replace(/file:\/\/[^\s"']+/gi, "[path]")
    .replace(/(?:postgres(?:ql)?|mysql|mariadb|libsql|https?):\/\/[^\s"']+/gi, "[url]")
    .replace(/\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g, "[path]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[host]")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > 300) out = `${out.slice(0, 297)}...`;
  return out;
}

/** True when the process is running on the fixture fallback rather than a configured database. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

/** Milliseconds since this module was loaded, which is process start in practice. */
const PROCESS_START = Date.now();

export function processUptimeSeconds(now = Date.now()): number {
  return Math.max(0, Math.floor((now - PROCESS_START) / 1000));
}

export interface HealthInputs {
  /** Overrode for tests; defaults to the Prisma client. */
  query?: (probe: { table: string; columns: string[] }) => Promise<unknown>;
  release?: unknown;
  now?: () => number;
}

/**
 * Run every probe and build the report.
 *
 * Probes stop at the first failure and the reason class is preserved. A
 * connectivity failure is reported as disconnect; a schema failure is reported
 * as connected-with-missing-schema, because those are different operational
 * situations: the first is a database/path problem, the second is a migration
 * that has not been applied.
 */
export async function buildHealthReport(inputs: HealthInputs = {}): Promise<HealthReport> {
  const now = inputs.now ?? (() => Date.now());
  const query =
    inputs.query ??
    (async (probe: { table: string; columns: string[] }) =>
      db.$queryRawUnsafe(`SELECT ${probe.columns.map((c) => `"${c}"`).join(", ")} FROM "${probe.table}" LIMIT 0`));

  const base = {
    uptimeSeconds: processUptimeSeconds(now()),
    startedAt: new Date(PROCESS_START).toISOString(),
    timestamp: new Date(now()).toISOString(),
    environment: process.env.NODE_ENV ?? "unknown",
    version: process.env.npm_package_version ?? "1.0.0",
    databaseConfigured: isDatabaseConfigured(),
  };

  for (const probe of SCHEMA_PROBES) {
    try {
      await query(probe);
    } catch (error) {
      const { reason, detail } = classifyDatabaseError(error);
      const unreachable = reason === "DATABASE_UNREACHABLE";
      return {
        ...base,
        status: "unhealthy",
        reason,
        detail,
        databaseStatus: unreachable ? "disconnected" : "connected",
        schemaStatus:
          reason === "SCHEMA_MISSING"
            ? "missing"
            : reason === "SCHEMA_OUT_OF_DATE"
              ? "stale"
              : reason === "DATABASE_UNREACHABLE"
                ? "unavailable"
                : "unavailable",
        // Attached by the route so the payload keeps its existing shape.
        ...(inputs.release !== undefined ? { release: inputs.release } : {}),
      } as HealthReport;
    }
  }

  return {
    ...base,
    status: "healthy",
    reason: "OK",
    databaseStatus: "connected",
    schemaStatus: "current",
    ...(inputs.release !== undefined ? { release: inputs.release } : {}),
  } as HealthReport;
}

/** HTTP status for a report. Unhealthy is 503 so a load balancer removes the instance. */
export function httpStatusFor(report: HealthReport): number {
  return report.status === "healthy" ? 200 : 503;
}

/** Operator-facing sentence. Kept separate so the JSON stays machine-readable. */
export function describeHealth(report: HealthReport): string {
  if (report.status === "healthy") {
    return report.databaseConfigured
      ? "Control plane and database are healthy."
      : "Control plane and database are healthy, but DATABASE_URL is unset and the fixture database is in use.";
  }
  switch (report.reason) {
    case "DATABASE_UNREACHABLE":
      return "The database could not be reached. Check DATABASE_URL, that the file or server exists, and its permissions.";
    case "SCHEMA_MISSING":
      return "The database is reachable but a required table is missing. Run the schema applier (npm run db:sync) and redeploy.";
    case "SCHEMA_OUT_OF_DATE":
      return "The database is reachable but a required column is missing. The schema is behind the running code: run the schema applier.";
    case "QUERY_FAILED":
      return "The database rejected a health probe for an unclassified reason. See the detail field.";
    default:
      return "The control plane is unhealthy.";
  }
}
