import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// The demo recordings: the e2e servers, a video of every page. `demo` is the captioned walkthrough; `hero-*` are the
// landing page's clip, one per theme, saved as 2x frames by hero.spec.ts itself (Playwright's video is 1x).
// A real 2x window, not deviceScaleFactor: Chrome sends emulated-scale screencast frames at 1x. No trace, which would take the screencast at 800px.
const hero = {
  browserName: 'chromium' as const,
  viewport: null,
  launchOptions: { args: ['--window-size=1440,760', '--force-device-scale-factor=2'] },
  trace: 'off' as const,
};

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
