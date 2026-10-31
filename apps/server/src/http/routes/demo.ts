import type { DemoResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { clientAddress } from '../../lib/client-address';
import { isAllowedOrigin } from '../../lib/csrf';
import { getEnv, type DemoConfig } from '../../lib/env';
import { RateLimiter } from '../../lib/rate-limit';
import { transcriptUrl } from '../../lib/urls';
import { GithubError, type GithubClient } from '../../platform/github/client';
import { HttpError } from '../errors';

/**
 * The public playground's "Run a demo" button (Plan 4 G4, docs/why/acting-as-a-bot.md). The server opens a PR in the
 * playground repo as the author bot, with its token; the repo's CODEOWNERS asks the reviewer bot, and from there it's
 * an ordinary Nitpilot PR: the two bots' CLIs (fake agent) review, fix and re-review it on the public chat page.
 * This file is the server's only demo code. GitHub is the record of which demos are running: no table of our own.
 */

/** A demo PR stays open this long; then `closeOldDemos` closes it and deletes its branch. */
export const DEMO_LIFETIME_MS = 60 * 60_000;
/** Each run gets a fresh branch under this prefix, copied from one of the repo's `demo/*` templates. */
export const DEMO_RUN_PREFIX = 'demo-run/';
/** One address may ask for this many demos an hour: each ask costs GitHub calls on the bot's allowance. */
export const DEMOS_PER_HOUR = 10;

type OpenPull = { number: number; created_at: string; head: { ref: string; repo: { full_name: string } | null } };
type Ref = { ref: string; object: { sha: string } };

/** The repo's open demo PRs: the bot's own `demo-run/*` branches, never a stranger's fork that happens to use the name. */
async function openDemoPulls(github: GithubClient, demo: DemoConfig): Promise<OpenPull[]> {
  const pulls = await github.apiAllPages<OpenPull[], OpenPull>(`/repos/${demo.repo}/pulls?state=open&per_page=100`, (page) => page, { token: demo.token });
  return pulls.filter((p) => p.head.ref.startsWith(DEMO_RUN_PREFIX) && p.head.repo?.full_name === demo.repo);
}

/**
 * The demo PR running now (younger than an hour), or a new one: a fresh `demo-run/<time>` branch pointing at a random
 * `demo/*` template's commit, so the author bot's fixes land on the copy and the template stays as it was.
 */
async function currentOrNewDemo(github: GithubClient, demo: DemoConfig, now: number, random: () => number): Promise<number> {
  const running = (await openDemoPulls(github, demo)).find((p) => now - Date.parse(p.created_at) < DEMO_LIFETIME_MS);
  if (running) return running.number;

  const { data: templates } = await github.api<Ref[]>('GET', `/repos/${demo.repo}/git/matching-refs/heads/demo/`, { token: demo.token });
  const template = templates[Math.floor(random() * templates.length)];
  if (!template) throw new HttpError('github_unavailable', `The playground repo ${demo.repo} has no demo/* branches.`);
  const name = template.ref.replace('refs/heads/demo/', '');
  const branch = `${DEMO_RUN_PREFIX}${name}-${now}`;
  await github.api('POST', `/repos/${demo.repo}/git/refs`, { token: demo.token, body: { ref: `refs/heads/${branch}`, sha: template.object.sha } });
  const { data: pull } = await github.api<{ number: number }>('POST', `/repos/${demo.repo}/pulls`, {
    token: demo.token,
    body: {
      title: `Demo: ${name}`,
      head: branch,
      base: 'main',
      body: 'Opened by the **Run a demo** button. Two bots review, fix and re-review it with the fake agent (no real AI). It closes on its own after an hour.',
    },
  });
  return pull.number;
}

export function demoRoutes(deps: {
  github: GithubClient;
  /** Null: the demo is off and there's no route (a 404, like any unknown path). */
  demo: DemoConfig | null;
  trustProxy?: boolean;
  now?: () => number;
  random?: () => number;
}): Hono {
  const app = new Hono();
  const { demo } = deps;
  if (!demo) return app;
  const now = deps.now ?? Date.now;
  const asks = new RateLimiter(DEMOS_PER_HOUR, 60 * 60_000, now);
  // Two clicks at once share one GitHub round, so they can't both open a PR.
  let inFlight: Promise<number> | null = null;

  app.post('/api/demo', async (c) => {
    if (!isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
    if (!asks.allow(clientAddress(c, deps.trustProxy ?? false))) throw new HttpError('rate_limited', 'Too many demos from here. Try again in an hour.');
    inFlight ??= currentOrNewDemo(deps.github, demo, now(), deps.random ?? Math.random).finally(() => (inFlight = null));
    try {
      const body: DemoResponse = { url: transcriptUrl(demo.repo, await inFlight) };
      return c.json(body);
    } catch (err) {
      if (!(err instanceof GithubError)) throw err;
      // The message names the call and its status, never the token.
      console.error('[demo]', err.message);
      throw new HttpError('github_unavailable', `GitHub didn't let us open the demo PR (${err.status}). Try again in a minute.`);
    }
  });

  return app;
}

/**
 * Close the demo PRs older than an hour and delete their branches (the in-process ticker in main.ts calls it).
 * Returns how many it closed. A branch that's already gone is fine.
 */
export async function closeOldDemos(github: GithubClient, demo: DemoConfig, now = Date.now()): Promise<number> {
  const old = (await openDemoPulls(github, demo)).filter((p) => now - Date.parse(p.created_at) >= DEMO_LIFETIME_MS);
  for (const pull of old) {
    await github.api('PATCH', `/repos/${demo.repo}/pulls/${pull.number}`, { token: demo.token, body: { state: 'closed' } });
    try {
      await github.api('DELETE', `/repos/${demo.repo}/git/refs/heads/${pull.head.ref}`, { token: demo.token });
    } catch (err) {
      if (!(err instanceof GithubError && err.status === 422)) throw err;
    }
  }
  return old.length;
}
