#!/usr/bin/env node
/**
 * Backup freshness and integrity monitor — the alerting half of the backup system.
 *
 * Reads the status file written by scripts/encrypted-backup.mjs and, optionally,
 * re-verifies the newest archive's <file>.sha256 sidecar. Raises an alert when:
 *   - no status file exists or it is unreadable      (no verified backup on record)
 *   - the last failure is newer than the last success (a failed run supersedes success)
 *   - the last success is older than --max-age-hours (default 26h — covers one missed daily)
 *   - the newest archive's sidecar checksum does not match (transport corruption)
 *   - the newest archive is missing its .sha256 sidecar (unverifiable transport)
 *   - sizeBytes is zero / verification did not pass  (archive not trustworthy)
 *   - no successful RESTORE TEST within --restore-test-max-days (default 31d)
 *     when --restore-test-log is set                       (M8, when configured)
 *
 * Exit codes: 0 healthy, 1 alert raised, 2 usage/configuration error.
 *
 * Actions on alert (all optional, all additive):
 *   --notify-db file:/path/to/panel.db   Insert one in-app Notification per active
 *                                        SUPER_ADMIN user (type "backup-alert").
 *                                        Deterministic id => re-runs do not spam.
 *   --webhook <https url>                POST the alert JSON to a generic webhook
 *                                        (or $ALO_BACKUP_ALERT_WEBHOOK if set).
 *   (always)                             Print the JSON report to stdout.
 *
 * Restore-test log: append one JSON line per drill, e.g.
 *   echo "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ok\":true,\"archive\":\"<file>\",\"durationMs\":1234}" \
 *     >> /var/backups/alo/restore-drills.jsonl
 * With --restore-test-log set, the monitor alerts when the log is missing or
 * the newest ok entry is older than --restore-test-max-days (default 31).
 *
 * Typical wiring (see deploy/systemd/alo-backup-monitor.* and docs/operations/
 * DISASTER-RECOVERY.md §7): run after the nightly backup and hourly from a timer.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function parseArgs(argv) {
  const a = {
    status: process.env.ALO_BACKUP_STATUS || (process.env.ALO_BACKUP_DIR ? path.join(process.env.ALO_BACKUP_DIR, "backup-status.json") : path.resolve(process.cwd(), "backups/backup-status.json")),
    maxAgeHours: Number(process.env.ALO_BACKUP_MAX_AGE_HOURS ?? 26) || 26,
    verifyArchive: true,
    notifyDb: process.env.ALO_BACKUP_NOTIFY_DB || "",
    webhook: process.env.ALO_BACKUP_ALERT_WEBHOOK || "",
    restoreTestLog: process.env.ALO_BACKUP_RESTORE_TEST_LOG || "",
    restoreTestMaxDays: Number(process.env.ALO_BACKUP_RESTORE_TEST_MAX_DAYS ?? 31) || 31,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--status") a.status = next();
    else if (arg.startsWith("--status=")) a.status = arg.slice(9);
    else if (arg === "--max-age-hours") a.maxAgeHours = Number(next());
    else if (arg.startsWith("--max-age-hours=")) a.maxAgeHours = Number(arg.slice(16));
    else if (arg === "--no-verify-archive") a.verifyArchive = false;
    else if (arg === "--notify-db") a.notifyDb = next();
    else if (arg === "--webhook") a.webhook = next();
    else if (arg === "--restore-test-log") a.restoreTestLog = next();
    else if (arg.startsWith("--restore-test-log=")) a.restoreTestLog = arg.slice(18);
    else if (arg === "--restore-test-max-days") a.restoreTestMaxDays = Number(next());
    else if (arg.startsWith("--restore-test-max-days=")) a.restoreTestMaxDays = Number(arg.slice(24));
    else if (arg === "--json") a.json = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("usage: backup-monitor.mjs [--status FILE] [--max-age-hours N] [--no-verify-archive] [--notify-db URL] [--webhook URL] [--restore-test-log FILE] [--restore-test-max-days N] [--json]\n");
      process.exit(0);
    } else {
      process.stderr.write(`backup-monitor: unknown argument '${arg}'\n`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(a.maxAgeHours) || a.maxAgeHours <= 0) {
    process.stderr.write("backup-monitor: --max-age-hours must be a positive number\n");
    process.exit(2);
  }
  if (!Number.isFinite(a.restoreTestMaxDays) || a.restoreTestMaxDays <= 0) {
    process.stderr.write("backup-monitor: --restore-test-max-days must be a positive number\n");
    process.exit(2);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const alerts = [];
const warnings = [];
const observations = {};

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

const status = safeReadJson(args.status);
if (!status) {
  alerts.push(`no readable backup status at ${args.status} (no verified backup on record)`);
} else {
  observations.updatedAt = status.updatedAt ?? null;
  const successAt = status.lastSuccess?.at ? Date.parse(status.lastSuccess.at) : NaN;
  const failureAt = status.lastFailure?.at ? Date.parse(status.lastFailure.at) : NaN;

  if (!status.lastSuccess) {
    alerts.push("no successful backup has ever been recorded");
  } else {
    observations.lastSuccess = { file: status.lastSuccess.file, at: status.lastSuccess.at, sizeBytes: status.lastSuccess.sizeBytes ?? null };
    const ageHours = (Date.now() - successAt) / 3600_000;
    observations.lastSuccess.ageHours = Number(ageHours.toFixed(2));
    if (!Number.isFinite(successAt)) alerts.push("lastSuccess.at is unparseable");
    else if (ageHours > args.maxAgeHours) alerts.push(`last successful backup is ${ageHours.toFixed(1)}h old (threshold ${args.maxAgeHours}h)`);
    if (!status.lastSuccess.sizeBytes || status.lastSuccess.sizeBytes <= 0) alerts.push("last successful backup reports a zero-byte archive");
    if (status.lastSuccess.offsite && status.lastSuccess.offsite.verified !== true) warnings.push("last offsite copy was not verified");
    if (!status.lastSuccess.offsite) warnings.push("no offsite copy configured or recorded (REL-05 remains open)");
  }

  if (Number.isFinite(failureAt) && (!Number.isFinite(successAt) || failureAt > successAt)) {
    alerts.push(`last backup run FAILED${status.lastFailure?.error ? `: ${String(status.lastFailure.error).slice(0, 200)}` : ""}`);
  }

  // Transport integrity of the newest local archive.
  const backupDir = path.dirname(args.status);
  if (status.lastSuccess?.file) {
    const archive = path.join(backupDir, status.lastSuccess.file);
    const sidecar = `${archive}.sha256`;
    observations.archive = archive;
    if (!args.verifyArchive) {
      observations.archiveVerification = "skipped (--no-verify-archive)";
    } else if (!fs.existsSync(archive)) {
      warnings.push(`local archive ${status.lastSuccess.file} is missing from ${backupDir} (kept offsite only? verify there)`);
    } else if (!fs.existsSync(sidecar)) {
      alerts.push(`archive ${status.lastSuccess.file} has no .sha256 sidecar — transport integrity cannot be verified`);
    } else {
      const expected = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      const actual = await (async () => {
        const { createHash: ch } = await import("node:crypto");
        return new Promise((resolve, reject) => {
          const hash = ch("sha256");
          const stream = fs.createReadStream(archive);
          stream.on("data", (chunk) => hash.update(chunk));
          stream.on("end", () => resolve(hash.digest("hex")));
          stream.on("error", reject);
        });
      })();
      if (expected !== actual) alerts.push(`archive ${status.lastSuccess.file} failed sha256 re-verification (sidecar ${expected.slice(0, 12)}… != actual ${actual.slice(0, 12)}…)`);
      else observations.archiveVerification = "sha256-ok";
    }
  }
}


// M8: restore-drill history. A backup that is never restored is not a backup; alert when no drill is recorded.
if (args.restoreTestLog) {
  observations.restoreTest = { log: args.restoreTestLog, maxAgeDays: args.restoreTestMaxDays };
  const raw = (() => { try { return fs.readFileSync(args.restoreTestLog, "utf8"); } catch { return null; } })();
  if (raw === null) {
    alerts.push(`no restore-test log at ${args.restoreTestLog} (no successful restore drill on record)`);
  } else {
    let latestOk = NaN;
    let total = 0;
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const entry = JSON.parse(t);
        total += 1;
        const ok = entry.ok === true || entry.result === "ok" || entry.verified === true;
        if (ok) {
          const at = Date.parse(entry.at ?? "");
          if (Number.isFinite(at) && (!Number.isFinite(latestOk) || at > latestOk)) latestOk = at;
        }
      } catch { /* tolerate non-JSON noise lines */ }
    }
    observations.restoreTest.entries = total;
    if (!Number.isFinite(latestOk)) {
      alerts.push("restore-test log exists but records no successful restore drill");
    } else {
      const ageDays = (Date.now() - latestOk) / 86_400_000;
      observations.restoreTest.lastOkAt = new Date(latestOk).toISOString();
      observations.restoreTest.ageDays = Number(ageDays.toFixed(2));
      if (ageDays > args.restoreTestMaxDays) {
        alerts.push(`last successful restore drill was ${ageDays.toFixed(1)} days ago (threshold ${args.restoreTestMaxDays} days)`);
      }
    }
  }
}

