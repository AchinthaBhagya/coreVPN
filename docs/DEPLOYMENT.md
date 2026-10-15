# Deployment guide - Linode (Ubuntu 24.04 LTS)

This is the end-to-end runbook for taking the 3xCode Management System from a
fresh Linode instance to a working HTTPS deployment. Every command is copy-paste
ready; replace the placeholders (`yourdomain.com`, `203.0.113.10`, …).

> **Golden rules**
> - MySQL listens on `127.0.0.1` only. Never expose port 3306 publicly.
> - Uploaded files live **outside** any web root and are only served through
>   authenticated API endpoints.
> - There is **no default admin password**. You create the first owner explicitly.
> - Never commit `.env` files or real secrets.

---

## 0. Prerequisites

| Item | Notes |
| --- | --- |
| Linode instance | Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM minimum (2 GB works for a small team) |
| Domain | e.g. `3xcode.example.com`, with an `A`/`AAAA` record pointing at the server |
| SSH access | As `root` or a sudo-enabled user |
| Repository | This repo pushed to a Git remote the server can reach (or you copy it with `scp`/`rsync`) |

---

## 1. First login and baseline hardening

```bash
ssh root@203.0.113.10

# Update and create a working user
apt-get update && apt-get upgrade -y
adduser deploy
usermod -aG sudo deploy

# Copy your SSH key to the new user, then re-login as `deploy`
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Optional but recommended: disable password SSH logins and root login once key
access is confirmed (`/etc/ssh/sshd_config` -> `PermitRootLogin no`,
`PasswordAuthentication no`, then `systemctl restart ssh`).

Install `unattended-upgrades` for security patches:

```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

---

## 2. Automated provisioning (recommended)

The repository ships a provisioning script that performs steps 3-9 below.

```bash
# As root, from the repository checkout on the server:
sudo DOMAIN=yourdomain.com GIT_REPO=https://github.com/you/3xcode-management.git \
     ./deployment/scripts/setup-ubuntu.sh
```

It will install Node 22 LTS, Nginx, MySQL 8, Certbot and PM2, create the
databases and a random MySQL password, write `backend/.env`, build the app,
start it with PM2 and configure Nginx. Generated credentials are written to
`/root/3xcode-credentials.txt` - move them into your password manager and
delete the file.

After it finishes, continue at **step 7 (create the owner)**.

> If you prefer to understand or adjust every step, follow the manual path below.

---

## 3. Manual: install runtime dependencies

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg git build-essential ufw nginx \
  mysql-server certbot python3-certbot-nginx jq

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v22.x
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

---

## 4. Manual: MySQL (loopback only)

```bash
sudo tee /etc/mysql/mysql.conf.d/zz-3xcode.cnf >/dev/null <<'CNF'
[mysqld]
bind-address = 127.0.0.1
mysqlx-bind-address = 127.0.0.1
skip-name-resolve
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
CNF
sudo systemctl restart mysql
```

Create the databases and application user (choose a strong password):

```bash
sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS 3xcode_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS 3xcode_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '3xcode'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON 3xcode_db.*    TO '3xcode'@'127.0.0.1';
GRANT ALL PRIVILEGES ON 3xcode_shadow.* TO '3xcode'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

Verify MySQL is not listening publicly:

```bash
sudo ss -tlnp | grep 3306   # should show 127.0.0.1:3306 only
```

---

## 5. Manual: deploy the code and configure the environment

```bash
sudo mkdir -p /var/www/3xcode-management
sudo chown -R deploy:deploy /var/www/3xcode-management

# As `deploy`
cd /var/www/3xcode-management
git clone https://github.com/you/3xcode-management.git .
```

Create `backend/.env` (see `.env.example` for the full list and `docs/ENVIRONMENT.md`):

```bash
cat > backend/.env <<ENV
NODE_ENV=production
PORT=5000
DATABASE_URL="mysql://3xcode:REPLACE_WITH_STRONG_PASSWORD@127.0.0.1:3306/3xcode_db"
SHADOW_DATABASE_URL="mysql://3xcode:REPLACE_WITH_STRONG_PASSWORD@127.0.0.1:3306/3xcode_shadow"
SESSION_TTL_HOURS=168
BCRYPT_ROUNDS=12
FRONTEND_URL=https://yourdomain.com
CORS_ORIGIN=https://yourdomain.com
UPLOAD_DIR=/var/lib/3xcode/uploads
MAX_FILE_SIZE_MB=15
SEED_DEMO=false
ENV
chmod 600 backend/.env

