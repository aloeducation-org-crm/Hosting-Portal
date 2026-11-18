'use strict';
/**
 * Reader for /etc/alo-hosting/panel.env, used by deploy/pm2/ecosystem.config.cjs
 * and scripts/deploy-pm2.sh.
 *
 * PM2 7.x silently ignores `env_file`, so the ecosystem file has to read the
 * environment file itself. The file is parsed as data, never sourced by a
 * shell, so a value can never execute as a command.
 *
 * Accepted line shapes:
 *   KEY=value
 *   export KEY=value
 *   KEY="value with spaces"      (surrounding quotes removed)
 *   KEY='value'                  (surrounding quotes removed)
 *   KEY=value   # comment        (only for unquoted values, and only when the
 *                                 `#` follows whitespace, so URLs with a
 *                                 fragment are left intact)
 * Blank lines and lines starting with `#` are ignored. A later assignment of
 * the same key wins, which matches how a shell would read the file.
 */
const fs = require('node:fs');

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function parsePanelEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine)) continue;
    const match = LINE.exec(rawLine);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out[match[1]] = value;
  }
  return out;
}

/** Returns {} when the file does not exist; throws on any other read error. */
function readPanelEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
  return parsePanelEnv(text);
}

module.exports = { parsePanelEnv, readPanelEnv };

// CLI: `node panel-env.cjs <file> KEY` prints one value (exit 1 when unset).
// Used by scripts/deploy-pm2.sh so the shell never sources the env file.
if (require.main === module) {
  const [file, key] = process.argv.slice(2);
  if (!file || !key) {
    process.stderr.write('usage: panel-env.cjs <env-file> <KEY>\n');
    process.exit(2);
  }
  const value = readPanelEnv(file)[key];
  if (value === undefined || value === '') process.exit(1);
  process.stdout.write(value);
}
