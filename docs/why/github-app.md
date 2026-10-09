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

## Installations: keeping our copy in step

An **installation** is one person or org that installed the app, plus the repos they picked. We keep a copy in the `Installation` and `Repo` tables, because every PR chat belongs to a repo. GitHub tells us when that copy goes stale, through three webhooks that `normalize/installation.ts` translates and `ingest/installations.ts` applies:

| GitHub sends | We do |
| --- | --- |
| `installation` created / suspend / unsuspend | create the installation and its repos, or set / clear `suspendedAt` |
| `installation` deleted (app uninstalled) | delete the installation; the database's cascades delete its repos, chats and jobs too |
| `installation_repositories` added / removed | add or delete those `Repo` rows |
| `repository` renamed / publicized / privatized / deleted | update or delete that one `Repo` row |

**Privacy on the hosted instance.** nitpilot.dev runs with `PUBLIC_REPOS_ONLY=true` and keeps nothing about private repos (spec §14.9). When a repo is made private there, we delete its chats right away, and their jobs go with them. A self-hosted server keeps them: it's your own data on your own machine.

**The setup page (`GET /github/setup`).** After someone installs the app, GitHub sends their *browser* to this URL with `?installation_id=…`. The route reads that installation and its repos straight from the API and saves them, so the repos show up at once instead of waiting for the webhook. We never treat `installation_id` as proof of anything, because anyone can type it into a URL. It only triggers a re-read of data GitHub would send us anyway, and nothing is shown or granted based on it.

## Reading a file cheaply (ETags)

`readDefaultBranchFile` sends the **ETag** (a fingerprint of the version we already have) in `If-None-Match`. If the file hasn't changed, GitHub answers `304 Not Modified` with no body, and that call doesn't count against our rate limit.

## The dev tunnel (`npm run dev:tunnel`)

GitHub can't send webhooks to `localhost`, because that address only exists on your machine. `scripts/dev-tunnel.ts` starts a free Cloudflare quick tunnel, which gives your local server a temporary public `https://….trycloudflare.com` address. It then uses the app JWT to point the app's webhook URL at that address. Requests arrive byte for byte, so the signature check runs exactly as in production.

## The React analogy

- The JWT is like a signed session for the app itself, and installation tokens are like short-lived access tokens you get by showing that session.
- The ETag works like a cache key in React Query: "I already have version X; only send data if it changed."
- The tunnel is like `vite --host` plus ngrok: it makes your dev server reachable from outside.
- Syncing installations is like keeping a client-side cache in step with server push events, plus one refetch when the page mounts (the setup route) so you never show stale data while waiting for the first push.
