import { defineConfig } from 'vitest/config';

/**
 * Backend test configuration.
 *
 * Tests run against a dedicated MySQL database (`3xcode_db_test` by default,
 * derived from backend/.env in `src/tests/setup.ts`) so real development data
 * is never touched. Files run sequentially because they share that database.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,
  },
});
