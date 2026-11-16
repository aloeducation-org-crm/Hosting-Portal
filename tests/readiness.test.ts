/**
 * Readiness probe regression tests — `/api/ready` backs the load-balancer
 * decision, so a false "ready" is an outage and a leaked detail is a finding.
 */
import { describe, it, expect } from "vitest";
import { buildReadinessReport } from "../src/lib/health";

const ok = async () => undefined;

describe("buildReadinessReport", () => {
  it("reports ready when every probe passes", async () => {
    const report = await buildReadinessReport({ query: ok });
    expect(report.ready).toBe(true);
    expect(report.reason).toBe("OK");
    expect(typeof report.uptimeSeconds).toBe("number");
    expect(typeof report.timestamp).toBe("string");
    // The readiness payload must not carry diagnostics.
    expect(Object.keys(report).sort()).toEqual(["ready", "reason", "timestamp", "uptimeSeconds"]);
  });

  it("reports not-ready with 503 semantics when the database is unreachable", async () => {
    const report = await buildReadinessReport({
      query: async () => {
        throw new Error("unable to open database file: /var/lib/alo-hosting/alo.db");
      },
    });
    expect(report.ready).toBe(false);
    expect(report.reason).toBe("DATABASE_UNREACHABLE");
  });

  it("reports not-ready when the schema is behind the code", async () => {
    const report = await buildReadinessReport({
      query: async () => {
        throw new Error("no such table: servers");
      },
    });
    expect(report.ready).toBe(false);
    expect(report.reason).toBe("SCHEMA_MISSING");
  });

  it("classifies the libsql open-failure wording as DATABASE_UNREACHABLE, not QUERY_FAILED", async () => {
    // Observed verbatim from @libsql/client when the database file's parent
    // directory does not exist (drill on 2026-11-16).
    const report = await buildReadinessReport({
      query: async () => {
        throw new Error("Unable to open connection to local database /nonexistent-dir-xyz/alo.db: 14");
      },
    });
    expect(report.ready).toBe(false);
    expect(report.reason).toBe("DATABASE_UNREACHABLE");
  });

  it("never leaks the connection string or absolute path in the reason", async () => {
    const report = await buildReadinessReport({
      query: async () => {
        throw new Error("unable to open database file: /var/lib/alo-hosting/alo.db postgres://u:p@db.internal:5432/x");
      },
    });
    expect(JSON.stringify(report)).not.toMatch(/alo\.db|db\.internal|5432|postgres:\/\//);
  });
});
