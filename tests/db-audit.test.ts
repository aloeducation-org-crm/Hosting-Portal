/**
 * Database placement & replication audit — `src/lib/infra/db-audit.ts`.
 *
 * These are the pure decision functions behind the Topology tab and
 * `scripts/audit-database.mjs`. The behaviours that matter are the honest ones:
 *
 *   - an unmeasured host is reported as unknown, never as a fabricated zero;
 *   - a connection string is described by shape only, never echoed;
 *   - MySQL and MariaDB are different replication families and must not be
 *     mixed in one topology;
 *   - replication without `log_bin=ON` is impossible, and the plan degrades to
 *     verified backups instead of pretending a replica exists;
 *   - automatic failover that has never been drilled is *blocked*, because with
 *     a few-hours RTO a tested manual promotion is the safer first step;
 *   - hardware is judged on measured load, so "buy more RAM" is never the first
 *     recommendation.
 */
import { describe, it, expect } from "vitest";
import {
  capacityVerdict,
  describeDatabaseUrl,
  failoverReadiness,
  parseEngineFromVersion,
  parseVersionNumbers,
  placementPlan,
  replicationCapability,
  sameFamily,
  versionCompatible,
  type ObservedDb,
} from "@/lib/infra/db-audit";

const mariadb = (over: Partial<ObservedDb> = {}): ObservedDb => ({
  host: "hostinger-cloud",
  engine: "mariadb",
  version: "10.11.6-MariaDB",
  major: 10,
  minor: 11,
  role: "PRIMARY",
  binlogEnabled: true,
  binlogFormat: "ROW",
  gtidMode: "ON",
  serverId: 1,
  clientAvailable: true,
  ...over,
});

const titles = (verdicts: Array<{ title: string }>) => verdicts.map((v) => v.title);
const levels = (verdicts: Array<{ level: string }>) => verdicts.map((v) => v.level);

describe("connection string description", () => {
  it("describes a URL by scheme and host shape and never echoes it", () => {
    const described = describeDatabaseUrl("mysql://alo:sup3rsecret@db.internal:3306/alohosting");
    expect(described.scheme).toBe("mysql");
    expect(described.hasCredentials).toBe(true);
    expect(described.hostShape).toBe("host:port");
    expect(JSON.stringify(described)).not.toContain("sup3rsecret");
    expect(JSON.stringify(described)).not.toContain("alo:");
    expect(JSON.stringify(described)).not.toContain("db.internal");
  });

  it("flags a relative SQLite path, which is the failure mode that broke production before", () => {
    expect(describeDatabaseUrl("file:./db/custom.db")).toEqual({ scheme: "file", hasCredentials: false, hostShape: "RELATIVE-PATH" });
    expect(describeDatabaseUrl("file:/var/lib/alo/custom.db").hostShape).toBe("absolute-path");
    expect(describeDatabaseUrl("file:./db/custom.db").hostShape).not.toBe("absolute-path");
  });

  it("reports an unset URL as unset instead of guessing", () => {
    expect(describeDatabaseUrl(undefined)).toEqual({ scheme: "unset", hasCredentials: false, hostShape: "unset" });
    expect(describeDatabaseUrl(null).scheme).toBe("unset");
    expect(describeDatabaseUrl("").scheme).toBe("unset");
  });

  it("does not claim credentials are present when the URL has none", () => {
    expect(describeDatabaseUrl("postgresql://db.internal:5432/alo").hasCredentials).toBe(false);
    expect(describeDatabaseUrl("sqlite:db/custom.db").scheme).toBe("sqlite");
  });
});

