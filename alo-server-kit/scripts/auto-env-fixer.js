const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROJECT_DIR = path.join(process.env.HOME, 'projects/Hosting-Portal/alo-hosting-portal');
const ENV_PATH = path.join(PROJECT_DIR, '.env');
const SECRETS_PATH = '/etc/alo/secrets.env';

console.log('🔍 1. Scanning codebase for all process.env references...');

function scanDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules' && file !== '.next') {
        scanDir(filePath, fileList);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

const sourceFiles = scanDir(path.join(PROJECT_DIR, 'src'));
const envVars = new Set();

sourceFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.matchAll(/process\.env\.([A-Z0-9_]+)/g);
  for (const match of matches) {
    envVars.add(match[1]);
  }
});

// Explicitly add core infrastructure env vars
[
  'NODE_ENV', 'PORT', 'HOST', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET',
  'DATABASE_URL', 'PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USER', 'PG_PASSWORD',
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_URL',
  'AI_GATEWAY_URL', 'AI_GATEWAY_KEY', 'AI_MODEL', 'LITELLM_URL', 'LITELLM_MASTER_KEY',
  'STORAGE_ROOT', 'UPLOADS_DIR', 'BACKUP_DIR', 'TEMP_DIR',
  'APP_ENCRYPTION_KEY', 'CRON_SECRET', 'WEBUI_SECRET_KEY',
  'CLOUDFLARE_TUNNEL_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'
].forEach(v => envVars.add(v));

console.log(`✅ Discovered ${envVars.size} unique environment variables in codebase.`);

// Read existing .env
const existingEnv = {};
if (fs.existsSync(ENV_PATH)) {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.substring(0, idx).trim();
      let v = trimmed.substring(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      existingEnv[k] = v;
    }
  });
}

// Read secrets.env if present
if (fs.existsSync(SECRETS_PATH)) {
  try {
    const lines = fs.readFileSync(SECRETS_PATH, 'utf8').split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const k = trimmed.substring(0, idx).trim();
        let v = trimmed.substring(idx + 1).trim();
        existingEnv[k] = existingEnv[k] || v;
      }
    });
  } catch (e) {}
}

// Smart defaults & generators
function getSmartValue(key) {
  if (existingEnv[key] !== undefined && existingEnv[key] !== '') return existingEnv[key];

  switch (key) {
    case 'NODE_ENV': return 'production';
    case 'PORT': return '3051';
    case 'HOST': return '127.0.0.1';
    case 'NEXTAUTH_URL': return 'https://hosting.alolabs.net';
    case 'NEXTAUTH_SECRET': return crypto.randomBytes(32).toString('base64');

    case 'DATABASE_URL': return 'postgresql://alamin_app:E0ZKNgyjGT9WxHWMIEbw4xPrJGWFs9T@localhost:5432/alo_hosting?schema=public';
    case 'PG_HOST': return 'localhost';
    case 'PG_PORT': return '5432';
    case 'PG_DATABASE': return 'alo_hosting';
    case 'PG_USER': return 'alamin_app';
    case 'PG_PASSWORD': return 'E0ZKNgyjGT9WxHWMIEbw4xPrJGWFs9T';

    case 'MYSQL_HOST': return 'localhost';
    case 'MYSQL_PORT': return '3306';
    case 'MYSQL_DATABASE': return 'alo_hosting';
    case 'MYSQL_USER': return 'alamin_app';
    case 'MYSQL_PASSWORD': return 'lNXNuVyqqycKXQfkKjopJzV7y2wU5h';
    case 'MYSQL_URL': return 'mysql://alamin_app:lNXNuVyqqycKXQfkKjopJzV7y2wU5h@localhost:3306/alo_hosting';

    case 'AI_GATEWAY_URL': return 'http://127.0.0.1:11434/v1';
    case 'AI_GATEWAY_KEY': return 'ollama';
    case 'AI_MODEL': return 'llama3.2:1b';
    case 'LITELLM_URL': return 'http://127.0.0.1:4000';
    case 'LITELLM_MASTER_KEY': return 'sk-alo-008960c2469795ef80baa4798c18df56264b4d7f5921e652';

    case 'STORAGE_ROOT': return '/home/alamin/storage';
    case 'UPLOADS_DIR': return '/home/alamin/storage/uploads';
    case 'BACKUP_DIR': return '/home/alamin/storage/backups';
    case 'TEMP_DIR': return '/home/alamin/storage/temp';

    case 'APP_ENCRYPTION_KEY': return crypto.randomBytes(32).toString('hex');
    case 'CRON_SECRET': return 'alo-cron-secret-2026-production-key';
    case 'WEBUI_SECRET_KEY': return crypto.randomBytes(32).toString('base64');

    case 'CLOUDFLARE_TUNNEL_ID': return '7160647f-edfb-42c0-b98d-b760c30a0a61';
    case 'SMTP_HOST': return 'localhost';
    case 'SMTP_PORT': return '25';
    case 'SMTP_FROM': return 'noreply@hosting.alolabs.net';

    default:
      return ''; // Optional external API keys (Stripe, Cloudflare tokens, etc.)
  }
}

const finalEnv = {};
const sortedKeys = Array.from(envVars).sort();

sortedKeys.forEach(k => {
  finalEnv[k] = getSmartValue(k);
});

// Write formatted .env
let envContent = `# ==============================================================================\n`;
envContent += `# ALO HOSTING PORTAL — AUTO-GENERATED COMPLETE ENVIRONMENT CONFIGURATION\n`;
envContent += `# Generated on: ${new Date().toISOString()}\n`;
envContent += `# Total Discovered Variables: ${sortedKeys.length}\n`;
envContent += `# ==============================================================================\n\n`;

sortedKeys.forEach(k => {
  const v = finalEnv[k];
  envContent += `${k}="${v}"\n`;
});

fs.writeFileSync(ENV_PATH, envContent);

console.log('✅ 2. Master .env file updated with ALL required variables.');
console.log('📊 Environment Audit Report:');
sortedKeys.forEach(k => {
  const status = finalEnv[k] ? '✅ CONFIGURED' : '⚠️ OPTIONAL / EMPTY';
  console.log(`   - ${k.padEnd(35)} : ${status}`);
});
