#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "${1:?directory required}"
export LC_ALL=C
exclude=()
if [[ ${2:-} == source ]]; then
  exclude=( ! -path './.next/standalone/.next/static/*' ! -path './.next/standalone/public/*' )
fi
find . -type f ! -path './.next/standalone/prepared-release.json' ! -path './.next/standalone/release-identity.json' "${exclude[@]}" -print0 | sort -z | xargs -0 -r sha256sum | sha256sum | cut -d' ' -f1
