#!/usr/bin/env bash
# Writes the frontends' .env.production from deploy/domains.env and builds both apps.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
set -a; source "$DIR/domains.env"; set +a
cd "$APP_DIR/frontend"
for app in console booking; do
  printf 'VITE_API_URL=https://%s/api/v1\nVITE_BOOKING_URL=https://%s\n' "$API_HOST" "$BOOKING_HOST" > "$app/.env.production"
done
npm ci
npm run build
echo "Built console/dist and booking/dist for https://$API_HOST"
