# The router and the dispatcher: from webhook to saved chat

**In one sentence:** the **router** (`chats/route-event.ts`) gets each GitHub event ready, and the **dispatcher** (`chats/dispatch.ts`) runs it through the engine and saves the result, one event per chat at a time.

## The path of one webhook

1. `ingest/handle.ts` parses the stored delivery into normalized events (see [webhooks.md](webhooks.md)). Installation events go to `syncFromEvent`; PR events go to the router.
2. **The router** does everything that needs GitHub or extra lookups:
   - drops events for repos we don't know, and private repos on the hosted instance;
   - drops **our own writes coming back** (below) and **comments we've already seen** (below);
   - re-reads `.nitpilot.yml` when a round may start;
   - fills in who uses Nitpilot (`withPeople` in `chats/people.ts`) and trusts the bots listed in `trusted_bots`;
   - creates the chat the first time it meets a PR. If that first event is a comment, it fetches the PR and sends `pr_opened` first.
3. **The dispatcher** then runs spec §9's five steps:
   1. take the chat's lock;
   2. load the chat (`chats/load.ts`);
   3. call `decide()`, the pure engine (see [pure-engine.md](pure-engine.md));
   4. in **one transaction**, save the new state (`chats/save.ts`), append the timeline items, and turn the engine's commands into `Job` and `Task` rows (`chats/apply-commands.ts`);
   5. after the commit, tell listeners: the task runner wakes up when new tasks were written (`main.ts`); Plan 1b adds the CLI hub.

## Why a lock per chat

Two comments on the same PR can arrive a few milliseconds apart. Without a lock, both would load the chat while it has zero points, both would decide "this is P1", and the second save would fail (or worse, overwrite the first). `KeyedLock` (`lib/key-lock.ts`) is a queue per chat id: work for chat A waits for the previous work on chat A, while chat B runs in parallel. `dispatch.db.test.ts` sends five comments at once and checks they become P1 to P5.

It's an in-memory lock, which works because Nitpilot is one Node process (see [one-process.md](one-process.md)).

**GitHub is never called while the lock is held.** A slow GitHub call would make every other event for that chat wait. That's why the router does all the GitHub reads *before* asking the dispatcher.

## Why one transaction

Step 4 writes many rows: the chat, participants, points, messages, jobs, tasks. Inside `prisma.$transaction` they all commit together or not at all, so a crash halfway never leaves, say, a point without its timeline message. (Transactions were first explained in [cli-login.md](cli-login.md).)

## Our own writes come back

When Nitpilot posts a review on GitHub, GitHub sends us a webhook about it, just like for a human's review. If we treated it as new, our agent would reply to itself forever. So every body we write carries a hidden marker (`<!-- nitpilot:v1 chat=… -->`, `lib/markers.ts`), and we store the ids of everything we wrote in `GithubWrite`. The router drops any event that carries the marker or a stored id.

## The same comment, twice

A review comment reaches us once on its own (`pull_request_review_comment`) and again inside its submitted review. The router drops any comment whose id is already in `SeenComment`. The engine also ignores a comment that is already a point, but replies and the PR author's own comments never become points, so `SeenComment` is what stops them showing up twice in the timeline.

**When the id is written matters.** The router only *reads* `SeenComment`. The dispatcher writes the ids inside step 4's transaction, together with everything the comment caused. If the id were written first and something failed afterwards (GitHub erroring while the router builds a new chat, say), the retry would find the comment "already seen" and drop it for good. Written in the same transaction, the comment is either handled and remembered, or neither, so the retry handles it.

## Debounced tasks

Some commands mean "do this later": edit the summary comment, or wait for more comments before starting a round. They become `Task` rows with a `dedupeKey` like `summary:<chatId>`. Scheduling the same key again is an *upsert*: it moves the existing row's time instead of adding a second row. Five changes in a burst make one summary edit. How the runner executes them, retries them and survives a restart is in [outbox-and-restarts.md](outbox-and-restarts.md).

## The React analogy

- The dispatcher is Redux's `dispatch(action)`, with the reducer (`decide`) kept pure and the effects done afterwards, like middleware.
- The per-chat lock solves the same race as a search box firing two fetches: without it, the slower answer can overwrite the newer one. Here we queue instead of cancelling.
- Debounced tasks are `useDebouncedCallback`, except the timer lives in a database row, so it survives a restart.
- Markers on our own writes do what the browser does for the `storage` event, which only fires in *other* tabs: you react to changes someone else made, never to your own.
