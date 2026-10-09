# FakePlatform: GitHub in memory, for tests

**In one sentence:** the server only talks to GitHub through one interface, `PlatformAdapter` (`apps/server/src/platform/types.ts`), so tests can plug in `FakePlatform` (`platform/fake/fake-platform.ts`), a small in-memory GitHub that remembers what it was asked to write.

## Why an interface

Everything the server needs from a code platform fits in a handful of methods: `parseWebhook`, `getPr`, `readDefaultBranchFile`, `gitSpec` (reads) and `upsertSummary`, `postReview`, `replyToThread` (writes). The real GitHub adapter implements them with HTTP calls. Code that uses them never imports GitHub directly; it receives "some `PlatformAdapter`".

That one seam gives two things:
- **Tests without the network.** A test hands the server a `FakePlatform` instead of the real adapter.
- **Room for GitLab later.** A second platform is a second implementation of the same interface (spec §12.1).

## A fake, not a mock

A mock records "was `postReview` called with these arguments?". A fake is a working, simplified implementation: `FakePlatform` really stores PRs, files and writes in `Map`s and arrays, so a test checks the outcome ("this PR now has one review, with this body"), not which calls happened in which order.

It stays honest in two ways:
- **It parses real GitHub payloads** with the same normalizers as production. Tests send GitHub-shaped JSON from `test/fixtures/github.ts`, not hand-made engine events, so the normalizers are exercised every time.
- **It can fail like GitHub.** `rejectNextInlineReview = true` makes the next review with inline comments throw the 422 GitHub returns when a line isn't in the diff, so later tasks can test the fallback.

## Writes that are safe to retry

Every write method takes `{ reuseIfContains: '<!-- marker -->' }`. If an earlier write on that PR already contains the marker, it is reused instead of posting a duplicate. This matters when the server crashes after GitHub accepted a review but before we saved its id: the retry finds the first review instead of posting a second one. The fake implements the same rule, so tests can prove it; the real GitHub version arrives with the write side of the adapter.

## The React analogy

It's like testing a component that gets its API client from context: instead of mocking `fetch`, you wrap it in `<ApiProvider value={fakeApi}>`, where `fakeApi` keeps data in memory. The component can't tell the difference, and your test checks what ended up on screen, not which functions were called.
