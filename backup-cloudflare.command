#!/bin/zsh
set -e

cd "$(dirname "$0")"

mkdir -p backups

STAMP=$(date +"%Y-%m-%d_%H-%M-%S")
OUTPUT="./backups/uman-transfer-crm-$STAMP.sql"

echo "Creating Cloudflare D1 backup..."
echo "Output: $OUTPUT"
echo ""

npx wrangler d1 export uman-transfer-crm --remote --output="$OUTPUT"

echo ""
echo "Backup finished."
echo "Keep this file somewhere safe: $OUTPUT"
