'use strict';
/**
 * PM2 profile for the panel on alo-server-lap (103.231.239.79).
 *
 *   su - alamin -c "cd /home/alamin/Hosting-Portal && pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env && pm2 save"
 *
 * Run PM2 as `alamin`, never as root. See docs/PM2-PRODUCTION-RUNBOOK.md.
 *
 * Why this file reads panel.env itself: PM2 7.x silently ignores `env_file`.
 *
 * Precedence, lowest to highest:
 *   1. NODE_ENV=production
 *   2. everything in /etc/alo-hosting/panel.env
 *   3. PORT and HOSTNAME from this file
 * PORT and HOSTNAME are applied last on purpose. nginx proxies to
 * 127.0.0.1:3000; the repository's env templates carry PORT=3051, and if that
 * value won the panel would listen where nginx is not looking (HTTP 502).
 *
 * Overrides (set in the shell that runs pm2): PANEL_ENV_FILE, PANEL_APP_DIR,
 * PANEL_PORT.
 */
const fs = require('node:fs');
const path = require('node:path');
const { readPanelEnv } = require('./panel-env.cjs');

const envFile = process.env.PANEL_ENV_FILE || '/etc/alo-hosting/panel.env';
const appDir = process.env.PANEL_APP_DIR || path.resolve(__dirname, '..', '..');
const port = process.env.PANEL_PORT || '3000';
const standalone = path.join(appDir, '.next', 'standalone');

const panelEnv = readPanelEnv(envFile);
const base = Object.assign({ NODE_ENV: 'production' }, panelEnv);

// The two durable workers are bundled by `npm run build:worker`. When their
// bundles exist they run as their own PM2 processes and the panel's in-process
// deploy worker is switched off, so a deployment is never processed twice.
// When the bundles are missing the panel keeps whatever panel.env says.
const workers = [
  { name: 'alo-deploy-worker', file: 'deploy-worker.cjs' },
  { name: 'alo-automation-worker', file: 'automation-worker.cjs' },
].filter((worker) => fs.existsSync(path.join(standalone, worker.file)));
const hasDeployWorker = workers.some((worker) => worker.name === 'alo-deploy-worker');

const common = {
  cwd: standalone,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  time: true,
};

module.exports = {
  apps: [
    Object.assign({}, common, {
      name: 'alo-hosting-panel',
      script: path.join(standalone, 'server.js'),
      max_memory_restart: '1G',
      env: Object.assign(
        {},
        base,
        hasDeployWorker ? { DEPLOY_INLINE_WORKER: 'false' } : {},
        { PORT: String(port), HOSTNAME: '127.0.0.1' },
      ),
    }),
    ...workers.map((worker) =>
      Object.assign({}, common, {
        name: worker.name,
        script: path.join(standalone, worker.file),
        max_memory_restart: '512M',
        env: Object.assign({}, base, { DEPLOY_INLINE_WORKER: 'false' }),
      }),
    ),
  ],
};
