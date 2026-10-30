#!/usr/bin/env bash
# Classify the working-tree state of the production Git checkout.
#
# WHY THIS EXISTS
#   Runs #54, #58, #60, #62 and #64 of the production workflow all died on the
#   same preflight error:
#
#     "Production checkout has local changes. Refusing to checkout or pull and
#      risk overwriting them."
#
#   The changes were the deployment's own output. `scripts/deploy-release.sh`
#   writes `release-identity.json` into the checkout root so the *running*
#   application can read it back through `/api/health` (`process.cwd()` is the
#   checkout in inline mode). The file is untracked, the dirty-tree check counts
#   untracked files (`--untracked-files=normal`), so the first successful inline
#   deploy permanently blocked every deploy after it. A guard that trips on the
#   thing it just created is a deadlock, not a safety property.
#
# WHAT THIS DOES
#   It keeps the safety property and removes the deadlock. A file is tolerated
#   only when ALL of these hold:
#     - it is untracked (a *modified tracked* file is never tolerated), and
#     - its path is in an explicit allowlist of deployment outputs, and
#     - its content parses as the record that deployment writes (so an attacker
#       or a stray process cannot smuggle an arbitrary file past the check by
#       giving it a familiar name).
#   Anything else fails closed with the offending paths printed, so genuine
#   uncommitted work still blocks the deployment and is still visible.
#
#   Tolerating by content rather than relying on `.gitignore` alone matters: the
#   ignore rule only takes effect once the host checks out the commit that
#   contains it, and it cannot take effect while this check is what blocks that
#   checkout. This script is what lets the host self-heal on the next run.
#
# Usage:
#   bash scripts/host-checkout-status.sh /path/to/checkout          # human output
#   bash scripts/host-checkout-status.sh /path/to/checkout --json   # machine output
#
# Exit codes: 0 = safe to deploy, 1 = blocked, 2 = usage/read error.
# Read-only: this script never writes, cleans, stashes, checks out or resets.
set -Eeuo pipefail

die()  { printf 'host-checkout: ERROR: %s\n' "$*" >&2; exit 2; }
fail() { printf 'host-checkout: BLOCKED: %s\n' "$*" >&2; exit 1; }

DIR="${1:-}"
JSON_ONLY=0
[[ "${2:-}" == "--json" ]] && JSON_ONLY=1
[[ -n "$DIR" ]] || die "usage: host-checkout-status.sh <checkout-dir> [--json]"
[[ -d "$DIR/.git" ]] || die "$DIR is not a Git work tree"

# Files a deployment is known to generate inside the checkout. Deliberately
# short and explicit; anything not listed here blocks the deployment.
TOLERATED_FILES=("release-identity.json")

is_tolerated_path() {
  local candidate="$1" allowed
  for allowed in "${TOLERATED_FILES[@]}"; do
    [[ "$candidate" == "$allowed" ]] && return 0
  done
  return 1
}

# Validate the content of a tolerated file, so the allowlist cannot be abused to
# hide an arbitrary payload. Reads only; prints nothing.
is_valid_deploy_record() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  node -e '
    const fs = require("node:fs");
    try {
      const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const ok = typeof parsed.commitSha === "string"
        && /^[0-9a-f]{40}$/.test(parsed.commitSha)
        && (parsed.mode === "canonical" || parsed.mode === "inline")
        && typeof parsed.activatedAt === "string"
        && !Number.isNaN(Date.parse(parsed.activatedAt))
        && typeof parsed.deploymentId === "string"
        && parsed.deploymentId.length > 0;
      process.exit(ok ? 0 : 1);
    } catch { process.exit(1); }
  ' "$file" >/dev/null 2>&1
}

declare -a BLOCKING=() TOLERATED=()

# -z separates entries with NUL so paths containing spaces survive intact.
while IFS= read -r -d '' entry; do
  [[ -n "$entry" ]] || continue
  status="${entry:0:2}"
  file="${entry:3}"

  # Renames are reported as "old -> new"; only the new path can be checked.
  [[ "$file" == *" -> "* ]] && file="${file##* -> }"

  # X = index (staged) change, Y = work-tree change. A staged change is always
  # blocking: someone prepared a commit on the production host.
  x="${status:0:1}"
  y="${status:1:1}"

  # "??" is untracked; "!!" is ignored (not emitted with default flags).
  if [[ "$status" == "??" ]]; then
    if is_tolerated_path "$file" && is_valid_deploy_record "$DIR/$file"; then
      TOLERATED+=("$file")
      continue
    fi
    BLOCKING+=("untracked: $file")
    continue
  fi

  if [[ "$x" != " " && "$x" != "?" ]]; then
    BLOCKING+=("staged ($status): $file")
    continue
  fi

  if [[ "$y" != " " && "$y" != "?" ]]; then
    # A tracked file the deployment itself rewrote is still a modification to
    # source, and pulling over it is how work is lost. Never tolerated.
    BLOCKING+=("modified ($status): $file")
    continue
  fi

  BLOCKING+=("unclassified ($status): $file")
done < <(git -C "$DIR" status --porcelain --untracked-files=normal -z 2>/dev/null)

if (( ${#BLOCKING[@]} > 0 )); then
  if (( JSON_ONLY == 1 )); then
    node -e '
      const [safe, toleratedRaw, blockingRaw] = process.argv.slice(1);
      const split = (v) => (v.length ? v.split("\u0001") : []);
      process.stdout.write(JSON.stringify({
        safe: safe === "true",
        tolerated: split(toleratedRaw),
        blocking: split(blockingRaw),
      }));
    ' "false" "$(IFS=$'\x01'; echo -n "${TOLERATED[*]-}")" "$(IFS=$'\x01'; echo -n "${BLOCKING[*]}")"
    printf '\n'
  else
    printf 'host-checkout: %s is NOT safe to deploy\n' "$DIR" >&2
    printf 'host-checkout: blocking change: %s\n' "${BLOCKING[@]}" >&2
    if (( ${#TOLERATED[@]} > 0 )); then
      printf 'host-checkout: tolerated deployment output: %s\n' "${TOLERATED[@]}" >&2
    fi
    printf 'host-checkout: resolve these by committing, reverting or removing them on the host.\n' >&2
    printf 'host-checkout: this check exists so a deployment cannot overwrite uncommitted work.\n' >&2
  fi
  exit 1
fi

if (( JSON_ONLY == 1 )); then
  node -e '
    const toleratedRaw = process.argv[1];
    const tolerated = toleratedRaw.length ? toleratedRaw.split("\u0001") : [];
    process.stdout.write(JSON.stringify({ safe: true, tolerated, blocking: [] }));
  ' "$(IFS=$'\x01'; echo -n "${TOLERATED[*]-}")"
  printf '\n'
else
  if (( ${#TOLERATED[@]} > 0 )); then
    printf 'host-checkout: %s is safe to deploy (tolerating deployment output: %s)\n' "$DIR" "${TOLERATED[*]}"
  else
    printf 'host-checkout: %s is clean and safe to deploy\n' "$DIR"
  fi
fi
exit 0
