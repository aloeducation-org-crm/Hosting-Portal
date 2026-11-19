import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('rejects unverified transport before extraction and binds the archive to the expected commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'alo-archive-'));
  try {
    const sha = 'a'.repeat(40);
    const input = join(root, 'source'), archive = join(root, 'candidate.tar.gz');
    mkdirSync(join(input, 'payload'), { recursive: true });
    writeFileSync(join(input, 'payload', 'file'), 'payload contents');
    const payload = execFileSync('bash', ['scripts/pm2-release-digest.sh', join(input, 'payload')], { encoding: 'utf8' }).trim();
    writeFileSync(join(input, 'manifest.json'), JSON.stringify({ status: 'candidate', commitSha: sha, artifactSha256: payload }));
    execFileSync('tar', ['-C', input, '-czf', archive, 'manifest.json', 'payload']);
    const digest = execFileSync('sha256sum', [archive], { encoding: 'utf8' }).split(' ')[0]!;
    const run = (tag: string, hash: string, commit = sha) => {
      const dest = join(root, tag); mkdirSync(dest);
      return { dest, result: spawnSync('bash', ['scripts/verify-pm2-candidate.sh', archive, hash, commit, payload, dest], { encoding: 'utf8' }) };
    };
    const bad = run('bad', '0'.repeat(64));
    expect(bad.result.stderr).toContain('not extracted');
    expect(readdirSync(bad.dest)).toEqual([]);
    expect(run('wrong-sha', digest, 'b'.repeat(40)).result.stderr).toContain('manifest identity mismatch');
    expect(run('verified', digest).result.status).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
