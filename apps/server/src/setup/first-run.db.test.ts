import type { FirstRunManifestResponse, FirstRunProblem } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../test/app';
import { fakeFetch, json, type FakeRequest } from '../../test/fake-fetch';
import { createFirstRunApp } from '../http/app';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';
import { loadGithubApp } from './credentials';
import { getEnv } from '../lib/env';

const SETUP_CODE = 'K7PX-3MQD';
const PUBLIC_URL = 'http://localhost:8787';

/** What GitHub answers `POST /app-manifests/{code}/conversions` with (the fields we read, plus a few we don't). */
const CONVERSION = {
  id: 424242,
  slug: 'nitpilot-example',
  node_id: 'A_kwDO',
  name: 'Nitpilot (example)',
  owner: { login: 'maya', id: 1001, type: 'User' },
  client_id: 'Iv23.example',
  client_secret: 'example-client-secret',
  webhook_secret: 'example-webhook-secret',
  pem: '-----BEGIN RSA PRIVATE KEY-----\nexample\n-----END RSA PRIVATE KEY-----\n',
  html_url: 'https://github.com/apps/nitpilot-example',
};

/** A fake GitHub whose manifest conversion answers with `answer` (CONVERSION by default). */
function fakeGithub(answer: (req: FakeRequest) => unknown = () => CONVERSION) {
  const fetch = fakeFetch({ 'POST /app-manifests/the-code/conversions': answer });
  return { fetch, github: new GithubClient(fetch) };
}

/** A server in first-run mode, as boot.ts starts one. */
function firstRunServer(over: { github?: GithubClient; trustProxy?: boolean } = {}) {
  const exit = vi.fn();
  const app = createFirstRunApp({
    github: over.github ?? fakeGithub().github,
    publicUrl: PUBLIC_URL,
    setupCode: SETUP_CODE,
    trustProxy: over.trustProxy ?? false,
    exit,
    webDistDir: '/nonexistent/nitpilot-web-dist',
  });
  return { app, exit };
}

type Server = ReturnType<typeof firstRunServer>;

const REQUEST = { code: SETUP_CODE, owner: { kind: 'user' }, name: 'Nitpilot (example)', isPublic: false };

