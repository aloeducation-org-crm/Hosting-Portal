'use strict';
/**
 * PM2 process definition for the ALO Hosting Portal.
 *
 * Phase 1 delivery. PM2 7.x silently ignores `env_file`, so this file reads
 * `.env.config` itself with `fs.readFileSync()` and merges the parsed values
 * into the process environment before the Next.js standalone server starts.
 *
 * For rollout and database approval gates see docs/PM2-PRODUCTION-RUNBOOK.md.
 *
 * Overrides (set in the shell that runs pm2):
 *   PANEL_ENV_FILE   - path to the env file (default: ./.env.config)
 *   PANEL_APP_DIR    - project directory (default: this file's directory)
 *   PANEL_PORT       - listen port (default: 3062; override for isolated staging)
 */
const fs = require('node:fs');
const path = require('node:path');

const envFile = process.env.PANEL_ENV_FILE || path.resolve(__dirname, '.env.config');
const appDir = process.env.PANEL_APP_DIR || __dirname;
const standaloneDir = path.join(appDir, '.next', 'standalone');

/**
 * Parse a dotenv-style file. Values are taken verbatim (no $VAR expansion —
 * Next.js corrupts `$` in .env files, which is why this file is named
 * `.env.config` rather than `.env`). Quoted values are unquoted.
 */
function readEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) {
    console.warn(`[ecosystem] Env file not found at ${filePath}; using process environment only.`);
    return result;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const fileEnv = readEnvFile(envFile);
const port = String(process.env.PANEL_PORT || 3062);

// PORT / HOSTNAME are applied last on purpose so the server always listens
// where nginx is configured to proxy (127.0.0.1:<PORT>).
const panelEnv = Object.assign(
  { NODE_ENV: 'production' },
  fileEnv,
  { PORT: port, HOSTNAME: '127.0.0.1' },
);

module.exports = {
  apps: [
    {
      name: 'alo-hosting-panel',
      cwd: standaloneDir,
      script: path.join(standaloneDir, 'server.js'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      time: true,
      env: panelEnv,
    },
  ],
};
