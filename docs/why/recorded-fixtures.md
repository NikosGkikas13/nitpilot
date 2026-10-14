# Recorded fixtures: tests that replay what GitHub really sent

**In one sentence:** instead of inventing the JSON GitHub sends us, we save real deliveries from the sandbox repo (with the noise taken out) and replay them through the same code a live webhook goes through (spec §19).

## Why not just write the JSON by hand?

Our other tests build payloads by hand (`apps/server/test/fixtures/github.ts`). That is fast and exact, but it only proves the code understands *our idea* of GitHub's JSON. If GitHub names a field differently, or sends events in an order we didn't expect, the hand-made payloads never find out. A recorded fixture is a real payload: if our code can't read it, the code is wrong.

It's the same difference as mocking an API response in a React test versus saving a real response from the network tab and replaying it. A hand-written mock is what you *hope* the API returns; the saved one is what it *did* return.

## Where recordings come from

Every webhook GitHub sends is stored as a `RawEvent` row for 14 days (that is what makes boot-time replay possible; see [webhooks.md](webhooks.md)). So a live run records itself, and nobody copies JSON out of GitHub's "Recent deliveries" page.

`npm run record:fixtures -w apps/server` (`apps/server/scripts/record-fixtures.ts`) has two commands:

- `list` shows what the database holds: delivery id, time, event, PR number, who caused it;
- `write <deliveryId> <name>` turns one delivery into `apps/server/test/fixtures/recorded/<name>.json`.

Names read `<event>.<action>` plus an optional dotted suffix for the variant: `pull_request.review_requested.again`.

## What "secrets removed" means here

A webhook body has no passwords: the signature is a header, and `RawEvent` doesn't store headers. Two kinds of thing still need care, and `test/fixtures/recorded/scrub.ts` handles both:

- **Noise.** GitHub fills each payload with dozens of API links and node ids that Nitpilot never reads. The scrubber drops every `*_url` key except `html_url`, plus `url`, `node_id`, `gravatar_id` and `_links`. Files shrink from about 25 KB to 8 KB, and a diff shows only what matters. Everything else is kept exactly as GitHub sent it.
- **Whatever a person typed.** A PR description or comment can hold anything, including a pasted token. The recorder refuses to write a file in which it finds a GitHub token, a Nitpilot token, a private key, a JWT, a bearer token, a webhook signature or our own webhook secret, and the test refuses to pass if a committed file has one.

There is also a privacy rule: a delivery such as `installation.created` lists *every* repository the app can see, private ones by name. The test only lets the public sandbox and this project's own repository appear in a fixture, so a payload like that can't be committed by accident.

## What the test checks (`recorded.test.ts`)

For each file: it is named for the event it holds, it holds no secret and is already scrubbed, and replaying it through `parseGithubWebhook` (the code both `GithubPlatform` and `FakePlatform` use) gives exactly the events written next to it by hand. The recording is only the input; the expected output is written by a person, so a bug can't hide by being recorded.

One more check keeps the set honest: every `pull_request` action the normalizer handles must have a fixture, or a written reason why not.

## The React analogy

A recorded fixture is a snapshot test whose snapshot you wrote yourself: the input comes from the real world, and the expected output is your own decision about what it should mean.
