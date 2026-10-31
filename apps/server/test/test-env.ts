/**
 * Values the server reads from the environment, for every test run: Vitest (vitest.config.ts) and the
 * Playwright tests' server (test/e2e/web-server.ts). Tests that care about one override it.
 * DATABASE_URL isn't here: each runner points it at the test database (test/test-database.ts).
 */
export const TEST_ENV = {
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
  // Push off unless a test turns it on: a developer's .env with real keys (docs/acceptance/plan-2.md section 0) must not
  // leak into tests that expect none. Empty counts as not set.
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  VAPID_SUBJECT: '',
  // The demo is off unless a test turns it on (http/routes/demo.test.ts).
  DEMO_REPO: '',
  DEMO_AUTHOR_TOKEN: '',
};
