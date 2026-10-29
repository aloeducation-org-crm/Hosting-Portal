/**
 * Four-server inventory — ALO Hosting AI
 * ======================================
 *
 * The registry of record for Servers A–D. Every field is a `Fact` from
 * `inventory.ts`, so each value carries its source and observation time and
 * cannot be rendered as more trustworthy than its evidence allows.
 *
 * **Everything seeded here is OWNER_PROVIDED.** None of it has been observed by
 * this codebase, because no host is reachable from the environment that wrote it
 * (see `docs/audit/BLOCKER_REGISTER.md` B-1). The strongest status any of these
 * facts can reach is OBSERVED, and after the freshness window they all decay to
 * STALE automatically — which is the intended behaviour, not a defect.
 *
 * `REPORTED_AT` is the date the operator supplied the leads. It is deliberately
 * **not** a host measurement time, and nothing in this module pretends it is.
 *
 * Server C and Server D are seeded with identity only. Their historical figures
 * (the Hostinger plan numbers) are recorded as plan claims awaiting provider
 * confirmation, and every connection fact is ACCESS_REQUIRED rather than guessed.
 */
import {
  type Fact,
  type FreshnessPolicy,
  DEFAULT_FRESHNESS,
  accessRequired,
  normaliseFact,
  reportedFact,
  unknownFact,
} from "./inventory";

/** The date the operator reported these leads. Not a measurement timestamp. */
export const REPORTED_AT = "2026-10-29T00:00:00.000Z";

export type ServerId = "SERVER_A" | "SERVER_B" | "SERVER_C" | "SERVER_D";

export type ServerClass =
  | "physical-laptop"
  | "physical-desktop"
  | "shared-hosting"
  | "unknown";

export type ConnectionMethod = "ssh" | "tailscale" | "provider-api" | "cpanel-api" | "sftp" | "none";

export interface ServerInventoryEntry {
  id: ServerId;
  /** Inventory label. A label is not an identity. */
  label: string;
  hostname: Fact<string>;
  serverClass: ServerClass;
  /** Verified provider, or unknown. A domain is not proof of a provider. */
  provider: Fact<string>;
  /** Which connection methods are actually authorised and available. */
  connection: {
    method: ConnectionMethod;
    /** True only when a live connection has been demonstrated from this codebase. */
    demonstrated: boolean;
    endpoint: Fact<string>;
    note: string;
  };
  /** Facts below are owner-reported until a host observation replaces them. */
  facts: Record<string, Fact>;
  /** What must happen before any field here can be promoted to VERIFIED. */
  blockedBy: string[];
}

const REPORTED: "OWNER_PROVIDED" = "OWNER_PROVIDED";

