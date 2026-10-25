/**
 * The server apps/web/e2e/first-run.spec.ts talks to: a server in first-run mode (no GitHub App in the environment or
 * its database), on a fixed port, serving the built web app. It runs next to web-server.ts (the normal-mode server
 * every other spec uses), with its own database, so neither disturbs the other.
 *
 * Its second port, on 127.0.0.1 only, is both the tests' control API and a stand-in for github.com: the first-run page
 * posts its manifest form there, and the stand-in records it and sends the browser straight back to the callback, as
 * GitHub does after "Create GitHub App". GitHub's API half (trading the code for the app) is a fake fetch.
 *
 * A real server exits after storing the app and Docker starts it again in normal mode. Here `exit` takes the server
 * "down" (every request answers 502, as Caddy does while the container restarts) until the test calls /restart, which
 * brings it back in ready mode, reading the app it stored. The test decides when, so "Restarting…" is always seen.
 *
 * Run by hand: E2E_FIRST_RUN_WEB_PORT=4321 E2E_FIRST_RUN_CONTROL_PORT=4322 npm run e2e:first-run-server -w apps/server
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import setupTestDatabase from '../global-setup';
import { testDatabaseUrl } from '../test-database';
import { TEST_ENV } from '../test-env';

const webPort = Number(process.env.E2E_FIRST_RUN_WEB_PORT);
const controlPort = Number(process.env.E2E_FIRST_RUN_CONTROL_PORT);
if (!webPort || !controlPort) throw new Error('Set E2E_FIRST_RUN_WEB_PORT and E2E_FIRST_RUN_CONTROL_PORT (apps/web/playwright.config.ts does).');

/** The code the server would print in its log; the spec types it. */
const SETUP_CODE = 'E2EF-RSTR';
const publicUrl = `http://127.0.0.1:${webPort}`;
/** Where "github.com" is for this server: the control port. */
const githubWeb = `http://127.0.0.1:${controlPort}`;

// A database of its own (nitpilot_test → nitpilot_first_run_test), created and migrated like the test one, so this
// server's stored app never meets web-server.ts's tables.
const firstRunUrl = testDatabaseUrl(process.env.DATABASE_URL!).replace(/_test(\?|$)/, '_first_run_test$1');
process.env.DATABASE_URL = firstRunUrl;
await setupTestDatabase();
// No GitHub App in the environment: blank, all six, is "not set" (lib/env.ts), which is what makes it first-run mode.
const noApp = { GITHUB_APP_ID: '', GITHUB_APP_SLUG: '', GITHUB_APP_PRIVATE_KEY: '', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', GITHUB_WEBHOOK_SECRET: '' };
Object.assign(process.env, TEST_ENV, noApp, { PUBLIC_URL: publicUrl, DATABASE_URL: firstRunUrl });

// Only now load the server's modules: the database client reads DATABASE_URL when it's first imported.
const { createFirstRunApp } = await import('../../src/http/app');
const { spaRoutes } = await import('../../src/http/spa');
const { getEnv } = await import('../../src/lib/env');
const { prisma } = await import('../../src/lib/prisma');
const { GithubClient } = await import('../../src/platform/github/client');
const { loadGithubApp, setGithubApp } = await import('../../src/setup/credentials');
const { readyRoutes } = await import('../../src/setup/first-run');
const { fakeFetch } = await import('../fake-fetch');

const webDistDir = fileURLToPath(new URL('../../../web/dist', import.meta.url));

/** The code the stand-in GitHub sends back, and what GitHub's API answers for it: the new app and its secrets. */
const GITHUB_CODE = 'e2e-manifest-code';
const NEW_APP_SLUG = 'nitpilot-e2e';
const github = new GithubClient(
  fakeFetch({
    [`POST /app-manifests/${GITHUB_CODE}/conversions`]: () => ({
      id: 777,
      slug: NEW_APP_SLUG,
      client_id: 'Iv23.e2e',
      client_secret: 'e2e-client-secret',
      webhook_secret: 'e2e-webhook-secret',
      pem: '-----BEGIN RSA PRIVATE KEY-----\ne2e\n-----END RSA PRIVATE KEY-----\n',
      owner: { login: 'maya' },
    }),
  }),
  'https://api.github.com',
  githubWeb,
);

type Handler = (req: Request) => Response | Promise<Response>;

/** Fresh first-run mode: nothing stored, no pending state, no tries counted. */
function firstRunMode(): Handler {
  return createFirstRunApp({ github, publicUrl, setupCode: SETUP_CODE, trustProxy: false, exit: goDown, webDistDir }).fetch;
}

/** While the container restarts, the proxy in front of it answers for it. */
const down: Handler = () => new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } });

/**
 * Normal mode, as far as the first-run page can tell: the server read its stored app at boot (as main.ts does) and
 * answers `ready` with where to install it. The rest of normal mode isn't needed here (web-server.ts is that).
 */
async function readyMode(): Promise<Handler> {
  const found = await loadGithubApp(getEnv());
  if (!found) throw new Error('restart: no GitHub App was stored');
  setGithubApp(found.creds);
  const app = new Hono();
  app.route('/', readyRoutes({ github }));
  app.route('/', spaRoutes({ distDir: webDistDir, publicUrl }));
  return app.fetch;
}

let current: Handler = firstRunMode();
function goDown(): void {
  current = down;
}

await prisma.githubAppConfig.deleteMany();
serve({ fetch: (req) => current(req), port: webPort, hostname: '127.0.0.1' });

/** What the stand-in GitHub received last: where the form was posted, and the manifest in it. */
let lastPost: { path: string; state: string | null; manifest: unknown } | null = null;

const control = new Hono();
/**
 * GitHub's "Create GitHub App" page, for a person's account or an organization. GitHub would show the app filled in
 * from the manifest; the stand-in records it and goes straight to the end: back to the manifest's `redirect_url`
 * with a code and the same `state`.
 */
const createApp = async (c: Context) => {
  const form = await c.req.parseBody();
  const manifest = JSON.parse(String(form.manifest)) as { redirect_url: string };
  const state = c.req.query('state') ?? null;
  lastPost = { path: c.req.path, state, manifest };
  return c.redirect(`${manifest.redirect_url}?code=${GITHUB_CODE}&state=${encodeURIComponent(state ?? '')}`);
};
control.post('/settings/apps/new', createApp);
control.post('/organizations/:org/settings/apps/new', createApp);
/** Answers what the stand-in GitHub was last sent. */
control.get('/last-post', (c) => c.json(lastPost));
/** The restart Docker does: back up, in normal mode, with the app the callback stored. */
control.post('/restart', async (c) => {
  current = await readyMode();
  return c.body(null, 204);
});
/** Back to a fresh server in first-run mode: what each test starts from. */
control.post('/reset', async (c) => {
  await prisma.githubAppConfig.deleteMany();
  setGithubApp(null);
  lastPost = null;
  current = firstRunMode();
  return c.body(null, 204);
});
// 127.0.0.1 only: nothing outside this machine can reach the stand-in or the control API.
serve({ fetch: control.fetch, port: controlPort, hostname: '127.0.0.1' });

console.log(`[first-run-e2e] first-run mode on ${publicUrl}, stand-in GitHub and control API on ${githubWeb}`);

const stop = async () => {
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
