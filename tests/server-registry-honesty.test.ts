/**
 * Server registry honesty — ALO Hosting AI
 * ========================================
 *
 * The registry must report observed state only. These tests exist because the
 * handler previously fabricated it: an empty `Server` table caused a GET to
 * insert a hardcoded "Primary Edge & App Node" with 4 cores, 15 GB RAM, a
 * 100 GB disk, IP 100.85.239.114 and region ap-south-1.
 *
 * None of those numbers was ever measured on a host, and a read request was
 * mutating the database to produce them. A dashboard rendering invented
 * capacity is worse than an empty one, because an operator sizes real work
 * against it and cannot tell the difference.
 *
 * The assertions below are behavioural. Asserting that a particular literal no
 * longer appears would pass for any rewrite that invented different numbers.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildServerRegistryResponse,
  isOperationalServerStatus,
  OPERATIONAL_SERVER_STATUSES,
} from "@/lib/infrastructure/server-registry";

interface Row {
  id: string;
  hostname: string;
  status: string;
  cpuCores?: number;
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "srv_1",
  hostname: "server-b.office.lan",
  status: "ONLINE",
  ...over,
});

describe("buildServerRegistryResponse — never invents state", () => {
  it("returns an empty registry for an empty table instead of seeding a server", () => {
    const res = buildServerRegistryResponse([]);

    expect(res.servers).toEqual([]);
    expect(res.primary).toBeNull();
    expect(res.enrollmentRequired).toBe(true);
  });

  it("explains the empty state rather than leaving the UI to guess", () => {
    const res = buildServerRegistryResponse([]);

    expect(res.stateDetail).toBeTruthy();
    expect(res.stateDetail).toMatch(/enroll/i);
    // It must not imply that capacity exists.
    expect(res.stateDetail).not.toMatch(/\d+\s*(GB|cores)/i);
  });

  it("does not fabricate an operational flag when nothing is registered", () => {
    const res = buildServerRegistryResponse([]);

    expect(res.allServersUnavailable).toBe(false);
  });

  it("passes through every real row unchanged and in order", () => {
    const input = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const res = buildServerRegistryResponse(input);

    expect(res.servers.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(res.enrollmentRequired).toBe(false);
  });

  it("selects the first registered server as primary without synthesising one", () => {
    const res = buildServerRegistryResponse([row({ id: "a" }), row({ id: "b" })]);
    expect(res.primary?.id).toBe("a");
  });

  it("does not mutate the caller's array", () => {
    const input = [row()];
    buildServerRegistryResponse(input);
    expect(input).toHaveLength(1);
  });

  it("reports all-unavailable when rows exist but none is operational, and says so differently", () => {
    const res = buildServerRegistryResponse([
      row({ id: "a", status: "OFFLINE" }),
      row({ id: "b", status: "ERROR" }),
    ]);

    expect(res.allServersUnavailable).toBe(true);
    expect(res.enrollmentRequired).toBe(false);
    // Different remedy from "enroll one", so it must not reuse that message.
    expect(res.stateDetail).toMatch(/none is in an operational state/i);
  });

  it("treats one operational server as sufficient", () => {
    const res = buildServerRegistryResponse([
      row({ id: "a", status: "OFFLINE" }),
      row({ id: "b", status: "ONLINE" }),
    ]);

    expect(res.allServersUnavailable).toBe(false);
    expect(res.stateDetail).toBeNull();
  });
});

describe("isOperationalServerStatus", () => {
  it("accepts the operational ServerStatus enum members", () => {
    for (const s of OPERATIONAL_SERVER_STATUSES) expect(isOperationalServerStatus(s)).toBe(true);
    expect(isOperationalServerStatus("ONLINE")).toBe(true);
    expect(isOperationalServerStatus("ACTIVE")).toBe(true);
  });

  it("rejects PROVISIONING — a host that is not ready must not be deployable", () => {
    expect(isOperationalServerStatus("PROVISIONING")).toBe(false);
  });

  it("rejects the lower-case statuses the API never emits", () => {
    // The dead platform/views/ServersView.tsx tree keys off `running`/`stopped`.
    // Those values never come from the ServerStatus enum, so any future rewiring
    // must not treat them as operational.
    for (const s of ["running", "online", "stopped", "", "ONLINE "]) {
      expect(isOperationalServerStatus(s)).toBe(false);
    }
  });

  it("does not throw on non-string input", () => {
    expect(isOperationalServerStatus(undefined)).toBe(false);
    expect(isOperationalServerStatus(null)).toBe(false);
    expect(isOperationalServerStatus(1)).toBe(false);
  });
});

describe("GET /api/servers no longer fabricates inventory", () => {
  const src = fs.readFileSync(path.resolve("src/app/api/servers/route.ts"), "utf8");

  it("does not create a server row while handling a GET", () => {
    const getBody = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    expect(getBody).not.toMatch(/db\.server\.create/);
  });

  it("delegates shaping to the tested registry function", () => {
    expect(src).toContain("buildServerRegistryResponse");
  });
});