sudo mkdir -p /var/lib/3xcode/uploads
sudo chown -R deploy:deploy /var/lib/3xcode
sudo chmod 750 /var/lib/3xcode
```

Install, migrate, build:

```bash
npm ci --no-audit --no-fund
npx prisma generate --schema backend/prisma/schema.prisma
cd backend && npx prisma migrate deploy && cd ..
npm run build            # builds frontend/dist and backend/dist
```

---

## 6. Manual: PM2 and Nginx

```bash
sudo npm install -g pm2
pm2 start deployment/pm2/ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy   # run the printed command with sudo

sudo mkdir -p /var/www/certbot
sudo sed "s/yourdomain.com/yourdomain.com/g" deployment/nginx/3xcode.conf \
  | sudo tee /etc/nginx/sites-available/3xcode >/dev/null
sudo ln -sf /etc/nginx/sites-available/3xcode /etc/nginx/sites-enabled/3xcode
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Certificates:

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
sudo systemctl reload nginx
sudo systemctl status certbot.timer   # automatic renewal
```

---

## 7. Create the owner account (required)

The seed never creates a default account. Run it once with owner details:

```bash
cd /var/www/3xcode-management/backend
SEED_OWNER_EMAIL="you@yourdomain.com" \
SEED_OWNER_PASSWORD="A-strong-passphrase-2026!" \
SEED_OWNER_FIRST_NAME="Your" \
SEED_OWNER_LAST_NAME="Name" \
npx tsx prisma/seed.ts
```

This seeds:

- the 96-permission catalogue,
- the 9 default role templates (Owner, Administrator, Project Manager, Developer,
  Designer, Creative Member, Finance Manager, Support Agent, Client),
- your initial owner account with the **Owner** role.

Optionally set `SEED_DEMO=true` on a throwaway environment to also insert demo
clients, projects, invoices and so on. **Never** enable demo data in production.

Sign in at `https://yourdomain.com/login`, then:

1. Change your password if you used a temporary one (Profile > Change password).
2. Open **Settings > Company** and set your company identity, currency and
   numbering prefixes.
3. Create team members under **Users** and assign roles.
4. (Optional) Configure **Settings > Integrations** for Discord and SMTP.

---

## 8. Post-deploy checklist

- [ ] `curl -fsS https://yourdomain.com/api/health` returns `{"success":true,...}`
- [ ] HTTP redirects to HTTPS and the certificate is valid
- [ ] `sudo ss -tlnp | grep 3306` shows loopback only
- [ ] `pm2 status` shows `3xcode-backend` online and stable
- [ ] `pm2 startup`/`pm2 save` configured so the API returns after reboot
- [ ] Backups scheduled (see `docs/OPERATIONS.md`)
- [ ] `.env` is `chmod 600` and not world-readable
- [ ] Uploads are stored outside the web root (`/var/lib/3xcode/uploads`)
- [ ] First owner signed in and company settings saved

---

## 9. Subsequent releases

```bash
cd /var/www/3xcode-management
./deployment/scripts/deploy.sh
```

`deploy.sh` pulls, installs, applies migrations (`prisma migrate deploy`), builds
and reloads PM2, then performs a health check. Migrations are always authored
locally (`prisma migrate dev`) and committed - the server only applies them.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `502 Bad Gateway` | API not running: `pm2 logs 3xcode-backend`, `pm2 restart 3xcode-backend` |
| `P1001 cannot reach database` | MySQL down or wrong `DATABASE_URL`; check `systemctl status mysql` and `ss -tlnp` |
| Login says "account is not active" | User `status` is not `ACTIVE`; fix in Users or DB |
| CSRF errors on POST | Cookies blocked; ensure `CORS_ORIGIN`/`FRONTEND_URL` match the exact origin and you are on HTTPS |
| Emails not sending | SMTP not configured; password resets and invoice emails silently no-op |
| Discord not posting | Enable per-event in Settings > Integrations and use "Test webhook" |
| Blank page after deploy | Assets cached with old hash: hard refresh; confirm `frontend/dist` exists and Nginx root matches |
