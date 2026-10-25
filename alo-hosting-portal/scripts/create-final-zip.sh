#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# ALO Labs Hosting Portal — Final Production ZIP Builder
# ═══════════════════════════════════════════════════════════════════
set -e

PROJECT_DIR="/home/z/my-project"
OUTPUT="/home/z/my-project/download/ALO-Labs-Hosting-Portal-FINAL.zip"
TMPDIR=$(mktemp -d)
DEST="$TMPDIR/alo-hosting-portal"
mkdir -p "$DEST"

echo "[1/8] Copying source files..."
# Source code
cp -r "$PROJECT_DIR/src" "$DEST/src"
# Public assets
cp -r "$PROJECT_DIR/public" "$DEST/public"
# Prisma schema + migrations
cp -r "$PROJECT_DIR/prisma" "$DEST/prisma"
# Config files
cp "$PROJECT_DIR/package.json" "$DEST/package.json"
cp "$PROJECT_DIR/package-lock.json" "$DEST/package-lock.json"
cp "$PROJECT_DIR/tsconfig.json" "$DEST/tsconfig.json"
cp "$PROJECT_DIR/next.config.ts" "$DEST/next.config.ts"
cp "$PROJECT_DIR/postcss.config.mjs" "$DEST/postcss.config.mjs"
cp "$PROJECT_DIR/tailwind.config.ts" "$DEST/tailwind.config.ts"
cp "$PROJECT_DIR/components.json" "$DEST/components.json"
cp "$PROJECT_DIR/eslint.config.mjs" "$DEST/eslint.config.mjs"
cp "$PROJECT_DIR/.env.example" "$DEST/.env.example"
cp "$PROJECT_DIR/vitest.config.ts" "$DEST/vitest.config.ts"

# Empty db directory for SQLite
echo "[2/8] Creating db directory..."
mkdir -p "$DEST/db"
# Touch empty db so Prisma has a target
touch "$DEST/db/.gitkeep"

echo "[3/8] Copying install & deploy scripts..."
cp -r "$PROJECT_DIR/install-scripts" "$DEST/install-scripts"
cp -r "$PROJECT_DIR/server-config" "$DEST/server-config"
cp -r "$PROJECT_DIR/server-helpers" "$DEST/server-helpers"
cp -r "$PROJECT_DIR/helpers" "$DEST/helpers"

# Docker files
cp "$PROJECT_DIR/Dockerfile" "$DEST/Dockerfile"
cp "$PROJECT_DIR/docker-compose.yml" "$DEST/docker-compose.yml"
cp "$PROJECT_DIR/Caddyfile" "$DEST/Caddyfile"

# Tests
echo "[4/8] Copying test files..."
cp -r "$PROJECT_DIR/tests" "$DEST/tests"

# Standalone build output (built .next directory)
echo "[5/8] Copying .next standalone build..."
if [ -d "$PROJECT_DIR/.next/standalone" ]; then
  cp -r "$PROJECT_DIR/.next/standalone" "$DEST/.next-standalone"
fi
if [ -d "$PROJECT_DIR/.next/static" ]; then
  cp -r "$PROJECT_DIR/.next/static" "$DEST/.next-static"
fi

echo "[6/8] Removing dev-only artifacts..."
# Remove tool-results, agent-ctx, scripts dir, screenshots, old zips from package
rm -rf "$DEST/src/tool-results" 2>/dev/null || true
find "$DEST" -name '*.png' -not -path '*/public/*' -delete 2>/dev/null || true
find "$DEST" -name '.DS_Store' -delete 2>/dev/null || true
find "$DEST" -name 'node_modules' -type d -exec rm -rf {} + 2>/dev/null || true

echo "[7/8] Creating ZIP..."
cd "$TMPDIR"
rm -f "$OUTPUT"
zip -r "$OUTPUT" alo-hosting-portal/ \
  -x "*.DS_Store" \
  -x "*node_modules/*"

echo "[8/8] Generating SHA-256 checksum..."
sha256sum "$OUTPUT" > "${OUTPUT}.sha256"

# Cleanup
rm -rf "$TMPDIR"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ZIP:     $OUTPUT"
echo "  SIZE:    $(du -sh "$OUTPUT" | cut -f1)"
echo "  SHA256:  $(cat "${OUTPUT}.sha256" | cut -d' ' -f1)"
echo "  FILES:   $(zipinfo -1 "$OUTPUT" | wc -l)"
echo "═══════════════════════════════════════════════════════════════"