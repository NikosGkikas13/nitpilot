import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// The demo recording: the e2e servers, one spec, a video of every page.
export default defineConfig({
  ...base,
  testDir: '.',
  timeout: 5 * 60_000,
  reporter: 'list',
  outputDir: './out',
  webServer: (base.webServer as { command: string; cwd: string }[]).map((s) => ({ ...s, cwd: '../../..' })),
  projects: [
    {
      name: 'demo',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        video: { mode: 'on', size: { width: 1440, height: 900 } },
      },
    },
  ],
});
