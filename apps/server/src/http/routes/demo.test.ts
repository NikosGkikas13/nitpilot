import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { fakeFetch, json, type FakeRequest } from '../../../test/fake-fetch';
import { testApp } from '../../../test/app';
import { GithubClient } from '../../platform/github/client';
import { onError } from '../errors';
import { closeOldDemos, DEMO_LIFETIME_MS, DEMOS_PER_HOUR, demoRoutes } from './demo';

const DEMO = { repo: 'acme/playground', token: 'ghp_author' };
const NOW = Date.parse('2026-10-31T12:00:00Z');
const ORIGIN = { origin: 'http://localhost:8787' };

function pull(number: number, ref: string, ageMs: number, repo = DEMO.repo) {
  return { number, created_at: new Date(NOW - ageMs).toISOString(), head: { ref, repo: { full_name: repo } } };
}

/** A fake GitHub with the playground's open PRs and two demo/* templates. */
function fakeGithub(openPulls: unknown[]) {
  return fakeFetch({
    'GET /repos/acme/playground/pulls': () => openPulls,
    'GET /repos/acme/playground/git/matching-refs/heads/demo/': () => [
      { ref: 'refs/heads/demo/discount', object: { sha: 'aaa' } },
      { ref: 'refs/heads/demo/receipt', object: { sha: 'bbb' } },
    ],
    'POST /repos/acme/playground/git/refs': () => json({}, 201),
    'POST /repos/acme/playground/pulls': () => json({ number: 7 }, 201),
  });
}

function demoApp(fetch: ReturnType<typeof fakeFetch>) {
  const app = new Hono();
  app.onError(onError);
  app.route('/', demoRoutes({ github: new GithubClient(fetch), demo: DEMO, now: () => NOW, random: () => 0.9 }));
  return app;
}

const writes = (calls: FakeRequest[]) => calls.filter((c) => c.method !== 'GET');

describe('POST /api/demo', () => {
  it("doesn't exist, and /healthz says demo: false, without the DEMO_ variables", async () => {
    const app = testApp();
    expect((await app.request('/api/demo', { method: 'POST', headers: ORIGIN })).status).toBe(404);
    expect(await (await app.request('/healthz')).json()).toMatchObject({ demo: false });
  });

  it('opens a PR from a fresh copy of a random demo/* branch, as the author bot', async () => {
    const fetch = fakeGithub([pull(3, 'feature/x', 0, 'stranger/playground')]);
    const res = await demoApp(fetch).request('/api/demo', { method: 'POST', headers: ORIGIN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'http://localhost:8787/c/acme/playground/7' });
    const [ref, pr] = writes(fetch.calls);
    expect(ref!.body).toEqual({ ref: `refs/heads/demo-run/receipt-${NOW}`, sha: 'bbb' });
    expect(pr!.body).toMatchObject({ head: `demo-run/receipt-${NOW}`, base: 'main', title: 'Demo: receipt' });
    expect(fetch.calls.every((c) => c.headers.get('authorization') === 'Bearer ghp_author')).toBe(true);
  });

  it('returns the demo already running instead of opening another', async () => {
    const fetch = fakeGithub([pull(5, 'demo-run/discount-1', DEMO_LIFETIME_MS - 60_000)]);
    const res = await demoApp(fetch).request('/api/demo', { method: 'POST', headers: ORIGIN });
    expect(await res.json()).toEqual({ url: 'http://localhost:8787/c/acme/playground/5' });
    expect(writes(fetch.calls)).toEqual([]);
  });

  it('opens a new one when the open demo is over an hour old (cleanup closes that one)', async () => {
    const fetch = fakeGithub([pull(5, 'demo-run/discount-1', DEMO_LIFETIME_MS)]);
    const res = await demoApp(fetch).request('/api/demo', { method: 'POST', headers: ORIGIN });
    expect(await res.json()).toEqual({ url: 'http://localhost:8787/c/acme/playground/7' });
  });

  it('shares one GitHub round between two clicks at once', async () => {
    const fetch = fakeGithub([]);
    const app = demoApp(fetch);
    const [a, b] = await Promise.all([1, 2].map(() => app.request('/api/demo', { method: 'POST', headers: ORIGIN })));
    expect([await a!.json(), await b!.json()]).toEqual([{ url: expect.stringMatching(/\/7$/) }, { url: expect.stringMatching(/\/7$/) }]);
    expect(fetch.calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/pulls'))).toHaveLength(1);
  });

  it('rate limits each address', async () => {
    const app = demoApp(fakeGithub([pull(5, 'demo-run/discount-1', 0)]));
    for (let i = 0; i < DEMOS_PER_HOUR; i++) expect((await app.request('/api/demo', { method: 'POST', headers: ORIGIN })).status).toBe(200);
    const res = await app.request('/api/demo', { method: 'POST', headers: ORIGIN });
    expect(res.status).toBe(429);
  });

  it('refuses another site', async () => {
    const res = await demoApp(fakeGithub([])).request('/api/demo', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('turns a GitHub error into a 502 that says so', async () => {
    const fetch = fakeFetch({ 'GET /repos/acme/playground/pulls': () => json({ message: 'Bad credentials' }, 401) });
    const res = await demoApp(fetch).request('/api/demo', { method: 'POST', headers: ORIGIN });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'github_unavailable', message: expect.stringContaining('GitHub') } });
  });
});

describe('closeOldDemos', () => {
  it('closes demo PRs older than an hour and deletes their branches, and leaves everything else', async () => {
    const fetch = fakeFetch({
      'GET /repos/acme/playground/pulls': () => [
        pull(1, 'demo-run/discount-1', DEMO_LIFETIME_MS + 1),
        pull(2, 'demo-run/receipt-2', 60_000),
        pull(3, 'demo-run/fork', DEMO_LIFETIME_MS * 2, 'stranger/playground'),
        pull(4, 'my-change', DEMO_LIFETIME_MS * 2),
      ],
      'PATCH /repos/acme/playground/pulls/1': () => ({}),
      // Already gone: fine.
      'DELETE /repos/acme/playground/git/refs/heads/demo-run/discount-1': () => json({ message: 'Reference does not exist' }, 422),
    });
    expect(await closeOldDemos(new GithubClient(fetch), DEMO, NOW)).toBe(1);
    expect(writes(fetch.calls).map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'PATCH /repos/acme/playground/pulls/1',
      'DELETE /repos/acme/playground/git/refs/heads/demo-run/discount-1',
    ]);
    expect(writes(fetch.calls)[0]!.body).toEqual({ state: 'closed' });
  });
});
