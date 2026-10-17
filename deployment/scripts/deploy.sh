#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# 3xCodz Management System - release script (run on the server)
#
#   /var/www/3xcode-management/deployment/scripts/deploy.sh [git-ref]
#
# Pulls, installs dependencies, runs migrations, rebuilds and restarts the API.
# Migrations are applied with `prisma migrate deploy` which never generates new
# migrations implicitly - add those locally and commit them.
# -----------------------------------------------------------------------------
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/3xcode-management}"
APP_USER="${APP_USER:-deploy}"
REF="${1:-}"

cd "$APP_ROOT"

if [[ -d .git ]]; then
  echo "==> Fetching ${REF:-latest}"
  git fetch --all --prune
  if [[ -n "$REF" ]]; then
    git checkout "$REF"
    git reset --hard "$REF"
  else
    # Mirror the remote branch exactly. `git pull --ff-only` can be blocked by
    # stray build artifacts left on the server (e.g. *.tsbuildinfo), which would
    # silently deploy stale code - so reset instead and let `set -e` fail loudly.
    BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    git reset --hard "origin/${BRANCH}"
  fi
fi

run() {
  if [[ "$(id -un)" == "$APP_USER" ]]; then
    bash -lc "$*"
  else
    sudo -u "$APP_USER" bash -lc "cd '$APP_ROOT' && $*"
  fi
}

echo "==> Dependencies"
run "npm ci --no-audit --no-fund"

echo "==> Prisma client"
run "npx prisma generate --schema backend/prisma/schema.prisma"

echo "==> Database migrations"
run "cd backend && npx prisma migrate deploy"

echo "==> Build"
run "npm run build"

echo "==> Restart API"
run "pm2 reload 3xcode-backend --update-env || pm2 start deployment/pm2/ecosystem.config.js --env production"
run "pm2 save"

echo "==> Health check"
sleep 2
if curl -fsS "http://127.0.0.1:${PORT:-5000}/api/health" >/dev/null; then
  echo "OK - API healthy"
else
  echo "API health check FAILED" >&2
  exit 1
fi

echo "==> Deployed"
