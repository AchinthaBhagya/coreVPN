#!/usr/bin/env node
/**
 * Creates/updates the schema of the dedicated test database.
 *
 * `npm test` (vitest) runs against `3xcode_db_test` — derived from the
 * `DATABASE_URL` in backend/.env by swapping the database name — so the
 * development database is never touched. Run this once before the first test
 * run (and again after changing schema.prisma):
 *
 *   npm run test:db:setup
 *
 * Override the target with TEST_DATABASE_URL. A non-local TEST_DATABASE_URL is
 * only accepted when it explicitly names a database ending in `_test`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(backendDir, '.env') });

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('backend/.env must define DATABASE_URL.');
  process.exit(1);
}

const database = process.env.TEST_DATABASE_NAME || '3xcode_db_test';
const url = process.env.TEST_DATABASE_URL || raw.replace(/\/([^/?#]+)(?=[?#]|$)/, `/${database}`);

if (!/_test(\?|$)/.test(url)) {
  console.error(`Refusing to prepare "${url}": the database name must end in _test.`);
  process.exit(1);
}

console.log(`Preparing test database schema: ${url.replace(/:[^:@/]+@/, ':***@')}`);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  cwd: backendDir,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
