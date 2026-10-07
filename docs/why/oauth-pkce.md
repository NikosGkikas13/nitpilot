# How "Sign in with GitHub" works (OAuth + PKCE)

**In one sentence:** we send you to GitHub, GitHub sends you back with a one-time code, and our server swaps that code for tokens; PKCE proves the server swapping the code is the one that started the sign-in.

## The steps (`http/routes/auth.ts`)

1. `GET /auth/github/login`: we make two random strings, a **state** and a **verifier**. They go into an encrypted cookie, and you're redirected to GitHub with the state and `sha256(verifier)`, called the **challenge**.
2. You approve on GitHub. GitHub redirects you to `/auth/github/callback?code=…&state=…`.
3. We check that the `state` matches the cookie. This stops another site from starting a sign-in in your browser.
4. We send GitHub the `code` plus the original **verifier**. GitHub hashes the verifier and checks that it matches the challenge from step 1. A stolen `code` alone is useless.
5. GitHub returns an **access token** (8 hours) and a **refresh token** (6 months, single use). We store both encrypted (`lib/crypto.ts`), then set a session cookie.

## Why we keep GitHub tokens at all

Reviews and replies are posted **as you**, so GitHub shows your avatar plus the app badge (spec §15). For that we need your token. When it expires, `auth/user-tokens.ts` refreshes it one refresh at a time, because each refresh token works only once.

## The React analogy

Like a "magic link" login, except the link carries a code that only works together with a secret your own server kept.
