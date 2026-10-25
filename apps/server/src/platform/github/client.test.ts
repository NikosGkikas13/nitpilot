import { describe, expect, it, vi } from 'vitest';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { GithubClient, GithubError, MAX_PAGES, retryAfterMs } from './client';

const NOW = Date.parse('2026-10-09T12:00:00Z');

async function failure(status: number, headers: Record<string, string> = {}): Promise<GithubError> {
  const github = new GithubClient(fakeFetch({ 'POST /repos/octo/sandbox/pulls/42/reviews': () => json({ message: 'no' }, status, headers) }));
  return github.api('POST', '/repos/octo/sandbox/pulls/42/reviews').then(
    () => { throw new Error('expected the request to fail'); },
    (err: GithubError) => err,
  );
}

describe('how long GitHub asks us to wait', () => {
  it('is carried on the error of a rate-limited request (retry-after, a secondary rate limit)', async () => {
    const err = await failure(403, { 'retry-after': '60' });
    expect(err).toBeInstanceOf(GithubError);
    expect(err.retryAfterMs).toBe(60_000);
  });

  it('runs until x-ratelimit-reset when the hourly limit is used up', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 600) });
    expect(retryAfterMs(headers, NOW)).toBe(600_000);
  });

  it('is absent on an ordinary error', async () => {
    expect((await failure(502)).retryAfterMs).toBeUndefined();
  });
});

describe('a GitHub call that never answers', () => {
  it('gives up after the timeout, as a 504 the callers already treat as GitHub being down', async () => {
    // A fetch that never answers, but stops when it's told to, as the real one does.
    const hang = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    const github = new GithubClient(hang, 'https://api.github.com', 'https://github.com', 50);
    const err = await github.api('GET', '/repos/octo/sandbox').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err).toMatchObject({ status: 504, message: "GitHub didn't answer GET /repos/octo/sandbox in 0.05 s" });
    await expect(github.oauth('/login/oauth/access_token', {})).rejects.toMatchObject({ status: 504 });
  });
});

describe('a GitHub call that cannot reach GitHub', () => {
  it('is a 503 that names the call, so callers treat it as GitHub being down', async () => {
    const github = new GithubClient(async () => { throw new TypeError('fetch failed'); });
    const err = await github.api('GET', '/repos/octo/sandbox').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err).toMatchObject({ status: 503, message: "Couldn't reach GitHub for GET /repos/octo/sandbox: fetch failed" });
    expect((err as GithubError).cause).toBeInstanceOf(TypeError);
    await expect(github.oauth('/login/oauth/access_token', {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining('OAuth /login/oauth/access_token') });
  });
});

describe('apiAllPages', () => {
  it('stops at MAX_PAGES when the Link header never runs out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    // A fake that would go on forever (here: MAX_PAGES + 5 pages, then it stops on its own).
    const fetch = fakeFetch({
      'GET /things': () => {
        calls += 1;
        const link: Record<string, string> = calls < MAX_PAGES + 5 ? { link: '<https://api.github.com/things?page=2>; rel="next"' } : {};
        return json([calls], 200, link);
      },
    });
    const items = await new GithubClient(fetch).apiAllPages<number[], number>('/things', (page) => page);
    expect(calls).toBe(MAX_PAGES);
    expect(items).toHaveLength(MAX_PAGES);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
