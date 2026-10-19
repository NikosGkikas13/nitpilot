import { CliRequestView } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeCliToken, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';
import { decideCliLogin, startCliLogin } from '../../auth/cli-login';
import { prisma } from '../../lib/prisma';

const ORIGIN = 'http://localhost:8787';

/**
 * maya, signed in to the web app, and a `nitpilot login` waiting for her: `login` is what the CLI got back
 * (the secret device code and the short user code). `view`, `decide` and `poll` are the page's and the CLI's requests.
 */
async function scene(startedAt = new Date()) {
  const maya = await makeUser({ login: 'maya' });
  const cookie = await sessionCookieFor(maya.id);
  const login = await startCliLogin("Maya's MacBook Pro", startedAt);
  const app = testApp();
  const view = (code: string, headers: Record<string, string> = { cookie }) => app.request(`/api/cli/requests/${code}`, { headers });
  const decide = (code: string, decision: string, headers: Record<string, string> = { cookie, origin: ORIGIN }) =>
    app.request(`/api/cli/requests/${code}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ decision }) });
  const poll = async () =>
    (await app.request('/api/cli/login/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: login.deviceCode }) })).json();
  return { maya, cookie, login, view, decide, poll };
}

const statusOf = async (res: Response) => CliRequestView.parse(await res.json()).status;

describe('GET /api/cli/requests/:userCode', () => {
  it('shows a waiting login: its code, the device, when it was asked and when it runs out', async () => {
    const startedAt = new Date();
    const { login, view } = await scene(startedAt);
    const res = await view(login.userCode);
    expect(res.status).toBe(200);
    expect(CliRequestView.parse(await res.json())).toEqual({
      userCode: login.userCode,
      deviceName: "Maya's MacBook Pro",
      requestedAt: startedAt.toISOString(),
      expiresAt: login.expiresAt.toISOString(),
      status: 'pending',
    });
  });

  it('finds the code however it was typed: lower case, with spaces around it', async () => {
    const { login, view } = await scene();
    const res = await view(encodeURIComponent(` ${login.userCode.toLowerCase()} `));
    expect(res.status).toBe(200);
    expect(CliRequestView.parse(await res.json()).userCode).toBe(login.userCode);
  });

  it('reads a pending code past its 10 minutes as expired', async () => {
    const { login, view } = await scene(new Date(Date.now() - 11 * 60_000));
    expect(await statusOf(await view(login.userCode))).toBe('expired');
  });

  it('writes nothing when it reads an expired login: the row stays pending until the CLI polls', async () => {
    const { login, view } = await scene(new Date(Date.now() - 11 * 60_000));
    expect(await statusOf(await view(login.userCode))).toBe('expired');
    expect((await prisma.cliLoginRequest.findUniqueOrThrow({ where: { userCode: login.userCode } })).status).toBe('pending');
  });

  it("answers 404 for a code that doesn't exist", async () => {
    const { view } = await scene();
    const res = await view('ZZZZ-ZZZZ');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it("refuses a CLI's token like no sign-in at all, and no sign-in with a 401", async () => {
    const { maya, login, view } = await scene();
    const token = await makeCliToken(maya.id);
    expect((await view(login.userCode, { authorization: `Bearer ${token.raw}` })).status).toBe(401);
    expect((await view(login.userCode, {})).status).toBe(401);
  });
});

describe('POST /api/cli/requests/:userCode', () => {
  it("approves: the answer says so, and the CLI's next poll gets its token", async () => {
    const { maya, login, decide, poll } = await scene();
    expect(await poll()).toEqual({ status: 'pending' });
    const res = await decide(login.userCode, 'approve');
    expect(res.status).toBe(200);
    expect(CliRequestView.parse(await res.json())).toMatchObject({ userCode: login.userCode, status: 'approved' });
    expect(await poll()).toMatchObject({ status: 'approved', token: expect.stringMatching(/^nit_/) });
    expect(await prisma.cliToken.count({ where: { userId: maya.id, name: "Maya's MacBook Pro" } })).toBe(1);
  });

  it('still reads approved once the CLI has collected its token', async () => {
    const { login, decide, poll, view } = await scene();
    await decide(login.userCode, 'approve');
    await poll(); // the row is now `consumed`
    expect(await statusOf(await view(login.userCode))).toBe('approved');
  });

  it('denies: the CLI hears denied, and no token is made', async () => {
    const { maya, login, decide, poll } = await scene();
    expect(await statusOf(await decide(login.userCode, 'deny'))).toBe('denied');
    expect(await poll()).toEqual({ status: 'denied' });
    expect(await prisma.cliToken.count({ where: { userId: maya.id } })).toBe(0);
  });

  it("can't approve an expired code: it answers expired and the CLI never gets a token", async () => {
    const { login, decide, poll } = await scene(new Date(Date.now() - 11 * 60_000));
    const res = await decide(login.userCode, 'approve');
    expect(res.status).toBe(200);
    expect(await statusOf(res)).toBe('expired');
    expect(await poll()).toEqual({ status: 'expired' });
  });

  it('answers a code that was already decided with what happened, and changes nothing (a double click, a stale tab)', async () => {
    const { maya, login, decide } = await scene();
    await decideCliLogin(login.userCode, maya.id, 'deny');
    const res = await decide(login.userCode, 'approve');
    expect(res.status).toBe(200);
    expect(await statusOf(res)).toBe('denied');
    expect((await prisma.cliLoginRequest.findUniqueOrThrow({ where: { userCode: login.userCode } })).status).toBe('denied');
  });

  it('decides the code however it was typed', async () => {
    const { login, decide } = await scene();
    expect(await statusOf(await decide(login.userCode.toLowerCase(), 'approve'))).toBe('approved');
  });

  it("answers 404 for a code that doesn't exist, and 400 for a decision that isn't approve or deny", async () => {
    const { login, decide } = await scene();
    expect((await decide('ZZZZ-ZZZZ', 'approve')).status).toBe(404);
    expect((await decide(login.userCode, 'maybe')).status).toBe(400);
  });

  it('refuses a request from another site with 403, and leaves the login waiting', async () => {
    const { cookie, login, decide, view } = await scene();
    const res = await decide(login.userCode, 'approve', { cookie, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await statusOf(await view(login.userCode))).toBe('pending');
    expect((await decide(login.userCode, 'approve', { cookie })).status).toBe(403); // no Origin at all
  });

  it("refuses a CLI's token like no sign-in at all, and no sign-in with a 401", async () => {
    const { maya, login, decide } = await scene();
    const token = await makeCliToken(maya.id);
    expect((await decide(login.userCode, 'approve', { authorization: `Bearer ${token.raw}` })).status).toBe(401);
    expect((await decide(login.userCode, 'approve', { origin: ORIGIN })).status).toBe(401);
  });

  it("leaves the login waiting when a CLI's token tries to approve it", async () => {
    const { maya, login, decide, poll } = await scene();
    const token = await makeCliToken(maya.id);
    expect((await decide(login.userCode, 'approve', { authorization: `Bearer ${token.raw}`, origin: ORIGIN })).status).toBe(401);
    expect((await prisma.cliLoginRequest.findUniqueOrThrow({ where: { userCode: login.userCode } })).status).toBe('pending');
    expect(await poll()).toEqual({ status: 'pending' });
  });

  it('checks the Origin before it reads the body: another site with junk is 403, not 400', async () => {
    const { cookie, login } = await scene();
    const res = await testApp().request(`/api/cli/requests/${login.userCode}`, {
      method: 'POST',
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: 'not json {',
    });
    expect(res.status).toBe(403);
  });
});
