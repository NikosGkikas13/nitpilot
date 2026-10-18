// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { BRAND } from '@nitpilot/protocol';
import { describe, expect, it, vi } from 'vitest';

/** public/sw.js as the browser gets it: plain JavaScript, not bundled. */
const SOURCE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://nitpilot.test';

type Listener = (event: unknown) => void;
type WindowClient = { url: string; focus: ReturnType<typeof vi.fn> };

/**
 * Runs sw.js the way a browser would start it, with a pretend `self`: it records the listeners the file adds, and
 * stands in for showing notifications and for the open windows. No real worker, no real notification.
 */
function startWorker(windows: WindowClient[] = []) {
  const listeners = new Map<string, Listener[]>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    skipWaiting: vi.fn(async () => {}),
    registration: { showNotification: vi.fn(async () => {}) },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
  };
  vm.runInNewContext(SOURCE, { self, URL });

  /** Fire an event at the worker, and wait for everything it passed to `waitUntil`. */
  async function fire(type: string, event: object): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const listener of listeners.get(type) ?? []) listener({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return { self, listeners, fire };
}

/** A push as the push service delivers it: the server's JSON payload (Task 19's `PushPayload`). */
function pushEvent(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { data: { text: () => text, json: () => JSON.parse(text) as unknown } };
}

function clickEvent(url: unknown) {
  return { notification: { data: { url }, close: vi.fn() } };
}

const payload = { title: 'Ready for your approval', body: 'acme/shop-api#142', url: `${ORIGIN}/c/acme/shop-api/142`, tag: 'chat-142' };

describe('the service worker (public/sw.js)', () => {
  it('listens for push and notificationclick, and never for fetch: there is no offline cache', () => {
    const { listeners } = startWorker();
    expect(listeners.has('push')).toBe(true);
    expect(listeners.has('notificationclick')).toBe(true);
    expect(listeners.has('fetch')).toBe(false);
  });

  it('takes over from an older version at once when it installs', async () => {
    const { self, fire } = startWorker();
    await fire('install', {});
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it("shows a push as a notification with the payload's title, body, tag and url", async () => {
    const { self, fire } = startWorker();
    await fire('push', pushEvent(payload));
    expect(self.registration.showNotification).toHaveBeenCalledWith('Ready for your approval', {
      body: 'acme/shop-api#142',
      tag: 'chat-142',
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: `${ORIGIN}/c/acme/shop-api/142` },
    });
  });

  it('still shows something for a push it cannot read, since the browser insists on a visible notification', async () => {
    const { self, fire } = startWorker();
    await fire('push', pushEvent('not json'));
    await fire('push', { data: null });
    expect(self.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(self.registration.showNotification).toHaveBeenLastCalledWith(BRAND.name, {
      body: 'Something needs you.',
      icon: '/icons/icon-192.png',
      data: { url: `${ORIGIN}/` },
    });
  });

  it('only ever opens pages of its own site', async () => {
    const { self, fire } = startWorker();
    await fire('push', pushEvent({ ...payload, url: 'https://evil.example/phish' }));
    expect(self.registration.showNotification).toHaveBeenCalledWith('Ready for your approval', expect.objectContaining({ data: { url: `${ORIGIN}/` } }));
  });

  it('a click focuses a window already on that page', async () => {
    const other: WindowClient = { url: `${ORIGIN}/`, focus: vi.fn() };
    const chat: WindowClient = { url: `${ORIGIN}/c/acme/shop-api/142`, focus: vi.fn() };
    const { self, fire } = startWorker([other, chat]);
    const click = clickEvent(payload.url);
    await fire('notificationclick', click);
    expect(click.notification.close).toHaveBeenCalled();
    expect(chat.focus).toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
    // Windows the worker doesn't control count too: it never claims the tabs that were open before it.
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });

  it('a click opens the page in a new window when no window shows it', async () => {
    const inbox: WindowClient = { url: `${ORIGIN}/`, focus: vi.fn() };
    const { self, fire } = startWorker([inbox]);
    await fire('notificationclick', clickEvent(payload.url));
    expect(inbox.focus).not.toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/c/acme/shop-api/142`);
  });

  it('a click on a notification without a page opens the inbox', async () => {
    const { self, fire } = startWorker();
    await fire('notificationclick', clickEvent(undefined));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
