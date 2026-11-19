#!/usr/bin/env bash
# CI packaging/activation adapter. Approval is enforced by the caller's job.
set -Eeuo pipefail
umask 077
[[ ${GITHUB_SHA:-} =~ ^[0-9a-f]{40}$ && ${PM2_DIGEST:-} =~ ^[0-9a-f]{64}$ ]] || exit 1
[[ ${PORTAL_ROOT:-} == /* && ${PORTAL_ENV_FILE:-} == /* && ${PM2_ARCHIVE:-} == /* && -f $PM2_ARCHIVE ]] || exit 1
root=$(realpath -e -- "$PORTAL_ROOT")
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
tar --no-same-owner --no-same-permissions -xzf "$PM2_ARCHIVE" -C "$work"
if [[ ! -e "$root/releases/$GITHUB_SHA" ]]; then
  bash scripts/prepare-pm2-release.sh "$GITHUB_SHA" "$PM2_DIGEST" "$work/payload" "$root/releases"
fi
PM2_HOME="$root/shared/pm2" ALO_RELEASE_AUTHORIZED=1 bash scripts/activate-pm2-release.sh \
  "$root" "$PORTAL_ENV_FILE" activate "$GITHUB_SHA" "$PM2_DIGEST"
