# Security Model

How 3xCode Management System enforces security, and what an operator must know.

## 1. Core principle: the server decides

The UI hides what a user should not see; the **server** refuses it. Every
`/api` route except the five explicitly exempt paths requires:

1. a valid session cookie,
2. a valid CSRF token on writes,
3. an authenticated, `ACTIVE` user,
4. the exact permission(s) for that action,
5. scope checks (staff see their own data; clients see only their own
   organization).

Hiding a button is never treated as authorization.

## 2. Authentication

| Aspect | Implementation |
| --- | --- |
| Credential | Email + password |
| Hashing | bcryptjs, cost factor 12, unique salt per user |
| Session | Opaque random token (32 bytes, `crypto.randomBytes`) stored **hashed** with SHA-256 in `Session`; the raw token is never persisted |
| Transport | `sid` cookie: `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, `Path=/` |
| Expiry | Absolute lifetime of `SESSION_TTL_HOURS` (default 168h). `POST /auth/refresh` rotates the token; expired sessions are deleted on the next request |
| Logout | Deletes the server row (server-side revocation) and clears the cookie |
| Password change / reset | Revokes **all** other sessions for that user |

There is no JWT, no `localStorage` session, and no default admin password —
see the owner-init flow below.

### First owner (bootstrap)

There is **no default admin account and no default password**. The first owner
is created only by the seed, and only when the operator explicitly provides
credentials:

```
SEED_OWNER_EMAIL=you@company.com SEED_OWNER_PASSWORD="<strong-password>" npm run db:seed
```

If either variable is missing the seed logs that no owner was created and
still succeeds (roles/permissions are installed). If the password violates
the policy the seed **aborts with an error**. Re-running the command attaches
the Owner role to an existing user with that email rather than duplicating
it. Nothing secret is committed to the repository.

### Password policy (enforced on server and mirrored in the UI)

Minimum 10 characters containing upper-case, lower-case, digit, and symbol.
Reset tokens are single-use, random (32 bytes), stored hashed with SHA-256,
and expire after a fixed 60 minutes.

### Rate limiting & throttling

- `POST /auth/login` (and every other `/api` call) is rate-limited by
  `express-rate-limit` per IP: **10 authentication attempts per 15 minutes**
  (successful logins are not counted) and **1500 API requests per 15 minutes**
  generally, plus **20 password-reset requests per hour**.
- Failed responses never reveal whether the email exists (identical
  401 for unknown email and wrong password; unknown email still runs a
  bcrypt comparison to keep timing similar).
- All limits are disabled when `NODE_ENV=test` so the automated suite can run;
  this is asserted only for tests and never applies in production.

## 3. CSRF

Double-submit token:

- `GET /auth/csrf` issues a random `csrf` cookie (`SameSite=Lax`, readable by
  the SPA, **not** HttpOnly) and returns the same value.
- Every state-changing request (anything other than `GET`/`HEAD`/`OPTIONS`)
  must send `X-CSRF-Token` matching the cookie.
- State-changing requests must also carry an `Origin` (or `Referer`) that
  matches the configured `CORS_ORIGIN` allow-list, otherwise they are rejected
  with `403` before any handler runs.
- Requests authenticated with a `Bearer` header are skipped (non-browser
  clients); the app itself never uses Bearer auth, so this only affects
  scripted API usage.

Exempt paths (the only ones, because no session exists yet):
`POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
They still go through the Origin/Referer allow-list check. Session-bearing
routes additionally set `SameSite=Lax`, which browsers apply independently.

## 4. Authorization

96 fine-grained permissions (`backend/src/config/permissions.ts`) grouped into
16 modules, checked per route via `requirePermission('module.action')`.

Role templates map to permission sets; custom roles are arbitrary subsets.
Users with `role.type = 'CLIENT'` are portal accounts: they never receive
staff permissions and are always scoped to their own `clientId`.

### Scoping rules

- **Staff**: full read of permitted modules; mutations additionally require
  ownership where the record has `ownerId`/`assigneeId`, unless the user has
  the corresponding `.manage-all` permission (e.g. `projects.manage-all`,
  `tickets.manage-all`).
- **Clients** (portal): every query is filtered by `clientId`. A record that
  belongs to another client (or to staff-only data) is **not found**: the
  server returns `404`, never `403`, so foreign IDs cannot be probed.
  Attachments of foreign records follow the same rule.

