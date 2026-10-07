# The GitHub App: how Nitpilot talks to GitHub

**In one sentence:** Nitpilot is a GitHub App, people install it on their repos, and it uses three kinds of credentials depending on *who* it's acting as.

## Three credentials, three identities

| Credential | Acts as | Lives | Used for | File |
| --- | --- | --- | --- | --- |
| **App JWT** | the app itself | 9 minutes | asking GitHub for installation tokens, changing the app's webhook URL | `platform/github/app-auth.ts` |
| **Installation token** (`ghs_…`) | the app's bot, on one installation | 1 hour | reading PRs and `.nitpilot.yml`, posting the summary comment | `platform/github/app-auth.ts` |
| **User token** (`ghu_…`) | you | 8 hours, refreshed | posting reviews and replies as you (spec §15) | `auth/user-tokens.ts` |

- **The JWT** is a small signed note that says "I am app 12345". We sign it with the app's **private key** (the `.pem` file GitHub gives you), and GitHub checks it with the matching public key. Nobody else has the private key, so nobody else can make that note. We backdate it by 60 seconds because the server's clock and GitHub's may differ slightly.
- **Installation tokens** are what the JWT buys. Each installation (a person or org that installed the app) gets its own. We cache each one and fetch a new one 5 minutes before it expires, so most reads cost one API call, not two.

## Reading a file cheaply (ETags)

`readDefaultBranchFile` sends the **ETag** (a fingerprint of the version we already have) in `If-None-Match`. If the file hasn't changed, GitHub answers `304 Not Modified` with no body, and that call doesn't count against our rate limit.

## The dev tunnel (`npm run dev:tunnel`)

GitHub can't send webhooks to `localhost`, because that address only exists on your machine. `scripts/dev-tunnel.ts` starts a free Cloudflare quick tunnel, which gives your local server a temporary public `https://….trycloudflare.com` address. It then uses the app JWT to point the app's webhook URL at that address. Requests arrive byte for byte, so the signature check runs exactly as in production.

## The React analogy

- The JWT is like a signed session for the app itself, and installation tokens are like short-lived access tokens you get by showing that session.
- The ETag works like a cache key in React Query: "I already have version X; only send data if it changed."
- The tunnel is like `vite --host` plus ngrok: it makes your dev server reachable from outside.
