#!/usr/bin/env bash
# Run as the dedicated portal PM2 user, with a dedicated PM2_HOME.
# Usage: activate-pm2-release.sh ROOT ENV_FILE activate SHA CI_DIGEST
#        activate-pm2-release.sh ROOT ENV_FILE rollback REASON
set -Eeuo pipefail
umask 077
fail() { printf 'portal release: %s\n' "$*" >&2; exit 1; }
[[ $EUID != 0 ]] || fail 'run as the dedicated non-root portal user'
[[ $# -ge 4 ]] || fail 'expected ROOT ENV_FILE activate SHA CI_DIGEST or rollback REASON'
[[ ${ALO_RELEASE_AUTHORIZED:-} == 1 ]] || fail 'explicit release authorization required'
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
root=$(realpath -e -- "$1"); env_file=$(realpath -e -- "$2"); action=$3
[[ -d $root/releases && ! -L $root/releases && -d $root/shared && ! -L $root/shared && -f $env_file ]] || fail 'release layout or environment missing'
[[ $env_file != "$root/releases/"* ]] || fail 'env file must be external to releases'
[[ $(stat -c '%a' "$env_file") =~ ^[46]00$ ]] || fail 'env file must be mode 400 or 600'
[[ ${PM2_HOME:-} == "$root/shared/pm2" && -d $PM2_HOME && ! -L $PM2_HOME ]] || fail 'dedicated PM2_HOME required'
exec 9>"$root/shared/activation.lock"
flock -n 9 || fail 'another activation is in progress'
# PM2 may launch a persistent daemon; never let it inherit the flock FD.
pm2() { command pm2 "$@" 9>&-; }
[[ ! -e $root/shared/pending ]] || fail 'interrupted activation: reconcile the journal before continuing'
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$root/shared/activation.log"; }
node - "$repo" "$env_file" "$root" <<'JS'
const [repo,file,root]=process.argv.slice(2);
const fs=require('node:fs');
const env=require(repo+'/deploy/pm2/panel-env.cjs').readPanelEnv(file);
for(const k of ['NEXTAUTH_SECRET','JWT_SECRET','INTERNAL_SECRET','APP_ENCRYPTION_KEY']) if ((env[k]||'').length<32) { console.error(`missing/short ${k}`); process.exit(1); }
const url=env.DATABASE_URL||'';
try {
 if(!/^file:\/[^/?#][^?#]*$/.test(url)) throw Error();
 const db=fs.realpathSync(url.slice(5));
 if(db.startsWith(root+'/releases/') || !fs.statSync(db).isFile()) throw Error();
 fs.accessSync(db,fs.constants.R_OK|fs.constants.W_OK);
 fs.accessSync(require('node:path').dirname(db),fs.constants.W_OK);
 const sqlite=new (require('node:sqlite').DatabaseSync)(db,{readOnly:true});
 try { if(sqlite.prepare('PRAGMA quick_check(1)').get().quick_check!=='ok' || !sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'").get()) throw Error(); } finally { sqlite.close(); }
} catch { console.error('expected an existing external writable SQLite database'); process.exit(1); }
JS
current=''; current_digest=''
if [[ -L $root/current ]]; then
  link=$(readlink -- "$root/current")
  [[ $link =~ ^releases/([0-9a-f]{40})$ ]] || fail 'unmanaged current pointer'
  current=${BASH_REMATCH[1]}
  [[ -f $root/shared/good-$current ]] || fail 'current release is not recorded as known-good'
  read -r current_digest < "$root/shared/good-$current"
elif [[ -e $root/current ]]; then fail 'current is not a managed symlink'; fi
case $action in
  activate) [[ $# == 5 ]] || fail 'activate requires SHA and CI digest'; target=$4; digest=$5 ;;
  rollback) [[ $# == 4 && -n $current && $4 =~ ^[[:print:]]{1,200}$ ]] || fail 'rollback requires an active release and a one-line reason'; [[ -f $root/shared/previous ]] || fail 'no previous known-good release'; read -r target digest < "$root/shared/previous" ;;
  *) fail 'unknown operation' ;;
esac
verify() {
  local sha=$1 expected=$2 dir actual
  [[ $sha =~ ^[0-9a-f]{40}$ && $expected =~ ^[0-9a-f]{64}$ ]] || return 1
  dir="$root/releases/$sha"
  [[ -d $dir && ! -L $dir && -z $(find "$dir" ! -type f ! -type d -print -quit) ]] || return 1
  [[ $(bash "$repo/scripts/pm2-release-digest.sh" "$dir" source) == "$expected" ]] || return 1
  diff -qr -- "$dir/.next/static" "$dir/.next/standalone/.next/static" >/dev/null || return 1
  diff -qr -- "$dir/public" "$dir/.next/standalone/public" >/dev/null || return 1
  actual=$(bash "$repo/scripts/pm2-release-digest.sh" "$dir") || return 1
  node -e 'const [file,sha,source,actual]=process.argv.slice(1); try {const m=JSON.parse(require("node:fs").readFileSync(file)); if(m.commitSha===sha&&m.artifactSha256===source&&m.preparedDigest===actual) process.exit(0)} catch {} process.exit(1)' "$dir/.next/standalone/prepared-release.json" "$sha" "$expected" "$actual"
}
[[ $target != "$current" ]] || fail 'target already active'
verify "$target" "$digest" || fail 'target integrity check failed'
if [[ -n $current ]]; then verify "$current" "$current_digest" || fail 'known-good integrity check failed'; fi
# Never use a shared daemon: only these three managed names may exist.
pm2 ping >/dev/null 2>&1 || fail 'cannot initialize the dedicated PM2 daemon'
expected_cwd=''
if [[ -n $current ]]; then expected_cwd="$root/releases/$current/.next/standalone"; fi
pm2 jlist | node -e 'try { const rows=JSON.parse(require("node:fs").readFileSync(0)); const expected=process.argv[1]; if (Array.isArray(rows)&&rows.every(x=>expected&&x.pm2_env?.pm_cwd===expected&&["alo-hosting-panel","alo-deploy-worker","alo-automation-worker"].includes(x.name))) process.exit(0); } catch {} process.exit(1)' "$expected_cwd" || fail 'PM2 daemon contains an unmanaged process'

if [[ -z $current ]]; then
  listeners=$(ss -H -ltn 'sport = :3062') || fail 'cannot inspect port 3062'
  [[ -z $listeners ]] || fail 'port 3062 already in use'
fi
switch_to() {
  ln -s -- "releases/$1" "$root/.current.$$" && mv -Tf -- "$root/.current.$$" "$root/current"
}
start_release() {
  local sha=$1 sum=$2 dir id
  dir="$root/releases/$sha/.next/standalone"
  id=$(node -p 'require("node:crypto").randomUUID()') || return 1
  node -e 'const [commitSha,artifactSha256,deploymentId]=process.argv.slice(1); console.log(JSON.stringify({commitSha,artifactSha256,deploymentId,mode:"canonical",activatedAt:new Date().toISOString()}))' "$sha" "$sum" "$id" > "$dir/release-identity.json" || return 1
  # Delete only these dedicated definitions so PM2 cannot retain the old cwd.
  stop_managed || return 1
  PANEL_PORT=3062 PANEL_APP_DIR="$root/releases/$sha" PANEL_ENV_FILE="$env_file" pm2 start "$repo/deploy/pm2/ecosystem.config.cjs" --only alo-hosting-panel >/dev/null 2>&1 || return 1
  node "$repo/scripts/probe-pm2-release.mjs" "$sha" "$id" "$dir" || return 1
  PANEL_PORT=3062 PANEL_APP_DIR="$root/releases/$sha" PANEL_ENV_FILE="$env_file" pm2 start "$repo/deploy/pm2/ecosystem.config.cjs" --only alo-deploy-worker,alo-automation-worker >/dev/null 2>&1 || return 1
  pm2 jlist | node -e 'try { const rows=JSON.parse(require("node:fs").readFileSync(0)); const dirs=process.argv[1]; if (["alo-hosting-panel","alo-deploy-worker","alo-automation-worker"].every(name=>rows.some(p=>p.name===name&&p.pm2_env?.status==="online"&&p.pm2_env.pm_cwd===dirs))) process.exit(0); } catch {} process.exit(1)' "$dir" || return 1
  switch_to "$sha"
}
stop_managed() {
  local names name
  names=$(pm2 jlist | node -e 'const p=JSON.parse(require("node:fs").readFileSync(0)); for(const x of p) if (["alo-hosting-panel","alo-deploy-worker","alo-automation-worker"].includes(x.name)) console.log(x.name)') || return 1
  [[ -n $names ]] || return 0
  while IFS= read -r name; do pm2 delete "$name" >/dev/null 2>&1 || return 1; done <<< "$names"
}
printf '%s %s\n' "${current:-none}" "$target" > "$root/shared/pending"
log "attempt $action $target"
if [[ $action == rollback ]]; then log "rollback reason: $4"; fi
if start_release "$target" "$digest" && pm2 save >/dev/null 2>&1; then
  printf '%s\n' "$digest" > "$root/shared/good-$target"
  if [[ -n $current ]]; then printf '%s %s\n' "$current" "$current_digest" > "$root/shared/previous"; fi
  log "healthy $target"
  rm -- "$root/shared/pending"
  exit 0
fi
log "failed $target"
if [[ -n $current ]] && start_release "$current" "$current_digest" && pm2 save >/dev/null 2>&1; then
  log "recovered $current"
  rm -- "$root/shared/pending"
elif [[ -z $current ]] && stop_managed && pm2 save --force >/dev/null 2>&1; then
  [[ ! -L $root/current ]] || rm -- "$root/current"
  log 'failed bootstrap stopped'
  rm -- "$root/shared/pending"
else
  log 'recovery failed; journal retained'
  fail 'activation and recovery failed; inspect private logs and journal'
fi
fail 'candidate failed; previous state recovered'
