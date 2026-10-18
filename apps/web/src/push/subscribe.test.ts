import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINT, fakeBrowser, SAFARI_IPHONE, VAPID_KEY } from '../test/push';
import { fakeApi, type Answer } from '../test/render';
import { keyBytes, pushState, turnPushOff, turnPushOffBeforeSignOut, turnPushOn } from './subscribe';

/** The server's push routes (Task 19), answering `{ ok: true }`. */
function servePush(answer: Answer = [200, { ok: true }]) {
  return fakeApi({ 'POST /api/push/subscriptions': () => answer, 'DELETE /api/push/subscriptions': () => answer });
}

function sentBody(fetch: ReturnType<typeof fakeApi>, call = 0): unknown {
  return JSON.parse(String(fetch.mock.calls[call]![1]!.body));
}

afterEach(() => vi.unstubAllGlobals());

describe('pushState', () => {
  it('is unsupported without service workers or push', async () => {
    fakeBrowser({ serviceWorker: false });
    expect(await pushState()).toBe('unsupported');
    vi.unstubAllGlobals();
    fakeBrowser({ pushManager: false });
    expect(await pushState()).toBe('unsupported');
  });

  it("needs the Home Screen on an iPhone or iPad that isn't running the installed app, whatever else it has", async () => {
    fakeBrowser({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5, pushManager: false });
    expect(await pushState()).toBe('needs_home_screen');
    vi.unstubAllGlobals();
    fakeBrowser({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', maxTouchPoints: 5 });
    expect(await pushState()).toBe('needs_home_screen');
  });

  it('works like anywhere else in the Home Screen app', async () => {
    fakeBrowser({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5, standalone: true });
    expect(await pushState()).toBe('off');
  });

  it('is denied when the person blocked notifications for this site', async () => {
    fakeBrowser({ permission: 'denied' });
    expect(await pushState()).toBe('denied');
  });

  it('is off until this browser has a subscription and the permission', async () => {
    fakeBrowser({ permission: 'default' });
    expect(await pushState()).toBe('off');
    vi.unstubAllGlobals();
    fakeBrowser({ permission: 'granted', registered: false });
    expect(await pushState()).toBe('off');
  });

  it('is on once this browser is subscribed', async () => {
    const browser = fakeBrowser({ permission: 'granted' });
    servePush();
    await turnPushOn(VAPID_KEY);
    expect(await pushState()).toBe('on');
    expect(browser.pushManager.current).not.toBeNull();
  });
});

describe('turnPushOn', () => {
  it("asks for permission, subscribes with the server's key, and sends the subscription with a label for this browser", async () => {
    const browser = fakeBrowser();
    const fetch = servePush();
    await turnPushOn(VAPID_KEY);
    expect(browser.Notification.requestPermission).toHaveBeenCalled();
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('/api/push/subscriptions');
    expect(fetch.mock.calls[0]![1]!.method).toBe('POST');
    expect(sentBody(fetch)).toEqual({ endpoint: ENDPOINT, keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'sharedSecret' }, label: 'Chrome on macOS' });
  });

  it("subscribes nothing and sends nothing when the person doesn't allow notifications", async () => {
    for (const answer of ['denied', 'default'] as const) {
      const browser = fakeBrowser({ answer });
      const fetch = servePush();
      await turnPushOn(VAPID_KEY);
      expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it("takes the subscription back when the server doesn't keep it, so the switch doesn't read on for nothing", async () => {
    const browser = fakeBrowser();
    servePush([400, { error: { code: 'bad_request', message: 'endpoint: must be an https address of a push service' } }]);
    await expect(turnPushOn(VAPID_KEY)).rejects.toThrow('endpoint: must be an https address of a push service');
    expect(browser.pushManager.current).toBeNull();
  });

  it("replaces a subscription made with another server key (the server's keys changed)", async () => {
    const browser = fakeBrowser({ permission: 'granted' });
    servePush();
    const old = await browser.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array([4, 1, 2, 3]) });
    browser.pushManager.subscribe.mockClear();
    await turnPushOn(VAPID_KEY);
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('registers the service worker first if it is not registered yet', async () => {
    const browser = fakeBrowser({ registered: false });
    servePush();
    await turnPushOn(VAPID_KEY);
    expect(browser.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(browser.pushManager.subscribe).toHaveBeenCalled();
  });
});

describe('turnPushOff', () => {
  it("unsubscribes this browser, then tells the server to forget it", async () => {
    const browser = fakeBrowser({ permission: 'granted' });
    const fetch = servePush();
    await turnPushOn(VAPID_KEY);
    const sub = browser.pushManager.current!;
    await turnPushOff();
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![1]!.method).toBe('DELETE');
    expect(sentBody(fetch, 1)).toEqual({ endpoint: ENDPOINT });
    expect(await pushState()).toBe('off');
  });

  it('does nothing when this browser has no subscription', async () => {
    fakeBrowser({ permission: 'granted' });
    const fetch = servePush();
    await turnPushOff();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    fakeBrowser({ serviceWorker: false });
    await turnPushOff();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('turnPushOffBeforeSignOut', () => {
  it('never throws, and gives up waiting after the time limit', async () => {
    fakeBrowser({ permission: 'granted' });
    servePush();
    await turnPushOn(VAPID_KEY);
    // The server never answers the DELETE.
    fakeApi({ 'DELETE /api/push/subscriptions': () => new Promise<Answer>(() => {}) });
    await expect(turnPushOffBeforeSignOut(20)).resolves.toBeUndefined();
    // Subscribed again, and this time the server fails the DELETE.
    servePush();
    await turnPushOn(VAPID_KEY);
    const fetch = fakeApi({ 'DELETE /api/push/subscriptions': () => [500, { error: { code: 'internal', message: 'boom' } }] });
    await expect(turnPushOffBeforeSignOut(20)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
