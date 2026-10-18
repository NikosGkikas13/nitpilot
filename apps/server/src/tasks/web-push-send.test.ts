import webpush from 'web-push';
import { describe, expect, it, vi } from 'vitest';
import { webPushSend } from './web-push-send';

// No network here: `sendNotification` is a stub that answers the way the web-push package does.
const vapid = { subject: 'mailto:admin@example.com', publicKey: 'BPublic', privateKey: 'private' };
const sub = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'BKey', auth: 'authKey' } };
const answering = (statusCode: number, body = '') => vi.fn(async () => {
  throw new webpush.WebPushError('Received unexpected response code', statusCode, {}, body, sub.endpoint);
});

describe('webPushSend', () => {
  it('signs with the VAPID keys and asks the push service to keep the message a day at most, with a 10-second timeout', async () => {
    const sendNotification = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
    expect(await webPushSend(vapid, sendNotification)(sub, '{"title":"Needs you"}')).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledWith(sub, '{"title":"Needs you"}', { vapidDetails: vapid, TTL: 86_400, timeout: 10_000, urgency: 'normal' });
  });

  it.each([404, 410])('calls a subscription gone when the push service answers %i', async (status) => {
    expect(await webPushSend(vapid, answering(status))(sub, '{}')).toEqual({ ok: false, gone: true, answered: true, error: `the push service answered ${status}` });
  });

  it('calls any other answer a failure that may pass, with what the service said', async () => {
    expect(await webPushSend(vapid, answering(429, 'Too many requests'))(sub, '{}')).toEqual({ ok: false, gone: false, answered: true, error: 'the push service answered 429: Too many requests' });
    expect(await webPushSend(vapid, answering(500))(sub, '{}')).toEqual({ ok: false, gone: false, answered: true, error: 'the push service answered 500' });
  });

  // `answered: false` means no reply came back, which is usually our side (the network, a bad key), so it isn't held
  // against the subscription.
  it('turns a network error or a timeout into an unanswered failure, never a throw', async () => {
    const timedOut = vi.fn(async () => {
      throw new Error('Socket timeout');
    });
    expect(await webPushSend(vapid, timedOut)(sub, '{}')).toEqual({ ok: false, gone: false, answered: false, error: 'Socket timeout' });
  });
});
