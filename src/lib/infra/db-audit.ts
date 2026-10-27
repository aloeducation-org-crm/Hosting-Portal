/**
 * Database placement & replication audit — pure decision logic.
 *
 * The team's live panel database is Prisma/SQLite while the production service
 * database is reported as MySQL/MariaDB. Those are two different things and the
 * platform must not quietly assume they are interchangeable. This module turns
 * *observed* facts into a verdict:
 *
 *   - which engine is actually running, and which version;
 *   - whether binary logging / GTID are on, i.e. whether replication is even
 *     possible on this plan;
 *   - whether a proposed primary and replica are the same family (MySQL and
 *     MariaDB GTID implementations are **not** compatible);
 *   - what must be true before an automatic failover may be considered.
 *
 * Every function here is pure and synchronous so it can be unit-tested without
 * a database. The CLI wrappers (`scripts/audit-database.mjs`) do the I/O.
 *
 * Nothing in this file ever prints a credential.
 */

export type DbEngine = "mysql" | "mariadb" | "postgresql" | "sqlite" | "unknown";

export interface ObservedDb {
  /** Host label as configured by the operator, e.g. "hostinger-cloud". */
  host: string;
  engine: DbEngine;
  /** Full version string, e.g. "10.11.6-MariaDB" or "8.0.36". */
  version?: string | null;
  /** Parsed numeric parts, when they could be read. */
  major?: number | null;
  minor?: number | null;
  role?: "PRIMARY" | "REPLICA" | "STANDBY" | "UNKNOWN";
  /** MySQL/MariaDB `log_bin`. */
  binlogEnabled?: boolean | null;
  binlogFormat?: string | null;
  /** MySQL `gtid_mode` (ON/OFF) or MariaDB's GTID availability. */
  gtidMode?: string | null;
  serverId?: number | null;
  /** Seconds behind the primary, when this host is a replica. */
  lagSeconds?: number | null;
  /** Whether the client binary was present at all. */
  clientAvailable?: boolean;
  /** Free-form notes; credentials must already be removed. */
  notes?: string | null;
}

export interface Verdict {
  level: "ok" | "warning" | "blocked";
  title: string;
  detail: string;
  remediation?: string;
}

