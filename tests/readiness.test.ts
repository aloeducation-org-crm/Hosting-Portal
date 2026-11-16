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

/**
 * Proxy-level regression for the public-path list (audit of PR #47):
 * `/api/ready` must be reachable unauthenticated (load balancers have no
 * session), but a lookalike sibling such as `/api/readyx` must NOT inherit
 * the public exemption and must be rejected with 401 by the session guard.
 */
import { NextRequest } from "next/server";

describe("proxy public-path matching is segment-bounded", () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "t".repeat(64);
  process.env.JWT_SECRET = process.env.JWT_SECRET || "t".repeat(64);
  process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || "a".repeat(64);

  const req = (path: string) =>
    new NextRequest(new URL(path, "http://localhost:3000"), { method: "GET" });

  it("serves /api/ready without a session", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/api/ready"));
    expect(res.status).not.toBe(401);
  });

  it("serves /api/ready/v1-children without a session", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/api/ready/anything"));
    expect(res.status).not.toBe(401);
  });

  it("does NOT exempt /api/readyx from authentication", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/api/readyx"));
    expect(res.status).toBe(401);
  });

  it("does NOT exempt /api/healthz from authentication either", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/api/healthz"));
    expect(res.status).toBe(401);
  });
});
