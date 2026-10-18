/*
 * Nitpilot's service worker (spec §16, docs/why/service-workers-and-pwa.md): a small program the browser keeps for
 * this site and wakes when a push arrives, even with every Nitpilot tab closed. It shows the push as a notification,
 * and a click on it opens that chat.
 *
 * Plain JavaScript, served as it is from public/ (never bundled), at /sw.js so it covers the whole site. On purpose
 * there is no `fetch` listener: no offline cache, every request goes to the network as if this file didn't exist
 * (the app needs the server anyway). src/sw.test.ts runs this file with a pretend `self`.
 */

/** The fallback title: BRAND.name (packages/protocol), which this plain file can't import. sw.test.ts checks it. */
const APP_NAME = 'Nitpilot';
const ICON = '/icons/icon-192.png';

// A new version of this file takes over at once, instead of waiting until every tab is closed. Safe, since it keeps
// no cache that an older page could depend on. (No `clients.claim()`: the worker never needs to control a page.)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('push', (event) => {
  event.waitUntil(showPush(event));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(openPage(typeof url === 'string' ? url : '/'));
});

/**
 * The server sends `{ title, body, url, tag }` (apps/server/src/tasks/push-notifier.ts). `tag` is the chat's id, so
 * a newer notification about the same chat replaces the older one instead of piling up, and `renotify` makes the
 * replacement alert again (a payload without a tag still shows, it just doesn't replace anything). The browser insists that every push shows something (`userVisibleOnly`), so one this
 * file can't read still shows a plain notification that opens the inbox.
 */
function showPush(event) {
  const payload = readPayload(event);
  if (!payload) {
    return self.registration.showNotification(APP_NAME, { body: 'Something needs you.', icon: ICON, data: { url: ownPage('/') } });
  }
  const options = { body: payload.body, icon: ICON, data: { url: ownPage(payload.url) } };
  // With a tag, a newer notification replaces the older one and alerts again. `renotify` without a tag makes the
  // browser throw, so both go together or neither.
  if (payload.tag) Object.assign(options, { tag: payload.tag, renotify: true });
  return self.registration.showNotification(payload.title, options);
}

/** The payload, or null when there's none or it isn't what the server sends. */
function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (!data || typeof data.title !== 'string' || typeof data.body !== 'string') return null;
    return { title: data.title, body: data.body, tag: typeof data.tag === 'string' ? data.tag : '', url: typeof data.url === 'string' ? data.url : '/' };
  } catch {
    return null;
  }
}

/** A full address on this site. Anything pointing elsewhere becomes the inbox: a click never leaves Nitpilot. */
function ownPage(url) {
  try {
    const page = new URL(url, self.location.origin);
    return page.origin === self.location.origin ? page.href : new URL('/', self.location.origin).href;
  } catch {
    return new URL('/', self.location.origin).href;
  }
}

/**
 * Focus a window already showing the page, else open it in a new one. `includeUncontrolled`: the tabs that were open
 * before this worker started aren't controlled by it, and still count.
 */
async function openPage(url) {
  const target = ownPage(url);
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => client.url === target);
  if (open) return open.focus();
  return self.clients.openWindow(target);
}
