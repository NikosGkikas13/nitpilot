import { describe, expect, it } from 'vitest';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { GithubClient, GithubError, retryAfterMs } from './client';

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
