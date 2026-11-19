import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('rehearses exact-SHA activation, health rollback, manual rollback, integrity and locking', () => {
  const root = mkdtempSync(join(tmpdir(), 'alo-activate-'));
  try {
    for (const dir of ['bin', 'releases', 'shared/pm2', 'payload/.next/standalone', 'payload/.next/static', 'payload/public']) mkdirSync(join(root, dir), { recursive: true });
    const file = (name: string, text: string, mode = 0o600) => writeFileSync(join(root, name), text, { mode });
    for (const name of ['server.js', 'deploy-worker.cjs', 'automation-worker.cjs']) file(`payload/.next/standalone/${name}`, '// fixture\n');
    file('shared/customer-upload', 'preserve me');
    execFileSync(process.execPath, ['-e', 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("CREATE TABLE audit_logs(id TEXT)")', join(root, 'shared/local.db')]);
    const envFile = join(root, 'shared/panel.env');
    file('shared/panel.env', ['NEXTAUTH_SECRET', 'JWT_SECRET', 'INTERNAL_SECRET', 'APP_ENCRYPTION_KEY'].map((key) => `${key}=${'x'.repeat(32)}`).join('\n') + `\nDATABASE_URL=file:${root}/shared/local.db\n`);
    file('bin/pm2', `#!/bin/bash
case "$1" in
  jlist) if [[ -f "$PM2_HOME/mock-cwd" ]]; then
    "$REAL_NODE" -e 'console.log(JSON.stringify(["alo-hosting-panel","alo-deploy-worker","alo-automation-worker"].map(name=>({name,pm2_env:{status:"online",pm_cwd:process.argv[1]}}))))' "$(cat "$PM2_HOME/mock-cwd")"
  else echo '[]'; fi ;;
  start) echo "$PANEL_APP_DIR/.next/standalone" > "$PM2_HOME/mock-cwd" ;;
  delete) rm -f "$PM2_HOME/mock-cwd" ;;
  save|ping) exit 0;;
  *) exit 1;;
esac
`, 0o700);
    file('bin/ss', '#!/bin/bash\nexit 0\n', 0o700);
    file('bin/node', '#!/bin/bash\nif [[ "$1" == */probe-pm2-release.mjs ]]; then [[ "$2" != "$FAIL_SHA" ]]; else exec "$REAL_NODE" "$@"; fi\n', 0o700);
    const sha = (letter: string) => letter.repeat(40);
    const digest = execFileSync('bash', ['scripts/pm2-release-digest.sh', join(root, 'payload')], { encoding: 'utf8' }).trim();
    for (const letter of ['a', 'b', 'c']) execFileSync('bash', ['scripts/prepare-pm2-release.sh', sha(letter), digest, join(root, 'payload'), join(root, 'releases')]);
    const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, REAL_NODE: process.execPath, PM2_HOME: `${root}/shared/pm2`, ALO_RELEASE_AUTHORIZED: '1', FAIL_SHA: sha('c') };
    const args = ['scripts/activate-pm2-release.sh', root, envFile];
    const run = (...parameters: string[]) => spawnSync('bash', [...args, ...parameters], { env, encoding: 'utf8' });
    const current = () => readlinkSync(join(root, 'current'));
    expect(run('activate', sha('a'), '0'.repeat(64)).stderr).toContain('integrity check failed');
    const lock = spawnSync('flock', [join(root, 'shared/activation.lock'), 'bash', ...args, 'activate', sha('a'), digest], { env, encoding: 'utf8' });
    expect(lock.stderr).toContain('another activation');
    for (const letter of ['a', 'b']) {
      expect(run('activate', sha(letter), digest).status).toBe(0);
      expect(current()).toBe(`releases/${sha(letter)}`);
    }
    expect(run('activate', sha('c'), digest).stderr).toContain('previous state recovered');
    expect(current()).toBe(`releases/${sha('b')}`);
    expect(run('rollback', 'staging rehearsal').status).toBe(0);
    expect(current()).toBe(`releases/${sha('a')}`);
    expect(existsSync(join(root, 'releases', sha('c')))).toBe(true);
    expect(readFileSync(join(root, 'shared/customer-upload'), 'utf8')).toBe('preserve me');
    file(`releases/${sha('b')}/.next/standalone/server.js`, 'tampered');
    expect(run('rollback', 'reject corrupted release').stderr).toContain('integrity check failed');
    expect(current()).toBe(`releases/${sha('a')}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15_000);