describe("engine and version parsing", () => {
  it("distinguishes MariaDB from MySQL, which is the whole point of the audit", () => {
    expect(parseEngineFromVersion("10.11.6-MariaDB")).toBe("mariadb");
    expect(parseEngineFromVersion("8.0.36")).toBe("unknown"); // a bare number proves nothing
    expect(parseEngineFromVersion("8.0.36-MySQL")).toBe("mysql");
    expect(parseEngineFromVersion("PostgreSQL 16.2 on x86_64")).toBe("postgresql");
    expect(parseEngineFromVersion("3.45.1 SQLite")).toBe("sqlite");
    expect(parseEngineFromVersion(null)).toBe("unknown");
    expect(parseEngineFromVersion("")).toBe("unknown");
  });

  it("reads major and minor numbers, and says so when it cannot", () => {
    expect(parseVersionNumbers("10.11.6-MariaDB")).toEqual({ major: 10, minor: 11 });
    expect(parseVersionNumbers("8.0")).toEqual({ major: 8, minor: 0 });
    expect(parseVersionNumbers("unknown")).toEqual({ major: null, minor: null });
    expect(parseVersionNumbers(null)).toEqual({ major: null, minor: null });
  });

  it("treats an unknown engine as never the same family", () => {
    expect(sameFamily("mariadb", "mariadb")).toBe(true);
    expect(sameFamily("mysql", "mariadb")).toBe(false);
    expect(sameFamily("mariadb", "unknown")).toBe(false);
    expect(sameFamily("unknown", "unknown")).toBe(false);
    expect(sameFamily("sqlite", "postgresql")).toBe(false);
  });
});

describe("primary/replica version compatibility", () => {
  it("blocks a MySQL primary with a MariaDB replica", () => {
    const verdict = versionCompatible(mariadb({ engine: "mysql", version: "8.0.36" }), mariadb({ host: "office-a", engine: "mariadb" }));
    expect(verdict.level).toBe("blocked");
    expect(verdict.title).toContain("different database families");
    expect(verdict.detail).toContain("not interchangeable");
    expect(verdict.remediation).toContain("same family");
  });

  it("blocks when either side could not be observed at all", () => {
    const verdict = versionCompatible(mariadb(), mariadb({ host: "office-a", engine: "unknown", version: null, major: null }));
    expect(verdict.level).toBe("blocked");
    expect(verdict.detail).toContain("unknown");
  });

  it("warns when versions differ and names the host that must be upgraded", () => {
    const verdict = versionCompatible(mariadb({ version: "10.11.6-MariaDB", major: 10, minor: 11 }), mariadb({ host: "office-a", version: "10.6.4-MariaDB", major: 10, minor: 6 }));
    expect(verdict.level).toBe("warning");
    expect(verdict.remediation).toContain("office-a");
    expect(verdict.remediation).toContain("10.11.6-MariaDB");
  });

  it("warns rather than approving when the version could not be read on both hosts", () => {
    const verdict = versionCompatible(mariadb({ major: null, minor: null }), mariadb({ host: "office-a" }));
    expect(verdict.level).toBe("warning");
    expect(verdict.remediation).toContain("SELECT VERSION()");
  });

  it("approves only when family and version both match", () => {
    const verdict = versionCompatible(mariadb(), mariadb({ host: "office-a" }));
    expect(verdict.level).toBe("ok");
    expect(verdict.detail).toContain("mariadb 10.11.6-MariaDB");
  });
});

