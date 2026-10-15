# WebSockets: how a CLI stays connected

**In one sentence:** each `nitpilot start` opens one long-lived WebSocket to the server (`/ws/cli`), and the server pushes a job down it the moment the job exists, instead of the CLI asking "anything for me?" over and over.

## Why not polling

Polling means the CLI asks every N seconds. With N = 60 a review starts up to a minute late; with N = 2, every idle laptop knocks on the server all day. Spec §3's first goal is "a PR event reaches the right agent within seconds; no polling, and no tokens spent when nothing happens". A WebSocket is one connection that stays open, so the server can speak first: the job goes out as soon as the webhook is handled.

## The life of one connection (`ws/cli-hub.ts`)

1. **Upgrade.** A WebSocket starts as an ordinary HTTP request carrying `Upgrade: websocket`. Before agreeing, the hub checks the `Authorization: Bearer nit_…` header (`auth/cli-token.ts`). No valid token: a plain `401`, and no socket at all.
2. **hello / welcome.** The CLI's first message is `hello`: its protocol version, device name, linked repos, how many jobs it runs at once, which agent it has, and which jobs it's still running. The server answers `welcome` with the user's login and the ping and lease timings. A CLI on an old protocol is closed with `4426` ("upgrade").
3. **Messages.** Every message is JSON in one envelope, `{ v: 1, t: "<type>", id?, re?, d: {…} }`, checked with the zod schemas in `packages/protocol/src/cli-messages.ts`. A message that doesn't fit is logged and dropped; the socket stays open. One CLI's messages are handled one at a time, in order (`lib/serial-queue.ts`).
4. **Closing.** The close code tells the CLI what to do next: `4401` log in again (the token was revoked), `4426` upgrade, `4409` another `nitpilot start` on this device took over (stop), `1012` the server is restarting (reconnect). Any other code means "reconnect after a pause", such as `1008` (the CLI broke the rules, for example by not saying hello first) and `1011` (the server hit an error halfway through the handshake).

## One connection per device

Each `nitpilot login` creates one token per device, and the hub keeps one connection per token. A second connection with the same token is either the same laptop back from sleep (its old socket is dead anyway) or a second `nitpilot start` in another terminal. Either way the newest wins and the old one is closed with `4409`, so two daemons never fight over the same jobs.

## What the hub doesn't know

It doesn't know what a job is. It hands each message to listeners: the job assigner, the leases and the job results (`ws/wire.ts` connects them). The socket plumbing stays in one file you can read without the job rules.

## Handing out a job (`jobs/assign.ts`)

The server doesn't ask CLIs "do you want this job?". From `hello` it already knows which repos each CLI has linked, which kinds of job its agent can do, and how many jobs it runs at once, so it picks one and sends `job.assign`.

Picking is a compare-and-swap (explained in [cli-login.md](cli-login.md)): the job moves from `queued` to `running` only if it is still `queued`, so two passes of the assigner can never hand out the same job twice. The same update adds 1 to `attempt`, starts a 90-second lease, and moves the job to the PR's newest commit, because a job that waited in the queue should review what's there now (spec §9.4).

The assigner runs when something changes (a job was queued or finished, a CLI said hello) and every 5 seconds for jobs waiting out a retry delay. Like the task runner, it never runs two passes at once.

The job travels as a self-contained **bundle** (`jobs/bundle.ts`): the PR, how to fetch its code, the points with their threads, human notes and the team rules. The CLI never has to call back for more. If the bundle can't be built (a corrupt row, say), the engine is told the job failed to set up, so its usual retry rules apply instead of the job sitting there until its lease runs out.

## Leases, in one paragraph

A laptop can vanish without saying goodbye: the lid closes, the Wi-Fi drops. So a job given to a CLI comes with a **lease**: 90 seconds, renewed by a ping every 25. When the pings stop, the lease runs out and the job goes back to the queue. [leases-and-fencing.md](leases-and-fencing.md) has the details.

## The CLI's end (`apps/cli/src/daemon.ts`)

`nitpilot start` holds the other end of the socket, and has to cope with everything a laptop does:

- **Reconnecting.** When the socket closes for an ordinary reason (the server restarted, the Wi-Fi dropped), the daemon waits and tries again: 1 s, then 2, 4, 8… up to 30 s (`connection/backoff.ts`). Each wait is nudged up to 20% either way at random ("jitter"): after a server restart, a hundred CLIs that all waited exactly 1 s would knock at the same instant. The wait goes back to 1 s once a `welcome` arrives.
- **Stopping.** `4401`, `4426` and `4409` mean "don't come back" (log in again, upgrade, another `nitpilot start` took over), so the daemon stops and says what to do. A rejected token is refused before the upgrade, which a WebSocket client can't tell from a network error, so after a connection that never opened the daemon asks `GET /api/me`: a 401 there means "log in again".
- **A socket that only looks alive.** After a laptop sleeps, its socket can look open while nothing gets through, and TCP may take many minutes to notice. The server answers every ping with a pong; when nothing at all has come back for about two pings, the daemon drops the socket and connects again.
- **Answers wait for an ack.** `job.complete`, `job.fail`, `job.reject` and `job.pushing` stay in an "unacked" list until the server acks them, and go again (same id) after every new `welcome`. They also go again on the same connection when no ack comes back within two pings, because the server may have failed while handling the answer (it then sends no ack, and the socket stays open). Sending twice is safe because the server applies each answer at most once: a second copy of a result is acked `stale`, and a repeated `job.pushing` is simply acked `applied` again, since recording the same push twice changes nothing. Together that gives "exactly once" where it matters: in the database.
- **"Running" until acked.** A job is listed in `hello` and in every `ping` from its `job.assign` until its answer is acked. Its lease stays alive while the answer waits for a reconnect, and after a reconnect the server binds it to this device again.
- **Too big is never sent.** The server refuses a message over 1 MB by closing the socket. Replaying such an answer after every reconnect would loop forever, with the lease kept alive by each `hello`, so the daemon measures a result first and reports one that is too big as a retryable `crash` instead (`fitForServer` in `apps/cli/src/daemon.ts`). It's the request-body limit of an upload form: check the size before you submit, not after the server says 413.

In React terms, the unacked list is an offline-first mutation queue: pending changes are kept and replayed when the app is back online, and the server's confirmation (the ack) is what removes them.

## The React analogy

- Polling is `setInterval(() => fetch('/jobs'), 5000)`. A WebSocket is a subscription, like Firebase's `onSnapshot` or a GraphQL subscription: you register once and updates are pushed to you.
- `hello`/`welcome` is the handshake an app does on mount: say who you are, get your session back.
- Close codes are HTTP status codes for the end of a conversation.
