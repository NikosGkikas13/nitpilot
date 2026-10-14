# How work survives a restart (the outbox and the Task table)

**In one sentence:** anything the server must do later (post to GitHub, send a notification, fire a 30-second debounce) is first written as a row in the `Task` table, inside the same database transaction as the change that caused it; a ticker then runs due rows.

## The problem it solves

Say the engine decides "Leo's review is done; post a summary comment". If we called GitHub right there and the server crashed a moment later, we'd lose either the database change or the GitHub write, and they'd disagree forever. Writing the intention as a row **in the same transaction** means both happen or neither does. This is the "transactional outbox" pattern.

## How it works here

1. The dispatcher (`chats/dispatch.ts`) saves the chat **and** its new `Task` rows in one transaction (`chats/apply-commands.ts`).
2. `tasks/runner.ts` wakes every second, or right after a dispatch, and claims due rows one by one. Claiming is a compare-and-swap from `pending` to `running`, the same trick as Odyhook's `claimDelivery`.
3. Success → `done`. Failure → `pending` again with a growing delay (5 s, 10 s, 20 s… up to 10 minutes), for 13 attempts: about an hour, so a short GitHub incident loses nothing. When GitHub rate-limits us, it says how long to wait (a `retry-after` header, or `x-ratelimit-reset` once the hourly allowance is used up); `GithubError.retryAfterMs` carries that, and the runner waits at least that long, since asking sooner only fails again.
   After the last attempt the row is `failed`, and the runner calls its `onGiveUp` hook (see "When a write never reaches GitHub" below).
4. At boot, any row still `running` belonged to the crashed process, so it goes back to `pending`.

## What each task does (`tasks/handlers/`)

| Task kind | What runs | Posted as |
| --- | --- | --- |
| `summary` | create or edit the one summary comment; skipped when its content hash hasn't changed | the app bot |
| `post_review` | post a reviewer agent's points as one GitHub review (`COMMENT`, never an approval); if GitHub rejects a line, every point goes in the review body | the reviewer |
| `thread_replies` | answer points in their GitHub threads | the agent's owner (usually the author) |
| `notify` | tell people they're needed: sent to each of their connected CLIs (`tasks/cli-notifier.ts`), or logged when none is online | — |
| `timer` | a debounce came due: tell the engine | — |

Everything an agent wrote is cleaned first (`lib/sanitize.ts`). Writes "as" someone use their own GitHub token. If they have to sign in again, the task stops for good instead of retrying, and nothing is posted as the bot in their place.

## When a write never reaches GitHub

A review or a set of replies that fails for good is worse than it looks: the chat already shows those points as raised or answered, but nobody on GitHub can see them. So the runner's `onGiveUp` hook (`tasks/handlers/failed-writes.ts`, wired in `main.ts`) turns that into an engine event, `write_failed`. The engine (`engine/writes.ts`) then:

- adds a timeline message, e.g. "Couldn't post leo's review (P1, P2) on GitHub: leo needs to sign in to Nitpilot again";
- sets that person's attention to `failed`, which is what the inbox will show (Plan 2);
- notifies them.

When that person signs in again (`http/routes/auth.ts`), writes in their name work again. `chats/failed-flags.ts` finds each chat where a failed write flagged them and sends it a `signed_in_again` event: the flag goes and the chat carries on. What failed isn't posted again; the chat still has it. A flag from a failed *job* stays: running the agent again is what fixes that (`nitpilot retry`).

The summary comment is left out on purpose. The next change to the chat writes it again anyway, and reporting it would add a timeline message, which is itself a change that asks for a new summary.

## Making "run it again" safe

A crash can happen **after** GitHub accepted a write but **before** we marked the task done. So every body we post carries a hidden marker (`lib/markers.ts`). On a retry, the GitHub adapter first looks for a write with that marker and reuses it instead of posting a duplicate (`platform/github/writes.ts`).

## Debounce and timers are tasks too

"Wait for 30 quiet seconds after the last comment" is a task with a `dedupeKey`. Each new comment moves the same row's `runAt` later instead of adding a new row. When it finally runs, it tells the engine `timer: comments`.

## The React analogy

Like an optimistic update with a persisted queue of pending mutations, but on the server: the intent is saved first, then executed and retried until it sticks.
