# 3xCodz Management System

A production-oriented business management platform for a software / digital
services company: CRM, quotations, orders, projects, tasks, time tracking,
invoicing, payments, refunds, expenses, profit allocation, earnings and payouts,
support tickets, reporting, a client portal, and Discord notifications — behind a
role-based permission model with a premium glassmorphism UI.

- **Frontend** — React 18, TypeScript, Vite, Tailwind CSS, shadcn-style UI
  primitives, Framer Motion, Lucide icons, Recharts, React Hook Form + Zod,
  TanStack Query
- **Backend** — Node.js, TypeScript, Express (REST), Prisma ORM, MySQL 8, Zod
  validation, opaque cookie sessions, audit logging, background scheduler
- **Deployment** — Ubuntu 24.04 LTS, Nginx, PM2, Let's Encrypt, MySQL bound to
  loopback only

---

## Repository layout

```
.
├── backend/                 # Express API + Prisma schema, migrations, seed
│   ├── prisma/
│   │   ├── schema.prisma    # authoritative data model
│   │   ├── migrations/      # committed SQL migrations
│   │   └── seed.ts          # permissions, role templates, owner, demo data
│   └── src/
│       ├── config/          # env, logger, permissions catalogue
│       ├── middleware/      # auth, CSRF, validation, rate limiting, errors
│       ├── routes/          # one router per module (REST endpoints)
│       ├── services/        # PDFs, email, Discord, notifications, sessions
│       ├── jobs/            # in-process scheduler + background jobs
│       └── tests/           # vitest + supertest suites
├── frontend/                # Vite React SPA
│   └── src/
│       ├── components/      # ui/ primitives, layout/, common/
│       ├── context/         # auth + theme providers
│       ├── hooks/           # data-fetching and UI hooks
│       ├── lib/             # api client, formatting, validation, helpers
│       ├── pages/           # one folder per module (+ portal/)
│       └── types/           # shared response types
├── deployment/
│   ├── nginx/3xcode.conf    # hardened TLS site config
│   ├── pm2/ecosystem.config.js
│   └── scripts/             # setup-ubuntu.sh, deploy.sh, backup.sh, restore.sh
├── docs/
│   ├── DEPLOYMENT.md        # Linode runbook (manual + automated)
│   ├── ENVIRONMENT.md       # every environment variable
│   ├── OPERATIONS.md        # backups, migrations, jobs, incident response
│   ├── SECURITY.md          # authorization, CSRF, files, secrets model
│   ├── TESTING.md           # how to run and extend the test suites
│   └── IMPLEMENTED.md       # implemented-vs-remaining checklist
└── .env.example             # canonical env template (placeholders only)
```

---

## Quick start (local development)

### Prerequisites

- Node.js 20+ (24 tested), npm 10+
- MySQL 8 (local instance is fine)
- Git

### 1. Install dependencies

The repository is an npm workspace; install once from the root:

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example backend/.env
```

Edit `backend/.env` and set at least `DATABASE_URL` (and
`SHADOW_DATABASE_URL` if you will run `prisma migrate dev`). See
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for every variable.

### 3. Create the schema and seed

```bash
cd backend
npx prisma migrate deploy     # or: npx prisma migrate dev
```

Install permissions and role templates (safe to re-run), plus the initial owner
account — there is **no default password**:

```bash
SEED_OWNER_EMAIL="you@company.com" \
SEED_OWNER_PASSWORD="A-strong-passphrase-2026!" \
npm run db:seed
```

- Omit `SEED_OWNER_*` and the seed installs roles/permissions only.
- `SEED_DEMO=true` additionally inserts demo clients/services/projects.
  Never enable it in production.

### 4. Run both apps

```bash
npm run dev            # API on :5000, SPA on :5173 (Vite proxies /api)
```

Sign in at <http://localhost:5173> with the owner credentials you seeded.

---

## Root scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API and the Vite dev server together |
| `npm run build` | Type-checks and builds the SPA, then compiles the API to `backend/dist` |
| `npm run typecheck` | `tsc --noEmit` for both workspaces |
| `npm run lint` | ESLint for both workspaces |
| `npm test` | Frontend unit tests (vitest) + backend API tests (vitest + supertest) |

### Backend scripts (`cd backend`)

| Command | What it does |
| --- | --- |
| `npm run dev` | `tsx watch src/server.ts` |
| `npm run build` / `npm start` | Compile to `dist/` and run the compiled server |
| `npm run db:migrate` | `prisma migrate dev` (create/apply a migration) |
| `npm run db:migrate:deploy` | Apply committed migrations (production) |
| `npm run db:seed` | Permissions, roles, optional owner + demo data |
| `npm run db:studio` | Prisma Studio |
| `npm test` | Vitest integration/unit suites (`vitest run`) |

> Backend tests need the extra test database described in
> [docs/TESTING.md](docs/TESTING.md). They never touch your development
> database — the test setup refuses to run against anything else.

---

## How the app is structured

- **Authentication** — email + password, bcrypt hashes, opaque random session
  tokens stored hashed in MySQL, delivered in an HTTP-only `sid` cookie. There
  is no JWT and no client-side session storage.
- **Authorization** — 96 fine-grained permissions grouped by module, checked on
  the server for every endpoint (`requirePermission('module.action')`). Role
  templates ship with the seed; custom roles are arbitrary permission subsets.
  Client portal accounts (`role.type = CLIENT`) are always scoped to their own
  client record, and out-of-scope records return **404**, never 403.
- **Money** — `DECIMAL(15,2)` columns, a currency code per record (default
  `LKR`), and no floating-point arithmetic on stored values. Invoiced revenue,
  cash received, expenses, refunds and allocations are separate records;
  profit is never reported as revenue. Quotation drafts are not revenue, and
  completing a project never marks an invoice paid.
- **Profit allocation** — rules are configured per project (no hardcoded
  splits), versioned, previewable, and reconciled exactly to the distributable
  amount when applied. Accrued entitlement and actual payout are distinct
  records.
- **Files** — stored outside the web root under randomized names, downloaded
  only through permission-checked endpoints; SVG/HTML/executables are rejected.
- **Notifications** — Discord webhooks live server-side only, are masked in the
  API/UI, can be tested per event, retry with backoff, and never perform
  financial actions.

Details: [docs/SECURITY.md](docs/SECURITY.md).

---

## Deployment

Full runbooks (automated provisioning script and a manual step-by-step) are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short, on a fresh Ubuntu 24.04
Linode:

```bash
sudo DOMAIN=yourdomain.com GIT_REPO=https://github.com/you/3xcode-management.git \
  bash deployment/scripts/setup-ubuntu.sh
```

The script installs Node/MySQL/Nginx/PM2, binds MySQL to loopback, generates
credentials (written to `/root/3xcode-credentials.txt`, mode 600), builds the
apps, starts PM2 behind Nginx, and issues a Let's Encrypt certificate. Then seed
the owner account and read the post-deploy checklist.

- Day-to-day operations: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- Environment variables: [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)
- Testing: [docs/TESTING.md](docs/TESTING.md)

---

## Status

See [docs/IMPLEMENTED.md](docs/IMPLEMENTED.md) for the implemented-vs-remaining
checklist, including the modules, endpoints, tests, and deployment assets that
exist today.
