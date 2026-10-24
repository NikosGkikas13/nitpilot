import type { MyChatsResponse } from '@nitpilot/protocol';
import { describe, expect, it, vi } from 'vitest';
import { makeChat, makeCliToken, makeGithubSignIn, makeRepo, makeUser, personOf } from '../../../test/db';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { testApp } from '../../../test/app';
import { sessionCookieFor } from '../../../test/http';
import { decideCliLogin, startCliLogin } from '../../auth/cli-login';
import { Dispatcher } from '../../chats/dispatch';
import { prisma } from '../../lib/prisma';
import { GithubClient } from '../../platform/github/client';

type LoginStart = { deviceCode: string; userCode: string; verifyUrl: string };

const ORIGIN = { origin: 'http://localhost:8787' };
const app = () => testApp({ github: new GithubClient(fakeFetch({})) });

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app().request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

/** The approve page's button (`POST /api/cli/requests/:userCode`), pressed by someone signed in with `cookie`. */
async function decide(code: string, decision: 'approve' | 'deny', cookie: string, headers: Record<string, string> = ORIGIN) {
  return post(`/api/cli/requests/${code}`, { decision }, { cookie, ...headers });
}

describe('nitpilot login', () => {
  it('runs the whole handshake: code, approval in the browser, one token, revoke', async () => {
    const user = await makeUser({ login: 'maya' });
    const cookie = await sessionCookieFor(user.id);

    const start = (await (await post('/api/cli/login', { deviceName: "Maya's MacBook Pro" })).json()) as LoginStart;
    expect(start).toMatchObject({ interval: 2, expiresIn: 600 });
    expect(start.verifyUrl).toBe(`http://localhost:8787/cli/approve?code=${start.userCode}`);
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'pending' });

    const request = await app().request(`/api/cli/requests/${start.userCode}`, { headers: { cookie } });
    expect(await request.json()).toMatchObject({ userCode: start.userCode, deviceName: "Maya's MacBook Pro", status: 'pending' });

    expect((await decide(start.userCode, 'approve', cookie, {})).status).toBe(403);
    expect(await (await decide(start.userCode, 'approve', cookie)).json()).toMatchObject({ status: 'approved' });

    const approved = (await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()) as { status: string; token: string };
    expect(approved.status).toBe('approved');
    expect(approved.token).toMatch(/^nit_/);
    // A token is issued once; later polls never get another.
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'expired' });

    const auth = { authorization: `Bearer ${approved.token}` };
    expect(await (await app().request('/api/me', { headers: auth })).json()).toMatchObject({ login: 'maya', avatarUrl: null, githubAuth: 'needs_reauth' });
    expect((await app().request('/api/cli/token', { method: 'DELETE', headers: auth })).status).toBe(204);
    expect((await app().request('/api/me', { headers: auth })).status).toBe(401);
  });

  it("tells the person's open tabs once the first poll after approval made the token, so the setup checklist ticks", async () => {
    const user = await makeUser();
    const sendMeUpdate = vi.fn(async () => {});
    const server = testApp({ github: new GithubClient(fakeFetch({})), meUpdates: { sendMeUpdate } });
    const poll = async (deviceCode: string) => server.request('/api/cli/login/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode }) });
    const login = await startCliLogin('laptop');
    await poll(login.deviceCode);
    expect(sendMeUpdate).not.toHaveBeenCalled();
    await decideCliLogin(login.userCode, user.id, 'approve');
    expect(await (await poll(login.deviceCode)).json()).toMatchObject({ status: 'approved' });
    expect(sendMeUpdate).toHaveBeenCalledExactlyOnceWith(user.id);
    // Later polls make no token, so they tell nobody.
    await poll(login.deviceCode);
    expect(sendMeUpdate).toHaveBeenCalledOnce();
  });

  it('still hands over the token when telling the open tabs fails (the token is already saved)', async () => {
    const user = await makeUser();
    const sendMeUpdate = vi.fn(async () => {
      throw new Error('socket gone');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = testApp({ github: new GithubClient(fakeFetch({})), meUpdates: { sendMeUpdate } });
    const login = await startCliLogin('laptop');
    await decideCliLogin(login.userCode, user.id, 'approve');
    const res = await server.request('/api/cli/login/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: login.deviceCode }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'approved', token: expect.stringMatching(/^nit_/) });
    expect(sendMeUpdate).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('reports a denied login', async () => {
    const user = await makeUser();
    const start = (await (await post('/api/cli/login', { deviceName: 'laptop' })).json()) as LoginStart;
    await decide(start.userCode, 'deny', await sessionCookieFor(user.id));
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'denied' });
  });

  it('expires codes after 10 minutes', async () => {
    const user = await makeUser();
    const old = await startCliLogin('laptop', new Date(Date.now() - 11 * 60_000));
    expect(await (await post('/api/cli/login/poll', { deviceCode: old.deviceCode })).json()).toEqual({ status: 'expired' });
    const request = await app().request(`/api/cli/requests/${old.userCode}`, { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await request.json()).toMatchObject({ status: 'expired' });
  });

  it('rejects a bad request body', async () => {
    expect((await post('/api/cli/login', { deviceName: '' })).status).toBe(400);
  });

  it('lets one address start 10 logins a minute, then answers 429', async () => {
    const server = app(); // one app: the count lives in the running server
    const start = () => server.request('/api/cli/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceName: 'laptop' }) });
    for (let i = 0; i < 10; i++) expect((await start()).status).toBe(200);
    const res = await start();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });
});

describe('/api/me/chats', () => {
  /** Makes `user` a reviewer in a new open chat of `repo`. */
  async function join(user: { id: string; githubId: string; login: string }, repoId: string, number: number) {
    const chat = await makeChat(repoId, { number });
    await prisma.participant.create({ data: { chatId: chat.id, githubId: user.githubId, role: 'reviewer', login: user.login, userId: user.id, attention: 'decision' } });
    return chat;
  }
  it("lists the open chats the CLI's user takes part in", async () => {
    const user = await makeUser();
    await makeGithubSignIn(user.id);
    const repo = await makeRepo();
    const chat = await join(user, repo.id, 142);
    const closed = await makeChat(repo.id, { number: 143 });
    await prisma.prChat.update({ where: { id: closed.id }, data: { closedAt: new Date(), phase: 'closed' } });
    await prisma.participant.create({ data: { chatId: closed.id, githubId: user.githubId, role: 'reviewer', login: user.login } });

    const github = new GithubClient(fakeFetch({ [`GET /repos/${repo.fullName}`]: () => ({ id: 1 }) }));
    const token = (await makeCliToken(user.id)).raw;
    const res = await testApp({ github }).request('/api/me/chats', { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as MyChatsResponse;
    expect(body.chats).toEqual([
      expect.objectContaining({ id: chat.id, repo: repo.fullName, number: 142, role: 'reviewer', attention: 'decision', url: `http://localhost:8787/c/${repo.fullName}/142` }),
    ]);
  });

  it('lists only chats in repos the person can still read', async () => {
    const user = await makeUser();
    await makeGithubSignIn(user.id);
    const [readable, gone] = [await makeRepo(), await makeRepo()];
    await join(user, readable.id, 1);
    await join(user, gone.id, 2);
    const github = new GithubClient(
      fakeFetch({
        [`GET /repos/${readable.fullName}`]: () => ({ id: 1 }),
        [`GET /repos/${gone.fullName}`]: () => json({ message: 'Not Found' }, 404),
      }),
    );
    const token = (await makeCliToken(user.id)).raw;
    const res = await testApp({ github }).request('/api/me/chats', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MyChatsResponse).chats.map((c) => c.repo)).toEqual([readable.fullName]);
  });

  it('answers 401 "sign in again" when the GitHub sign-in expired', async () => {
    const user = await makeUser();
    await makeGithubSignIn(user.id, 'needs_reauth');
    const repo = await makeRepo();
    await join(user, repo.id, 1);
    const token = (await makeCliToken(user.id)).raw;
    const res = await testApp({ github: new GithubClient(fakeFetch({})) }).request('/api/me/chats', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'reauth' } });
  });

  it('answers 502 when GitHub does not answer', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = await makeUser();
    await makeGithubSignIn(user.id);
    const repo = await makeRepo();
    await join(user, repo.id, 1);
    const github = new GithubClient(fakeFetch({ [`GET /repos/${repo.fullName}`]: () => json({ message: 'Server Error' }, 500) }));
    const token = (await makeCliToken(user.id)).raw;
    const res = await testApp({ github }).request('/api/me/chats', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'github_unavailable' } });
    log.mockRestore();
  });

  it('asks GitHub once per repo, not once per chat', async () => {
    const user = await makeUser();
    await makeGithubSignIn(user.id);
    const repo = await makeRepo();
    for (const number of [1, 2, 3]) await join(user, repo.id, number);
    const fetch = fakeFetch({ [`GET /repos/${repo.fullName}`]: () => ({ id: 1 }) });
    const token = (await makeCliToken(user.id)).raw;
    const res = await testApp({ github: new GithubClient(fetch) }).request('/api/me/chats', { headers: { authorization: `Bearer ${token}` } });
    expect(((await res.json()) as MyChatsResponse).chats).toHaveLength(3);
    expect(fetch.calls.filter((call) => call.url.pathname === `/repos/${repo.fullName}`)).toHaveLength(1);
  });
});

