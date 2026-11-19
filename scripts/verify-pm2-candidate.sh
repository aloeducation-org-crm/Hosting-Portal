#!/usr/bin/env bash
# Verify transport bytes before extraction, then bind the manifest and payload to CI.
set -Eeuo pipefail
umask 077
fail() { echo "PM2 candidate: $*" >&2; exit 1; }
[[ $# == 5 ]] || fail 'expected ARCHIVE ARCHIVE_SHA256 COMMIT_SHA PAYLOAD_SHA256 EMPTY_DIRECTORY'
archive=$1 archive_digest=$2 commit=$3 payload_digest=$4 output=$5
[[ $archive_digest =~ ^[0-9a-f]{64}$ && $commit =~ ^[0-9a-f]{40}$ && $payload_digest =~ ^[0-9a-f]{64}$ ]] || fail 'invalid expected identity'
[[ -f $archive && -d $output && -z $(find "$output" -mindepth 1 -print -quit) ]] || fail 'expected a file and an empty extraction directory'
# Copy to private scratch before hashing to avoid verifying a path later replaced.
copy=$(mktemp)
trap 'rm -f -- "$copy"' EXIT
cp -- "$archive" "$copy"
actual=$(sha256sum -- "$copy" | cut -d' ' -f1)
[[ $actual == "$archive_digest" ]] || fail 'archive digest mismatch (not extracted)'
tar --no-same-owner --no-same-permissions -xzf "$copy" -C "$output"
node - "$output/manifest.json" "$commit" "$payload_digest" <<'JS'
const [file,commit,digest] = process.argv.slice(2);
try {
  const manifest = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  if (manifest.commitSha === commit && manifest.artifactSha256 === digest && manifest.status === 'candidate') process.exit(0);
} catch { /* only report mismatch */ }
console.error('PM2 candidate: manifest identity mismatch');
process.exit(1);
JS
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -d $output/payload && ! -L $output/payload && -z $(find "$output/payload" ! -type f ! -type d -print -quit) ]] || fail 'invalid payload structure'
[[ $(bash "$script_dir/pm2-release-digest.sh" "$output/payload") == "$payload_digest" ]] || fail 'payload digest mismatch'
printf 'Verified candidate %s, archive SHA-256 %s\n' "$commit" "$archive_digest"
