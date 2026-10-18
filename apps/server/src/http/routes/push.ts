import { PushSubscriptionRequest, PushUnsubscribeRequest, type ActionResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../errors';

/**
 * `POST` and `DELETE /api/push/subscriptions` (spec §10 "Personal", docs/why/web-push.md): the Settings page's push
 * switch saves this browser's Web Push subscription, or removes it. Only the web app's session cookie may: a CLI
 * token is answered as if no one were signed in, like `PUT /api/me/settings`. The endpoint is checked by the schema
 * (an https name, never an IP address or localhost), since the server will POST to it.
 */
export function pushRoutes(): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();
  const ok: ActionResponse = { ok: true };

  app.post('/api/push/subscriptions', requireUser, requireSameOrigin, async (c) => {
    if (c.get('via') !== 'session') throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    const { endpoint, keys, label } = PushSubscriptionRequest.parse(await c.req.json());
    const userId = c.get('user').id;
    // One row per endpoint. Subscribing again (new keys, or the same browser now signed in as someone else) updates
    // it, moves it to whoever is signed in, and forgets its failures.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, label },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth, label, failCount: 0 },
    });
    return c.json(ok);
  });

  app.delete('/api/push/subscriptions', requireUser, requireSameOrigin, async (c) => {
    if (c.get('via') !== 'session') throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    const { endpoint } = PushUnsubscribeRequest.parse(await c.req.json());
    // Only your own: someone else's endpoint is left alone, with the same answer, so this never says whose it is.
    // Removing one that is already gone is fine too: the switch is off either way.
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: c.get('user').id } });
    return c.json(ok);
  });

  return app;
}
