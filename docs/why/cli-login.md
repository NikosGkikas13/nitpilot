# How `nitpilot login` connects your terminal (device login)

**In one sentence:** the terminal can't open a GitHub sign-in itself, so it gets a short code, you approve that code in a browser where you're already signed in, and the terminal then picks up its own token.

This is the same "device flow" you've seen on a TV app that says "go to example.com/activate and enter WDJB-MJHT".

## The steps

1. **The CLI asks to log in.** `POST /api/cli/login` with the device name. The server makes two codes (`auth/cli-login.ts`):
   - a long secret **device code**, which only the CLI knows. We store only its hash;
   - a short **user code** like `WDJB-MJHT`, which you read and compare.
2. **You approve in the browser.** The CLI opens `/cli/approve?code=WDJB-MJHT` (with `nitpilot login --no-open` it only prints it, so you can paste it into the browser signed in as the right account). That's a page of the web app (`apps/web/src/routes/Approve/Approve.tsx`). If you're not signed in, it sends you through GitHub sign-in first and you come back to the same address (`docs/why/oauth-pkce.md`). The page reads the login with `GET /api/cli/requests/WDJB-MJHT`, shows the code and the device's name, and counts down the 10 minutes. You check that the code matches your terminal and press Approve, which sends `POST /api/cli/requests/WDJB-MJHT {decision: 'approve'}` (`apps/server/src/http/routes/cli-requests.ts`).
3. **The CLI polls.** Every 2 seconds it sends its device code to `POST /api/cli/login/poll` and gets `pending`, `denied`, `expired`, or `approved` plus a `nit_…` token. Codes expire after 10 minutes.
4. **From then on** the CLI sends `Authorization: Bearer nit_…` on every request. `requireCliToken` (`auth/cli-token.ts`) hashes it, looks it up, and rejects revoked tokens. `DELETE /api/cli/token` revokes the token that sent it.

## Why the page is careful

- **Two codes, and you compare them.** Anyone can start a login and send you its link ("click here to log in!"). If you approved without looking, their terminal would get a token for *your* account. The short code is the check: it's printed in *your* terminal, so if the page shows a code your terminal didn't print, it isn't your login. Press Deny. That's also why the page says "Only approve if you just ran npx nitpilot login".
- **Only the device code's hash is stored.** The long device code is the thing that collects the token. We keep only its hash (like a password), so someone who reads the database can't use a waiting login. The short code isn't secret (it's on screen), so it's stored as is.
- **Approving needs the session cookie and our Origin.** Approving is a change made with your cookie, and a browser sends that cookie with any request to us, even one another site's page starts. So the POST checks the `Origin` header (`requireSameOrigin`, `lib/csrf.ts`): only our own page may press Approve. A CLI token can't approve at all (it gets 401): the whole point is that a *person* says yes.
- **A second click is harmless.** Approve and Deny change only a login that is still pending (`updateMany` with `status: 'pending'`, the compare-and-swap below). If it was already decided, or the 10 minutes ran out, the answer is just how the login stands now, so a double click or an old tab shows the result instead of an error.
- **No frames.** Every page of the web app is sent with `Content-Security-Policy: frame-ancestors 'none'` (`http/spa.ts`), so another site can't show the approve page invisibly inside its own and trick you into clicking Approve (clickjacking).

## The token is handed out exactly once

The first poll after approval gets the token; every later poll gets `expired`. Two things make that hold even if two polls arrive at the same moment:

- **Compare-and-swap:** we change the request from `approved` to `consumed` with `updateMany(where: status = 'approved')`. Only one poll can win that change; the other sees `count === 0`.
- **A transaction:** marking it `consumed` and creating the `CliToken` row happen inside `prisma.$transaction`. A transaction is all-or-nothing: if creating the token fails, the status change is undone too, so you never end up with a "consumed" login and no token.

## Limits and cleanup

- **A rate limit.** Each `POST /api/cli/login` writes a row, so anyone could fill the table by calling it in a loop. One client address may start 10 logins a minute (`lib/rate-limit.ts`); the 11th gets `429 Too Many Requests`. The count lives in memory, which is fine because there is one server process (spec §7). It works like a "sliding window": we remember when each recent request came in and count the ones from the last 60 seconds.
- **Cleanup.** A login request is useless 10 minutes after it was made, so the hourly purge (`ingest/record.ts`) deletes the ones older than a day.

## The React analogy

- Polling is a `useEffect` with `setInterval(fetchStatus, 2000)` that stops once the status isn't `pending`.
- The page's countdown is the same idea the other way round: a one-second `setInterval` re-renders the card, and when the time left reaches zero the card shows Expired by itself, without asking the server (the server would say expired too).
- A transaction is like a reducer that returns either the whole new state or the old one, never something in between.
- `requireCliToken` is middleware, like a route guard (`<RequireAuth>`) that runs before the page and redirects if you're not allowed in.
