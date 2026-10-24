# First-run mode and GitHub App manifests (a server that sets itself up)

**In one sentence:** a self-hosted server that starts with no GitHub App serves only a setup page; the page has GitHub create the app from a description the server wrote (a **manifest**), the server stores the app's secrets encrypted, exits, and Docker starts it again, now as a normal Nitpilot.

## The React comparison

Think of a setup wizard in a React app: on first load there's no config, so the router shows only `<SetupWizard />`; every other route redirects to it. The wizard collects a few answers, writes the config somewhere durable, and calls `window.location.reload()`. After the reload the app finds its config and renders normally, and the wizard is never shown again.

First-run mode is that wizard, for the server. "No config" is "no GitHub App credentials"; "writes the config" is one encrypted row in the `GithubAppConfig` table; "reload" is the process exiting and Docker restarting it.

## Why a server needs a GitHub App at all

Nitpilot is a GitHub App (docs/why/github-app.md): that's how it receives webhooks, posts the summary comment, and lets people sign in with GitHub. An app has six credentials (an id, a slug, a private key, an OAuth client id and secret, a webhook secret), and they all point at **one** server's URLs. So every self-hosted server needs its own app. Making one by hand means filling in a long GitHub form and copying six values into `.env` without a typo. First-run mode does it in two clicks.

## What a manifest is

A **GitHub App manifest** is a JSON description of an app: its name, its home page, where to send webhooks, where to send people after signing in and after installing, which events it wants and which permissions it needs. `setup/manifest.ts` builds it from `PUBLIC_URL`, so every URL in it points at this server, with spec §15's events and permissions (the same as the dev app `nitpilot-dev`).

GitHub accepts a manifest only as a real form post from the person's browser (not a `fetch` from our server): the person must be signed in to GitHub and must click "Create GitHub App" themselves. That's why the page builds a `<form method="post" action="https://github.com/settings/apps/new?state=…">` with the manifest in a hidden field, and why, in first-run mode only, the page's Content-Security-Policy lets forms post to GitHub (docs/why/content-security-policy.md).

## The round trip

1. The server starts, finds no app (`loadGithubApp` in `setup/credentials.ts` returns null) and prints a line like `[first-run] Open https://nitpilot.example.com/first-run and enter the setup code: K7PX-3MQD`.
2. The owner opens `/first-run`, types the code, picks their account or an organization, a name, and who may install the app. The page sends that to `POST /api/first-run/manifest` and gets back the manifest and where to post it, with a fresh `state`.
3. The browser posts the form to GitHub. GitHub shows its "Create GitHub App" page, filled in. The owner clicks Create.
4. GitHub sends the browser to `GET /first-run/callback?code=…&state=…`. The server checks the `state`, then trades the `code` for the new app's credentials (`POST /app-manifests/{code}/conversions`, no token needed: the code itself is the proof, it works once and lasts an hour).
5. The server stores them, redirects the browser to `/first-run?done=1`, and half a second later exits. Docker starts it again; this time `loadGithubApp` finds the row, and the server runs normally. The page, polling `GET /api/first-run`, sees `ready` and offers "Install the app".

## Why the setup code exists, and why it's slowed down

A fresh server is reachable by anyone who finds its address, maybe before its owner gets there. Without a check, a stranger could open `/first-run` first and make the server use **their** app: they'd receive its webhooks and own its secrets. The setup code closes that: it's printed only in the server's log, which only the owner can read (`docker compose logs nitpilot`). Every first-run write needs it.

The code is 8 characters from 31 letters and digits (no `0`/`O` or `1`/`I`/`L`, which people mistype), about 850 billion possibilities (`setup/setup-code.ts`). Each address gets 5 tries a minute; the 6th is refused with 429 even when it's right (`RateLimiter` in `lib/rate-limit.ts`, the address from `lib/client-address.ts`). At that rate guessing would take longer than anyone has. A wrong code always gets the same 403, compared in constant time, so the answer gives nothing away.

## Why `state`

The callback is a plain URL that anyone can open. `state` is 32 random bytes the server handed out with the manifest, kept in memory for an hour, and good for one finished callback. If GitHub itself fails during the callback (no answer, a 5xx, a half answer), the `state` stays usable until its original expiry, so reloading retries instead of making the owner create a second app on GitHub; success, GitHub refusing the code and the 409 all use it up. A callback with a missing, wrong, expired or already used `state` is refused and nothing is stored. So the only way to reach step 5 is to have started at step 2, with the setup code. It's the same idea as the `state` in "Sign in with GitHub" (docs/why/oauth-pkce.md).

## Why the credentials are encrypted, and why a changed key stops the server

The private key and the two secrets are stored with AES-256-GCM under `ENCRYPTION_KEY` (`lib/crypto.ts`), like people's GitHub tokens. A database dump or backup alone then can't be used to act as the app.

GCM refuses to decrypt with any other key than the one that encrypted. If `ENCRYPTION_KEY` changes (a new `.env` without the old value), the stored app can't be read. The server then **refuses to start** with "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with." It never falls back into first-run mode: the app still exists on GitHub with every installation, and making a second one would strand them. Putting the old key back fixes it. That's why `.env.example` says to keep a copy of the key.

There is only ever one row (`id = 'app'`), and it's insert-only: a second callback (two tabs, say) gets 409 and the first app stays.

## Why the server exits instead of switching modes in place

Normal mode builds a lot at boot from the app's credentials: the task runner, the WebSocket hubs, recovery of work left from the last run (`runNormally` in `main.ts`). Switching a running process from "nothing" to "all of that" would be a second, rarely used way to start, and a source of half-started bugs. Exiting with code 0 and letting Docker's `restart: unless-stopped` start a fresh process means there's exactly one way into normal mode: boot, find the app, start. The 500 ms wait lets the browser receive its redirect first.

## The environment still wins

If the six `GITHUB_*` variables are set (development with `nitpilot-dev`, or anyone who made their app by hand), the server uses them and first-run mode never happens, even if a stored app exists. They're all six or none: setting only some (a copy-paste slip) stops the server with a message naming the missing ones, rather than starting half configured or, worse, in first-run mode (`lib/env.ts`).

## Where

- `apps/server/src/setup/credentials.ts`: `loadGithubApp`, `saveGithubApp`, and `githubApp()`, which every reader of the app's credentials calls.
- `apps/server/src/setup/manifest.ts`: `buildManifest`, `manifestFormAction`.
- `apps/server/src/setup/setup-code.ts`: `makeSetupCode`, `setupCodeMatches`.
- `apps/server/src/setup/first-run.ts`: the three routes (`firstRunRoutes`), and `readyRoutes` for a server that has its app.
- `apps/server/src/setup/boot.ts`: `startFirstRun`, which prints the code. `apps/server/src/main.ts` picks the mode.
- `apps/server/src/http/app.ts`: `createFirstRunApp`, the 503 for everything else.
- `apps/server/prisma/schema.prisma`: the `GithubAppConfig` model.