describe("replication capability", () => {
  it("blocks SQLite/libSQL: it has no streaming replication, and the recovery path is a verified backup", () => {
    const verdicts = replicationCapability({ host: "panel", engine: "sqlite", version: "3.45.1 SQLite" });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].level).toBe("blocked");
    expect(verdicts[0].detail).toContain("copying a file");
    expect(verdicts[0].remediation).toContain("Do not point it at a MySQL/MariaDB URL");
  });

  it("says replication is impossible when binary logging is OFF, which is the open question for managed hosting", () => {
    const verdicts = replicationCapability(mariadb({ binlogEnabled: false }));
    expect(levels(verdicts)).toContain("blocked");
    const blocked = verdicts.find((v) => v.level === "blocked")!;
    expect(blocked.title).toContain("Binary logging is OFF");
    expect(blocked.detail).toContain("often not configurable by the tenant");
    expect(blocked.remediation).toContain("backup-based recovery");
    expect(blocked.remediation).toContain("Do not schedule a replica");
  });

  it("confirms capability only when log_bin, ROW format, GTID and a server_id are all observed", () => {
    const verdicts = replicationCapability(mariadb());
    expect(levels(verdicts)).not.toContain("blocked");
    expect(levels(verdicts)).not.toContain("warning");
    expect(titles(verdicts)).toContain("Binary logging is enabled");
  });

  it("blocks on a missing or zero server_id", () => {
    for (const serverId of [0, null, undefined]) {
      const verdicts = replicationCapability(mariadb({ serverId: serverId as number | null | undefined }));
      expect(levels(verdicts), `serverId=${serverId}`).toContain("blocked");
      expect(titles(verdicts)).toContain("server_id is not set");
    }
  });

  it("warns on STATEMENT binlog format, which can diverge on non-deterministic statements", () => {
    const verdicts = replicationCapability(mariadb({ binlogFormat: "STATEMENT" }));
    expect(levels(verdicts)).toContain("warning");
    expect(titles(verdicts).some((t) => t.includes("not ROW"))).toBe(true);
  });

  it("warns on MySQL without GTID because promotion then needs exact binlog coordinates", () => {
    const verdicts = replicationCapability(mariadb({ engine: "mysql", version: "8.0.36", gtidMode: "OFF" }));
    expect(levels(verdicts)).toContain("warning");
    const gtid = verdicts.find((v) => v.title.includes("GTID"))!;
    expect(gtid.detail).toContain("binlog file/position");
    expect(replicationCapability(mariadb({ engine: "mysql", gtidMode: "ON" })).some((v) => v.title === "GTID mode is ON")).toBe(true);
  });

  it("reports an unobserved host as unmeasured instead of assuming it can replicate", () => {
    const verdicts = replicationCapability({ host: "hostinger-cloud", engine: "unknown", clientAvailable: false });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].level).toBe("warning");
    expect(verdicts[0].title).toContain("client not available");
    expect(verdicts[0].detail).toContain("could not be observed");
    expect(verdicts[0].remediation).toContain("Nothing was assumed");
    expect(levels(verdicts)).not.toContain("ok");
  });

  it("checks PostgreSQL WAL settings rather than MySQL binary logs", () => {
    const off = replicationCapability({ host: "pg", engine: "postgresql", version: "PostgreSQL 16.2", binlogEnabled: false });
    expect(off[0].title).toContain("WAL archiving not confirmed");
    expect(off[0].remediation).toContain("wal_level");
    const on = replicationCapability({ host: "pg", engine: "postgresql", version: "PostgreSQL 16.2", binlogEnabled: true });
    expect(on[0].level).toBe("ok");
  });
});

describe("failover readiness", () => {
  const healthy = {
    primary: mariadb(),
    replica: mariadb({ host: "office-a", role: "REPLICA" as const }),
    replicationHealthy: true,
    lagSeconds: 2,
    acceptableDowntimeMinutes: 180,
    automaticFailoverConfigured: false,
    promotionTested: true,
  };

  it("is ok only when replication is healthy, lag is low and a promotion has actually been drilled", () => {
    const verdicts = failoverReadiness(healthy);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].level).toBe("ok");
    expect(verdicts[0].detail).toContain("promotion tested");
    expect(verdicts[0].detail).toContain("180 minutes");
  });

  it("blocks automatic failover that has never been tested — the agreed first step is manual and approval-gated", () => {
    const verdicts = failoverReadiness({ ...healthy, automaticFailoverConfigured: true, promotionTested: false });
    expect(levels(verdicts)).toContain("blocked");
    const blocked = verdicts.find((v) => v.level === "blocked")!;
    expect(blocked.title).toContain("never been tested");
    expect(blocked.detail).toContain("split writes");
    expect(blocked.remediation).toContain("Disable automatic failover");
  });

  it("blocks promotion of an unhealthy replica, which would lose committed data", () => {
    const verdicts = failoverReadiness({ ...healthy, replicationHealthy: false });
    expect(levels(verdicts)).toContain("blocked");
    expect(verdicts.find((v) => v.level === "blocked")!.remediation).toContain("Replica_IO_Running");
  });

  it("warns on replica lag above 60s and quantifies the possible data loss", () => {
    const verdicts = failoverReadiness({ ...healthy, lagSeconds: 240 });
    expect(levels(verdicts)).toContain("warning");
    const lag = verdicts.find((v) => v.title.includes("lag"))!;
    expect(lag.title).toContain("240s");
    expect(lag.remediation).toContain("30s");
    expect(levels(failoverReadiness({ ...healthy, lagSeconds: 60 }))).not.toContain("warning");
  });

  it("warns while no promotion drill has been recorded, because failover time is then unknown", () => {
    const verdicts = failoverReadiness({ ...healthy, promotionTested: false });
    expect(levels(verdicts)).toContain("warning");
    expect(verdicts.find((v) => v.title.includes("No promotion drill"))!.remediation).toContain("HYBRID-INFRASTRUCTURE-PLAN.md");
  });

  it("carries the family mismatch through to the failover verdict", () => {
    const verdicts = failoverReadiness({ ...healthy, replica: mariadb({ host: "office-a", engine: "mysql", version: "8.0.36" }) });
    expect(levels(verdicts)).toContain("blocked");
    expect(titles(verdicts).some((t) => t.includes("different database families"))).toBe(true);
  });

  it("treats an unmeasured lag as unknown rather than as zero", () => {
    const verdicts = failoverReadiness({ ...healthy, lagSeconds: null });
    expect(levels(verdicts)).not.toContain("warning");
    expect(verdicts[0].detail).toContain("lag unknown");
  });
});

