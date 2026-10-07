import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../test/fake-fetch';
import { GithubClient, GithubError } from '../platform/github/client';
import { authorizeUrl, exchangeCode, pkceChallenge } from './github-oauth';

describe('PKCE', () => {
  it('uses the S256 challenge: base64url(sha256(verifier))', () => {
    expect(pkceChallenge('verifier-123')).toBe(createHash('sha256').update('verifier-123').digest('base64url'));
  });

  it('builds the authorize URL', () => {
    const url = new URL(authorizeUrl({ webBase: 'https://github.com', clientId: 'Iv1.x', redirectUri: 'http://localhost:8787/auth/github/callback', state: 'st', codeChallenge: 'ch' }));
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv1.x',
      redirect_uri: 'http://localhost:8787/auth/github/callback',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });
});

describe('exchangeCode', () => {
  const now = new Date('2026-10-07T18:00:00Z');

  it('returns the tokens with absolute expiry times', async () => {
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': () => ({ access_token: 'ghu_a', expires_in: 28_800, refresh_token: 'ghr_r', refresh_token_expires_in: 15_811_200 }) });
    const tokens = await exchangeCode(new GithubClient(fetch), { clientId: 'c', clientSecret: 's', code: 'k', redirectUri: 'r', codeVerifier: 'v' }, now);
    expect(tokens).toEqual({
      accessToken: 'ghu_a',
      accessExpiresAt: new Date('2026-10-08T02:00:00Z'),
      refreshToken: 'ghr_r',
      refreshExpiresAt: new Date(now.getTime() + 15_811_200_000),
    });
    expect(fetch.calls[0]!.body).toMatchObject({ code: 'k', code_verifier: 'v' });
  });

  it('turns GitHub OAuth errors (sent with status 200) into GithubError', async () => {
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': () => ({ error: 'bad_verification_code' }) });
    await expect(exchangeCode(new GithubClient(fetch), { clientId: 'c', clientSecret: 's', code: 'k', redirectUri: 'r', codeVerifier: 'v' })).rejects.toBeInstanceOf(GithubError);
  });
});
