#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# 3xCode Management System - backup (databases + uploaded files)
#
#   sudo ./deployment/scripts/backup.sh [output-dir]
#
# Produces:
#   <output-dir>/3xcode-db-<timestamp>.sql.gz
#   <output-dir>/3xcode-uploads-<timestamp>.tar.gz
#
# Credentials are read from backend/.env (DATABASE_URL). Test restore regularly:
#   sudo ./deployment/scripts/restore.sh <db-file.sql.gz> [uploads-file.tar.gz]
# -----------------------------------------------------------------------------
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/3xcode-management}"
BACKUP_DIR="${1:-/var/backups/3xcode}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

ENV_FILE="$APP_ROOT/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# DATABASE_URL="mysql://user:pass@host:port/db"
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"'"'"'')"
DB_USER="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://([^:]+):.*#\1#')"
DB_PASS="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://[^:]+:([^@]+)@.*#\1#')"
DB_HOST="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://[^@]+@([^:/]+).*#\1#')"
DB_PORT="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://[^@]+@[^:]+:([0-9]+)/.*#\1#')"
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
DB_PORT="${DB_PORT:-3306}"

export MYSQL_PWD="$DB_PASS"

echo "==> Dumping $DB_NAME"
mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --single-transaction --routines --triggers --events \
  --result-file=- "$DB_NAME" | gzip -9 >"$BACKUP_DIR/3xcode-db-$STAMP.sql.gz"

UPLOAD_DIR="$(grep -E '^UPLOAD_DIR=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"'"'"'')"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
case "$UPLOAD_DIR" in
  /*) : ;;
  *) UPLOAD_DIR="$APP_ROOT/backend/$UPLOAD_DIR" ;;
esac

if [[ -d "$UPLOAD_DIR" ]]; then
  echo "==> Archiving $UPLOAD_DIR"
  tar -czf "$BACKUP_DIR/3xcode-uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
else
  echo "==> Upload directory $UPLOAD_DIR does not exist - skipping"
fi

# Retain 14 days of backups.
find "$BACKUP_DIR" -name '3xcode-*.gz' -mtime +14 -delete

echo "==> Backup complete: $BACKUP_DIR"
ls -lh "$BACKUP_DIR" | tail -n +2
