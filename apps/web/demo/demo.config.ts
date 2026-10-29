import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// The demo recordings: the e2e servers, a video of every page. `demo` is the captioned walkthrough; `hero-*` are the
// landing page's clip, one per theme. (Playwright records CSS pixels, so a deviceScaleFactor of 2 wouldn't sharpen it.)
const hero = { browserName: 'chromium' as const, viewport: { width: 1440, height: 760 }, video: { mode: 'on' as const, size: { width: 1440, height: 760 } } };

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
      testMatch: 'demo.spec.ts',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        video: { mode: 'on', size: { width: 1440, height: 900 } },
      },
    },
    { name: 'hero-light', testMatch: 'hero.spec.ts', use: { ...hero, colorScheme: 'light' } },
    { name: 'hero-dark', testMatch: 'hero.spec.ts', use: { ...hero, colorScheme: 'dark' } },
  ],
});