Helpers live in `backend/src/routes/helpers.ts` (`assertClientScope`,
`sendList`, ownership guards).

## 5. Input validation & injection

- Every request body, query, and path param is parsed with **Zod** before it
  touches the database (`validateBody`, `validateQuery`, `validateParams`).
- All database access goes through **Prisma parameterized queries**; there is
  no string-built SQL anywhere.
- Unknown fields are stripped or rejected by schema defaults.
- Output is serialized centrally (`serialize()`), which drops password hashes,
  session tokens, webhook secrets, reset tokens, and converts `Decimal`/`Date`
  to plain strings.

## 6. Money safety

- All monetary columns are `DECIMAL(15,2)`; the API transports them as
  strings; no floating-point arithmetic is used for stored values.
- Every amount is paired with a currency code (`VARCHAR(3)`, default `LKR`).
- Calculation order: sum line items → round to 2 dp → apply percentage
  discounts/taxes → round → record. Server recomputes everything; client math
  is display only.
- Invoiced revenue, cash received, expenses, refunds, and allocations are
  separate records. Approving an allocation never mutates balances directly;
  it writes idempotent `Transaction` rows (`type: 'payout'`).

## 7. File handling

- Files are stored under `UPLOAD_DIR`, which must be **outside** the Nginx
  document root (the SPA is served from `frontend/dist`, uploads live in
  `backend/uploads`).
- Stored names are random (`crypto.randomBytes(16)` hex) plus the original
  extension; the original name is kept only as metadata.
- Downloads are served through an authenticated endpoint that re-checks
  permission **and** record scope on every request. There are no guessable
  public URLs.
- Allowed types: `jpg`, `jpeg`, `png`, `webp`, `gif`, `pdf`, `doc`, `docx`,
  `xls`, `xlsx`, `csv`, `txt`, `zip`, `log`, plus backend logs (`.log`, `.txt`,
  `.zip`, `.gz`) for system admins only. **No SVG, no HTML, no executables.**
- Extension must match the detected content type; size is capped by
  `MAX_FILE_SIZE_MB` (default 15) both by Express and Nginx
  (`client_max_body_size 20m`).
- Path resolution rejects anything that escapes the uploads root.

## 8. Headers, transport, CORS (Nginx)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- TLS via Let's Encrypt (certbot, auto-renewal hook reloads Nginx).
- CORS: single allowed origin (`CORS_ORIGIN`), credentials enabled, no `*`.
- Rate limiting in Nginx (per IP, `429` responses): `/api/auth/` is capped at
  **5 requests/minute with a burst of 20**, and `/api` at **20 req/s with a
  burst of 120**. Express applies its own counters on top (see §2).
- Static assets served with immutable caching; HTML is never cached long.
- ` server;` blocks are reserved for the ACME webroot only.

## 9. Secrets

- Never committed: `.env` is git-ignored; `.env.example` contains
  placeholders only.
- `DISCORD_WEBHOOK_URL` (and per-integration webhook URLs) exist **only** on
  the server. They are never returned by any API response and never shipped
  to the browser. The settings UI shows a masked value
  (`https://discord.com/api/webhooks/***…***`) plus a "configured" flag.
- Sessions do not depend on any signing secret. Revoke individually with
  logout / password change, or revoke everything by clearing the `Session`
  table (`docs/OPERATIONS.md` > Security incidents).
- The provisioning script writes generated credentials to
  `/root/3xcode-credentials.txt` (root-only, `chmod 600`).

## 10. Discord notifications

- Fired from server-side events only (invoice overdue, payment received,
  assignment, mention, ticket events, deployment).
- Per-event enable/disable, exponential backoff retry (3 attempts), failure
  rows in `NotificationDelivery`, dedupe key prevents double-sending.
- Delivery never performs financial actions.

## 11. Dependency & code hygiene

- `npm audit --omit=dev` is run before every release (see `docs/TESTING.md`);
  production installs use `--omit=dev` and `npm ci`.
- TypeScript runs with `strict`, `noUnusedLocals`, and `noUnusedParameters` on
  both packages; frontend ESLint reports `no-explicit-any` as a warning.
- The scheduler and cron jobs are idempotent (`BackgroundJob.dedupeKey`), so
  running one PM2 instance cannot double-process the same due item.

## 12. Reporting a vulnerability

Open a private issue or email the maintainers. Do not include live secrets,
customer data, or production credentials in the report.
