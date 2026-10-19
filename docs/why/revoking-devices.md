# Revoking a device (the Settings page's Devices section)

**In one sentence:** each computer you ran `nitpilot login` on holds its own token; Revoke marks that token dead in the database and hangs up on that computer's open connection, so it stops at once and has to log in again.

## What a "device" is

`nitpilot login` (docs/why/cli-login.md) ends with the server making a **CLI token**: a random `nit_…` string the CLI keeps in its config file. The server stores only its hash, in a `CliToken` row with the computer's name. One row per computer: the Settings page calls that a device.

Think of the token like the session cookie your browser has, but for a terminal. Revoking it is like signing that one computer out remotely.

The row also remembers what the computer said the last time `nitpilot start` connected (its "hello"): which coding agent it found (Claude Code 2.1.290, say) and which repos are linked on it. That's how the page can still show "Claude Code" for a laptop that's closed right now (`ws/cli-hub.ts`, `rememberHello`). Those facts are saved **before** anyone is told the computer came online, so the update the page gets right after reads the fresh ones.

## Why Revoke also closes the socket with 4401

A connected `nitpilot start` keeps one WebSocket open to the server (docs/why/websockets.md). Setting `revokedAt` on the row is enough to refuse its *next* message: the hub checks the token on every message (`touchCliToken`). But a CLI only pings every 25 seconds, so for up to 25 seconds it could still be handed a job.

So `DELETE /api/devices/:id` (`http/routes/devices.ts`) does both:

1. `revokedAt = now` (only for your own token that isn't revoked yet; anything else is the same 404, so the route never tells you whose a device is);
2. ``CliHub.closeToken(tokenId, 4401, "This device was signed out. Run `nitpilot login`.")``: the hub forgets the connection on the spot and closes the socket.

4401 is our "log in again" close code (`packages/protocol/src/close-codes.ts`, modelled on HTTP 401). The CLI knows it means "don't reconnect, your token is gone", prints its own "This device was signed out. Run `nitpilot login`." message (`apps/cli/src/daemon.ts`, `STOP_MESSAGES.reauth`) and stops, instead of retrying forever like it would after a server restart (1012).

Then the route sends your open tabs a `me.update` (`ws/web-wire.ts`, `sendMeUpdate`), which also makes every Settings page you have open read the device list again. Like a `queryClient.invalidateQueries(['devices'])` that the *server* triggers, for every tab of yours.

A computer can also be revoked in the middle of saying hello. The hello is saved with a check built in: `rememberHello` only updates a token that isn't revoked yet (`updateMany` with `revokedAt: null`), and the hub turns the computer away with the same 4401 if nothing was updated. Think of an optimistic update that gets rolled back: the check and the save are one database step, so there is no gap in which a revoked computer gets welcomed.

There is no Undo: the token is dead for good (its row stays with `revokedAt` set; the list just stops showing it), and only a new `nitpilot login` makes another.

## Why the page can't say "This device"

The design drew a "This device" chip on the computer you're looking at the page from. The server can't know that: the browser and the CLI are separate programs that share nothing. The browser has a session cookie and the CLI has its token, and nothing links the two to one machine. So an online computer gets an "Online" chip instead.

## The React analogy

- `GET /api/devices` is a plain `useQuery(['devices'])` (`apps/web/src/api/settings.ts`).
- Revoke is a `useMutation` that toasts and then invalidates `['devices']`. The row disappears because the list is fetched again, not because the page guessed.
