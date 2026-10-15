# Operations runbook

Day-2 operations once the system is deployed. See `DEPLOYMENT.md` for the
initial install.

---

## 1. Services

| Service | Command |
| --- | --- |
| API (PM2) | `pm2 status` · `pm2 logs 3xcode-backend` · `pm2 restart 3xcode-backend` |
| Nginx | `sudo systemctl status nginx` · `sudo nginx -t` · `sudo systemctl reload nginx` |
| MySQL | `sudo systemctl status mysql` · `sudo systemctl restart mysql` |
| Cert renewal | `sudo systemctl status certbot.timer` · `sudo certbot renew --dry-run` |

Logs:

- PM2: `~/.pm2/logs/3xcode-backend-*.log` (the ecosystem file writes to `<repo>/logs/` as well)
- Nginx: `/var/log/nginx/{access,error}.log`
- App: structured JSON via winston (`LOG_LEVEL`), written to PM2 out/error files

---

## 2. Backups

### Create one

```bash
sudo /var/www/3xcode-management/deployment/scripts/backup.sh
```

Produces in `/var/backups/3xcode`:

- `3xcode-db-<stamp>.sql.gz` - `mysqldump` of `3xcode_db`
  (`--single-transaction --routines --triggers --events`)
- `3xcode-uploads-<stamp>.tar.gz` - the upload store

Files older than 14 days are pruned automatically.

### Schedule daily

```bash
sudo crontab -e
# 03:15 every day
15 3 * * * APP_ROOT=/var/www/3xcode-management /var/www/3xcode-management/deployment/scripts/backup.sh >/var/log/3xcode-backup.log 2>&1
```

### Off-site copy

Copy the directory to another location (Linode Object Storage, another box):

```bash
rclone copy /var/backups/3xcode remote:3xcode-backups --progress
```

### Restore (test quarterly)

```bash
sudo -u deploy pm2 stop 3xcode-backend
sudo ./deployment/scripts/restore.sh /var/backups/3xcode/3xcode-db-20260101-031500.sql.gz \
                                    /var/backups/3xcode/3xcode-uploads-20260101-031500.tar.gz
sudo -u deploy pm2 start 3xcode-backend
```

Restore into a scratch database first if you just want to verify:

```bash
mysql -u 3xcode -p 3xcode_verify < 3xcode-db-*.sql.gz
```

---

## 3. Upgrades and schema migrations

1. Author the migration locally: `cd backend && npx prisma migrate dev --name change`
2. Commit `prisma/migrations/**` (including `migration_lock.toml`).
3. Deploy: `./deployment/scripts/deploy.sh` which runs
   `prisma migrate deploy` + `npm run build` + `pm2 reload`.
4. Verify `/api/health`.

`prisma migrate deploy` only applies committed migrations - it never generates
DDL implicitly, so production schema changes are always reviewable.

**Rollback** is a restore-from-backup plus a revert migration (write a new
down-safe migration where possible; Prisma does not auto-roll back).

---

## 4. Routine maintenance

| Task | Frequency | Command / place |
| --- | --- | --- |
| TLS renewal | automatic | `certbot renew --dry-run` monthly |
| Backups | daily | cron above; verify weekly |
| Disk usage | weekly | `df -h`, `du -sh /var/lib/3xcode/uploads` |
| PM2 log rotation | monthly | `pm2 install pm2-logrotate` |
| Security updates | continuous | `unattended-upgrades` |
| Audit log review | weekly | **Settings > Audit log** |
| Stale sessions | automated | background cleanup job runs hourly |

---

## 5. Background jobs

The API runs an in-process scheduler (`backend/src/jobs/scheduler.ts`), started
with the server. It is idempotent (jobs are recorded with a `dedupeKey` in
`BackgroundJob`) and covers:

- marking overdue invoices and notifying the right people,
- invoice reminder emails,
- recurring expense due-date roll-over,
- retrying failed Discord deliveries,
- pruning expired sessions / stale notifications.

Because the scheduler is in-process, run **one** PM2 instance (the shipped
`ecosystem.config.js` does this deliberately: sequential document numbering and
job de-duplication are not multi-process safe).

---

## 6. Incident triage

```bash
pm2 logs 3xcode-backend --lines 200
sudo tail -n 200 /var/log/nginx/error.log
sudo journalctl -u nginx --since "1 hour ago"
sudo systemctl status mysql
```

Check API health and DB connectivity:

```bash
curl -fsS http://127.0.0.1:5000/api/health
mysql -u 3xcode -p -h 127.0.0.1 3xcode_db -e "select 1"
```

### Recovery

```bash
# Hard restart the stack
sudo systemctl restart nginx
sudo -u deploy pm2 restart 3xcode-backend

# Full restore from the most recent backup (see above)
```

---

## 7. Security incidents

- Force every user to re-authenticate by revoking all sessions:

  ```sql
  mysql -h 127.0.0.1 -u 3xcode -p -e "USE 3xcode_db; DELETE FROM \`Session\`;"
  ```

  Or from Prisma Studio, delete all rows in `Session`. Individual sessions are
  also revoked when a user changes/resets their password.
- Deactivate the affected account under **Users** (status `INACTIVE`), which
  invalidates its sessions on next request.
- Review **Settings > Audit log** for `auth.*` and permission-changing actions.
- If SMTP/Discord credentials leaked, change them in place - Discord webhooks
  can be rotated from the Discord app, SMTP passwords in your provider.
