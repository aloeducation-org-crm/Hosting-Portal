/**
 * Evidence-classed inventory — ALO Hosting AI
 * ===========================================
 *
 * One rule governs this module: **a fact is worth exactly as much as the evidence
 * behind it, and the UI must not be able to claim more than the evidence does.**
 *
 * The platform describes four servers it mostly cannot reach. Two of them have
 * never been observed from this codebase at all; the other two were described
 * once, by an operator, in a message. If those leads are rendered the same way as
 * a live host reading, an administrator cannot tell which of the numbers in front
 * of them is about to go stale and which is a measurement taken four seconds ago.
 *
 * The Phase 0 defect was a *fabricated* value. The subtler version of the same
 * defect is a *correct-looking* value with no provenance and no age. This module
 * removes the ability to express that: every field is a `Fact`, a `Fact` always
 * carries its source and observation time, and the resolver refuses to grant
 * `VERIFIED` to anything that did not come from a verifying source with a recent
 * timestamp.
 *
 * Provenance classes that can never verify a fact:
 *   OWNER_PROVIDED, HISTORICAL_REPORT  → best realizable status is OBSERVED
 *   SOURCE_CODE, AUTOMATED_TEST        → describe the software, never the host
 *   GITHUB_WORKFLOW                    → describes a pipeline, not a running host
 * The only sources that can support VERIFIED are HOST_OBSERVATION and PROVIDER_API.
 */

/** Where a fact came from. Ordered roughly by strength, weakest last. */
export type EvidenceSource =
  | "HOST_OBSERVATION"
  | "PROVIDER_API"
  | "GITHUB_WORKFLOW"
  | "AUTOMATED_TEST"
  | "SOURCE_CODE"
  | "OWNER_PROVIDED"
  | "HISTORICAL_REPORT"
  | "NONE";

/** Lifecycle status of a single fact, per the inventory specification. */
export type FactStatus =
  | "VERIFIED"
  | "OBSERVED"
  | "STALE"
  | "UNREACHABLE"
  | "ACCESS_REQUIRED"
  | "UNKNOWN"
  | "ERROR";

/** Sources strong enough to support `VERIFIED`. */
const VERIFYING_SOURCES: ReadonlySet<EvidenceSource> = new Set<EvidenceSource>([
  "HOST_OBSERVATION",
  "PROVIDER_API",
]);

/**
 * Sources that describe an artefact or a claim rather than a live system. They are
 * useful evidence but they cannot establish what a server is doing right now.
 */
const NON_VERIFYING_SOURCES: ReadonlySet<EvidenceSource> = new Set<EvidenceSource>([
  "GITHUB_WORKFLOW",
  "AUTOMATED_TEST",
  "SOURCE_CODE",
  "OWNER_PROVIDED",
  "HISTORICAL_REPORT",
  "NONE",
]);

export interface Fact<T = string | number | boolean> {
  /** The observed value, or `null` when there is none. Never a substitute default. */
  value: T | null;
  status: FactStatus;
  source: EvidenceSource;
  /** ISO-8601 time the value was observed. Required for VERIFIED/OBSERVED/STALE. */
  observedAt: string | null;
  /** Why the fact is missing, or what limits it. */
  note?: string;
}

/** Freshness policy. One definition, imported everywhere. */
export interface FreshnessPolicy {
  /** Beyond this age a VERIFIED/OBSERVED fact becomes STALE. */
  staleAfterMs: number;
}

/**
 * 24 hours. Deliberately not minutes: these are inventory facts (hardware, mount
 * points, plans) that do not change minute to minute. Telemetry — CPU, RAM — is a
 * different concern with a different window and must not reuse this one.
 */
export const DEFAULT_FRESHNESS: FreshnessPolicy = { staleAfterMs: 24 * 60 * 60 * 1000 };

/** Statuses that assert a value exists. */
const VALUE_BEARING: ReadonlySet<FactStatus> = new Set<FactStatus>(["VERIFIED", "OBSERVED", "STALE"]);

export function factHasValue<T>(fact: Fact<T>): boolean {
  return fact.value !== null && fact.value !== undefined && VALUE_BEARING.has(fact.status);
}