describe("capacity verdict", () => {
  const measured = {
    host: "hostinger-cloud",
    ramGb: 4,
    cpuCores: 2,
    ramUsedPercent: 45,
    cpuUsedPercent: 20,
    diskUsedPercent: 12,
    concurrentUsersTarget: 500,
    sharesHostWithDatabase: false,
    loadTestPerformed: true,
  };

  it("is adequate only with measured headroom and a real load test behind it", () => {
    const verdicts = capacityVerdict(measured);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].level).toBe("ok");
    expect(verdicts[0].detail).toContain("4 GB RAM");
  });

  it("never recommends buying hardware before a load test exists", () => {
    const verdicts = capacityVerdict({ ...measured, loadTestPerformed: false });
    expect(levels(verdicts)).toContain("warning");
    const warning = verdicts.find((v) => v.title.includes("No load test"))!;
    expect(warning.title).toContain("500 concurrent users");
    expect(warning.detail).toContain("requests/second");
    expect(warning.remediation).toContain("Buy RAM only after that evidence exists");
    expect(levels(verdicts)).not.toContain("ok");
  });

  it("warns that the app and the database compete for the same 4 GB, with the tuning that follows", () => {
    const verdicts = capacityVerdict({ ...measured, sharesHostWithDatabase: true });
    const shared = verdicts.find((v) => v.title.includes("share a 4 GB host"))!;
    expect(shared.level).toBe("warning");
    expect(shared.remediation).toContain("innodb_buffer_pool_size");
    expect(shared.remediation).toContain("max_memory_restart");
    // An 8 GB host with its own database does not trigger it.
    expect(titles(capacityVerdict({ ...measured, ramGb: 8, sharesHostWithDatabase: true }))).not.toContain("Application and database share a 4 GB host");
  });

  it("blocks at 85% memory and warns from 70%, because the OOM killer picks the database", () => {
    const critical = capacityVerdict({ ...measured, ramUsedPercent: 91 });
    expect(levels(critical)).toContain("blocked");
    const blocked = critical.find((v) => v.level === "blocked")!;
    expect(blocked.title).toContain("91%");
    expect(blocked.detail).toContain("OOM killer");
    expect(blocked.remediation).toContain("8 GB"); // next tier from 4 GB

    const warning = capacityVerdict({ ...measured, ramUsedPercent: 72 });
    expect(levels(warning)).toContain("warning");
    expect(levels(warning)).not.toContain("blocked");
    expect(levels(capacityVerdict({ ...measured, ramUsedPercent: 69 }))).not.toContain("warning");
  });

  it("warns on sustained CPU and on a filling disk, and suggests moving work before buying cores", () => {
    const cpu = capacityVerdict({ ...measured, cpuUsedPercent: 85 }).find((v) => v.title.includes("CPU usage"))!;
    expect(cpu.level).toBe("warning");
    expect(cpu.remediation).toContain("Move builds and backups to another host");
    expect(cpu.remediation).toContain("Upgrade vCPUs only if");

    const disk = capacityVerdict({ ...measured, diskUsedPercent: 88 }).find((v) => v.title.includes("Disk usage"))!;
    expect(disk.level).toBe("warning");
    expect(disk.remediation).toContain("before 90%");
  });

  it("reports unknown utilisation as unknown rather than as a comfortable zero", () => {
    const verdicts = capacityVerdict({ ...measured, ramUsedPercent: null, cpuUsedPercent: null, diskUsedPercent: null });
    expect(levels(verdicts)).not.toContain("blocked");
    // No utilisation evidence and no load test means this cannot be called adequate.
    expect(titles(capacityVerdict({ ...measured, ramUsedPercent: null, cpuUsedPercent: null, diskUsedPercent: null, loadTestPerformed: false })).some((t) => t.includes("No load test"))).toBe(true);
  });
});

