import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, CONTROL_PORT, FIRST_RUN_BASE_URL, FIRST_RUN_CONTROL_PORT, FIRST_RUN_WEB_PORT, WEB_PORT } from './e2e/ports';

export default defineConfig({
  testDir: './e2e',
  // One server and one database for every test, so one test at a time.
  workers: 1,
  // A failure is a finding, not something to try again: a flaky test gets fixed at its cause.
  retries: 0,
  // A `test.only` left in by mistake fails CI instead of quietly running that one test.
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The servers for these tests: apps/server/test/e2e/web-server.ts for every spec, and first-run-server.ts (a server
  // with no GitHub App yet) for first-run.spec.ts, which points its baseURL there. They start side by side.
  webServer: [
    {
      command: 'npm run e2e:web-server -w apps/server',
      cwd: '../..',
      url: `${BASE_URL}/healthz`,
      env: { E2E_WEB_PORT: String(WEB_PORT), E2E_CONTROL_PORT: String(CONTROL_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run e2e:first-run-server -w apps/server',
      cwd: '../..',
      url: `${FIRST_RUN_BASE_URL}/healthz`,
      env: { E2E_FIRST_RUN_WEB_PORT: String(FIRST_RUN_WEB_PORT), E2E_FIRST_RUN_CONTROL_PORT: String(FIRST_RUN_CONTROL_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
