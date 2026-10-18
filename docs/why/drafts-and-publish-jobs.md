# Drafts and publish jobs: Auto off, and sending the work later

**In one sentence:** with Auto off your agent still runs when its job is due, but its result waits as a **draft** until you press Send or Discard; a reviewer's draft is applied by the server on the spot, while an author's draft is a commit that only exists on the laptop that made it, so Send queues a small **publish job** that only that laptop can take, and it pushes the commit.

## What a draft is

A draft is just a finished `Job` row whose `applyState` is `draft` (spec §8). Its `result` column holds everything the agent produced: a reviewer's points and decisions, or an author's replies plus `result.draft`, which names the commit (`sha`, the head it was made on as `from`, the files with their counts, and the diff when it's under 200 KB).

Nothing else stores drafts. The engine sees them in `ChatState.drafts` (`chats/load.ts` reads every `done` job with `applyState: 'draft'`), and the chat screen sees them in `ChatView.drafts` (`chats/views.ts`), with Send and Discard offered only to the owner (`permissions.drafts`). Everybody else who reads the chat sees the draft too, without the buttons.

Think of it like a form with "Save draft": the work is done and kept, but nothing is submitted until you say so.

## Why the author's commit stays on the laptop

The server never touches code (spec §7): it has no clone, no git and no push access to your repo in your name. The CLI makes the commit in a worktree of your clone, and in draft mode it doesn't push: it keeps the commit at `refs/nitpilot/drafts/<job id>` in the linked clone and reports it in the result.

So when you press Send on an author's draft, the server can't push it. It asks the laptop to. That's the publish job: `enqueue_job { jobType: 'publish', draftOfId: <the draft job> }` (`engine/drafts.ts`, `onDraftSend`). A draft whose agent changed no file (it only answered or declined, so `result.draft` is null) has nothing to push, and Send applies it at once, like an auto pass that pushed nothing.

## Only that laptop can take it

Your desktop doesn't have the commit; only the laptop that made the draft does. The draft job remembers which CLI ran it (`Job.cliTokenId`), so no new column is needed: the assigner follows `draftOfId` to the draft job and gives the publish job only to the connection with that token (`jobs/assign.ts`, `draftDevices`). It ignores agent modes, because a publish job runs no agent.

The activity line does the same (`chats/activity.ts`, `onlyTokenId`): while that laptop is away, the chat says "waiting, offline since…" with the time *that laptop* was last seen, even if your desktop is online. Saying "working" because some CLI of yours is online would be a lie: nothing can take the job.

If the laptop is gone for good (revoked, wiped), the job waits forever; Discard is the way out.

## A publish job is still a job

It goes through the same machinery as any agent job (`docs/why/leases-and-fencing.md`):

- the assigner hands it out with a compare-and-swap and a 90-second lease, renewed by pings;
- every message carries `(jobId, attempt)`, so a late answer from an older attempt is ignored (fencing);
- `job.pushing` is acknowledged before the push, so the server recognizes the push webhook as its own;
- `job.complete` and `job.fail` are kept by the CLI until their `ack` comes.

The bundle it gets is small (`jobs/bundle.ts`, `buildPublishBundle`): the PR, where to push, and `draft { jobId, sha, from }`. The CLI checks that the draft ref still points at `sha`, pushes it without forcing, and reports the push (`apps/cli/src/runner/publish.ts`). When the result arrives, the engine applies the draft's stored replies with that commit, exactly as an auto address pass would have been (`engine/results.ts`, `onPublished`), and the reviewers' re-review starts.

## "Out of date"

Two failures mean the draft can never be sent (`engine/results.ts`, `DRAFT_OUT_OF_DATE` and `draftOutOfDate`):

- **`branch_moved`:** someone pushed to the branch since the draft was made, so the push isn't a fast-forward. Nitpilot never forces a push, so it won't overwrite their work.
- **`setup_failed`, not retryable:** the draft commit isn't in that clone any more (it was re-cloned, or the ref moved). A *retryable* `setup_failed` is different: the server couldn't build the job (a passing database error, say), and trying again may work, so it follows the usual retries and the draft keeps waiting (`draftOutOfDate`).

For these two, the job isn't retried. The draft is marked `discarded` with a line saying why ("The drafted fixes are out of date: the branch moved"), and the chat carries on from where it is: the next address pass runs, and with Auto still off, its result is a new draft. Any other failure follows the usual retries; one that fails for good leaves the draft waiting, so you can Send it again.

## Why Discard doesn't loop

With Auto off, a naive rule would go: the points are open, so run the author's agent; it makes a draft; you discard it; the points are still open, so run the agent again; and so on, spending your daily job cap on work you said you didn't want.

So Discard means "I'll take it from here":

- **A reviewer's draft:** it counts as having reviewed that commit (`lastReviewedSha` = the draft's head), and nothing is raised.
- **An author's draft:** the participant gets `byHand = true`, and no address job starts while it's set. It clears when something new happens that the agent should answer: a new trusted comment, someone's push, a Continue, or turning Auto on (`engine/state.ts`, `handBackToAgent`).

## Pressing twice

Send and Discard go through the dispatcher like every chat write, under the chat's lock (`docs/why/races-and-conflicts.md`). A second Send while the publish job is queued or running changes nothing, and the route answers 409 "That draft is already being sent." (`http/routes/chat-drafts.ts`). Send on a draft that was sent, discarded or went out of date is a 409 that says which. Discard while the publish job is still queued cancels it; once it runs, the push may be under way, so Discard is a 409 and the job's result decides.

## The React analogy

A draft is a filled-in form kept in state instead of submitted: it's on screen (for everyone in the chat), and only Send submits it. The publish job is like a mutation that can only run in one particular browser tab, because only that tab holds the data it needs: if that tab is closed, the mutation waits.
