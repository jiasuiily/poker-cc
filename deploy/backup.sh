#!/usr/bin/env bash
# Daily PostgreSQL backup: deploy/backups/poker-YYYYMMDD-HHMMSS.sql.gz, keeps 14 days.
# Run from anywhere; cron example (03:30 every day):
#   30 3 * * * /opt/poker-cc/deploy/backup.sh >> /opt/poker-cc/deploy/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
file="backups/poker-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U poker -d poker --no-owner | gzip > "$file.tmp"
mv "$file.tmp" "$file"
find backups -name 'poker-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup ok: $file ($(du -h "$file" | cut -f1))"
