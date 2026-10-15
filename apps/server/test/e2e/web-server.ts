/**
 * The server the Playwright tests in apps/web/e2e talk to: Plan 1's end-to-end harness (the real server with
 * FakePlatform, Postgres and fake-agent CLIs) on a fixed port, serving the built web app, plus a small
 * control API on a second port that only the tests use (sign someone in, and later: send webhooks, read
 * state). Playwright starts it (apps/web/playwright.config.ts); it is never imported by src/.
 *
 * Run by hand: E2E_WEB_PORT=4319 E2E_CONTROL_PORT=4320 npm run e2e:web-server -w apps/server
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import setupTestDatabase from '../global-setup';
import { testDatabaseUrl } from '../test-database';
import { TEST_ENV } from '../test-env';

const webPort = Number(process.env.E2E_WEB_PORT);
const controlPort = Number(process.env.E2E_CONTROL_PORT);
if (!webPort || !controlPort) throw new Error('Set E2E_WEB_PORT and E2E_CONTROL_PORT (apps/web/playwright.config.ts does).');

// The test database, created and migrated as Vitest's global setup does (it reads the dev DATABASE_URL).
await setupTestDatabase();
const devUrl = process.env.DATABASE_URL!;
// Then the environment the server reads. The page and its API are on this origin.
Object.assign(process.env, TEST_ENV, { PUBLIC_URL: `http://127.0.0.1:${webPort}`, DATABASE_URL: testDatabaseUrl(devUrl) });

// Only now load the server's modules: the database client reads DATABASE_URL when it's first imported.
const { startE2e } = await import('./harness');
const { sessionCookieFor } = await import('../http');
const { people, prEvent, pull } = await import('../fixtures/github');
const { fakeFetch } = await import('../fake-fetch');
const { encrypt } = await import('../../src/lib/crypto');
const { prisma } = await import('../../src/lib/prisma');
const { GithubClient } = await import('../../src/platform/github/client');

const e2e = await startE2e({
  port: webPort,
  webDistDir: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  github: new GithubClient(fakeFetch({ 'GET /repos/octo/sandbox': () => ({ id: 1 }) })),
});
// The inbox asks GitHub whether each person can read a repo, so the test users need a GitHub sign-in on file.
const later = new Date(Date.now() + 365 * 86_400_000);
for (const user of Object.values(e2e.users)) {
  await prisma.githubAuth.create({ data: { userId: user.id, accessTokenEnc: encrypt(`ghu_${user.id}`), accessExpiresAt: later, refreshTokenEnc: encrypt('ghr_x'), refreshExpiresAt: later, status: 'ok' } });
}

const control = new Hono();
/** Sign someone in: answers the session cookie for the browser to use. */
control.post('/signin', async (c) => {
  const { login } = (await c.req.json()) as { login: 'maya' | 'leo' };
  const user = e2e.users[login];
  if (!user) return c.json({ error: `no test user "${login}"` }, 400);
  const [name, value] = (await sessionCookieFor(user.id)).split('=') as [string, string];
  return c.json({ name, value });
});
/** Open a PR on octo/sandbox, as GitHub's webhook would: `author`'s PR, with `reviewer` requested. */
control.post('/pr', async (c) => {
  const { number, title, author, reviewer } = (await c.req.json()) as { number: number; title: string; author: 'maya' | 'leo'; reviewer: 'maya' | 'leo' };
  const base = pull();
  await e2e.deliver(
    'pull_request',
    prEvent('opened', {
      pull: {
        number,
        title,
        html_url: `https://github.com/${base.base.repo.full_name}/pull/${number}`,
        user: people[author],
        requested_reviewers: [people[reviewer]],
        head: { ...base.head, ref: `feature-${number}`, sha: e2e.github.headSha },
        base: { ...base.base, sha: e2e.github.baseSha },
      },
    }),
  );
  return c.body(null, 204);
});
serve({ fetch: control.fetch, port: controlPort, hostname: '127.0.0.1' });

console.log(`[web-e2e] app on ${e2e.url}, control API on http://127.0.0.1:${controlPort}`);

const stop = async () => {
  await e2e.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
