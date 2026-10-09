import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-database.ts';

// Values the server reads from the environment. Tests that care about one override it with vi.stubEnv.
const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:8787',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GITHUB_APP_ID: '12345',
  GITHUB_APP_SLUG: 'nitpilot-dev',
  GITHUB_APP_PRIVATE_KEY: 'tests-that-need-a-key-generate-one',
  GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
  PUBLIC_REPOS_ONLY: 'false',
  ALLOWED_LOGINS: '',
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
        test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}'], exclude: ['**/*.db.test.{ts,tsx}'] },
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
    ],
  },
});
