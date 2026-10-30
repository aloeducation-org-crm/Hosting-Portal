/**
 * Inventory route contract — ALO Hosting AI
 * ========================================
 *
 * `/api/infrastructure/inventory` is the read surface over the four-server
 * registry. These tests pin the properties that make it safe to render:
 *
 *   - it performs no writes (a GET must never mutate operational state);
 *   - it never reports a fact as VERIFIED while no host has been observed;
 *   - it never emits a bare value without provenance;
 *   - it does not collapse "unreachable" into "absent".
 *
 * The route itself is exercised structurally (source-level guarantees plus the
 * pure functions it delegates to), because a full NextRequest harness would
 * require a database. The *behavioural* assertions live against the resolver,
 * which is where the logic actually is — asserting on the route's text alone
 * would pass for any rewrite that reintroduced a default.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveInventory, inventoryEvidenceSummary } from "@/lib/infrastructure/server-inventory";
import { describeFact } from "@/lib/infrastructure/inventory";

const ROUTE = "src/app/api/infrastructure/inventory/route.ts";
const src = fs.readFileSync(path.resolve(ROUTE), "utf8");

describe("inventory route — write purity", () => {
  it("performs no database writes", () => {
    expect(src).not.toMatch(/db\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\b/);
    expect(src).not.toMatch(/\$executeRaw/);
  });

  it("does not import the prisma client at all", () => {
    // The registry is declared data + pure resolution; it needs no database.
    expect(src).not.toMatch(/from ["']@\/lib\/db["']/);
  });

  it("requires a session before returning anything", () => {
    expect(src).toContain("requireSession");
  });
});

describe("inventory route — evidence fidelity", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  const entries = resolveInventory(now);

  it("reports zero verified facts while no host has been observed", () => {
    const summary = inventoryEvidenceSummary(entries);
    expect(summary.VERIFIED ?? 0).toBe(0);
  });

  it("reports zero demonstrated connections", () => {
    expect(entries.filter((e) => e.connection.demonstrated).length).toBe(0);
  });

  it("gives every server a non-empty blockedBy list, so nothing looks settled", () => {
    for (const e of entries) expect(e.blockedBy.length).toBeGreaterThan(0);
  });

  it("emits a display object with a tone for every fact", () => {
    for (const entry of entries) {
      for (const fact of Object.values(entry.facts)) {
        const d = describeFact(fact, now);
        expect(["verified", "observed", "stale", "missing", "blocked"]).toContain(d.tone);
        expect(typeof d.text).toBe("string");
        expect(d.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("never renders a null value as a number or a zero", () => {
    for (const entry of entries) {
      for (const fact of Object.values(entry.facts)) {
        if (fact.value === null) {
          const d = describeFact(fact, now);
          expect(d.text).not.toMatch(/^[\d.]+\s*$/);
        }
      }
    }
  });

  it("keeps unreachable/access-required distinguishable from unknown", () => {
    for (const entry of entries) {
      const d = describeFact(entry.connection.endpoint, now);
      expect(d.tone).toBe("blocked");
      expect(d.text).toBe("Access required");
    }
  });

  it("carries a caveat so a consumer cannot mistake leads for measurements", () => {
    expect(src).toContain("caveat");
    expect(src).toMatch(/not measurements|leads/i);
  });
});

describe("inventory route — does not duplicate topology", () => {
  it("documents the difference from /api/infrastructure/topology in code", () => {
    expect(src).toMatch(/topology/);
    // The reason must be recorded, not just the reference.
    expect(src).toMatch(/observed|declared/i);
  });

  it("neither route imports the other (they are complementary, not layered)", () => {
    const topology = fs.readFileSync(path.resolve("src/app/api/infrastructure/topology/route.ts"), "utf8");
    // Match imports only: naming the other endpoint in a doc comment is the
    // intended way to record why they are separate.
    const importsOf = (text: string, target: string) =>
      new RegExp(`^\\s*import[^;]*${target}`, "m").test(text);
    expect(importsOf(topology, "infrastructure/inventory")).toBe(false);
    expect(importsOf(src, "infrastructure/topology")).toBe(false);
  });
});
