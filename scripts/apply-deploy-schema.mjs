#!/usr/bin/env node
/**
 * Idempotent, additive schema applier for the Git-connected deployment layer.
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
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@libsql/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = path.join(here, "..", "prisma", "migrations", "20261026130000_github_autodeploy", "migration.sql");
const checkOnly = process.argv.includes("--check");

const url = process.env.DATABASE_URL || "file:./db/custom.db";
if (!url.startsWith("file:") && !url.startsWith("libsql://")) {
  console.error("DATABASE_URL must be a file: or libsql:// URL for this migration.");
  process.exit(2);
}

const client = createClient({ url });
const sql = readFileSync(migration, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const alterRe = /^ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+COLUMN\s+"([^"]+)"/i;

async function columns(table) {
  const res = await client.execute(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
  return new Set(res.rows.map((r) => String(r.name)));
}

let created = 0;
let skipped = 0;
const applied = [];

try {
  for (const statement of statements) {
    const match = statement.match(alterRe);
    let shouldRun = true;
    let label = statement.split("\n")[0].slice(0, 90);

    if (match) {
      const [, table, column] = match;
      const existing = await columns(table);
      if (existing.has(column)) {
        shouldRun = false;
        label = `ALTER ${table}.${column}`;
      }
    } else if (/^CREATE\s+TABLE/i.test(statement) && !/IF NOT EXISTS/i.test(statement)) {
      // All our CREATE TABLE statements use IF NOT EXISTS; guard anyway.
      shouldRun = true;
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

  // Post-condition: prove the tables/columns the deployment & health layers need exist.
  const required = {
    git_connections: ["id", "accountLogin", "tokenEncrypted"],
    git_projects: ["id", "websiteId", "repository", "config", "port"],
    webhook_deliveries: ["id", "deliveryId", "signatureValid", "result"],
    deployments: ["id", "stage", "verifiedCommitSha", "configSnapshot"],
    hosting_sites: ["id", "domainName", "sslStatus", "vhostPath", "serverId"],
    servers: ["id", "hostname", "ipAddress", "cpuUsage", "memoryUsage", "diskUsage"],
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
