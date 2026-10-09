# Webhooks: how GitHub tells us something happened

**In one sentence:** instead of us asking GitHub "anything new?" every few seconds (polling), GitHub sends an HTTP POST to `/webhooks/github` the moment something happens.

## What arrives

Every delivery has a JSON body (the PR, the comment, …) and headers:
- `X-GitHub-Event`: what kind of thing happened (`pull_request`, `issue_comment`, …);
- `X-GitHub-Delivery`: a unique id for this delivery;
- `X-Hub-Signature-256`: an HMAC, a fingerprint of the body made with a secret only GitHub and we know.

## What we do with it (`http/routes/webhooks.ts`)

1. **Check the signature** on the exact raw bytes. Anyone on the internet can POST to our URL; only GitHub can make a valid fingerprint. The comparison is constant-time (`lib/hmac.ts`), so attackers can't learn the right answer byte by byte from response times.
2. **Store it** as a `RawEvent` row, keyed by the delivery id. GitHub sometimes sends the same delivery twice; the second insert is skipped, so nothing happens twice.
3. **Answer 202 right away.** GitHub gives up after 10 seconds, so we never make it wait for our work.
4. **Process it afterwards**, one delivery at a time, in order (`ingest/process.ts`). If the server crashes first, the row is still `received`, and boot replays it.

### When processing fails

Processing can fail for reasons that go away on their own: GitHub answers a read with a 502, the database restarts. GitHub already got our 202, so as far as it knows the delivery arrived; it will never send it again. If we just marked the row `failed`, that review request or comment would be gone for good, and nobody would know.

So `processDelivery` retries, with a growing wait, like a `fetch` wrapper with retries and exponential backoff:

- After a failure the row becomes `retrying`, with `attempts` counted and a `retryAt` time: 1 minute after the first failure, then 2, 4, 8, 16 and 32 minutes.
- Every 30 seconds the server calls `ingest.retryDue()` (`main.ts`), which puts each due row back to `received` and into the queue.
- After 7 attempts (about an hour) the row becomes `failed` for good, with the last error in `note`.

A retried delivery runs after deliveries that arrived later, so it can be applied out of order. Most events don't mind (each comment is its own point); [dispatcher.md](dispatcher.md) explains why a retried comment isn't mistaken for one we already handled.

## From GitHub's JSON to engine events ("normalizing")

GitHub's payloads are big and GitHub-specific. The engine (`engine/`) doesn't know GitHub exists: it understands a short list of `DomainEvent`s like `pr_opened` or `head_updated`. The **normalizers** in `platform/github/normalize/` translate one into the other:

- `pull_request` with `action: "opened"` → `{ type: 'pr_opened', author, reviewers }`; `"synchronize"` (someone pushed) → `head_updated`; and so on.
- GitHub ids become strings, and users become `Person`s (`isBot` is set for accounts like `coderabbitai[bot]`).
- Comments become `external_comment` (or `external_comment_deleted`), resolving a thread becomes `thread_resolved`, and a submitted review becomes `external_review_submitted` (`normalize/comments.ts`).
- Anything Nitpilot doesn't care about (`labeled`, `assigned`, team review requests, edited comments, `ping`) becomes an empty list, `[]`. `normalize/index.ts` picks the right normalizer from the `X-GitHub-Event` header.

Comment ids follow one convention everywhere after this: an inline review comment keeps GitHub's number as a string (`"9001"`), a comment in the PR's conversation tab is `"issue:8001"` (GitHub treats every PR as an issue, so those arrive as `issue_comment`), and a review's own text is `"review:7001"`.

Normalizers are pure functions: payload in, events out, no database and no network. That's why their tests are simple, and why a second platform (GitLab) would only need its own normalizers, not a new engine.

### The one exception: webhooks can arrive out of order

When someone submits a review with three inline comments, GitHub sends four webhooks: one `pull_request_review` and three `pull_request_review_comment`. GitHub does **not** promise they arrive in that order, or close together. If we built the review from the comment webhooks we'd seen so far, we could miss one.

So for a submitted review, `normalizeReview` asks the API for that review's comments (`GithubReads.reviewComments`) and builds the full review from the answer (spec §15). The API call is passed in as a function (`fetchComments`), so the normalizer itself still has no network code and its tests pass a fake list.

## When the server was down (`ingest/recovery.ts`)

At every boot, `recoverOnBoot` picks up what a crash or restart left behind:
1. tasks still marked `running` go back to `pending` (see [outbox-and-restarts.md](outbox-and-restarts.md));
2. stored deliveries still marked `received` are processed;
3. deliveries that never reached us at all (server stopped, tunnel down) are asked for again. GitHub keeps a log of every delivery it tried, with its status code. `GithubPlatform.redeliverFailed` reads the log (`GET /app/hook/deliveries`) and asks GitHub to resend each delivery from the last 3 days that failed and never succeeded on a later try (`POST /app/hook/deliveries/{id}/attempts`). If GitHub can't be reached, the server boots anyway.

**A JavaScript number trap.** Delivery ids are 64-bit integers like `3847320851447848960`. JavaScript numbers are exact only up to 2^53 (about 9 × 10^15), so `JSON.parse` quietly rounds that id to `3847320851447849000`, a different delivery. In the real log, every id was affected. So `redeliverFailed` reads the response as text and turns each `"id": 3847…` into the string `"id": "3847…"` before parsing. For the same reason, Nitpilot stores every GitHub id as a string.

## The React analogy

It's the difference between `setInterval(fetchUpdates, 5000)` and a WebSocket push: the server tells you instead of you asking. Recovery on boot is the refetch you do when a WebSocket reconnects, to catch what you missed while it was down. The signature check is like validating a JWT before trusting its claims.

A normalizer is like the function you write to turn an API response into the shape your component wants (`apiUser → { id, name, avatar }`), so components never depend on the API's raw format.

Out-of-order webhooks are the classic search-box race: you type "ab", two fetches go out, and the response for "a" lands after the one for "ab". The fix is the same in both worlds: don't trust arrival order, ask the source of truth for the current answer.
