#!/usr/bin/env bash
# Prepare an immutable-by-convention release from a trusted CI artifact.
# Does not run Git, start a process, change ingress, or access a database.
set -Eeuo pipefail
umask 027
fail() { printf 'prepare-pm2-release: %s\n' "$*" >&2; exit 1; }
[[ $# == 4 ]] || fail 'usage: prepare-pm2-release.sh SHA EXPECTED_DIGEST PAYLOAD RELEASES_DIR'
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sha=$1 digest=$2 payload=$3 releases=$4
[[ $sha =~ ^[0-9a-f]{40}$ && $digest =~ ^[0-9a-f]{64}$ ]] || fail 'invalid SHA or digest'
[[ -d $payload && -d $releases ]] || fail 'payload and releases directory must exist'
payload=$(realpath -- "$payload")
releases=$(realpath -- "$releases")
[[ "$releases/" != "$payload/"* ]] || fail 'releases directory must be outside payload'
[[ ! -e $releases/$sha && ! -L $releases/$sha ]] || fail 'release already exists'
exec 9>"$releases/.prepare.lock"
flock -x 9
[[ ! -e $releases/$sha && ! -L $releases/$sha ]] || fail 'release already exists'
work=$(mktemp -d "$releases/.prepare.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
# The artifact must be downloaded by the operator/CI into a private directory.
# Refuse special files and links; copy before verification to check the exact
# bytes used below rather than a mutable source directory.
[[ -z $(find "$payload" ! -type d ! -type f -print -quit) ]] || fail 'payload contains a link or special file'
cp -a -- "$payload/." "$work/"
[[ -z $(find "$work" ! -type d ! -type f -print -quit) ]] || fail 'copied payload contains a link or special file'
actual=$(cd "$work"; export LC_ALL=C; find . -type f -print0 | sort -z | xargs -0 -r sha256sum | sha256sum | cut -d' ' -f1)
[[ $actual == "$digest" ]] || fail 'artifact digest mismatch'
[[ -z $(find "$work" -name '.env*' ! -name '*.example' -print -quit) ]] || fail 'payload contains an environment file'
for entry in server.js deploy-worker.cjs automation-worker.cjs; do
  [[ -s "$work/.next/standalone/$entry" ]] || fail "artifact missing $entry"
  node --check "$work/.next/standalone/$entry"
done
[[ -d $work/.next/static && -d $work/public ]] || fail 'artifact missing static assets'
[[ ! -e $work/.next/standalone/.next/static && ! -e $work/.next/standalone/public ]] || fail 'artifact contains preinstalled asset paths'
mkdir -p "$work/.next/standalone/.next"
cp -a -- "$work/.next/static" "$work/.next/standalone/.next/static"
cp -a -- "$work/public" "$work/.next/standalone/public"
[[ ! -e $work/.next/standalone/prepared-release.json ]] || fail 'artifact contains preinstalled release identity'
[[ ! -e $work/.next/standalone/release-identity.json ]] || fail 'payload contains an activation identity'
prepared_digest=$(bash "$script_dir/pm2-release-digest.sh" "$work")
node -e 'const [commitSha,artifactSha256,preparedDigest]=process.argv.slice(1); console.log(JSON.stringify({releaseId:commitSha,commitSha,artifactSha256,preparedDigest,preparedAt:new Date().toISOString(),status:"prepared"}))' "$sha" "$digest" "$prepared_digest" > "$work/.next/standalone/prepared-release.json"
mv -T -- "$work" "$releases/$sha"
printf 'Prepared %s; not activated\n' "$releases/$sha"
