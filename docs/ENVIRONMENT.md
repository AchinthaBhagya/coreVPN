# Environment variables

The backend reads configuration from `backend/.env` (loaded by
`backend/src/config/env.ts` via `dotenv`). The frontend has **no** runtime
environment variables - all secrets are server-side only.

Copy `.env.example` to `backend/.env` and fill in real values. Never commit
`.env`.

## Required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Prisma connection string. Must be `mysql://user:pass@127.0.0.1:3306/3xcode_db` on production. |
| `SHADOW_DATABASE_URL` | Separate database used only by `prisma migrate dev` locally. Not needed at runtime. |

> Authentication uses opaque random session tokens stored hashed in the
> database - there is no signing secret to rotate. To force every user to sign
> in again, delete all `Session` rows (see `docs/OPERATIONS.md` > Security
> incidents).

## Optional (with defaults)

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables the production CSP and SPA serving. |
| `PORT` | `5000` | API listen port. Nginx proxies `/api` to `127.0.0.1:5000`. |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug`. |
| `SESSION_TTL_HOURS` | `168` | Absolute lifetime of a session (hours). After that the user must sign in again; sessions are opaque tokens hashed in the DB. |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost. Raise on beefier hardware. |
| `FRONTEND_URL` | `http://localhost:5173` | Absolute origin used for password-reset links. |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins. Must match exactly (scheme + port). |
| `UPLOAD_DIR` | `./uploads` | Where uploaded files are stored. Must be **outside** any public web root. |
| `MAX_FILE_SIZE_MB` | `15` | Upload cap enforced by multer. Keep Nginx `client_max_body_size` larger. |
| `SEED_DEMO` | `false` | `true` makes `prisma/seed.ts` insert demo data. **Never enable in production.** |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | empty / `587` | Outbound email (password resets, invoice/quotation emails). |
| `DISCORD_ENABLED` | `false` | Master switch for outbound Discord notifications. |
| `DISCORD_WEBHOOK_DEFAULT` | empty | Optional fallback webhook. Prefer per-event webhooks configured in **Settings > Integrations**; they are stored in the database, never exposed to the SPA. |

## Seeding variables (read by `backend/prisma/seed.ts`)

| Variable | Description |
| --- | --- |
| `SEED_OWNER_EMAIL` | Email for the initial owner. If omitted, no user account is created. |
| `SEED_OWNER_PASSWORD` | Password for the initial owner. Must satisfy the password policy (≥10 chars, upper, lower, digit, symbol). |
| `SEED_OWNER_FIRST_NAME` / `SEED_OWNER_LAST_NAME` | Optional display name (defaults: `System` / `Owner`). |
| `SEED_DEMO` | `true` seeds demo CRM/finance data (development only). |

> There is deliberately **no default admin account**. A first owner only exists
> when both `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` are supplied.

## Password policy (server-enforced)

- at least 10 characters
- at least one uppercase letter
- at least one lowercase letter
- at least one digit
- at least one symbol

The frontend mirrors this in `frontend/src/lib/validation.ts`, but the server
re-validates on every set/reset/change.

## What never goes into an environment file

- Client-visible secrets: Discord webhook URLs are stored server-side only and
  returned masked (`hasWebhook`, `maskedUrl`).
- Database root credentials (the app uses a least-privilege user).
- TLS private keys (they stay in `/etc/letsencrypt/live/<domain>/`).
