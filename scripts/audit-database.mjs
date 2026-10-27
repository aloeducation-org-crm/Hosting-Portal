#!/usr/bin/env node
/**
 * Read-only database & capacity audit for one host.
 *
 * Answers the questions that decide the hybrid-infrastructure plan:
 *   - which database engine/version is actually running here?
 *   - is binary logging / GTID available, i.e. can this host be a primary?
 *   - does the panel's Prisma database (SQLite/libSQL) match what is deployed?
 *   - how much CPU / RAM / disk headroom is left on this box?
 *
 * It never writes, restarts, migrates or changes a firewall. It never prints a
 * password or a full connection string.
 *
 * Usage:
 *   node scripts/audit-database.mjs                       # human-readable
 *   node scripts/audit-database.mjs --json                # machine-readable
 *   node scripts/audit-database.mjs --host office-a --write   # also record the
 *                                                          # result in the panel DB
 *
 * Credentials: pass them the way the mysql client already reads them
 * (~/.my.cnf, MYSQL_PWD in the environment of the calling shell), or use
 * --defaults-file. This script deliberately does not accept a password argument,
 * so a password can never end up in a process listing or a shell history line.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const write = args.includes("--write");
const hostLabel = getArg("--host") || os.hostname();
const defaultsFile = getArg("--defaults-file");
const targetHost = getArg("--db-host"); // optional remote target (e.g. the VPS from Office A)

function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

/** Strip any credential from a string before it can be printed. */
function redact(text) {
  return String(text ?? "")
    .replace(/\b(?:mysql|mariadb|postgres(?:ql)?):\/\/[^/\s:@]+:[^/\s@]+@/gi, "[REDACTED_DB_URL]")
    .replace(/(-p|--password)[= ]\S+/gi, "$1[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_TOKEN]");
}

function describeUrl(url) {
  if (!url) return { scheme: "unset", hasCredentials: false, hostShape: "unset" };
  const scheme = url.split(":")[0]?.toLowerCase() ?? "unset";
  const hasCredentials = /:\/\/[^/\s:@]+:[^/\s@]+@/.test(url);
  let hostShape = "opaque";
  if (scheme === "file") hostShape = url.replace(/^file:/, "").startsWith("/") ? "absolute-path" : "RELATIVE-PATH";
  else if (hasCredentials) hostShape = "host:port";
  return { scheme, hasCredentials, hostShape };
}

async function tryRun(cmd, argv, timeoutMs = 15_000) {
  try {
    const { stdout, stderr } = await run(cmd, argv, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: stdout ?? "", stderr: stderr ?? "", code: 0 };
  } catch (error) {
    const code = typeof error?.code === "number" ? error.code : error?.errno ?? 1;
    return { ok: false, stdout: error?.stdout ?? "", stderr: error?.stderr ?? String(error?.message ?? error), code };
  }
}

// ── 1. Panel database (Prisma) ──────────────────────────────────────────────

function auditPanelDatabase() {
  const result = { provider: null, url: describeUrl(process.env.DATABASE_URL), schemaPath: "prisma/schema.prisma", verdicts: [] };
  const schemaPath = path.join(repoRoot, "prisma", "schema.prisma");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf8");
    const m = schema.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/);
    result.provider = m ? m[1] : null;
  }

  const scheme = result.url.scheme;
  if (result.provider === "sqlite" && scheme !== "file" && scheme !== "libsql" && scheme !== "unset") {
    result.verdicts.push({
      level: "blocked",
      title: `DATABASE_URL is ${scheme}:// but prisma/schema.prisma declares provider = "sqlite"`,
      detail: "A Prisma client generated for sqlite cannot open a postgresql:// or mysql:// URL; it throws at connect time. This mismatch takes the whole panel down.",
      remediation: 'Use an absolute SQLite path, e.g. DATABASE_URL="file:/var/lib/alo-hosting/alo.db". Migrating the panel to PostgreSQL/MySQL is a separate project: change the provider, regenerate every migration and re-test all models.',
    });
  }
  if (result.provider === "sqlite" && result.url.hostShape === "RELATIVE-PATH") {
    result.verdicts.push({
      level: "warning",
      title: "DATABASE_URL is a relative file: path",
      detail: "libSQL resolves it against the process working directory, so systemd, PM2 and CI can each open a different file — or none at all.",
      remediation: 'Use an absolute path: DATABASE_URL="file:/var/lib/alo-hosting/alo.db".',
    });
  }
  if (result.url.hasCredentials) {
    result.verdicts.push({
      level: "warning",
      title: "DATABASE_URL contains credentials",
      detail: "That is normal for MySQL/PostgreSQL, but the value must never be committed, logged or sent to an AI prompt. Only the scheme is printed here.",
      remediation: "Keep it in /etc/alo-hosting/panel.env (mode 0600) or a secret manager.",
    });
  }
  return result;
}

