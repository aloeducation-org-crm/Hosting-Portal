/**
 * Evidence-classed inventory — ALO Hosting AI
 * ===========================================
 *
 * The Phase 0 defect was a fabricated value. The subtler version is a
 * correct-looking value with no provenance and no age: an operator cannot tell it
 * apart from a live reading. These tests exist so that the registry cannot express
 * that shape at all.
 *
 * The central invariant: **VERIFIED requires a verifying evidence source AND a
 * parseable timestamp within the freshness window.** Anything else downgrades.
 * Downgrading is preferred over throwing, because a throw in a read path gets
 * caught somewhere and the fact is then rendered anyway with its optimistic
 * status.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FRESHNESS,
  accessRequired,
  describeFact,
  factAgeMs,
  factHasValue,
  formatAge,
  normaliseFact,
  reportedFact,
  unknownFact,
  type Fact,
} from "@/lib/infrastructure/inventory";
import {
  REPORTED_AT,
  SERVER_INVENTORY,
  inventoryEvidenceSummary,
  resolveInventory,
} from "@/lib/infrastructure/server-inventory";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const verified = (over: Partial<Fact> = {}): Fact => ({
  value: "Ubuntu 22.04.5 LTS",
  status: "VERIFIED",
  source: "HOST_OBSERVATION",
  observedAt: hoursAgo(1),
  ...over,
});

describe("normaliseFact — cannot over-claim", () => {
  it("keeps a fresh value from a verifying source as VERIFIED", () => {
    expect(normaliseFact(verified(), NOW).status).toBe("VERIFIED");
  });

  it("downgrades VERIFIED to OBSERVED for every non-verifying source", () => {
    for (const source of ["OWNER_PROVIDED", "HISTORICAL_REPORT", "SOURCE_CODE", "AUTOMATED_TEST", "GITHUB_WORKFLOW", "NONE"] as const) {
      const out = normaliseFact(verified({ source }), NOW);
      expect(out.status).toBe("OBSERVED");
    }
  });

  it("drops a value that has no timestamp, rather than trusting it undated", () => {
    const out = normaliseFact(verified({ observedAt: null }), NOW);
    expect(out.value).toBeNull();
    expect(out.status).toBe("UNKNOWN");
    expect(out.note).toMatch(/timestamp/i);
  });

  it("drops a value whose timestamp cannot be parsed", () => {
    const out = normaliseFact(verified({ observedAt: "not-a-date" }), NOW);
    expect(out.value).toBeNull();
    expect(out.status).toBe("UNKNOWN");
  });

  it("marks a value older than the window as STALE but keeps it", () => {
    const out = normaliseFact(verified({ observedAt: hoursAgo(30) }), NOW);
    expect(out.status).toBe("STALE");
    expect(out.value).toBe("Ubuntu 22.04.5 LTS");
  });

  it("does not let a missing-state status carry a value", () => {
    for (const status of ["UNKNOWN", "ACCESS_REQUIRED", "UNREACHABLE", "ERROR"] as const) {
      const out = normaliseFact({ value: "sneaked in", status, source: "NONE", observedAt: hoursAgo(1) }, NOW);
      expect(out.value).toBeNull();
      expect(out.status).toBe(status);
    }
  });

  it("never promotes on a second pass (idempotent)", () => {
    const once = normaliseFact(verified({ source: "OWNER_PROVIDED" }), NOW);
    const twice = normaliseFact(once, NOW);
    expect(twice.status).toBe(once.status);
    expect(twice.value).toBe(once.value);
  });

  it("agrees with the boundary exactly at the freshness edge", () => {
    const edge = new Date(NOW.getTime() - DEFAULT_FRESHNESS.staleAfterMs).toISOString();
    expect(normaliseFact(verified({ observedAt: edge }), NOW).status).toBe("VERIFIED");
    const past = new Date(NOW.getTime() - DEFAULT_FRESHNESS.staleAfterMs - 1).toISOString();
    expect(normaliseFact(verified({ observedAt: past }), NOW).status).toBe("STALE");
  });
});

describe("factHasValue", () => {
  it("is false for every status that asserts absence", () => {
    for (const status of ["UNKNOWN", "ACCESS_REQUIRED", "UNREACHABLE", "ERROR"] as const) {
      expect(factHasValue({ value: "x", status, source: "NONE", observedAt: null })).toBe(false);
    }
  });

  it("is false when the value is null even if the status claims otherwise", () => {
    expect(factHasValue({ value: null, status: "VERIFIED", source: "HOST_OBSERVATION", observedAt: hoursAgo(1) })).toBe(false);
  });
});

describe("describeFact — a value never appears without its provenance", () => {
  it("shows a verified current value bare", () => {
    const d = describeFact(verified(), NOW);
    expect(d.text).toBe("Ubuntu 22.04.5 LTS");
    expect(d.tone).toBe("verified");
    expect(d.trustworthy).toBe(true);
  });

  it("shows an observed value with its age, not bare", () => {
    const d = describeFact(normaliseFact(verified({ source: "OWNER_PROVIDED" }), NOW), NOW);
    expect(d.text).toMatch(/observed/);
    expect(d.text).toMatch(/ago/);
    expect(d.trustworthy).toBe(false);
  });

  it("labels a stale value as stale and includes the age", () => {
    const d = describeFact(normaliseFact(verified({ observedAt: hoursAgo(50) }), NOW), NOW);
    expect(d.tone).toBe("stale");
    expect(d.text).toMatch(/stale/);
    expect(d.text).toMatch(/2d/);
    expect(d.trustworthy).toBe(false);
  });

  it("renders missing states as words, never as a number or zero", () => {
    for (const [fact, expected] of [
      [unknownFact("n/a"), "Unknown"],
      [accessRequired("n/a"), "Access required"],
    ] as const) {
      const d = describeFact(fact, NOW);
      expect(d.text).toBe(expected);
      expect(d.text).not.toMatch(/\d/);
      expect(d.age).toBeNull();
    }
  });

  it("marks unreachable and access-required as blocked, not merely missing", () => {
    expect(describeFact(accessRequired("x"), NOW).tone).toBe("blocked");
    expect(describeFact({ value: null, status: "UNREACHABLE", source: "NONE", observedAt: null }, NOW).tone).toBe("blocked");
  });
});

describe("age formatting", () => {
  it("formats the documented buckets", () => {
    expect(formatAge(null)).toBe("unknown age");
    expect(formatAge(30_000)).toBe("<1m ago");
    expect(formatAge(5 * 60_000)).toBe("5m ago");
    expect(formatAge(90 * 60_000)).toBe("1h 30m ago");
    expect(formatAge(26 * 3_600_000)).toBe("1d 2h ago");
  });

  it("does not present a future timestamp as a normal age", () => {
    expect(formatAge(-60_000)).toBe("timestamp in the future");
  });

  it("returns null age for an undatable fact", () => {
    expect(factAgeMs({ value: null, status: "UNKNOWN", source: "NONE", observedAt: null }, NOW)).toBeNull();
  });
});

describe("reportedFact — a report is never a verification", () => {
  it("is OBSERVED by construction, even when asked for a verifying shape", () => {
    const f = reportedFact("Ubuntu 22.04", "OWNER_PROVIDED", REPORTED_AT);
    expect(f.status).toBe("OBSERVED");
    expect(f.source).toBe("OWNER_PROVIDED");
  });

  it("cannot reach VERIFIED after normalisation", () => {
    const f = normaliseFact(reportedFact("Ubuntu 22.04", "OWNER_PROVIDED", REPORTED_AT), NOW);
    expect(f.status).not.toBe("VERIFIED");
  });
});

describe("the four-server registry", () => {
  it("contains exactly the four distinct servers", () => {
    expect(SERVER_INVENTORY.map((s) => s.id)).toEqual(["SERVER_A", "SERVER_B", "SERVER_C", "SERVER_D"]);
  });

  it("has a unique id and label per server", () => {
    const ids = SERVER_INVENTORY.map((s) => s.id);
    const labels = SERVER_INVENTORY.map((s) => s.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("claims no demonstrated connection — because none exists", () => {
    for (const s of SERVER_INVENTORY) {
      expect(s.connection.demonstrated).toBe(false);
    }
  });

  it("records what blocks each server from being verified", () => {
    for (const s of SERVER_INVENTORY) {
      expect(s.blockedBy.length).toBeGreaterThan(0);
    }
  });

  it("never presents a provider that was not evidenced as VERIFIED", () => {
    // Server C's provider is operator-reported; A/B/D are unknown entirely.
    for (const s of resolveInventory(NOW)) {
      expect(s.provider.status).not.toBe("VERIFIED");
      if (s.provider.value === null) expect(s.provider.status).toBe("UNKNOWN");
    }
  });

  it("treats every connection endpoint as unavailable, not as an address to dial", () => {
    for (const s of resolveInventory(NOW)) {
      expect(s.connection.endpoint.status).toBe("ACCESS_REQUIRED");
      expect(s.connection.endpoint.value).toBeNull();
    }
  });

  it("yields no VERIFIED fact anywhere while no host has been observed", () => {
    const summary = inventoryEvidenceSummary(resolveInventory(NOW));
    expect(summary.VERIFIED ?? 0).toBe(0);
  });

  it("reports historical leads as OBSERVED while fresh, then STALE once the window passes", () => {
    const fresh = resolveInventory(NOW);
    const serverA = fresh.find((s) => s.id === "SERVER_A")!;
    expect(serverA.facts.cpu!.status).toBe("OBSERVED");

    // Three days after the operator report, the same lead must not look current.
    const later = new Date(new Date(REPORTED_AT).getTime() + 3 * 24 * 3_600_000);
    const stale = resolveInventory(later).find((s) => s.id === "SERVER_A")!;
    expect(stale.facts.cpu!.status).toBe("STALE");
  });

  it("shows a stale lead with its age rather than as a bare number", () => {
    const later = new Date(new Date(REPORTED_AT).getTime() + 3 * 24 * 3_600_000);
    const stale = resolveInventory(later).find((s) => s.id === "SERVER_A")!;
    const shown = describeFact(stale.facts.ram!, later);
    expect(shown.tone).toBe("stale");
    expect(shown.text).toMatch(/stale/);
  });

  it("keeps genuinely unknown fields unknown rather than defaulting them", () => {
    const a = resolveInventory(NOW).find((s) => s.id === "SERVER_A")!;
    expect(a.facts.publicIp!.status).toBe("UNKNOWN");
    expect(a.facts.publicIp!.value).toBeNull();
  });

  it("records plan limits as claims, never as measured utilization", () => {
    const c = resolveInventory(NOW).find((s) => s.id === "SERVER_C")!;
    expect(c.facts.planCpu!.status).toBe("OBSERVED");
    expect(c.facts.actualUtilization!.status).toBe("UNKNOWN");
    expect(c.facts.actualUtilization!.value).toBeNull();
  });

  it("does not assume Server D is Server C or any other server", () => {
    const d = resolveInventory(NOW).find((s) => s.id === "SERVER_D")!;
    expect(d.provider.value).toBeNull();
    expect(d.serverClass).toBe("unknown");
  });
});
