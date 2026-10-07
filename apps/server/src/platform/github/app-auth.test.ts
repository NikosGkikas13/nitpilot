import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../../test/fake-fetch';
import { AppAuth, createAppJwt } from './app-auth';
import { GithubClient } from './client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const NOW = new Date('2026-10-07T18:00:00Z');

describe('createAppJwt', () => {
  it('signs an RS256 JWT for the app, valid for 9 minutes, backdated 60 s for clock drift', () => {
    const jwt = createAppJwt('12345', pem, NOW);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const iat = NOW.getTime() / 1000 - 60;
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({ iat, exp: iat + 540, iss: '12345' });
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});

describe('AppAuth.installationToken', () => {
  it('fetches a token once and reuses it until 5 minutes before it expires', async () => {
    let now = NOW;
    const fetch = fakeFetch({
      'POST /app/installations/77/access_tokens': () => ({ token: `ghs_${fetch.calls.length}`, expires_at: new Date(now.getTime() + 60 * 60_000).toISOString() }),
    });
    const auth = new AppAuth(new GithubClient(fetch), '12345', pem, () => now);

    expect(await auth.installationToken('77')).toBe('ghs_1');
    expect(await auth.installationToken('77')).toBe('ghs_1');
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.headers.get('authorization')).toMatch(/^Bearer ey/);

    now = new Date(NOW.getTime() + 56 * 60_000);
    expect(await auth.installationToken('77')).toBe('ghs_2');
  });
});
