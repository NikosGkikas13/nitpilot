# Service workers and installing the app (PWA)

**In one sentence:** a service worker is a small script the browser keeps for our site and runs on its own, even with every Nitpilot tab closed, so it's the only part of the web app that can receive a push and show a notification; with it, a manifest and icons, the browser also lets people install Nitpilot as an app.

The code: `apps/web/public/sw.js` (the service worker), `apps/web/src/push/register.ts` (installing it), `src/push/subscribe.ts` (turning push on and off), `src/push/install.ts` and `src/components/InstallCard/` (the install card), `src/components/IosHomeScreenSheet/` (the iPhone's Home Screen sheet), `public/manifest.webmanifest` and `public/icons/` (made by `scripts/render-icons.ts`). The server side of push is in `docs/why/web-push.md`.

## A service worker is a tiny program the browser keeps for you

Your React app lives inside a tab. Close the tab and every component, every effect, every `useState` is gone. Nothing of ours runs any more.

A service worker is different. The page asks the browser to install it once (`navigator.serviceWorker.register('/sw.js')`, in `register.ts`, called from `main.tsx`), and from then on the browser keeps that file for our site, separately from any tab. It isn't running all the time: the browser starts it when something happens that it signed up for, lets it handle that, and stops it again a little later. It has no DOM, no React, no `window`; it talks to the browser through `self` and events.

In React terms: it's like an event handler you registered with the browser instead of with a component. `self.addEventListener('push', …)` is an `onPush` prop that stays attached after the component (the tab) unmounts.

Ours listens to two events:

- **`push`**: the browser's push service delivered a message from our server (`{ title, body, url, tag }`). The worker shows it as a notification. `tag` is the chat's id, so a newer notification about the same chat replaces the older one instead of piling up.
- **`notificationclick`**: you clicked one. The worker focuses a Nitpilot window already showing that chat, or opens a new one.

It also has an `install` listener that calls `skipWaiting()`: when we deploy a new `sw.js`, the new version takes over at once instead of waiting until every tab is closed. That's safe because the worker keeps nothing an older page could depend on.

### No offline cache, on purpose

Most articles about service workers are about a third event, `fetch`, which lets the worker answer the page's requests from a cache, so the site opens offline. Ours has **no `fetch` listener** (a test checks), so every request goes to the network as if the worker didn't exist. Nitpilot is a live view of what agents are doing on GitHub; an inbox from yesterday, served from a cache, would be worse than an honest "Can't reach Nitpilot". A cache also brings the classic bug where people keep running an old version of the app. So: no cache, no such bug.

The server sends `sw.js` with `Cache-Control: no-cache` (like every file not under `assets/`, `apps/server/src/http/spa.ts`), so the browser notices a new version on the next visit.

## Why only a service worker can get a push with the tab closed

A push travels like this: our server → the browser maker's push service (Google, Mozilla, Apple) → the browser on your laptop or phone → our service worker. The last step needs code of ours that runs without a tab, and the service worker is the only such thing a website gets. That's why turning push on (`turnPushOn` in `subscribe.ts`) goes through it: `registration.pushManager.subscribe(...)` is called on the worker's registration, and the subscription it returns (an endpoint and two keys) belongs to the worker, not to the page. The page only hands it to our server (`POST /api/push/subscriptions`).

Browsers add two rules:

- **Every push must show a notification** (`userVisibleOnly: true`). A site can't use push to run code silently in the background. So `sw.js` shows something even for a push it can't read.
- **Asking needs a click.** `Notification.requestPermission()` only shows the prompt when the person just clicked something, which is why `turnPushOn` asks for permission first, before anything else that waits. "Block" is final for the page: only the person can undo it, in the browser's site settings, so the Settings page explains that instead of offering a button (`pushState()` answers `denied`).

Turning push off (`turnPushOff`) unsubscribes in the browser first, then tells the server. If the server can't be told, its next push to that browser gets a 410 from the push service and the server deletes the row itself (`web-push.md`). Signing out turns push off first (best effort, at most 2 seconds), so a shared computer doesn't keep showing the last person's notifications.

## What makes the app installable

"Install" means the browser can open Nitpilot in its own window with its own icon in the dock or on the home screen, like a native app. It's still the same website. A browser offers it when the site has:

1. **HTTPS** (or `localhost` / `127.0.0.1` while developing).
2. **A web app manifest** (`public/manifest.webmanifest`, linked from `index.html`): the app's name (from `BRAND`), `start_url: "/"` (the inbox), `display: "standalone"` (its own window, no address bar), its colors, and its icons.
3. **Icons**: 192 and 512 pixels, plus a *maskable* one. Android cuts a maskable icon to whatever shape the phone uses (a circle, a squircle), so it fills the whole square and keeps the mark inside the middle 80% (the "safe zone"). The SVG `public/icons/icon.svg` is the one source; `npm run icons -w apps/web` renders every PNG from it with Playwright's Chromium, and the PNGs are committed. At 32 px and below the icon drops its little diamond: the SVG has a media query that hides it at that size.

Chromium browsers then fire a `beforeinstallprompt` event. Left alone, Chrome shows its own small install bar. We keep the event instead (`src/push/install.ts`, started in `main.tsx` because the event can come before you're signed in) and show our own card when you're in the app: **Install** opens the browser's real install dialog, **Not now** is remembered in this browser. Inside the installed app (`display-mode: standalone`) the card never shows.

In React terms: `install.ts` is a tiny external store, like a Zustand store with one value, read with `useSyncExternalStore` by the card.

## The iOS Home Screen rule

Safari on iPhone and iPad does Web Push, but only for a site that has been **added to the Home Screen** and opened from there (iOS 16.4 and later). In the browser tab, `PushManager` doesn't even exist. Safari also never fires `beforeinstallprompt`, so no site can offer an Install button: the person has to do it from Safari's Share menu.

So on an iPhone or iPad outside the Home Screen app, `pushState()` answers `needs_home_screen` (checked before "unsupported", since the missing `PushManager` would otherwise say that), and the app shows the "Add Nitpilot to your Home Screen" sheet once after sign-in with the three steps, and again from Settings. Once opened from the Home Screen (`navigator.standalone` is true), push works as anywhere else. iPads that ask for the desktop site say they're a Mac; a "Mac" with a touch screen is treated as an iPad (`src/push/device.ts`).
