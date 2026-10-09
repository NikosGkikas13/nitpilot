# Leases and fencing: who is really working on a job

**In one sentence:** a job handed to a CLI is only *lent* to it, 90 seconds at a time, and every message about the job carries an attempt number, so a laptop that vanished can never overwrite the work of the CLI that took over.

## The problem

The server gives leo's review job to leo's laptop. Then leo closes the lid. From the server's side the laptop just goes quiet: no error, no goodbye. Should the job wait forever? Should it go to leo's desktop? And if the laptop wakes up ten minutes later and sends its old result, what then?

## Leases: a library loan

A lease works like a library loan: you keep the book until the due date, you can renew as often as you like, and if you don't renew, the library lends it to someone else.

- When the assigner hands out a job, `Job.leaseExpiresAt` becomes now + 90 s (`jobs/assign.ts`).
- Every 25 s the CLI sends `ping` with the jobs it's running, and each one's lease is renewed (`jobs/leases.ts`).
- Every 5 s the server sweeps for leases that ran out. Such a job goes back to the queue **through the engine**, as a `timeout` failure, so the usual retry rules apply: wait 30 s, then 60 s, and give up after the third attempt.
- If two pings in a row leave out a job we gave that CLI, the CLI doesn't have it (the `job.assign` got lost), so the job goes back too. One miss is forgiven, because a ping can cross a `job.assign` on the wire.
- Whenever a job is taken back, its CLI gets `job.cancel`, in case it's still busy with it.
- A CLI that sends nothing for 60 s is disconnected, so no new job goes to a dead socket.
- After a server restart every running job gets a fresh lease: the server was the one away, and the CLIs reconnect within seconds.

## Fencing: the attempt number

Taking the job back isn't enough, because the old laptop may still send a result later. So every hand-out adds 1 to `Job.attempt`, and every message about a job carries `(jobId, attempt)`. The attempt number is a **fencing token**: only the current attempt's messages count.

- `currentAttempt()` in `jobs/leases.ts` checks a message against the database: the job must be `running`, on that attempt, on that CLI.
- The engine checks the attempt again inside the chat's lock (`engine/results.ts`), because between our check and the lock, the sweep could have handed the job out again.
- When the laptop reconnects, its `hello` lists what it's still running. A job that is still its own, on the same attempt, keeps going: the lease is renewed, and the laptop that slept loses nothing. Anything else gets `job.cancel`.

Some failures aren't the agent's fault: a daily cap, or a branch that moved under the job. They don't count toward the 3-attempt limit, but the attempt number still goes up, because the number has to name exactly one run. Instead, the job remembers how many runs didn't count in `Job.refundedAttempts`, and the engine uses `attempt - refundedAttempts` for its limit and its backoff. If the number went back down after such a failure, the next run would reuse it, and a late message from the old run could be mistaken for one from the new run.

## Stale answers are acknowledged, then ignored

A stale result gets `ack { status: 'stale' }`, not silence. Silence would look like a network problem and the CLI would keep resending. "Stale" says: we heard you, it's not yours anymore, drop it. It matters most for `job.pushing`: the CLI only pushes after an `applied` ack, so an old attempt can never push.

## The React analogy

Fencing fixes the classic stale-fetch bug: you start loading user 1, switch to user 2, and user 1's slow response arrives last and overwrites the screen. The fix is a request id, and you ignore any response that isn't for the latest one. The attempt number is that id. A lease is a presence heartbeat, like the dot that turns grey when someone's tab stops checking in.
