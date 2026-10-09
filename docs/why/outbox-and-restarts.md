# How work survives a restart (the outbox and the Task table)

**In one sentence:** anything the server must do later (post to GitHub, send a notification, fire a 30-second debounce) is first written as a row in the `Task` table, inside the same database transaction as the change that caused it; a ticker then runs due rows.

## The problem it solves

Say the engine decides "Leo's review is done; post a summary comment". If we called GitHub right there and the server crashed a moment later, we'd lose either the database change or the GitHub write, and they'd disagree forever. Writing the intention as a row **in the same transaction** means both happen or neither does. This is the "transactional outbox" pattern.

## How it works here

1. The dispatcher (`chats/dispatch.ts`) saves the chat **and** its new `Task` rows in one transaction (`chats/apply-commands.ts`).
2. `tasks/runner.ts` wakes every second, or right after a dispatch, and claims due rows one by one. Claiming is a compare-and-swap from `pending` to `running`, the same trick as Odyhook's `claimDelivery`.
3. Success → `done`. Failure → `pending` again with a growing delay (5 s, 10 s, 20 s…), up to 5 attempts.
4. At boot, any row still `running` belonged to the crashed process, so it goes back to `pending`.

## Making "run it again" safe

A crash can happen **after** GitHub accepted a write but **before** we marked the task done. So every body we post carries a hidden marker (`lib/markers.ts`). On a retry, the GitHub adapter first looks for a write with that marker and reuses it instead of posting a duplicate (`platform/github/writes.ts`).

## Debounce and timers are tasks too

"Wait for 30 quiet seconds after the last comment" is a task with a `dedupeKey`. Each new comment moves the same row's `runAt` later instead of adding a new row. When it finally runs, it tells the engine `timer: comments`.

## The React analogy

Like an optimistic update with a persisted queue of pending mutations, but on the server: the intent is saved first, then executed and retried until it sticks.
