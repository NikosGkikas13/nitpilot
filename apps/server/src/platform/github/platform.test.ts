import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../../test/fake-fetch';
import { AppAuth } from './app-auth';
import { GithubClient } from './client';
import { GithubPlatform } from './platform';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const NOW = new Date('2026-10-07T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// Real delivery ids are 64-bit, above Number.MAX_SAFE_INTEGER. As a JavaScript number this one becomes …4500.
const BIG_ID = '3847008565046804567';

/** GitHub's JSON, with the ids written as bare numbers exactly as GitHub sends them. */
function rawJson(items: Record<string, unknown>[]): Response {
  const text = JSON.stringify(items).replace(/"id":"(\d+)"/g, '"id":$1');
  return new Response(text, { headers: { 'content-type': 'application/json' } });
}

describe('GithubPlatform.redeliverFailed', () => {
  it('asks GitHub to resend recent failed deliveries that never succeeded later', async () => {
    const fetch = fakeFetch({
      'GET /app/hook/deliveries': () =>
        rawJson([
          { id: '1', guid: 'g-ok', status_code: 202, delivered_at: hoursAgo(1) },
          { id: '2', guid: 'g-retried', status_code: 502, delivered_at: hoursAgo(5) },
          { id: '3', guid: 'g-retried', status_code: 202, delivered_at: hoursAgo(4) },
          { id: BIG_ID, guid: 'g-lost', status_code: 0, delivered_at: hoursAgo(2) },
          { id: '5', guid: 'g-old', status_code: 500, delivered_at: hoursAgo(24 * 4) },
        ]),
      [`POST /app/hook/deliveries/${BIG_ID}/attempts`]: () => ({}),
    });
    const github = new GithubClient(fetch);
    const platform = new GithubPlatform(github, new AppAuth(github, '12345', pem, () => NOW), async () => 'unused');

    expect(await platform.redeliverFailed(new Date(NOW.getTime() - 3 * 86_400_000))).toBe(1);
    expect(fetch.calls.filter((c) => c.method === 'POST').map((c) => c.url.pathname)).toEqual([`/app/hook/deliveries/${BIG_ID}/attempts`]);
  });
});
