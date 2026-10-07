# How `nitpilot login` connects your terminal (device login)

**In one sentence:** the terminal can't open a GitHub sign-in itself, so it gets a short code, you approve that code in a browser where you're already signed in, and the terminal then picks up its own token.

This is the same "device flow" you've seen on a TV app that says "go to example.com/activate and enter WDJB-MJHT".

## The steps

1. **The CLI asks to log in.** `POST /api/cli/login` with the device name. The server makes two codes (`auth/cli-login.ts`):
   - a long secret **device code**, which only the CLI knows. We store only its hash;
   - a short **user code** like `WDJB-MJHT`, which you read and compare.
2. **You approve in the browser.** The CLI opens `/cli/approve?code=WDJB-MJHT`. If you're not signed in, you go through GitHub sign-in first and come back (`docs/why/oauth-pkce.md`). You check that the code matches your terminal and press Approve. That POST is accepted only from our own pages (`lib/csrf.ts`).
3. **The CLI polls.** Every 2 seconds it sends its device code to `POST /api/cli/login/poll` and gets `pending`, `denied`, `expired`, or `approved` plus a `nit_…` token. Codes expire after 10 minutes.
4. **From then on** the CLI sends `Authorization: Bearer nit_…` on every request. `requireCliToken` (`auth/cli-token.ts`) hashes it, looks it up, and rejects revoked tokens. `DELETE /api/cli/token` revokes the token that sent it.

## The token is handed out exactly once

The first poll after approval gets the token; every later poll gets `expired`. Two things make that hold even if two polls arrive at the same moment:

- **Compare-and-swap:** we change the request from `approved` to `consumed` with `updateMany(where: status = 'approved')`. Only one poll can win that change; the other sees `count === 0`.
- **A transaction:** marking it `consumed` and creating the `CliToken` row happen inside `prisma.$transaction`. A transaction is all-or-nothing: if creating the token fails, the status change is undone too, so you never end up with a "consumed" login and no token.

## The React analogy

- Polling is a `useEffect` with `setInterval(fetchStatus, 2000)` that stops once the status isn't `pending`.
- A transaction is like a reducer that returns either the whole new state or the old one, never something in between.
- `requireCliToken` is middleware, like a route guard (`<RequireAuth>`) that runs before the page and redirects if you're not allowed in.
