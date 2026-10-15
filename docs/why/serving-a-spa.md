# Serving the web app from the API server

**In one sentence:** the Nitpilot server hands out the built React app itself, from the same address as its API, and answers every app URL it doesn't know with the app's `index.html` (spec §7, `apps/server/src/http/spa.ts`).

## What a "build" is

`npm run build -w apps/web` turns the React code into plain files in `apps/web/dist`: one `index.html`, and JavaScript, CSS and fonts under `assets/`. A browser needs nothing else. Something has to send those files when the browser asks, and in Nitpilot that something is the server that already runs the API, so there is still one process to deploy.

## Why the same address (origin) matters

An origin is scheme + host + port: `https://nitpilot.dev` and `https://api.nitpilot.dev` are two origins; so are `localhost:5173` and `localhost:8787`.

- **The sign-in cookie just works.** The browser sends a site's cookie with requests to that same origin. With the app and the API on one origin, every `fetch('/api/…')` carries the session, with no cross-site cookie settings.
- **No CORS.** A page may call another origin only if that origin says so in special headers (CORS). On one origin there's nothing to allow, so nothing to get wrong.

## The fallback: why every app URL gets `index.html`

The app has its own routes (`/`, `/c/octo/sandbox/42`, `/settings`), but there is no file called `c/octo/sandbox/42`. React Router reads the address bar once the app loads. So for any GET the server doesn't know, it sends `index.html`, the app starts, and the router shows the right screen. That is why a link in a GitHub summary comment opens the chat directly.

Two rules keep the fallback honest:

- **The server's own paths never fall back.** A typo under `/api/…`, `/auth/…`, `/github/…`, `/webhooks/…` or `/ws/…` gets a JSON 404. Otherwise a broken API call would get a 200 with a web page in it, and the app would choke on it in a confusing way.
- **Files come only from `dist`.** A path such as `/..%2f..%2f.env` is resolved and refused if it would leave the folder, however it's spelled.

Every page and file is also sent with a Content-Security-Policy that limits what the app may load and run: see `content-security-policy.md`.

## Caching

Vite puts a content hash in every file name under `assets/` (`index-Dywsqop4.js`): a new build means a new name. So those are cached for a year. `index.html`, the service worker and the manifest keep their names across builds, so the browser must check them every time (`no-cache`), or an old `index.html` would point at files that no longer exist.

## In development

You run two things: the API server on port 8787 and Vite on port 5173, which rebuilds as you type. Vite **proxies** the server's paths (`/api`, `/auth`, `/github`, `/ws`, plus the two pages the server still renders for now) to 8787 (`apps/web/vite.config.ts`). The browser only ever talks to 5173, so it's one origin there too. That's why `PUBLIC_URL` is `http://localhost:5173` in development: GitHub's sign-in sends you back to that address, and Vite passes the callback on to the server.

## The React analogy

The fallback is the server side of client-side routing. It's like a `<Route path="*">` at the very end of your routes, except that on the server it doesn't show "not found": it boots the app, and the app's own routes decide what to show.
