import type { DeviceView, WebMe } from '@nitpilot/protocol';
import { VAPID_KEY } from './push';
import { fakeApi, type Answer } from './render';

/** maya, as the Settings page reads her: the default settings, 12 agent runs today, and a server with push keys. */
export const settingsMe: WebMe = {
  id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true,
  settings: { autoReview: true, autoAddress: false, dailyJobCap: 40 }, usedToday: 12, push: { vapidPublicKey: VAPID_KEY, subscribed: false }, onboarded: true,
};

/** One of maya's computers; pass only what a test cares about. */
export function device(over: Partial<DeviceView> = {}): DeviceView {
  return { id: 'tok_1', name: "Maya's MacBook Pro", lastSeenAt: new Date().toISOString(), online: true, agent: { id: 'claude-code', version: '2.1.290' }, ...over };
}

type Route = () => Answer | Promise<Answer>;

/**
 * The server the Settings page talks to: you (`me`), an empty inbox, your devices, and the push routes (both ok).
 * `routes` adds or replaces any of them. Returns the fetch mock.
 */
export function serveSettings(opts: { me?: WebMe | Route; devices?: DeviceView[] | Route; routes?: Record<string, Route> } = {}) {
  const me = opts.me ?? settingsMe;
  const devices = opts.devices ?? [];
  return fakeApi({
    'GET /api/me': typeof me === 'function' ? me : (): Answer => [200, me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'GET /api/devices': typeof devices === 'function' ? devices : (): Answer => [200, { devices }],
    'POST /api/push/subscriptions': (): Answer => [200, { ok: true }],
    'DELETE /api/push/subscriptions': (): Answer => [200, { ok: true }],
    ...opts.routes,
  });
}

/** The requests sent to a path, as "METHOD body". */
export function sent(fetch: ReturnType<typeof fakeApi>, path: string): string[] {
  return fetch.mock.calls.filter(([url]) => String(url) === path).map(([, init]) => `${init?.method ?? 'GET'} ${String(init?.body ?? '')}`);
}
