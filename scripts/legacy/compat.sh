#!/usr/bin/env bash
# Compatibility dispatcher for the 25 one-off scripts retired on 2026-11-09.
#
# No functionality was deleted: every original file is preserved verbatim under
# archive/retired-2026-11-09/scripts/. Active operations now go through the
# single canonical entrypoints below. Generators/PDF builders are archived-only
# because they hardcoded a developer's home directory or required undeclared
# Python packages; this dispatcher tells an operator exactly where to find them.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE="${ROOT}/archive/retired-2026-11-09/scripts"
NAME="${1:-}"

usage() {
  cat <<EOF
Usage: bash scripts/legacy/compat.sh <retired-script-name> [args...]

Canonical replacements:
  deploy-alo-portal.sh | install.sh | update.sh | install-alo-portal.sh
      -> sudo bash deploy/ubuntu-setup.sh --domain <fqdn> --apply
  package-production.sh -> scripts/deploy-release.sh
  alolabs.service       -> deploy/systemd/alo-hosting-panel.service
  create-zip*.sh|mjs|py, create-*-zip.py, gen.py, fix-*.py,
  generate-*.py, generate-dev-guide.js, write_kit.py
      -> archived verbatim; not active generators. See scripts/legacy/README.md.
EOF
}

case "$NAME" in
  ""|-h|--help) usage; exit 0 ;;
  deploy-alo-portal.sh|install.sh|update.sh|install-alo-portal.sh)
    shift
    printf 'Delegating to canonical Ubuntu provisioning. Dry-run first, then add --apply.\n' >&2
    exec bash "${ROOT}/deploy/ubuntu-setup.sh" "$@" ;;
  package-production.sh)
    shift
    exec bash "${ROOT}/scripts/deploy-release.sh" "$@" ;;
  alolabs.service)
    printf 'Canonical unit: %s\n' "${ROOT}/deploy/systemd/alo-hosting-panel.service"
    exit 0 ;;
  *)
    if [[ -f "${ARCHIVE}/${NAME}" ]]; then
      printf 'Retired generator/script preserved at: %s\n' "${ARCHIVE}/${NAME}"
      printf 'It is not part of the active build/deploy path; see archive/retired-2026-11-09/MANIFEST.md.\n'
      exit 0
    fi
    printf 'Unknown retired script: %s\n' "$NAME" >&2
    usage
    exit 2 ;;
esac
