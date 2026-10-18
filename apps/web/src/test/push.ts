import { vi } from 'vitest';

/**
 * A pretend browser for push (src/push/): the parts of `navigator`, `Notification` and `PushManager` that subscribing
 * uses, installed with `vi.stubGlobal` (undo with `vi.unstubAllGlobals()`). Nothing reaches a real push service.
 */

export const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
/** A VAPID public key's shape: 65 bytes in base64url. */
export const VAPID_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

/** The browser's subscription object, as `pushManager.subscribe()` hands it out. */
export class FakeSubscription {
  readonly endpoint = ENDPOINT;
  constructor(
    private readonly manager: FakePushManager,
    readonly options: { applicationServerKey: ArrayBuffer | null; userVisibleOnly: boolean },
  ) {}
  toJSON() {
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'sharedSecret' } };
  }
  unsubscribe = vi.fn(async () => {
    this.manager.current = null;
    return true;
  });
}

export class FakePushManager {
  current: FakeSubscription | null = null;
  getSubscription = vi.fn(async () => this.current);
  subscribe = vi.fn(async (opts: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
    const key = opts.applicationServerKey;
    this.current = new FakeSubscription(this, { userVisibleOnly: opts.userVisibleOnly, applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer });
    return this.current;
  });
}

/**
 * A browser for these tests: the parts of `navigator`, `Notification` and `PushManager` that push uses. `permission`
 * is what the person decided so far; `answer` is what they click when asked.
 */
export function fakeBrowser(opts: { userAgent?: string; maxTouchPoints?: number; standalone?: boolean; serviceWorker?: boolean; pushManager?: boolean; permission?: NotificationPermission; answer?: NotificationPermission; registered?: boolean } = {}) {
  const pushManager = new FakePushManager();
  const registration = { pushManager };
  const registered = opts.registered ?? true;
  const serviceWorker = {
    getRegistration: vi.fn(async () => (registered ? registration : undefined)),
    register: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };
  vi.stubGlobal('navigator', {
    userAgent: opts.userAgent ?? CHROME_MAC,
    maxTouchPoints: opts.maxTouchPoints ?? 0,
    ...(opts.standalone ? { standalone: true } : {}),
    ...(opts.serviceWorker === false ? {} : { serviceWorker }),
  });
  class FakeNotification {
    static permission: NotificationPermission = opts.permission ?? 'default';
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = opts.answer ?? 'granted';
      return FakeNotification.permission;
    });
  }
  vi.stubGlobal('Notification', FakeNotification);
  if (opts.pushManager !== false) vi.stubGlobal('PushManager', FakePushManager);
  return { pushManager, serviceWorker, Notification: FakeNotification };
}

/**
 * Safari on an iPhone (outside the Home Screen app, unless `homeScreenApp`), for tests that render the whole app (which needs the rest of the
 * real `navigator`). Returns the function that makes jsdom's navigator its usual self again.
 */
export function pretendIphone(opts: { homeScreenApp?: boolean } = {}): () => void {
  Object.defineProperty(navigator, 'userAgent', { value: SAFARI_IPHONE, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  if (opts.homeScreenApp) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  return () => {
    // The own properties shadow jsdom's; deleting them brings jsdom's back.
    const own = navigator as { userAgent?: string; maxTouchPoints?: number; standalone?: boolean };
    delete own.userAgent;
    delete own.maxTouchPoints;
    delete own.standalone;
  };
}
