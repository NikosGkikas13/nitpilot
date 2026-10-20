import { BRAND } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ghId, makeChat, makeRepo, makeUser } from '../../../test/db';
import { fakeFetch } from '../../../test/fake-fetch';
import { testApp } from '../../../test/app';
import { cookieHeader, sessionCookieFor } from '../../../test/http';
import { decrypt } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { hashToken } from '../../lib/tokens';
import { pkceChallenge } from '../../auth/github-oauth';
import { Dispatcher } from '../../chats/dispatch';
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

  it('takes a first sign-in to the setup checklist when nothing else was asked for', async () => {
    const githubId = ghId();
    const app = testApp({ github: new GithubClient(githubFake({ id: githubId, login: 'maya' })) });
    const { cookie, saved } = await startLogin(app, '/');
    const res = await app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/setup');
  });

  it('keeps the page a sign-in was asked for, even before setup is done', async () => {
    const app = testApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const { cookie, saved } = await startLogin(app, '/c/octo/sandbox/42');
    const res = await app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });
    expect(res.headers.get('location')).toBe('/c/octo/sandbox/42');
  });

  it('takes someone who finished setup straight to the inbox', async () => {
    const githubId = ghId();
    await prisma.user.create({ data: { githubId, login: 'maya', onboardedAt: new Date() } });
    const app = testApp({ github: new GithubClient(githubFake({ id: githubId, login: 'maya' })) });
    const { cookie, saved } = await startLogin(app, '/');
    const res = await app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });
    expect(res.headers.get('location')).toBe('/');
  });

  it('sends a sign-in that came in on another address to PUBLIC_URL first, so the cookie is set where the callback lands', async () => {
    const app = testApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    // test-env's PUBLIC_URL is http://localhost:8787. Another host (a www. name, the bare IP)…
    const otherHost = await app.request('/auth/github/login?next=%2Fsettings', { headers: { host: '127.0.0.1:8787' } });
    expect(otherHost.status).toBe(302);
    expect(otherHost.headers.get('location')).toBe('http://localhost:8787/auth/github/login?next=%2Fsettings');
    expect(otherHost.headers.get('set-cookie')).toBeNull();
    // …or the right host reached over the other protocol, as a proxy reports it (Safari typing a tunnel's address).
    vi.stubEnv('PUBLIC_URL', 'https://nitpilot.example');
    const plainHttp = await app.request('/auth/github/login', { headers: { host: 'nitpilot.example', 'x-forwarded-proto': 'http' } });
    expect(plainHttp.headers.get('location')).toBe('https://nitpilot.example/auth/github/login?next=%2F');
  });

  it('goes straight to GitHub when the sign-in came in on PUBLIC_URL, behind a proxy too (no redirect loop)', async () => {
    vi.stubEnv('PUBLIC_URL', 'https://nitpilot.example');
    const app = testApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const res = await app.request('/auth/github/login', { headers: { host: 'nitpilot.example', 'x-forwarded-proto': 'https' } });
    expect(new URL(res.headers.get('location')!).origin).toBe('https://github.com');
    expect(res.headers.get('set-cookie')).toContain(BRAND.oauthCookie);
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
});

describe('signing out and open sockets', () => {
  it('tells the web socket hub which session ended, so its sockets close', async () => {
    const user = await prisma.user.create({ data: { githubId: ghId(), login: 'maya' } });
    const cookie = await sessionCookieFor(user.id);
    const closeSession = vi.fn();
    const app = testApp({ github: new GithubClient(fakeFetch({})), webSockets: { closeSession } });

    await app.request('/auth/logout', { method: 'POST', headers: { cookie, origin: 'http://localhost:8787' } });
    expect(closeSession).toHaveBeenCalledOnce();
    expect(closeSession).toHaveBeenCalledWith(hashToken(cookie.split('=')[1]!));
  });

  it('has nothing to close when there was no session', async () => {
    const closeSession = vi.fn();
    const app = testApp({ github: new GithubClient(fakeFetch({})), webSockets: { closeSession } });
    const res = await app.request('/auth/logout', { method: 'POST', headers: { origin: 'http://localhost:8787' } });
    expect(res.status).toBe(302);
    expect(closeSession).not.toHaveBeenCalled();
  });
});

