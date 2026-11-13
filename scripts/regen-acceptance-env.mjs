#!/usr/bin/env node
/**
 * Regenerate the disposable acceptance-run .env from the canonical template.
 *
 * The acceptance environment lives for one sandbox session: node kit state
 * (/etc/alo-hosting), global tools (pm2) and the gitignored .env itself do not
 * survive a session boundary, and every secret-protected artifact (agent
 * enrollment, GitHub connection token, admin session) is recreated during the
 * run. Therefore this script keeps NO secrets: each invocation generates fresh
 * random secrets, and the acceptance database is expected to be re-initialized
 * alongside (copy db/custom.db + apply-deploy-schema.mjs).
 *
 * Usage:  node scripts/regen-acceptance-env.mjs [db-file]
 * Default db file: ./db/acceptance.db (absolute path is written into .env).
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = path.resolve(process.argv[2] || path.join(repoRoot, "db", "acceptance.db"));

const OVERRIDES = {
  PORT: "3051",
  HOSTNAME: "0.0.0.0", // standalone server bind; the preview proxy needs it
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3051",
  APP_URL: "http://127.0.0.1:3051",
  BASE_URL: "http://127.0.0.1:3051",
  NEXTAUTH_URL: "http://127.0.0.1:3051",
  CORS_ALLOWED_ORIGINS: "http://127.0.0.1:3051",
  DATABASE_URL: `file:${dbFile}`,
  ADMIN_CREDENTIAL_FILE: "/tmp/alo-acceptance-admin-creds",
  AUTOMATION_SERVICE_MANAGER: "none", // no systemd bus in the sandbox
  DEPLOY_PUBLIC_IP: "127.0.0.1",
  DEPLOY_DOMAIN_SUFFIX: "acceptance.alo.test",
  // Node kit edge listeners on high ports (80/443 need capabilities the
  // sandbox filesystem does not grant).
  DEPLOY_EDGE_HTTP_PORT: "8080",
  DEPLOY_EDGE_HTTPS_PORT: "8443",
  ALO_EDGE_HTTP_PORT: "8080",
  ALO_EDGE_HTTPS_PORT: "8443",
};

const RANDOM_SECRETS = ["NEXTAUTH_SECRET", "JWT_SECRET", "APP_ENCRYPTION_KEY", "INTERNAL_SECRET", "CSRF_SECRET", "CRON_SECRET"];

let out = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
for (const [key, value] of Object.entries(OVERRIDES)) {
  const re = new RegExp(`^(?:#\\s*)?${key}=.*$`, "m");
  if (!re.test(out)) throw new Error(`Template is missing ${key}`);
  out = out.replace(re, `${key}=${value.includes(" ") || value.includes('"') ? JSON.stringify(value) : value}`);
}
for (const varName of RANDOM_SECRETS) {
  out = out.replace(new RegExp(`^${varName}="[^"]*"$`, "m"), `${varName}="${randomBytes(32).toString("hex")}"`);
}

writeFileSync(path.join(repoRoot, ".env"), out);
console.log(`Acceptance .env written (database: ${dbFile}). Secrets are fresh; re-enroll agents and re-add the GitHub connection when re-running.`);