export const SERVER_INVENTORY: readonly ServerInventoryEntry[] = [
  {
    id: "SERVER_A",
    label: "Server A",
    hostname: reportedFact("alo-server-lap", REPORTED, REPORTED_AT, "Operator-reported inventory label."),
    serverClass: "physical-laptop",
    provider: unknownFact("No provider evidence obtained. A hostname is not a provider."),
    connection: {
      method: "ssh",
      demonstrated: false,
      endpoint: accessRequired(
        "Tailscale/LAN address reported (100.94.234.101 / 192.168.0.197) but neither resolves from the execution environment and no authorised session exists.",
      ),
      note: "Connection not attempted. A-6 (read-only host inspection authorisation) has not been granted.",
    },
    facts: {
      hardware: reportedFact("HP ZBook Firefly 14 G7", REPORTED, REPORTED_AT),
      cpu: reportedFact("Intel Core i5-10310U, 4 cores / 8 threads, 1.70 GHz base", REPORTED, REPORTED_AT),
      ram: reportedFact("16 GB installed (15 GiB detected)", REPORTED, REPORTED_AT),
      storage: reportedFact("Samsung NVMe ~476.9 GB; LVM PV ~473.9 GB; root LV 100 GB", REPORTED, REPORTED_AT),
      os: reportedFact("Ubuntu 22.04.5 LTS, kernel 5.15.0-198-generic, x86-64", REPORTED, REPORTED_AT),
      node: reportedFact("v24.22.1", REPORTED, REPORTED_AT),
      lanAddress: reportedFact("192.168.0.197", REPORTED, REPORTED_AT, "Historical lead; not re-verified."),
      tailscaleAddress: reportedFact("100.94.234.101", REPORTED, REPORTED_AT, "Historical lead; not re-verified."),
      publicIp: unknownFact("Never established. Operator reports 'not confirmed'."),
      pm2: reportedFact(
        "7 processes reported: alaminn, alo-desktop, alo-hosting, alo-learning (errored, 15 restarts), alo-sub-apps, friendconnect, marketingos (errored, 15 restarts)",
        REPORTED,
        REPORTED_AT,
        "Process list is a historical snapshot and must be refreshed before display as current.",
      ),
      capacityRisk: reportedFact(
        "Laptop depends on office power and Wi-Fi; not an independent external failover",
        REPORTED,
        REPORTED_AT,
      ),
    },
    blockedBy: [
      "A-6: authorisation for read-only host inspection",
      "No route from the execution environment to the Tailscale or LAN address",
    ],
  },
  {
    id: "SERVER_B",
    label: "Server B",
    hostname: reportedFact("hosting.alolabs.net", REPORTED, REPORTED_AT, "Domain reported; host behind it not verified."),
    serverClass: "physical-desktop",
    provider: unknownFact("No provider evidence. The domain resolving is not proof of where it points."),
    connection: {
      method: "ssh",
      demonstrated: false,
      endpoint: accessRequired(
        "Tailscale/LAN address reported (100.85.239.114 / 192.168.0.24) but neither resolves from the execution environment.",
      ),
      note: "Connection not attempted; A-6 not granted.",
    },
    facts: {
      hardware: reportedFact("Generic desktop", REPORTED, REPORTED_AT),
      cpu: reportedFact("Intel Core 2 Duo E7500, 2 cores / 2 threads, 2.93 GHz", REPORTED, REPORTED_AT),
      ram: reportedFact("8 GB installed (7.7 GiB detected)", REPORTED, REPORTED_AT),
      storage: reportedFact(
        "HDD Hitachi HDS72105 ~465.8 GB (root ~456 GB); WD ~111.8 GB at /mnt/ssd1; WDS128G2G0A-00 ~119.2 GB at /mnt/ssd2",
        REPORTED,
        REPORTED_AT,
      ),
      os: reportedFact("Ubuntu 22.04.5 LTS, kernel 5.15.0-198-generic, x86-64", REPORTED, REPORTED_AT),
      node: reportedFact("v22.23.3", REPORTED, REPORTED_AT),
      tailscaleAddress: reportedFact("100.85.239.114", REPORTED, REPORTED_AT, "Historical lead; not re-verified."),
      pm2: reportedFact(
        "5 processes reported: agentos-app, alo-learning (restart count truncated in source), friendconnect, friendconnect-soc…, marketingos (restart count truncated)",
        REPORTED,
        REPORTED_AT,
        "Truncated names and restart counts must be read from the live process list.",
      ),
      cpuConcern: reportedFact(
        "One snapshot reported ~99.6% CPU, possibly transient — not evidence of sustained saturation",
        REPORTED,
        REPORTED_AT,
      ),
      capacityRisk: reportedFact(
        "Dual-core 2009-era CPU; unsuitable for heavy build workloads until measured. Shares office power and internet with Server A, so the two are not independent failure domains.",
        REPORTED,
        REPORTED_AT,
      ),
    },
    blockedBy: [
      "A-6: authorisation for read-only host inspection",
      "No route from the execution environment to the Tailscale or LAN address",
    ],
  },
  {
    id: "SERVER_C",
    label: "Server C",
    hostname: unknownFact("Hostinger hosting hostname not established."),
    serverClass: "shared-hosting",
    provider: reportedFact("Hostinger", REPORTED, REPORTED_AT, "Operator-reported provider; product tier unverified."),
    connection: {
      method: "provider-api",
      demonstrated: false,
      endpoint: accessRequired(
        "B-3: product tier unknown (shared / Cloud / VPS). An adapter exists in src/lib/providers/hostinger.ts but no authorised credential or live call.",
      ),
      note: "Capabilities depend entirely on the tier: shared hosting provides no root, no Docker, no PM2.",
    },
    facts: {
      planCpu: reportedFact("4 CPU cores (plan claim, not measured)", REPORTED, REPORTED_AT),
      planRam: reportedFact("4 GB RAM (plan claim, not measured)", REPORTED, REPORTED_AT),
      planDisk: reportedFact("100 GB (plan claim, not measured)", REPORTED, REPORTED_AT),
      planInodes: reportedFact("2,000,000 inodes (plan claim)", REPORTED, REPORTED_AT),
      planProcesses: reportedFact("200 max processes, 100 PHP workers (plan claim)", REPORTED, REPORTED_AT),
      actualUtilization: unknownFact("No provider or host evidence. Plan limits are not current usage."),
      productTier: unknownFact("B-3: must be established from authoritative account evidence."),
    },
    blockedBy: [
      "B-3: authoritative product tier and account identity",
      "An authorised Hostinger API token (not to be pasted into the dashboard or repo)",
    ],
  },
  {
    id: "SERVER_D",
    label: "Server D",
    hostname: unknownFact("cPanel server hostname not established."),
    serverClass: "unknown",
    provider: unknownFact("Provider unverified. Not assumed to be Server C, or the same machine as any other server."),
    connection: {
      method: "cpanel-api",
      demonstrated: false,
      endpoint: accessRequired(
        "B-4: no scoped cPanel API token. An adapter exists in src/lib/providers/cpanel.ts but has never made a live call.",
      ),
      note: "Email for aloedu.com reported here; must be confirmed rather than assumed.",
    },
    facts: {
      emailDomain: reportedFact("aloeducation.com", REPORTED, REPORTED_AT, "Reported as the email domain hosted here."),
      mailboxes: unknownFact("No provider evidence."),
      dnsRecords: unknownFact("MX / SPF / DKIM / DMARC not inspected. Must not be modified without approval."),
      tls: unknownFact("Certificate coverage not inspected."),
    },
    blockedBy: [
      "B-4: a least-privilege cPanel API token issued by the provider",
      "A-5: confirmation of which account/provider actually holds this infrastructure",
    ],
  },
] as const;

