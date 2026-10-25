#!/bin/bash
set -euo pipefail

PROJECT_DIR="/home/z/my-project"
OUTPUT_DIR="$PROJECT_DIR/download"
ZIP_NAME="ALO-Labs-Hosting-Portal-production.zip"
ZIP_PATH="$OUTPUT_DIR/$ZIP_NAME"

# Clean previous build artifacts
rm -rf "$PROJECT_DIR/.next"

# Create a clean production build
cd "$PROJECT_DIR"
npm run build > /dev/null 2>&1

echo "Creating production ZIP..."

# Create ZIP with all necessary production files
(cd "$PROJECT_DIR" && zip -r "$ZIP_PATH" \
  .next/standalone/ \
  .next/static/ \
  public/ \
  prisma/ \
  package.json \
  package-lock.json \
  tsconfig.json \
  next.config.ts \
  postcss.config.mjs \
  tailwind.config.ts \
  eslint.config.mjs \
  vitest.config.ts \
  .env.example \
  Caddyfile \
  Dockerfile \
  docker-compose.yml \
  DEPLOY.md \
  -x '*.map' '*.tsbuildinfo' \
  2>&1)

# Also add src/ for reference and server helpers
(cd "$PROJECT_DIR" && zip -r "$ZIP_PATH" \
  src/ \
  helpers/ \
  server-helpers/ \
  install-scripts/ \
  deploy/ \
  server-config/ \
  scripts/ \
  tests/ \
  -x '*.map' '*.tsbuildinfo' \
  2>&1)

echo "ZIP created: $ZIP_PATH"
echo "Size: $(du -sh "$ZIP_PATH" | cut -f1)"

# Generate SHA-256
sha256sum "$ZIP_PATH" > "${ZIP_PATH}.sha256"
echo "SHA-256: $(cat "${ZIP_PATH}.sha256")"

echo "Done."
