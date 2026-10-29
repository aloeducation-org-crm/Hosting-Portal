/**
 * Server registry response shaping — ALO Hosting AI
 * =================================================
 *
 * The registry is **observed state**, not configured state. Every field in a
 * server record must originate from one of exactly three places:
 *
 *   1. A row an operator or an enrolled agent created.
 *   2. A reading an agent actually reported.
 *   3. `systemData` — this control-plane host's own measurements, which are
 *      real but describe *this* host and never a remote one.
 *
 * What must never appear here is a default, an example, or an assumption: a
 * hardware spec nobody measured, an IP nobody assigned, a region nobody chose.
 * A dashboard that renders invented capacity is worse than a dashboard that
 * renders nothing, because it is indistinguishable from a working one and an
 * operator will size real work against numbers that were never true.
 *
 * This module exists so that rule is enforced in one pure, testable place
 * instead of being re-derived (and re-broken) at each call site. It previously
 * held a hardcoded "Primary Edge & App Node" record — 4 cores, 15 GB, 100 GB,
 * IP 100.85.239.114, region ap-south-1 — which was inserted into the database
 * on an empty read. Those numbers were never measured on any host.
 */

/** Minimum the shaper needs from a server row; kept structural so tests can build fixtures. */
export interface RegistryServerRecord {
  readonly id: string;
  readonly hostname: string;
  readonly status: string;
  readonly [key: string]: unknown;
}

export interface ServerRegistryResponse<S extends RegistryServerRecord> {
  /** Actual registered servers. Empty until an operator or agent registers one. */
  servers: S[];
  /** Convenience alias for the first server. `null` — not a synthetic row — when none exist. */
  primary: S | null;
  /**
   * True when no server has been registered. The dashboard must render this as
   * "no servers yet, enroll one", never as a healthy list.
   */
  enrollmentRequired: boolean;
  /**
   * True when servers exist but none is in an operational state. Distinguished
   * from `enrollmentRequired` because the remedy is different: investigate the
   * existing hosts rather than enroll a new one.
   */
  allServersUnavailable: boolean;
  /** Operator-facing explanation of the empty/disabled state. `null` when neither applies. */
  stateDetail: string | null;
}

/**
 * Statuses that mean "this host is reachable and expected to serve traffic".
 *
 * Derived from the `ServerStatus` enum in `prisma/schema.prisma`
 * (`ACTIVE`, `ERROR`, `PROVISIONING`, `ONLINE`, `OFFLINE`, `MAINTENANCE`).
 * `PROVISIONING` is deliberately excluded: it is a host that is not ready yet,
 * and reporting it as available would let a deploy target it.
 */
export const OPERATIONAL_SERVER_STATUSES: readonly string[] = ["ONLINE", "ACTIVE"];

export function isOperationalServerStatus(status: unknown): boolean {
  return typeof status === "string" && OPERATIONAL_SERVER_STATUSES.includes(status);
}

/**
 * Builds the registry response from real rows only.
 *
 * Pure: no database access, no insertion, no defaults applied to hardware
 * fields. Calling this twice with the same input returns the same output, and
 * calling it with no servers cannot create one.
 */
export function buildServerRegistryResponse<S extends RegistryServerRecord>(
  servers: readonly S[],
): ServerRegistryResponse<S> {
  const list = [...servers];
  const enrollmentRequired = list.length === 0;
  const allServersUnavailable = list.length > 0 && !list.some((s) => isOperationalServerStatus(s.status));

  let stateDetail: string | null = null;
  if (enrollmentRequired) {
    stateDetail =
      "No servers are registered. The registry reports observed state only, so it will stay empty until a server is enrolled through the agent bootstrap flow. No capacity is inferred or assumed.";
  } else if (allServersUnavailable) {
    stateDetail =
      "Servers are registered but none is in an operational state. Capacity figures below describe hardware, not availability.";
  }

  return {
    servers: list,
    primary: list[0] ?? null,
    enrollmentRequired,
    allServersUnavailable,
    stateDetail,
  };
}
