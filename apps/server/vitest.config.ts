import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-database.ts';
import { TEST_ENV } from './test/test-env.ts';

// Tests that care about one value override it with vi.stubEnv.
const testEnv = {
  ...TEST_ENV,
  // Tests use their own database next to the dev one (nitpilot_test), so a test run never
  // empties your dev data. test/global-setup.ts creates and migrates it.
  ...(process.env.DATABASE_URL ? { DATABASE_URL: testDatabaseUrl(process.env.DATABASE_URL) } : {}),
};

export default defineConfig({
  test: {
    env: testEnv,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}', 'test/*.test.ts', 'test/fixtures/**/*.test.ts'], exclude: ['**/*.db.test.{ts,tsx}'] },
      },
      {
        // Real Postgres. Files run one at a time; tests use unique data (see test/db.ts).
        extends: true,
        test: {
          name: 'db',
          include: ['src/**/*.db.test.{ts,tsx}', 'test/**/*.db.test.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
          globalSetup: ['./test/global-setup.ts'],
        },
      },
      {
        // Plan 1 end to end (spec §19): the server, two CLIs and the fake agent. Slower, so it runs on its own
        // (npm run test:e2e), against the same test database.
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.test.ts'],
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 30_000,
          globalSetup: ['./test/global-setup.ts'],
        },
      },
    ],
  },
});