describe("placement plan", () => {
  const inputs = {
    productionHost: mariadb({ binlogEnabled: true }),
    officeA: { ramGb: 16, online: true },
    officeB: { ramGb: 8, online: true },
    officeUploadMbps: 20,
    acceptableDowntimeMinutes: 180,
  };

  it("keeps the public application and the primary database on Hostinger Cloud", () => {
    const plan = placementPlan(inputs);
    const primary = plan.find((p) => p.role.includes("Public application"))!;
    expect(primary.host).toContain("Hostinger Cloud");
    expect(primary.rationale).toContain("datacenter-grade connectivity");
    expect(primary.risk).toContain("Measure before raising the concurrency target");
  });

  it("makes Office A a streaming replica only when binary logging was actually confirmed", () => {
    const withBinlog = placementPlan(inputs).find((p) => p.role.includes("replica"))!;
    expect(withBinlog.host).toContain("Office Server A (16 GB RAM)");
    expect(withBinlog.rationale).toContain("asynchronous read-only replica is feasible");

    const unconfirmed = placementPlan({ ...inputs, productionHost: mariadb({ binlogEnabled: false }) }).find((p) => p.role.includes("replica"))!;
    expect(unconfirmed.rationale).toContain("NOT confirmed");
    expect(unconfirmed.rationale).toContain("backup restore target");
    expect(unconfirmed.rationale).toContain("Do not schedule replication until the audit says log_bin=ON");

    const neverAudited = placementPlan({ ...inputs, productionHost: null }).find((p) => p.role.includes("replica"))!;
    expect(neverAudited.rationale).toContain("NOT confirmed");
  });

  it("keeps Office A a recovery asset, never a public failover target behind the office uplink", () => {
    const row = placementPlan(inputs).find((p) => p.role.includes("replica"))!;
    expect(row.risk).toContain("recovery asset, never a public failover target");

    const offline = placementPlan({ ...inputs, officeA: { ramGb: 16, online: false } }).find((p) => p.role.includes("replica"))!;
    expect(offline.risk).toContain("unreachable");
    expect(offline.risk).toContain("unverified");
  });

  it("puts builds, staging and the local backup copy on Office B so they never compete with production", () => {
    const row = placementPlan(inputs).find((p) => p.role.includes("CI/build worker"))!;
    expect(row.host).toContain("Office Server B (8 GB RAM)");
    expect(row.rationale).toContain("never compete with production on the 4 GB host");
    expect(row.risk).toContain("Never give it production database access");
  });

  it("requires an independent offsite encrypted backup and states that a replica is not a backup", () => {
    const row = placementPlan(inputs).find((p) => p.role.includes("Offsite"))!;
    expect(row.host).toContain("not Hostinger, not the office");
    expect(row.rationale).toContain("A replica is not a backup");
    expect(row.risk).toContain("restore has been verified");
  });

  it("records manual, approval-gated failover with the agreed downtime budget", () => {
    const row = placementPlan(inputs).find((p) => p.role === "Failover strategy")!;
    expect(row.host).toContain("Manual");
    expect(row.rationale).toContain("180 minutes");
    expect(row.risk).toContain("split writes");
  });

  it("omits an office host from the plan when it is not part of the topology, without inventing a role for it", () => {
    const plan = placementPlan({ ...inputs, officeA: null, officeB: null });
    expect(plan.some((p) => p.host.includes("Office Server A"))).toBe(false);
    expect(plan.some((p) => p.host.includes("Office Server B"))).toBe(false);
    // The non-negotiable rows survive: production, offsite backup, failover strategy.
    expect(plan.some((p) => p.role.includes("Public application"))).toBe(true);
    expect(plan.some((p) => p.role.includes("Offsite"))).toBe(true);
    expect(plan.some((p) => p.role === "Failover strategy")).toBe(true);
  });
});
