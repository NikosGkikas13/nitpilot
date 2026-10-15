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
    expect(WebMe.parse(await res.json())).toEqual({ id: user.id, githubId: user.githubId, login: 'maya-me', avatarUrl: null, githubAuth: 'needs_reauth' });
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
