import { describe, expect, it } from 'vitest';
import { makeUser } from '../../test/db';
import { fakeFetch, json } from '../../test/fake-fetch';
import { decrypt, encrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';
import { getUserToken, NeedsReauthError } from './user-tokens';

const NOW = new Date('2026-10-07T18:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function userWithTokens(accessExpiresAt: Date, refreshExpiresAt = minutes(60 * 24 * 30)) {
  const user = await makeUser();
  await prisma.githubAuth.create({
    data: { userId: user.id, accessTokenEnc: encrypt('ghu_old'), accessExpiresAt, refreshTokenEnc: encrypt('ghr_old'), refreshExpiresAt },
  });
  return user;
}

const refreshed = () => ({ access_token: 'ghu_new', expires_in: 28_800, refresh_token: 'ghr_new', refresh_token_expires_in: 15_811_200 });

describe('getUserToken', () => {
  it('returns the stored token while it is fresh, without calling GitHub', async () => {
    const user = await userWithTokens(minutes(60));
    const fetch = fakeFetch({});
    expect(await getUserToken(user.id, new GithubClient(fetch), NOW)).toBe('ghu_old');
    expect(fetch.calls).toHaveLength(0);
  });

  it('refreshes a token that expires within 5 minutes and stores the new pair', async () => {
    const user = await userWithTokens(minutes(3));
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': refreshed });
    expect(await getUserToken(user.id, new GithubClient(fetch), NOW)).toBe('ghu_new');
    const auth = await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decrypt(auth.refreshTokenEnc)).toBe('ghr_new');
    expect(auth.version).toBe(1);
    expect(fetch.calls[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ghr_old' });
  });

  it('runs only one refresh when several writes need the token at once', async () => {
    const user = await userWithTokens(minutes(1));
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': refreshed });
    const gh = new GithubClient(fetch);
    const tokens = await Promise.all([getUserToken(user.id, gh, NOW), getUserToken(user.id, gh, NOW), getUserToken(user.id, gh, NOW)]);
    expect(tokens).toEqual(['ghu_new', 'ghu_new', 'ghu_new']);
    expect(fetch.calls).toHaveLength(1);
  });

  it("makes everyone waiting share one failed refresh, not queue up to fail one after another", async () => {
    const user = await userWithTokens(minutes(1));
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': () => json({ message: 'down' }, 503) });
    const gh = new GithubClient(fetch);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => getUserToken(user.id, gh, NOW)));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill('rejected'));
    expect(fetch.calls).toHaveLength(1);
    expect((await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe('ok');
  });

  it('marks the user needs_reauth when GitHub rejects the refresh token, and stops calling GitHub', async () => {
    const user = await userWithTokens(minutes(1));
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': () => ({ error: 'bad_refresh_token' }) });
    const gh = new GithubClient(fetch);
    await expect(getUserToken(user.id, gh, NOW)).rejects.toBeInstanceOf(NeedsReauthError);
    expect((await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe('needs_reauth');
    await expect(getUserToken(user.id, gh, NOW)).rejects.toBeInstanceOf(NeedsReauthError);
    expect(fetch.calls).toHaveLength(1);
  });

  it('marks needs_reauth without calling GitHub when the refresh token itself expired', async () => {
    const user = await userWithTokens(minutes(-10), minutes(-1));
    const fetch = fakeFetch({});
    await expect(getUserToken(user.id, new GithubClient(fetch), NOW)).rejects.toBeInstanceOf(NeedsReauthError);
    expect(fetch.calls).toHaveLength(0);
  });

  it('keeps the user signed in when the network fails', async () => {
    const user = await userWithTokens(minutes(1));
    const gh = new GithubClient(async () => { throw new TypeError('fetch failed'); });
    await expect(getUserToken(user.id, gh, NOW)).rejects.toThrow('fetch failed');
    expect((await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe('ok');
  });
});