describe('POST /api/chats/:id/retry', () => {
  /** leo's review of maya's PR failed for good. */
  async function failedReview() {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
    const review = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } });
    await prisma.job.update({ where: { id: review.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: review.id, attempt: 1, reason: 'auth', retryable: false });
    const server = testApp({ github: new GithubClient(fakeFetch({})), dispatch: dispatcher.dispatch });
    const retry = (token: string) => server.request(`/api/chats/${chat.id}/retry`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    return { chat, leo, dispatcher, retry, leoToken: (await makeCliToken(leo.id)).raw, mayaToken: (await makeCliToken(maya.id)).raw };
  }

  it("queues leo's failed review again and clears his failed flag", async () => {
    const { chat, leo, retry, leoToken } = await failedReview();
    const res = await retry(leoToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'queued' });
    const jobs = await prisma.job.findMany({ where: { chatId: chat.id }, orderBy: { createdAt: 'asc' } });
    expect(jobs.map((j) => [j.type, j.status])).toEqual([
      ['review', 'failed'],
      ['review', 'queued'],
    ]);
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, githubId: leo.githubId } })).toMatchObject({ attention: 'none' });
  });

  it("answers waiting when the author's agent is still fixing: the review starts after that pass", async () => {
    const { chat, leo, retry, leoToken } = await failedReview();
    const maya = await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'author' } });
    await prisma.job.create({
      data: { chatId: chat.id, participantId: maya.id, activeFor: maya.id, userId: maya.userId!, type: 'address', status: 'queued', round: 1, headSha: chat.headSha },
    });
    const res = await retry(leoToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'waiting' });
    expect(await prisma.job.count({ where: { chatId: chat.id, type: { in: ['review', 're_review'] } } })).toBe(1); // still only the failed one
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, githubId: leo.githubId } })).toMatchObject({ attention: 'none' });
  });

  it('refuses when nothing of yours failed there: the author, or leo once his job is queued again', async () => {
    const { retry, leoToken, mayaToken } = await failedReview();
    const asMaya = await retry(mayaToken);
    expect(asMaya.status).toBe(409);
    expect(await asMaya.json()).toMatchObject({ error: { code: 'conflict', message: 'Nothing of yours failed on this PR.' } });
    expect((await retry(leoToken)).status).toBe(200);
    expect((await retry(leoToken)).status).toBe(409);
  });

  it('explains a failed GitHub post instead of running the agent again', async () => {
    const { chat, leo, dispatcher, retry, leoToken } = await failedReview();
    expect((await retry(leoToken)).status).toBe(200);
    // The review ran fine this time, but posting it to GitHub kept failing.
    const review = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, status: 'queued' } });
    await prisma.job.update({ where: { id: review.id }, data: { status: 'done', activeFor: null } });
    await dispatcher.dispatch(chat.id, { type: 'write_failed', write: 'review', asGithubId: leo.githubId, pointNumbers: [], reason: 'needs_reauth' });
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, githubId: leo.githubId } })).toMatchObject({ attention: 'failed' });

    const res = await retry(leoToken);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'conflict', message: expect.stringContaining('posting its review or replies to GitHub did') } });
  });

  it('needs a CLI token', async () => {
    const { chat } = await failedReview();
    expect((await app().request(`/api/chats/${chat.id}/retry`, { method: 'POST' })).status).toBe(401);
  });
});
