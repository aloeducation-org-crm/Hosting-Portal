#!/usr/bin/env bash
set -Eeuo pipefail

PASS=0; FAIL=0; RESULTS=()

check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    RESULTS+=("PASS|$name")
    PASS=$((PASS + 1))
  else
    RESULTS+=("FAIL|$name")
    FAIL=$((FAIL + 1))
  fi
}

check "Node.js >= 22" "node -e \"process.exit(process.versions.major >= 22 ? 0 : 1)\""
check ".env exists" "test -f .env"
check ".env.example exists" "test -f .env.example"
check "package-lock.json exists" "test -f package-lock.json"
check "Prisma schema valid" "npx prisma validate"

# Check .env has required vars
if grep -qE '^NEXTAUTH_SECRET=.+.{32,}' .env 2>/dev/null; then
  RESULTS+=("PASS|NEXTAUTH_SECRET length"); PASS=$((PASS + 1))
else
  RESULTS+=("FAIL|NEXTAUTH_SECRET length"); FAIL=$((FAIL + 1))
fi

if grep -qE '^JWT_SECRET=.+.{32,}' .env 2>/dev/null; then
  RESULTS+=("PASS|JWT_SECRET length"); PASS=$((PASS + 1))
else
  RESULTS+=("FAIL|JWT_SECRET length"); FAIL=$((FAIL + 1))
fi

if grep -qE '^DATABASE_URL=postgresql://' .env 2>/dev/null; then
  RESULTS+=("PASS|DATABASE_URL format"); PASS=$((PASS + 1))
else
  RESULTS+=("FAIL|DATABASE_URL format"); FAIL=$((FAIL + 1))
fi

# Check helper scripts syntax
for h in helpers/alo-*-helper; do
  [[ -f "$h" ]] || continue
  bn=$(basename "$h")
  if bash -n "$h" 2>/dev/null; then
    RESULTS+=("PASS|${bn} syntax"); PASS=$((PASS + 1))
  else
    RESULTS+=("FAIL|${bn} syntax"); FAIL=$((FAIL + 1))
  fi
done

# Lint
if npm run lint >/dev/null 2>&1; then
  RESULTS+=("PASS|ESLint"); PASS=$((PASS + 1))
else
  RESULTS+=("FAIL|ESLint"); FAIL=$((FAIL + 1))
fi

# Typecheck
if npx tsc --noEmit >/dev/null 2>&1; then
  RESULTS+=("PASS|TypeScript"); PASS=$((PASS + 1))
else
  RESULTS+=("FAIL|TypeScript"); FAIL=$((FAIL + 1))
fi

printf '{"success":%s,"step":"verify","passed":%d,"failed":%d,"results":[' "$([ $FAIL -eq 0 ] && echo 'true' || echo 'false')" "$PASS" "$FAIL"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r status name <<< "$r"
  printf '{"status":"%s","check":"%s"},' "$status" "$name"
done
printf ']}' | sed 's/,]/]/'
echo

[[ $FAIL -eq 0 ]] || exit 1