function askForManifest(server: Server, body: unknown = REQUEST, headers: Record<string, string> = {}) {
  return server.app.request('/api/first-run/manifest', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

/** The `state` GitHub would send back: the one in the form's action. */
async function stateFrom(res: Response): Promise<string> {
  const { action } = (await res.json()) as FirstRunManifestResponse;
  return new URL(action).searchParams.get('state')!;
}

function callback(server: Server, query: string) {
  return server.app.request(`/first-run/callback?${query}`);
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

/**
 * The callback is a browser navigation, so a failure sends the browser back to the page, which says what happened.
 * `extra` is for `github`, which also hands the page the `code` and `state` back so its "Try again" can retry.
 */
function expectBackOnThePage(res: Response, problem: FirstRunProblem, why = '', extra: Record<string, string> = {}) {
  expect(res.status, why).toBe(302);
  expect(res.headers.get('location'), why).toBe(`/first-run?${new URLSearchParams({ error: problem, ...extra })}`);
}

beforeEach(async () => {
  await prisma.githubAppConfig.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/first-run in first-run mode', () => {
  it('says the server is waiting for setup, and where people reach it', async () => {
    const res = await firstRunServer().app.request('/api/first-run');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'first_run', publicUrl: PUBLIC_URL });
  });
});

describe('POST /api/first-run/manifest', () => {
  it('answers with the manifest and where to post it, for the setup code from the log', async () => {
    const res = await askForManifest(firstRunServer());
    expect(res.status).toBe(200);
    const body = (await res.json()) as FirstRunManifestResponse;
    expect(body.action).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=[A-Za-z0-9_-]{43}$/);
    expect(body.manifest).toMatchObject({ name: 'Nitpilot (example)', public: false, redirect_url: `${PUBLIC_URL}/first-run/callback` });
  });

  it("posts to the organization's app settings when the app is for an organization", async () => {
    const res = await askForManifest(firstRunServer(), { ...REQUEST, owner: { kind: 'org', login: 'acme-inc' }, isPublic: true });
    const body = (await res.json()) as FirstRunManifestResponse;
    expect(body.action).toMatch(/^https:\/\/github\.com\/organizations\/acme-inc\/settings\/apps\/new\?state=/);
    expect(body.manifest).toMatchObject({ public: true });
  });

  it('takes the code as people type it', async () => {
    expect((await askForManifest(firstRunServer(), { ...REQUEST, code: ' k7px3mqd ' })).status).toBe(200);
  });

  it('refuses a wrong or missing code with 403, the same way each time, and starts no setup', async () => {
    const server = firstRunServer();
    for (const body of [{ ...REQUEST, code: 'K7PX-3MQE' }, { ...REQUEST, code: undefined }, 'not json at all']) {
      const res = await askForManifest(server, body);
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toEqual({ code: 'setup_code', message: "That code doesn't match the one in the server's log." });
    }
    // No state was handed out, so no callback can succeed.
    expectBackOnThePage(await callback(server, 'code=the-code&state=anything'), 'expired');
  });

  it('refuses a body over 4 KB with 413 before reading it; it is not counted as a try at the code', async () => {
    const server = firstRunServer();
    const oversize = { ...REQUEST, name: 'x'.repeat(5_000) };
    for (let i = 0; i < 6; i++) {
      const res = await askForManifest(server, oversize);
      expect(res.status).toBe(413);
      expect((await errorOf(res)).code).toBe('payload_too_large');
    }
    // Six refused bodies didn't use up the five tries.
    expect((await askForManifest(server)).status).toBe(200);
  });

  it('checks the rest of the request once the code is right', async () => {
    const res = await askForManifest(firstRunServer(), { ...REQUEST, name: '' });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('validation_error');
  });

  it('slows guessing down: the 6th try from one address in a minute is refused, even with the right code', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = firstRunServer();
    for (let i = 0; i < 5; i++) expect((await askForManifest(server, { ...REQUEST, code: 'WRONG-0000' })).status).toBe(403);
    const sixth = await askForManifest(server);
    expect(sixth.status).toBe(429);
    expect((await errorOf(sixth)).code).toBe('rate_limited');

    vi.advanceTimersByTime(60_001);
    expect((await askForManifest(server)).status).toBe(200);
  });

  it('counts each address on its own behind the proxy', async () => {
    const server = firstRunServer({ trustProxy: true });
    for (let i = 0; i < 6; i++) await askForManifest(server, { ...REQUEST, code: 'WRONG-0000' }, { 'x-forwarded-for': '203.0.113.9' });
    expect((await askForManifest(server, REQUEST, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(429);
    expect((await askForManifest(server, REQUEST, { 'x-forwarded-for': '198.51.100.7' })).status).toBe(200);
  });
});

describe('GET /first-run/callback', () => {
  it('trades the code for the new app, stores it encrypted, sends the browser on and exits the process once, a moment later', async () => {
    const { fetch, github } = fakeGithub();
    const server = firstRunServer({ github });
    const state = await stateFrom(await askForManifest(server));

    const started = Date.now();
    const res = await callback(server, `code=the-code&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/first-run?done=1');

    // GitHub was asked without a token: the code itself is the proof.
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.headers.get('authorization')).toBeNull();

    const rows = await prisma.githubAppConfig.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ appId: '424242', slug: 'nitpilot-example', clientId: 'Iv23.example', ownerLogin: 'maya' });
    expect(rows[0]!.privateKeyEnc).not.toContain('example');
    expect(rows[0]!.clientSecretEnc).not.toBe(CONVERSION.client_secret);
    expect(rows[0]!.webhookSecretEnc).not.toBe(CONVERSION.webhook_secret);

    // The browser gets its redirect before the server goes away.
    expect(server.exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(server.exit).toHaveBeenCalledOnce(), { timeout: 2_000, interval: 20 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(490);
  });

  it('stores what the next boot reads back', async () => {
    const server = firstRunServer();
    await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
    for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET']) vi.stubEnv(name, '');
    try {
      expect(await loadGithubApp(getEnv())).toEqual({
        source: 'database',
        creds: { appId: '424242', slug: 'nitpilot-example', clientId: 'Iv23.example', clientSecret: 'example-client-secret', webhookSecret: 'example-webhook-secret', privateKey: CONVERSION.pem },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('sends a missing, unknown or reused state back to the page as expired, stores nothing and asks GitHub nothing', async () => {
    const { fetch, github } = fakeGithub();
    const server = firstRunServer({ github });
    const state = await stateFrom(await askForManifest(server));

    for (const query of ['code=the-code', `code=the-code&state=${state}x`, `state=${state}`]) {
      expectBackOnThePage(await callback(server, query), 'expired', query);
    }
    expect(fetch.calls).toHaveLength(0);
    expect(await prisma.githubAppConfig.count()).toBe(0);

    // A state works once.
    expect((await callback(server, `code=the-code&state=${state}`)).headers.get('location')).toBe('/first-run?done=1');
    await prisma.githubAppConfig.deleteMany();
    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'expired');
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });

  it('sends a state older than an hour back to the page as expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = firstRunServer();
    const state = await stateFrom(await askForManifest(server));
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'expired');
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });

  it('keeps the first app when a second comes back (two tabs, one finished), and says the new one is extra', async () => {
    const server = firstRunServer();
    const first = await stateFrom(await askForManifest(server));
    const second = await stateFrom(await askForManifest(server));
    expect((await callback(server, `code=the-code&state=${first}`)).headers.get('location')).toBe('/first-run?done=1');

    expectBackOnThePage(await callback(server, `code=the-code&state=${second}`), 'exists');
    expect(await prisma.githubAppConfig.findMany()).toHaveLength(1);
  });

  it('sends the browser back with a GitHub problem (and the code and state, to retry), stores nothing and keeps running when GitHub fails', async () => {
    const server = firstRunServer({ github: fakeGithub(() => json({ message: 'Server Error' }, 500)).github });
    const state = await stateFrom(await askForManifest(server));
    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'github', '', { code: 'the-code', state });
    expect(await prisma.githubAppConfig.count()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(server.exit).not.toHaveBeenCalled();
  });

  it("keeps the setup link usable when GitHub fails on its side, so a retry doesn't need a second app", async () => {
    let calls = 0;
    const { fetch, github } = fakeGithub(() => (++calls === 1 ? json({ message: 'Server Error' }, 500) : CONVERSION));
    const server = firstRunServer({ github });
    const state = await stateFrom(await askForManifest(server));

    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'github', '', { code: 'the-code', state });
    expect(await prisma.githubAppConfig.count()).toBe(0);

    // The page's "Try again" opens the callback again with the same code and state.
    const retry = await callback(server, `code=the-code&state=${state}`);
    expect(retry.status).toBe(302);
    expect(retry.headers.get('location')).toBe('/first-run?done=1');
    expect(fetch.calls).toHaveLength(2);
    expect(await prisma.githubAppConfig.count()).toBe(1);
  });

  it('keeps the original expiry when GitHub failed: a retry after the hour is still refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = firstRunServer({ github: fakeGithub(() => json({ message: 'Server Error' }, 500)).github });
    const state = await stateFrom(await askForManifest(server));
    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'github', '', { code: 'the-code', state });
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'expired');
  });

  it('uses the setup link up when GitHub refuses the code: a retry is refused without asking GitHub again', async () => {
    const { fetch, github } = fakeGithub(() => json({ message: 'Not Found' }, 404));
    const server = firstRunServer({ github });
    const state = await stateFrom(await askForManifest(server));
    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'expired');
    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'expired');
    expect(fetch.calls).toHaveLength(1);
  });

  it("sends the browser back as expired when GitHub doesn't take the code (it lasts an hour)", async () => {
    const server = firstRunServer({ github: fakeGithub(() => json({ message: 'Not Found' }, 404)).github });
    expectBackOnThePage(await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`), 'expired');
    expect(await prisma.githubAppConfig.count()).toBe(0);
    expect(server.exit).not.toHaveBeenCalled();
  });

  it('never stores an app with a secret missing', async () => {
    for (const missing of ['pem', 'webhook_secret', 'client_secret'] as const) {
      const server = firstRunServer({ github: fakeGithub(() => ({ ...CONVERSION, [missing]: null })).github });
      const state = await stateFrom(await askForManifest(server));
      expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'github', missing, { code: 'the-code', state });
      expect(await prisma.githubAppConfig.count()).toBe(0);
      expect(server.exit).not.toHaveBeenCalled();
    }
  });
});

describe('the first-run routes once the server has its app', () => {
  it('say the server is ready, and where to install the app', async () => {
    const res = await testApp().request('/api/first-run');
    expect(res.status).toBe(200);
    // TEST_ENV's app is nitpilot-dev.
    expect(await res.json()).toEqual({ mode: 'ready', installUrl: 'https://github.com/apps/nitpilot-dev/installations/new' });
  });

  it('refuse to make another app with a JSON 404, not the web app', async () => {
    const res = await testApp().request('/api/first-run/manifest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REQUEST) });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });

  it('send a browser GitHub returns late (a second tab, after the restart) to the page, which says the new app is extra', async () => {
    expectBackOnThePage(await testApp().request('/first-run/callback?code=the-code&state=s'), 'exists');
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });
});