describe('safeNext', () => {
  it.each([
    ['/cli/approve?code=X', '/cli/approve?code=X'],
    [undefined, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    // Browsers drop tabs and newlines inside a URL and read \ as /, so each of these becomes //evil.example.
    ['/\t/evil.example', '/'],
    ['/\n/evil.example', '/'],
    ['/\r/evil.example', '/'],
    ['/\t\\evil.example', '/'],
  ])('%j → %j', (input, expected) => expect(safeNext(input)).toBe(expected));
});

describe('signing in again (spec §15)', () => {
  /**
   * maya's PR: leo raised P1, and maya's agent answered it, but her replies never reached GitHub, so
   * she's flagged. `jobStatus` is how her newest job ended: `done` means the flag is the failed write.
   */
  async function flaggedAuthor(jobStatus: 'done' | 'failed') {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
    const author = await prisma.participant.create({ data: { chatId: chat.id, githubId: maya.githubId, role: 'author', login: 'maya', userId: maya.id } });
    await prisma.participant.create({ data: { chatId: chat.id, githubId: leo.githubId, role: 'reviewer', login: 'leo', userId: leo.id, requested: true, lastReviewedSha: chat.headSha } });
    await prisma.point.create({ data: { chatId: chat.id, number: 1, raisedByGithubId: leo.githubId, origin: 'agent', severity: 'major', category: 'bug', title: 'Page size 50 is too big', body: 'Use 20.', round: 1 } });
    await prisma.job.create({ data: { chatId: chat.id, participantId: author.id, userId: maya.id, type: 'address', status: jobStatus, round: 1, headSha: chat.headSha } });
    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(chat.id, { type: 'write_failed', write: 'replies', asGithubId: maya.githubId, pointNumbers: [1], reason: 'needs_reauth' });
    const app = testApp({ github: new GithubClient(githubFake({ id: maya.githubId, login: 'maya' })), dispatch: dispatcher.dispatch });
    const signIn = async () => {
      const { cookie, saved } = await startLogin(app, '/');
      return app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });
    };
    return { chat, signIn };
  }

  it('clears the flag a failed GitHub write left, and the chat carries on', async () => {
    const { chat, signIn } = await flaggedAuthor('done');
    expect((await signIn()).status).toBe(302);
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'author' } })).toMatchObject({ attention: 'none' });
    expect(await prisma.job.findFirst({ where: { chatId: chat.id, status: 'queued' } })).toMatchObject({ type: 'address' });
    const last = await prisma.message.findFirstOrThrow({ where: { chatId: chat.id }, orderBy: { seq: 'desc' } });
    expect(last.body).toBe("maya's agent will work on 1 point");
  });

  it("leaves a flag from a failed job: that's for `nitpilot retry`", async () => {
    const { chat, signIn } = await flaggedAuthor('failed');
    expect((await signIn()).status).toBe(302);
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'author' } })).toMatchObject({ attention: 'failed' });
    expect(await prisma.job.count({ where: { chatId: chat.id, status: 'queued' } })).toBe(0);
  });

  it("still signs in when looking for chats to resume fails: that's a bonus, not a condition", async () => {
    const { chat, signIn } = await flaggedAuthor('done');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.participant, 'findMany').mockRejectedValueOnce(new Error('database unavailable'));
    const res = await signIn();
    expect(res.status).toBe(302);
    expect(cookieHeader(res)).toContain(`${BRAND.sessionCookie}=`);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('maya'), expect.any(Error));
    // Nothing resumed: the flag stays until the next sign-in.
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'author' } })).toMatchObject({ attention: 'failed' });
  });
});
