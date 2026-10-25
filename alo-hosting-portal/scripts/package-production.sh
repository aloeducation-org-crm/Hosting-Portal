#!/bin/bash
set -euo pipefail

PROJECT_DIR="/home/z/my-project"
OUTPUT_DIR="$PROJECT_DIR/download"
ZIP_NAME="ALO-Labs-Hosting-Portal-Enterprise.zip"
ZIP_PATH="$OUTPUT_DIR/$ZIP_NAME"

# Clean previous build
rm -rf "$PROJECT_DIR/.next"

# Ensure proper secrets for build
export NEXTAUTH_SECRET="build-temp-secret-not-for-production-$(openssl rand -hex 32)"
export JWT_SECRET="build-temp-secret-not-for-production-$(openssl rand -hex 32)"

# Build for production
echo "=== Building for production ==="
cd "$PROJECT_DIR"
npx next build 2>&1 | tail -5

echo ""
echo "=== Creating deployment ZIP ==="
mkdir -p "$OUTPUT_DIR"

# Create a temp directory for the zip contents
TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# Copy project files
rsync -a \
  --exclude='.git' \
  --exclude='.next/cache' \
  --exclude='node_modules/.cache' \
  --exclude='tool-results' \
  --exclude='download' \
  --exclude='scripts' \
  --exclude='db/*.db' \
  --exclude='db/*.db-journal' \
  --exclude='data/sso-config.json' \
  "$PROJECT_DIR/" "$TMPDIR/alo-hosting-portal/"

# Create the zip
cd "$TMPDIR"
zip -r -9 "$ZIP_PATH" alo-hosting-portal/

# Get stats
FILES=$(find "$TMPDIR/alo-hosting-portal" -type f | wc -l)
SIZE=$(du -sh "$ZIP_PATH" | cut -f1)
ROUTES=$(find "$TMPDIR/alo-hosting-portal/src/app/api" -name 'route.ts' | wc -l)
MODELS=$(grep -c '^model ' "$TMPDIR/alo-hosting-portal/prisma/schema.prisma")
TESTS=$(find "$TMPDIR/alo-hosting-portal/tests" -name '*.test.ts' | wc -l)

# SHA-256
SHA=$(sha256sum "$ZIP_PATH" | cut -d' ' -f1)

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     ALO Labs Hosting Portal - Enterprise Edition            ║"
echo "║     Production Deployment Package                          ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  File:           $ZIP_NAME"
echo "║  Size:           $SIZE"
echo "║  Files:          $FILES"
echo "║  API Routes:     $ROUTES"
echo "║  DB Models:      $MODELS"
echo "║  Test Files:     $TESTS"
echo "║  SHA-256:        $SHA"
echo "╚══════════════════════════════════════════════════════════════╝"