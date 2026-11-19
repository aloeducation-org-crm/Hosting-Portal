#!/usr/bin/env bash
# Read-only inventory. Never source or print the environment file or PM2 env.
set -Eeuo pipefail
root=$(realpath -e -- "${1:?release root required}")
env_file=$(realpath -e -- "${2:?environment file required}")
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
printf 'OS: '; . /etc/os-release; printf '%s\n' "$PRETTY_NAME"
printf 'CPU cores: '; nproc
free -m
df -hP -- "$root"
df -iP -- "$root"
node --version
npm --version
git --version
if command -v nginx >/dev/null; then nginx -v; if nginx -t >/dev/null 2>&1; then echo 'Nginx syntax: PASS'; else echo 'Nginx syntax: failed or permission denied'; fi; fi
ss -H -ltnp 'sport = :3062'
stat -c 'Environment file mode=%a owner=%U' -- "$env_file"
node - "$repo" "$env_file" <<'JS'
const [root,file]=process.argv.slice(2);
const fs=require('node:fs');
const env=require(root+'/deploy/pm2/panel-env.cjs').readPanelEnv(file);
const url=env.DATABASE_URL||'';
if(/^file:\/[^/?#][^?#]*$/.test(url)) {
  try {const s=fs.statSync(url.slice(5)); console.log(`Configured SQLite target: exists=${s.isFile()} mode=${(s.mode&511).toString(8)} uid=${s.uid}`);}
  catch {console.log('Configured SQLite target unavailable to this user');}
} else {console.log('Configured database: absent or non-SQLite URL (not printed)');}
JS
if [[ -L $root/current ]]; then
  target=$(readlink -- "$root/current")
  if [[ $target =~ ^releases/[0-9a-f]{40}$ ]]; then printf 'Managed pointer: %s\n' "$target"; else echo 'Current pointer is not managed'; fi
fi
if health=$(curl -fsS --max-time 4 http://127.0.0.1:3062/api/health); then
  node -e 'const d=JSON.parse(require("node:fs").readFileSync(0)).data||{};console.log(JSON.stringify({commitSha:d.release?.commitSha??null,databaseStatus:d.databaseStatus,schemaStatus:d.schemaStatus}))' <<< "$health"
else echo 'Loopback health not verified'; fi
