import type { Hono } from 'hono';
import { createFirstRunApp } from '../http/app';
import type { Env } from '../lib/env';
import type { GithubClient } from '../platform/github/client';
import { makeSetupCode } from './setup-code';

/**
 * Get a server with no GitHub App ready for its first run (main.ts serves the app this returns): make a setup code and
 * print it, so only someone who can read the server's log (`docker compose logs nitpilot`) can create the app.
 * `exit` runs once the app is stored. See docs/why/first-run-and-app-manifests.md.
 */
export function startFirstRun(opts: { env: Env; github: GithubClient; exit: () => void; log?: (line: string) => void }): { app: Hono } {
  const log = opts.log ?? console.log;
  const publicUrl = opts.env.PUBLIC_URL.replace(/\/+$/, '');
  const setupCode = makeSetupCode();
  log(`[first-run] Open ${publicUrl}/first-run and enter the setup code: ${setupCode}`);
  const app = createFirstRunApp({ github: opts.github, publicUrl, setupCode, trustProxy: opts.env.TRUST_PROXY, exit: opts.exit });
  return { app };
}
