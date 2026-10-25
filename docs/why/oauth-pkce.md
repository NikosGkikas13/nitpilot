# How "Sign in with GitHub" works (OAuth + PKCE)

**In one sentence:** we send you to GitHub, GitHub sends you back with a one-time code, and our server swaps that code for tokens; PKCE proves the server swapping the code is the one that started the sign-in.

## The steps (`http/routes/auth.ts`)

1. `GET /auth/github/login`: we make two random strings, a **state** and a **verifier**. They go into an encrypted cookie, and you're redirected to GitHub with the state and `sha256(verifier)`, called the **challenge**.
2. You approve on GitHub. GitHub redirects you to `/auth/github/callback?code=…&state=…`.
3. We check that the `state` matches the cookie. This stops another site from starting a sign-in in your browser.
4. We send GitHub the `code` plus the original **verifier**. GitHub hashes the verifier and checks that it matches the challenge from step 1. A stolen `code` alone is useless.
5. GitHub returns an **access token** (8 hours) and a **refresh token** (6 months, single use). We store both encrypted (`lib/crypto.ts`), then set a session cookie.

## Why we keep GitHub tokens at all

Reviews and replies are posted **as you**, so GitHub shows them under your name and avatar (spec §15; with no app badge, as the Plan 3 live run showed). For that we need your token. When it expires, `auth/user-tokens.ts` refreshes it one refresh at a time, because each refresh token works only once.

## Refreshing safely (`auth/user-tokens.ts`)

- **Early:** a token that expires within 5 minutes is refreshed first, so it never runs out halfway through posting a review.
- **One at a time ("single-flight"):** if three writes need a fresh token at once, only the first asks GitHub. The other two share that same answer, and if GitHub is down they fail together instead of queueing up to fail one after another. If all three asked, GitHub would accept the old refresh token once and reject it the other two times, and we'd wrongly decide you have to sign in again. Before asking, the refresh reads the row once more: a write that looked at the row just before another refresh finished finds the new token there and uses it, instead of refreshing with the spent one.
- **Saved only if nothing changed (a version check):** every `GithubAuth` row has a `version` number. We save the new tokens only `where version` is still what we read, and bump it. If someone else saved first, we use their tokens instead of overwriting them. This is called *compare-and-swap* or *optimistic locking*.
- **Failures:** if GitHub says the refresh token is no good, the user is marked `needs_reauth` and Nitpilot stops acting as them until they sign in again. It never falls back to posting as the bot. If the network fails, nothing is marked; the next write tries again.

## The React analogy

Like a "magic link" login, except the link carries a code that only works together with a secret your own server kept.

Single-flight is what React Query does when three components mount with the same query key: one request goes out, and all three get its result.
