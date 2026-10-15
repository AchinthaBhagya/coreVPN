# Testing

Everything in this document has been **actually run** in the development
environment; the numbers below are real, not aspirational.

## Stack

| Layer | Tooling |
| --- | --- |
| Backend tests | Vitest 2 + Supertest, against a real MySQL database |
| Frontend tests | Vitest 2 + jsdom + React Testing Library + jest-dom matchers |
| Quality gates | `tsc --noEmit` (both workspaces), ESLint 9 (flat config), production builds |

There is **no mocked database**: backend integration tests create, read and
update real rows in a dedicated `*_test` database through the same Prisma
client the app uses.

## Test databases

Backend tests never touch the development database.

- The target URL is derived from `DATABASE_URL` in `backend/.env` by swapping
  the database name for `3xcode_db_test`.
- A `TEST_DATABASE_URL` environment variable overrides the derivation.
- Safety rails (in `src/tests/setup.ts` and `scripts/test-db.mjs`):
  - the database name must contain `3xcode_db_test`, otherwise the run refuses
    to start;
  - a non-local host is rejected unless `TEST_DATABASE_URL` is set explicitly;
  - uploads are redirected to a temp directory, `SEED_DEMO=false`, bcrypt cost
    dropped to 4, `NODE_ENV=test` (rate limits off, cookies non-secure, CSRF
    **still active**).

Provision the schema once (and again after editing `schema.prisma`):

```bash
npm run test:db:setup --workspace backend
```

Test files are self-contained: each file's `beforeAll` runs `resetDatabase()`
plus the permission/role catalogue seed, so files can run in any order. Vitest
is configured with `fileParallelism: false`, so a single run is strictly
sequential on one database.

**Running two vitest processes at once** (optional, used during development to
speed things up) requires two databases:

```bash
# terminal 1
TEST_DATABASE_URL="mysql://…/3xcode_db_test_a" npx vitest run src/tests/auth.test.ts
# terminal 2
TEST_DATABASE_URL="mysql://…/3xcode_db_test_b" npx vitest run src/tests/invoices.test.ts
```

Provision them with `TEST_DATABASE_NAME=3xcode_db_test_a npm run test:db:setup --workspace backend`
(and `_b`). Only databases named `*_test*` are accepted.

## Commands

```bash
# everything (frontend suite, then backend suite)
npm test

# per workspace
npm run test:frontend
npm run test:backend

# watch mode / single file
npm run test:watch --workspace frontend
npm run test:watch --workspace backend
cd backend && npx vitest run src/tests/invoices.test.ts

# quality gates
npm run typecheck     # tsc in both workspaces (frontend: tsconfig.app + tsconfig.node)
npm run lint          # eslint in both workspaces
npm run build         # vite build (tsc -b first) + tsc for the backend
```

> **Windows note:** use `npm.cmd` / `npx.cmd` from PowerShell, and set
> `TEST_DATABASE_URL` with `$env:TEST_DATABASE_URL="…"`.

## Backend suite — 11 files, 121 tests (all passing)

| File | Tests | Covers |
| --- | ---: | --- |
| `smoke.test.ts` | 7 | CSRF origin/token rejections, unknown login 401, password policy, 401 without session, HttpOnly `sid`, logout revokes the session |
| `auth.test.ts` | 16 | Login/logout/refresh flow, enumeration-safe errors, password reset round trip, session invalidation, account status gates |
| `permissions.test.ts` | 6 | Permission catalogue shape, role templates, granting/revoking, endpoint gating by permission |
| `isolation.test.ts` | 7 | Portal user reading another client's invoice/project/ticket/quotation → **404** (never 403), staff-only endpoints reject portal accounts, list scoping |
| `attachments.test.ts` | 11 | Extension blocklist (`.svg`/`.exe`), MIME allow-list, randomized storage names, path traversal blocked, client visibility rules, authenticated download |
| `csrf.unit.test.ts` | 8 | CSRF middleware in isolation: exempt paths still Origin-checked, token mismatch, double-submit behaviour, Bearer exemption |
| `secrets.test.ts` | 9 | Discord webhook secrets masked on every endpoint, masked value not replayable, `User.password` / `Session.token` never serialized |
| `invoices.test.ts` | 15 | Invoice CRUD, totals, status transitions, draft-only edit/delete, invalid status rejected, issue/void, 404s |
| `money-flow.test.ts` | 9 | Payments vs invoices, over-payment refusal, **refund ≤ cash received**, refunds reduce `amountPaid` without going negative, finance summary KPIs |
| `allocations.test.ts` | 11 | Rules with arbitrary 100% splits, percentage sum enforcement, version immutability, preview/commit, earnings approval, payouts, **self-approval refused**, permission gates |
| `reports.test.ts` | 22 | Dashboard KPIs, cash-flow (inflow/outflow/refunds) reconciling with the dashboard, receivables aging, client history, per-endpoint permission gates |

