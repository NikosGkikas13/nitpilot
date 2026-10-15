import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { makeCliToken, makeUser } from '../../test/db';
import { sessionCookieFor } from '../../test/http';
import { onError } from '../http/errors';
import { requireSameOrigin, requireUser, type UserVariables } from './request-user';

// A small app with one read and one write, behind the two checks.
const app = new Hono<{ Variables: UserVariables }>();
app.onError(onError);
app.get('/who', requireUser, (c) => c.json({ login: c.get('user').login, via: c.get('via') }));
app.post('/change', requireUser, requireSameOrigin, (c) => c.json({ ok: true }));

// A route that forgot `requireUser`, or put `requireSameOrigin` before it: the check must not quietly pass.
const misordered = new Hono<{ Variables: UserVariables }>();
misordered.onError(onError);
misordered.post('/alone', requireSameOrigin, (c) => c.json({ ok: true }));
misordered.post('/backwards', requireSameOrigin, requireUser, (c) => c.json({ ok: true }));

const OURS = { origin: 'http://localhost:8787' };

describe('requireUser', () => {
  it('knows a browser by its session cookie', async () => {
    const user = await makeUser({ login: 'maya-web' });
    const res = await app.request('/who', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await res.json()).toEqual({ login: 'maya-web', via: 'session' });
  });

  it('knows a CLI by its token', async () => {
    const user = await makeUser({ login: 'maya-cli' });
    const { raw } = await makeCliToken(user.id);
    const res = await app.request('/who', { headers: { authorization: `Bearer ${raw}` } });
    expect(await res.json()).toEqual({ login: 'maya-cli', via: 'cli' });
  });

  it('turns away a request with neither', async () => {
    const res = await app.request('/who');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Sign in with GitHub first.' } });
  });

  it('does not fall back to the cookie when the token is wrong', async () => {
    const user = await makeUser();
    const res = await app.request('/who', { headers: { authorization: 'Bearer nit_wrong', cookie: await sessionCookieFor(user.id) } });
    expect(res.status).toBe(401);
  });
});

describe('requireSameOrigin', () => {
  it('lets a browser change things from our own pages only', async () => {
    const cookie = await sessionCookieFor((await makeUser()).id);
    expect((await app.request('/change', { method: 'POST', headers: { cookie, ...OURS } })).status).toBe(200);
    expect((await app.request('/change', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await app.request('/change', { method: 'POST', headers: { cookie } })).status).toBe(403);
  });

  it('needs no Origin from a CLI', async () => {
    const { raw } = await makeCliToken((await makeUser()).id);
    expect((await app.request('/change', { method: 'POST', headers: { authorization: `Bearer ${raw}` } })).status).toBe(200);
  });

  it('fails closed: without requireUser first, a cookie POST with no Origin is refused', async () => {
    const cookie = await sessionCookieFor((await makeUser()).id);
    for (const path of ['/alone', '/backwards']) {
      const res = await misordered.request(path, { method: 'POST', headers: { cookie } });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { code: 'forbidden', message: 'Request did not come from Nitpilot.' } });
    }
  });
});
