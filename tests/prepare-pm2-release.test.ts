import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('publishes verified standalone bytes once, without activating or overwriting a release', () => {
  const root = mkdtempSync(join(tmpdir(), 'alo-release-'));
  try {
    const payload = join(root, 'payload');
    const releases = join(root, 'releases');
    const sha = 'a'.repeat(40);
    for (const dir of ['.next/standalone', '.next/static', 'public']) mkdirSync(join(payload, dir), { recursive: true });
    mkdirSync(releases);
    for (const file of ['server.js', 'deploy-worker.cjs', 'automation-worker.cjs']) writeFileSync(join(payload, '.next/standalone', file), '// fixture\n');
    writeFileSync(join(payload, 'public', 'test.txt'), 'fixture');
    const digest = execFileSync('bash', ['-c', 'export LC_ALL=C; find . -type f -print0 | sort -z | xargs -0 -r sha256sum | sha256sum | cut -d" " -f1'], { cwd: payload, encoding: 'utf8' }).trim();
    const run = (sum: string) => spawnSync('bash', ['scripts/prepare-pm2-release.sh', sha, sum, payload, releases], { encoding: 'utf8' });
    expect(run('0'.repeat(64)).stderr).toContain('artifact digest mismatch');
    expect(existsSync(join(releases, sha))).toBe(false);
    symlinkSync('test.txt', join(payload, 'public', 'link'));
    expect(run(digest).stderr).toContain('link or special file');
    rmSync(join(payload, 'public', 'link'));
    expect(run(digest).status).toBe(0);
    expect(existsSync(join(releases, sha, '.next/standalone/public/test.txt'))).toBe(true);
    expect(existsSync(join(releases, sha, '.next/standalone/prepared-release.json'))).toBe(true);
    expect(existsSync(join(releases, 'current'))).toBe(false);
    expect(run(digest).stderr).toContain('release already exists');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