**Result of the final run:** `Test Files 11 passed (11) · Tests 121 passed (121)`.

## Frontend suite — 7 files, 73 tests (all passing)

| File | Tests | Covers |
| --- | ---: | --- |
| `lib/__tests__/format.test.ts` | 21 | Currency formatting (LKR default), decimal-string money with no float drift, dates, `toNumber`, `formatBytes`, `humanize`, `initials`, `clientDisplayName` |
| `lib/__tests__/validation.test.ts` | 11 | Password policy mirror of `backend/src/utils/password.ts`, `currencyValue` |
| `lib/__tests__/status.test.ts` | 7 | Every value of every domain enum has a tone + label; unknown/null degrade safely |
| `lib/__tests__/errors.test.ts` | 10 | `errorMessage`/`fieldErrors`, toast helpers |
| `lib/__tests__/api.test.ts` | 15 | CSRF header echo, `credentials: include`, response envelope, 204, query building, JSON vs FormData bodies, typed `ApiError` (401 event, 422 fields, network status 0), CSRF bootstrap, `downloadBlob` |
| `lib/__tests__/queryClient.test.ts` | 3 | staleTime/gcTime, no focus refetch, retry policy |
| `components/common/__tests__/StatusBadge.test.tsx` | 6 | Props, tone→class mapping, explicit label, null rendering |

**Result of the final run:** `Test Files 7 passed (7) · Tests 73 passed (73)`.

## Quality gates (final state)

| Gate | Command | Result |
| --- | --- | --- |
| Backend typecheck | `npm run typecheck --workspace backend` | 0 errors |
| Frontend typecheck | `tsc --noEmit -p tsconfig.app.json` + `-p tsconfig.node.json` | 0 errors |
| Backend lint | `npm run lint --workspace backend` | 0 errors, 0 warnings |
| Frontend lint | `npm run lint --workspace frontend` | 0 errors, 9 warnings (react-refresh/fast-refresh hints in shadcn primitives + 2 `exhaustive-deps` hints) |
| Frontend build | `npm run build --workspace frontend` | success (Vite warns the main chunks exceed 500 kB — see `docs/IMPLEMENTED.md`) |
| Backend build | `npm run build --workspace backend` | success |

The frontend `typecheck` script runs `tsc --noEmit` against **both**
`tsconfig.app.json` and `tsconfig.node.json` — the root `tsconfig.json` only
holds project references, so a bare `tsc --noEmit` there would be a no-op.

## What is *not* automated (honest list)

- **No browser/E2E automation.** There is no Playwright/Cypress suite; the
  interactive verification is a manual smoke test of every module (documented
  in `docs/IMPLEMENTED.md`). E2E is listed as remaining work.
- **No live SMTP delivery test.** `emailService` is exercised indirectly
  (password-reset request, invoice/quotation send endpoints). With SMTP
  unconfigured it degrades to a log line and returns `false`; no test asserts
  against a real mail server.
- **No live Discord delivery test.** Webhook masking, retry/failure logging and
  dedupe are implemented and the masking is tested (`secrets.test.ts`), but no
  test performs a real outbound HTTP call to Discord, and the retry loop itself
  has no dedicated unit test.
- **No Nginx/PM2/TLS tests.** Deployment artefacts are reviewed, not executed,
  on this machine — they run on the target Ubuntu VPS (`docs/DEPLOYMENT.md`).
- **No load/performance testing**, no cross-browser matrix, no visual
  regression tests.