/** Never echo a connection string. Returns only the scheme and host shape. */
export function describeDatabaseUrl(url: string | null | undefined): { scheme: string; hasCredentials: boolean; hostShape: string } {
  if (!url) return { scheme: "unset", hasCredentials: false, hostShape: "unset" };
  const scheme = url.split(":")[0]?.toLowerCase() ?? "unset";
  const hasCredentials = /:\/\/[^/\s:@]+:[^/\s@]+@/.test(url);
  let hostShape = "opaque";
  try {
    if (scheme === "file" || url.startsWith("file:")) {
      const p = url.replace(/^file:/, "");
      hostShape = p.startsWith("/") ? "absolute-path" : "RELATIVE-PATH";
    } else {
      const parsed = new URL(url.replace(/^[a-z0-9+.-]+:\/\//, "http://"));
      hostShape = parsed.hostname ? "host:port" : "opaque";
    }
  } catch {
    hostShape = "unparseable";
  }
  return { scheme, hasCredentials, hostShape };
}

export function parseEngineFromVersion(version: string | null | undefined): DbEngine {
  if (!version) return "unknown";
  const v = version.toLowerCase();
  if (v.includes("mariadb")) return "mariadb";
  if (v.includes("postgresql") || v.includes("postgres")) return "postgresql";
  if (v.includes("mysql")) return "mysql";
  if (v.includes("sqlite")) return "sqlite";
  return "unknown";
}

export function parseVersionNumbers(version: string | null | undefined): { major: number | null; minor: number | null } {
  if (!version) return { major: null, minor: null };
  const m = version.match(/(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : { major: null, minor: null };
}

/**
 * MariaDB and MySQL both say "GTID", but the implementations are different and
 * a replica cannot follow a primary from the other family. This is the single
 * most common way a "hybrid infrastructure" replication plan silently fails.
 */
export function sameFamily(a: DbEngine, b: DbEngine): boolean {
  if (a === "unknown" || b === "unknown") return false;
  return a === b;
}

export function versionCompatible(a: ObservedDb, b: ObservedDb): Verdict {
  if (!sameFamily(a.engine, b.engine)) {
    return {
      level: "blocked",
      title: "Primary and replica are different database families",
      detail: `Primary reports ${a.engine || "unknown"} and replica reports ${b.engine || "unknown"}. MySQL and MariaDB GTID implementations are not interchangeable, so replication between them is unsupported.`,
      remediation: "Install the same family on both hosts (either MySQL on both or MariaDB on both) and match the minor version, then re-run this audit.",
    };
  }
  if (a.major == null || b.major == null) {
    return {
      level: "warning",
      title: "Version could not be read on both hosts",
      detail: `Primary version=${a.version ?? "unknown"}, replica version=${b.version ?? "unknown"}.`,
      remediation: "Run `SELECT VERSION();` on both hosts and record it before configuring replication.",
    };
  }
  if (a.major !== b.major || (a.minor ?? 0) !== (b.minor ?? 0)) {
    // Compare major *then* minor: comparing majors alone picks the wrong host
    // whenever both sides share a major version (10.11 vs 10.6), and the
    // remediation would then tell the operator to upgrade the newer host.
    const key = (d: ObservedDb) => (d.major ?? 0) * 1000 + (d.minor ?? 0);
    const higher = key(a) >= key(b) ? a : b;
    const lower = higher === a ? b : a;
    return {
      level: "warning",
      title: "Primary and replica versions differ",
      detail: `Primary is ${a.version} and replica is ${b.version}. Replication from a newer primary to an older replica is not supported.`,
      remediation: `Upgrade ${lower.host} to at least ${higher.version} before enabling replication.`,
    };
  }
  return { level: "ok", title: "Engine family and version match", detail: `Both hosts run ${a.engine} ${a.version}.` };
}

/** Can this host actually act as a replication primary? */
export function replicationCapability(db: ObservedDb): Verdict[] {
  const out: Verdict[] = [];

  if (db.engine === "sqlite") {
    out.push({
      level: "blocked",
      title: "SQLite/libSQL has no streaming replication",
      detail:
        "The panel database is SQLite (libSQL). It replicates by copying a file, not by streaming transactions. `scripts/backup.sh` plus a tested restore is the correct recovery path for it.",
      remediation:
        "Keep SQLite for the panel and back it up offsite, or migrate the panel to PostgreSQL as a separate, rehearsed project. Do not point it at a MySQL/MariaDB URL — the generated Prisma client cannot open one.",
    });
    return out;
  }

  if (db.engine === "postgresql") {
    out.push(
      db.binlogEnabled === false
        ? {
            level: "warning",
            title: "WAL archiving not confirmed",
            detail: "PostgreSQL streaming replication needs wal_level=replica (or logical) and a replication slot.",
            remediation: "Check `SHOW wal_level;` and `SELECT * FROM pg_replication_slots;`.",
          }
        : { level: "ok", title: "PostgreSQL WAL appears enabled", detail: "Confirm wal_level and a replication slot before building the replica." },
    );
    return out;
  }

  if (db.clientAvailable === false) {
    out.push({
      level: "warning",
      title: "Database client not available on this host",
      detail: "No `mysql`/`mariadb` client binary was found, so the engine, version and binary-log state could not be observed.",
      remediation: "Install the client (`apt install mysql-client` or `mariadb-client`) and re-run the audit. Nothing was assumed in the meantime.",
    });
    return out;
  }

  out.push(
    db.binlogEnabled === true
      ? { level: "ok", title: "Binary logging is enabled", detail: `log_bin=ON, format=${db.binlogFormat ?? "unknown"}.` }
      : {
          level: "blocked",
          title: "Binary logging is OFF — replication is impossible",
          detail:
            "A MySQL/MariaDB primary must have `log_bin=ON`. On managed hosting this is often not configurable by the tenant, which changes the recovery strategy from replication to verified backups.",
          remediation:
            "Ask the hosting provider to enable binary logging, or plan backup-based recovery (daily full + binary-log shipping if offered). Do not schedule a replica until this is ON.",
        },
  );

  if (db.binlogFormat && db.binlogFormat.toUpperCase() !== "ROW") {
    out.push({
      level: "warning",
      title: `binlog_format is ${db.binlogFormat}, not ROW`,
      detail: "ROW-based replication is the safe default; STATEMENT can diverge on non-deterministic statements.",
      remediation: "Set binlog_format=ROW on the primary and on the replica.",
    });
  }

  const gtid = (db.gtidMode ?? "").toUpperCase();
  if (db.engine === "mysql") {
    out.push(
      gtid === "ON"
        ? { level: "ok", title: "GTID mode is ON", detail: "Failover can re-point replicas without manual binlog coordinates." }
        : {
            level: "warning",
            title: "GTID mode is not ON",
            detail: `gtid_mode=${db.gtidMode ?? "unknown"}. Without GTID, promotion requires reading exact binlog file/position, which is error-prone under pressure.`,
            remediation: "Enable GTID (`gtid_mode=ON`, `enforce_gtid_consistency=ON`) during a maintenance window, or accept manual coordinate-based failover.",
          },
    );
  } else if (db.engine === "mariadb") {
    out.push({
      level: gtid === "OFF" ? "warning" : "ok",
      title: "MariaDB GTID",
      detail:
        "MariaDB GTID is enabled by default and uses domain-server_id-sequence, which is not the same scheme as MySQL. Never mix the two families in one replication topology.",
      remediation: gtid === "OFF" ? "Confirm `SELECT @@gtid_current_pos;` works on both hosts." : undefined,
    });
  }

  if (!db.serverId || db.serverId <= 0) {
    out.push({
      level: "blocked",
      title: "server_id is not set",
      detail: `server_id=${db.serverId ?? "unset"}. Every primary and replica needs a unique, non-zero server_id.`,
      remediation: "Set a unique server_id in each host's my.cnf and restart the database service in a maintenance window.",
    });
  }

  return out;
}

/**
 * Is automatic failover safe to switch on? With a few-hours RTO the honest
 * answer is usually "not yet" — a tested manual promotion is safer than an
 * untested automatic one.
 */
export function failoverReadiness(opts: {
  primary: ObservedDb;
  replica: ObservedDb;
  replicationHealthy: boolean;
  lagSeconds: number | null;
  acceptableDowntimeMinutes: number;
  automaticFailoverConfigured: boolean;
  promotionTested: boolean;
}): Verdict[] {
  const out: Verdict[] = [];
  const family = versionCompatible(opts.primary, opts.replica);
  if (family.level !== "ok") out.push(family);

  if (!opts.replicationHealthy) {
    out.push({
      level: "blocked",
      title: "Replication is not currently healthy",
      detail: "A replica that is not applying transactions cannot be promoted without data loss.",
      remediation: "Fix replication first (`SHOW REPLICA STATUS\\G` → Replica_IO_Running / Replica_SQL_Running must both be Yes).",
    });
  }

  if (opts.lagSeconds != null && opts.lagSeconds > 60) {
    out.push({
      level: "warning",
      title: `Replica lag is ${opts.lagSeconds}s`,
      detail: "Promoting now would lose up to that much committed data. With a 10–50 Mbps office uplink this is expected under load.",
      remediation: "Alert above 30s of lag; only promote after confirming the lag has drained or accepting the documented data loss.",
    });
  }

  if (opts.automaticFailoverConfigured && !opts.promotionTested) {
    out.push({
      level: "blocked",
      title: "Automatic failover is configured but has never been tested",
      detail:
        "An untested automatic promotion can split writes across two primaries. With an acceptable downtime of a few hours, a tested manual promotion is the safer first step.",
      remediation: "Disable automatic failover, run a documented manual promotion drill, and only then reconsider automation.",
    });
  }

  if (!opts.promotionTested) {
    out.push({
      level: "warning",
      title: "No promotion drill has been recorded",
      detail: "Until a promotion has been rehearsed end to end, failover time is unknown — it may exceed the acceptable downtime.",
      remediation: "Run the drill in docs/HYBRID-INFRASTRUCTURE-PLAN.md §Failover drill and record the measured time.",
    });
  }

  if (out.length === 0) {
    out.push({
      level: "ok",
      title: "Failover prerequisites are met",
      detail: `Same engine family, healthy replication, lag ${opts.lagSeconds ?? "unknown"}s, promotion tested. Acceptable downtime ${opts.acceptableDowntimeMinutes} minutes.`,
    });
  }
  return out;
}

/**
 * Capacity verdict for a host running the panel *and* the database.
 * Thresholds are deliberately conservative: they describe when to measure more
 * closely, not a guarantee that 500 concurrent users will fit.
 */
export function capacityVerdict(opts: {
  host: string;
  ramGb: number;
  cpuCores: number;
  ramUsedPercent: number | null;
  cpuUsedPercent: number | null;
  diskUsedPercent: number | null;
  concurrentUsersTarget: number;
  sharesHostWithDatabase: boolean;
  loadTestPerformed: boolean;
}): Verdict[] {
  const out: Verdict[] = [];
  const { ramGb } = opts;

  if (opts.sharesHostWithDatabase && ramGb <= 4) {
    out.push({
      level: "warning",
      title: `Application and database share a ${ramGb} GB host`,
      detail:
        "Node.js/PM2, MySQL/MariaDB and the OS page cache all compete for the same 4 GB. InnoDB's buffer pool will be small, so query latency grows with data size well before CPU saturates.",
      remediation:
        "Set an explicit innodb_buffer_pool_size (≈1–1.5 GB on a 4 GB host), cap PM2 with max_memory_restart, and measure under load before raising the concurrency target.",
    });
  }

  if (opts.ramUsedPercent != null && opts.ramUsedPercent >= 85) {
    out.push({
      level: "blocked",
      title: `Memory usage is ${Math.round(opts.ramUsedPercent)}%`,
      detail: "Above ~85% the host starts swapping or the OOM killer starts choosing victims — often the database.",
      remediation: `Upgrade ${opts.host} to the next RAM tier (e.g. ${Math.max(8, ramGb * 2)} GB) or move the database to its own host.`,
    });
  } else if (opts.ramUsedPercent != null && opts.ramUsedPercent >= 70) {
    out.push({
      level: "warning",
      title: `Memory usage is ${Math.round(opts.ramUsedPercent)}%`,
      detail: "There is headroom, but not enough for a traffic spike plus a build running on the same host.",
      remediation: "Keep CI/build work off this host and re-measure at peak.",
    });
  }

  if (opts.cpuUsedPercent != null && opts.cpuUsedPercent >= 80) {
    out.push({
      level: "warning",
      title: `CPU usage is ${Math.round(opts.cpuUsedPercent)}%`,
      detail: `Sustained load on ${opts.cpuCores} core(s) leaves little room for builds, backups or traffic growth.`,
      remediation: "Move builds and backups to another host, then re-measure. Upgrade vCPUs only if the load is genuinely request-driven.",
    });
  }

  if (opts.diskUsedPercent != null && opts.diskUsedPercent >= 80) {
    out.push({
      level: "warning",
      title: `Disk usage is ${Math.round(opts.diskUsedPercent)}%`,
      detail: "Databases slow down sharply as the filesystem fills, and backups need free space equal to the data size.",
      remediation: "Prune old releases and rotate backups offsite; expand storage before 90%.",
    });
  }

  if (!opts.loadTestPerformed) {
    out.push({
      level: "warning",
      title: `No load test at ${opts.concurrentUsersTarget} concurrent users`,
      detail:
        "Hardware sizing without a measured request rate is a guess. Concurrent users are not the load — requests/second and query cost are.",
      remediation:
        "Run a realistic load test (docs/HYBRID-INFRASTRUCTURE-PLAN.md §Load test), recording p95 latency, error rate, CPU, RAM, database connections and disk latency. Buy RAM only after that evidence exists.",
    });
  }

  if (out.length === 0) {
    out.push({
      level: "ok",
      title: "Capacity looks adequate for the recorded load",
      detail: `${opts.host}: ${ramGb} GB RAM, ${opts.cpuCores} cores, RAM ${Math.round(opts.ramUsedPercent ?? 0)}%, CPU ${Math.round(opts.cpuUsedPercent ?? 0)}%, disk ${Math.round(opts.diskUsedPercent ?? 0)}%.`,
    });
  }
  return out;
}

/**
 * Where each piece of the hybrid infrastructure should live, given the observed
 * facts. Returns a placement table the dashboard can render — with the
 * assumption behind each row stated explicitly.
 */
export function placementPlan(opts: {
  productionHost: ObservedDb | null;
  officeA: { ramGb: number; online: boolean } | null;
  officeB: { ramGb: number; online: boolean } | null;
  officeUploadMbps: number;
  acceptableDowntimeMinutes: number;
}): Array<{ role: string; host: string; rationale: string; risk: string }> {
  const plan: Array<{ role: string; host: string; rationale: string; risk: string }> = [];

  plan.push({
    role: "Public application + primary database",
    host: "Hostinger Cloud (4 GB RAM / 100 GB)",
    rationale:
      "It already runs the panel under PM2 with the database locally, and it is the only host with datacenter-grade connectivity. Keeping the public path off the office uplink avoids a single 10–50 Mbps link becoming the bottleneck.",
    risk: "Application and database share RAM. Measure before raising the concurrency target; upgrade RAM before adding vCPUs.",
  });

  if (opts.officeA) {
    plan.push({
      role: "Database replica + recovery application",
      host: `Office Server A (${opts.officeA.ramGb} GB RAM)`,
      rationale:
        opts.productionHost && opts.productionHost.binlogEnabled
          ? "Binary logging is available, so an asynchronous read-only replica is feasible. 16 GB is enough to hold a warm copy and run a recovery instance of the panel."
          : "Binary logging was NOT confirmed, so this host is a *backup restore target*, not a streaming replica. Do not schedule replication until the audit says log_bin=ON.",
      risk: opts.officeA.online
        ? "Behind office power and internet. It is a recovery asset, never a public failover target while the office link is the only path."
        : "Currently unreachable from the panel; no heartbeat recorded. Treat every claim about it as unverified.",
    });
  }

  if (opts.officeB) {
    plan.push({
      role: "CI/build worker + staging + local backup copy",
      host: `Office Server B (${opts.officeB.ramGb} GB RAM)`,
      rationale:
        "Builds are CPU- and RAM-hungry and must never compete with production on the 4 GB host. 8 GB is enough for one serialized build plus a staging copy.",
      risk: "A self-hosted runner needs scoped credentials. Never give it production database access.",
    });
  }

  plan.push({
    role: "Offsite encrypted backup",
    host: "Independent storage (not Hostinger, not the office)",
    rationale:
      "A replica is not a backup: a dropped table or a bad migration propagates to it instantly. Offsite copies with retention are the only defence against that.",
    risk: "Only counts as a backup once a restore has been verified. Record the restore duration each time.",
  });

  plan.push({
    role: "Failover strategy",
    host: "Manual, approval-gated",
    rationale: `Acceptable downtime is ${opts.acceptableDowntimeMinutes} minutes, so a tested manual promotion is sufficient and far safer than an untested automatic one.`,
    risk: "Automatic failover can split writes. Do not enable it before a promotion drill has been recorded.",
  });

  return plan;
}
