#!/usr/bin/env bash
# Backup diário do banco + arquivos enviados. Guarda os últimos 14.
# Coloque no cron do usuário calldosgames:  30 4 * * * bash /opt/calldosgames/backend/scripts/backup.sh
set -euo pipefail
DEST=/var/lib/calldosgames/backups
mkdir -p "$DEST"
STAMP=$(date +%F)
DB_URL=$(grep -E "^DATABASE_URL=" /opt/calldosgames/backend/.env | cut -d= -f2-)
pg_dump --format=custom --dbname="$DB_URL" --file="$DEST/db-$STAMP.dump"
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C /var/lib/calldosgames uploads
ls -1t "$DEST"/db-*.dump | tail -n +15 | xargs -r rm --
ls -1t "$DEST"/uploads-*.tar.gz | tail -n +15 | xargs -r rm --
