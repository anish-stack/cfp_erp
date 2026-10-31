#!/usr/bin/env bash
# cron: 30 2 * * * MONGO_BACKUP_URI='mongodb://backup:***@127.0.0.1/cpf_erp?authSource=admin' /var/www/cpf-erp/deploy/backup-mongo.sh
set -euo pipefail
DEST=/var/backups/cpf-mongo
mkdir -p "$DEST"
mongodump --uri "$MONGO_BACKUP_URI" --gzip --archive="$DEST/cpf-$(date +%F).gz"
tar -czf "$DEST/uploads-$(date +%F).tgz" -C /var/www/cpf-erp/backend uploads 2>/dev/null || true
find "$DEST" -name 'cpf-*.gz' -mtime +14 -delete
find "$DEST" -name 'uploads-*.tgz' -mtime +14 -delete
