# Timeouts: don't wait on GitHub forever

**In one sentence:** every call Nitpilot makes to GitHub gives up after 15 seconds, and a call that can't reach GitHub at all fails straight away, so a request from the browser never hangs because GitHub did.

## Why a server needs one

When you open a chat, the server asks GitHub something ("can this person read this repo?", "which files changed?") and only then answers you. If GitHub accepts the connection and never replies, `await fetch(...)` never finishes: the request stays open, the page spins, and every such request holds on to memory and a connection. Nothing else would ever stop it. A timeout is the rule "if there's no answer in N seconds, stop waiting and say so".

## How it works here

`platform/github/client.ts` (`GithubClient`) wraps every GitHub call in `timed()`. It passes `AbortSignal.timeout(15_000)` to `fetch`. That's the same idea as the `AbortController` you'd use in a React `useEffect` cleanup to cancel a fetch: the signal tells `fetch` to stop, and `fetch` rejects. The 15 seconds cover the whole call, including reading the response body.

## What each failure becomes

| What happened | What `GithubClient` throws | What the routes answer |
|---|---|---|
| No answer within 15 s | `GithubError` with status 504 | 502 `github_unavailable` |
| Couldn't connect (DNS, refused, reset) | `GithubError` with status 503, the original error kept as `cause` | 502 `github_unavailable` |
| GitHub answered with an error | `GithubError` with that status (404, 403, 500 ...) | depends: 404 means "no" for repo access, 5xx means 502 |

Both of the first two mean "GitHub is down", so the code that already handled a GitHub outage (a status of 500 or more) handles them without changes: the REST routes answer 502 `github_unavailable` (`http/routes/chats.ts`, `inbox.ts`), the browser's socket sends `chat.error unavailable` (`ws/web-hub.ts`), and a token refresh that can't reach GitHub is tried again later instead of signing the person out (`auth/user-tokens.ts`).

## The React analogy

It's `fetch` with `signal: AbortSignal.timeout(15000)` wrapped in a function that turns every way of failing into one error type your UI already knows how to show.
