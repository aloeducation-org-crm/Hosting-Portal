#!/usr/bin/env node
/**
 * Idempotent, additive schema applier for the Git-connected deployment layer
 * and the unified orchestrator / server-agent layer.
 *
 * Why this exists instead of `prisma migrate deploy`:
 *   - this application ships `engineType = "client"` and the Prisma
 *     schema-engine binary cannot be downloaded on an offline/egress-filtered
 *     server (binaries.prisma.sh is unreachable);
 *   - existing installs have no `_prisma_migrations` table, so `migrate deploy`
 *     would try to replay the unrelated 0_init migration on top of live data.
 *
 * The script only CREATEs missing tables/indexes and ADDs missing NULLable (or
 * safely defaulted) columns. It never drops, deletes, truncates or rewrites a
 * row. Running it twice is a no-op. It prints no environment values.
 *
 * Usage:
 *   DATABASE_URL="file:/var/lib/alo-hosting/alo.db" node scripts/apply-deploy-schema.mjs
 *   node scripts/apply-deploy-schema.mjs --check
 *   node scripts/apply-deploy-schema.mjs --migration 20261027090000_unified_orchestrator_agents
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@libsql/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "prisma", "migrations");
const checkOnly = process.argv.includes("--check");

/** Additive migrations, applied in this order. Baselines are deliberately absent. */
const DEFAULT_MIGRATIONS = [
  "20261026130000_github_autodeploy",
  "20261027090000_unified_orchestrator_agents",
  "20261027093000_operation_jobs_platform_scope",
];

function selectedMigrations() {
  const flagIndex = process.argv.indexOf("--migration");
  if (flagIndex !== -1) {
    const wanted = process.argv[flagIndex + 1];
    if (!wanted) {
      console.error("--migration needs a migration directory name");
      process.exit(2);
    }
    return [wanted];
  }
  // Only apply migrations that actually exist on disk, so a partial checkout
  // never fails the whole run.
  return DEFAULT_MIGRATIONS.filter((name) =>
    existsSync(path.join(migrationsDir, name, "migration.sql")),
  );
}

const url = process.env.DATABASE_URL || "file:./db/custom.db";
if (!url.startsWith("file:") && !url.startsWith("libsql://")) {
  console.error("DATABASE_URL must be a file: or libsql:// URL for this migration.");
  process.exit(2);
}

const client = createClient({ url });

/**
 * Post-conditions for migrations that rebuild a table. The generic statement
 * loop cannot make these idempotent (it only knows how to skip a duplicate
 * ADD COLUMN), so each one is checked as a whole before any statement runs.
 */
const REBUILD_MIGRATION_DONE = {
  // operation_jobs.websiteId became NULLable to allow platform-wide jobs.
  "20261027093000_operation_jobs_platform_scope": async () => {
    try {
      const res = await client.execute('PRAGMA table_info("operation_jobs")');
      const col = res.rows.find((r) => String(r.name) === "websiteId");
      return Boolean(col) && Number(col.notnull) === 0;
    } catch {
      return false;
    }
  },
};

const alterRe = /^ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+COLUMN\s+"([^"]+)"/i;

async function columns(table) {
  const res = await client.execute(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
  return new Set(res.rows.map((r) => String(r.name)));
}

function parseStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

let created = 0;
let skipped = 0;
const applied = [];

try {
  const migrations = selectedMigrations();
  if (migrations.length === 0) {
    console.error(`No additive migrations found in ${migrationsDir}`);
    process.exit(2);
  }

  for (const migration of migrations) {
    const file = path.join(migrationsDir, migration, "migration.sql");
    if (!existsSync(file)) {
      console.error(`Migration not found: ${migration}`);
      process.exitCode = 1;
      continue;
    }

    // Rebuild migrations are all-or-nothing and must never be replayed. Each one
    // declares a post-condition; if it already holds, the whole file is skipped.
    const alreadyDone = REBUILD_MIGRATION_DONE[migration];
    if (alreadyDone && (await alreadyDone())) {
      skipped++;
      applied.push(`${migration}: already applied (post-condition holds)`);
      continue;
    }

    for (const statement of parseStatements(readFileSync(file, "utf8"))) {
      const match = statement.match(alterRe);
      let shouldRun = true;
      let label = `${migration}: ${statement.split("\n")[0].slice(0, 90)}`;

      if (match) {
        const [, table, column] = match;
        const existing = await columns(table);
        if (existing.has(column)) {
          shouldRun = false;
          label = `${migration}: ALTER ${table}.${column}`;
        }
      }

      if (!shouldRun || checkOnly) {
        skipped++;
        if (checkOnly) console.log(`would skip/apply: ${label}`);
        continue;
      }

      await client.execute(statement);
      created++;
      applied.push(label);
    }
  }

  // Post-condition: prove the tables/columns the deployment, health,
  // orchestration and agent layers need actually exist.
  const required = {
    git_connections: ["id", "accountLogin", "tokenEncrypted"],
    git_projects: ["id", "websiteId", "repository", "config", "port"],
    webhook_deliveries: ["id", "deliveryId", "signatureValid", "result"],
    deployments: ["id", "stage", "verifiedCommitSha", "configSnapshot"],
    hosting_sites: ["id", "domainName", "sslStatus", "vhostPath", "serverId"],
    servers: ["id", "hostname", "ipAddress", "cpuUsage", "memoryUsage", "diskUsage"],
    operation_jobs: [
      "id", "status", "idempotencyKey", "correlationId", "workerKind", "riskLevel",
      "attempts", "maxAttempts", "availableAt", "leaseExpiresAt", "leasedBy",
      "lockKey", "requiresApproval", "deadLetteredAt",
    ],
    server_agents: ["id", "agentKey", "secretEnc", "status", "capabilities", "scopes", "lastHeartbeat"],
    agent_enrollment_tokens: ["id", "tokenHash", "expiresAt", "usedAt"],
    agent_tasks: ["id", "agentId", "command", "args", "status", "timeoutMs", "requiresApproval"],
    agent_metrics: ["id", "agentId", "cpuPercent", "memoryUsedMb", "recordedAt"],
    replication_status: ["id", "host", "engine", "role", "binlogEnabled", "gtidMode", "lagSeconds"],
  };
  const problems = [];
  for (const [table, cols] of Object.entries(required)) {
    const have = await columns(table);
    if (have.size === 0) {
      problems.push(`missing table ${table}`);
      continue;
    }
    for (const col of cols) if (!have.has(col)) problems.push(`missing column ${table}.${col}`);
  }

  if (problems.length) {
    console.error("Schema verification FAILED:", problems.join(", "));
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({
        ok: true,
        checkOnly,
        migrations,
        statementsApplied: created,
        statementsSkipped: skipped,
        applied,
        verified: Object.keys(required),
      }, null, 2),
    );
  }
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  client.close();
}
