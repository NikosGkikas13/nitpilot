import { describe, expect, it } from 'vitest';
import { makeUser } from '../../test/db';
import { fakeFetch, json } from '../../test/fake-fetch';
import { encrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';
import { ACCESS_TTL_MS, MAX_ANSWERS, RepoAccess } from './repo-access';

/** A person signed in to Nitpilot, whose stored GitHub sign-in is `status`. */
async function viewer(status: 'ok' | 'needs_reauth' = 'ok') {
  const user = await makeUser();
  const later = new Date(Date.now() + 86_400_000);
  await prisma.githubAuth.create({ data: { userId: user.id, accessTokenEnc: encrypt('ghu_viewer'), accessExpiresAt: later, refreshTokenEnc: encrypt('ghr_x'), refreshExpiresAt: later, status } });
  return user;
}

const github = () =>
  fakeFetch({
    'GET /repos/octo/open': () => ({ id: 1 }),
    'GET /repos/octo/hidden': () => json({ message: 'Not Found' }, 404),
    'GET /repos/octo/blocked': () => json({ message: 'Forbidden' }, 403),
    'GET /repos/octo/a': () => ({ id: 2 }),
    'GET /repos/octo/b': () => ({ id: 3 }),
    'GET /repos/octo/c': () => ({ id: 4 }),
    'GET /repos/octo/limited': () => json({ message: 'rate limit exceeded' }, 403, { 'retry-after': '60' }),
    'GET /repos/octo/revoked': () => json({ message: 'Bad credentials' }, 401),
  });

describe('RepoAccess (spec §16 "Who can see a chat")', () => {
  it("asks GitHub with the viewer's own token: read, or none for a 404 or a 403", async () => {
    const user = await viewer();
    const fetch = github();
    const access = new RepoAccess(new GithubClient(fetch));
    expect(await access.check(user.id, 'octo/open')).toBe('read');
    expect(await access.check(user.id, 'octo/hidden')).toBe('none');
    expect(await access.check(user.id, 'octo/blocked')).toBe('none');
    expect(fetch.calls[0]!.headers.get('authorization')).toBe('Bearer ghu_viewer');
  });

  it("says reauth when the viewer's sign-in expired, or GitHub no longer takes their token", async () => {
    const fetch = github();
    const access = new RepoAccess(new GithubClient(fetch));
    expect(await access.check((await viewer('needs_reauth')).id, 'octo/open')).toBe('reauth');
    expect(fetch.calls).toEqual([]);
    expect(await access.check((await viewer()).id, 'octo/revoked')).toBe('reauth');
  });

  it('remembers an answer for 5 minutes, per viewer and repo', async () => {
    const [a, b] = [await viewer(), await viewer()];
    const fetch = github();
    let now = 1_000_000;
    const access = new RepoAccess(new GithubClient(fetch), () => now);
    await access.check(a.id, 'octo/open');
    await access.check(a.id, 'octo/open');
    expect(fetch.calls).toHaveLength(1);
    await access.check(b.id, 'octo/open');
    expect(fetch.calls).toHaveLength(2);
    now += ACCESS_TTL_MS;
    await access.check(a.id, 'octo/open');
    expect(fetch.calls).toHaveLength(3);
  });

  it('keeps at most MAX_ANSWERS answers, dropping the oldest first', async () => {
    expect(MAX_ANSWERS).toBe(1_000);
    const user = await viewer();
    const fetch = github();
    const access = new RepoAccess(new GithubClient(fetch), () => 1_000_000, 2);
    for (const repo of ['octo/a', 'octo/b', 'octo/c']) await access.check(user.id, repo);
    expect(fetch.calls).toHaveLength(3);
    await access.check(user.id, 'octo/c');
    expect(fetch.calls).toHaveLength(3);
    await access.check(user.id, 'octo/a');
    expect(fetch.calls).toHaveLength(4);
  });

  it("doesn't take a rate-limited 403 for 'no access', and doesn't remember it", async () => {
    const user = await viewer();
    const fetch = github();
    const access = new RepoAccess(new GithubClient(fetch));
    await expect(access.check(user.id, 'octo/limited')).rejects.toMatchObject({ status: 403 });
    await expect(access.check(user.id, 'octo/limited')).rejects.toMatchObject({ status: 403 });
    expect(fetch.calls).toHaveLength(2);
  });
});
