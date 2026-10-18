import webpush from 'web-push';
import type { VapidDetails } from '../lib/env';

/** Where one browser's pushes go, and the keys only that browser can decrypt with (from its `PushSubscription`). */
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };

/**
 * How a send went. `gone`: the push service says this subscription no longer exists (404 or 410: site data cleared,
 * permission revoked, the browser uninstalled), so the row should be deleted. `answered`: the push service replied
 * with an HTTP status; false means no reply came back (a network error, a timeout, a key the encryption refused), which
 * is usually our own side and so isn't held against the subscription.
 */
export type PushResult = { ok: true } | { ok: false; gone: boolean; answered: boolean; error: string };

/** Send one encrypted Web Push. Never throws: a failure is an answer. Tests pass a fake; production uses `webPushSend`. */
export type PushSend = (target: PushTarget, payload: string) => Promise<PushResult>;

/**
 * - `TTL`: the push service keeps a message for a phone that's off for a day at most; a ping weeks late is noise.
 * - `timeout`: a push service that stops answering can't hold up the notify task (web-push's socket timeout, in ms).
 * - `urgency`: normal; nothing here is worth waking a phone in power-saving mode.
 */
const PUSH_OPTIONS = { TTL: 24 * 60 * 60, timeout: 10_000, urgency: 'normal' } as const;

/**
 * The real sender (docs/why/web-push.md): the web-push package signs the request with our VAPID keys, encrypts the
 * payload for the browser's keys, and POSTs it to the push service. `sendNotification` is only replaced in tests.
 */
export function webPushSend(vapid: VapidDetails, sendNotification = webpush.sendNotification): PushSend {
  return async (target, payload) => {
    try {
      await sendNotification(target, payload, { vapidDetails: vapid, ...PUSH_OPTIONS });
      return { ok: true };
    } catch (err) {
      if (err instanceof webpush.WebPushError) {
        const gone = err.statusCode === 404 || err.statusCode === 410;
        const said = err.body ? `: ${err.body.slice(0, 200)}` : '';
        return { ok: false, gone, answered: true, error: `the push service answered ${err.statusCode}${said}` };
      }
      // A network error, a timeout, or keys the encryption refused: no answer from the push service.
      return { ok: false, gone: false, answered: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}
