/**
 * Server presentation honesty — ALO Hosting AI
 * ============================================
 *
 * The servers page used to fill every missing reading with a plausible literal:
 * `?? 4` vCPU, `?? 15` GB RAM, `?? 100` GB disk, `|| "127.0.0.1"`, and
 * `|| "ONLINE"` with a badge that was green for every status except
 * MAINTENANCE — so an OFFLINE server rendered as a healthy green "ONLINE" card.
 *
 * These tests pin the replacement contract:
 *   - absent readings are reported as absent, never as a number
 *   - unknown statuses are grey and non-operational, never green
 *   - only ONLINE/ACTIVE counts as operational
 */
import { describe, it, expect } from "vitest";
import {
  describeServerStatus,
  describeRegistryState,
  formatAddress,
  formatCapacity,
  formatReported,
  NOT_REPORTED,
} from "@/lib/infrastructure/server-presentation";
import { isOperationalServerStatus } from "@/lib/infrastructure/server-registry";

describe("describeServerStatus", () => {
  it("treats only ONLINE and ACTIVE as operational", () => {
    expect(describeServerStatus("ONLINE").operational).toBe(true);
    expect(describeServerStatus("ACTIVE").operational).toBe(true);
    for (const s of ["PROVISIONING", "MAINTENANCE", "OFFLINE", "ERROR", "WAT"]) {
      expect(describeServerStatus(s).operational).toBe(false);
    }
  });

  it("does not paint a down host green", () => {
    expect(describeServerStatus("OFFLINE").tone).toBe("down");
    expect(describeServerStatus("ERROR").tone).toBe("down");
    expect(describeServerStatus("OFFLINE").className).not.toMatch(/emerald|green/);
    expect(describeServerStatus("ERROR").className).not.toMatch(/emerald|green/);
  });

  it("marks maintenance and provisioning as attention, not healthy", () => {
    expect(describeServerStatus("MAINTENANCE").tone).toBe("attention");
    expect(describeServerStatus("PROVISIONING").tone).toBe("attention");
  });

  it("never defaults an absent or unrecognised status to ONLINE", () => {
    for (const bad of [undefined, null, "", 0, "RUNNING", {}, []]) {
      const d = describeServerStatus(bad);
      expect(d.key).toBe("UNKNOWN");
      expect(d.operational).toBe(false);
      expect(d.label).not.toBe("Online");
      expect(d.className).not.toMatch(/emerald|green/);
    }
  });

  it("accepts case and whitespace variation of a real status", () => {
    expect(describeServerStatus(" online ").key).toBe("ONLINE");
    expect(describeServerStatus("offline").key).toBe("OFFLINE");
  });
});

describe("isOperationalServerStatus", () => {
  it("agrees with describeServerStatus for every enum member", () => {
    for (const s of ["ONLINE", "ACTIVE", "PROVISIONING", "MAINTENANCE", "OFFLINE", "ERROR"]) {
      expect(isOperationalServerStatus(s)).toBe(describeServerStatus(s).operational);
    }
  });
});

describe("formatCapacity — absent is not zero", () => {
  it("reports absence instead of inventing a number", () => {
    for (const bad of [undefined, null, "", "  ", NaN, Infinity, -1, {}, []]) {
      expect(formatCapacity(bad, "vCPU")).toBe(NOT_REPORTED);
    }
  });

  it("does not present a column default of 0 as real hardware", () => {
    // cpuUsage/memoryUsage/diskUsage default to 0 in the schema. Zero cores is
    // not a measurement, it is an unset field.
    expect(formatCapacity(0, "vCPU")).toBe(NOT_REPORTED);
    expect(formatCapacity(0, "vCPU", { allowZero: true })).toBe("0 vCPU");
  });

  it("formats real readings", () => {
    expect(formatCapacity(4, "vCPU")).toBe("4 vCPU");
    expect(formatCapacity(15, "GB RAM")).toBe("15 GB RAM");
    expect(formatCapacity("100", "GB disk")).toBe("100 GB disk");
  });

  it("trims float noise without inventing precision", () => {
    expect(formatCapacity(15.000000000000002, "GB RAM")).toBe("15 GB RAM");
    expect(formatCapacity(15.46, "GB RAM")).toBe("15.5 GB RAM");
  });
});

describe("formatAddress", () => {
  it("never substitutes loopback for a missing address", () => {
    for (const bad of [undefined, null, "", "   "]) {
      const out = formatAddress(bad);
      expect(out).not.toContain("127.0.0.1");
      expect(out).toBe("No address reported");
    }
  });

  it("passes through a real address", () => {
    expect(formatAddress("100.85.239.114")).toBe("100.85.239.114");
    expect(formatAddress(" server-b.office.lan ")).toBe("server-b.office.lan");
  });
});

describe("formatReported", () => {
  it("never substitutes an assumed OS or role", () => {
    for (const bad of [undefined, null, "", "  ", 42]) {
      expect(formatReported(bad)).toBe(NOT_REPORTED);
    }
  });

  it("passes through real values", () => {
    expect(formatReported("Ubuntu 22.04.5 LTS")).toBe("Ubuntu 22.04.5 LTS");
    expect(formatReported("WEB")).toBe("WEB");
  });
});

describe("describeRegistryState", () => {
  it("warns when nothing is registered", () => {
    const s = describeRegistryState({ servers: [], allServersUnavailable: false });
    expect(s?.tone).toBe("empty");
    expect(s?.message).toMatch(/enrolled/i);
  });

  it("warns differently when servers exist but none is operational", () => {
    const s = describeRegistryState({ servers: [{}], allServersUnavailable: true });
    expect(s?.tone).toBe("warning");
    expect(s?.message).not.toMatch(/enrolled/i);
  });

  it("says nothing when at least one server is operational", () => {
    expect(describeRegistryState({ servers: [{}], allServersUnavailable: false })).toBeNull();
  });
});
