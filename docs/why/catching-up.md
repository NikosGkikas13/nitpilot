# Catching up: finding the PRs we missed

**In one sentence:** the first time your CLI connects after the server starts, Nitpilot asks GitHub for your open PRs and starts a chat for each one it never heard about (spec §15).

## Why webhooks aren't enough

Nitpilot learns about PRs from webhooks: GitHub calls us when something happens. If nobody answers (the server was down, or being deployed), GitHub keeps the delivery for a few days, and the server asks for the failed ones again at boot (`ingest/recovery.ts`). But a PR opened before the app was installed on the repo, or one whose delivery is older than that, never arrives. Its review would never start.

## What happens (`jobs/catch-up.ts`)

1. Your CLI says `hello` (`ws/wire.ts`). If it's your first hello since the server started, the catch-up runs in the background, so your CLI doesn't wait for it.
2. Three searches with **your own** GitHub token: PRs you opened, PRs waiting for your review, and PRs you reviewed, all still open (`platform/github/reads.ts`, `findOpenPrsFor`).
3. Each PR in a repo the app is on, without a chat yet, goes through the same router as a webhook, as if it had just been opened. Its reviews are queued as usual, and your CLI picks them up.

It runs **once per person per server start**. That's a catch-up, not polling: from then on, webhooks keep us current. If the search fails (GitHub hiccups, or you need to sign in again), your next connect tries again.

## Why your token, and why only three requests

GitHub's search allows 30 requests a minute **per person**, and your own token only finds PRs you can see. A catch-up uses three, one page of 100 PRs each, so it never gets near the limit, and one person's catch-up can't use up anyone else's.

## The React analogy

It's like a component that subscribes to live updates but, when it mounts, also fetches the current list once: the subscription only tells you what changes from now on, so you load what's already there first.
