#!/usr/bin/env node
'use strict';

/**
 * ALO Hosting Portal — Safe Environment Variable Scanner & Bootstrapper
 *
 * Scans canonical `src/` for `process.env.*` references and populates missing
 * required secrets using CSPRNG (`crypto.randomBytes`) without embedding any
 * hardcoded credentials or printing secret values to stdout.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = process.env.ALO_PROJECT_DIR
  ? path.resolve(process.env.ALO_PROJECT_DIR)
  : path.resolve(__dirname, '..', '..');

const ENV_PATH = process.env.ALO_ENV_PATH
  ? path.resolve(process.env.ALO_ENV_PATH)
  : path.join(REPO_ROOT, '.env');

const SECRETS_PATH = '/etc/alo/secrets.env';

function scanDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules' && file !== '.next') {
        scanDir(filePath, fileList);
      }
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function parseEnvFile(filePath, target) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (target[k] === undefined || target[k] === '') {
      target[k] = v;
    }
  }
}

const sourceFiles = scanDir(path.join(REPO_ROOT, 'src'));
const envVars = new Set([
  'NODE_ENV',
  'PORT',
  'HOSTNAME',
  'APP_URL',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'JWT_SECRET',
  'APP_ENCRYPTION_KEY',
  'INTERNAL_SECRET',
  'CRON_SECRET',
  'SSL_STATUS_HOOK_TOKEN',
  'DATABASE_URL',
  'AI_GATEWAY_URL',
  'AI_GATEWAY_KEY',
  'AI_MODEL',
  'LITELLM_URL',
  'LITELLM_MASTER_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_FROM',
]);

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    envVars.add(match[1]);
  }
}

const existingEnv = {};
parseEnvFile(ENV_PATH, existingEnv);
try {
  parseEnvFile(SECRETS_PATH, existingEnv);
} catch {
  // Optional root-owned secrets file may not be readable by unprivileged users.
}

function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function getSafeValue(key) {
  if (existingEnv[key] !== undefined && existingEnv[key] !== '') {
    return existingEnv[key];
  }
  switch (key) {
    case 'NODE_ENV':
      return 'production';
    case 'PORT':
      return '3051';
    case 'HOSTNAME':
      return '127.0.0.1';
    case 'APP_URL':
    case 'NEXTAUTH_URL':
      return 'https://hosting.alolabs.net';
    case 'DATABASE_URL':
      return 'file:/var/lib/alo-hosting/production.db';
    case 'NEXTAUTH_SECRET':
    case 'JWT_SECRET':
    case 'APP_ENCRYPTION_KEY':
    case 'INTERNAL_SECRET':
    case 'CRON_SECRET':
    case 'SSL_STATUS_HOOK_TOKEN':
    case 'WEBUI_SECRET_KEY':
      return randomHex(32);
    case 'LITELLM_MASTER_KEY':
      return `sk-alo-${randomHex(24)}`;
    case 'AI_GATEWAY_URL':
      return 'http://127.0.0.1:4000/v1';
    case 'LITELLM_URL':
      return 'http://127.0.0.1:4000';
    case 'AI_MODEL':
      return 'gpt-4o-mini';
    case 'SMTP_PORT':
      return '587';
    case 'SMTP_FROM':
      return 'noreply@alolabs.net';
    default:
      return '';
  }
}

const sortedKeys = Array.from(envVars).sort();
const finalEnv = {};
for (const k of sortedKeys) {
  finalEnv[k] = getSafeValue(k);
}

let envContent = [
  '# ==============================================================================',
  '# ALO HOSTING PORTAL — GENERATED ENVIRONMENT CONFIGURATION',
  `# Generated on: ${new Date().toISOString()}`,
  '# Permissions: 0600 (owner read/write only; never commit this file)',
  '# ==============================================================================',
  '',
].join('\n');

for (const k of sortedKeys) {
  const escaped = String(finalEnv[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  envContent += `${k}="${escaped}"\n`;
}

fs.writeFileSync(ENV_PATH, envContent, { mode: 0o600 });
try {
  fs.chmodSync(ENV_PATH, 0o600);
} catch {
  // Ignore chmod errors on non-POSIX filesystems.
}

console.log(`Discovered ${sortedKeys.length} environment variables across canonical src/.`);
console.log(`Updated ${ENV_PATH} (mode 0600; all secret values redacted):`);
for (const k of sortedKeys) {
  const status = finalEnv[k] ? 'CONFIGURED [REDACTED]' : 'OPTIONAL / UNSET';
  console.log(`  - ${k.padEnd(36)} : ${status}`);
}
