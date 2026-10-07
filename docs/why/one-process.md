# Why one process (and no Redis)

**In one sentence:** the Nitpilot server only receives, stores and forwards; the heavy work (running agents) happens on each developer's laptop, so one Node process plus Postgres is enough.

## What a "worker" or "queue" would normally do

Many backends split into a web process, worker processes and a queue (Redis, SQS) between them. That's useful when the server does slow work itself. Nitpilot's server doesn't: it checks webhooks, runs pure rules, writes rows and sends small messages. Odyhook needed BullMQ and Redis because it sends webhooks itself; Nitpilot doesn't.

## What we use instead

- **Postgres is the source of truth.** Jobs, timers and pending GitHub writes are rows, so a restart loses nothing (`docs/why/outbox-and-restarts.md`).
- **In-memory locks per chat.** Two events for the same PR are handled one after the other (`lib/key-lock.ts`). That only works if there's a single process.
- **An advisory lock makes "single process" a rule, not a hope.** At boot the server asks Postgres for lock number 64874568 (`lib/advisory-lock.ts`). If another server holds it, the new one refuses to start.

## The React analogy

It's like keeping app state in a single store instead of syncing several: simpler, as long as you only have one tab. The advisory lock is the check that you really do have only one tab.