// ── 2. MySQL / MariaDB ──────────────────────────────────────────────────────

async function auditMysql() {
  const client = (await tryRun("which", ["mariadb"])).ok ? "mariadb" : (await tryRun("which", ["mysql"])).ok ? "mysql" : null;
  if (!client) {
    return {
      host: hostLabel,
      engine: "unknown",
      clientAvailable: false,
      verdicts: [
        {
          level: "warning",
          title: "No mysql/mariadb client binary on this host",
          detail: "The engine and version could not be observed, so nothing is assumed about replication capability.",
          remediation: "Install mariadb-client or mysql-client and re-run this audit.",
        },
      ],
    };
  }

  const baseArgs = ["--batch", "--skip-column-names"];
  if (defaultsFile) baseArgs.push(`--defaults-file=${defaultsFile}`);
  if (targetHost) baseArgs.push(`--host=${targetHost}`);

  const version = await tryRun(client, [...baseArgs, "-e", "SELECT VERSION();"]);
  const versionString = version.ok ? version.stdout.trim() : null;
  const engine = /mariadb/i.test(versionString ?? "") ? "mariadb" : /mysql/i.test(versionString ?? "") ? "mysql" : "unknown";

  if (!version.ok) {
    return {
      host: hostLabel,
      engine: "unknown",
      clientAvailable: true,
      version: null,
      verdicts: [
        {
          level: "warning",
          title: "The database client could not connect",
          detail: `Exit code ${version.code}. Credentials or a socket/host setting are missing — this audit will not guess an engine or a version.`,
          remediation: "Provide ~/.my.cnf or --defaults-file, then re-run. Never pass a password as a command-line argument.",
        },
      ],
    };
  }

  const vars = await tryRun(client, [
    ...baseArgs,
    "-e",
    "SHOW VARIABLES WHERE Variable_name IN ('log_bin','binlog_format','gtid_mode','server_id','version','innodb_buffer_pool_size','max_connections');",
  ]);
  const map = {};
  if (vars.ok) {
    for (const line of vars.stdout.split("\n")) {
      const [k, v] = line.split("\t");
      if (k) map[k.trim()] = (v ?? "").trim();
    }
  }

  const status = await tryRun(client, [...baseArgs, "-e", "SHOW REPLICA STATUS;"]);
  const replicaRunning = /Replica_IO_Running:\s*Yes/i.test(status.stdout) || /Slave_IO_Running:\s*Yes/i.test(status.stdout);
  const lagMatch = status.stdout.match(/Seconds_Behind_Source:\s*(\d+|NULL)/i) ?? status.stdout.match(/Seconds_Behind_Master:\s*(\d+|NULL)/i);
  const lagSeconds = lagMatch && lagMatch[1] !== "NULL" ? Number(lagMatch[1]) : null;

  const observed = {
    host: hostLabel,
    engine,
    version: versionString,
    major: Number((versionString ?? "").match(/(\d+)\./)?.[1] ?? 0) || null,
    minor: Number((versionString ?? "").match(/\d+\.(\d+)/)?.[1] ?? 0) || null,
    role: replicaRunning ? "REPLICA" : "PRIMARY",
    binlogEnabled: map.log_bin === "ON",
    binlogFormat: map.binlog_format ?? null,
    gtidMode: map.gtid_mode ?? (engine === "mariadb" ? "n/a (MariaDB GTID is built in)" : null),
    serverId: map.server_id ? Number(map.server_id) : null,
    lagSeconds,
    clientAvailable: true,
    bufferPoolBytes: map.innodb_buffer_pool_size ? Number(map.innodb_buffer_pool_size) : null,
    maxConnections: map.max_connections ? Number(map.max_connections) : null,
  };

  const verdicts = [];
  if (!observed.binlogEnabled) {
    verdicts.push({
      level: "blocked",
      title: "Binary logging is OFF — streaming replication is impossible from this host",
      detail: "A MySQL/MariaDB primary needs log_bin=ON. On managed hosting the tenant often cannot change this, which changes the recovery plan from replication to verified backups.",
      remediation: "Ask the provider to enable binary logging, or adopt daily full backups (+ binlog shipping if offered). Do not build a replica until this reads ON.",
    });
  } else {
    verdicts.push({ level: "ok", title: "Binary logging is ON", detail: `log_bin=ON, binlog_format=${observed.binlogFormat ?? "unknown"}.` });
  }
  if (observed.binlogFormat && observed.binlogFormat.toUpperCase() !== "ROW") {
    verdicts.push({
      level: "warning",
      title: `binlog_format is ${observed.binlogFormat}, not ROW`,
      detail: "STATEMENT-based replication can diverge on non-deterministic statements (UUID(), NOW() with certain isolation, LIMIT without ORDER BY).",
      remediation: "Set binlog_format=ROW on the primary and the replica.",
    });
  }
  if (!observed.serverId) {
    verdicts.push({
      level: "blocked",
      title: "server_id is not set",
      detail: "Every primary and replica needs a unique non-zero server_id.",
      remediation: "Set server_id in my.cnf on each host and restart the service in a maintenance window.",
    });
  }
  if (engine === "mysql" && String(observed.gtidMode).toUpperCase() !== "ON") {
    verdicts.push({
      level: "warning",
      title: `gtid_mode is ${observed.gtidMode ?? "unknown"}, not ON`,
      detail: "Without GTID, promotion requires exact binlog file/position bookkeeping — error-prone during an incident.",
      remediation: "Enable GTID (gtid_mode=ON, enforce_gtid_consistency=ON) in a maintenance window, or accept a documented manual-coordinate failover.",
    });
  }
  if (engine === "mariadb") {
    verdicts.push({
      level: "ok",
      title: "MariaDB detected — its GTID scheme is not MySQL-compatible",
      detail: "MariaDB uses domain-server_id-sequence GTIDs. A MariaDB replica cannot follow a MySQL primary and vice versa.",
      remediation: "Keep the primary and every replica in the same family and at compatible versions.",
    });
  }
  if (observed.bufferPoolBytes) {
    const gb = observed.bufferPoolBytes / 1024 ** 3;
    verdicts.push({
      level: gb < 1 ? "warning" : "ok",
      title: `innodb_buffer_pool_size is ${gb.toFixed(2)} GB`,
      detail:
        gb < 1
          ? "On a 4 GB host that also runs Node.js, a small buffer pool means most reads hit disk. Query latency grows with data size well before CPU saturates."
          : "Reasonable for this host size.",
      remediation: gb < 1 ? "Set innodb_buffer_pool_size to roughly 25–40% of RAM (≈1–1.5 GB on a 4 GB host) and re-measure." : undefined,
    });
  }
  return { ...observed, verdicts };
}

