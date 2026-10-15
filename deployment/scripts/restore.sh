#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# 3xCodz Management System - restore from backup
#
#   sudo ./deployment/scripts/restore.sh 3xcode-db-<stamp>.sql.gz [3xcode-uploads-<stamp>.tar.gz]
#
# DANGER: replaces the contents of the application database and uploads.
# Stop the API first:  sudo -u deploy pm2 stop 3xcode-backend
# -----------------------------------------------------------------------------
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/3xcode-management}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <3xcode-db-*.sql.gz> [3xcode-uploads-*.tar.gz]" >&2
  exit 1
fi

DB_DUMP="$1"
UPLOADS_TAR="${2:-}"

[[ -f "$DB_DUMP" ]] || { echo "Not found: $DB_DUMP" >&2; exit 1; }

ENV_FILE="$APP_ROOT/backend/.env"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"'"'"'')"
DB_USER="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://([^:]+):.*#\1#')"
DB_PASS="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://[^:]+:([^@]+)@.*#\1#')"
DB_HOST="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://[^@]+@([^:/]+).*#\1#')"
DB_PORT="$(printf '%s' "$DB_URL" | sed -E 's#^mysql://[^@]+@[^:]+:([0-9]+)/.*#\1#')"
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
DB_PORT="${DB_PORT:-3306}"

export MYSQL_PWD="$DB_PASS"

echo "==> Restoring $DB_NAME from $DB_DUMP"
if command -v gunzip >/dev/null; then
  gunzip -c "$DB_DUMP" | mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$DB_NAME"
else
  gzip -dc "$DB_DUMP" | mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$DB_NAME"
fi

if [[ -n "$UPLOADS_TAR" ]]; then
  UPLOAD_DIR="$(grep -E '^UPLOAD_DIR=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"'"'"'')"
  UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
  case "$UPLOAD_DIR" in
    /*) : ;;
    *) UPLOAD_DIR="$APP_ROOT/backend/$UPLOAD_DIR" ;;
  esac
  echo "==> Restoring uploads into $UPLOAD_DIR"
  mkdir -p "$UPLOAD_DIR"
  tar -xzf "$UPLOADS_TAR" -C "$(dirname "$UPLOAD_DIR")"
  chown -R deploy:deploy "$(dirname "$UPLOAD_DIR")" 2>/dev/null || true
fi

echo "==> Restore complete. Restart the API: sudo -u deploy pm2 start 3xcode-backend"