function parseTime(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Normalises a fact so it cannot over-claim.
 *
 * This is intentionally *not* an assertion that throws on bad input. A thrown
 * error in a read path gets caught and swallowed somewhere, and the fact is then
 * rendered anyway with its original optimistic status. Downgrading in place means
 * the worst outcome of malformed provenance is "shows less than it could", never
 * "shows more than it should".
 *
 * Downgrade rules, applied in order:
 *   1. no value                        → status cannot be value-bearing (→ UNKNOWN)
 *   2. value-bearing but no timestamp  → UNKNOWN, value dropped
 *   3. value-bearing but unparsable ts → UNKNOWN, value dropped
 *   4. VERIFIED from a non-verifying source → OBSERVED
 *   5. older than the freshness window → STALE (value kept, age surfaced)
 */
export function normaliseFact<T>(
  fact: Fact<T>,
  now: Date = new Date(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS,
): Fact<T> {
  const hasValue = fact.value !== null && fact.value !== undefined;

  if (!VALUE_BEARING.has(fact.status)) {
    // Missing-state statuses must not carry a value, and must not be upgraded.
    return { ...fact, value: null };
  }

  if (!hasValue) {
    return { ...fact, value: null, status: "UNKNOWN", note: fact.note ?? "No value was recorded." };
  }

  const observedMs = parseTime(fact.observedAt);
  if (observedMs === null) {
    // A value with no timestamp cannot be dated, so it cannot be current.
    return {
      ...fact,
      value: null,
      status: "UNKNOWN",
      note: fact.note ?? "Value present but no observation timestamp; cannot be treated as current.",
    };
  }

  let status = fact.status;

  if (status === "VERIFIED" && NON_VERIFYING_SOURCES.has(fact.source)) {
    status = "OBSERVED";
  }

  if (now.getTime() - observedMs > policy.staleAfterMs) {
    status = "STALE";
  }

  return { ...fact, status };
}

/** Age of a fact in milliseconds, or `null` when it cannot be dated. */
export function factAgeMs<T>(fact: Fact<T>, now: Date = new Date()): number | null {
  const t = parseTime(fact.observedAt);
  return t === null ? null : now.getTime() - t;
}

/** Human-readable age, e.g. "3d 4h", "<1m", or "unknown age". */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "unknown age";
  if (ageMs < 0) return "timestamp in the future";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "<1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export type FactTone = "verified" | "observed" | "stale" | "missing" | "blocked";

export interface FactDisplay {
  /** What to render. Never a value without its provenance state. */
  text: string;
  tone: FactTone;
  /** Age string, or `null` when the fact has no value. */
  age: string | null;
  /** True only when the fact is a fresh, verified value. */
  trustworthy: boolean;
}

const MISSING_TEXT: Record<string, string> = {
  UNKNOWN: "Unknown",
  ACCESS_REQUIRED: "Access required",
  UNREACHABLE: "Unreachable",
  ERROR: "Collection error",
};

/**
 * Renders a fact for display.
 *
 * Design constraint: a value is only ever shown alongside its age unless it is
 * VERIFIED and current. A stale number rendered bare is indistinguishable from a
 * live one, which is what makes stale inventory dangerous rather than merely old.
 */
export function describeFact<T>(fact: Fact<T>, now: Date = new Date()): FactDisplay {
  if (!factHasValue(fact)) {
    return {
      text: MISSING_TEXT[fact.status] ?? "Unknown",
      tone: fact.status === "ACCESS_REQUIRED" || fact.status === "UNREACHABLE" ? "blocked" : "missing",
      age: null,
      trustworthy: false,
    };
  }

  const age = formatAge(factAgeMs(fact, now));
  const shown = String(fact.value);

  if (fact.status === "VERIFIED") {
    return { text: shown, tone: "verified", age, trustworthy: true };
  }
  if (fact.status === "OBSERVED") {
    return { text: `${shown} (observed, ${age})`, tone: "observed", age, trustworthy: false };
  }
  // STALE
  return { text: `${shown} (stale, ${age})`, tone: "stale", age, trustworthy: false };
}

/** Convenience constructors — the only sanctioned way to declare a known-absent fact. */
export function accessRequired<T extends string | number | boolean = string>(note: string): Fact<T> {
  return { value: null, status: "ACCESS_REQUIRED", source: "NONE", observedAt: null, note };
}

export function unknownFact<T extends string | number | boolean = string>(note: string): Fact<T> {
  return { value: null, status: "UNKNOWN", source: "NONE", observedAt: null, note };
}

/** A lead from an operator or an earlier report. Never verifiable by construction. */
export function reportedFact<T extends string | number | boolean>(
  value: T,
  source: Extract<EvidenceSource, "OWNER_PROVIDED" | "HISTORICAL_REPORT">,
  observedAt: string | null,
  note?: string,
): Fact<T> {
  // Recorded as OBSERVED, never VERIFIED: a report describes a past observation.
  return { value, status: "OBSERVED", source, observedAt, ...(note ? { note } : {}) };
}
