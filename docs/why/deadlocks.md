# Deadlocks: two transactions each waiting for the other

**In one sentence:** when two database transactions each hold a lock the other one needs, neither can ever go on, so Postgres notices, cancels one of them with error `40P01 deadlock detected`, and lets the other finish; Nitpilot's tests met this when one test emptied the database while the last test's task was still writing.

## Locks, briefly

While a transaction changes rows, Postgres locks them (and notes "someone is writing here" on their table) until it commits, so nobody else changes the same rows halfway. Usually a second transaction that wants the same thing just waits its turn. `TRUNCATE` (empty these tables, now) is the greediest: it needs each table all to itself, so it waits for everyone using a table, and everyone waits for it once it holds one.

## How two waits become a deadlock

A test's `resetDb()` (`apps/server/test/db.ts`) empties 16 tables in one `TRUNCATE`, taking them in the order it lists them. The summary task (`apps/server/src/tasks/handlers/summary.ts`) writes in one transaction: first the chat's row in `PrChat`, then a `GithubWrite` row. Now let both run at once:

1. The summary task updates `PrChat` and holds that row.
2. The `TRUNCATE` takes `Task`, …, `GithubWrite`, then waits for `PrChat` (the task holds it).
3. The task now wants to insert into `GithubWrite`: the `TRUNCATE` holds it.

Each waits for the other, forever. After a second Postgres checks for such a circle, finds it, and cancels one side. When it cancelled the `TRUNCATE`, the next end-to-end test failed before it had begun. Postgres's log said exactly this: the `INSERT INTO "GithubWrite"` and the `TRUNCATE`, each blocked by the other, on `PrChat` and `GithubWrite`.

## Why a task was still running

Between two tests the harness's `close()` stopped the task runner, but stopping only cleared its timer: a task already running went on, and a commit could even wake the runner for a new pass. So `close()` returned while the summary task's transaction was still open, and the next test's `TRUNCATE` walked into it.

## The fixes

- **`TaskRunner.stop()` waits** (`apps/server/src/tasks/runner.ts`): it starts no new pass (not even when woken), stops the pass in flight after the task it's on, and resolves once that task's outcome is saved. The harness's `close()` (`apps/server/test/e2e/harness.ts`) awaits it, so nothing of the last test is still writing when the next one empties the tables. The server's shutdown (`apps/server/src/main.ts`) awaits it too, so a GitHub write in flight finishes instead of being cut off and run again at the next boot.
- **The Playwright server's `/reset` tries again** (`apps/server/test/e2e/web-server.ts`): that server keeps running between browser tests on purpose, so the last test's work (a task, a CLI's last message, a lease sweep) may still be writing when the next test resets. There a wait can't cover everything, so `/reset` follows Postgres's own advice for a cancelled transaction: run it again (up to three times). Emptying tables twice is harmless.

## The React analogy

Two components that each wait for the other's state before rendering their own: A shows a spinner until B is ready, B shows a spinner until A is ready, and the page spins forever. Postgres is the parent that notices the circle and unmounts one of them so the other can finish. The real fix, in React as here, is not to start the second thing while the first is still mid-way: `await` the cleanup (like a `useEffect` cleanup that finishes before the next effect runs) before you reset.
