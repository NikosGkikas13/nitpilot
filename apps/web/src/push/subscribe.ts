import { ActionResponse, type PushSubscriptionRequest, type PushUnsubscribeRequest } from '@nitpilot/protocol';
import { api } from '../api/client';
import { deviceLabel, isIos, isStandalone } from './device';
import { registerServiceWorker } from './register';

/**
 * Where push stands in this browser (docs/why/service-workers-and-pwa.md):
 * - `unsupported`: no service workers or no Web Push here.
 * - `needs_home_screen`: an iPhone or iPad outside the Home Screen app; iOS only allows push from there.
 * - `denied`: the person blocked notifications for this site. Only they can undo it, in the browser's settings.
 * - `off` / `on`: whether this browser holds a push subscription (and the permission to show it).
 */
export type PushState = 'unsupported' | 'needs_home_screen' | 'denied' | 'off' | 'on';

/** How long Sign out waits for this browser's subscription to be removed before it goes ahead anyway. */
export const SIGN_OUT_WAIT_MS = 2000;

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis;
}

/** This browser's push subscription for the site, or null. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  // First: iOS Safari outside the Home Screen app has no PushManager at all, and "unsupported" would be wrong.
  if (isIos() && !isStandalone()) return 'needs_home_screen';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const subscription = await currentSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

/** A base64url key (how the server sends its VAPID public key) as the bytes `pushManager.subscribe()` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current || current.byteLength !== wanted.length) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((byte, i) => byte === wanted[i]);
}

/** The registration, once its worker is active: `subscribe()` refuses before that. Registers it if needed. */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const registered = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker());
  if (!registered) throw new Error("This browser didn't start Nitpilot's service worker, so push can't work here. Reload the page and try again.");
  // `ready` waits for an active worker. Only awaited once one is registered: with none, it would wait forever.
  return navigator.serviceWorker.ready;
}

/**
 * Turn push on for this browser: ask for permission, subscribe at the browser's push service with the server's VAPID
 * public key (`WebMe.push.vapidPublicKey`), and give the server the subscription, labelled for this browser.
 *
 * Call it straight from a click: browsers only show the permission prompt for one. A "Block" or a closed prompt
 * subscribes nothing and sends nothing (read `pushState()` again to see which). If the server doesn't keep the
 * subscription, the browser's is taken back too, so the two never disagree, and the error is thrown.
 */
export async function turnPushOn(vapidPublicKey: string): Promise<void> {
  if (!pushSupported()) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const registration = await activeRegistration();
  const key = keyBytes(vapidPublicKey);
  // A subscription made with another key (the server's keys changed) can't be reused: subscribe() would refuse.
  const existing = await registration.pushManager.getSubscription();
  if (existing && !sameKey(existing.options.applicationServerKey, key)) await existing.unsubscribe();

  // userVisibleOnly: every push shows a notification (public/sw.js); browsers allow nothing else.
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { keys } = subscription.toJSON();
  const body: PushSubscriptionRequest = { endpoint: subscription.endpoint, keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' }, label: deviceLabel() };
  try {
    await api.send('POST', '/api/push/subscriptions', body, ActionResponse);
  } catch (err) {
    await subscription.unsubscribe().catch(() => false);
    throw err;
  }
}

/**
 * Turn push off for this browser: unsubscribe here first, then tell the server to forget it. In that order, because
 * if the server can't be told, its next push to this browser answers 410 and the server deletes the row itself
 * (docs/why/web-push.md). The server's error, if any, is thrown; the browser is off either way.
 */
export async function turnPushOff(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  const body: PushUnsubscribeRequest = { endpoint: subscription.endpoint };
  await subscription.unsubscribe();
  await api.send('DELETE', '/api/push/subscriptions', body, ActionResponse);
}

/**
 * Before signing out: remove this browser's subscription, so a shared browser stops getting the last person's
 * notifications. Best effort. It never throws and never holds up signing out for longer than `ms`.
 */
export async function turnPushOffBeforeSignOut(ms = SIGN_OUT_WAIT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([turnPushOff().catch(() => {}), limit]);
  clearTimeout(timer);
}
