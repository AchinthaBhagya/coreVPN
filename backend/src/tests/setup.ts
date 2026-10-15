import { afterAll } from 'vitest';
import path from 'path';
import { config } from 'dotenv';

/**
 * Runs before any application module is imported (vitest evaluates setupFiles
 * first), so `src/config/env.ts` picks these values up when it loads.
 */
const backendDir = path.resolve(__dirname, '../..');
config({ path: path.join(backendDir, '.env') });

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  throw new Error('backend/.env must define DATABASE_URL so tests can derive the test database URL.');
}

// Force the connection onto a database whose name ends in `_test`, regardless
// of what the development URL points at. Refuse to run against anything that
// does not look local unless TEST_DATABASE_URL is set explicitly.
const testUrl = process.env.TEST_DATABASE_URL ?? rawUrl.replace(/\/([^/?#]+)(?=[?#]|$)/, '/3xcode_db_test');
const hostPart = testUrl.split('@')[1] ?? '';
const host = (hostPart.split('/')[0] ?? '').split(':')[0];
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(host);
if (!process.env.TEST_DATABASE_URL && !isLocal) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL host "${host}" is not local. Set TEST_DATABASE_URL explicitly.`,
  );
}
if (!/3xcode_db_test/.test(testUrl)) {
  throw new Error(`Refusing to run tests: "${testUrl}" does not target a *_test database.`);
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
// Cheap hashing keeps login-heavy suites fast (policy is still exercised by
// utils/password tests which do not depend on the cost factor).
process.env.BCRYPT_ROUNDS = '4';
process.env.SEED_DEMO = 'false';
// Keep uploads inside a scratch directory so tests never touch dev uploads.
process.env.UPLOAD_DIR = path.join(process.env.TEMP ?? '/tmp', '3xcode-test-uploads');

afterAll(async () => {
  const { prisma } = await import('../config/prisma');
  await prisma.$disconnect();
});
