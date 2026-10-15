#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# 3xCodz Management System - Ubuntu 24.04 (LTS) provisioning script
#
# Run as a passwordless sudo user on a FRESH server:
#   chmod +x deployment/scripts/setup-ubuntu.sh
#   sudo ./deployment/scripts/setup-ubuntu.sh
#
# It installs Node 22 LTS, Nginx, MySQL 8, Certbot, configures the firewall,
# creates the application database, deploys the app and starts it under PM2.
#
# Nothing here creates a default application password. The initial owner account
# is created interactively (or from SEED_OWNER_* variables) during the seed step.
# -----------------------------------------------------------------------------
set -euo pipefail

APP_NAME="3xcode"
APP_USER="deploy"
APP_ROOT="/var/www/3xcode-management"
DOMAIN="${DOMAIN:-yourdomain.com}"
MYSQL_ROOT_PASS="${MYSQL_ROOT_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)}"
MYSQL_APP_PASS="${MYSQL_APP_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)}"
MYSQL_DB="3xcode_db"
MYSQL_SHADOW_DB="3xcode_shadow"
MYSQL_USER="3xcode"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Please run this script with sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

log "1/10 Base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git build-essential ufw unzip \
  nginx mysql-server certbot python3-certbot-nginx jq

log "2/10 Firewall"
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'

log "3/10 Node.js 22 LTS"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

log "4/10 MySQL - bind to loopback and create the application database"
MYSQL_CNF=/etc/mysql/mysql.conf.d/zz-3xcode.cnf
cat >"$MYSQL_CNF" <<'CNF'
[mysqld]
bind-address = 127.0.0.1
mysqlx-bind-address = 127.0.0.1
skip-name-resolve
default_authentication_plugin = caching_sha2_password
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
CNF
systemctl restart mysql

mysql -uroot <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY '${MYSQL_ROOT_PASS}';
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`${MYSQL_SHADOW_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'127.0.0.1' IDENTIFIED BY '${MYSQL_APP_PASS}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${MYSQL_USER}'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`${MYSQL_SHADOW_DB}\`.* TO '${MYSQL_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
echo "MySQL root password and application password were generated (see /root/3xcode-credentials.txt)."

log "5/10 Application user and directory"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_ROOT"
if [[ ! -d "$APP_ROOT/.git" ]]; then
  if [[ -n "${GIT_REPO:-}" ]]; then
    sudo -u "$APP_USER" git clone --depth 1 "$GIT_REPO" "$APP_ROOT"
  else
    echo "GIT_REPO is not set - copy the repository into $APP_ROOT manually, then re-run the deploy step." >&2
  fi
fi
chown -R "$APP_USER:$APP_USER" "$APP_ROOT"

log "6/10 Application environment file"
if [[ ! -f "$APP_ROOT/backend/.env" ]]; then
  sudo -u "$APP_USER" tee "$APP_ROOT/backend/.env" >/dev/null <<ENV
NODE_ENV=production
PORT=5000
LOG_LEVEL=info
DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_APP_PASS}@127.0.0.1:3306/${MYSQL_DB}"
SHADOW_DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_APP_PASS}@127.0.0.1:3306/${MYSQL_SHADOW_DB}"
SESSION_TTL_HOURS=168
BCRYPT_ROUNDS=12
FRONTEND_URL=https://${DOMAIN}
CORS_ORIGIN=https://${DOMAIN}
UPLOAD_DIR=/var/lib/3xcode/uploads
MAX_FILE_SIZE_MB=15
SEED_DEMO=false
ENV
  chmod 600 "$APP_ROOT/backend/.env"
  echo "Wrote $APP_ROOT/backend/.env"
else
  echo "backend/.env already exists - leaving it untouched."
fi

mkdir -p /var/lib/3xcode/uploads
chown -R "$APP_USER:$APP_USER" /var/lib/3xcode
chmod 750 /var/lib/3xcode

log "7/10 Build"
if [[ -d "$APP_ROOT/.git" || -f "$APP_ROOT/package.json" ]]; then
  sudo -u "$APP_USER" bash -lc "cd '$APP_ROOT' && npm ci --no-audit --no-fund"
  sudo -u "$APP_USER" bash -lc "cd '$APP_ROOT' && npx prisma generate --schema backend/prisma/schema.prisma"
  sudo -u "$APP_USER" bash -lc "cd '$APP_ROOT/backend' && npx prisma migrate deploy"
  sudo -u "$APP_USER" bash -lc "cd '$APP_ROOT' && npm run build"
else
  echo "Repository missing - skipping build." >&2
fi

log "8/10 PM2"
npm install -g pm2
sudo -u "$APP_USER" bash -lc "cd '$APP_ROOT' && pm2 start deployment/pm2/ecosystem.config.js --env production && pm2 save"
# Allow the unprivileged user to resurrect processes after a reboot.
if ! grep -q "pm2 resurrect" /etc/rc.local 2>/dev/null; then
  cat >/etc/rc.local <<RC
#!/bin/sh -e
su - $APP_USER -c 'cd $APP_ROOT && pm2 resurrect'
exit 0
RC
  chmod +x /etc/rc.local
fi
sudo -u "$APP_USER" env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" || true

log "9/10 Nginx"
mkdir -p /var/www/certbot
sed "s/yourdomain.com/${DOMAIN}/g" "$APP_ROOT/deployment/nginx/3xcode.conf" > /etc/nginx/sites-available/3xcode
ln -sf /etc/nginx/sites-available/3xcode /etc/nginx/sites-enabled/3xcode
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "10/10 HTTPS (requires a DNS A record pointing at this server)"
if [[ "$DOMAIN" != "yourdomain.com" ]]; then
  certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email || \
    echo "Certbot failed - re-run: certbot --nginx -d $DOMAIN" >&2
  systemctl reload nginx
fi

umask 077
cat >/root/3xcode-credentials.txt <<CRED
3xCodz provisioning summary (KEEP PRIVATE)
  App root          : $APP_ROOT
  MySQL root pass   : $MYSQL_ROOT_PASS
  MySQL app pass    : $MYSQL_APP_PASS
  Database          : $MYSQL_DB (user $MYSQL_USER @ 127.0.0.1)
  Shadow database   : $MYSQL_SHADOW_DB
  Domain            : $DOMAIN
CRED

log "Done."
echo "Next steps:"
echo "  1. Create the initial owner account (no default password is ever seeded):"
echo "       cd $APP_ROOT/backend && SEED_OWNER_EMAIL=you@example.com \\"
echo "         SEED_OWNER_PASSWORD='<a strong password>' \\"
echo "         npx tsx prisma/seed.ts"
echo "  2. Point DNS at this server, then re-run this script (or certbot) for HTTPS."
echo "  3. Subsequent releases: $APP_ROOT/deployment/scripts/deploy.sh"
