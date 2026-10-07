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

## The React analogy

It's the difference between `setInterval(fetchUpdates, 5000)` and a WebSocket push: the server tells you instead of you asking. The signature check is like validating a JWT before trusting its claims.
