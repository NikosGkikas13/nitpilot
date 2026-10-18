/**
 * The server the Playwright tests in apps/web/e2e talk to: Plan 1's end-to-end harness (the real server with
 * FakePlatform, Postgres and fake-agent CLIs) on a fixed port, serving the built web app, plus a small
 * control API on a second port that only the tests use (sign someone in, and later: send webhooks, read
 * state). Playwright starts it (apps/web/playwright.config.ts); it is never imported by src/.
 *
 * Push is on, with the env's VAPID keys or a pair made at start, so the web app offers it. No test sends a real push:
 * sends are recorded and answered as delivered. Only `E2E_REAL_PUSH=1` (the live step in desktop Chrome, by hand)
 * sends to the browser's real push service.
 *
 * Run by hand: E2E_WEB_PORT=4319 E2E_CONTROL_PORT=4320 npm run e2e:web-server -w apps/server
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import webpush from 'web-push';
import type { PushSend } from '../../src/tasks/web-push-send';
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
const { notificationText } = await import('../../src/tasks/handlers/notify');
const { webPushSend } = await import('../../src/tasks/web-push-send');

// The VAPID keys: the env's if it has all three, else a pair made now (any pair works for a test run).
const env = process.env;
const vapid =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
    : { subject: 'mailto:e2e@example.com', ...webpush.generateVAPIDKeys() };
/** Every push the server would have sent, in order. */
const pushes: { endpoint: string; payload: string }[] = [];
const recordPush: PushSend = async (target, payload) => {
  pushes.push({ endpoint: target.endpoint, payload });
  return { ok: true };
};
const realPush = env.E2E_REAL_PUSH === '1';

const e2e = await startE2e({
  port: webPort,
  webDistDir: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  github: new GithubClient(fakeFetch({ 'GET /repos/octo/sandbox': () => ({ id: 1 }) })),
  push: { vapidPublicKey: vapid.publicKey, send: realPush ? webPushSend(vapid) : recordPush },
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
  e2e.github.addPull(number, `feature-${number}`);
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
/**
 * Forget every PR: the tests share this server and its database, so each test that opens PRs starts here.
 * People, their sign-ins and the installation stay; their Settings go back to the defaults.
 */
control.post('/reset', async (c) => {
  await prisma.$executeRawUnsafe('TRUNCATE "Task", "RawEvent", "SeenComment", "GithubWrite", "PrChat" CASCADE');
  await prisma.user.updateMany({ data: { autoReview: true, autoAddress: true } });
  return c.body(null, 204);
});
/**
 * Someone's defaults for new chats (their Settings page): with `autoReview` or `autoAddress` false, the PRs opened
 * after this start with that person's Auto off, so their agent's work waits as drafts.
 */
control.post('/settings', async (c) => {
  const { login, autoReview, autoAddress } = (await c.req.json()) as { login: 'maya' | 'leo'; autoReview?: boolean; autoAddress?: boolean };
  const user = e2e.users[login];
  if (!user) return c.json({ error: `no test user "${login}"` }, 400);
  await prisma.user.update({ where: { id: user.id }, data: { autoReview, autoAddress } });
  return c.body(null, 204);
});
/**
 * Tell someone they're needed, through the server's real notifier (push first, then their CLI), with a sample "Ready
 * for your approval" that opens the inbox. Answers who it reached and the pushes it recorded. The live step uses it,
 * with E2E_REAL_PUSH=1, to see a notification arrive in desktop Chrome.
 */
control.post('/notify', async (c) => {
  const { login } = (await c.req.json()) as { login: 'maya' | 'leo' };
  const user = e2e.users[login];
  if (!user) return c.json({ error: `no test user "${login}"` }, 400);
  const before = pushes.length;
  const { reached } = await e2e.notifier.notify({ userIds: [user.id], kind: 'ready', chatId: 'sample-notification', ...notificationText('ready', 'octo/sandbox#1', []), url: `${e2e.url}/` });
  return c.json({ reached: reached.map(() => login), recorded: pushes.slice(before) });
});
/** Each person's running CLI, started by a test. */
const clis = new Map<string, Awaited<ReturnType<typeof e2e.startCli>>>();
/** Start someone's `nitpilot start` on the fake agent, with a scenario from apps/cli/src/agents/fake/scenarios. */
control.post('/cli', async (c) => {
  const { login, scenario } = (await c.req.json()) as { login: 'maya' | 'leo'; scenario?: string };
  if (!clis.has(login)) clis.set(login, await e2e.startCli(login, scenario));
  return c.body(null, 204);
});
/** Stop it again, so the next test finds that person's agent offline. */
control.delete('/cli', async (c) => {
  const { login } = (await c.req.json()) as { login: 'maya' | 'leo' };
  await clis.get(login)?.stop();
  clis.delete(login);
  return c.body(null, 204);
});
serve({ fetch: control.fetch, port: controlPort, hostname: '127.0.0.1' });

console.log(`[web-e2e] app on ${e2e.url}, control API on http://127.0.0.1:${controlPort}${realPush ? ', sending real pushes' : ''}`);

const stop = async () => {
  await e2e.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
