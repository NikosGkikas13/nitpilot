# Content-Security-Policy: what the web app is allowed to load and run

**In one sentence:** every page and file the server sends carries a `Content-Security-Policy` header, an allow-list that tells the browser what the page may load or run, and anything not on the list is refused (spec §10, `contentSecurityPolicy()` in `apps/server/src/http/spa.ts`).

## What it is, and why Nitpilot needs it

A CSP is a header the server sends with a page. The browser reads it and enforces it: "scripts only from my own origin", "images only from here and there", and so on. A request or script that breaks a rule is blocked, and the browser logs a violation in the console.

Nitpilot shows text written by AI agents and by other people: point titles, replies, PR descriptions. React escapes text, so `<script>` in a reply shows up as plain text. But if some of it ever slipped into the page as real HTML, the CSP is the second line of defence: the browser still refuses to run an inline script, and still refuses to send data to a server that isn't on the list.

## What each directive allows (`spa.ts`)

| Directive | Allows | Why |
| --- | --- | --- |
| `default-src 'self'` | Anything not listed below comes only from our own origin. Because `script-src` isn't listed, **scripts** fall under this: only our own files, no inline `<script>`, no `eval`. | The safe default, so a forgotten case is blocked rather than open. |
| `connect-src 'self' ws(s)://<host of PUBLIC_URL>` | `fetch('/api/…')` to our origin, and the WebSocket to the same host. | The app talks to nothing else. `wss` when `PUBLIC_URL` is https, `ws` when it's http (development). |
| `img-src 'self' data: https://avatars.githubusercontent.com` | Our own images, small `data:` images, and GitHub profile pictures. | Avatars come from GitHub. |
| `style-src 'self' 'unsafe-inline'` | Our own CSS files, and inline `style="…"` attributes. | React's `style={{ … }}` writes inline styles. |
| `font-src 'self'` | Fonts from our own files only. | No `data:` fonts (see the Vite example below). |
| `base-uri 'self'` | A page can't change what relative URLs resolve against with a `<base>` tag. | Closes a trick for redirecting our own relative links. |
| `form-action 'self'` | Forms post only to us. | A form injected into the page can't send data elsewhere. |
| `frame-ancestors 'none'` | No other site may show our pages in a frame. | Clickjacking: see `docs/why/transcript-page.md`. |

## Why styles may be inline but scripts may not

A malicious script can steal a session or call the API as you. A malicious style can mostly only change how things look. Since React writes inline `style` attributes all the time, allowing them (`'unsafe-inline'` for styles) costs little. Allowing inline **scripts** would remove most of what the CSP protects against, so they stay blocked.

The accepted trade-off: because there is no inline `<script>`, the page can't apply the saved theme before the CSS paints. The app's own script applies it (`apps/web/src/theme.ts`), so someone who chose dark on a light-theme system can see a brief light flash on a cold load.

## Two worked examples

1. **zod and `new Function`** (`apps/web/src/zod-setup.ts`). zod tries `new Function('')` to compile faster validators. Evaluating a string as code is exactly what the policy forbids, so the browser logged a violation on every page load, even though zod caught the refusal and carried on. The fix is in the code, not the policy: `z.config({ jitless: true })` tells zod not to try.
2. **Fonts as `data:` URLs** (`apps/web/vite.config.ts`). Vite normally inlines small files into the JavaScript as `data:` URLs. `font-src` doesn't allow `data:`, so an inlined font would be blocked. `assetsInlineLimit: 0` makes Vite always emit real files, which `'self'` allows.

## The rule

If the browser console shows a CSP violation, **fix the code, don't widen the policy.** Adding `'unsafe-eval'` or `'unsafe-inline'` for scripts to make a message go away removes the protection for the whole app. If something truly needs a new source (a new image host, say), change `contentSecurityPolicy()` on purpose, in one place, and update this table and the test in `spa.test.ts`.

## The React analogy

It's like an ESLint config for what the browser lets your page do, except it's enforced at run time in the user's browser, by the browser itself. A rule that someone else's text could break gets caught there even if every check in your code missed it.
