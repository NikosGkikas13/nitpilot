# WebSockets: how a CLI stays connected

**In one sentence:** each `nitpilot start` opens one long-lived WebSocket to the server (`/ws/cli`), and the server pushes a job down it the moment the job exists, instead of the CLI asking "anything for me?" over and over.

## Why not polling

Polling means the CLI asks every N seconds. With N = 60 a review starts up to a minute late; with N = 2, every idle laptop knocks on the server all day. Spec §3's first goal is "a PR event reaches the right agent within seconds; no polling, and no tokens spent when nothing happens". A WebSocket is one connection that stays open, so the server can speak first: the job goes out as soon as the webhook is handled.

## The life of one connection (`ws/cli-hub.ts`)

1. **Upgrade.** A WebSocket starts as an ordinary HTTP request carrying `Upgrade: websocket`. Before agreeing, the hub checks the `Authorization: Bearer nit_…` header (`auth/cli-token.ts`). No valid token: a plain `401`, and no socket at all.
2. **hello / welcome.** The CLI's first message is `hello`: its protocol version, device name, linked repos, how many jobs it runs at once, which agent it has, and which jobs it's still running. The server answers `welcome` with the user's login and the ping and lease timings. A CLI on an old protocol is closed with `4426` ("upgrade").
3. **Messages.** Every message is JSON in one envelope, `{ v: 1, t: "<type>", id?, re?, d: {…} }`, checked with the zod schemas in `packages/protocol/src/cli-messages.ts`. A message that doesn't fit is logged and dropped; the socket stays open. One CLI's messages are handled one at a time, in order (`lib/serial-queue.ts`).
4. **Closing.** The close code tells the CLI what to do next: `4401` log in again (the token was revoked), `4426` upgrade, `4409` another `nitpilot start` on this device took over (stop), `1012` the server is restarting (reconnect).

## One connection per device

Each `nitpilot login` creates one token per device, and the hub keeps one connection per token. A second connection with the same token is either the same laptop back from sleep (its old socket is dead anyway) or a second `nitpilot start` in another terminal. Either way the newest wins and the old one is closed with `4409`, so two daemons never fight over the same jobs.

## What the hub doesn't know

It doesn't know what a job is. It hands each message to listeners: the job assigner, the leases and the job results (`ws/wire.ts` connects them). The socket plumbing stays in one file you can read without the job rules.

## Leases, in one paragraph

A laptop can vanish without saying goodbye: the lid closes, the Wi-Fi drops. So a job given to a CLI comes with a **lease**: 90 seconds, renewed by a ping every 25. When the pings stop, the lease runs out and the job goes back to the queue. [leases-and-fencing.md](leases-and-fencing.md) has the details.

## The React analogy

- Polling is `setInterval(() => fetch('/jobs'), 5000)`. A WebSocket is a subscription, like Firebase's `onSnapshot` or a GraphQL subscription: you register once and updates are pushed to you.
- `hello`/`welcome` is the handshake an app does on mount: say who you are, get your session back.
- Close codes are HTTP status codes for the end of a conversation.
