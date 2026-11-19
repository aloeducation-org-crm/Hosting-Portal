#!/bin/bash
# ALO Labs Health Check Script
# Usage: ./scripts/healthcheck.sh [url]
# Without an explicit URL use the PM2 panel port (3062 by default).
# PANEL_PORT matches ecosystem.config.cjs; PORT supports other launch profiles.

HEALTH_URL="${1:-http://127.0.0.1:${PANEL_PORT:-${PORT:-3062}}/api/health}"
TIMEOUT=10

response=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" "${HEALTH_URL}" 2>/dev/null)

if [ "${response}" = "200" ]; then
    echo "OK: Service is healthy (HTTP ${response})"
    exit 0
else
    echo "FAIL: Service returned HTTP ${response}"
    exit 1
fi
