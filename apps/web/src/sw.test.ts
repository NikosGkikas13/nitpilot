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
function startWorker(windows: WindowClient[] = [], fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }))) {
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
  vm.runInNewContext(SOURCE, { self, URL, fetch });

  /** Fire an event at the worker, and wait for everything it passed to `waitUntil`. */
  async function fire(type: string, event: object): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const listener of listeners.get(type) ?? []) listener({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return { self, listeners, fire, fetch };
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

  it('a payload without a tag (or with an empty one) still shows its title and body, with no tag and no renotify', async () => {
    const { self, fire } = startWorker();
    await fire('push', pushEvent({ title: payload.title, body: payload.body, url: payload.url }));
    await fire('push', pushEvent({ ...payload, tag: '' }));
    const plain = { body: 'acme/shop-api#142', icon: '/icons/icon-192.png', data: { url: `${ORIGIN}/c/acme/shop-api/142` } };
    expect(self.registration.showNotification).toHaveBeenNthCalledWith(1, 'Ready for your approval', plain);
    expect(self.registration.showNotification).toHaveBeenNthCalledWith(2, 'Ready for your approval', plain);
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

  it('a click on a notification that points at another site opens the inbox instead', async () => {
    const { self, fire } = startWorker();
    await fire('notificationclick', clickEvent('https://evil.example/phish'));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it('a click on a notification without a page opens the inbox', async () => {
    const { self, fire } = startWorker();
    await fire('notificationclick', clickEvent(undefined));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  describe('Resolve / Keep open buttons (one escalated point)', () => {
    const decision = { ...payload, chatId: 'chat-142', point: 2, actions: ['resolve', 'continue'] };
    const chatUrl = `${ORIGIN}/c/acme/shop-api/142`;

    function buttonClick(action: string, data: object = { url: chatUrl, chatId: 'chat-142', point: 2 }) {
      return { action, notification: { data, body: 'acme/shop-api#142', tag: 'chat-142', close: vi.fn() } };
    }

    it('shows the buttons the payload allows, "continue" as Keep open, and keeps what a click needs', async () => {
      const { self, fire } = startWorker();
      await fire('push', pushEvent(decision));
      expect(self.registration.showNotification).toHaveBeenCalledWith('Ready for your approval', {
        body: 'acme/shop-api#142',
        tag: 'chat-142',
        renotify: true,
        icon: '/icons/icon-192.png',
        actions: [
          { action: 'resolve', title: 'Resolve' },
          { action: 'continue', title: 'Keep open' },
        ],
        data: { url: chatUrl, chatId: 'chat-142', point: 2 },
      });
    });

    it('shows only the one button a PR author gets', async () => {
      const { self, fire } = startWorker();
      await fire('push', pushEvent({ ...decision, actions: ['continue'] }));
      expect(self.registration.showNotification).toHaveBeenCalledWith(
        'Ready for your approval',
        expect.objectContaining({ actions: [{ action: 'continue', title: 'Keep open' }] }),
      );
    });

    it('shows no buttons without actions, with unknown ones, or without a chat and point', async () => {
      const { self, fire } = startWorker();
      await fire('push', pushEvent(payload));
      await fire('push', pushEvent({ ...decision, actions: ['merge'] }));
      await fire('push', pushEvent({ ...decision, point: undefined }));
      await fire('push', pushEvent({ ...decision, chatId: 42 }));
      for (const [, options] of self.registration.showNotification.mock.calls as unknown as [string, object][]) {
        expect(options).not.toHaveProperty('actions');
        expect(options).toEqual(expect.objectContaining({ data: { url: chatUrl } }));
      }
    });

    it.each([
      ['resolve', 'P2 resolved'],
      ['continue', 'P2 kept open'],
    ])('%s POSTs to its route with the cookie, then quietly replaces the notification', async (action, title) => {
      const { self, fire, fetch } = startWorker();
      const click = buttonClick(action);
      await fire('notificationclick', click);
      expect(click.notification.close).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/api/chats/chat-142/points/2/${action}`, { method: 'POST', credentials: 'include' });
      expect(self.registration.showNotification).toHaveBeenCalledWith(title, {
        body: 'acme/shop-api#142',
        tag: 'chat-142',
        icon: '/icons/icon-192.png',
        data: { url: chatUrl },
      });
      expect(self.clients.openWindow).not.toHaveBeenCalled();
    });

    it.each([
      ['not signed in', async () => new Response(null, { status: 401 })],
      ['not allowed', async () => new Response(null, { status: 403 })],
      ['already decided', async () => new Response(null, { status: 409 })],
      ['offline', async (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'))],
    ])('opens the chat when the POST fails (%s)', async (_why, answer) => {
      const { self, fire } = startWorker([], vi.fn(answer));
      await fire('notificationclick', buttonClick('resolve'));
      expect(self.registration.showNotification).not.toHaveBeenCalled();
      expect(self.clients.openWindow).toHaveBeenCalledWith(chatUrl);
    });

    it('an unknown button, or one without a chat and point, opens the chat and posts nothing', async () => {
      const { self, fire, fetch } = startWorker();
      await fire('notificationclick', buttonClick('merge'));
      await fire('notificationclick', buttonClick('resolve', { url: chatUrl }));
      expect(fetch).not.toHaveBeenCalled();
      expect(self.clients.openWindow).toHaveBeenCalledTimes(2);
      expect(self.clients.openWindow).toHaveBeenCalledWith(chatUrl);
    });

    it('a tap on the body (no button) still just opens the chat', async () => {
      const { self, fire, fetch } = startWorker();
      await fire('notificationclick', buttonClick(''));
      expect(fetch).not.toHaveBeenCalled();
      expect(self.clients.openWindow).toHaveBeenCalledWith(chatUrl);
    });
  });
});
