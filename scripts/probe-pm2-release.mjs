import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const [sha, id, dir] = process.argv.slice(2);
const origin = 'http://127.0.0.1:3062';
const request = (path) => fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(2500) });
const asset = readdirSync(join(dir, '.next/static/chunks')).find((name) => name.endsWith('.js'));
if (!asset) process.exit(1);
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  try {
    const health = await request('/api/health');
    const { data } = await health.json();
    if (health.ok && data?.release?.commitSha === sha && data.release.deploymentId === id && data.databaseStatus === 'connected' && data.schemaStatus === 'current') {
      const responses = await Promise.all(['/api/ready', '/login', '/_next/static/chunks/' + encodeURIComponent(asset)].map(request));
      if (responses.every((response) => response.ok)) process.exit(0);
    }
  } catch { /* startup may not have completed yet; never log response bodies */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error('Candidate did not verify identity, readiness, login and static assets');
process.exit(1);