// ── 3. PostgreSQL (only if it is actually here) ─────────────────────────────

async function auditPostgres() {
  const client = (await tryRun("which", ["psql"])).ok ? "psql" : null;
  if (!client) return null;
  const version = await tryRun(client, ["-tAc", "SELECT version();"]);
  if (!version.ok) return null;
  const wal = await tryRun(client, ["-tAc", "SHOW wal_level;"]);
  return {
    host: hostLabel,
    engine: "postgresql",
    version: version.stdout.trim().split("\n")[0],
    clientAvailable: true,
    walLevel: wal.ok ? wal.stdout.trim() : null,
    verdicts: [
      {
        level: wal.ok && ["replica", "logical"].includes(wal.stdout.trim()) ? "ok" : "warning",
        title: `wal_level = ${wal.ok ? wal.stdout.trim() : "unknown"}`,
        detail: "Streaming replication needs wal_level=replica (or logical) plus a replication role and slot.",
        remediation: "Confirm with SELECT * FROM pg_replication_slots; before building a replica.",
      },
    ],
  };
}

// ── 4. Host capacity ────────────────────────────────────────────────────────

async function auditCapacity() {
  const totalRamMb = os.totalmem() / 1024 ** 2;
  const freeRamMb = os.freemem() / 1024 ** 2;
  const ramUsedPercent = ((totalRamMb - freeRamMb) / totalRamMb) * 100;
  const load = os.loadavg();
  const cpuCores = os.cpus().length;

  let disk = { totalGb: null, usedGb: null, usedPercent: null };
  const df = await tryRun("df", ["-PB1", "/"]);
  if (df.ok) {
    const parts = df.stdout.trim().split("\n")[1]?.split(/\s+/) ?? [];
    if (parts.length >= 5) {
      disk = {
        totalGb: Number(parts[1]) / 1024 ** 3,
        usedGb: Number(parts[2]) / 1024 ** 3,
        usedPercent: (Number(parts[2]) / Number(parts[1])) * 100,
      };
    }
  }

  // CPU utilisation needs two /proc/stat samples; without them we report the
  // load average instead of inventing a percentage.
  let cpuUsedPercent = null;
  const sample = async () => {
    try {
      const line = readFileSync("/proc/stat", "utf8").split("\n")[0];
      const n = line.split(/\s+/).slice(1).map(Number);
      return { idle: n[3] + (n[4] || 0), total: n.reduce((a, b) => a + b, 0) };
    } catch {
      return null;
    }
  };
  const a = await sample();
  await new Promise((r) => setTimeout(r, 500));
  const b = await sample();
  if (a && b && b.total > a.total) cpuUsedPercent = ((b.total - a.total - (b.idle - a.idle)) / (b.total - a.total)) * 100;

  const pm2 = await tryRun("pm2", ["jlist"], 20_000);
  const services = [];
  if (pm2.ok) {
    try {
      for (const p of JSON.parse(pm2.stdout)) {
        services.push({
          name: p.name,
          state: p.pm2_env?.status ?? "unknown",
          restarts: p.pm2_env?.restart_time ?? null,
          memoryMb: p.monit?.memory ? Math.round(p.monit.memory / 1024 ** 2) : null,
          cpuPercent: p.monit?.cpu ?? null,
        });
      }
    } catch {
      /* leave services empty rather than guessing */
    }
  }

  const verdicts = [];
  if (ramUsedPercent >= 85) {
    verdicts.push({
      level: "blocked",
      title: `Memory usage is ${ramUsedPercent.toFixed(0)}%`,
      detail: "Above ~85% the host swaps or the OOM killer picks a victim — frequently the database.",
      remediation: `Upgrade this host (next tier ≈ ${Math.max(8, Math.round((totalRamMb / 1024) * 2))} GB) or move the database off it.`,
    });
  } else if (ramUsedPercent >= 70) {
    verdicts.push({
      level: "warning",
      title: `Memory usage is ${ramUsedPercent.toFixed(0)}%`,
      detail: "Headroom exists but not enough for a traffic spike plus a build on the same host.",
      remediation: "Keep CI/build work off this host and re-measure at peak.",
    });
  }
  if (cpuUsedPercent != null && cpuUsedPercent >= 80) {
    verdicts.push({
      level: "warning",
      title: `CPU usage is ${cpuUsedPercent.toFixed(0)}%`,
      detail: `Sustained across ${cpuCores} core(s); little room left for builds, backups or growth.`,
      remediation: "Move builds and backups elsewhere, then re-measure.",
    });
  }
  if (load[0] > cpuCores) {
    verdicts.push({
      level: "warning",
      title: `1-minute load average ${load[0].toFixed(2)} exceeds ${cpuCores} core(s)`,
      detail: "The run queue is longer than the CPU count, so requests wait before they are served.",
      remediation: "Identify the top consumer (`ps -eo pcpu,comm --sort=-pcpu | head`) and decide whether it belongs on this host.",
    });
  }
  if (disk.usedPercent != null && disk.usedPercent >= 80) {
    verdicts.push({
      level: "warning",
      title: `Disk usage is ${disk.usedPercent.toFixed(0)}%`,
      detail: "Databases slow sharply as a filesystem fills, and a backup needs free space equal to the data size.",
      remediation: "Prune old releases, rotate backups offsite, expand storage before 90%.",
    });
  }
  if (!services.length) {
    verdicts.push({
      level: "warning",
      title: "No PM2-managed processes were reported",
      detail: "Either PM2 is not installed, the panel runs under systemd instead, or this is not the application host.",
      remediation: "Confirm the service manager with `systemctl status alo-hosting-panel` or `pm2 ls`.",
    });
  }

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpuCores,
    ramTotalMb: Math.round(totalRamMb),
    ramUsedPercent: Number(ramUsedPercent.toFixed(1)),
    cpuUsedPercent: cpuUsedPercent == null ? null : Number(cpuUsedPercent.toFixed(1)),
    loadAvg: load.map((n) => Number(n.toFixed(2))),
    disk,
    nodeVersion: process.version,
    services,
    verdicts,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const panel = auditPanelDatabase();
  const mysql = await auditMysql();
  const postgres = await auditPostgres();
  const capacity = await auditCapacity();

  const report = {
    generatedAt: new Date().toISOString(),
    host: hostLabel,
    panelDatabase: panel,
    serviceDatabase: mysql.clientAvailable || mysql.engine !== "unknown" ? mysql : postgres ?? mysql,
    postgres: postgres && mysql.engine === "unknown" ? postgres : null,
    capacity,
    verdicts: [...panel.verdicts, ...mysql.verdicts, ...(postgres?.verdicts ?? []), ...capacity.verdicts],
  };

  if (write) {
    await record(report).catch((error) => {
      console.error("could not record the audit in the panel database:", redact(error.message ?? error));
    });
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    print(report);
  }
  const blocked = report.verdicts.filter((v) => v.level === "blocked").length;
  process.exitCode = blocked ? 1 : 0;
}

