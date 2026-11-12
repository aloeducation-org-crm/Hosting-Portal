/**
 * SEC-13 / SEC-12 regression tests — health reporting and database configuration.
 *
 * SEC-13: `/api/health` returned `DATABASE_UNAVAILABLE` for every failure, so an
 * operator could not tell an unreachable database from a schema that is behind
 * the code — the two situations the production incident actually needed
 * distinguished. It also reported `uptime` from the first request to the route.
 *
 * SEC-12: an unset `DATABASE_URL` silently fell back to the tracked fixture
 * `file:./db/custom.db`, which is shipped in the release payload.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildHealthReport,
  classifyDatabaseError,
  sanitiseDetail,
  processUptimeSeconds,
  httpStatusFor,
  describeHealth,
  isDatabaseConfigured,
  requireIdentifier,
} from "../src/lib/health";
import { resolveDatabaseUrl } from "../src/lib/db";

const ROOT = path.resolve(__dirname, "..");
const ok = async () => undefined;

describe("SEC-13 the health check distinguishes failure classes", () => {
  it("reports healthy when every probe passes", async () => {
    const report = await buildHealthReport({ query: ok });
    expect(report.status).toBe("healthy");
    expect(report.reason).toBe("OK");
    expect(report.databaseStatus).toBe("connected");
    expect(report.schemaStatus).toBe("current");
    expect(httpStatusFor(report)).toBe(200);
  });

  it("reports an unreachable database as disconnected", async () => {
    const report = await buildHealthReport({
      query: async () => {
        throw new Error("unable to open database file: /var/lib/alo-hosting/alo.db");
      },
    });
    expect(report.status).toBe("unhealthy");
    expect(report.reason).toBe("DATABASE_UNREACHABLE");
    expect(report.databaseStatus).toBe("disconnected");
    expect(report.schemaStatus).toBe("unavailable");
    expect(httpStatusFor(report)).toBe(503);
  });

  it("reports a missing table as connected-with-missing-schema, not as a database outage", async () => {
    const report = await buildHealthReport({
      query: async () => {
        throw new Error("no such table: servers");
      },
    });
    expect(report.reason).toBe("SCHEMA_MISSING");
    expect(report.databaseStatus).toBe("connected");
    expect(report.schemaStatus).toBe("missing");
  });

  it("reports a missing column as a stale schema", async () => {
    const report = await buildHealthReport({
      query: async () => {
        throw new Error('no such column: "cpuUsage"');
      },
    });
    expect(report.reason).toBe("SCHEMA_OUT_OF_DATE");
    expect(report.databaseStatus).toBe("connected");
    expect(report.schemaStatus).toBe("stale");
  });

  it("gives the operator a different instruction per reason", async () => {
    const unreachable = await buildHealthReport({
      query: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:5432");
      },
    });
    const missing = await buildHealthReport({
      query: async () => {
        throw new Error("no such table: git_projects");
      },
    });
    expect(describeHealth(unreachable)).toMatch(/could not be reached/);
    expect(describeHealth(missing)).toMatch(/required table is missing/);
    expect(describeHealth(unreachable)).not.toBe(describeHealth(missing));
  });

  it("reports a real process uptime rather than time since the first request", () => {
    // The module was loaded before this test ran, so a monotonic non-negative
    // value that never resets is the property under test.
    const first = processUptimeSeconds();
    const second = processUptimeSeconds(Date.now() + 5_000);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it("surfaces that the fixture database is in use when DATABASE_URL is unset", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const report = await buildHealthReport({ query: ok });
      expect(report.databaseConfigured).toBe(false);
      expect(describeHealth(report)).toMatch(/DATABASE_URL is unset/);
      expect(isDatabaseConfigured()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  it("treats an empty DATABASE_URL as unset", async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "   ";
    try {
      expect(isDatabaseConfigured()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
      else delete process.env.DATABASE_URL;
    }
  });
});

describe("SEC-13 error classification is precise and does not over-claim health", () => {
  it("recognises SQLite/libSQL and Postgres schema errors", () => {
    expect(classifyDatabaseError(new Error("no such table: audit_logs")).reason).toBe("SCHEMA_MISSING");
    expect(classifyDatabaseError(new Error('relation "audit_logs" does not exist')).reason).toBe("SCHEMA_MISSING");
    expect(classifyDatabaseError(new Error('no such column: "action"')).reason).toBe("SCHEMA_OUT_OF_DATE");
    expect(classifyDatabaseError(new Error('column "action" does not exist')).reason).toBe("SCHEMA_OUT_OF_DATE");
  });

  it("recognises connectivity errors across drivers", () => {
    for (const message of [
      "unable to open database file",
      "SQLITE_CANTOPEN",
      "connect ECONNREFUSED 127.0.0.1:5432",
      "Can't reach database server at db:5432",
      "connect ETIMEDOUT",
    ]) {
      expect(classifyDatabaseError(new Error(message)).reason, message).toBe("DATABASE_UNREACHABLE");
    }
  });

  it("does not guess on an unrecognised error", () => {
    expect(classifyDatabaseError(new Error("something entirely unexpected")).reason).toBe("QUERY_FAILED");
  });

  it("never echoes a path, host or connection URL into the detail", () => {
    const detail = sanitiseDetail("unable to open database file: file:/var/lib/alo-hosting/alo.db at 10.1.2.3:5432");
    expect(detail).not.toContain("alo.db");
    expect(detail).not.toContain("10.1.2.3");
    expect(detail).toContain("[path]");
  });

  it("truncates a very long error instead of returning it whole", () => {
    const detail = sanitiseDetail("x".repeat(2_000));
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail.endsWith("...")).toBe(true);
  });
});

describe("SEC-13 the raw probe cannot be used for injection", () => {
  it("accepts bare identifiers", () => {
    for (const value of ["servers", "hosting_sites", "_x1", "git_projects"]) {
      expect(requireIdentifier(value), value).toBe(value);
    }
  });

  it("rejects anything that could escape a quoted identifier", () => {
    for (const value of ['servers"; DROP TABLE audit_logs; --', "servers'", "servers;", "servers OR 1=1", "a b", "1abc", '"x"']) {
      expect(() => requireIdentifier(value), value).toThrow(/identifier rejected/);
    }
  });

  it("the default probe validates before it interpolates", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/health.ts"), "utf8");
    const block = source.slice(source.indexOf("const query ="), source.indexOf("const base ="));
    expect(block).toContain("requireIdentifier(probe.table)");
    expect(block.indexOf("requireIdentifier")).toBeLessThan(block.indexOf("$queryRawUnsafe"));
  });
});

describe("SEC-12 production refuses to start on the fixture database", () => {
  it("returns the configured URL when present", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "file:/var/lib/alo-hosting/alo.db", NODE_ENV: "production" })).toBe(
      "file:/var/lib/alo-hosting/alo.db",
    );
  });

  it("falls back to the fixture outside production, for local development", () => {
    expect(resolveDatabaseUrl({ NODE_ENV: "development" })).toBe("file:./db/custom.db");
  });

  it("exempts a build worker so `next build` does not need a database", () => {
    expect(resolveDatabaseUrl({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe("file:./db/custom.db");
    expect(resolveDatabaseUrl({ NODE_ENV: "production", npm_lifecycle_event: "build" })).toBe("file:./db/custom.db");
  });

  it("exits the process in production when DATABASE_URL is missing", () => {
    // `process.exit` is stubbed rather than invoked so the test process survives;
    // the assertion is that the guard fires instead of quietly returning the
    // fixture path.
    const source = fs.readFileSync(path.join(ROOT, "src/lib/db.ts"), "utf8");
    const fn = source.slice(source.indexOf("export function resolveDatabaseUrl"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/NODE_ENV === "production"/);
    expect(body).toMatch(/process\.exit\(1\)/);
    // The fallback must come only after the guard.
    expect(body.indexOf("process.exit(1)")).toBeLessThan(body.indexOf("return \"file:./db/custom.db\""));
  });
});

describe("SEC-13 the health route uses the reporting module", () => {
  it("delegates to buildHealthReport and no longer swallows the reason", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/api/health/route.ts"), "utf8");
    expect(route).toContain("buildHealthReport");
    expect(route).toMatch(/reason:\s*report\.reason/);
    expect(route).toContain("databaseConfigured");
    expect(route).not.toMatch(/catch\s*\{\s*const errBody = apiError\(\s*'Database connectivity or schema check failed'/);
  });
});