const healthy = alerts.length === 0;
const report = {
  checkedAt: new Date().toISOString(),
  statusFile: args.status,
  healthy,
  alerts,
  warnings,
  observations,
};

async function notifyDatabase(dbUrl) {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: dbUrl });
  try {
    const rows = await client.execute(
      "SELECT u.id FROM users u JOIN roles r ON r.id = u.roleId WHERE r.name = 'SUPER_ADMIN' AND u.isActive = 1",
    );
    const alertId = `backup-alert-${sha256([...alerts, status?.updatedAt ?? ""].join("|")).slice(0, 32)}`;
    const message = alerts.join(" | ").slice(0, 1000);
    let inserted = 0;
    for (const row of rows.rows) {
      const userId = String(row.id ?? "");
      if (!userId) continue;
      await client.execute({
        sql: "INSERT OR IGNORE INTO notifications (id, userId, title, message, type, read, createdAt) VALUES (?, ?, ?, ?, 'backup-alert', 0, CURRENT_TIMESTAMP)",
        args: [`${alertId}-${userId.slice(0, 8)}`, userId, "Backup alert", message],
      });
      inserted += 1;
    }
    return { superAdminsNotified: inserted, alertId };
  } finally {
    await client.close();
  }
}

if (!healthy) {
  if (args.notifyDb) {
    try {
      report.notification = await notifyDatabase(args.notifyDb);
    } catch (error) {
      report.notification = { error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
    }
  }
  if (args.webhook) {
    try {
      const res = await fetch(args.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(10_000),
      });
      report.webhook = { status: res.status };
    } catch (error) {
      report.webhook = { error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
    }
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(healthy ? 0 : 1);
