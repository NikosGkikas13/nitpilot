import { ActionResponse, WebMe } from '@nitpilot/protocol';
import { describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { makeCliToken, makeUser, uid } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';
import { prisma } from '../../lib/prisma';

const ORIGIN = 'http://localhost:8787';

/** A subscription as the browser's `pushManager.subscribe()` hands it out, plus the label the web app adds. */
const subscription = (over: { endpoint?: string; label?: string } = {}) => ({
  endpoint: over.endpoint ?? `https://fcm.googleapis.com/fcm/send/${uid('sub')}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  label: over.label ?? 'Chrome on macOS',
});

/** maya, signed in to the web app, and requests to the push routes with her cookie. */
async function scene(over: { vapidPublicKey?: string | null } = {}) {
  const maya = await makeUser({ login: 'maya' });
  const sendMeUpdate = vi.fn(async () => {});
  const app = testApp({ ...over, meUpdates: { sendMeUpdate } });
  const cookie = await sessionCookieFor(maya.id);
  const call = (method: 'POST' | 'DELETE', body: unknown, headers: Record<string, string> = { cookie, origin: ORIGIN }) =>
    app.request('/api/push/subscriptions', { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const me = async (asCookie = cookie) => WebMe.parse(await (await app.request('/api/me', { headers: { cookie: asCookie } })).json());
  return { maya, app, cookie, call, me, sendMeUpdate };
}

const rowsOf = (userId: string) => prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

describe('POST /api/push/subscriptions', () => {
  it('saves your subscription, and /api/me says you are subscribed', async () => {
    const { maya, call, me } = await scene({ vapidPublicKey: 'BPublicKey' });
    expect((await me()).push).toEqual({ vapidPublicKey: 'BPublicKey', subscribed: false });
    const sub = subscription();
    const res = await call('POST', sub);
    expect(res.status).toBe(200);
    expect(ActionResponse.parse(await res.json())).toEqual({ ok: true });
    expect(await rowsOf(maya.id)).toEqual([expect.objectContaining({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label: 'Chrome on macOS', failCount: 0 })]);
    expect((await me()).push).toEqual({ vapidPublicKey: 'BPublicKey', subscribed: true });
  });

  it('keeps one row per endpoint: subscribing again updates its keys and label and forgets its failures', async () => {
    const { maya, call } = await scene();
    const sub = subscription();
    await call('POST', sub);
    await prisma.pushSubscription.update({ where: { endpoint: sub.endpoint }, data: { failCount: 3 } });
    const again = { ...sub, keys: { p256dh: 'BNewKey', auth: 'newAuth' }, label: 'Chrome on macOS (work)' };
    expect((await call('POST', again)).status).toBe(200);
    expect(await rowsOf(maya.id)).toEqual([expect.objectContaining({ endpoint: sub.endpoint, p256dh: 'BNewKey', auth: 'newAuth', label: 'Chrome on macOS (work)', failCount: 0 })]);
  });

  it('moves an endpoint to whoever subscribes with it now (the same browser, signed in as someone else)', async () => {
    const { maya, call } = await scene();
    const leo = await makeUser({ login: 'leo' });
    const sub = subscription();
    await call('POST', sub);
    expect((await call('POST', sub, { cookie: await sessionCookieFor(leo.id), origin: ORIGIN })).status).toBe(200);
    expect(await rowsOf(maya.id)).toEqual([]);
    expect(await rowsOf(leo.id)).toEqual([expect.objectContaining({ endpoint: sub.endpoint })]);
  });

  it('refuses an endpoint the server must not call (not https, an IP address, localhost) with a 400, saving nothing', async () => {
    const { maya, call } = await scene();
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://169.254.169.254/latest']) {
      expect((await call('POST', subscription({ endpoint }))).status, endpoint).toBe(400);
    }
    expect((await call('POST', subscription({ label: '' }))).status).toBe(400);
    expect(await rowsOf(maya.id)).toEqual([]);
  });

  it("refuses another site's page with a 403, a CLI token and no session with a 401", async () => {
    const { maya, call } = await scene();
    expect((await call('POST', subscription(), { cookie: await sessionCookieFor(maya.id), origin: 'https://evil.example' })).status).toBe(403);
    const { raw } = await makeCliToken(maya.id);
    expect((await call('POST', subscription(), { authorization: `Bearer ${raw}` })).status).toBe(401);
    expect((await call('POST', subscription(), { origin: ORIGIN })).status).toBe(401);
    expect(await rowsOf(maya.id)).toEqual([]);
  });
});

describe('DELETE /api/push/subscriptions', () => {
  it('removes your subscription, and saying it again is still ok', async () => {
    const { maya, call, me } = await scene();
    const sub = subscription();
    await call('POST', sub);
    for (let i = 0; i < 2; i++) {
      const res = await call('DELETE', { endpoint: sub.endpoint });
      expect(res.status).toBe(200);
      expect(ActionResponse.parse(await res.json())).toEqual({ ok: true });
    }
    expect(await rowsOf(maya.id)).toEqual([]);
    expect((await me()).push.subscribed).toBe(false);
  });

  it("never removes someone else's", async () => {
    const { call } = await scene();
    const leo = await makeUser({ login: 'leo' });
    const leos = subscription();
    await call('POST', leos, { cookie: await sessionCookieFor(leo.id), origin: ORIGIN });
    expect((await call('DELETE', { endpoint: leos.endpoint })).status).toBe(200);
    expect(await rowsOf(leo.id)).toEqual([expect.objectContaining({ endpoint: leos.endpoint })]);
  });

  it("refuses another site's page with a 403", async () => {
    const { maya, call, cookie } = await scene();
    const sub = subscription();
    await call('POST', sub);
    expect((await call('DELETE', { endpoint: sub.endpoint }, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect(await rowsOf(maya.id)).toHaveLength(1);
  });
});

describe('after a push subscription changes', () => {
  it("tells your open tabs (me.update), so another tab's Settings page sees push.subscribed change; not after a refusal", async () => {
    const { maya, call, sendMeUpdate } = await scene({ vapidPublicKey: 'BPublicKey' });
    const sub = subscription();
    await call('POST', sub);
    expect(sendMeUpdate).toHaveBeenCalledWith(maya.id);
    sendMeUpdate.mockClear();
    await call('DELETE', { endpoint: sub.endpoint });
    expect(sendMeUpdate).toHaveBeenCalledWith(maya.id);
    sendMeUpdate.mockClear();
    expect((await call('POST', subscription({ endpoint: 'http://127.0.0.1/push' }))).status).toBe(400);
    expect(sendMeUpdate).not.toHaveBeenCalled();
  });
});

describe('GET /api/me', () => {
  it('has no Web Push public key when the server has no VAPID keys (push is off)', async () => {
    const { me } = await scene();
    expect((await me()).push).toEqual({ vapidPublicKey: null, subscribed: false });
  });
});