async function record(report) {
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${path.join(repoRoot, "db", "custom.db")}`;
  const { db } = await import("../src/lib/db.ts");
  const dbInfo = report.serviceDatabase ?? {};
  await db.replicationStatus.upsert({
    where: { host: report.host },
    create: {
      host: report.host,
      engine: dbInfo.engine ?? "unknown",
      version: dbInfo.version ?? null,
      role: dbInfo.role ?? "UNKNOWN",
      binlogEnabled: dbInfo.binlogEnabled ?? null,
      gtidMode: dbInfo.gtidMode ?? null,
      lagSeconds: dbInfo.lagSeconds ?? null,
      lastCheckedAt: new Date(),
      healthy: report.verdicts.every((v) => v.level !== "blocked"),
      detail: JSON.stringify({ capacity: report.capacity, panelDatabase: report.panelDatabase }).slice(0, 100_000),
    },
    update: {
      engine: dbInfo.engine ?? "unknown",
      version: dbInfo.version ?? null,
      role: dbInfo.role ?? "UNKNOWN",
      binlogEnabled: dbInfo.binlogEnabled ?? null,
      gtidMode: dbInfo.gtidMode ?? null,
      lagSeconds: dbInfo.lagSeconds ?? null,
      lastCheckedAt: new Date(),
      healthy: report.verdicts.every((v) => v.level !== "blocked"),
      detail: JSON.stringify({ capacity: report.capacity, panelDatabase: report.panelDatabase }).slice(0, 100_000),
    },
  });
  await db.$disconnect();
  console.log(`recorded replication_status for host "${report.host}"`);
}

function print(report) {
  const badge = { ok: "PASS", warning: "WARN", blocked: "FAIL" };
  console.log(`\n═══ ALO database & capacity audit — ${report.host} ═══`);
  console.log(`generated ${report.generatedAt}\n`);

  console.log(`Panel database (Prisma)`);
  console.log(`  provider in schema : ${report.panelDatabase.provider ?? "unknown"}`);
  console.log(`  DATABASE_URL       : scheme=${report.panelDatabase.url.scheme}, credentials=${report.panelDatabase.url.hasCredentials ? "present (hidden)" : "none"}, shape=${report.panelDatabase.url.hostShape}`);

  const svc = report.serviceDatabase ?? {};
  console.log(`\nService database`);
  console.log(`  engine / version   : ${svc.engine ?? "unknown"} ${svc.version ?? ""}`.trim());
  console.log(`  client available   : ${svc.clientAvailable ?? false}`);
  console.log(`  role               : ${svc.role ?? "unknown"}`);
  console.log(`  log_bin            : ${svc.binlogEnabled === undefined ? "not observed" : svc.binlogEnabled ? "ON" : "OFF"}`);
  console.log(`  binlog_format      : ${svc.binlogFormat ?? "not observed"}`);
  console.log(`  gtid_mode          : ${svc.gtidMode ?? "not observed"}`);
  console.log(`  server_id          : ${svc.serverId ?? "not observed"}`);
  console.log(`  replica lag (s)    : ${svc.lagSeconds ?? "n/a"}`);

  const c = report.capacity;
  console.log(`\nHost capacity`);
  console.log(`  cpu cores          : ${c.cpuCores}`);
  console.log(`  ram                : ${Math.round(c.ramTotalMb / 1024 * 10) / 10} GB total, ${c.ramUsedPercent}% used`);
  console.log(`  cpu utilisation    : ${c.cpuUsedPercent === null ? "not measurable (/proc/stat unavailable)" : `${c.cpuUsedPercent}%`}`);
  console.log(`  load avg (1/5/15)  : ${c.loadAvg.join(" / ")}`);
  console.log(`  disk /             : ${c.disk.usedGb ? c.disk.usedGb.toFixed(1) : "?"} of ${c.disk.totalGb ? c.disk.totalGb.toFixed(1) : "?"} GB (${c.disk.usedPercent ? c.disk.usedPercent.toFixed(0) : "?"}%)`);
  console.log(`  node               : ${c.nodeVersion}`);
  console.log(`  pm2 processes      : ${c.services.length ? c.services.map((s) => `${s.name}=${s.state}`).join(", ") : "none reported"}`);

  console.log(`\nVerdicts (${report.verdicts.length})`);
  for (const v of report.verdicts) {
    console.log(`  [${badge[v.level]}] ${v.title}`);
    console.log(`         ${redact(v.detail)}`);
    if (v.remediation) console.log(`         → ${redact(v.remediation)}`);
  }
  const blocked = report.verdicts.filter((v) => v.level === "blocked").length;
  console.log(`\n${blocked ? `${blocked} blocking finding(s) — do not schedule replication or failover yet.` : "No blocking findings."}`);
}

void main();
