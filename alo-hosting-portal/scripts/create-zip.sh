#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="${1:-${ROOT_DIR}/alo-hosting-portal-release.tar.gz}"

tar -czf "$OUT_FILE" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.db-journal' \
  --exclude='*.db-wal' \
  -C "$ROOT_DIR" .

printf 'Created release archive: %s\n' "$OUT_FILE"
