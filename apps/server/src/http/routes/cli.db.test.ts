import type { MyChatsResponse } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser } from '../../../test/db';
import { fakeFetch } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { startCliLogin } from '../../auth/cli-login';
import { prisma } from '../../lib/prisma';
import { generateToken } from '../../lib/tokens';
import { GithubClient } from '../../platform/github/client';
import { createApp } from '../app';

type LoginStart = { deviceCode: string; userCode: string; verifyUrl: string };

const ORIGIN = { origin: 'http://localhost:8787' };
const app = () => createApp({ github: new GithubClient(fakeFetch({})) });

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app().request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

async function approveForm(code: string, decision: 'approve' | 'deny', cookie: string, headers: Record<string, string> = ORIGIN) {
  return app().request('/cli/approve', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ code, decision }).toString(),
  });
}

describe('nitpilot login', () => {
  it('runs the whole handshake: code, approval in the browser, one token, revoke', async () => {
    const user = await makeUser({ login: 'maya' });
    const cookie = await sessionCookieFor(user.id);

    const start = (await (await post('/api/cli/login', { deviceName: "Maya's MacBook Pro" })).json()) as LoginStart;
    expect(start).toMatchObject({ interval: 2, expiresIn: 600 });
    expect(start.verifyUrl).toBe(`http://localhost:8787/cli/approve?code=${start.userCode}`);
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'pending' });

    const page = await app().request(`/cli/approve?code=${start.userCode}`, { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain(start.userCode);
    expect(html).toContain('Maya&#39;s MacBook Pro');

    expect((await approveForm(start.userCode, 'approve', cookie, {})).status).toBe(403);
    expect(await (await approveForm(start.userCode, 'approve', cookie)).text()).toContain('Device approved');

    const approved = (await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()) as { status: string; token: string };
    expect(approved.status).toBe('approved');
    expect(approved.token).toMatch(/^nit_/);
    // A token is issued once; later polls never get another.
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'expired' });

    const auth = { authorization: `Bearer ${approved.token}` };
    expect(await (await app().request('/api/me', { headers: auth })).json()).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'needs_reauth' });
    expect((await app().request('/api/cli/token', { method: 'DELETE', headers: auth })).status).toBe(204);
    expect((await app().request('/api/me', { headers: auth })).status).toBe(401);
  });

  it('reports a denied login', async () => {
    const user = await makeUser();
    const start = (await (await post('/api/cli/login', { deviceName: 'laptop' })).json()) as LoginStart;
    await approveForm(start.userCode, 'deny', await sessionCookieFor(user.id));
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'denied' });
  });

  it('expires codes after 10 minutes', async () => {
    const user = await makeUser();
    const old = await startCliLogin('laptop', new Date(Date.now() - 11 * 60_000));
    expect(await (await post('/api/cli/login/poll', { deviceCode: old.deviceCode })).json()).toEqual({ status: 'expired' });
    const page = await app().request(`/cli/approve?code=${old.userCode}`, { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await page.text()).toContain('This code expired');
  });

  it('sends people who are not signed in to GitHub first, then back', async () => {
    const res = await app().request('/cli/approve?code=WDJB-MJHT');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/auth/github/login?next=${encodeURIComponent('/cli/approve?code=WDJB-MJHT')}`);
  });

  it('rejects a bad request body', async () => {
    expect((await post('/api/cli/login', { deviceName: '' })).status).toBe(400);
  });
});

describe('/api/me/chats', () => {
  it("lists the open chats the CLI's user takes part in", async () => {
    const user = await makeUser();
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { number: 142 });
    await prisma.participant.create({ data: { chatId: chat.id, githubId: user.githubId, role: 'reviewer', login: user.login, userId: user.id, attention: 'decision' } });
    const closed = await makeChat(repo.id, { number: 143 });
    await prisma.prChat.update({ where: { id: closed.id }, data: { closedAt: new Date(), phase: 'closed' } });
    await prisma.participant.create({ data: { chatId: closed.id, githubId: user.githubId, role: 'reviewer', login: user.login } });

    const t = generateToken();
    await prisma.cliToken.create({ data: { userId: user.id, name: 'laptop', tokenHash: t.hash, prefix: t.prefix } });

    const body = (await (await app().request('/api/me/chats', { headers: { authorization: `Bearer ${t.raw}` } })).json()) as MyChatsResponse;
    expect(body.chats).toEqual([
      expect.objectContaining({ id: chat.id, repo: repo.fullName, number: 142, role: 'reviewer', attention: 'decision', url: `http://localhost:8787/c/${repo.fullName}/142` }),
    ]);
  });
});