/**
 * Returns the inventory with every fact normalised against the freshness policy.
 *
 * This is the function a dashboard route should call. It is pure, performs no I/O,
 * and cannot promote a fact above what its source supports.
 */
export function resolveInventory(
  now: Date = new Date(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS,
  entries: readonly ServerInventoryEntry[] = SERVER_INVENTORY,
): ServerInventoryEntry[] {
  return entries.map((entry) => ({
    ...entry,
    hostname: normaliseFact(entry.hostname, now, policy),
    provider: normaliseFact(entry.provider, now, policy),
    connection: {
      ...entry.connection,
      endpoint: normaliseFact(entry.connection.endpoint, now, policy),
    },
    facts: Object.fromEntries(
      Object.entries(entry.facts).map(([key, fact]) => [key, normaliseFact(fact, now, policy)]),
    ),
  }));
}

/** Counts by status, for an at-a-glance honesty summary of the registry. */
export function inventoryEvidenceSummary(entries: readonly ServerInventoryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const bump = (s: string) => {
    counts[s] = (counts[s] ?? 0) + 1;
  };
  for (const entry of entries) {
    bump(entry.hostname.status);
    bump(entry.provider.status);
    bump(entry.connection.endpoint.status);
    for (const fact of Object.values(entry.facts)) bump(fact.status);
  }
  return counts;
}
