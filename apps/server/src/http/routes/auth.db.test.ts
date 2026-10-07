import { BRAND } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ghId } from '../../../test/db';
import { fakeFetch } from '../../../test/fake-fetch';
import { testApp } from '../../../test/app';
import { cookieHeader, sessionCookieFor } from '../../../test/http';
import { decrypt } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { pkceChallenge } from '../../auth/github-oauth';
import { GithubClient } from '../../platform/github/client';
import { safeNext } from './auth';

afterEach(() => vi.unstubAllEnvs());

function githubFake(user: { id: string; login: string }) {
  return fakeFetch({
    'POST /login/oauth/access_token': () => ({ access_token: 'ghu_access', expires_in: 28_800, refresh_token: 'ghr_refresh', refresh_token_expires_in: 15_811_200 }),
    'GET /user': () => ({ id: Number(user.id), login: user.login, avatar_url: 'https://avatars.example/u.png' }),
  });
}

/** Start a sign-in and return the cookie plus the state the server saved. */
async function startLogin(app: ReturnType<typeof testApp>, next = '/cli/approve?code=WDJB-MJHT') {
  const res = await app.request(`/auth/github/login?next=${encodeURIComponent(next)}`);
  const cookie = cookieHeader(res);
  const saved = JSON.parse(decrypt(decodeURIComponent(cookie.split(`${BRAND.oauthCookie}=`)[1]!)));
  return { res, cookie, saved };
}

describe('GitHub sign-in', () => {
  it('redirects to GitHub with a PKCE challenge that matches the saved verifier', async () => {
    const app = testApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const { res, saved } = await startLogin(app);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(saved.verifier));
    expect(url.searchParams.get('state')).toBe(saved.state);
    expect(saved.next).toBe('/cli/approve?code=WDJB-MJHT');
  });

  it('signs in on the callback: saves the user, encrypts the tokens and starts a session', async () => {
    const githubId = ghId();
    const app = testApp({ github: new GithubClient(githubFake({ id: githubId, login: 'maya' })) });
    const { cookie, saved } = await startLogin(app);

    const res = await app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/cli/approve?code=WDJB-MJHT');
    const user = await prisma.user.findUniqueOrThrow({ where: { githubId }, include: { githubAuth: true, sessions: true } });
    expect(user.login).toBe('maya');
    expect(decrypt(user.githubAuth!.accessTokenEnc)).toBe('ghu_access');
    expect(user.githubAuth!.accessTokenEnc).not.toContain('ghu_access');
    expect(user.sessions).toHaveLength(1);
    expect(cookieHeader(res)).toContain(`${BRAND.sessionCookie}=`);
  });

  it('rejects a callback whose state does not match', async () => {
    const app = testApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const { cookie } = await startLogin(app);
    const res = await app.request('/auth/github/callback?code=abc&state=forged', { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it('keeps people outside ALLOWED_LOGINS out', async () => {
    vi.stubEnv('ALLOWED_LOGINS', 'leo');
    const app = testApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const { cookie, saved } = await startLogin(app);
    const res = await app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it('signs out only from our own pages', async () => {
    const user = await prisma.user.create({ data: { githubId: ghId(), login: 'maya' } });
    const cookie = await sessionCookieFor(user.id);
    const app = testApp({ github: new GithubClient(fakeFetch({})) });

    expect((await app.request('/auth/logout', { method: 'POST', headers: { cookie } })).status).toBe(403);
    const res = await app.request('/auth/logout', { method: 'POST', headers: { cookie, origin: 'http://localhost:8787' } });
    expect(res.status).toBe(302);
    expect(await prisma.webSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('shows who is signed in on the home page', async () => {
    const user = await prisma.user.create({ data: { githubId: ghId(), login: 'maya-home' } });
    const app = testApp({ github: new GithubClient(fakeFetch({})) });
    const res = await app.request('/', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await res.text()).toContain('@maya-home');
  });
});

describe('safeNext', () => {
  it.each([
    ['/cli/approve?code=X', '/cli/approve?code=X'],
    [undefined, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});
