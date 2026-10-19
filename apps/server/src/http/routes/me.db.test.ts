import { WebMe } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeCliToken, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';

describe('GET /api/me', () => {
  it('tells a signed-in browser who it is', async () => {
    const user = await makeUser({ login: 'maya-me' });
    const res = await testApp().request('/api/me', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(res.status).toBe(200);
    expect(WebMe.parse(await res.json())).toEqual({
      id: user.id, githubId: user.githubId, login: 'maya-me', avatarUrl: null, githubAuth: 'needs_reauth', agentOnline: false,
      settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: null, subscribed: false },
    });
  });

  it('says whether any of your CLIs is connected', async () => {
    const user = await makeUser({ login: 'maya-online' });
    const clis = { connectionsFor: (userId: string) => (userId === user.id ? [{ tokenId: 'token-1', repos: new Set<string>(), usedToday: 2, agent: { id: 'fake' as const, version: null, modes: [] } }] : []), sendSettings: () => 0, closeToken: () => false };
    const res = await testApp({ clis }).request('/api/me', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await res.json()).toMatchObject({ agentOnline: true, usedToday: 2 });
  });

  it('gives a CLI the same answer', async () => {
    const user = await makeUser({ login: 'maya-me-cli' });
    const { raw } = await makeCliToken(user.id);
    const res = await testApp().request('/api/me', { headers: { authorization: `Bearer ${raw}` } });
    expect(await res.json()).toMatchObject({ login: 'maya-me-cli', githubAuth: 'needs_reauth' });
  });

  it('is a 401 for a browser that is not signed in', async () => {
    const res = await testApp().request('/api/me');
    expect(res.status).toBe(401);
  });
});
