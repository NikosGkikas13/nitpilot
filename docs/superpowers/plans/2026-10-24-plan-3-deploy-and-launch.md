# Plan 3: Deploy and Launch (D1–D5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: D1 to D4 at step level (D2 written 2026-10-24 against `c302c25`, D3 on 2026-10-24 against `d9fe4d8`, D4 on 2026-10-25 against `528639f`; see each "Checked against the code" section); D5 at task level.** Written on 2026-10-24 against `main` at `61fbd64` plus the Plan 3 spec decisions in `a0b2e19` on branch `plan-3-deploy-and-launch`. As in Plan 2, each milestone after D1 is written at step level just before it is built, checked against the code at the head at that point, and gets its own "Checked against the code (Dn)" section. Steps marked **(user)** need the user's own accounts and are click-steps for them; steps marked **(say first)** write to something outside this repo (GitHub, npm, GHCR, DNS, the Hetzner box, the Odyhook repo) and are announced, then done only after the user says go.

**Goal:** Ship Nitpilot: one Docker image, self-hosting that a team with private repos can really use (Compose + a first-run page that creates the GitHub App), the hosted instance on https://nitpilot.dev next to Odyhook, the CLI on npm, and a launch README with a demo video and a Show HN draft.

**Architecture:**
- **One image** (`Dockerfile` at the root): the server and the built web app, `node:22` slim, non-root, `prisma migrate deploy` then the server on start. Published to `ghcr.io/nikosgkikas13/nitpilot` by a tag-driven release workflow, which also publishes the CLI to npm through trusted publishing.
- **First-run mode** in the server: with no GitHub App credentials in the environment or the database, the server serves only the web app's `/first-run` page and its API; the page creates the app through GitHub's manifest flow, the server stores the credentials encrypted in a one-row table and exits, and Docker starts it again in normal mode.
- **Two deploy folders:** `deploy/self-host/` (image + Postgres + Caddy for a team's own server) and `deploy/hosted/` (just `nitpilot-server` on Odyhook's Docker network, using Odyhook's Postgres and Caddy).

**Tech Stack:** everything from Plans 1 and 2, plus Docker (multi-stage build), Caddy 2, GitHub Actions (`docker/build-push-action`, `actions/setup-node` with npm trusted publishing / OIDC), gitleaks (run from its Docker image, never installed). No new runtime dependency in the server, CLI or web app unless a task names it.

**Spec:** `docs/superpowers/specs/2026-10-07-nitpilot-design.md`. Read §7, §8, §14 (9: hosted instance), §15 (the app's events and permissions, for the manifest), §16 (onboarding), §17 (all of it: One image, Closed-chat retention, Hosted instance, Self-hosting), §20 item 4 (D1–D5, demo, acceptance), §21 and §22 before starting. **Builds on:** Plans 1a, 1b and 2, and `docs/superpowers/plans/2026-10-15-plan-2-rulings-and-minors.md` ("Deferred to Plan 3"). **Odyhook's infra** (read, never edit outside the one Caddyfile commit): `~/Desktop/PracticeProjects/hooksmith/{docker-compose.prod.yml,Caddyfile,infra/README.md,.github/workflows/deploy.yml}`.

## Global Constraints

Plans 1 and 2's Global Constraints apply. In addition (values copied from the spec):

- **One Node process + Postgres.** No Redis, no queue, no second server. Self-hosting adds only Postgres and Caddy containers; the hosted instance adds only `nitpilot-server`. Anything that seems to need more: stop and ask (CLAUDE.md).
- **The image:** `node:22` slim, multi-stage, runs as a non-root user, listens on 8787, `prisma migrate deploy` before the server starts, `HEALTHCHECK` on `/healthz`. Named `ghcr.io/nikosgkikas13/nitpilot`, tags `:<version>` and `:latest`; an `-rc.N` tag pushes `:<version>-rc.N` only, never `:latest`, never npm.
- **Node 22 LTS** everywhere the code runs: the image, CI's `setup-node`, the release workflow. The root `engines` says `>=22` (unchanged).
- **The hosted container** is named `nitpilot-server` (never `web`, `postgres` or `redis`), joins the external network `hooksmith_default`, has `mem_limit: 384m`, and lives in `/opt/nitpilot` on the box (`root@157.180.91.106`, hostname `hooksmith`). Its secrets are in `/opt/nitpilot/.env` only.
- **Hosted settings:** `PUBLIC_URL=https://nitpilot.dev`, `PUBLIC_REPOS_ONLY=true`, `CLOSED_CHAT_RETENTION_DAYS=90`, `TRUST_PROXY=true`, `ALLOWED_LOGINS` empty, `VAPID_SUBJECT=https://nitpilot.dev`, fresh `ENCRYPTION_KEY` and VAPID keys made on the server, never printed in chat or committed.
- **Self-hosting `.env`:** the domain (`NITPILOT_DOMAIN`), `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`; optional `SITE_ADDRESS` (defaults to the domain; `:80` behind something that already does TLS). `PUBLIC_REPOS_ONLY` off.
- **First-run mode:** the setup code is printed in the server log at boot and is required by every first-run write; the manifest's `state` is checked on the way back; credentials are stored encrypted with `ENCRYPTION_KEY` in one row; credentials from the environment win and first-run mode never happens then. Everything but the web app, `/first-run`, `/api/first-run/*`, `/first-run/callback` and `/healthz` answers 503 `{ error: { code: 'first_run', message: 'Finish setup at /first-run.' } }` in first-run mode (the house error shape, `http/errors.ts`).
- **The production GitHub App** is `nitpilot`, owned by NikosGkikas13, public (anyone can install). The bot is `nitpilot[bot]`.
- **The repo and its GHCR image go public at the start of D4** (the user's call); the git-history secret scan at the end of D3 must pass first.
- **npm:** package `nitpilot`, published only by the release workflow through trusted publishing with provenance, after the user's one-time `0.0.0` placeholder (D2). No npm token in the repo, its secrets or chat.
- **Odyhook stays untouched** except one reviewed commit adding the `nitpilot.dev` site blocks to its Caddyfile, deployed by its own workflow. Its backup script and cron file are not edited; Nitpilot gets its own.
- **Click-steps** name the GitHub account ("in the browser signed in as NikosGkikas13"), never "Window A/B", and spell out where each thing is on the page and what the user sees after (memory: live-click-steps).
- **Explainers** (CLAUDE.md): Docker images and containers, reverse proxy and TLS, DNS records, GitHub App manifests and first-run mode, releasing (tags, GHCR, trusted publishing, provenance), backups and restores, and trusting a proxy's `X-Forwarded-For`: each in `docs/why/` in the task that first uses it.

## Review Focus

Conditions the spec implies that no task's tests naturally cover, most likely first. Each gets a test in the task named.

1. **A stranger reaches a fresh self-hosted server before its owner does.** Without the setup code nothing in first-run mode can be written; a wrong code is refused the same way each time and slowed down (5 tries per minute per address); a manifest callback with a missing or wrong `state` is refused and stores nothing. → Task 7 (routes), Task 8 (the page shows "wrong code" and keeps the field).
2. **Credentials half set.** Some `GITHUB_*` variables set and some empty (a copy-paste slip in `.env`): the server must refuse to start and name the missing ones, not fall into first-run mode and not start half-configured; a stored row that no longer decrypts (the `ENCRYPTION_KEY` changed) must refuse to start with a message saying so, never overwrite it with a new first run. → Task 7.
3. **Behind Caddy, every request comes from the proxy.** With `TRUST_PROXY=true` the login rate limit counts the address Caddy saw (the last `X-Forwarded-For` entry), so one noisy client can't lock everyone out; without it, a client-sent `X-Forwarded-For` is ignored, so nobody can dodge the limit by forging the header. → Task 2.
4. **The container is restarted mid-job** (`docker compose up -d` with a new image, or the box reboots). SIGTERM must finish the task in flight and close sockets with 1012; migrations on the next start must be safe to run again; CLIs reconnect and keep their jobs. → Task 5 (the image smoke test sends SIGTERM and checks the exit code and the 1012), Task 13 (live).
5. **Postgres goes away under the running server** (Odyhook's Postgres restarted by its own deploy). The advisory-lock connection must not crash the process with an unhandled `error` event that leaves it half alive; it exits non-zero so Docker restarts it, and the restart takes the lock again. → Task 2.

## Carry-forwards

| Item | Where it lands |
|---|---|
| D7 (Plan 2 ledger, W5 ruling): draft Send/Discard and Auto accept the CLI token | Task 1 |
| D6 (Plan 2 Task 5): the CLI's `GET /api/me/chats` lists titles without RepoAccess | Task 1 |
| M4 (Plan 2 final review): "a note from you" compares logins, not GitHub ids | Task 3 |
| The failure reason in the failed banner; a chat banner for a waiting draft | Task 4 |
| A publish crash plus someone pushing on top | Known issue, written in `docs/why/drafts-and-publish-jobs.md` in Task 4; not fixed |
| The main bundle's ~4.7 kB margin under Vite's warning | Task 4 checks it after its change and Task 8 after the first-run page; split Settings (lazy route) only if the warning appears |
| Plan 1b ruling 185: the login rate limit keys on the socket address, which the proxy hides | Task 2 (`TRUST_PROXY`) |
| Plan 1a M6: installation sync reads only 100 repos | Task 2 (follow the `Link` header's `next`) |
| Plan 1a M11: the advisory-lock connection has no error listener | Task 2 |
| Plan 1b Task 5 minors: a server URL with a path prefix loses the prefix; http accepted for non-local hosts | Task 3 |
| Plan 2 Task 1: root engines vs the jsdom chain; pin Node for CI/deploy | Task 5 (Node 22 in the image and both workflows) |
| Spec §17: closed chats kept 90 days on the hosted instance (not built yet) | Task 2 |
| Plan 1b ruling 187: this repo's name in two recorded fixtures; fine once public | Task 10 (the secret scan confirms the fixtures hold no secret) |

## Code facts this plan is built on

Read at `61fbd64`; the step-level text re-checks each one.

- **`getEnv`** (`apps/server/src/lib/env.ts`) requires all six `GITHUB_*` values; `main.ts` builds `AppAuth` from `env.GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` before anything else. Task 7 turns these into one `GithubAppCredentials` value loaded from the environment or the database.
- **SIGTERM** already runs `shutdown()` in `main.ts` (runner stopped, sockets closed with 1012, lock released). The image must run node as PID 1's direct child or use `--init` so the signal arrives (`tini` via `docker run --init` / compose `init: true`).
- **`npm start -w apps/server`** runs `tsx src/main.ts`. The image keeps that (no extra compile step): `tsx` and the generated Prisma client go into the runtime stage.
- **`/healthz`** exists (`http/app.ts:55`) and is in the SPA's `SERVER_PATHS`.
- **The login rate limit** is `RateLimiter(LOGIN_STARTS_PER_MINUTE, 60_000)` keyed by `clientAddress(c)` = `incoming.socket.remoteAddress` (`http/routes/cli.ts:25,84`).
- **`sessionOnly(c)`** exists only inside `http/routes/cli-requests.ts:42`; the drafts and Auto routes (`http/routes/chat-drafts.ts:23,34,41`) use `requireUser, requireSameOrigin`, which let a CLI token through.
- **`GET /api/me/chats`** (`http/routes/cli.ts:45`) takes `requireCliToken` and returns up to 100 open chats with no access check. `RepoAccess.check(userId, repoFullName)` answers `'read' | 'none' | 'reauth'`; the inbox already filters rows with it in `rowsInReposYouCanRead` (`http/routes/inbox.ts:48`).
- **Installation sync** reads `GET /installation/repositories?per_page=100` once (`ingest/installations.ts:64`).
- **`acquireSingletonLock`** (`lib/advisory-lock.ts`) opens a `pg.Client` with no `error` listener.
- **Purge:** `purgeOldRows` (`ingest/record.ts`) runs hourly from `main.ts`; deleting a `PrChat` cascades to everything under it (as `repository.privatized` already does, `ingest/installations.ts:42`).
- **Notes in a job bundle** are `{ author: string, body, at }` and `you` is `{ login, role }` (`packages/protocol/src/job-bundle.ts:58,75`); the CLI compares logins (`apps/cli/src/mcp/tools/read.ts:203`).
- **The CLI** joins paths with `new URL(path, server)` (`apps/cli/src/http.ts:77`, `connection/ws-client.ts:90`) and its config accepts any `http(s)` URL (`config/config.ts:41`). `DEFAULT_SERVER` is already `https://nitpilot.dev`; `CLI_VERSION` (`apps/cli/src/version.ts`) and `apps/cli/package.json` are both `0.1.0`.
- **The failed banner** (`apps/web/src/routes/Chat/ChatBanner.tsx`, `failed_job`) says "The timeline says why."; `ChatView.viewer.failure` is only `'agent' | 'github_post' | null` (`packages/protocol/src/web-api.ts:332`); `chatBanner(view, me)` is pure in `apps/web/src/lib/banner.ts`.

## How to work in this repo

- Plans 1 and 2's "How to work in this repo" apply: Postgres in Docker on port 5433 (`open -a Docker`, then `docker start nitpilot-postgres-1`), `apps/server/.env` (real secrets: never print it), tests use `nitpilot_test`.
- Baseline at `61fbd64`: protocol 82, CLI 335 + 14 skipped, server 1037, web 335, `npm run test:e2e` 6, Playwright 18; typecheck, lint and build clean. Each task names the counts it ends with.
- One task per turn, then stop for review. Strict TDD for code: watch each new test fail, then pass, then run `npm test && npm run typecheck && npm run lint` (plus `npm run test:e2e` / `npm run test:web-e2e` when a task touches them). Infra tasks verify with the commands they name (`docker build`, `docker compose config`, the smoke script) instead of unit tests.
- Live checks use the dev app `nitpilot-dev` and the sandbox `NikosGkikas13/nitpilot-sandbox` until D4; from D4 on, the production app `nitpilot`. Ask before anything writes to GitHub, runs Claude Code, or touches the server.
- SSH to the box from this Mac: `ssh root@157.180.91.106`. Commands that print secrets are run by the user, not by me.
- Commit after every task, with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge; the user does.

---

## Milestone D1: Before going public

D1 closes every Plan 2 leftover that a stranger could hit, and the deploy-hardening items that only matter once a proxy and real traffic exist. Nothing here needs an account of the user's.

**Files at the end of D1:**
```
apps/server/src/auth/request-user.ts          + requireSession (moved from cli-requests.ts)
apps/server/src/http/routes/chat-drafts.ts    Send / Discard / Auto: requireSession
apps/server/src/http/routes/cli.ts            /api/me/chats filtered by RepoAccess; clientAddress via lib/client-address.ts
apps/server/src/lib/client-address.ts         clientAddress(c, trustProxy)
apps/server/src/lib/env.ts                    + TRUST_PROXY, CLOSED_CHAT_RETENTION_DAYS
apps/server/src/lib/advisory-lock.ts          error listener → onLost
apps/server/src/ingest/installations.ts       every page of /installation/repositories
apps/server/src/ingest/record.ts              + purgeClosedChats
packages/protocol/src/job-bundle.ts           notes[].authorGithubId, you.githubId
packages/protocol/src/web-api.ts              viewer.failureReason; Banner gets 'drafts'
apps/cli/src/mcp/tools/read.ts                fromYou by GitHub id
apps/cli/src/http.ts, connection/ws-client.ts, config/config.ts   path prefix kept; http only for localhost
apps/web/src/lib/banner.ts, routes/Chat/ChatBanner.tsx           failure reason text; waiting-draft banner
docs/why/trusting-a-proxy.md
```

### Task 1: Server access: drafts and Auto cookie-only, `/api/me/chats` behind RepoAccess

**Files:**
- Modify: `apps/server/src/auth/request-user.ts`, `apps/server/src/http/routes/cli-requests.ts`, `apps/server/src/http/routes/chat-drafts.ts`, `apps/server/src/http/routes/cli.ts`
- Test: `apps/server/src/http/routes/chat-drafts.db.test.ts`, `apps/server/src/http/routes/cli.db.test.ts`, `apps/server/src/auth/request-user.test.ts` (or its db test, whichever exists)

**Interfaces:**
- Consumes: `requireUser`, `UserVariables` (`c.get('via')` = `'session' | 'cli'`), `HttpError('unauthorized', …)`, `RepoAccess.check(userId, repoFullName): Promise<'read' | 'none' | 'reauth'>`, `AppDeps.access`.
- Produces: `requireSession` middleware in `auth/request-user.ts` (goes after `requireUser`; a CLI-token request → 401 `{ error: 'unauthorized', message: 'Sign in with GitHub first.' }`). `cli-requests.ts` uses it instead of its local `sessionOnly`. `registerCliRoutes` takes `access: RepoAccess` from deps.

- [x] **Step 1: Write the failing tests**

In `chat-drafts.db.test.ts`, a `describe('only a browser can send, discard or switch Auto')` using the existing `scene()` / `reviewDraft()` plus a CLI token for leo (`makeCliToken(leo.id)`), requests sent with `authorization: Bearer <token>` and no cookie:

```ts
it('refuses Send with a CLI token', async () => {
  const s = await reviewDraft();
  const res = await asCli(s, 'leo', 'POST', `/api/chats/${s.chat.id}/drafts/${s.review.id}/send`);
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: 'unauthorized', message: 'Sign in with GitHub first.' });
  expect((await prisma.job.findUniqueOrThrow({ where: { id: s.review.id } })).applyState).toBe('draft');
});
it('refuses Discard with a CLI token', /* same shape: 401, applyState still 'draft' */);
it('refuses Auto with a CLI token', /* PUT /auto {role:'reviewer', on:true} → 401, the participant's auto unchanged */);
```

In `cli.db.test.ts`, `describe('GET /api/me/chats')`:

```ts
it('lists only chats in repos the person can still read', async () => {
  // two chats for the same user in repos `o/readable` and `o/gone`; the fake GitHub answers 404 for o/gone
  const res = await getMyChats(token);
  expect((await res.json()).chats.map((c: MyChat) => c.repo)).toEqual(['o/readable']);
});
it('answers 401 "sign in again" when the GitHub sign-in expired', async () => {
  // makeGithubSignIn(user.id, 'needs_reauth')
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: 'reauth' }); // the inbox's HttpError('reauth', …)
});
it('asks GitHub once per repo, not once per chat', /* 3 chats in one repo → fake fetch saw 1 GET /repos/o/readable */);
```

- [x] **Step 2: Run them to see them fail**

Run: `npm run test:db -w apps/server -- chat-drafts cli.db`
Expected: the three draft tests FAIL (200 / 409 instead of 401), the first two `/api/me/chats` tests FAIL (the gone repo is listed; 200 instead of 401).

- [x] **Step 3: Implement**

Move `sessionOnly` to `auth/request-user.ts` as the middleware `requireSession` and use it in `cli-requests.ts` and on the three routes in `chat-drafts.ts` (`requireUser, requireSession, requireSameOrigin`). In `/api/me/chats`, reuse the inbox's filter: export `rowsInReposYouCanRead` from `http/routes/inbox.ts` (move it to `chats/repo-filter.ts` if a route file importing another route file reads badly), make it generic over `{ repo: string }`, and run the mapped `MyChat[]` through it. That brings the same `reauth` 401 and `github_unavailable` 502 the inbox gives.

- [x] **Step 4: Run them to see them pass, then the whole suite**

Run: `npm run test:db -w apps/server -- chat-drafts cli.db` → PASS. Then `npm test && npm run typecheck && npm run lint` → server 1043 (1037 + 6), everything else unchanged.

- [x] **Step 5: Commit**

```bash
git add apps/server/src
git commit -m "fix(server): drafts and Auto take only the browser's cookie, and the CLI's chat list checks repo access"
```

### Task 2: Deploy hardening: proxy addresses, every installed repo, a lost lock, closed-chat retention

**Files:**
- Create: `apps/server/src/lib/client-address.ts`, `apps/server/src/lib/client-address.test.ts`, `docs/why/trusting-a-proxy.md`
- Modify: `apps/server/src/lib/env.ts` (+ test), `apps/server/src/http/routes/cli.ts`, `apps/server/src/ingest/installations.ts` (+ db test), `apps/server/src/lib/advisory-lock.ts` (+ db test), `apps/server/src/ingest/record.ts` (+ db test), `apps/server/src/main.ts`, `apps/server/.env.example`

**Interfaces:**
- Produces:
  - `Env.TRUST_PROXY: boolean` (`z.stringbool().default(false)`), `Env.CLOSED_CHAT_RETENTION_DAYS: number | undefined` (optional positive int; empty = unset).
  - `clientAddress(c: Context, trustProxy: boolean): string` — with `trustProxy`, the **last** entry of `X-Forwarded-For` (trimmed), falling back to the socket; without it, the socket address, header ignored; `'unknown'` when neither exists.
  - `acquireSingletonLock(databaseUrl, key?, onLost?: (err: Error) => void)` — `onLost` is called once if the lock's connection errors or ends unexpectedly. `main.ts` passes `(err) => { console.error('[lock] lost the database connection; exiting so Docker restarts the server', err); process.exit(1); }`.
  - `purgeClosedChats(now: Date, retentionDays: number): Promise<number>` in `ingest/record.ts`, deleting `PrChat` rows with `closedAt < now − days` (cascade); `main.ts` calls it in the hourly purge only when `CLOSED_CHAT_RETENTION_DAYS` is set.

- [x] **Step 1: Write the failing tests**

```ts
// client-address.test.ts
it('trusts the last X-Forwarded-For entry behind our proxy', () =>
  expect(clientAddress(ctx({ xff: '6.6.6.6, 203.0.113.9', socket: '172.18.0.5' }), true)).toBe('203.0.113.9'));
it('ignores X-Forwarded-For when not behind a proxy', () =>
  expect(clientAddress(ctx({ xff: '6.6.6.6', socket: '198.51.100.2' }), false)).toBe('198.51.100.2'));
it('falls back to the socket when the proxy sent no header', () =>
  expect(clientAddress(ctx({ socket: '172.18.0.5' }), true)).toBe('172.18.0.5'));

// env.test.ts
it('reads TRUST_PROXY and CLOSED_CHAT_RETENTION_DAYS', () => {
  expect(getEnv({ ...base, TRUST_PROXY: 'true', CLOSED_CHAT_RETENTION_DAYS: '90' })).toMatchObject({ TRUST_PROXY: true, CLOSED_CHAT_RETENTION_DAYS: 90 });
  expect(getEnv({ ...base, CLOSED_CHAT_RETENTION_DAYS: '' }).CLOSED_CHAT_RETENTION_DAYS).toBeUndefined();
  expect(() => getEnv({ ...base, CLOSED_CHAT_RETENTION_DAYS: '0' })).toThrow(/CLOSED_CHAT_RETENTION_DAYS/);
});

// cli.db.test.ts (login rate limit)
it('counts login starts per client behind the proxy', async () => {
  // app built with TRUST_PROXY on; 10 starts from XFF 203.0.113.1 → 11th from it is 429, a start from 203.0.113.2 is 200
});

// installations.db.test.ts
it('syncs every page of an installation with more than 100 repos', async () => {
  // fake GET /installation/repositories?per_page=100 answers 100 repos + Link: <…&page=2>; rel="next"; page 2 answers 30
  expect(await prisma.repo.count({ where: { installationId } })).toBe(130);
});

// advisory-lock.db.test.ts
it('tells the server when the lock connection dies', async () => {
  const lost = vi.fn();
  const lock = await acquireSingletonLock(url, uniqueKey(), lost);
  await terminateBackendHolding(uniqueKey()); // SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND objid=$1
  await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
});

// record.db.test.ts
it('deletes chats closed longer ago than the retention, and keeps the rest', async () => {
  // chats: closed 91 days ago, closed 89 days ago, open since 200 days ago
  expect(await purgeClosedChats(now, 90)).toBe(1);
  // the 89-day one and the open one remain; the 91-day one's messages and jobs are gone too
});
```

- [x] **Step 2: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- client-address env && npm run test:db -w apps/server -- cli.db installations advisory-lock record`
Expected: FAIL (module missing, unknown keys, 429 for the second client, 100 repos, `lost` never called, `purgeClosedChats` missing).

- [x] **Step 3: Implement** as the Interfaces say. `clientAddress` moves out of `routes/cli.ts`; `registerCliRoutes` reads `trustProxy` from deps (wired from `env.TRUST_PROXY` in `createApp`). Installation sync follows `Link: rel="next"` until there is none (GitHub's pagination), with the existing `GithubClient.api` (add a `response headers` return if it doesn't expose them; one helper `apiAllPages<T>(path, pick, opts)` in `platform/github/client.ts`). The lock listens to the client's `error` and `end` events. Add both variables to `.env.example` under "Hosted instance only" with one comment line each. Write `docs/why/trusting-a-proxy.md`: what `X-Forwarded-For` is, why only the last hop is ours, why the header is ignored without a proxy, in React terms (a value you only trust from your own parent component), pointing at `lib/client-address.ts`.

- [x] **Step 4: Run them to see them pass, then the whole suite**

Run the Step 2 command → PASS; then `npm test && npm run typecheck && npm run lint` → server about 1053.

- [x] **Step 5: Commit**

```bash
git commit -am "feat(server): ready for a proxy and real traffic: forwarded addresses, every installed repo, a lost lock exits, closed-chat retention"
```

### Task 3: CLI: notes trusted by GitHub id; server URLs with a path, and https off localhost

**Files:**
- Modify: `packages/protocol/src/job-bundle.ts` (+ `test-samples.ts`, tests), `apps/server/src/jobs/bundle.ts` (fills `notes` at line 87 and `you`) + its test, `apps/cli/src/mcp/tools/read.ts` (+ test), `apps/cli/src/http.ts` (+ test), `apps/cli/src/connection/ws-client.ts` (+ test), `apps/cli/src/config/config.ts` (+ test)

**Interfaces:**
- Produces: `AgentJobBundle.notes[i].authorGithubId: string` and `AgentJobBundle.you.githubId: string` (GitHub ids are strings in this codebase, as `Person.githubId`). `joinServerUrl(server: string, path: string): URL` in `apps/cli/src/http.ts`, used by `ServerClient` and `wsUrlFor`. Config `server` refine: `https:` always; `http:` only for `localhost`, `127.0.0.1`, `[::1]` or a `*.localhost` host, else the config error "The server address must start with https:// (http is only for a server on this computer)."

- [x] **Step 1: Write the failing tests**

```ts
// read.test.ts
it('trusts a note from your own GitHub id even if your login changed', /* you {login:'new-name', githubId:'42'}, note {author:'old-name', authorGithubId:'42'} → fromYou true */);
it("doesn't trust a note from someone who took your old login", /* you {login:'maya', githubId:'42'}, note {author:'maya', authorGithubId:'99'} → fromYou false */);

// http.test.ts
it('keeps a path prefix on the server address', () => {
  expect(joinServerUrl('https://h.example/nitpilot', '/api/me').href).toBe('https://h.example/nitpilot/api/me');
  expect(joinServerUrl('https://h.example/nitpilot/', '/api/me').href).toBe('https://h.example/nitpilot/api/me');
  expect(joinServerUrl('https://nitpilot.dev', '/api/me').href).toBe('https://nitpilot.dev/api/me');
});
// ws-client.test.ts
it('keeps the path prefix for the socket', () => expect(wsUrlFor('https://h.example/nitpilot').href).toBe('wss://h.example/nitpilot/ws/cli'));

// config.test.ts
it('takes http only for a server on this computer', () => {
  expect(load({ server: 'http://localhost:8787' }).server).toBe('http://localhost:8787');
  expect(load({ server: 'http://app.localhost:5173' }).server).toBeDefined();
  expect(() => load({ server: 'http://nitpilot.example' })).toThrow('must start with https://');
});
```

Plus a server db test where the bundle builder fills `notes[].authorGithubId` and `you.githubId` from the `Message.authorGithubId` and the participant.

- [x] **Step 2: Run them to see them fail** — `npm test -w apps/cli -- read http ws-client config && npm test -w packages/protocol`. Expected: FAIL.

- [x] **Step 3: Implement.** `fromYou = note.authorGithubId === bundle.you.githubId`. `joinServerUrl` appends `path` (without its leading slash) to the server URL with exactly one slash between. The protocol change is required in both places: the CLI and the server ship together from D5 on, and no public CLI exists yet, so no protocol version bump (say so in the commit message).

- [x] **Step 4: Run them to see them pass, then the whole suite** (+ `npm run test:e2e`, since bundles change) → protocol ~84, CLI ~343, server ~1054, e2e 6.

- [x] **Step 5: Commit** — `fix(cli): notes trusted by GitHub id; server addresses keep their path, and http only on this computer`.

### Task 4: Web: why a job failed, and a banner for a waiting draft

**Files:**
- Modify: `packages/protocol/src/web-api.ts` (+ test), the server's chat view (`apps/server/src/chats/views.ts`: fill `viewer.failureReason` from the person's newest failed job), `apps/web/src/lib/banner.ts` (+ test), `apps/web/src/routes/Chat/ChatBanner.tsx` (+ test), `docs/why/drafts-and-publish-jobs.md` (the known issue)

**Interfaces:**
- Produces: `ChatView.viewer.failureReason: FailureReason | null` (null unless `attention === 'failed'` with `failure === 'agent'`). `Banner` gains `{ kind: 'drafts'; count: number }`, chosen by `chatBanner` after every failure, escalation and cap banner and before `waiting`, when the viewer has waiting drafts (`view.drafts` that are theirs). `failureText(reason: FailureReason): string` in `lib/banner.ts`.

- [x] **Step 1: Write the failing tests**

```ts
// banner.test.ts
it('explains a failed job in words', () => {
  expect(failureText('quota')).toBe('Your agent ran out of usage for now. Retry once your plan resets.');
  expect(failureText('auth')).toBe("Your agent isn't signed in on that computer. Sign it in, then Retry.");
  expect(failureText('timeout')).toBe('Your agent took too long and was stopped.');
  expect(failureText('branch_moved')).toBe('Someone pushed to the branch while your agent was working.');
  // every FailureReason has a sentence: Object.values(FailureReason.enum).every((r) => failureText(r).length > 0)
});
it('shows a banner for your waiting drafts', () =>
  expect(chatBanner(viewWith({ drafts: [mine('job_7')] }), me)).toEqual({ kind: 'drafts', count: 1 }));
it('an escalation still beats your drafts', /* escalated + a draft → kind 'escalated' */);

// ChatBanner.test.tsx
it('says why your agent failed', /* failed_job with failureReason 'quota' → the quota sentence instead of "The timeline says why." */);
it('points at your drafts', /* {kind:'drafts', count:2} → "2 drafts wait for you" and a "Review drafts" button that scrolls to the first draft card */);
```

Server db test: a chat whose reviewer's newest job failed with `quota` → `viewer.failureReason === 'quota'`.

- [x] **Step 2: Run them to see them fail.** `npm test -w apps/web -- banner ChatBanner && npm run test:db -w apps/server -- views`.

- [x] **Step 3: Implement.** Copy for the sentences not listed above: one plain sentence each, no jargon, in the voice of the existing banners; the drafts banner is `tone="muted"`, title "`N` draft(s) wait for you", body "Your agent's work is ready. Send it or discard it.", button "Review drafts". Add the known issue to `docs/why/drafts-and-publish-jobs.md`: if the CLI crashes after pushing a draft but before reporting it and someone pushes on top, the retry sees a moved branch and the draft is marked out of date though its commit landed; the chat carries on correctly from the new head.

- [x] **Step 4: Run them to see them pass; whole suite; `npm run build -w apps/web`** and check Vite prints no chunk-size warning (if it does, make `routes/Settings` a lazy route in this task). Look at the two banners in the in-app browser, both themes, desktop and phone width.

- [x] **Step 5: Commit** — `feat(web): the failed banner says why, and waiting drafts get a banner`.

---

## Milestone D2: One image and the release workflow

D2 makes the thing that gets deployed: one image that holds the server and the web app, built and smoke-tested in CI on every PR, and a release workflow driven by tags. It ends with the npm name claimed and linked to the workflow, and an `-rc` image on GHCR built from this branch.

**Written at step level on 2026-10-24** against `c302c25`. Every file below was built and run first in a scratch worktree (`~/Desktop/PracticeProjects/.nitpilot-scratch/d2`, its own throwaway Postgres containers, no `.env`): Task 5 is pinned at `refs/scratch/d2/task-5` (`0d9e5d3`), Task 6 at `refs/scratch/d2/task-6` (`069f775`). The file contents in the steps are copied from those commits. What differs from the task-level text is listed in "Checked against the code (D2)" at the end of the milestone.

**Files at the end of D2:**
```
Dockerfile                                   the one image (deps → build → prod-deps → runtime)
.dockerignore                                no .env, no node_modules, no docs in the build context
scripts/image-smoke.sh                       npm run image:smoke: build, run against a throwaway Postgres, SIGTERM, restart
scripts/check-release-version.mjs (+ .test.mjs)   is this tag a version we can release?
.github/workflows/ci.yml                     Node 22.x; npm publish --dry-run; job `image` (build + smoke)
.github/workflows/release.yml                v* tag → image to GHCR; real release → CLI to npm (trusted publishing)
package.json                                 image:smoke; npm test also runs scripts/*.test.mjs
apps/server/package.json, package-lock.json  prisma and tsx move to dependencies
apps/cli/package.json                        repository, homepage, bugs, keywords, license
eslint.config.mjs                            scripts/**/*.mjs get Node's globals
LICENSE, apps/cli/LICENSE                    (the user's pick at review; see the D2 deviations)
docs/why/docker-images.md, docs/why/releasing.md, docs/releasing.md
```

### Task 5: The Dockerfile and its smoke test

**Files:**
- Create: `scripts/image-smoke.sh`, `Dockerfile`, `.dockerignore`, `docs/why/docker-images.md`
- Modify: `package.json` (`image:smoke`), `apps/server/package.json` + `package-lock.json` (`prisma` and `tsx` become dependencies), `.github/workflows/ci.yml` (Node `22.x`; a new `image` job)

**Interfaces:**
- Consumes: `npm run db:generate -w apps/server` (Prisma client into `apps/server/src/generated/prisma`), `npm run build -w apps/web` (`apps/web/dist`), `WEB_DIST_DIR` (`lib/env.ts`, read by `http/spa.ts`), `GET /healthz` → `{ ok: true, version }` (`http/app.ts:58`), the SIGTERM `shutdown()` in `main.ts` (closes CLI sockets with `CLOSE_CODES.serverRestart` = 1012, then `process.exit(0)`), `authenticateCliToken` (sha256 of `nit_…` in `CliToken.tokenHash`), the CLI hub's 10 s hello timeout (`ws/cli-hub.ts:14`).
- Produces: an image that runs as `node` (uid 1000) in `/app/apps/server`, `EXPOSE 8787`, `ENV NODE_ENV=production PORT=8787 WEB_DIST_DIR=/app/apps/web/dist CHECKPOINT_DISABLE=1`, label `org.opencontainers.image.source=https://github.com/NikosGkikas13/nitpilot` (Task 6's GHCR push relies on it), `HEALTHCHECK` via node's `fetch` on `/healthz`, and `CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && exec node --import tsx src/main.ts"]`. Containers are started with `--init` / compose `init: true` (D3, D4).
- Produces: `npm run image:smoke` (exit 0 = pass; `NITPILOT_SMOKE_SKIP_BUILD=1` tests an image already tagged `nitpilot:smoke`). Task 6 and every later task run it.

- [x] **Step 1: Write the smoke test first**

Create `scripts/image-smoke.sh`:

```bash
#!/usr/bin/env bash
# The image smoke test (plan 3, Task 5): build the image, run it against a throwaway Postgres, and check that it
# serves, stops cleanly on SIGTERM (exit 0, CLIs told 1012 "server restarting") and starts again on a database whose
# migrations already ran. Everything it makes is removed at the end, pass or fail. See docs/why/docker-images.md.
#
#   npm run image:smoke                              build, then test
#   NITPILOT_SMOKE_SKIP_BUILD=1 npm run image:smoke  test an image already tagged nitpilot:smoke (CI builds it first)
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=nitpilot:smoke
RUN="nitpilot-smoke-$$"
NET="$RUN-net"
DB="$RUN-db"
APP="$RUN-app"
WS="$RUN-ws"
OFFLINE="$RUN-offline"
MIGRATE="$RUN-migrate"
MEMORY_LIMIT_MIB=384

# Test-only values for a database that lives for a minute. None of them is a secret.
DB_URL="postgresql://nitpilot:smoke@$DB:5432/nitpilot"
SMOKE_TOKEN='nit_image-smoke-only-not-a-real-token'
SMOKE_TOKEN_HASH='74bf1f0eb2c7a3bd187e3c4af546ecf3b98d077eb1c3691865651b8c3276f7eb' # sha256 of SMOKE_TOKEN

cleanup() {
  docker rm -f "$WS" "$APP" "$MIGRATE" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" "$OFFLINE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "image-smoke: FAIL: $*" >&2
  if docker inspect "$APP" >/dev/null 2>&1; then
    echo "--- server log (last 40 lines) ---" >&2
    docker logs "$APP" 2>&1 | tail -40 >&2 || true
  fi
  exit 1
}

step() { echo "image-smoke: $*"; }

# Does this text contain the pattern? (Not `cmd | grep -q`: grep stops reading early, and under pipefail the command
# it cut off counts as failed.)
contains() { grep -q -- "$2" <<<"$1"; }

if [ "${NITPILOT_SMOKE_SKIP_BUILD:-}" != "1" ]; then
  step "building $IMAGE"
  docker build -t "$IMAGE" . || fail "docker build failed"
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "no image $IMAGE (is there a Dockerfile?)"

step "starting a throwaway Postgres"
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
  -e POSTGRES_USER=nitpilot -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=nitpilot \
  postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -h 127.0.0.1 -U nitpilot -d nitpilot >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB" pg_isready -h 127.0.0.1 -U nitpilot -d nitpilot >/dev/null 2>&1 || fail "Postgres never became ready"

step "starting the server"
# Placeholder GitHub App values: the server starts with them, and its one GitHub call at boot (asking for failed
# deliveries) fails to sign and is logged and skipped, so the test never talks to GitHub.
# --init puts a tiny init process (tini) in front, as compose's `init: true` does, so `docker stop` reaches node.
docker run -d --init --name "$APP" --network "$NET" -p 127.0.0.1::8787 \
  -e DATABASE_URL="$DB_URL" \
  -e PUBLIC_URL=http://localhost:8787 \
  -e ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  -e GITHUB_APP_ID=1 \
  -e GITHUB_APP_SLUG=nitpilot-smoke \
  -e GITHUB_APP_PRIVATE_KEY=not-a-real-key \
  -e GITHUB_CLIENT_ID=smoke-client-id \
  -e GITHUB_CLIENT_SECRET=smoke-client-secret \
  -e GITHUB_WEBHOOK_SECRET=smoke-webhook-secret \
  "$IMAGE" >/dev/null
# The host port is picked by Docker, and picked again on every start.
base_url() { echo "http://127.0.0.1:$(docker port "$APP" 8787/tcp | head -1 | sed 's/.*://')"; }

wait_healthy() {
  BASE=$(base_url) || fail "no published port: the server exited while starting"
  for _ in $(seq 1 90); do
    [ "$(docker inspect -f '{{.State.Running}}' "$APP")" = "true" ] || fail "the server exited while starting"
    contains "$(curl -fsS "$BASE/healthz" 2>/dev/null || true)" '"ok":true' && return 0
    sleep 1
  done
  fail "/healthz never answered 200"
}

wait_healthy
step "/healthz answers"

# Docker's own HEALTHCHECK (the one compose and `docker ps` show) runs inside the container: wait for it too.
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP")" = "healthy" ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$APP")" = "healthy" ] || fail "Docker's HEALTHCHECK never reported healthy"
step "Docker reports the container healthy"

contains "$(curl -fsS "$BASE/" || true)" '<title>Nitpilot</title>' || fail "GET / is not the web app's index.html"
step "GET / is the web app"

# A FRESH container (not a restart of one that already downloaded something into its own writable layer) must run its
# migrations with no internet: Prisma's schema engine has to be in the image. `--internal` is a network with no route out.
docker network create --internal "$OFFLINE" >/dev/null
docker network connect "$OFFLINE" "$DB"
OFFLINE_OUT=$(docker run --rm --name "$MIGRATE" --network "$OFFLINE" -e DATABASE_URL="$DB_URL" -e CHECKPOINT_DISABLE=1 \
  "$IMAGE" /app/node_modules/.bin/prisma migrate deploy 2>&1) \
  || fail "a fresh container could not run its migrations offline: $OFFLINE_OUT"
if contains "$OFFLINE_OUT" 'binaries.prisma.sh' || contains "$OFFLINE_OUT" 'failed to detect the libssl'; then
  fail "a fresh container tried to download Prisma's engine: $OFFLINE_OUT"
fi
step "a fresh container migrates with no internet"

step "image size: $(docker image ls "$IMAGE" --format '{{.Size}}')"
MEMORY=$(docker stats --no-stream --format '{{.MemUsage}}' "$APP" | cut -d/ -f1 | tr -d ' ')
step "idle memory: $MEMORY"
MEMORY_MIB=$(echo "$MEMORY" | awk '/GiB$/ { print int($0 * 1024); next } /MiB$/ { print int($0); next } /KiB$/ { print 0; next } { print 99999 }')
[ "$MEMORY_MIB" -lt "$MEMORY_LIMIT_MIB" ] || fail "idle memory $MEMORY is over ${MEMORY_LIMIT_MIB} MiB"

# A connected CLI, to see the 1012 it gets on shutdown: a user and a CLI token straight into the throwaway database,
# then a WebSocket client run from the same image (it has the ws package) on the same network. It never says hello,
# and the hub closes such a socket after 10 s (ws/cli-hub.ts), so the stop below comes right after it opens.
docker exec "$DB" psql -q -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot -c "
  INSERT INTO \"User\" (id, \"githubId\", login, \"updatedAt\") VALUES ('smoke-user', '1', 'smoke', now());
  INSERT INTO \"CliToken\" (id, \"userId\", name, \"tokenHash\", prefix, \"updatedAt\")
    VALUES ('smoke-token', 'smoke-user', 'smoke', '$SMOKE_TOKEN_HASH', 'nit_imag', now());" >/dev/null \
  || fail "could not add the smoke CLI token"
docker run -d --name "$WS" --network "$NET" -e SMOKE_TOKEN="$SMOKE_TOKEN" "$IMAGE" node -e "
  const WebSocket = require('ws');
  const ws = new WebSocket('ws://$APP:8787/ws/cli', { headers: { authorization: 'Bearer ' + process.env.SMOKE_TOKEN } });
  ws.on('open', () => console.log('open'));
  ws.on('close', (code) => { console.log('close ' + code); process.exit(code === 1012 ? 0 : 1); });
  ws.on('error', (err) => { console.log('error ' + err.message); process.exit(1); });
" >/dev/null
for _ in $(seq 1 20); do
  contains "$(docker logs "$WS" 2>&1)" '^open' && break
  sleep 0.5
done
contains "$(docker logs "$WS" 2>&1)" '^open' || fail "the CLI socket never opened: $(docker logs "$WS" 2>&1)"
step "a CLI socket is connected"

step "docker stop (SIGTERM)"
START=$(date +%s)
docker stop -t 10 "$APP" >/dev/null
ELAPSED=$(( $(date +%s) - START ))
EXIT_CODE=$(docker inspect -f '{{.State.ExitCode}}' "$APP")
[ "$EXIT_CODE" = "0" ] || fail "the server exited with $EXIT_CODE after SIGTERM, not 0 (137 means Docker had to kill it)"
[ "$ELAPSED" -lt 10 ] || fail "the server took ${ELAPSED}s to stop"
step "stopped with exit code 0 in ${ELAPSED}s"

WS_EXIT=$(docker wait "$WS")
[ "$WS_EXIT" = "0" ] || fail "the CLI socket did not close with 1012: $(docker logs "$WS" 2>&1 | tr '\n' ' ')"
step "the CLI socket closed with 1012"

step "starting the same container again (migrations already applied)"
docker start "$APP" >/dev/null
wait_healthy
contains "$(docker logs "$APP" 2>&1)" 'No pending migrations to apply' || fail "the second start did not find the migrations already applied"
step "/healthz answers after the restart"

echo "image-smoke: PASS"
```

In the root `package.json` scripts, after `dev:tunnel`:

```json
    "image:smoke": "bash scripts/image-smoke.sh"
```

- [x] **Step 2: Run it to see it fail**

Run: `npm run image:smoke`
Expected: exit 1, ending with
```
ERROR: failed to build: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
image-smoke: FAIL: docker build failed
```
and nothing left behind: `docker ps -a --filter name=nitpilot-smoke -q` and `docker network ls --filter name=nitpilot-smoke -q` print nothing.

- [x] **Step 3: Make `prisma` and `tsx` runtime dependencies of the server**

The image installs only runtime dependencies (`npm ci --omit=dev`), and the container needs both: `prisma` for `migrate deploy`, `tsx` to run `src/main.ts` (today `tsx` is a root devDependency and `prisma` a server devDependency).

```bash
cd apps/server && npm pkg delete devDependencies.prisma && npm pkg set dependencies.prisma='^7.10.0' dependencies.tsx='^4.23.15' && cd ../..
npm install --ignore-scripts
```

Expected: `apps/server/package.json` lists `"prisma": "^7.10.0"` and `"tsx": "^4.23.15"` under `dependencies` (alphabetical, after `pg`), and `prisma` is gone from its `devDependencies`. `git diff --stat package-lock.json` shows about 166 changed lines, and every one apart from the two moved entries is a removed `"dev": true` / `"devOptional": true` flag (`git diff package-lock.json | grep '^[-+]' | grep -v '"dev": true\|"devOptional": true'` shows only the moves). No version changes. The root `tsx` devDependency stays (the web app's icon script uses it).

- [x] **Step 4: Write `.dockerignore` and the `Dockerfile`**

`.dockerignore`:

```
# What `docker build` never sees (docs/why/docker-images.md). Secrets first: no .env file goes into the image.
**/.env
**/.env.*
!**/.env.example

**/node_modules
**/dist
**/coverage
**/test-results
**/playwright-report
apps/server/src/generated

.git
.github
.claude
.superpowers
docs
**/.DS_Store
```

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# One image: the server and the built web app (spec §17 "One image", docs/why/docker-images.md).
# Stages: deps (every dependency) → build (the Prisma client and the web app) → prod-deps (only what runs) → runtime.

FROM node:22-bookworm-slim AS base
WORKDIR /app
# Prisma's schema engine (it runs `migrate deploy`) links against OpenSSL, and the slim image doesn't ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Each workspace's package.json first: this layer, and the npm ci below, are reused until a dependency changes.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/protocol/package.json packages/protocol/

FROM manifests AS deps
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run db:generate -w apps/server && npm run build -w apps/web

# Only the server's runtime dependencies (tsx and the prisma CLI are among them: the server runs from its TypeScript
# source, and the container runs its migrations).
FROM manifests AS prod-deps
RUN npm ci --omit=dev --ignore-scripts -w apps/server -w packages/protocol
# --ignore-scripts skipped Prisma's postinstall, the step that downloads its schema engine. Run it here, at build
# time, so a container never downloads anything at boot (a self-hoster behind a firewall can still start it). That
# script swallows a failed download and exits 0, so the `ls` fails the build if the engine file isn't there.
RUN node node_modules/@prisma/engines/scripts/postinstall.js \
 && ls node_modules/@prisma/engines/schema-engine-* >/dev/null

FROM base AS runtime
# GHCR links the published image to this repository (its page, its README, who may push).
LABEL org.opencontainers.image.source="https://github.com/NikosGkikas13/nitpilot"
# CHECKPOINT_DISABLE: the prisma CLI doesn't phone home for a newer version at every start.
ENV NODE_ENV=production \
    PORT=8787 \
    WEB_DIST_DIR=/app/apps/web/dist \
    CHECKPOINT_DISABLE=1
# The node image's non-root `node` user owns the files and runs the server (Odyhook's Dockerfile does the same).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.base.json ./
COPY --from=build --chown=node:node /app/packages/protocol ./packages/protocol
COPY --from=build --chown=node:node /app/apps/server/package.json /app/apps/server/tsconfig.json /app/apps/server/prisma.config.ts ./apps/server/
COPY --from=build --chown=node:node /app/apps/server/prisma ./apps/server/prisma
COPY --from=build --chown=node:node /app/apps/server/src ./apps/server/src
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
WORKDIR /app/apps/server
EXPOSE 8787
# The slim image has no curl or wget; node's own fetch asks /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Migrations first (safe to run again: Prisma skips the ones already applied), then the server. `exec` replaces the
# shell with node, so SIGTERM from `docker stop` reaches the server's shutdown code (apps/server/src/main.ts).
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && exec node --import tsx src/main.ts"]
```

- [x] **Step 5: Run the smoke test to see it pass**

Run: `npm run image:smoke` (the first build takes about 3 minutes; later ones reuse the `npm ci` layers).
Expected: exit 0, with these lines among the build output:
```
image-smoke: building nitpilot:smoke
image-smoke: starting a throwaway Postgres
image-smoke: starting the server
image-smoke: /healthz answers
image-smoke: Docker reports the container healthy
image-smoke: GET / is the web app
image-smoke: a fresh container migrates with no internet
image-smoke: image size: 859MB
image-smoke: idle memory: 192.7MiB
image-smoke: a CLI socket is connected
image-smoke: docker stop (SIGTERM)
image-smoke: stopped with exit code 0 in 0s
image-smoke: the CLI socket closed with 1012
image-smoke: starting the same container again (migrations already applied)
image-smoke: /healthz answers after the restart
image-smoke: PASS
```
The size and memory vary a little (the runs saw 817–859 MB and 179–243 MiB); put the two numbers in the task report. Idle memory must stay under 384 MiB (the script fails otherwise). Then check by hand:

```bash
docker run --rm nitpilot:smoke sh -c 'id; find / -name ".env*" -not -path "/proc/*" 2>/dev/null; ls /app/apps/server'
```
Expected: `uid=1000(node) gid=1000(node) groups=1000(node)`, no `.env` file at all, and `package.json prisma prisma.config.ts src tsconfig.json`.

- [x] **Step 6: Prove the stop check can fail**

The smoke test must catch a signal that never reaches node. Build a copy of the image without `exec` and test it (the copy lives in the scratchpad, never in the repo):

```bash
sed 's/&& exec node/\&\& node/' Dockerfile > "$TMPDIR/Dockerfile.noexec"
docker build -q -t nitpilot:smoke -f "$TMPDIR/Dockerfile.noexec" . >/dev/null
NITPILOT_SMOKE_SKIP_BUILD=1 npm run image:smoke
```
Expected: exit 1 with `image-smoke: FAIL: the server exited with 143 after SIGTERM, not 0 (137 means Docker had to kill it)` (the shell, not node, got the signal and died of it). Then `npm run image:smoke` again rebuilds the real image → PASS.

- [x] **Step 7: Build and smoke-test the image in CI, on Node 22.x**

In `.github/workflows/ci.yml`, the `test` job's `setup-node`:

```yaml
      - uses: actions/setup-node@v4
        with:
          # Node 22 LTS, the same major as the Docker image (spec §17).
          node-version: 22.x
          cache: npm
```

and a second job at the end of the file:

```yaml
  image:
    name: Docker image (build + smoke test)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      # Build only, never push (the release workflow pushes). The layers are cached between runs, so a change that
      # touches no dependency reuses the `npm ci` layers.
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          load: true
          tags: nitpilot:smoke
          cache-from: type=gha
          cache-to: type=gha,mode=max
      # The image starts, serves the web app, stops cleanly on SIGTERM and starts again (scripts/image-smoke.sh).
      - run: bash scripts/image-smoke.sh
        env:
          NITPILOT_SMOKE_SKIP_BUILD: '1'
```

Validate both workflow files: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -no-color` → no output, exit 0.

- [x] **Step 8: Write `docs/why/docker-images.md`**

Plain language, in the voice of the other `docs/why/` pages (one-sentence summary first, a React comparison, "Where" at the end naming `Dockerfile`, `.dockerignore` and `scripts/image-smoke.sh`). Cover: an image vs a container (the built `dist/` folder vs a running `vite preview` of it); layers and why the `package.json` files are copied before the source (cache, like a lockfile-keyed `node_modules` cache in CI); the four stages and why the runtime one has no dev dependencies, no tests' tools, and no `.env`; why the server runs as `node`, not root; why the container runs `prisma migrate deploy` itself and why running it again is safe; `--init` / `init: true` and `exec`, the signal path from `docker stop` to `shutdown()` in `main.ts`, and the 143 the smoke test saw without `exec`; the `HEALTHCHECK` and what `docker ps` shows; what `image:smoke` checks and that CI runs it on every PR.

- [x] **Step 9: Full suite, the smoke test, tick, ledger, commit**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e && npm run image:smoke`
Expected: protocol 84, CLI 349 + 14 skipped, server 1059, web 344, e2e 6 (all unchanged), typecheck and lint clean, `image-smoke: PASS`. (Playwright stays 19; this task doesn't touch the web app, so `npm run test:web-e2e` is optional here.)

Tick this task's boxes, append `Task 5: complete` (plus any `Ruling:` lines) to the ledger, then:

```bash
git add Dockerfile .dockerignore scripts/image-smoke.sh docs/why/docker-images.md .github/workflows/ci.yml package.json package-lock.json apps/server/package.json docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
git commit -m "build: one Docker image for the server and the web app, built in CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The release workflow, and the npm name claimed

**Files:**
- Create: `scripts/check-release-version.test.mjs`, `scripts/check-release-version.mjs`, `.github/workflows/release.yml`, `LICENSE` and the same file as `apps/cli/LICENSE`, `docs/why/releasing.md`, `docs/releasing.md`
- Modify: `package.json` (test script), `eslint.config.mjs` (Node globals for `scripts/**/*.mjs`), `apps/cli/package.json` (`repository`, `homepage`, `bugs`, `keywords`, `license`), `.github/workflows/ci.yml` (the npm dry-run)

**Interfaces:**
- Consumes: Task 5's image (its `org.opencontainers.image.source` label links the GHCR package to the repo) and `docker/build-push-action` setup; `apps/cli/package.json` `version` and `CLI_VERSION` in `apps/cli/src/version.ts` (both `0.1.0`); `npm run build -w apps/cli` (tsup → `apps/cli/dist/index.js`).
- Produces: `checkReleaseTag(tag: string, repoRoot: string): { ok: true, kind: 'rc' | 'release', version: string } | { ok: false, message: string }` exported from `scripts/check-release-version.mjs`; run as `node scripts/check-release-version.mjs <tag>` it prints `rc` or `release` (exit 0) or `check-release-version: <message>` on stderr (exit 1).
- Produces: `release.yml` jobs `version` (outputs `kind`, `version`), `image` (pushes `ghcr.io/nikosgkikas13/nitpilot:<version>`, plus `:latest` only when `kind` is `release`), `npm` (only for `release`, after `image`; trusted publishing, provenance). D4 deploys the `-rc` image; D5 tags `v0.1.0`.

- [x] **Step 1: Write the failing test**

Create `scripts/check-release-version.test.mjs` (Node's own test runner, so the root scripts need no Vitest setup):

```js
// Tests for check-release-version.mjs, run by the root `npm test` with Node's own test runner (no Vitest needed).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkReleaseTag } from './check-release-version.mjs';

/** A folder laid out like the repo, with the CLI at these two versions. */
function repoWith(packageVersion, cliVersion = packageVersion) {
  const root = mkdtempSync(path.join(tmpdir(), 'release-version-'));
  mkdirSync(path.join(root, 'apps/cli/src'), { recursive: true });
  writeFileSync(path.join(root, 'apps/cli/package.json'), JSON.stringify({ name: 'nitpilot', version: packageVersion }));
  writeFileSync(path.join(root, 'apps/cli/src/version.ts'), `export const CLI_VERSION = '${cliVersion}';\n`);
  return root;
}

test('v0.1.0 is a release', () => {
  assert.deepEqual(checkReleaseTag('v0.1.0', repoWith('0.1.0')), { ok: true, kind: 'release', version: '0.1.0' });
});

test('v0.1.0-rc.1 is a release candidate', () => {
  assert.deepEqual(checkReleaseTag('v0.1.0-rc.1', repoWith('0.1.0')), { ok: true, kind: 'rc', version: '0.1.0-rc.1' });
});

test('a tag ahead of package.json is refused, naming both', () => {
  assert.deepEqual(checkReleaseTag('v0.2.0', repoWith('0.1.0')), {
    ok: false,
    message: 'tag v0.2.0 but apps/cli/package.json says 0.1.0',
  });
});

test('a CLI_VERSION that disagrees is refused', () => {
  assert.deepEqual(checkReleaseTag('v0.1.0', repoWith('0.1.0', '0.0.9')), {
    ok: false,
    message: 'tag v0.1.0 but CLI_VERSION in apps/cli/src/version.ts says 0.0.9',
  });
});

test('a tag without the v is refused', () => {
  const result = checkReleaseTag('0.1.0', repoWith('0.1.0'));
  assert.equal(result.ok, false);
  assert.match(result.message, /^tag 0\.1\.0 is not v<X\.Y\.Z> or v<X\.Y\.Z>-rc\.<N>/);
});

test('other pre-release names are refused', () => {
  assert.equal(checkReleaseTag('v0.1.0-beta.1', repoWith('0.1.0')).ok, false);
  assert.equal(checkReleaseTag('v0.1', repoWith('0.1.0')).ok, false);
});
```

In the root `package.json`, the test script becomes:

```json
    "test": "npm run test --workspaces --if-present && node --test 'scripts/*.test.mjs'",
```

- [x] **Step 2: Run it to see it fail**

Run: `node --test 'scripts/*.test.mjs'`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/scripts/check-release-version.mjs' imported from …/scripts/check-release-version.test.mjs`.

- [x] **Step 3: Implement `scripts/check-release-version.mjs`, then see it pass**

```js
#!/usr/bin/env node
// The release workflow's first step (docs/releasing.md): is this git tag a version we can release, and does it match
// the CLI's version in both places it's written? Prints `rc` or `release` and exits 0; otherwise names the mismatch
// and exits 1, so nothing gets pushed under a wrong version.
//
//   node scripts/check-release-version.mjs v0.1.0-rc.1
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = /^v(\d+\.\d+\.\d+)(-rc\.\d+)?$/;

/**
 * Check `tag` against the CLI's version in `repoRoot`.
 * @returns {{ ok: true, kind: 'rc' | 'release', version: string } | { ok: false, message: string }}
 */
export function checkReleaseTag(tag, repoRoot) {
  const match = TAG.exec(tag);
  if (!match) return { ok: false, message: `tag ${tag} is not v<X.Y.Z> or v<X.Y.Z>-rc.<N>` };
  const [, base, rc] = match;

  const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'apps/cli/package.json'), 'utf8')).version;
  if (packageVersion !== base) return { ok: false, message: `tag ${tag} but apps/cli/package.json says ${packageVersion}` };

  const versionFile = readFileSync(path.join(repoRoot, 'apps/cli/src/version.ts'), 'utf8');
  const cliVersion = /CLI_VERSION = '([^']+)'/.exec(versionFile)?.[1];
  if (cliVersion !== base) return { ok: false, message: `tag ${tag} but CLI_VERSION in apps/cli/src/version.ts says ${cliVersion}` };

  return { ok: true, kind: rc ? 'rc' : 'release', version: tag.slice(1) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkReleaseTag(process.argv[2] ?? '', repoRoot);
  if (!result.ok) {
    console.error(`check-release-version: ${result.message}`);
    process.exit(1);
  }
  console.log(result.kind);
}
```

ESLint doesn't know Node's globals in a root `.mjs` file yet (`'process' is not defined`). In `eslint.config.mjs`, the block for the web app's icon script becomes:

```js
  {
    // Run with Node, not in the browser: the web app's icon script and the release scripts in scripts/.
    files: ['apps/web/scripts/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
```

Run: `node --test 'scripts/*.test.mjs'` → `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`. Then:
```
$ node scripts/check-release-version.mjs v0.1.0-rc.1
rc
$ node scripts/check-release-version.mjs v0.1.0
release
$ node scripts/check-release-version.mjs v0.2.0; echo "exit $?"
check-release-version: tag v0.2.0 but apps/cli/package.json says 0.1.0
exit 1
```

- [x] **Step 4: The workflow, the package metadata, the docs; full suite; commit**

Create `.github/workflows/release.yml`:

```yaml
name: Release

# A version tag releases Nitpilot (docs/releasing.md, docs/why/releasing.md):
#   v0.1.0       → the image as :0.1.0 and :latest on GHCR, then the CLI on npm
#   v0.1.0-rc.1  → the image as :0.1.0-rc.1 only (never :latest, never npm)
on:
  push:
    tags: ['v*']

# Nothing by default; each job asks for only what it needs.
permissions: {}

jobs:
  version:
    name: Check the tag
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
    outputs:
      kind: ${{ steps.check.outputs.kind }}
      version: ${{ steps.check.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
      # Fails the whole release when the tag and the CLI's version disagree.
      - id: check
        run: |
          kind=$(node scripts/check-release-version.mjs "$GITHUB_REF_NAME")
          echo "kind=$kind" >> "$GITHUB_OUTPUT"
          echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

  image:
    name: Image to GHCR
    needs: version
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          # An rc gets only its own tag; the empty second line is skipped.
          tags: |
            ghcr.io/nikosgkikas13/nitpilot:${{ needs.version.outputs.version }}
            ${{ needs.version.outputs.kind == 'release' && 'ghcr.io/nikosgkikas13/nitpilot:latest' || '' }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  npm:
    name: CLI to npm
    needs: [version, image]
    if: needs.version.outputs.kind == 'release'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      # Trusted publishing: npm checks a short-lived token GitHub signs for this run, instead of a stored npm token.
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          registry-url: https://registry.npmjs.org
      # Trusted publishing needs npm 11.5.1 or newer; Node 22 comes with npm 10.
      - run: npm install -g npm@^11.5.1
      - run: npm ci
      - run: npm run build -w apps/cli
      - run: npm publish -w apps/cli --provenance --access public
```

In `.github/workflows/ci.yml`'s `test` job, right after `- run: npm run lint`:

```yaml
      # The CLI package as npm would get it: a broken package.json or a missing file fails here, not at release.
      - run: npm run build -w apps/cli
      - run: npm publish -w apps/cli --dry-run
```

In `apps/cli/package.json`, right after `description` (trusted publishing with provenance checks that `repository.url` is this GitHub repo):

```json
  "description": "Your own AI agent reviews your teammates' pull requests, and theirs reviews yours.",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/NikosGkikas13/nitpilot.git",
    "directory": "apps/cli"
  },
  "homepage": "https://nitpilot.dev",
  "bugs": {
    "url": "https://github.com/NikosGkikas13/nitpilot/issues"
  },
  "keywords": [
    "code-review",
    "pull-request",
    "github",
    "ai",
    "claude-code",
    "cli"
  ],
```

Add a `LICENSE` file at the root for the license the user picks at review (default MIT: the standard MIT text with `Copyright (c) 2026 Nikos Gkikas`), the same file as `apps/cli/LICENSE` (npm packs a LICENSE only from the package's own folder: checked, a root one alone leaves the package at 2 files), and `"license": "MIT"` (or the pick's SPDX id) after `keywords`.

Write `docs/why/releasing.md` (a git tag as a named commit; a container registry as "npm for images"; what `:latest` and an `-rc` tag mean; trusted publishing as "npm trusts this one workflow file in this one repo instead of a password", the OIDC token GitHub signs for each run and why `id-token: write` is needed; what the provenance badge on npmjs.com proves; why the tag is checked against both version strings) and `docs/releasing.md` (the how-to: bump `apps/cli/package.json` and `CLI_VERSION` together, commit, `git tag vX.Y.Z` or `vX.Y.Z-rc.N`, push the tag, what each job does and where to look; how to re-run a failed job; that a version on npm can never be published twice).

Validate: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -no-color` → no output, exit 0. Dry-run the package:
```bash
npm run build -w apps/cli && npm publish -w apps/cli --dry-run
```
Expected: exit 0, `npm notice package: nitpilot@0.1.0`, `total files: 3` (`LICENSE`, `dist/index.js`, `package.json`), `+ nitpilot@0.1.0`, plus the harmless `npm warn publish This command requires you to be logged in … (dry-run)`.

Run: `npm test && npm run typecheck && npm run lint && npm run image:smoke`
Expected: protocol 84, CLI 349 + 14, server 1059, web 344, then the root scripts' `ℹ pass 6`; typecheck and lint clean; `image-smoke: PASS`.

Tick Steps 1–4, append `Task 6: code complete` to the ledger, then:

```bash
git add scripts/check-release-version.mjs scripts/check-release-version.test.mjs .github/workflows/release.yml .github/workflows/ci.yml package.json eslint.config.mjs apps/cli/package.json LICENSE apps/cli/LICENSE docs/why/releasing.md docs/releasing.md docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
git commit -m "ci: a tag-driven release: the image to GHCR and the CLI to npm with provenance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

This commit comes before Steps 5–7: the `v0.1.0-rc.1` tag in Step 7 must point at a commit that has `release.yml`.

- [x] **Step 5: (user, say first: writes to npm) Claim the npm name**

npm only lets a trusted publisher be set on a package that exists. I make `~/Desktop/PracticeProjects/.nitpilot-scratch/npm-placeholder/` with this `package.json` and a one-line `README.md` ("Placeholder. Nitpilot's CLI is published from https://github.com/NikosGkikas13/nitpilot."):

```json
{
  "name": "nitpilot",
  "version": "0.0.0",
  "description": "Placeholder: the real release is coming from github.com/NikosGkikas13/nitpilot",
  "repository": { "type": "git", "url": "git+https://github.com/NikosGkikas13/nitpilot.git" }
}
```

Then I say "this publishes to npm" and wait for go. Click-steps for the user, in a Terminal panel tab I open in that folder:
1. Type `npm whoami` and press Return. If it prints your npm username, skip to step 4. If it says `ENEEDAUTH`, go on.
2. Type `npm login` and press Return. It prints `Login at: https://www.npmjs.com/login?next=…` and `Press ENTER to open in the browser...`. Press Return.
3. In the browser that opens (npmjs.com), sign in with your npm account (the one with 2FA), then approve with your authenticator app or security key. The page says you're logged in; back in the terminal it prints `Logged in on https://registry.npmjs.org/.`
4. Type `npm publish` and press Return. npm asks for 2FA again (it either prints a link to open in the browser, or asks `This operation requires a one-time password` and waits for the 6-digit code from your authenticator). Approve it. The terminal ends with `+ nitpilot@0.0.0`.
5. Open https://www.npmjs.com/package/nitpilot. You see **nitpilot**, **0.0.0 • Public • Published a few seconds ago**, and the placeholder README.

- [x] **Step 6: (user, say first: changes npm settings) Link the package to the workflow**

Click-steps on npmjs.com, signed in with the same npm account:
1. Open https://www.npmjs.com/package/nitpilot and click the **Settings** tab (top of the package page, next to Readme / Code / Dependents / Versions; only the owner sees it).
2. Find the **Trusted Publisher** section and click the **GitHub Actions** button.
3. Fill in: **Organization or user** `NikosGkikas13`, **Repository** `nitpilot`, **Workflow filename** `release.yml` (just the file name, not the path), **Environment name** left empty. Click **Set up connection**. The section now shows one GitHub Actions publisher for `NikosGkikas13/nitpilot`, `release.yml`.
4. Further down, under **Publishing access**, choose **Require two-factor authentication and disallow tokens** and click **Update Package Settings**. npm asks for 2FA once more; approve. From now on no npm token can publish `nitpilot`; only the workflow (and you, with 2FA) can.

  Note (what happened): npm's Trusted Publisher form made the connection with "Permissions: npm stage publish" and "Status: Pending validation: publish once before <48 hours later> to validate this configuration". Its fields can't be edited, an unvalidated connection expires, and `release.yml` runs plain `npm publish` whose first run is `v0.1.0` in D5 (an `-rc` never publishes to npm). So the connection was deleted and the trusted publisher moves to Task 15 as a release-day step. The Publishing access setting ("Require two-factor authentication and disallow tokens") stays done.

- [x] **Step 7: (user, say first: writes to GitHub and GHCR) An `-rc` image from this branch**

I check `git status` is clean and `git log -1` is the Task 6 commit, then say "this pushes the branch and a tag to GitHub, and the tag pushes an image to GHCR" and wait for go. The user runs, from the repo folder (I don't push):

```bash
git push -u origin plan-3-deploy-and-launch
```
```bash
git tag v0.1.0-rc.1
```
```bash
git push origin v0.1.0-rc.1
```

Click-steps, in the browser signed in to GitHub as **NikosGkikas13**:
1. Open https://github.com/NikosGkikas13/nitpilot/actions. At the top of the list is a run called **Release**, on `v0.1.0-rc.1`. Click it.
2. The run's page shows three jobs in a row: **Check the tag**, **Image to GHCR**, **CLI to npm**. Wait until the first two have a green tick (the image takes about 5 minutes the first time) and **CLI to npm** is grey with "This job was skipped". That skip is right: an `-rc` tag never publishes to npm.
3. Open https://github.com/NikosGkikas13/nitpilot. In the right-hand column, under **Packages**, there is now **nitpilot**. Click it: the page shows `ghcr.io/nikosgkikas13/nitpilot`, the tag **0.1.0-rc.1** (no `latest`), and a **Private** label (the package stays private until D4).
4. Optional, and worth it: on that repo page click **Pull requests → New pull request**, base `main`, compare `plan-3-deploy-and-launch`, **Create draft pull request**. CI's two jobs run: **typecheck + lint + tests** and **Docker image (build + smoke test)**; both should go green. That's the first time the smoke test runs on GitHub's machines.

I read the **Image to GHCR** job's log (`gh run view --log`, read-only) and note the pushed tag and digest in the ledger.

- [x] **Step 8: Tick Steps 5–7**

In a follow-up commit after the review: tick Steps 5–7, append `Task 6: complete` to the ledger.

```bash
git add docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
git commit -m "docs(plan): Task 6's npm name, trusted publisher and rc image done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Checked against the code (D2)

Checked at `c302c25` and in the scratch build; each line is where the step-level text differs from the task-level text it replaced, or a fact the task-level text got wrong.

1. **`tsx` and `prisma` were dev-only.** `tsx` is a root devDependency and `prisma` an `apps/server` devDependency, so the task-level "`npm ci --omit=dev` plus `tsx` and the `prisma` CLI kept" can't be done with `npm ci` alone. Task 5 Step 3 moves both into `apps/server` `dependencies` (lockfile: flag changes only, no version changes).
2. **The image doesn't run `npm start -w apps/server`.** That chain is npm → `sh -c` → tsx → node, and every link has to pass SIGTERM on. The `CMD` is `prisma migrate deploy && exec node --import tsx src/main.ts` from `/app/apps/server`: the same tsx loader `npm start` uses, no compile step, and `exec` makes node the process `tini` signals. Without `exec` the smoke test sees exit 143 (Task 5 Step 6 proves it). `npm start` is unchanged for development.
3. **No `wget` in `node:22-bookworm-slim`** (no `curl` either). The `HEALTHCHECK` asks `/healthz` with node's own `fetch`. It also gets `--start-period=60s --start-interval=2s` (Docker 25+) so it reports healthy within seconds, which the smoke test now waits for.
4. **The smoke test checks more than the task-level text listed.** It also waits for Docker's own health status, adds a CLI token straight into the throwaway database and connects a WebSocket client (run from the image itself, which has `ws`) to see the 1012 close that Review Focus 4 asks for, fails when idle memory is 384 MiB or more (instead of only reporting it), and restarts the same container (`docker start`) for the second boot, checking Prisma's `No pending migrations to apply.` The host port is random and read again after each start. `NITPILOT_SMOKE_SKIP_BUILD=1` lets CI test the image it built with the GitHub Actions cache.
5. **CI runs the smoke test,** not only `docker build`: the `image` job builds with `docker/build-push-action` (`push: false`, `load: true`, `type=gha` cache) and then runs `scripts/image-smoke.sh`.
6. **Prisma's schema engine needs OpenSSL, and has to be baked into the image.** The first scratch build missed both: `npm ci --ignore-scripts` skips `@prisma/engines`' postinstall, the step that downloads the `schema-engine` binary, so every fresh container downloaded it from binaries.prisma.sh at boot (and, with no OpenSSL, warned `failed to detect the libssl/openssl version`). The scratch run never noticed because its restart step was `docker start` of the same container, which kept the download in its writable layer. Fixed in the `Dockerfile`: the base stage installs `openssl` (Prisma then picks `debian-openssl-3.0.x`), and the prod-deps stage runs `node node_modules/@prisma/engines/scripts/postinstall.js` at build time. The smoke test now proves it: a fresh one-off container on a `--internal` network (no route to the internet) runs `prisma migrate deploy` and must not mention `binaries.prisma.sh`. `CHECKPOINT_DISABLE=1` stops the prisma CLI's update check, which printed an "Update available 7.10.0 -> 8.0.0-rc.27" box and called out to Prisma at every start.
7. **The image is about 860 MB** (Docker Desktop's figure; `node_modules` is about 354 MB plus the baked-in schema engine, with the prisma CLI and its engines roughly 190 MB or more of that, and OpenSSL adds a little). It's what `migrate deploy` on start costs; slimming it (a separate migrate image, or the bundled CLI only) is out of scope. Idle memory was 179–243 MiB across runs, well under the hosted 384m.
8. **`/healthz` is at `http/app.ts:58`** (the Code facts say 55); it answers without touching the database, so "healthy" means the HTTP server is up, not that Postgres is.
9. **The image label.** `org.opencontainers.image.source` is set in the `Dockerfile` so the GHCR package is linked to the repo (shown under the repo's Packages, and its visibility can follow the repo at D4). Not in the task-level text.
10. **The order in Task 6.** The task-level text committed in Step 8, after Step 7 pushes the `-rc` tag; the tag must point at a commit with `release.yml`, so the commit moves to the end of Step 4 and Step 8 only ticks Steps 5–7.
11. **Trusted publishing needs npm 11.5.1 or newer,** and Node 22 ships npm 10, so the `npm` job runs `npm install -g npm@^11.5.1` before publishing. Provenance also needs `repository.url` in `apps/cli/package.json` to name this repo; Task 6 adds it.
12. **`release.yml` has a `version` job first** (the tag check, outputs `kind` and `version`) and `permissions: {}` at the top with each job asking for only what it needs (`packages: write` only in `image`, `id-token: write` only in `npm`), instead of one workflow-wide `{ contents: read, packages: write, id-token: write }`.
13. **The root tests run with `node --test`.** `npm test` gains `&& node --test 'scripts/*.test.mjs'` (Node's own runner; the workspaces keep Vitest). ESLint needed Node's globals for `scripts/**/*.mjs`.
14. **There is no license yet.** The repo has no `LICENSE` and the spec never picks one, but an npm package and a public repo need one (Odyhook uses AGPL-3.0-only). Task 6 adds `LICENSE` (root, plus a copy in `apps/cli/`, since npm packs it only from the package folder) and the `license` field with the user's pick; the plan defaults to MIT.
15. **The npm package has no README** (`npm publish --dry-run` lists only `dist/index.js` and `package.json`, plus `LICENSE` after Task 6), so npmjs.com shows an empty page for the CLI until one is there. Task 14 (D5) adds `apps/cli/README.md` (or copies the root README into the package); nothing in D2 publishes the CLI.
16. **Validation tool.** `actionlint` from `rhysd/actionlint:1.7.7` (Docker, nothing installed) passes on both workflows; the task-level text's `@action-validator/cli` was not needed.
17. **This Mac runs Node 24.3** (`node --test` and the dry-run were checked with it); CI and the image use 22.x, which is what the plan pins.
18. **npm's trusted publisher and staged publishing (found live in Task 6).** The Trusted Publisher form offers a permission, `npm publish` or `npm stage publish`, and a new connection is "Pending validation" until a publish uses it within 48 hours; its fields can't be edited and it expires otherwise. Since the first npm publish by the workflow is `v0.1.0` in D5, Task 6 deleted its connection and Task 15 Step 1 creates it on release day (with `npm publish`). npm's staged publishing also left a public stub version `0.0.0-stage` next to the placeholder `0.0.0` (`latest` is 0.0.0), and may hold `0.1.0` for approval (Staged Packages tab or `npm stage approve <stage-id>`; also in Task 15 Step 1). Publishing a package also needs 2FA for write actions switched on in the npm account (the placeholder's first publish failed with E403 until it was).

---

## Milestone D3: Self-hosting

D3 lets a server start with no GitHub App at all and create one itself, and packages that for a team as one Compose folder. It ends with a clean-folder run (first locally, then live with an `-rc.2` image through a tunnel) the git-history secret scan, and (Task 10a, added after the live run) the image for ARM servers too, so the repo can go public at the start of D4.

**Written at step level on 2026-10-24** against `d9fe4d8`. Every file below was built and run first in a scratch worktree (`~/Desktop/PracticeProjects/.nitpilot-scratch/d3`, its own databases `nitpilot_d3` / `nitpilot_d3_test`, no real `.env`, nothing written to GitHub): Task 7 is pinned at `refs/scratch/d3/task-7` (`b751eff`), Task 8 at `refs/scratch/d3/task-8` (`2d53716`), Task 9 at `refs/scratch/d3/task-9` (`cb8b010`), Task 10 at `refs/scratch/d3/task-10` (`78c1902`; first built on `d9fe4d8` as `4b0dce6`, the same change). The code blocks in the steps were copied from those commits by script, and every "Expected: FAIL" was seen by following the steps in a fresh worktree. Task 9's live run (Steps 6–8) and Task 8's look in the browser happen during the build. What differs from the task-level text is in "Checked against the code (D3)" at the end of the milestone.

**Files at the end of D3:**
```
apps/server/src/setup/{setup-code,manifest,credentials,first-run,boot}.ts (+ tests)   first-run mode
apps/server/prisma/migrations/…_github_app_config                       GithubAppConfig, one encrypted row
apps/server/src/lib/env.ts            the six GITHUB_* optional, all or none
apps/server/src/main.ts               load the app → runFirstRun or runNormally
apps/server/src/http/{app,spa,errors}.ts   createFirstRunApp, readyRoutes, form-action, setup_code / first_run
apps/server/src/{auth/onboarding,auth/user-tokens,http/routes/auth,http/routes/webhooks}.ts   read githubApp()
apps/server/test/e2e/first-run-server.ts   the Playwright server in first-run mode
packages/protocol/src/web-api.ts      FirstRunStatus, FirstRunManifestRequest/Response, FirstRunProblem
apps/web/src/routes/FirstRun/, src/components/FirstRunNeeded/, src/api/first-run.ts, e2e/first-run.spec.ts
deploy/self-host/{docker-compose.yml,Caddyfile,.env.example}
.gitleaks.toml; .github/workflows/ci.yml (a gitleaks job)
docs/self-hosting.md; docs/why/{first-run-and-app-manifests,reverse-proxy-and-tls,dns-records}.md
```

**Data model (spec §8 gets this row in Task 7):** `GithubAppConfig` — one row (`id = 'app'`): `appId`, `slug`, `clientId`, `privateKeyEnc`, `clientSecretEnc`, `webhookSecretEnc` (AES-256-GCM with `ENCRYPTION_KEY`, `lib/crypto.ts`), `ownerLogin`, `createdAt`, `updatedAt`.

**Counts:** start (at `d9fe4d8`) protocol 84, CLI 349 + 14 skipped, server 1059, web 344, root 6, e2e 6, Playwright 19. After Task 7: protocol 88, server 1106. After Task 8: server 1107, web 373, Playwright 21. Tasks 9 and 10 change no counts.

### Task 7: First-run mode on the server

**Files:**
- Create: `apps/server/src/setup/setup-code.ts`, `manifest.ts`, `credentials.ts`, `first-run.ts` (routes), `boot.ts` (all in `apps/server/src/setup/`), their tests (`setup-code.test.ts`, `manifest.test.ts`, `credentials.db.test.ts`, `first-run.db.test.ts`, `boot.test.ts`); a Prisma migration `…_github_app_config`; `docs/why/first-run-and-app-manifests.md`
- Modify: `apps/server/src/lib/env.ts` (+ `env.test.ts`: the six `GITHUB_*` become optional, all or none), `apps/server/prisma/schema.prisma`, `apps/server/src/http/errors.ts` (two codes), `apps/server/src/http/spa.ts` (+ `spa.test.ts`: `formActions`, `isServerPath` exported), `apps/server/src/http/app.ts` (+ `app.test.ts`: `createFirstRunApp`, `readyRoutes` mounted), `apps/server/src/main.ts` (load the app → normal mode or first-run mode), every reader of `env.GITHUB_*` (`auth/onboarding.ts`, `auth/user-tokens.ts`, `http/routes/auth.ts`, `http/routes/webhooks.ts`, `test/webhooks.ts`, `scripts/dev-tunnel.ts`), `apps/server/test/db.ts`, `apps/server/.env.example`, `packages/protocol/src/web-api.ts` (+ `web-api.test.ts`: the first-run bodies), `docs/superpowers/specs/2026-10-07-nitpilot-design.md` (§8 row, §10 block), `docs/why/content-security-policy.md`

**Interfaces:**
- Consumes: `getEnv()` and its `optionalText` helper (`lib/env.ts`); `encrypt` / `decrypt` (`lib/crypto.ts`, AES-256-GCM under `ENCRYPTION_KEY`); `prisma` and `isUniqueViolation` (`lib/prisma.ts`); `clientAddress(c, trustProxy)` (`lib/client-address.ts`, Task 2) and `RateLimiter(limit, windowMs, now?)` (`lib/rate-limit.ts`); `GithubClient` with its `webBase` and `api(method, path)` (`platform/github/client.ts`); `spaRoutes` (`http/spa.ts`); `routeUpgrades(server, hubs)` and the shutdown code in `main.ts`; `fakeFetch` and `resetDb` in the tests.
- Produces, `setup/credentials.ts`: `type GithubAppCredentials = { appId; slug; privateKey; clientId; clientSecret; webhookSecret }` (all strings); `credentialsFromEnv(env): GithubAppCredentials | null`; `loadGithubApp(env): Promise<{ source: 'env' | 'database'; creds } | null>` (the environment first, else the stored row decrypted, else `null`; a row this `ENCRYPTION_KEY` can't read throws "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with."); `saveGithubApp(creds, ownerLogin): Promise<void>` (insert only; a second save throws `GithubAppExistsError`); `setGithubApp(creds | null)` and `githubApp(): GithubAppCredentials` (the app this process runs as; every reader of a `GITHUB_*` value uses it).
- Produces, `setup/setup-code.ts`: `makeSetupCode(random?)` → `K7PX-3MQD`-shaped, `setupCodeMatches(typed, real)` (constant time). `setup/manifest.ts`: `buildManifest({ publicUrl, name, isPublic })` and `manifestFormAction({ webBase, owner, state })`.
- Produces, `setup/first-run.ts`: `firstRunRoutes(deps)` (`GET /api/first-run` → `{ mode: 'first_run', publicUrl }`; `POST /api/first-run/manifest`; `GET /first-run/callback`) and `readyRoutes({ github })` (the same paths once the server has its app). `http/app.ts`: `createFirstRunApp(deps)`. `setup/boot.ts`: `startFirstRun({ env, github, exit, log? }): { app }`.
- Produces, `packages/protocol`: `FirstRunStatus`, `FirstRunManifestRequest`, `FirstRunManifestResponse`. Task 8's page reads them.
- Produces, `http/errors.ts`: error codes `setup_code` (403) and `first_run` (503). Every error body keeps the house shape `{ error: { code, message } }`, so Task 8's page reads `error.code`.

**Why this exists (docs/why/first-run-and-app-manifests.md, written in Step 21):** a self-hosted server needs its own GitHub App, and making one by hand means a long form and six values copied into `.env`. With no app at all, the server instead serves only a setup page. The page has GitHub create the app from a description the server wrote (a manifest); the server stores the secrets encrypted and exits; Docker starts it again in normal mode. In React terms it is a setup wizard that writes config and then reloads the app.

- [x] **Step 1: Write the failing env tests**

The six `GITHUB_*` variables become all-or-none. In `apps/server/src/lib/env.test.ts`, add this block (the diff shows where; it goes after the test that names every missing variable and before `describe('Web Push keys', …)`):

```diff
--- a/apps/server/src/lib/env.test.ts
+++ b/apps/server/src/lib/env.test.ts
@@ -58,6 +58,24 @@ describe('getEnv', () => {
     expect(() => getEnv()).toThrow(/GITHUB_CLIENT_ID[\s\S]*PUBLIC_URL|PUBLIC_URL[\s\S]*GITHUB_CLIENT_ID/);
   });
 
+  describe('GitHub App variables', () => {
+    const SIX = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET'];
+
+    it('are optional: with none set the server starts in first-run mode', () => {
+      // Left empty, as in a copied .env.example, counts as not set.
+      for (const name of SIX) vi.stubEnv(name, '');
+      expect(getEnv()).toMatchObject({ GITHUB_APP_ID: undefined, GITHUB_APP_PRIVATE_KEY: undefined, GITHUB_WEBHOOK_SECRET: undefined });
+    });
+
+    it('are all or none: half set refuses to start and names the missing ones', () => {
+      vi.stubEnv('GITHUB_CLIENT_SECRET', '');
+      vi.stubEnv('GITHUB_WEBHOOK_SECRET', ' ');
+      expect(() => getEnv()).toThrow(
+        'set all six GitHub App variables, or none to start in first-run mode; missing: GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET',
+      );
+    });
+  });
+
   describe('Web Push keys', () => {
     const keys = { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, VAPID_SUBJECT: 'mailto:admin@example.com' };
     const stub = (values: Record<string, string>) => Object.entries(values).forEach(([name, value]) => vi.stubEnv(name, value));
```

- [x] **Step 2: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/lib/env.test.ts`
Expected: FAIL, 2 tests. "are optional: with none set the server starts in first-run mode" fails with `Invalid environment:` followed by `GITHUB_APP_ID: Too small: expected string to have >=1 characters` and the same for the other five. "are all or none" fails with `expected [Function] to throw error including 'set all six GitHub App variables, or …' but got 'Invalid environment:\n  GITHUB_CLIENT…'`. The other 13 tests pass.

- [x] **Step 3: Make the variables optional, all or none**

In `apps/server/src/lib/env.ts`: the six names get a list and a helper, the schema takes them as `optionalText` (an empty value counts as not set, as in a copied `.env.example`), and a `superRefine` refuses a half-set app. A half-set app must stop the server: falling into first-run mode would hand the server to whoever opens `/first-run` first, and starting half configured would fail later in a confusing way. `{ when: () => true }` makes the check run even when another variable is also bad, so one start names every problem (zod 4 skips a `superRefine` after another issue otherwise, and the existing "names every missing variable" test needs both messages).

```diff
--- a/apps/server/src/lib/env.ts
+++ b/apps/server/src/lib/env.ts
@@ -20,6 +20,26 @@ function isVapidKeyPair(publicKey: string, privateKey: string): boolean {
   }
 }
 
+/** The six variables a GitHub App needs, in the order .env.example lists them. */
+export const GITHUB_APP_VARIABLES = [
+  'GITHUB_APP_ID',
+  'GITHUB_APP_SLUG',
+  'GITHUB_APP_PRIVATE_KEY',
+  'GITHUB_CLIENT_ID',
+  'GITHUB_CLIENT_SECRET',
+  'GITHUB_WEBHOOK_SECRET',
+] as const;
+
+/**
+ * Which of the six are missing, when some are set and some aren't (a copy-paste slip in .env). Empty when all six or
+ * none are set. A half-set app must stop the server: falling into first-run mode would hand the server to whoever
+ * opens /first-run first, and starting half configured would fail later in a confusing way.
+ */
+function missingGithubAppVariables(env: Partial<Record<(typeof GITHUB_APP_VARIABLES)[number], string | undefined>>): string[] {
+  const missing = GITHUB_APP_VARIABLES.filter((name) => !env[name]);
+  return missing.length === GITHUB_APP_VARIABLES.length ? [] : missing;
+}
+
 const EnvSchema = z.object({
   NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
   PORT: z.coerce.number().int().positive().default(8787),
@@ -28,13 +48,18 @@ const EnvSchema = z.object({
   DATABASE_URL: z.string().min(1),
   /** base64 of 32 random bytes: `openssl rand -base64 32` */
   ENCRYPTION_KEY: z.string().min(1),
-  GITHUB_APP_ID: z.string().min(1),
-  GITHUB_APP_SLUG: z.string().min(1),
+  /**
+   * The GitHub App (docs/why/github-app.md). Optional, but all six or none: with none the server starts in first-run
+   * mode and creates its own app (setup/first-run.ts, docs/why/first-run-and-app-manifests.md). Read them through
+   * `githubApp()` (setup/credentials.ts), which also knows about an app stored in the database.
+   */
+  GITHUB_APP_ID: optionalText,
+  GITHUB_APP_SLUG: optionalText,
   /** The app's private key (PEM). `\n` escapes are allowed so it fits on one line. */
-  GITHUB_APP_PRIVATE_KEY: z.string().min(1).transform((k) => k.replaceAll('\\n', '\n')),
-  GITHUB_CLIENT_ID: z.string().min(1),
-  GITHUB_CLIENT_SECRET: z.string().min(1),
-  GITHUB_WEBHOOK_SECRET: z.string().min(1),
+  GITHUB_APP_PRIVATE_KEY: optionalText.transform((k) => k?.replaceAll('\\n', '\n')),
+  GITHUB_CLIENT_ID: optionalText,
+  GITHUB_CLIENT_SECRET: optionalText,
+  GITHUB_WEBHOOK_SECRET: optionalText,
   /** Where the built web app is (apps/web/dist by default; see http/spa.ts). */
   WEB_DIST_DIR: z.string().min(1).optional(),
   /** Hosted instance: ignore private repos (spec §14.9). */
@@ -59,7 +84,19 @@ const EnvSchema = z.object({
   VAPID_PUBLIC_KEY: optionalText,
   VAPID_PRIVATE_KEY: optionalText,
   VAPID_SUBJECT: optionalText.refine((s) => s === undefined || /^(mailto|https):/.test(s), 'must start with mailto: or https:'),
-}).refine(
+}).superRefine(
+  (env, ctx) => {
+    const missing = missingGithubAppVariables(env);
+    if (missing.length === 0) return;
+    ctx.addIssue({
+      code: 'custom',
+      path: [missing[0]!],
+      message: `set all six GitHub App variables, or none to start in first-run mode; missing: ${missing.join(', ')}`,
+    });
+  },
+  // Run even when another variable is bad too, so one start names every problem.
+  { when: () => true },
+).refine(
   (env) => {
     const set = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].filter(Boolean).length;
     return set === 0 || set === 3;
```

- [x] **Step 4: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/lib/env.test.ts`
Expected: PASS (15 tests).

Note: `npm run typecheck -w apps/server` now fails, because the six values are `string | undefined`: it lists, at least, `src/main.ts` and `scripts/dev-tunnel.ts` (and every other reader until Step 11 switches it). That is the compiler finding the readers for you; Steps 11, 18 and 19 fix them, and Step 19 ends with a clean typecheck.

- [x] **Step 5: Write the setup-code tests**

Create `apps/server/src/setup/setup-code.test.ts`. The code is what keeps a stranger who finds a fresh server first from claiming it: it is printed only in the server's log (see the explainer), so only the owner can type it.

```ts
import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makeSetupCode, SETUP_CODE_ALPHABET, setupCodeMatches } from './setup-code';

// The real timingSafeEqual, watched, so a test can see the comparison goes through it.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

describe('makeSetupCode', () => {
  it('makes XXXX-XXXX from an alphabet without look-alikes', () => {
    for (let i = 0; i < 200; i++) expect(makeSetupCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // No 0/O, 1/I/L: someone copies this from a terminal into a browser.
    for (const lookAlike of ['0', 'O', '1', 'I', 'L']) expect(SETUP_CODE_ALPHABET).not.toContain(lookAlike);
    expect(new Set(SETUP_CODE_ALPHABET).size).toBe(SETUP_CODE_ALPHABET.length);
  });

  it('is different every time', () => {
    const codes = new Set(Array.from({ length: 100 }, () => makeSetupCode()));
    expect(codes.size).toBe(100);
  });

  it('maps each random byte to one letter, skipping the bytes that would favour some letters', () => {
    // 31 letters don't divide 256: bytes 248 to 255 would give the first 8 letters a 9th chance each, so they're skipped.
    // Every other byte is byte % 31: 0 and 31 are both the first letter, 30 and 247 the last.
    const queue = [248, 0, 31, 255, 30, 247, 1, 32, 252, 62, 249, 250, 251, 253, 254, 33];
    const take = (n: number) => Buffer.from(queue.splice(0, n));
    const a = SETUP_CODE_ALPHABET;
    expect(a).toHaveLength(31);
    expect(makeSetupCode(take)).toBe(`${a[0]}${a[0]}${a[30]}${a[30]}-${a[1]}${a[1]}${a[0]}${a[2]}`);
  });
});

describe('setupCodeMatches', () => {
  const code = 'ABCD-EF23';

  it('accepts the code as printed, and as people type it', () => {
    for (const input of ['ABCD-EF23', 'abcd-ef23', '  ABCD-EF23 ', 'ABCDEF23', 'abcd ef23', 'AB CD-EF 23']) {
      expect(setupCodeMatches(input, code), input).toBe(true);
    }
  });

  it('refuses anything else without throwing, whatever its length', () => {
    for (const input of ['ABCD-EF24', 'ABCD-EF2', 'ABCD-EF233', '', '-', 'ÄBCD-EF23', 'ABCD_EF23']) {
      expect(setupCodeMatches(input, code), input).toBe(false);
    }
  });

  it('compares codes of the right length in constant time', () => {
    vi.mocked(timingSafeEqual).mockClear();
    expect(setupCodeMatches('ABCD-EF24', code)).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledOnce();
  });
});
```

- [x] **Step 6: Run it to see it fail, implement, see it pass**

Run: `npm run test:unit -w apps/server -- src/setup/setup-code.test.ts`
Expected: FAIL: `Error: Cannot find module` for `./setup-code` (no tests run).

Create `apps/server/src/setup/setup-code.ts`. The alphabet is 31 characters (A–Z and 2–9 without the look-alikes 0, O, 1, I, L), not a power of two, so a plain `byte % 31` would favour the first letters; the code throws away the 8 top byte values and draws again (rejection sampling). The comparison uses `timingSafeEqual` so the time it takes doesn't reveal how many leading characters were right.

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The letters a setup code is made of: A–Z and 2–9 without the ones people mix up when they copy a code from a
 * terminal into a browser (0 and O, 1, I and L). 31 of them.
 */
export const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const CODE_LENGTH = 8;

/**
 * The biggest multiple of 31 that fits in a byte (248). A byte below it, taken `% 31`, gives every letter exactly 8
 * chances; the 8 bytes from 248 to 255 would give the first 8 letters a 9th, so they're thrown away and a new byte is
 * drawn (this is called rejection sampling). Without it some letters would come up more often, which makes a code
 * slightly easier to guess.
 */
const FAIR_BYTES = 256 - (256 % SETUP_CODE_ALPHABET.length);

/**
 * A one-time setup code like `K7PX-3MQD`, printed in the server's log at boot in first-run mode (setup/boot.ts). Only
 * someone who can read the log (the server's owner) can type it into /first-run, so a stranger who finds a fresh
 * server first can't claim it. 31⁸ ≈ 850 billion codes, at 5 tries a minute per address. `random` is for tests.
 */
export function makeSetupCode(random: (size: number) => Buffer = randomBytes): string {
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of random(16)) {
      if (byte >= FAIR_BYTES) continue;
      code += SETUP_CODE_ALPHABET[byte % SETUP_CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What people type, as the code is stored: no spaces or dash, upper case. */
function normalize(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Does what someone typed match the code? Spaces, a dash and lower case don't matter. The letters are compared in
 * constant time (`timingSafeEqual`), so how long a wrong answer takes says nothing about how many letters were right
 * (docs/why/security-primitives.md). `timingSafeEqual` throws on buffers of different lengths, so those are a plain no
 * first: the length of the code is no secret, it's printed on the page.
 */
export function setupCodeMatches(input: string, code: string): boolean {
  const typed = Buffer.from(normalize(input), 'utf8');
  const expected = Buffer.from(normalize(code), 'utf8');
  if (typed.length !== expected.length) return false;
  return timingSafeEqual(typed, expected);
}
```

Run: `npm run test:unit -w apps/server -- src/setup/setup-code.test.ts`
Expected: PASS (6 tests).

- [x] **Step 7: Write the manifest tests, see them fail, implement, see them pass**

Create `apps/server/src/setup/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildManifest, manifestFormAction } from './manifest';

describe('buildManifest', () => {
  it("describes the app this server needs: its URLs, spec §15's events and permissions", () => {
    expect(buildManifest({ publicUrl: 'https://nitpilot.example.com', name: 'Nitpilot (example)', isPublic: false })).toEqual({
      name: 'Nitpilot (example)',
      url: 'https://nitpilot.example.com',
      description: "Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make.",
      hook_attributes: { url: 'https://nitpilot.example.com/webhooks/github', active: true },
      redirect_url: 'https://nitpilot.example.com/first-run/callback',
      callback_urls: ['https://nitpilot.example.com/auth/github/callback'],
      setup_url: 'https://nitpilot.example.com/github/setup',
      setup_on_update: true,
      public: false,
      request_oauth_on_install: false,
      default_events: ['issue_comment', 'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'repository'],
      default_permissions: { contents: 'read', issues: 'read', metadata: 'read', pull_requests: 'write' },
    });
  });

  it('lets anyone install it when asked (the hosted instance), and drops a trailing slash from PUBLIC_URL', () => {
    const manifest = buildManifest({ publicUrl: 'https://nitpilot.dev/', name: 'nitpilot', isPublic: true });
    expect(manifest.public).toBe(true);
    expect(manifest.url).toBe('https://nitpilot.dev');
    expect(manifest.hook_attributes.url).toBe('https://nitpilot.dev/webhooks/github');
    expect(manifest.redirect_url).toBe('https://nitpilot.dev/first-run/callback');
  });
});

describe('manifestFormAction', () => {
  it("posts to the person's own app settings, or an organization's", () => {
    expect(manifestFormAction({ webBase: 'https://github.com', owner: { kind: 'user' }, state: 'abc_-1' })).toBe(
      'https://github.com/settings/apps/new?state=abc_-1',
    );
    expect(manifestFormAction({ webBase: 'https://github.com', owner: { kind: 'org', login: 'acme-inc' }, state: 'abc_-1' })).toBe(
      'https://github.com/organizations/acme-inc/settings/apps/new?state=abc_-1',
    );
  });

  it('uses the web address it is given, so tests can stand in for github.com', () => {
    expect(manifestFormAction({ webBase: 'http://127.0.0.1:9999', owner: { kind: 'user' }, state: 's' })).toBe('http://127.0.0.1:9999/settings/apps/new?state=s');
  });
});
```

Run: `npm run test:unit -w apps/server -- src/setup/manifest.test.ts`
Expected: FAIL: `Error: Cannot find module './manifest'` (no tests run).

Create `apps/server/src/setup/manifest.ts` (pure: no database, no network). It builds the description of the app that GitHub creates: every URL comes from `PUBLIC_URL`, and the events and permissions are spec §15's, the same as the dev app `nitpilot-dev`.

```ts
/**
 * A GitHub App manifest: the description of an app that GitHub creates for us in one click (first-run mode, spec §17
 * "Self-hosting"). The first-run page posts it to GitHub as a form; GitHub shows the person a "Create GitHub App" page
 * filled in from it. Pure: no database, no network. See docs/why/first-run-and-app-manifests.md.
 *
 * GitHub's field names are snake_case, so these are too.
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */
export type AppManifest = {
  name: string;
  url: string;
  description: string;
  hook_attributes: { url: string; active: boolean };
  /** Where GitHub sends the browser back, with `?code=…&state=…`, once the app exists. */
  redirect_url: string;
  /** Where GitHub sends people back after "Sign in with GitHub" (auth/github-oauth.ts). */
  callback_urls: string[];
  /** Where GitHub sends people after they install the app (http/routes/setup.ts). */
  setup_url: string;
  setup_on_update: boolean;
  public: boolean;
  request_oauth_on_install: boolean;
  default_events: string[];
  default_permissions: Record<string, 'read' | 'write'>;
};

/** Spec §1's pitch, which GitHub shows on the app's page. */
const DESCRIPTION = "Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make.";

/**
 * The webhooks the server subscribes to (spec §15), the same list as the dev app `nitpilot-dev`. `installation` and
 * `installation_repositories` aren't listed: GitHub sends those to every app on its own.
 */
const EVENTS = ['issue_comment', 'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'repository'];

/** What the app may do on an installed repo (spec §15): write only pull requests (the summary comment, reviews). */
const PERMISSIONS = { contents: 'read', issues: 'read', metadata: 'read', pull_requests: 'write' } as const;

/**
 * The manifest for this server's app. Every URL in it is built from PUBLIC_URL, so the app GitHub creates sends its
 * webhooks, sign-ins and installs to this server. `isPublic`: false lets only the account or organization that owns
 * the app install it (a team's own server); true lets anyone (the hosted instance).
 */
export function buildManifest(opts: { publicUrl: string; name: string; isPublic: boolean }): AppManifest {
  const base = opts.publicUrl.replace(/\/+$/, '');
  return {
    name: opts.name,
    url: base,
    description: DESCRIPTION,
    hook_attributes: { url: `${base}/webhooks/github`, active: true },
    redirect_url: `${base}/first-run/callback`,
    callback_urls: [`${base}/auth/github/callback`],
    setup_url: `${base}/github/setup`,
    // Also send people to setup_url when they change which repos the app can see, so the repo list updates at once.
    setup_on_update: true,
    public: opts.isPublic,
    // Signing in is its own step (the web app's "Sign in"); installing shouldn't also ask for it.
    request_oauth_on_install: false,
    default_events: [...EVENTS],
    default_permissions: { ...PERMISSIONS },
  };
}

/** Whose app it becomes: the person's own account, or an organization they administer. */
export type ManifestOwner = { kind: 'user' } | { kind: 'org'; login: string };

/**
 * Where the first-run page posts the manifest. `state` comes back unchanged on the redirect, which is how the callback
 * knows the round trip started here (setup/first-run.ts). `webBase` is `GithubClient.webBase`, so tests can point it
 * at a stand-in for github.com.
 */
export function manifestFormAction(opts: { webBase: string; owner: ManifestOwner; state: string }): string {
  const path = opts.owner.kind === 'org' ? `/organizations/${encodeURIComponent(opts.owner.login)}/settings/apps/new` : '/settings/apps/new';
  return `${opts.webBase}${path}?state=${encodeURIComponent(opts.state)}`;
}
```

Run: `npm run test:unit -w apps/server -- src/setup/manifest.test.ts`
Expected: PASS (4 tests).

- [x] **Step 8: Write the credentials tests, and let the test database empty the new table**

Create `apps/server/src/setup/credentials.db.test.ts`. It covers: the environment wins over a stored row; nothing set and no row gives `null`; a stored row decrypts; the wrong `ENCRYPTION_KEY` refuses with the message the Interfaces give; the encrypted columns differ from the plain values; a second save is refused and the first row stays.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { githubApp, GithubAppExistsError, loadGithubApp, saveGithubApp, setGithubApp, type GithubAppCredentials } from './credentials';

const STORED: GithubAppCredentials = {
  appId: '777',
  slug: 'nitpilot-selfhost',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nstored\n-----END RSA PRIVATE KEY-----\n',
  clientId: 'Iv23.stored',
  clientSecret: 'stored-client-secret',
  webhookSecret: 'stored-webhook-secret',
};

/** The app TEST_ENV describes (test/test-env.ts). */
const FROM_ENV: GithubAppCredentials = {
  appId: '12345',
  slug: 'nitpilot-dev',
  privateKey: 'tests-that-need-a-key-generate-one',
  clientId: 'Iv1.test',
  clientSecret: 'test-client-secret',
  webhookSecret: 'test-webhook-secret',
};

/** No GitHub App in the environment, as on a fresh self-hosted server. */
function clearGithubEnv() {
  for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET']) {
    vi.stubEnv(name, '');
  }
}

beforeEach(async () => {
  await prisma.githubAppConfig.deleteMany();
});

afterEach(() => {
  vi.unstubAllEnvs();
  setGithubApp(null);
});

describe('saveGithubApp', () => {
  it('stores one row, with the private key and both secrets encrypted', async () => {
    await saveGithubApp(STORED, 'maya');
    const row = await prisma.githubAppConfig.findUniqueOrThrow({ where: { id: 'app' } });
    expect(row).toMatchObject({ appId: '777', slug: 'nitpilot-selfhost', clientId: 'Iv23.stored', ownerLogin: 'maya' });
    expect(row.privateKeyEnc).not.toContain('stored');
    expect(row.clientSecretEnc).not.toBe(STORED.clientSecret);
    expect(row.webhookSecretEnc).not.toBe(STORED.webhookSecret);
  });

  it('refuses a second app: one per server, and the first is never overwritten', async () => {
    await saveGithubApp(STORED, 'maya');
    await expect(saveGithubApp({ ...STORED, appId: '888' }, 'mallory')).rejects.toThrow(GithubAppExistsError);
    expect(await prisma.githubAppConfig.findMany()).toEqual([expect.objectContaining({ appId: '777', ownerLogin: 'maya' })]);
  });
});

describe('loadGithubApp', () => {
  it('takes the app from the environment when all six variables are set, even with one stored', async () => {
    await saveGithubApp(STORED, 'maya');
    expect(await loadGithubApp(getEnv())).toEqual({ source: 'env', creds: FROM_ENV });
  });

  it('reads the stored app when the environment has none', async () => {
    clearGithubEnv();
    await saveGithubApp(STORED, 'maya');
    expect(await loadGithubApp(getEnv())).toEqual({ source: 'database', creds: STORED });
  });

  it("refuses a stored app that this ENCRYPTION_KEY can't read, and leaves it as it was", async () => {
    clearGithubEnv();
    await saveGithubApp(STORED, 'maya');
    const before = await prisma.githubAppConfig.findUniqueOrThrow({ where: { id: 'app' } });

    vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
    await expect(loadGithubApp(getEnv())).rejects.toThrow(
      "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with.",
    );
    expect(await prisma.githubAppConfig.findUniqueOrThrow({ where: { id: 'app' } })).toEqual(before);
  });

  it('finds nothing on a fresh server: first-run mode', async () => {
    clearGithubEnv();
    expect(await loadGithubApp(getEnv())).toBeNull();
  });
});

describe('githubApp', () => {
  it('answers with the app the server started with', () => {
    setGithubApp(STORED);
    expect(githubApp()).toEqual(STORED);
  });

  it('falls back to the environment (tests and scripts that never boot the server)', () => {
    expect(githubApp()).toEqual(FROM_ENV);
  });

  it('throws in first-run mode, when there is no app at all', () => {
    clearGithubEnv();
    expect(() => githubApp()).toThrow('No GitHub App yet: this server is in first-run mode.');
  });
});
```

`resetDb` (which empties every table between tests) must know the new table. In `apps/server/test/db.ts`:

```diff
--- a/apps/server/test/db.ts
+++ b/apps/server/test/db.ts
@@ -112,6 +112,6 @@ export async function resetDb(): Promise<void> {
   const [{ name }] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
   assertTestDatabase(name!);
   await prisma.$executeRawUnsafe(
-    'TRUNCATE "Task", "RawEvent", "SeenComment", "GithubWrite", "Message", "Point", "Job", "Participant", "PrChat", "Repo", "Installation", "CliLoginRequest", "CliToken", "WebSession", "GithubAuth", "User" CASCADE',
+    'TRUNCATE "Task", "RawEvent", "SeenComment", "GithubWrite", "Message", "Point", "Job", "Participant", "PrChat", "Repo", "Installation", "CliLoginRequest", "CliToken", "WebSession", "GithubAuth", "User", "GithubAppConfig" CASCADE',
   );
 }
```

Run: `npm run test:db -w apps/server -- src/setup/credentials`
Expected: FAIL: `Error: Cannot find module './credentials'` (no tests run).

- [x] **Step 9: The `GithubAppConfig` model and its migration**

One row (`id` is always `app`) holds the app a server made for itself. A fixed id plus an insert-only save means two callbacks racing can't both win. In `apps/server/prisma/schema.prisma`, add at the end of the file:

```diff
--- a/apps/server/prisma/schema.prisma
+++ b/apps/server/prisma/schema.prisma
@@ -394,3 +394,21 @@ model PushSubscription {
 
   @@index([userId])
 }
+
+/// The GitHub App this server created for itself in first-run mode (spec §17 "Self-hosting", setup/first-run.ts).
+/// At most one row (`id` is always "app"), written once and never overwritten. The private key and both secrets are
+/// encrypted with ENCRYPTION_KEY (AES-256-GCM, lib/crypto.ts); the rest is what GitHub shows on the app's page anyway.
+/// GITHUB_* variables in the environment win over this row (setup/credentials.ts).
+model GithubAppConfig {
+  id               String   @id @default("app")
+  appId            String
+  slug             String
+  clientId         String
+  privateKeyEnc    String
+  clientSecretEnc  String
+  webhookSecretEnc String
+  /// The account or organization that owns the app on GitHub.
+  ownerLogin       String
+  createdAt        DateTime @default(now())
+  updatedAt        DateTime @updatedAt
+}
```

Now create the migration. Run from `apps/server` (the dev database must be up: `docker start nitpilot-postgres-1`):

```bash
cd apps/server && npx prisma migrate dev --name github_app_config
```

(`npm run db:migrate -w apps/server -- --name github_app_config` runs the same thing.) Expected: it prints `Applying migration` followed by `…_github_app_config` and `Your database is now in sync with your schema.` Prisma names the folder from the current time, so yours will be `apps/server/prisma/migrations/<your timestamp>_github_app_config/` (the reference build's was `20261024132205_github_app_config`); the timestamp differs, the SQL must not. Check that `migration.sql` in that folder is exactly:

```sql
-- CreateTable
CREATE TABLE "GithubAppConfig" (
    "id" TEXT NOT NULL DEFAULT 'app',
    "appId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "privateKeyEnc" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "webhookSecretEnc" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubAppConfig_pkey" PRIMARY KEY ("id")
);
```

`prisma migrate dev` did not regenerate the Prisma client in the reference build, so do it explicitly:

```bash
npm run db:generate -w apps/server
```

Expected: `Generated Prisma Client (7.10.0) to ./src/generated/prisma`. (The test database is migrated by the test run itself, `test/global-setup.ts`.)

- [x] **Step 10: Implement `setup/credentials.ts`, and `githubApp()`**

`credentialsFromEnv` turns the six variables into one value. `loadGithubApp` is the boot-time question "which app am I?": the environment first (development, or anyone who made their app by hand), else the stored row, else `null`, which means first-run mode. A row that won't decrypt must stop the server and must never fall into first-run mode, because the app still exists on GitHub and only the old key can bring it back. `saveGithubApp` encrypts the three secrets and inserts. `setGithubApp` / `githubApp()` are a process-wide holder in the style of `getEnv()` (see the deviations list): `main.ts` sets the app once at boot and every reader asks for it, and tests and scripts, which never boot the server, get the environment's app.

```ts
import type { GithubAppConfig } from '../generated/prisma/client';
import { decrypt, encrypt } from '../lib/crypto';
import { getEnv, type Env } from '../lib/env';
import { isUniqueViolation, prisma } from '../lib/prisma';

/**
 * Everything the server needs to be a GitHub App (docs/why/github-app.md): who it is (`appId`, `slug`), how it proves
 * it (`privateKey`), how people sign in through it (`clientId`, `clientSecret`) and how it checks webhooks
 * (`webhookSecret`). It comes from the GITHUB_* variables, or from the app first-run mode created and stored
 * (docs/why/first-run-and-app-manifests.md).
 */
export type GithubAppCredentials = {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
};

/** The one row's id: a server has at most one app. */
const APP_ROW_ID = 'app';

/** A second app for a server that already has one (two first-run callbacks at once, or a replayed one). */
export class GithubAppExistsError extends Error {
  constructor() {
    super('This server already has a GitHub App.');
    this.name = 'GithubAppExistsError';
  }
}

/** The app in the environment, or null when its six variables aren't set (getEnv already refused a half-set app). */
export function credentialsFromEnv(env: Env): GithubAppCredentials | null {
  const { GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET } = env;
  if (!GITHUB_APP_ID || !GITHUB_APP_SLUG || !GITHUB_APP_PRIVATE_KEY || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_WEBHOOK_SECRET) return null;
  return {
    appId: GITHUB_APP_ID,
    slug: GITHUB_APP_SLUG,
    privateKey: GITHUB_APP_PRIVATE_KEY,
    clientId: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    webhookSecret: GITHUB_WEBHOOK_SECRET,
  };
}

/**
 * The stored app, decrypted. AES-GCM refuses to decrypt with any other key than the one that encrypted (lib/crypto.ts),
 * so a changed ENCRYPTION_KEY lands here. The server must not start then, and above all must not fall into first-run
 * mode and replace the row: the app still exists on GitHub, and only the old key can bring it back.
 */
function decryptRow(row: GithubAppConfig): GithubAppCredentials {
  try {
    return {
      appId: row.appId,
      slug: row.slug,
      clientId: row.clientId,
      privateKey: decrypt(row.privateKeyEnc),
      clientSecret: decrypt(row.clientSecretEnc),
      webhookSecret: decrypt(row.webhookSecretEnc),
    };
  } catch {
    throw new Error("The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with.");
  }
}

/**
 * Which GitHub App this server is, at boot (main.ts): the environment's when its six variables are set (development
 * with `nitpilot-dev`, or anyone who made their app by hand), else the one first-run mode stored, else null, which
 * means first-run mode.
 */
export async function loadGithubApp(env: Env): Promise<{ source: 'env' | 'database'; creds: GithubAppCredentials } | null> {
  const fromEnv = credentialsFromEnv(env);
  if (fromEnv) return { source: 'env', creds: fromEnv };
  const row = await prisma.githubAppConfig.findUnique({ where: { id: APP_ROW_ID } });
  if (!row) return null;
  return { source: 'database', creds: decryptRow(row) };
}

/**
 * Store the app first-run mode just created. Insert only: the row's fixed id makes a second save a unique-constraint
 * error, so two callbacks racing can't both win and an existing app is never overwritten.
 */
export async function saveGithubApp(creds: GithubAppCredentials, ownerLogin: string): Promise<void> {
  try {
    await prisma.githubAppConfig.create({
      data: {
        id: APP_ROW_ID,
        appId: creds.appId,
        slug: creds.slug,
        clientId: creds.clientId,
        privateKeyEnc: encrypt(creds.privateKey),
        clientSecretEnc: encrypt(creds.clientSecret),
        webhookSecretEnc: encrypt(creds.webhookSecret),
        ownerLogin,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new GithubAppExistsError();
    throw err;
  }
}

// The app this process runs as, set once at boot. Like getEnv(), any file can ask for it without it being passed down
// through every function between main.ts and the one GitHub call that needs a secret.
let current: GithubAppCredentials | null = null;

/** Called once by main.ts with what loadGithubApp found. Tests pass null to forget it again. */
export function setGithubApp(creds: GithubAppCredentials | null): void {
  current = creds;
}

/**
 * The app this server runs as: what main.ts set at boot, else the environment's (tests and scripts, which never boot
 * the server). Throws in first-run mode; nothing that needs the app runs then (http/app.ts answers 503 first).
 */
export function githubApp(): GithubAppCredentials {
  if (current) return current;
  const fromEnv = credentialsFromEnv(getEnv());
  if (fromEnv) return fromEnv;
  throw new Error('No GitHub App yet: this server is in first-run mode.');
}
```

Run: `npm run test:db -w apps/server -- src/setup/credentials`
Expected: PASS (9 tests).

- [x] **Step 11: Switch every reader of a `GITHUB_*` value to `githubApp()`**

Nothing new to test here: the existing suites already cover each reader (their environment has all six values, so `githubApp()` answers from it). Four source files read `env.GITHUB_*`, plus the test helper: the onboarding facts (the app slug), the token refresh (client id and secret), the sign-in routes (client id and secret), the webhook route (the secret) and the helper that signs webhooks in tests. `main.ts` and `scripts/dev-tunnel.ts` come in Steps 18 and 19. Apply each change:

```diff
--- a/apps/server/src/auth/onboarding.ts
+++ b/apps/server/src/auth/onboarding.ts
@@ -3,6 +3,7 @@ import { getEnv } from '../lib/env';
 import { prisma } from '../lib/prisma';
 import { TtlCache } from '../lib/ttl-cache';
 import type { PlatformReads } from '../platform/types';
+import { githubApp } from '../setup/credentials';
 
 /** How long GitHub's "yes, the app is installed" is kept per person. A "no" is never kept. */
 export const INSTALLED_TTL_MS = 5 * 60_000;
@@ -42,7 +43,7 @@ export class OnboardingFacts {
       orderBy: { createdAt: 'desc' },
       select: { name: true, repos: true, agentId: true },
     });
-    const about = { deviceName: tokens[0]?.name ?? null, appSlug: env.GITHUB_APP_SLUG, publicReposOnly: env.PUBLIC_REPOS_ONLY };
+    const about = { deviceName: tokens[0]?.name ?? null, appSlug: githubApp().slug, publicReposOnly: env.PUBLIC_REPOS_ONLY };
     if (user.onboardedAt) return { steps: ALL_DONE, done: true, ...about };
 
     const steps: Onboarding['steps'] = {
```

```diff
--- a/apps/server/src/auth/user-tokens.ts
+++ b/apps/server/src/auth/user-tokens.ts
@@ -1,8 +1,8 @@
 import type { GithubAuth } from '../generated/prisma/client';
 import { decrypt, encrypt } from '../lib/crypto';
-import { getEnv } from '../lib/env';
 import { prisma } from '../lib/prisma';
 import { GithubError, type GithubClient } from '../platform/github/client';
+import { githubApp } from '../setup/credentials';
 import { refreshTokens, type OAuthTokens } from './github-oauth';
 
 /** The user must sign in with GitHub again before Nitpilot can act as them. */
@@ -57,10 +57,10 @@ async function refreshOnce(auth: GithubAuth, github: GithubClient, now: Date): P
     throw new NeedsReauthError(auth.userId);
   }
 
-  const env = getEnv();
+  const app = githubApp();
   let tokens: OAuthTokens;
   try {
-    tokens = await refreshTokens(github, { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, refreshToken: decrypt(auth.refreshTokenEnc) }, now);
+    tokens = await refreshTokens(github, { clientId: app.clientId, clientSecret: app.clientSecret, refreshToken: decrypt(auth.refreshTokenEnc) }, now);
   } catch (err) {
     // GitHub answered and said no (e.g. bad_refresh_token): only a new sign-in fixes that.
     if (err instanceof GithubError && err.status < 500) {
```

```diff
--- a/apps/server/src/http/routes/auth.ts
+++ b/apps/server/src/http/routes/auth.ts
@@ -10,6 +10,7 @@ import { isAllowedOrigin } from '../../lib/csrf';
 import { decrypt, encrypt } from '../../lib/crypto';
 import { getEnv } from '../../lib/env';
 import { randomSecret } from '../../lib/tokens';
+import { githubApp } from '../../setup/credentials';
 import type { AppDeps } from '../app';
 import { HttpError } from '../errors';
 
@@ -63,7 +64,7 @@ export function authRoutes(deps: Pick<AppDeps, 'github' | 'dispatch' | 'webSocke
     return c.redirect(
       authorizeUrl({
         webBase: deps.github.webBase,
-        clientId: env.GITHUB_CLIENT_ID,
+        clientId: githubApp().clientId,
         redirectUri: `${env.PUBLIC_URL}/auth/github/callback`,
         state,
         codeChallenge: pkceChallenge(verifier),
@@ -80,9 +81,10 @@ export function authRoutes(deps: Pick<AppDeps, 'github' | 'dispatch' | 'webSocke
       throw new HttpError('validation_error', 'This sign-in link expired or was changed. Please sign in again.');
     }
 
+    const app = githubApp();
     const tokens = await exchangeCode(deps.github, {
-      clientId: env.GITHUB_CLIENT_ID,
-      clientSecret: env.GITHUB_CLIENT_SECRET,
+      clientId: app.clientId,
+      clientSecret: app.clientSecret,
       code,
       redirectUri: `${env.PUBLIC_URL}/auth/github/callback`,
       codeVerifier: saved.verifier,
```

```diff
--- a/apps/server/src/http/routes/webhooks.ts
+++ b/apps/server/src/http/routes/webhooks.ts
@@ -1,9 +1,9 @@
 import { Hono } from 'hono';
 import { bodyLimit } from 'hono/body-limit';
-import { getEnv } from '../../lib/env';
 import { verifyGithubSignature } from '../../lib/hmac';
 import type { Ingest } from '../../ingest/process';
 import { recordDelivery } from '../../ingest/record';
+import { githubApp } from '../../setup/credentials';
 import { errorBody, HttpError } from '../errors';
 
 const MAX_BODY_BYTES = 1024 * 1024;
@@ -20,7 +20,7 @@ export function webhookRoutes(deps: { ingest: Ingest }): Hono {
     bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(errorBody('payload_too_large', 'webhook body over 1 MB'), 413) }),
     async (c) => {
       const raw = await c.req.text();
-      if (!verifyGithubSignature(raw, c.req.header('x-hub-signature-256'), getEnv().GITHUB_WEBHOOK_SECRET)) {
+      if (!verifyGithubSignature(raw, c.req.header('x-hub-signature-256'), githubApp().webhookSecret)) {
         throw new HttpError('unauthorized', 'bad webhook signature');
       }
       const deliveryId = c.req.header('x-github-delivery');
```

```diff
--- a/apps/server/test/webhooks.ts
+++ b/apps/server/test/webhooks.ts
@@ -1,6 +1,6 @@
 import type { Hono } from 'hono';
-import { getEnv } from '../src/lib/env';
 import { signGithubBody } from '../src/lib/hmac';
+import { githubApp } from '../src/setup/credentials';
 
 let n = 0;
 
@@ -14,7 +14,7 @@ export async function sendWebhook(app: Hono, event: string, payload: unknown, op
       'content-type': 'application/json',
       'x-github-event': event,
       'x-github-delivery': opts.deliveryId ?? `delivery-${Date.now()}-${n}`,
-      'x-hub-signature-256': signGithubBody(body, opts.secret ?? getEnv().GITHUB_WEBHOOK_SECRET),
+      'x-hub-signature-256': signGithubBody(body, opts.secret ?? githubApp().webhookSecret),
     },
     body,
   });
```

Run: `npm test -w apps/server -- src/auth src/http/routes test/`
Expected: PASS (25 files, 350 tests).

- [x] **Step 12: Write the protocol schemas' tests, see them fail, implement, see them pass**

The first-run page (Task 8) and the server share three request/response shapes, so they live in `packages/protocol`. In `packages/protocol/src/web-api.test.ts`, change the import and add the new `describe` at the end of the file:

```diff
--- a/packages/protocol/src/web-api.test.ts
+++ b/packages/protocol/src/web-api.test.ts
@@ -2,7 +2,8 @@ import { describe, expect, it } from 'vitest';
 import { MeResponse } from './api';
 import { jobResult, settings } from './test-samples';
 import {
-  ActionResponse, AutoRequest, ChatResponse, CliRequestDecision, CliRequestView, DevicesResponse, DraftView, FilesResponse, InboxResponse, InboxStatus, MarkReadRequest, NoteRequest,
+  ActionResponse, AutoRequest, ChatResponse, CliRequestDecision, CliRequestView, DevicesResponse, DraftView, FilesResponse, FirstRunManifestRequest, FirstRunManifestResponse,
+  FirstRunStatus, InboxResponse, InboxStatus, MarkReadRequest, NoteRequest,
   Onboarding, PushSubscriptionRequest, PushUnsubscribeRequest, Settings, WebMe, ChatView, type DeviceView, type InboxRow,
 } from './web-api';
 
@@ -165,3 +166,34 @@ describe('web API bodies', () => {
     expect(CliRequestDecision.safeParse({ decision: 'maybe' }).success).toBe(false);
   });
 });
+
+describe('first-run bodies', () => {
+  it('knows both modes of GET /api/first-run', () => {
+    expect(FirstRunStatus.parse({ mode: 'first_run', publicUrl: 'https://nitpilot.example.com' })).toEqual({ mode: 'first_run', publicUrl: 'https://nitpilot.example.com' });
+    expect(FirstRunStatus.parse({ mode: 'ready', installUrl: 'https://github.com/apps/nitpilot/installations/new' }).mode).toBe('ready');
+    expect(FirstRunStatus.safeParse({ mode: 'ready', publicUrl: 'https://nitpilot.example.com' }).success).toBe(false);
+  });
+
+  it('takes a manifest request for a personal account or an organization', () => {
+    const request = { code: 'ABCD-EF23', owner: { kind: 'user' }, name: 'Nitpilot (example)', isPublic: false };
+    expect(FirstRunManifestRequest.parse(request)).toEqual(request);
+    const forOrg = { ...request, owner: { kind: 'org', login: 'acme-inc' } };
+    expect(FirstRunManifestRequest.parse(forOrg)).toEqual(forOrg);
+  });
+
+  it("refuses an app name GitHub would refuse (1 to 34 characters), and a login that isn't GitHub's shape", () => {
+    const request = { code: 'ABCD-EF23', owner: { kind: 'user' }, isPublic: false };
+    expect(FirstRunManifestRequest.parse({ ...request, name: '  Nitpilot  ' }).name).toBe('Nitpilot');
+    expect(FirstRunManifestRequest.safeParse({ ...request, name: 'x'.repeat(34) }).success).toBe(true);
+    for (const name of ['', '   ', 'x'.repeat(35)]) expect(FirstRunManifestRequest.safeParse({ ...request, name }).success).toBe(false);
+    for (const login of ['', '-acme', 'acme-', 'ac--me', 'acme/inc', 'x'.repeat(40)]) {
+      expect(FirstRunManifestRequest.safeParse({ ...request, name: 'n', owner: { kind: 'org', login } }).success, login).toBe(false);
+    }
+    expect(FirstRunManifestRequest.safeParse({ ...request, name: 'n', owner: { kind: 'org' } }).success).toBe(false);
+  });
+
+  it('round-trips the answer the page posts as a form', () => {
+    const answer = { action: 'https://github.com/settings/apps/new?state=abc', manifest: { name: 'Nitpilot', public: false } };
+    expect(FirstRunManifestResponse.parse(answer)).toEqual(answer);
+  });
+});
```

Run: `npm test -w packages/protocol -- web-api`
Expected: FAIL, 4 tests, each with `TypeError: Cannot read properties of undefined (reading 'parse')`; the other 27 pass.

In `packages/protocol/src/web-api.ts`, add at the end of the file:

```diff
--- a/packages/protocol/src/web-api.ts
+++ b/packages/protocol/src/web-api.ts
@@ -384,3 +384,39 @@ export type PrFile = z.infer<typeof PrFile>;
 /** The PR's changed files, at most 300; `truncated` when it has more. `adds` and `dels` add up the files listed. */
 export const FilesResponse = z.object({ files: z.array(PrFile), adds: z.number().int(), dels: z.number().int(), truncated: z.boolean() });
 export type FilesResponse = z.infer<typeof FilesResponse>;
+
+// ── First-run mode (Plan 3, spec §17 "Self-hosting"): a server with no GitHub App creates one on /first-run ──
+
+/**
+ * `GET /api/first-run`. `first_run`: the server has no GitHub App yet and the page shows the setup form. `ready`: it
+ * has one (from the environment or made here), and `installUrl` is where people install it on their repos. The page
+ * polls this after GitHub sends it back, while the server restarts.
+ */
+export const FirstRunStatus = z.discriminatedUnion('mode', [
+  z.object({ mode: z.literal('first_run'), publicUrl: z.string() }),
+  z.object({ mode: z.literal('ready'), installUrl: z.string() }),
+]);
+export type FirstRunStatus = z.infer<typeof FirstRunStatus>;
+
+/** A GitHub login: letters, digits and single dashes between them, at most 39 characters. */
+const GithubLogin = z.string().regex(/^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/, "isn't a GitHub login");
+
+/**
+ * `POST /api/first-run/manifest`. `code`: the setup code from the server's log. `owner`: the person's own account, or
+ * an organization they administer. `name`: the app's name on GitHub (GitHub allows 34 characters). `isPublic`: may
+ * anyone install the app, or only its owner.
+ */
+export const FirstRunManifestRequest = z.object({
+  code: z.string(),
+  owner: z.discriminatedUnion('kind', [z.object({ kind: z.literal('user') }), z.object({ kind: z.literal('org'), login: GithubLogin })]),
+  name: z.string().trim().min(1).max(34),
+  isPublic: z.boolean(),
+});
+export type FirstRunManifestRequest = z.infer<typeof FirstRunManifestRequest>;
+
+/**
+ * Its answer: the page posts `manifest` (as JSON, in a hidden field named `manifest`) to `action` in a real form.
+ * GitHub requires a form post from the browser, not a fetch.
+ */
+export const FirstRunManifestResponse = z.object({ action: z.string(), manifest: z.record(z.string(), z.unknown()) });
+export type FirstRunManifestResponse = z.infer<typeof FirstRunManifestResponse>;
```

Run: `npm test -w packages/protocol`
Expected: PASS (88 tests, 4 more than before).

- [x] **Step 13: The Content-Security-Policy's `form-action`, and the two error codes**

GitHub accepts a manifest only as a real form post from the person's browser, so in first-run mode (and only then) the page's policy must let a form post to GitHub. First the tests, in `apps/server/src/http/spa.test.ts`:

```diff
--- a/apps/server/src/http/spa.test.ts
+++ b/apps/server/src/http/spa.test.ts
@@ -3,7 +3,7 @@ import { tmpdir } from 'node:os';
 import path from 'node:path';
 import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import { testApp } from '../../test/app';
-import { BUILD_HINT, contentSecurityPolicy } from './spa';
+import { BUILD_HINT, contentSecurityPolicy, spaRoutes } from './spa';
 
 // A pretend build: dist/ with an index, a hashed asset and a service worker, and a secret next to it.
 let outer: string;
@@ -114,4 +114,15 @@ describe('the Content-Security-Policy', () => {
   it('allows a plain ws:// socket for the http dev address', () => {
     expect(contentSecurityPolicy('http://localhost:5173')).toContain("connect-src 'self' ws://localhost:5173;");
   });
+
+  it('lets forms post to the other origins it is given, and nowhere else (first-run mode posts to GitHub)', () => {
+    const csp = contentSecurityPolicy('https://nitpilot.dev', { formActions: ['https://github.com'] });
+    expect(csp).toContain("; form-action 'self' https://github.com;");
+    expect(csp.match(/form-action/g)).toHaveLength(1);
+  });
+
+  it('is sent with those origins by the web app routes that were given them', async () => {
+    const res = await spaRoutes({ distDir: dist, publicUrl: 'https://nitpilot.dev', formActions: ['https://github.com'] }).request('/first-run');
+    expect(res.headers.get('content-security-policy')).toContain("form-action 'self' https://github.com;");
+  });
 });
```

Run: `npm run test:unit -w apps/server -- src/http/spa.test.ts`
Expected: FAIL, 2 tests: `AssertionError: expected 'default-src \'self\'; connect-src \'s…' to contain '; form-action \'self\' https://github…'` and the same with `form-action \'self\' https://github.c…`; the other 12 pass.

Then `apps/server/src/http/spa.ts` (`contentSecurityPolicy` takes `formActions`, `spaRoutes` passes them on, and `isServerPath` is exported because the first-run app needs the same list of server paths):

```diff
--- a/apps/server/src/http/spa.ts
+++ b/apps/server/src/http/spa.ts
@@ -32,9 +32,11 @@ export const BUILD_HINT = "The web app isn't built. Run `npm run build -w apps/w
  * written in HTML or set as an attribute, and <style> elements. React's `style={{…}}` goes through the DOM's
  * style object, which the policy doesn't restrict; it's kept so a library that writes style attributes or
  * <style> tags still works. Scripts stay strict: a script can do far more harm than a style.
+ * `formActions`: other origins a form on the page may post to. Only first-run mode passes one, GitHub's, because its
+ * page posts the app manifest there as a form (setup/first-run.ts); everywhere else forms post only to this server.
  * See docs/why/content-security-policy.md.
  */
-export function contentSecurityPolicy(publicUrl: string): string {
+export function contentSecurityPolicy(publicUrl: string, opts: { formActions?: string[] } = {}): string {
   const url = new URL(publicUrl);
   const socket = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
   return [
@@ -44,12 +46,12 @@ export function contentSecurityPolicy(publicUrl: string): string {
     "style-src 'self' 'unsafe-inline'",
     "font-src 'self'",
     "base-uri 'self'",
-    "form-action 'self'",
+    ["form-action 'self'", ...(opts.formActions ?? [])].join(' '),
     "frame-ancestors 'none'",
   ].join('; ');
 }
 
-function isServerPath(pathname: string): boolean {
+export function isServerPath(pathname: string): boolean {
   return SERVER_PATHS.has(pathname) || SERVER_PREFIXES.some((prefix) => pathname.startsWith(prefix));
 }
 
@@ -75,10 +77,10 @@ async function fileIn(root: string, pathname: string): Promise<string | null> {
  * the server's own paths, so a link like /c/octo/sandbox/42 opens the app, which then shows that chat.
  * Mounted after every other route. See docs/why/serving-a-spa.md.
  */
-export function spaRoutes(opts: { distDir: string; publicUrl: string }): Hono {
+export function spaRoutes(opts: { distDir: string; publicUrl: string; formActions?: string[] }): Hono {
   const app = new Hono();
   const root = path.resolve(opts.distDir);
-  const csp = contentSecurityPolicy(opts.publicUrl);
+  const csp = contentSecurityPolicy(opts.publicUrl, { formActions: opts.formActions });
 
   app.get('*', async (c, next) => {
     if (isServerPath(c.req.path)) return next();
```

And `apps/server/src/http/errors.ts` gets the two codes first-run mode answers with (no test of its own: Step 14's tests assert both through the routes):

```diff
--- a/apps/server/src/http/errors.ts
+++ b/apps/server/src/http/errors.ts
@@ -8,24 +8,30 @@ export type ErrorCode =
   /** Signed in to Nitpilot, but the GitHub sign-in expired: only signing in again helps (spec §16). */
   | 'reauth'
   | 'forbidden'
+  /** First-run mode: the setup code typed on /first-run isn't the one in the server's log (setup/first-run.ts). */
+  | 'setup_code'
   | 'not_found'
   | 'validation_error'
   | 'conflict'
   | 'payload_too_large'
   | 'rate_limited'
   | 'github_unavailable'
+  /** First-run mode: the server has no GitHub App yet, so only /first-run works (http/app.ts createFirstRunApp). */
+  | 'first_run'
   | 'server_error';
 
 const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
   unauthorized: 401,
   reauth: 401,
   forbidden: 403,
+  setup_code: 403,
   not_found: 404,
   validation_error: 400,
   conflict: 409,
   payload_too_large: 413,
   rate_limited: 429,
   github_unavailable: 502,
+  first_run: 503,
   server_error: 500,
 };
 
```

Run: `npm run test:unit -w apps/server -- src/http/spa.test.ts`
Expected: PASS (14 tests).

- [x] **Step 14: Write the first-run tests (routes and app), see them fail**

Two files. `first-run.db.test.ts` is the main one (18 tests): the routes, through a real first-run app and a fake GitHub. The review-focus cases are all here: no code gives 403 and nothing stored; 5 tries a minute per address, the 6th refused even with the right code; a wrong, missing, used or expired `state` gives 400 and stores nothing and asks GitHub nothing; a conversion answered by the fake GitHub gives one row with encrypted columns that differ from the plain values, and the exit hook called once, 500 ms later; a second callback gives 409. The last two tests are for normal mode (`readyRoutes`).

```ts
import type { FirstRunManifestResponse } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../test/app';
import { fakeFetch, json, type FakeRequest } from '../../test/fake-fetch';
import { createFirstRunApp } from '../http/app';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';
import { loadGithubApp } from './credentials';
import { getEnv } from '../lib/env';

const SETUP_CODE = 'K7PX-3MQD';
const PUBLIC_URL = 'http://localhost:8787';

/** What GitHub answers `POST /app-manifests/{code}/conversions` with (the fields we read, plus a few we don't). */
const CONVERSION = {
  id: 424242,
  slug: 'nitpilot-example',
  node_id: 'A_kwDO',
  name: 'Nitpilot (example)',
  owner: { login: 'maya', id: 1001, type: 'User' },
  client_id: 'Iv23.example',
  client_secret: 'example-client-secret',
  webhook_secret: 'example-webhook-secret',
  pem: '-----BEGIN RSA PRIVATE KEY-----\nexample\n-----END RSA PRIVATE KEY-----\n',
  html_url: 'https://github.com/apps/nitpilot-example',
};

/** A fake GitHub whose manifest conversion answers with `answer` (CONVERSION by default). */
function fakeGithub(answer: (req: FakeRequest) => unknown = () => CONVERSION) {
  const fetch = fakeFetch({ 'POST /app-manifests/the-code/conversions': answer });
  return { fetch, github: new GithubClient(fetch) };
}

/** A server in first-run mode, as boot.ts starts one. */
function firstRunServer(over: { github?: GithubClient; trustProxy?: boolean } = {}) {
  const exit = vi.fn();
  const app = createFirstRunApp({
    github: over.github ?? fakeGithub().github,
    publicUrl: PUBLIC_URL,
    setupCode: SETUP_CODE,
    trustProxy: over.trustProxy ?? false,
    exit,
    webDistDir: '/nonexistent/nitpilot-web-dist',
  });
  return { app, exit };
}

type Server = ReturnType<typeof firstRunServer>;

const REQUEST = { code: SETUP_CODE, owner: { kind: 'user' }, name: 'Nitpilot (example)', isPublic: false };

function askForManifest(server: Server, body: unknown = REQUEST, headers: Record<string, string> = {}) {
  return server.app.request('/api/first-run/manifest', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

/** The `state` GitHub would send back: the one in the form's action. */
async function stateFrom(res: Response): Promise<string> {
  const { action } = (await res.json()) as FirstRunManifestResponse;
  return new URL(action).searchParams.get('state')!;
}

function callback(server: Server, query: string) {
  return server.app.request(`/first-run/callback?${query}`);
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

beforeEach(async () => {
  await prisma.githubAppConfig.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/first-run in first-run mode', () => {
  it('says the server is waiting for setup, and where people reach it', async () => {
    const res = await firstRunServer().app.request('/api/first-run');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'first_run', publicUrl: PUBLIC_URL });
  });
});

describe('POST /api/first-run/manifest', () => {
  it('answers with the manifest and where to post it, for the setup code from the log', async () => {
    const res = await askForManifest(firstRunServer());
    expect(res.status).toBe(200);
    const body = (await res.json()) as FirstRunManifestResponse;
    expect(body.action).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=[A-Za-z0-9_-]{43}$/);
    expect(body.manifest).toMatchObject({ name: 'Nitpilot (example)', public: false, redirect_url: `${PUBLIC_URL}/first-run/callback` });
  });

  it("posts to the organization's app settings when the app is for an organization", async () => {
    const res = await askForManifest(firstRunServer(), { ...REQUEST, owner: { kind: 'org', login: 'acme-inc' }, isPublic: true });
    const body = (await res.json()) as FirstRunManifestResponse;
    expect(body.action).toMatch(/^https:\/\/github\.com\/organizations\/acme-inc\/settings\/apps\/new\?state=/);
    expect(body.manifest).toMatchObject({ public: true });
  });

  it('takes the code as people type it', async () => {
    expect((await askForManifest(firstRunServer(), { ...REQUEST, code: ' k7px3mqd ' })).status).toBe(200);
  });

  it('refuses a wrong or missing code with 403, the same way each time, and starts no setup', async () => {
    const server = firstRunServer();
    for (const body of [{ ...REQUEST, code: 'K7PX-3MQE' }, { ...REQUEST, code: undefined }, 'not json at all']) {
      const res = await askForManifest(server, body);
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toEqual({ code: 'setup_code', message: "That code doesn't match the one in the server's log." });
    }
    // No state was handed out, so no callback can succeed.
    expect((await callback(server, 'code=the-code&state=anything')).status).toBe(400);
  });

  it('checks the rest of the request once the code is right', async () => {
    const res = await askForManifest(firstRunServer(), { ...REQUEST, name: '' });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('validation_error');
  });

  it('slows guessing down: the 6th try from one address in a minute is refused, even with the right code', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = firstRunServer();
    for (let i = 0; i < 5; i++) expect((await askForManifest(server, { ...REQUEST, code: 'WRONG-0000' })).status).toBe(403);
    const sixth = await askForManifest(server);
    expect(sixth.status).toBe(429);
    expect((await errorOf(sixth)).code).toBe('rate_limited');

    vi.advanceTimersByTime(60_001);
    expect((await askForManifest(server)).status).toBe(200);
  });

  it('counts each address on its own behind the proxy', async () => {
    const server = firstRunServer({ trustProxy: true });
    for (let i = 0; i < 6; i++) await askForManifest(server, { ...REQUEST, code: 'WRONG-0000' }, { 'x-forwarded-for': '203.0.113.9' });
    expect((await askForManifest(server, REQUEST, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(429);
    expect((await askForManifest(server, REQUEST, { 'x-forwarded-for': '198.51.100.7' })).status).toBe(200);
  });
});

describe('GET /first-run/callback', () => {
  it('trades the code for the new app, stores it encrypted, sends the browser on and exits the process once, a moment later', async () => {
    const { fetch, github } = fakeGithub();
    const server = firstRunServer({ github });
    const state = await stateFrom(await askForManifest(server));

    const started = Date.now();
    const res = await callback(server, `code=the-code&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/first-run?done=1');

    // GitHub was asked without a token: the code itself is the proof.
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.headers.get('authorization')).toBeNull();

    const rows = await prisma.githubAppConfig.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ appId: '424242', slug: 'nitpilot-example', clientId: 'Iv23.example', ownerLogin: 'maya' });
    expect(rows[0]!.privateKeyEnc).not.toContain('example');
    expect(rows[0]!.clientSecretEnc).not.toBe(CONVERSION.client_secret);
    expect(rows[0]!.webhookSecretEnc).not.toBe(CONVERSION.webhook_secret);

    // The browser gets its redirect before the server goes away.
    expect(server.exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(server.exit).toHaveBeenCalledOnce(), { timeout: 2_000, interval: 20 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(490);
  });

  it('stores what the next boot reads back', async () => {
    const server = firstRunServer();
    await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
    for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET']) vi.stubEnv(name, '');
    try {
      expect(await loadGithubApp(getEnv())).toEqual({
        source: 'database',
        creds: { appId: '424242', slug: 'nitpilot-example', clientId: 'Iv23.example', clientSecret: 'example-client-secret', webhookSecret: 'example-webhook-secret', privateKey: CONVERSION.pem },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses a missing, unknown or reused state, stores nothing and asks GitHub nothing', async () => {
    const { fetch, github } = fakeGithub();
    const server = firstRunServer({ github });
    const state = await stateFrom(await askForManifest(server));
    await prisma.githubAppConfig.deleteMany();

    for (const query of ['code=the-code', `code=the-code&state=${state}x`, `state=${state}`]) {
      const res = await callback(server, query);
      expect(res.status, query).toBe(400);
      expect(await errorOf(res)).toEqual({ code: 'validation_error', message: 'This setup link expired or was changed. Start again at /first-run.' });
    }
    expect(fetch.calls).toHaveLength(0);
    expect(await prisma.githubAppConfig.count()).toBe(0);

    // A state works once.
    expect((await callback(server, `code=the-code&state=${state}`)).status).toBe(302);
    await prisma.githubAppConfig.deleteMany();
    expect((await callback(server, `code=the-code&state=${state}`)).status).toBe(400);
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });

  it('refuses a state older than an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = firstRunServer();
    const state = await stateFrom(await askForManifest(server));
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expect((await callback(server, `code=the-code&state=${state}`)).status).toBe(400);
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });

  it('refuses a second app with 409 and keeps the first (two tabs, one finished)', async () => {
    const server = firstRunServer();
    const first = await stateFrom(await askForManifest(server));
    const second = await stateFrom(await askForManifest(server));
    expect((await callback(server, `code=the-code&state=${first}`)).status).toBe(302);

    const res = await callback(server, `code=the-code&state=${second}`);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('conflict');
    expect(await prisma.githubAppConfig.count()).toBe(1);
  });

  it('answers 502 and stores nothing when GitHub fails', async () => {
    const server = firstRunServer({ github: fakeGithub(() => json({ message: 'Server Error' }, 500)).github });
    const res = await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('github_unavailable');
    expect(await prisma.githubAppConfig.count()).toBe(0);
    expect(server.exit).not.toHaveBeenCalled();
  });

  it("answers 400 when GitHub doesn't know the code (it lasts an hour)", async () => {
    const server = firstRunServer({ github: fakeGithub(() => json({ message: 'Not Found' }, 404)).github });
    const res = await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toBe("GitHub didn't accept this setup link; it lasts an hour. Start again at /first-run.");
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });

  it('never stores an app with a secret missing', async () => {
    for (const missing of ['pem', 'webhook_secret', 'client_secret'] as const) {
      const server = firstRunServer({ github: fakeGithub(() => ({ ...CONVERSION, [missing]: null })).github });
      const res = await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
      expect(res.status, missing).toBe(502);
      expect(await prisma.githubAppConfig.count()).toBe(0);
    }
  });
});

describe('the first-run routes once the server has its app', () => {
  it('say the server is ready, and where to install the app', async () => {
    const res = await testApp().request('/api/first-run');
    expect(res.status).toBe(200);
    // TEST_ENV's app is nitpilot-dev.
    expect(await res.json()).toEqual({ mode: 'ready', installUrl: 'https://github.com/apps/nitpilot-dev/installations/new' });
  });

  it('refuse to make another app with a JSON 404, not the web app', async () => {
    const app = testApp();
    const manifest = await app.request('/api/first-run/manifest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REQUEST) });
    const back = await app.request('/first-run/callback?code=the-code&state=s');
    for (const res of [manifest, back]) {
      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe('not_found');
    }
    expect(await prisma.githubAppConfig.count()).toBe(0);
  });
});
```

`app.test.ts` gets four tests for `createFirstRunApp`: every other server path, any method, answers 503; `/healthz` still answers; the web app's pages are served with `form-action` allowing GitHub; a normal server's pages keep `form-action 'self'`. In `apps/server/src/http/app.test.ts`:

```diff
--- a/apps/server/src/http/app.test.ts
+++ b/apps/server/src/http/app.test.ts
@@ -1,8 +1,12 @@
+import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import path from 'node:path';
 import { Hono } from 'hono';
-import { describe, expect, it } from 'vitest';
+import { afterAll, describe, expect, it, vi } from 'vitest';
 import { z } from 'zod';
 import { fakeFetch } from '../../test/fake-fetch';
 import { GithubClient } from '../platform/github/client';
+import { createFirstRunApp } from './app';
 import { HttpError, onError } from './errors';
 import { testApp } from '../../test/app';
 
@@ -14,6 +18,59 @@ describe('createApp', () => {
   });
 });
 
+describe('createFirstRunApp', () => {
+  // A pretend web app build, for the page itself.
+  const dist = mkdtempSync(path.join(tmpdir(), 'nitpilot-first-run-'));
+  mkdirSync(dist, { recursive: true });
+  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
+  afterAll(() => rmSync(dist, { recursive: true, force: true }));
+
+  const app = createFirstRunApp({
+    github: new GithubClient(fakeFetch({})),
+    publicUrl: 'http://localhost:8787',
+    setupCode: 'K7PX-3MQD',
+    trustProxy: false,
+    exit: vi.fn(),
+    webDistDir: dist,
+  });
+
+  it('answers every other server path, whatever the method, with 503 "finish setup"', async () => {
+    const requests: [string, string][] = [
+      ['GET', '/api/me'],
+      ['POST', '/webhooks/github'],
+      ['GET', '/auth/github/login'],
+      ['GET', '/github/setup?installation_id=1'],
+      ['DELETE', '/api/cli/token'],
+      ['GET', '/ws/cli'],
+    ];
+    for (const [method, url] of requests) {
+      const res = await app.request(url, { method });
+      expect(res.status, `${method} ${url}`).toBe(503);
+      expect(await res.json()).toEqual({ error: { code: 'first_run', message: 'Finish setup at /first-run.' } });
+    }
+  });
+
+  it('still answers the health check', async () => {
+    const res = await app.request('/healthz');
+    expect(res.status).toBe(200);
+    expect(await res.json()).toMatchObject({ ok: true });
+  });
+
+  it("serves the web app's pages, whose forms may post to GitHub", async () => {
+    for (const page of ['/first-run', '/', '/inbox']) {
+      const res = await app.request(page);
+      expect(res.status, page).toBe(200);
+      expect(await res.text()).toContain('<title>app</title>');
+      expect(res.headers.get('content-security-policy')).toContain("form-action 'self' https://github.com;");
+    }
+  });
+
+  it('keeps the normal server\'s forms to itself', async () => {
+    const res = await testApp({ webDistDir: dist }).request('/inbox');
+    expect(res.headers.get('content-security-policy')).toContain("form-action 'self';");
+  });
+});
+
 describe('onError', () => {
   const app = new Hono();
   app.onError(onError);
```

Run: `npm run test:db -w apps/server -- src/setup/first-run && npm run test:unit -w apps/server -- src/http/app.test.ts`
Expected: FAIL. In `first-run.db.test.ts` all 18 tests fail: 16 with `TypeError: createFirstRunApp is not a function`, plus the two normal-mode ones with `AssertionError: expected 404 to be 200` (for `GET /api/first-run`) and `expected 503 to be 404` (the callback fell through to the web app's "not built" 503). `app.test.ts` fails as a whole file with `TypeError: createFirstRunApp is not a function`.

- [x] **Step 15: Implement `setup/first-run.ts`**

The routes. Read the top comment first: it is the whole flow in four lines. The setup code is checked before the body is validated, so without it the route answers nothing but "no"; the attempts are counted before the code is looked at, so a wrong guess and a right one cost the same try. `state` is 32 random bytes kept in memory for an hour and good for one callback (like the `state` of "Sign in with GitHub", docs/why/oauth-pkce.md). The callback trades GitHub's code for the app (no token: the code is the proof), stores it, answers a redirect, and asks the process to exit 500 ms later so the browser gets its redirect first.

```ts
import { randomBytes } from 'node:crypto';
import { FirstRunManifestRequest, type FirstRunManifestResponse, type FirstRunStatus } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { z } from 'zod';
import { errorBody, HttpError } from '../http/errors';
import { clientAddress } from '../lib/client-address';
import { RateLimiter } from '../lib/rate-limit';
import { GithubError, type GithubClient } from '../platform/github/client';
import { githubApp, GithubAppExistsError, saveGithubApp, type GithubAppCredentials } from './credentials';
import { buildManifest, manifestFormAction } from './manifest';
import { setupCodeMatches } from './setup-code';

/** Tries at the setup code per client address per minute: enough for typos, far too few to guess 31⁸ codes. */
const CODE_TRIES_PER_MINUTE = 5;

/** How long a manifest's `state` is good for: GitHub's code in the callback lasts an hour too. */
const STATE_TTL_MS = 60 * 60_000;

/** How long the server waits after answering the callback before it exits, so the browser gets its redirect first. */
export const EXIT_DELAY_MS = 500;

const EXPIRED_LINK = 'This setup link expired or was changed. Start again at /first-run.';

export type FirstRunDeps = {
  github: GithubClient;
  publicUrl: string;
  /** The code printed in the server's log at boot (setup/boot.ts). */
  setupCode: string;
  /** Read the client's address from X-Forwarded-For, for the rate limit (docs/why/trusting-a-proxy.md). */
  trustProxy: boolean;
  /** Stops the server once the app is stored; Docker starts it again, in normal mode (setup/boot.ts). */
  exit: () => void;
  /** The clock, for tests. */
  now?: () => number;
};

/**
 * The `state` values handed out with a manifest, each good for one callback within the hour. In memory: a restart
 * forgets them, which only means starting again at /first-run. Like the `state` of "Sign in with GitHub"
 * (docs/why/oauth-pkce.md), it proves the browser coming back started here, through this server's own form.
 */
class PendingStates {
  private readonly expiresAt = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  issue(): string {
    this.forgetExpired();
    const state = randomBytes(32).toString('base64url');
    this.expiresAt.set(state, this.now() + STATE_TTL_MS);
    return state;
  }

  /** Is this a state we handed out that hasn't expired? Either way it can't be used again. */
  take(state: string): boolean {
    const expiresAt = this.expiresAt.get(state);
    this.expiresAt.delete(state);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  private forgetExpired(): void {
    const now = this.now();
    for (const [state, expiresAt] of this.expiresAt) if (expiresAt <= now) this.expiresAt.delete(state);
  }
}

/**
 * GitHub's answer to `POST /app-manifests/{code}/conversions`: the new app and its secrets. Every field we store must
 * be there; GitHub leaving one out is a failed setup, never an app stored with a blank secret.
 */
const Conversion = z.object({
  id: z.number(),
  slug: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().min(1),
  pem: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

/**
 * Trade the code GitHub sent back for the app it just created. No token: the code is the proof, it works once, and only
 * for an hour. A GitHub that doesn't answer is a 502; one that refuses the code (expired, used) is a 400.
 */
async function convertManifest(github: GithubClient, code: string): Promise<{ creds: GithubAppCredentials; ownerLogin: string }> {
  let data: unknown;
  try {
    ({ data } = await github.api('POST', `/app-manifests/${encodeURIComponent(code)}/conversions`));
  } catch (err) {
    if (err instanceof GithubError && err.status >= 400 && err.status < 500) {
      throw new HttpError('validation_error', "GitHub didn't accept this setup link; it lasts an hour. Start again at /first-run.");
    }
    console.error('[first-run] GitHub manifest conversion failed:', err);
    throw new HttpError('github_unavailable', "GitHub didn't answer. Try again in a minute.");
  }
  const parsed = Conversion.safeParse(data);
  if (!parsed.success) {
    console.error('[first-run] GitHub answered the manifest conversion without', parsed.error.issues.map((i) => i.path.join('.')).join(', '));
    throw new HttpError('github_unavailable', "GitHub's answer was missing part of the new app. Start again at /first-run.");
  }
  const app = parsed.data;
  return {
    creds: { appId: String(app.id), slug: app.slug, privateKey: app.pem, clientId: app.client_id, clientSecret: app.client_secret, webhookSecret: app.webhook_secret },
    ownerLogin: app.owner.login,
  };
}

/**
 * First-run mode's routes (spec §17 "Self-hosting", docs/why/first-run-and-app-manifests.md):
 * 1. `GET /api/first-run`: the page asks which mode the server is in.
 * 2. `POST /api/first-run/manifest`: with the setup code, the page gets a manifest and where to post it.
 * 3. The browser posts it to GitHub; GitHub creates the app and sends the browser to `GET /first-run/callback`.
 * 4. The callback trades GitHub's code for the app's credentials, stores them encrypted, and the server restarts.
 */
export function firstRunRoutes(deps: FirstRunDeps): Hono {
  const now = deps.now ?? (() => Date.now());
  const codeTries = new RateLimiter(CODE_TRIES_PER_MINUTE, 60_000, now);
  const states = new PendingStates(now);
  let exiting = false;
  const app = new Hono();

  app.get('/api/first-run', (c) => {
    const body: FirstRunStatus = { mode: 'first_run', publicUrl: deps.publicUrl };
    return c.json(body);
  });

  app.post('/api/first-run/manifest', async (c) => {
    // Counted before the code is looked at, so a wrong guess and a right one cost the same try.
    if (!codeTries.allow(clientAddress(c, deps.trustProxy))) throw new HttpError('rate_limited', 'Too many tries from here. Wait a minute and try again.');
    // The code first, before anything about the body is checked: without it, nothing here answers more than "no".
    const body: unknown = await c.req.json().catch(() => null);
    const code = (body as { code?: unknown } | null)?.code;
    if (typeof code !== 'string' || !setupCodeMatches(code, deps.setupCode)) {
      throw new HttpError('setup_code', "That code doesn't match the one in the server's log.");
    }

    const request = FirstRunManifestRequest.parse(body);
    const answer: FirstRunManifestResponse = {
      action: manifestFormAction({ webBase: deps.github.webBase, owner: request.owner, state: states.issue() }),
      manifest: buildManifest({ publicUrl: deps.publicUrl, name: request.name, isPublic: request.isPublic }),
    };
    return c.json(answer);
  });

  app.get('/first-run/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state || !states.take(state)) throw new HttpError('validation_error', EXPIRED_LINK);

    const { creds, ownerLogin } = await convertManifest(deps.github, code);
    try {
      await saveGithubApp(creds, ownerLogin);
    } catch (err) {
      if (err instanceof GithubAppExistsError) throw new HttpError('conflict', "This server already has a GitHub App. The one GitHub just made isn't used: delete it in your GitHub settings.");
      throw err;
    }

    console.log(`[first-run] created the GitHub App ${creds.slug} for ${ownerLogin}; restarting in normal mode`);
    // Only one app can be stored, so this runs once; the flag keeps it so even if that rule ever changed.
    if (!exiting) {
      exiting = true;
      setTimeout(deps.exit, EXIT_DELAY_MS);
    }
    return c.redirect('/first-run?done=1');
  });

  return app;
}

/**
 * The same three routes once the server has its app (http/app.ts createApp). The page, polling while the server
 * restarts, learns it's ready and where to install the app. The other two are a JSON 404 rather than the web app's
 * page: there is nothing left to set up, and a server with an app never makes a second one.
 */
export function readyRoutes(deps: { github: GithubClient }): Hono {
  const app = new Hono();

  app.get('/api/first-run', (c) => {
    const body: FirstRunStatus = { mode: 'ready', installUrl: `${deps.github.webBase}/apps/${githubApp().slug}/installations/new` };
    return c.json(body);
  });

  const alreadySetUp = errorBody('not_found', 'This server already has its GitHub App.');
  app.post('/api/first-run/manifest', (c) => c.json(alreadySetUp, 404));
  app.get('/first-run/callback', (c) => c.json(alreadySetUp, 404));

  return app;
}
```

Run: `npm run test:db -w apps/server -- src/setup/first-run`
Expected: still FAIL, the same 18 (the routes exist, but nothing builds an app around them yet).

- [x] **Step 16: `createFirstRunApp`, and `readyRoutes` in the normal app**

In `apps/server/src/http/app.ts`: the health answer becomes a small `health` function shared by both apps; `createApp` mounts `readyRoutes` (so `GET /api/first-run` says `ready` once the server has its app); and `createFirstRunApp` is the first-run server: the health check, the first-run routes, a 503 `first_run` for every other server path whatever the method, and the web app's pages with `form-action` allowing `deps.github.webBase`.

```diff
--- a/apps/server/src/http/app.ts
+++ b/apps/server/src/http/app.ts
@@ -1,5 +1,5 @@
 import type { HealthResponse } from '@nitpilot/protocol';
-import { Hono } from 'hono';
+import { Hono, type Context } from 'hono';
 import type { RepoAccess } from '../auth/repo-access';
 import type { LiveClis } from '../chats/activity';
 import type { Dispatch } from '../chats/dispatch';
@@ -8,6 +8,7 @@ import { getEnv } from '../lib/env';
 import type { AppAuth } from '../platform/github/app-auth';
 import type { GithubClient } from '../platform/github/client';
 import type { PlatformReads } from '../platform/types';
+import { firstRunRoutes, readyRoutes, type FirstRunDeps } from '../setup/first-run';
 import type { MeUpdates } from '../ws/web-wire';
 import { SERVER_VERSION } from '../version';
 import { errorBody, onError } from './errors';
@@ -25,7 +26,7 @@ import { pushRoutes } from './routes/push';
 import { settingsRoutes, type SettingsSender } from './routes/settings';
 import { setupRoutes } from './routes/setup';
 import { webhookRoutes } from './routes/webhooks';
-import { DEFAULT_WEB_DIST, spaRoutes } from './spa';
+import { DEFAULT_WEB_DIST, isServerPath, spaRoutes } from './spa';
 
 /** What the HTTP layer needs from outside. Tests pass fakes. Later tasks add fields. */
 export type AppDeps = {
@@ -51,14 +52,18 @@ export type AppDeps = {
   webDistDir?: string;
 };
 
+/** `GET /healthz`: Docker's HEALTHCHECK and uptime checks ask it, in both modes. */
+function health(c: Context): Response {
+  const body: HealthResponse = { ok: true, version: SERVER_VERSION };
+  return c.json(body);
+}
+
 export function createApp(deps: AppDeps): Hono {
   const env = getEnv();
   const app = new Hono();
   app.onError(onError);
-  app.get('/healthz', (c) => {
-    const body: HealthResponse = { ok: true, version: SERVER_VERSION };
-    return c.json(body);
-  });
+  app.get('/healthz', health);
+  app.route('/', readyRoutes(deps));
   app.route('/', authRoutes(deps));
   app.route('/', meRoutes(deps));
   app.route('/', settingsRoutes(deps));
@@ -78,3 +83,24 @@ export function createApp(deps: AppDeps): Hono {
   app.notFound((c) => c.json(errorBody('not_found', 'no such route'), 404));
   return app;
 }
+
+/**
+ * The server in first-run mode (setup/boot.ts): it has no GitHub App yet, so it serves only what creating one needs,
+ * the health check, the first-run routes and the web app (whose /first-run page does the asking). Every other server
+ * path, whatever the method, is a 503 that says where to go: no sign-in, webhook or API call can work without an app.
+ * Forms on the page may post to GitHub: the manifest goes there as a form (http/spa.ts contentSecurityPolicy).
+ */
+export function createFirstRunApp(deps: FirstRunDeps & { webDistDir?: string }): Hono {
+  const env = getEnv();
+  const app = new Hono();
+  app.onError(onError);
+  app.get('/healthz', health);
+  app.route('/', firstRunRoutes(deps));
+  app.all('*', async (c, next) => {
+    if (!isServerPath(c.req.path)) return next();
+    return c.json(errorBody('first_run', 'Finish setup at /first-run.'), 503);
+  });
+  app.route('/', spaRoutes({ distDir: deps.webDistDir ?? env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST, publicUrl: deps.publicUrl, formActions: [deps.github.webBase] }));
+  app.notFound((c) => c.json(errorBody('not_found', 'no such route'), 404));
+  return app;
+}
```

Run: `npm run test:db -w apps/server -- src/setup/first-run && npm run test:unit -w apps/server -- src/http/app.test.ts`
Expected: PASS (18 tests in `first-run.db.test.ts`; 8 in `app.test.ts`).

- [x] **Step 17: The boot seam: write `boot.test.ts`, see it fail, implement `boot.ts`**

`startFirstRun` is the small piece `main.ts` calls in first-run mode: it makes a setup code, prints where to go and the code (so only someone who can read the server's log, `docker compose logs nitpilot`, can create the app), and returns the first-run app. Create `apps/server/src/setup/boot.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fakeFetch } from '../../test/fake-fetch';
import { getEnv } from '../lib/env';
import { GithubClient } from '../platform/github/client';
import { startFirstRun } from './boot';

function start() {
  const lines: string[] = [];
  const exit = vi.fn();
  const { app } = startFirstRun({ env: getEnv(), github: new GithubClient(fakeFetch({})), exit, log: (line) => lines.push(line) });
  return { app, lines, exit };
}

describe('startFirstRun', () => {
  it('prints where to go and a fresh setup code in the log', () => {
    const { lines } = start();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[first-run\] Open http:\/\/localhost:8787\/first-run and enter the setup code: [A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(start().lines[0]).not.toBe(lines[0]);
  });

  it('serves the first-run app, which takes the code it printed', async () => {
    const { app, lines } = start();
    const code = lines[0]!.split(': ')[1];
    const res = await app.request('/api/first-run/manifest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, owner: { kind: 'user' }, name: 'Nitpilot', isPublic: false }),
    });
    expect(res.status).toBe(200);
    expect((await app.request('/api/me')).status).toBe(503);
  });
});
```

Run: `npm run test:unit -w apps/server -- src/setup/boot.test.ts`
Expected: FAIL: `Error: Cannot find module './boot'` (no tests run).

Create `apps/server/src/setup/boot.ts`:

```ts
import type { Hono } from 'hono';
import { createFirstRunApp } from '../http/app';
import type { Env } from '../lib/env';
import type { GithubClient } from '../platform/github/client';
import { makeSetupCode } from './setup-code';

/**
 * Get a server with no GitHub App ready for its first run (main.ts serves the app this returns): make a setup code and
 * print it, so only someone who can read the server's log (`docker compose logs nitpilot`) can create the app.
 * `exit` runs once the app is stored. See docs/why/first-run-and-app-manifests.md.
 */
export function startFirstRun(opts: { env: Env; github: GithubClient; exit: () => void; log?: (line: string) => void }): { app: Hono } {
  const log = opts.log ?? console.log;
  const publicUrl = opts.env.PUBLIC_URL.replace(/\/+$/, '');
  const setupCode = makeSetupCode();
  log(`[first-run] Open ${publicUrl}/first-run and enter the setup code: ${setupCode}`);
  const app = createFirstRunApp({ github: opts.github, publicUrl, setupCode, trustProxy: opts.env.TRUST_PROXY, exit: opts.exit });
  return { app };
}
```

Run: `npm run test:unit -w apps/server -- src/setup/boot.test.ts`
Expected: PASS (2 tests).

- [x] **Step 18: `main.ts` picks the mode**

No unit test: `main()` starts a real server, so this is checked by the live run in Step 20 (and, from Task 5, the image smoke test starts the server with all six variables set, which is the normal-mode branch). `main` now asks `loadGithubApp` which app it is. With none it runs first-run mode: no task runner, hubs or recovery (none can work without an app), WebSocket upgrades get a 404 (`routeUpgrades(server, {})`), and on SIGINT/SIGTERM or after the app is stored it closes the server, releases the lock and exits 0 (nothing went wrong; Docker's `restart: unless-stopped` starts it again). With an app, everything that was `main` becomes `runNormally`, which builds `AppAuth` from the credentials it is handed.

```diff
--- a/apps/server/src/main.ts
+++ b/apps/server/src/main.ts
@@ -12,11 +12,13 @@ import { createDeliveryHandler } from './ingest/handle';
 import { createIngest } from './ingest/process';
 import { purgeClosedChats, purgeOldRows } from './ingest/record';
 import { recoverOnBoot } from './ingest/recovery';
-import { acquireSingletonLock } from './lib/advisory-lock';
-import { getEnv, vapidDetails } from './lib/env';
+import { acquireSingletonLock, type SingletonLock } from './lib/advisory-lock';
+import { getEnv, vapidDetails, type Env } from './lib/env';
 import { AppAuth } from './platform/github/app-auth';
 import { GithubClient } from './platform/github/client';
 import { GithubPlatform } from './platform/github/platform';
+import { startFirstRun } from './setup/boot';
+import { loadGithubApp, setGithubApp, type GithubAppCredentials } from './setup/credentials';
 import { CliNotifier } from './tasks/cli-notifier';
 import { reportFailedWrite } from './tasks/handlers/failed-writes';
 import { createTaskHandlers } from './tasks/handlers/index';
@@ -44,9 +46,46 @@ async function main(): Promise<void> {
     process.exit(1);
   }
 
+  // Which GitHub App this server is: the GITHUB_* variables, else the one first-run mode stored, else none yet.
+  // A stored app this ENCRYPTION_KEY can't read throws here, and the server refuses to start (setup/credentials.ts).
+  const loaded = await loadGithubApp(env);
+  if (!loaded) return runFirstRun(env, lock);
+  setGithubApp(loaded.creds);
+  console.log(`[boot] GitHub App ${loaded.creds.slug}, from the ${loaded.source === 'env' ? 'GITHUB_* variables' : 'database'}`);
+  await runNormally(env, lock, loaded.creds);
+}
+
+/**
+ * First-run mode (spec §17 "Self-hosting", docs/why/first-run-and-app-manifests.md): no GitHub App yet, so serve only
+ * the page that creates one. No task runner, hubs or recovery: none of them can work without an app. Once the app is
+ * stored the process exits with 0, and Docker (`restart: unless-stopped`) starts it again, in normal mode this time.
+ */
+function runFirstRun(env: Env, lock: SingletonLock): void {
+  // After the app is stored, and on SIGTERM. Exit code 0 either way: nothing went wrong. (`server` is made just below,
+  // long before either can happen.)
+  const exit = async () => {
+    server.close();
+    try {
+      await lock.release();
+    } finally {
+      process.exit(0);
+    }
+  };
+  const { app } = startFirstRun({ env, github: new GithubClient(), exit: () => void exit() });
+  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
+    console.log(`Nitpilot server listening on http://localhost:${info.port}, in first-run mode`);
+  }) as Server;
+  // No hub yet: every WebSocket upgrade gets a 404.
+  routeUpgrades(server, {});
+  process.on('SIGINT', exit);
+  process.on('SIGTERM', exit);
+}
+
+/** The server with its GitHub App: webhooks in, jobs out to the CLIs, the web app. */
+async function runNormally(env: Env, lock: SingletonLock, creds: GithubAppCredentials): Promise<void> {
   // The outside world.
   const github = new GithubClient();
-  const appAuth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
+  const appAuth = new AppAuth(github, creds.appId, creds.privateKey);
   const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
   // CLIs connect over a WebSocket and get their jobs and notifications through it (spec §10, docs/why/websockets.md).
   const hub = new CliHub();
```

- [x] **Step 19: `.env.example` and the dev tunnel**

`.env.example` says the six are all or none. The reference build also emptied `GITHUB_APP_SLUG=nitpilot-dev`: with only the slug filled, a copied file would now refuse to start as half set. `scripts/dev-tunnel.ts` read the six variables straight from `getEnv()`; it now builds the credentials with `credentialsFromEnv` and exits with a message if the dev app isn't in `.env`.

```diff
--- a/apps/server/.env.example
+++ b/apps/server/.env.example
@@ -4,12 +4,15 @@ PORT=8787
 # Where people reach Nitpilot. In development that's Vite (npm run dev -w apps/web), which passes the
 # server's paths on to port 8787 (docs/why/serving-a-spa.md); with the dev tunnel it's the tunnel URL.
 PUBLIC_URL=http://localhost:5173
-# openssl rand -base64 32
+# openssl rand -base64 32. Keep a copy: it also encrypts a GitHub App made in first-run mode, which no other key can read.
 ENCRYPTION_KEY=
 
-# From your dev GitHub App "nitpilot-dev" (Settings → Developer settings → GitHub Apps)
+# The GitHub App: all six, or none. From your dev GitHub App "nitpilot-dev" (Settings → Developer settings →
+# GitHub Apps; its slug is nitpilot-dev). Leave all six empty and the server starts in first-run mode instead: it
+# prints a setup code in its log and creates its own app at PUBLIC_URL/first-run (docs/why/first-run-and-app-manifests.md).
+# Set here, they win over an app first-run mode stored.
 GITHUB_APP_ID=
-GITHUB_APP_SLUG=nitpilot-dev
+GITHUB_APP_SLUG=
 # The app's private key; paste it on one line with \n for the line breaks
 GITHUB_APP_PRIVATE_KEY=
 GITHUB_CLIENT_ID=
```

```diff
--- a/apps/server/scripts/dev-tunnel.ts
+++ b/apps/server/scripts/dev-tunnel.ts
@@ -3,14 +3,25 @@ import { spawn } from 'node:child_process';
 import { getEnv } from '../src/lib/env';
 import { AppAuth } from '../src/platform/github/app-auth';
 import { GithubClient } from '../src/platform/github/client';
+import { credentialsFromEnv, type GithubAppCredentials } from '../src/setup/credentials';
 
 // Expose the local server through a free Cloudflare quick tunnel (no account needed) and point the
 // GitHub App's webhook URL at it (spec §17). Requests arrive byte for byte, so the HMAC check runs
 // exactly as in production. Needs `cloudflared` (macOS: brew install cloudflared).
 
 const env = getEnv();
+
+/** The dev app's six GITHUB_* variables, from .env: the tunnel repoints that app's webhook. */
+function devApp(): GithubAppCredentials {
+  const app = credentialsFromEnv(env);
+  if (app) return app;
+  console.error('dev:tunnel needs the dev GitHub App in apps/server/.env (the six GITHUB_* variables).');
+  process.exit(1);
+}
+
+const app = devApp();
 const github = new GithubClient();
-const auth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
+const auth = new AppAuth(github, app.appId, app.privateKey);
 const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${env.PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
 
 let pointed = false;
@@ -20,8 +31,8 @@ async function onOutput(chunk: Buffer): Promise<void> {
   if (!match || pointed) return;
   pointed = true;
   const url = `${match[0]}/webhooks/github`;
-  await github.api('PATCH', '/app/hook/config', { token: auth.jwt(), body: { url, content_type: 'json', secret: env.GITHUB_WEBHOOK_SECRET } });
-  console.log(`\n✓ ${env.GITHUB_APP_SLUG} now sends webhooks to ${url}\n  Leave this running. Ctrl-C stops the tunnel.\n`);
+  await github.api('PATCH', '/app/hook/config', { token: auth.jwt(), body: { url, content_type: 'json', secret: app.webhookSecret } });
+  console.log(`\n✓ ${app.slug} now sends webhooks to ${url}\n  Leave this running. Ctrl-C stops the tunnel.\n`);
 }
 
 tunnel.stdout.on('data', (c: Buffer) => void onOutput(c).catch((err) => console.error(err)));
```

Run: `npm run typecheck -w apps/server`
Expected: no errors (the failures Step 4 predicted are gone).

- [x] **Step 20: Try it for real (no GitHub involved)**

Start the server with the six `GITHUB_*` values emptied on the command line (real environment variables win over `.env`, and empty counts as not set), on a spare port, from the repo root:

```bash
GITHUB_APP_ID= GITHUB_APP_SLUG= GITHUB_APP_PRIVATE_KEY= GITHUB_CLIENT_ID= GITHUB_CLIENT_SECRET= GITHUB_WEBHOOK_SECRET= PORT=8899 PUBLIC_URL=http://localhost:8899 npm start -w apps/server
```

Expected in its log: `[first-run] Open http://localhost:8899/first-run and enter the setup code: XXXX-XXXX` (a different code each start) and `Nitpilot server listening on http://localhost:8899, in first-run mode`. In a second terminal:

```bash
curl -s localhost:8899/api/first-run; echo; curl -s localhost:8899/api/me; echo; curl -s localhost:8899/healthz; echo
```

Expected:
```
{"mode":"first_run","publicUrl":"http://localhost:8899"}
{"error":{"code":"first_run","message":"Finish setup at /first-run."}}
{"ok":true,"version":"0.1.0"}
```

Stop the server with Ctrl-C in the first terminal: it exits cleanly (code 0). (Reaching GitHub's "Create GitHub App" page needs Task 8's page; the callback is covered by the tests above.)

- [x] **Step 21: The explainer, the spec and the policy table**

`docs/why/first-run-and-app-manifests.md` (new; the setup wizard comparison, what a manifest is, the setup code, why the server restarts itself):

```markdown
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

The callback is a plain URL that anyone can open. `state` is 32 random bytes the server handed out with the manifest, kept in memory for an hour, and good for one callback. A callback with a missing, wrong, expired or already used `state` is refused and nothing is stored. So the only way to reach step 5 is to have started at step 2, with the setup code. It's the same idea as the `state` in "Sign in with GitHub" (docs/why/oauth-pkce.md).

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
```

Spec §8 gets the `GithubAppConfig` row, and §10 the "First-run mode" block (the shapes as built: errors in the house `{ error: { code, message } }` shape):

```diff
--- a/docs/superpowers/specs/2026-10-07-nitpilot-design.md
+++ b/docs/superpowers/specs/2026-10-07-nitpilot-design.md
@@ -169,6 +169,7 @@ Prisma 7 conventions are copied from Odyhook: `cuid()` ids, `createdAt`/`updated
 | `GithubWrite` | Everything Nitpilot wrote to GitHub | chatId, kind `summary\|review\|review_comment\|reply`, githubId (unique per kind) | Used to edit those writes and to ignore our own events |
 | `PushSubscription` (Plan 2) | A Web Push endpoint (one browser or device) | userId, endpoint (unique), p256dh, auth, label, failCount | `label` names the browser for the Settings page ("Chrome on macOS"). A push service answering 404 or 410 means the subscription is gone: the row is deleted. Other answers from the push service add to `failCount` (a send that got no answer at all, such as a timeout or a network error, doesn't: that is usually the server's own side), a success sets it back to 0, and the fifth failed answer in a row deletes the row. One row per endpoint: subscribing again with the same endpoint updates it, and moves it to whoever is signed in |
 | `ChatRead` (Plan 2) | How far a person has read a chat | userId + chatId (unique), lastReadSeq | The inbox's unread count is the number of timeline items after `lastReadSeq` that someone else wrote |
+| `GithubAppConfig` (Plan 3) | The GitHub App a self-hosted server created for itself in first-run mode (§17) | id (always `app`), appId, slug, clientId, privateKeyEnc, clientSecretEnc, webhookSecretEnc, ownerLogin | At most one row, insert-only: a second one is refused, never overwritten. The private key and both secrets are encrypted with AES-256-GCM under `ENCRYPTION_KEY`; a row that key can't decrypt stops the server at boot instead of starting first-run mode again. The `GITHUB_*` variables, when set, win over it |
 
 - **Severity:** `blocker | major | minor | nit`.
 - **Category:** `security | bug | performance | design | tests | style | docs | other`.
@@ -307,6 +308,13 @@ The message envelope is `{ v: 1, t: "<type>", id?, re?, d: {…} }`, a zod discr
 - Onboarding: `GET /api/onboarding` answers `{steps: {appInstalled, cliConnected, repoLinked, agentStarted}, done, deviceName, appSlug, publicReposOnly}`, session cookie only (a CLI token is a 401). It's a read of its own, not part of `/api/me`, because "app installed" asks GitHub (`GET /user/installations` with the person's own token) and `/api/me` is the app's first request. `cliConnected`: an unrevoked CLI token; `repoLinked` / `agentStarted`: an unrevoked token whose last hello reported a linked repo / an agent with a mode; `deviceName`: the newest unrevoked token's name. GitHub's yes is kept 5 minutes per person, a no isn't kept, and a GitHub failure counts as no (logged, never failing the read). The first read where all four hold sets `User.onboardedAt`; from then on every step reads true without asking GitHub.
 - CLI approval, for the web app's approve screen: `GET /api/cli/requests/:userCode` and `POST /api/cli/requests/:userCode {decision: approve|deny}`. They replace Plan 1's server-rendered form; the page stays at `/cli/approve?code=`, so the CLI's link is unchanged. Both answer `{userCode, deviceName, requestedAt, expiresAt, status: pending|approved|denied|expired}`: a pending login past `expiresAt` reads `expired`, one the CLI already collected (`consumed`) reads `approved`. The code is matched trimmed and upper-cased; an unknown code is a 404. Both take the session cookie only (a CLI token is a 401), and the POST has the Origin check. A POST on a login that is no longer pending (decided already, or expired) changes nothing and answers 200 with how it stands, so a double click or a stale tab just shows the result. The page counts down to `expiresAt` and shows Expired at zero without asking the server; signed out, it sends you through `/auth/github/login?next=` first.
 
+**First-run mode (Plan 3, §17 "Self-hosting")**, a server with no GitHub App in the environment or the database:
+- `GET /api/first-run` answers `{mode: 'first_run', publicUrl}`.
+- `POST /api/first-run/manifest {code, owner: {kind: 'user'} | {kind: 'org', login}, name, isPublic}` answers `{action, manifest}`: the manifest (§15's events and permissions, every URL built from `PUBLIC_URL`) and where the page posts it as a form (`https://github.com/settings/apps/new?state=…`, or `/organizations/<login>/settings/apps/new?state=…`). `state` is 32 random bytes, kept in memory for an hour and good for one callback. Each client address gets 5 tries a minute (the 6th is a 429 `rate_limited`, counted before the code is looked at); a wrong or missing setup code is a 403 `setup_code`, before the rest of the body is checked; `name` is 1 to 34 characters.
+- `GET /first-run/callback?code&state` (GitHub sends the browser here): a missing, unknown, expired or used `state` is a 400 and nothing is stored. Then `POST /app-manifests/{code}/conversions` (no token); GitHub refusing the code is a 400, GitHub failing or leaving out a secret is a 502 `github_unavailable`. The app is stored encrypted (§8 `GithubAppConfig`); one already there is a 409. Then a redirect to `/first-run?done=1`, and the process exits with 0 half a second later; Docker starts it again in normal mode.
+- Everything else under the server's paths (`/api/*`, `/auth/*`, `/github/*`, `/webhooks/*`, `/ws/*`, any method) answers 503 `{error: {code: 'first_run', message: 'Finish setup at /first-run.'}}`; `/healthz` still answers, and the web app's pages are still served, with `form-action` also allowing GitHub. WebSocket upgrades get a 404.
+- With an app, `GET /api/first-run` answers `{mode: 'ready', installUrl: 'https://github.com/apps/<slug>/installations/new'}`, and the other two are a JSON 404.
+
 **REST endpoints in Plan 1**
 - Webhooks: `POST /webhooks/github`
 - GitHub sign-in: `GET /auth/github/login`, `GET /auth/github/callback` (PKCE S256), `POST /auth/logout`. A sign-in that came in on another address than `PUBLIC_URL` (another host, or plain http as the proxy's `X-Forwarded-Proto` reports it) is first redirected to `PUBLIC_URL`'s `/auth/github/login`, keeping `next`: GitHub always returns to `PUBLIC_URL`, so the OAuth cookie must be set there.
```

And `docs/why/content-security-policy.md`'s `form-action` row names the one exception:

```diff
--- a/docs/why/content-security-policy.md
+++ b/docs/why/content-security-policy.md
@@ -18,7 +18,7 @@ Nitpilot shows text written by AI agents and by other people: point titles, repl
 | `style-src 'self' 'unsafe-inline'` | Our own CSS files, plus `style="…"` attributes written in HTML or set as an attribute, and `<style>` elements. | Kept so a library that writes style attributes or `<style>` tags still works. React's own `style={{ … }}` goes through the DOM's style object, which the policy doesn't restrict. |
 | `font-src 'self'` | Fonts from our own files only. | No `data:` fonts (see the Vite example below). |
 | `base-uri 'self'` | A page can't change what relative URLs resolve against with a `<base>` tag. | Closes a trick for redirecting our own relative links. |
-| `form-action 'self'` | Forms post only to us. | A form injected into the page can't send data elsewhere. |
+| `form-action 'self'` | Forms post only to us. In first-run mode, also to GitHub (`https://github.com`). | A form injected into the page can't send data elsewhere. The one exception is first-run mode, whose page posts the app manifest to GitHub as a real form (`createFirstRunApp` in `http/app.ts`, docs/why/first-run-and-app-manifests.md); a server with its app never allows it. |
 | `frame-ancestors 'none'` | No other site may show our pages in a frame. | Clickjacking: another site could load one of our pages in an invisible frame and trick you into clicking a button on it, such as "Approve" on the CLI approval page. |
 
 ## Why styles may be inline but scripts may not
```

- [x] **Step 22: Full suite, tick, ledger, commit**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e`
Expected: protocol 88, CLI 349 + 14 skipped, server 1106 (47 more than before: env 2, setup-code 6, manifest 4, credentials 9, spa 2, first-run routes 18, first-run app 4, boot 2), web 344, root 6, e2e 6, typecheck and lint clean.

Tick this task's boxes, append `Task 7: complete` (plus any `Ruling:` lines) to the ledger, then:

```bash
git add apps/server/.env.example apps/server/prisma/schema.prisma apps/server/prisma/migrations apps/server/scripts/dev-tunnel.ts apps/server/src/auth/onboarding.ts apps/server/src/auth/user-tokens.ts apps/server/src/http/app.ts apps/server/src/http/app.test.ts apps/server/src/http/errors.ts apps/server/src/http/routes/auth.ts apps/server/src/http/routes/webhooks.ts apps/server/src/http/spa.ts apps/server/src/http/spa.test.ts apps/server/src/lib/env.ts apps/server/src/lib/env.test.ts apps/server/src/main.ts apps/server/src/setup apps/server/test/db.ts apps/server/test/webhooks.ts packages/protocol/src/web-api.ts packages/protocol/src/web-api.test.ts docs/superpowers/specs/2026-10-07-nitpilot-design.md docs/why/first-run-and-app-manifests.md docs/why/content-security-policy.md docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
git commit -m "feat(server): first-run mode: a fresh server creates its own GitHub App

With no GITHUB_* variables and no stored app, the server starts in first-run
mode: it prints a setup code, serves /first-run's API (manifest, callback),
stores the new app encrypted in GithubAppConfig and exits for Docker to
restart it in normal mode. Everything else answers 503 first_run. The six
GITHUB_* variables are now all-or-none and still win; every reader goes
through githubApp().

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The first-run page

**Files:**
- Create: `apps/web/src/routes/FirstRun/{FirstRun.tsx,FirstRun.module.css,FirstRun.test.tsx}`, `apps/web/src/api/first-run.ts`, `apps/web/src/components/FirstRunNeeded/{FirstRunNeeded.tsx,FirstRunNeeded.module.css}`, `apps/web/e2e/first-run.spec.ts`, `apps/server/test/e2e/first-run-server.ts`
- Modify: `apps/server/src/setup/first-run.ts` (+ `first-run.db.test.ts`), `apps/server/package.json`, `packages/protocol/src/web-api.ts`, `apps/web/src/api/client.ts` (+ test), `apps/web/src/lib/browser.ts`, `apps/web/src/app.tsx`, `apps/web/src/routes/Home/Home.tsx` (+ test), `apps/web/src/routes/Approve/Approve.tsx` (+ test), `apps/web/e2e/ports.ts`, `apps/web/playwright.config.ts`, spec §10, `docs/why/first-run-and-app-manifests.md`, `docs/why/end-to-end-test.md`

**Interfaces:**
- Consumes: Task 7's routes: `GET /api/first-run` → `FirstRunStatus` (`{ mode: 'first_run', publicUrl }` or `{ mode: 'ready', installUrl }`), `POST /api/first-run/manifest` → `FirstRunManifestResponse` (`{ action, manifest }`; 403 `setup_code`, 429 `rate_limited`, 400 `validation_error` with `details.issues`), `GET /first-run/callback`, and the 503 `{ error: { code: 'first_run', message } }` every other API answers. Also `createFirstRunApp`'s CSP (`form-action` also allows GitHub's origin) and `readyRoutes`.
- Produces (server): `GET /first-run/callback` no longer answers JSON errors. Every failure is a `302` to `/first-run?error=<problem>`, nothing stored, the process kept running. `expired`: the `state` is missing, unknown, used or over an hour old, or GitHub refused the code (4xx). `github`: GitHub didn't answer (5xx, network) or left a secret out. `exists`: the server already has its app (two tabs, or a browser GitHub sends back after the restart). Unexpected errors (the database is down) stay a JSON 500.
- Produces (protocol): `FirstRunProblem = z.enum(['expired', 'github', 'exists'])`.
- Produces (web): `ApiError.details`, `isFirstRunMode(error)` (503 with code `first_run`), `retryUnlessClientError` doesn't retry that 503, `browser.submit(form)`, `useFirstRunStatus()`, `useRestartedServer()` (polls every `RESTART_POLL_MS` = 2 s), `useManifest()`, `<FirstRunNeeded message />` (what `Home` and `Approve` show instead of the app or GitHub sign-in while `/api/me` answers 503 `first_run`), and the lazy route `/first-run`, a page of its own like device approval (no Home, no inbox, no `/api/me`).
- Produces (e2e): a second Playwright server in first-run mode (`first-run-server.ts`, web port 4321, control and stand-in-GitHub port 4322, its own database `<test database>_first_run_test`), started next to the shared one.

**Why a form post and not `fetch`:** GitHub's "create an app from a manifest" page takes a normal browser form post (the page it lands on asks the person to review and confirm). A `fetch` would get the page's HTML back into JavaScript, where the person can't see it. So the page builds a `<form method="post" action=…>` with one hidden `manifest` field and submits it, which makes the browser itself navigate to GitHub. The server's content security policy has a `form-action` rule (which origins a form may post to) that first-run mode widens by exactly GitHub's origin. The callback is the other half: GitHub sends the browser to `/first-run/callback?code&state` as a page load, so a JSON error there would be a blank tab with `{"error":…}` in it. That is why its failures become redirects back to the page, which can say what happened (docs/why/first-run-and-app-manifests.md, updated in Step 18).

**Order:** the server's change first (the page needs to know the three `?error=` values), then the api client, the small "first run needed" screen, the page itself, the Playwright server and spec, the docs, and the checks.

- [x] **Step 1: The callback's failures become redirects: tests first**

Replace `apps/server/src/setup/first-run.db.test.ts`'s expectations. The change to the file (an `expectBackOnThePage` helper; each test that expected a JSON 400, 409 or 502 on the callback now expects a 302 to `/first-run?error=…`; the "ready server" test now has two parts):

```diff
--- a/apps/server/src/setup/first-run.db.test.ts
+++ b/apps/server/src/setup/first-run.db.test.ts
@@ -1,4 +1,4 @@
-import type { FirstRunManifestResponse } from '@nitpilot/protocol';
+import type { FirstRunManifestResponse, FirstRunProblem } from '@nitpilot/protocol';
 import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import { testApp } from '../../test/app';
 import { fakeFetch, json, type FakeRequest } from '../../test/fake-fetch';
@@ -65,6 +65,12 @@ function callback(server: Server, query: string) {
 
 const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
 
+/** The callback is a browser navigation, so a failure sends the browser back to the page, which says what happened. */
+function expectBackOnThePage(res: Response, problem: FirstRunProblem, why = '') {
+  expect(res.status, why).toBe(302);
+  expect(res.headers.get('location'), why).toBe(`/first-run?error=${problem}`);
+}
+
 beforeEach(async () => {
   await prisma.githubAppConfig.deleteMany();
 });
@@ -109,7 +115,7 @@ describe('POST /api/first-run/manifest', () => {
       expect(await errorOf(res)).toEqual({ code: 'setup_code', message: "That code doesn't match the one in the server's log." });
     }
     // No state was handed out, so no callback can succeed.
-    expect((await callback(server, 'code=the-code&state=anything')).status).toBe(400);
+    expectBackOnThePage(await callback(server, 'code=the-code&state=anything'), 'expired');
   });
 
   it('checks the rest of the request once the code is right', async () => {
@@ -180,71 +186,64 @@ describe('GET /first-run/callback', () => {
     }
   });
 
-  it('refuses a missing, unknown or reused state, stores nothing and asks GitHub nothing', async () => {
+  it('sends a missing, unknown or reused state back to the page as expired, stores nothing and asks GitHub nothing', async () => {
     const { fetch, github } = fakeGithub();
     const server = firstRunServer({ github });
     const state = await stateFrom(await askForManifest(server));
-    await prisma.githubAppConfig.deleteMany();
 
     for (const query of ['code=the-code', `code=the-code&state=${state}x`, `state=${state}`]) {
-      const res = await callback(server, query);
-      expect(res.status, query).toBe(400);
-      expect(await errorOf(res)).toEqual({ code: 'validation_error', message: 'This setup link expired or was changed. Start again at /first-run.' });
+      expectBackOnThePage(await callback(server, query), 'expired', query);
     }
     expect(fetch.calls).toHaveLength(0);
     expect(await prisma.githubAppConfig.count()).toBe(0);
 
     // A state works once.
-    expect((await callback(server, `code=the-code&state=${state}`)).status).toBe(302);
+    expect((await callback(server, `code=the-code&state=${state}`)).headers.get('location')).toBe('/first-run?done=1');
     await prisma.githubAppConfig.deleteMany();
-    expect((await callback(server, `code=the-code&state=${state}`)).status).toBe(400);
+    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'expired');
     expect(await prisma.githubAppConfig.count()).toBe(0);
   });
 
-  it('refuses a state older than an hour', async () => {
+  it('sends a state older than an hour back to the page as expired', async () => {
     vi.useFakeTimers({ toFake: ['Date'] });
     const server = firstRunServer();
     const state = await stateFrom(await askForManifest(server));
     vi.advanceTimersByTime(60 * 60_000 + 1);
-    expect((await callback(server, `code=the-code&state=${state}`)).status).toBe(400);
+    expectBackOnThePage(await callback(server, `code=the-code&state=${state}`), 'expired');
     expect(await prisma.githubAppConfig.count()).toBe(0);
   });
 
-  it('refuses a second app with 409 and keeps the first (two tabs, one finished)', async () => {
+  it('keeps the first app when a second comes back (two tabs, one finished), and says the new one is extra', async () => {
     const server = firstRunServer();
     const first = await stateFrom(await askForManifest(server));
     const second = await stateFrom(await askForManifest(server));
-    expect((await callback(server, `code=the-code&state=${first}`)).status).toBe(302);
+    expect((await callback(server, `code=the-code&state=${first}`)).headers.get('location')).toBe('/first-run?done=1');
 
-    const res = await callback(server, `code=the-code&state=${second}`);
-    expect(res.status).toBe(409);
-    expect((await errorOf(res)).code).toBe('conflict');
-    expect(await prisma.githubAppConfig.count()).toBe(1);
+    expectBackOnThePage(await callback(server, `code=the-code&state=${second}`), 'exists');
+    expect(await prisma.githubAppConfig.findMany()).toHaveLength(1);
   });
 
-  it('answers 502 and stores nothing when GitHub fails', async () => {
+  it('sends the browser back with a GitHub problem, stores nothing and keeps running when GitHub fails', async () => {
     const server = firstRunServer({ github: fakeGithub(() => json({ message: 'Server Error' }, 500)).github });
-    const res = await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
-    expect(res.status).toBe(502);
-    expect((await errorOf(res)).code).toBe('github_unavailable');
+    expectBackOnThePage(await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`), 'github');
     expect(await prisma.githubAppConfig.count()).toBe(0);
+    await new Promise((resolve) => setTimeout(resolve, 600));
     expect(server.exit).not.toHaveBeenCalled();
   });
 
-  it("answers 400 when GitHub doesn't know the code (it lasts an hour)", async () => {
+  it("sends the browser back as expired when GitHub doesn't take the code (it lasts an hour)", async () => {
     const server = firstRunServer({ github: fakeGithub(() => json({ message: 'Not Found' }, 404)).github });
-    const res = await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
-    expect(res.status).toBe(400);
-    expect((await errorOf(res)).message).toBe("GitHub didn't accept this setup link; it lasts an hour. Start again at /first-run.");
+    expectBackOnThePage(await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`), 'expired');
     expect(await prisma.githubAppConfig.count()).toBe(0);
+    expect(server.exit).not.toHaveBeenCalled();
   });
 
   it('never stores an app with a secret missing', async () => {
     for (const missing of ['pem', 'webhook_secret', 'client_secret'] as const) {
       const server = firstRunServer({ github: fakeGithub(() => ({ ...CONVERSION, [missing]: null })).github });
-      const res = await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`);
-      expect(res.status, missing).toBe(502);
+      expectBackOnThePage(await callback(server, `code=the-code&state=${await stateFrom(await askForManifest(server))}`), 'github', missing);
       expect(await prisma.githubAppConfig.count()).toBe(0);
+      expect(server.exit).not.toHaveBeenCalled();
     }
   });
 });
@@ -258,13 +257,14 @@ describe('the first-run routes once the server has its app', () => {
   });
 
   it('refuse to make another app with a JSON 404, not the web app', async () => {
-    const app = testApp();
-    const manifest = await app.request('/api/first-run/manifest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REQUEST) });
-    const back = await app.request('/first-run/callback?code=the-code&state=s');
-    for (const res of [manifest, back]) {
-      expect(res.status).toBe(404);
-      expect((await errorOf(res)).code).toBe('not_found');
-    }
+    const res = await testApp().request('/api/first-run/manifest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REQUEST) });
+    expect(res.status).toBe(404);
+    expect((await errorOf(res)).code).toBe('not_found');
+    expect(await prisma.githubAppConfig.count()).toBe(0);
+  });
+
+  it('send a browser GitHub returns late (a second tab, after the restart) to the page, which says the new app is extra', async () => {
+    expectBackOnThePage(await testApp().request('/first-run/callback?code=the-code&state=s'), 'exists');
     expect(await prisma.githubAppConfig.count()).toBe(0);
   });
 });
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `npm run test:db -w apps/server -- src/setup/first-run.db.test.ts`
Expected: FAIL, 8 failed | 11 passed (19), each with `AssertionError: expected 400 to be 302` (also `expected 409 to be 302`, `expected 502 to be 302`, and for a ready server's callback `expected 404 to be 302`). The callback still answers the JSON errors.

- [x] **Step 3: The protocol knows the three problems**

In `packages/protocol/src/web-api.ts`, after `FirstRunManifestResponse` (the end of the file), add:

```diff
--- a/packages/protocol/src/web-api.ts
+++ b/packages/protocol/src/web-api.ts
@@ -420,3 +420,12 @@ export type FirstRunManifestRequest = z.infer<typeof FirstRunManifestRequest>;
  */
 export const FirstRunManifestResponse = z.object({ action: z.string(), manifest: z.record(z.string(), z.unknown()) });
 export type FirstRunManifestResponse = z.infer<typeof FirstRunManifestResponse>;
+
+/**
+ * Why `GET /first-run/callback` sent the browser back to `/first-run?error=…` instead of finishing. `expired`: the
+ * setup link is unknown, used, over an hour old, or GitHub refused its code. `github`: GitHub didn't answer, or its
+ * answer was missing part of the new app. `exists`: this server already has its app, so the one GitHub just made is
+ * extra. Nothing was stored in any of them.
+ */
+export const FirstRunProblem = z.enum(['expired', 'github', 'exists']);
+export type FirstRunProblem = z.infer<typeof FirstRunProblem>;
```

- [x] **Step 4: The callback redirects instead of throwing**

`convertManifest` now returns a result (`{ ok: true, … }` or `{ ok: false, problem }`) instead of throwing `HttpError`s, so the route can turn any problem into a redirect; the callback redirects, and the ready server's callback redirects to `exists`. In `apps/server/src/setup/first-run.ts`:

```diff
--- a/apps/server/src/setup/first-run.ts
+++ b/apps/server/src/setup/first-run.ts
@@ -1,5 +1,5 @@
 import { randomBytes } from 'node:crypto';
-import { FirstRunManifestRequest, type FirstRunManifestResponse, type FirstRunStatus } from '@nitpilot/protocol';
+import { FirstRunManifestRequest, type FirstRunManifestResponse, type FirstRunProblem, type FirstRunStatus } from '@nitpilot/protocol';
 import { Hono } from 'hono';
 import { z } from 'zod';
 import { errorBody, HttpError } from '../http/errors';
@@ -19,8 +19,6 @@ const STATE_TTL_MS = 60 * 60_000;
 /** How long the server waits after answering the callback before it exits, so the browser gets its redirect first. */
 export const EXIT_DELAY_MS = 500;
 
-const EXPIRED_LINK = 'This setup link expired or was changed. Start again at /first-run.';
-
 export type FirstRunDeps = {
   github: GithubClient;
   publicUrl: string;
@@ -78,39 +76,48 @@ const Conversion = z.object({
   owner: z.object({ login: z.string().min(1) }),
 });
 
+type ConversionResult = { ok: true; creds: GithubAppCredentials; ownerLogin: string } | { ok: false; problem: FirstRunProblem };
+
 /**
  * Trade the code GitHub sent back for the app it just created. No token: the code is the proof, it works once, and only
- * for an hour. A GitHub that doesn't answer is a 502; one that refuses the code (expired, used) is a 400.
+ * for an hour. GitHub refusing the code (expired, used) is `expired`; GitHub not answering, or answering without every
+ * secret, is `github`.
  */
-async function convertManifest(github: GithubClient, code: string): Promise<{ creds: GithubAppCredentials; ownerLogin: string }> {
+async function convertManifest(github: GithubClient, code: string): Promise<ConversionResult> {
   let data: unknown;
   try {
     ({ data } = await github.api('POST', `/app-manifests/${encodeURIComponent(code)}/conversions`));
   } catch (err) {
-    if (err instanceof GithubError && err.status >= 400 && err.status < 500) {
-      throw new HttpError('validation_error', "GitHub didn't accept this setup link; it lasts an hour. Start again at /first-run.");
-    }
+    if (err instanceof GithubError && err.status >= 400 && err.status < 500) return { ok: false, problem: 'expired' };
     console.error('[first-run] GitHub manifest conversion failed:', err);
-    throw new HttpError('github_unavailable', "GitHub didn't answer. Try again in a minute.");
+    return { ok: false, problem: 'github' };
   }
   const parsed = Conversion.safeParse(data);
   if (!parsed.success) {
     console.error('[first-run] GitHub answered the manifest conversion without', parsed.error.issues.map((i) => i.path.join('.')).join(', '));
-    throw new HttpError('github_unavailable', "GitHub's answer was missing part of the new app. Start again at /first-run.");
+    return { ok: false, problem: 'github' };
   }
   const app = parsed.data;
   return {
+    ok: true,
     creds: { appId: String(app.id), slug: app.slug, privateKey: app.pem, clientId: app.client_id, clientSecret: app.client_secret, webhookSecret: app.webhook_secret },
     ownerLogin: app.owner.login,
   };
 }
 
+/**
+ * The callback is a browser navigation (GitHub sends the person here), so a failure goes back to the page, which says
+ * what happened and offers to start again, rather than a JSON error in an empty tab.
+ */
+const backToThePage = (problem: FirstRunProblem) => `/first-run?error=${problem}`;
+
 /**
  * First-run mode's routes (spec §17 "Self-hosting", docs/why/first-run-and-app-manifests.md):
  * 1. `GET /api/first-run`: the page asks which mode the server is in.
  * 2. `POST /api/first-run/manifest`: with the setup code, the page gets a manifest and where to post it.
  * 3. The browser posts it to GitHub; GitHub creates the app and sends the browser to `GET /first-run/callback`.
  * 4. The callback trades GitHub's code for the app's credentials, stores them encrypted, and the server restarts.
+ *    If anything goes wrong there, nothing is stored and the browser goes back to /first-run?error=….
  */
 export function firstRunRoutes(deps: FirstRunDeps): Hono {
   const now = deps.now ?? (() => Date.now());
@@ -145,13 +152,16 @@ export function firstRunRoutes(deps: FirstRunDeps): Hono {
   app.get('/first-run/callback', async (c) => {
     const code = c.req.query('code');
     const state = c.req.query('state');
-    if (!code || !state || !states.take(state)) throw new HttpError('validation_error', EXPIRED_LINK);
+    if (!code || !state || !states.take(state)) return c.redirect(backToThePage('expired'));
 
-    const { creds, ownerLogin } = await convertManifest(deps.github, code);
+    const conversion = await convertManifest(deps.github, code);
+    if (!conversion.ok) return c.redirect(backToThePage(conversion.problem));
+    const { creds, ownerLogin } = conversion;
     try {
       await saveGithubApp(creds, ownerLogin);
     } catch (err) {
-      if (err instanceof GithubAppExistsError) throw new HttpError('conflict', "This server already has a GitHub App. The one GitHub just made isn't used: delete it in your GitHub settings.");
+      // Two tabs, one finished first: its app stays, and the page asks the person to delete the one GitHub just made.
+      if (err instanceof GithubAppExistsError) return c.redirect(backToThePage('exists'));
       throw err;
     }
 
@@ -169,8 +179,9 @@ export function firstRunRoutes(deps: FirstRunDeps): Hono {
 
 /**
  * The same three routes once the server has its app (http/app.ts createApp). The page, polling while the server
- * restarts, learns it's ready and where to install the app. The other two are a JSON 404 rather than the web app's
- * page: there is nothing left to set up, and a server with an app never makes a second one.
+ * restarts, learns it's ready and where to install the app. Asking for a manifest is a JSON 404 rather than the web
+ * app's page: there is nothing left to set up, and a server with an app never makes a second one. A browser GitHub
+ * sends back now (a second tab, finished after the restart) goes to the page, which says the new app is extra.
  */
 export function readyRoutes(deps: { github: GithubClient }): Hono {
   const app = new Hono();
@@ -182,7 +193,7 @@ export function readyRoutes(deps: { github: GithubClient }): Hono {
 
   const alreadySetUp = errorBody('not_found', 'This server already has its GitHub App.');
   app.post('/api/first-run/manifest', (c) => c.json(alreadySetUp, 404));
-  app.get('/first-run/callback', (c) => c.json(alreadySetUp, 404));
+  app.get('/first-run/callback', (c) => c.redirect(backToThePage('exists')));
 
   return app;
 }
```

A note on which failures are which: GitHub answering 4xx to the conversion means it doesn't take the code (used, or older than an hour) and is `expired`; a 5xx, no answer, or an answer without every secret is `github`. Both are logged only when it's GitHub's fault (`console.error`). An error nobody expected (the database is down while saving) is still thrown, so it's a JSON 500 in the log, not a friendly message that hides it.

Run: `npm run test:db -w apps/server -- src/setup/first-run.db.test.ts`
Expected: PASS (19 tests)

Run: `npm run typecheck -w apps/server`
Expected: no output (clean). (`HttpError` is still used by the other routes in the file.)

- [x] **Step 5: The api client keeps an error's `details` and doesn't retry a first-run 503: tests first**

The page maps a server `400` to a field using `details.issues`, so `ApiError` has to carry `details`. And TanStack Query retries 5xx twice; a server in first-run mode answers 503 until someone sets it up, so retrying only makes the notice wait about 3 seconds. In `apps/web/src/api/client.test.ts`:

```diff
--- a/apps/web/src/api/client.test.ts
+++ b/apps/web/src/api/client.test.ts
@@ -23,6 +23,12 @@ describe('api', () => {
     expect(err).toMatchObject({ status: 409, code: 'conflict', message: 'Someone already resolved P1.' });
   });
 
+  it("keeps the error's details, such as which fields a 400 refused", async () => {
+    const issues = [{ path: ['owner', 'login'], message: "isn't a GitHub login" }];
+    vi.stubGlobal('fetch', answer(400, { error: { code: 'validation_error', message: 'request validation failed', details: { issues } } }));
+    await expect(api.send('POST', '/api/x', {})).rejects.toMatchObject({ status: 400, code: 'validation_error', details: { issues } });
+  });
+
   it('refuses a body with the wrong shape instead of passing it on', async () => {
     vi.stubGlobal('fetch', answer(200, { nom: 'maya' }));
     await expect(api.get('/api/thing', Thing)).rejects.toMatchObject({ code: 'bad_response' });
@@ -48,4 +54,8 @@ describe('retryUnlessClientError', () => {
     expect(retryUnlessClientError(2, new ApiError(503, 'server_error', ''))).toBe(false);
     expect(retryUnlessClientError(0, new ApiError(404, 'not_found', ''))).toBe(false);
   });
+
+  it("doesn't retry a server in first-run mode: its 503 lasts until someone sets it up", () => {
+    expect(retryUnlessClientError(0, new ApiError(503, 'first_run', 'Finish setup at /first-run.'))).toBe(false);
+  });
 });
```

Run: `npm test -w apps/web -- src/api/client.test.ts`
Expected: FAIL, 2 failed | 6 passed (8): `AssertionError: expected ApiError: request validation failed { …(2) } to match object { status: 400, …(2) }` (no `details` on the error) and `AssertionError: expected true to be false // Object.is equality`.

- [x] **Step 6: `ApiError.details` and `isFirstRunMode`**

In `apps/web/src/api/client.ts`:

```diff
--- a/apps/web/src/api/client.ts
+++ b/apps/web/src/api/client.ts
@@ -1,11 +1,15 @@
 import { z } from 'zod';
 
-/** Every failed request, in one shape: the HTTP status (0 = no answer), the server's error code, and a message to show. */
+/**
+ * Every failed request, in one shape: the HTTP status (0 = no answer), the server's error code, a message to show, and
+ * the server's `details` when it sent some (a 400's `issues`: which fields it refused).
+ */
 export class ApiError extends Error {
   constructor(
     readonly status: number,
     readonly code: string,
     message: string,
+    readonly details?: Record<string, unknown>,
   ) {
     super(message);
     this.name = 'ApiError';
@@ -13,7 +17,7 @@ export class ApiError extends Error {
 }
 
 /** How the server answers an error (apps/server/src/http/errors.ts). */
-const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
+const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() }) });
 
 async function request<T>(method: string, path: string, schema: z.ZodType<T> | null, body?: unknown): Promise<T> {
   let res: Response;
@@ -31,7 +35,7 @@ async function request<T>(method: string, path: string, schema: z.ZodType<T> | n
 
   if (!res.ok) {
     const error = ErrorBody.safeParse(await res.json().catch(() => null));
-    if (error.success) throw new ApiError(res.status, error.data.error.code, error.data.error.message);
+    if (error.success) throw new ApiError(res.status, error.data.error.code, error.data.error.message, error.data.error.details);
     throw new ApiError(res.status, 'server_error', `Nitpilot answered ${res.status}. Try again in a moment.`);
   }
   if (schema === null || res.status === 204) return undefined as T;
@@ -47,8 +51,17 @@ export const api = {
   send: <T = void>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, schema: z.ZodType<T> | null = null) => request<T>(method, path, schema, body),
 };
 
-/** A 4xx won't change by asking again; a network failure or a 5xx might. Used as TanStack Query's `retry`. */
+/**
+ * A 4xx won't change by asking again; a network failure or a 5xx might. A server in first-run mode answers 503 until
+ * someone sets it up, so that one isn't retried either. Used as TanStack Query's `retry`.
+ */
 export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
   if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
+  if (isFirstRunMode(error)) return false;
   return failureCount < 2;
 }
+
+/** The server has no GitHub App yet (first-run mode): every API answers 503 `first_run` until /first-run is done. */
+export function isFirstRunMode(error: unknown): error is ApiError {
+  return error instanceof ApiError && error.status === 503 && error.code === 'first_run';
+}
```

Run: `npm test -w apps/web -- src/api/client.test.ts`
Expected: PASS (8 tests)

- [x] **Step 7: Every other page links to the setup page while the server is in first-run mode: tests first**

`Home` (which decides between the landing page and the app) and the device-approval page both ask `/api/me` first. While the server has no GitHub App, that answers 503 `first_run`. Instead of an error with a "Try again" button (or, on the approve page, a redirect to GitHub sign-in that can't work yet), they show "This server isn't set up yet" and a link. The Home test also checks the request count: the 503 is asked once, not three times.

In `apps/web/src/routes/Home/Home.test.tsx`:

```diff
--- a/apps/web/src/routes/Home/Home.test.tsx
+++ b/apps/web/src/routes/Home/Home.test.tsx
@@ -61,4 +61,19 @@ describe('Home', () => {
     await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
     expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
   });
+
+  describe('a server that is not set up yet (first-run mode)', () => {
+    const firstRun = (): Answer => [503, { error: { code: 'first_run', message: 'Finish setup at /first-run.' } }];
+
+    for (const path of ['/', '/settings', '/c/octo/sandbox/7']) {
+      it(`shows a link to the setup page instead of ${path}, without retrying`, async () => {
+        const fetch = fakeApi({ 'GET /api/me': firstRun });
+        renderApp(path);
+        expect(await screen.findByRole('heading', { level: 1, name: "This server isn't set up yet" })).toBeInTheDocument();
+        expect(screen.getByText('Finish setup at /first-run.')).toBeInTheDocument();
+        expect(screen.getByRole('link', { name: 'Open the setup page' })).toHaveAttribute('href', '/first-run');
+        expect(fetch).toHaveBeenCalledTimes(1);
+      });
+    }
+  });
 });
```

In `apps/web/src/routes/Approve/Approve.test.tsx` (the same, at the end of the file):

```diff
--- a/apps/web/src/routes/Approve/Approve.test.tsx
+++ b/apps/web/src/routes/Approve/Approve.test.tsx
@@ -221,3 +221,15 @@ describe('Approve: signed out', () => {
     expect(sent(fetch, API)).toEqual([]);
   });
 });
+
+describe('Approve on a server that is not set up yet (first-run mode)', () => {
+  it('shows a link to the setup page instead of sending you to GitHub sign-in', async () => {
+    const goTo = vi.spyOn(browser, 'goTo').mockImplementation(() => {});
+    serveApprove({ me: (): Answer => [503, { error: { code: 'first_run', message: 'Finish setup at /first-run.' } }] });
+    renderApp(PATH);
+    expect(await screen.findByRole('heading', { level: 1, name: "This server isn't set up yet" })).toBeInTheDocument();
+    expect(screen.getByRole('link', { name: 'Open the setup page' })).toHaveAttribute('href', '/first-run');
+    expect(goTo).not.toHaveBeenCalled();
+  });
+});
+
```

Run: `npm test -w apps/web -- src/routes/Home/Home.test.tsx src/routes/Approve/Approve.test.tsx`
Expected: FAIL, 4 failed | 23 passed (27): `TestingLibraryElementError: Unable to find role="heading" and name "This server isn't set up yet"` (three in Home, one in Approve).

- [x] **Step 8: The `FirstRunNeeded` screen, used by Home and Approve**

It reuses the device-approval page's frame (wordmark top left, one centered card) and the app's tokens, so it needs no new design. Create `apps/web/src/components/FirstRunNeeded/FirstRunNeeded.tsx`:

```tsx
import { Link } from 'react-router';
import { Wordmark } from '../Wordmark/Wordmark';
import styles from './FirstRunNeeded.module.css';

/**
 * What every page shows while the server is in first-run mode (it has no GitHub App yet, so `/api/me` answers 503
 * `first_run`): the server's message and the way to the setup page. See docs/why/first-run-and-app-manifests.md.
 */
export function FirstRunNeeded({ message }: { message: string }) {
  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Wordmark />
      </header>
      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="first-run-needed-title">
          <h1 id="first-run-needed-title" className={styles.title}>
            This server isn't set up yet
          </h1>
          <p className={styles.body}>{message}</p>
          <Link to="/first-run" className={styles.button}>
            Open the setup page
          </Link>
        </section>
      </main>
    </div>
  );
}
```

Create `apps/web/src/components/FirstRunNeeded/FirstRunNeeded.module.css`:

```css
/* The device-approval page's frame (routes/Approve): the wordmark top left, one centered card. */
.page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20px;
  background: var(--bg);
}

.topBar {
  display: flex;
  padding: 0 4px 8px;
}

.main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  width: 100%;
  max-width: 440px;
  padding: 36px 28px;
  border: 1px solid var(--b1);
  border-radius: 24px;
  background: var(--surface);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}

.title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.body {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--fg2);
}

.button {
  display: inline-flex;
  align-items: center;
  height: 48px;
  padding: 0 22px;
  border-radius: 14px;
  background: var(--acc);
  color: var(--on-acc);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

@media (max-width: 759px) {
  .page {
    padding: 14px 16px 16px;
  }

  .card {
    padding: 32px 22px;
  }
}
```

In `apps/web/src/routes/Home/Home.tsx` (the new check goes before the generic error):

```diff
--- a/apps/web/src/routes/Home/Home.tsx
+++ b/apps/web/src/routes/Home/Home.tsx
@@ -1,11 +1,16 @@
+import { isFirstRunMode } from '../../api/client';
 import { ErrorState } from '../../components/ErrorState/ErrorState';
+import { FirstRunNeeded } from '../../components/FirstRunNeeded/FirstRunNeeded';
 import { Wordmark } from '../../components/Wordmark/Wordmark';
 import { useMe } from '../../api/me';
 import { Landing } from '../Landing/Landing';
 import { SignedIn } from '../Shell/Shell';
 import styles from './Home.module.css';
 
-/** Every page starts here: the landing page when signed out, the app (the pages under routes/Shell/Shell.tsx `SignedIn`) when signed in. */
+/**
+ * Every page starts here: the landing page when signed out, the app (the pages under routes/Shell/Shell.tsx `SignedIn`)
+ * when signed in, and only a link to /first-run while the server has no GitHub App yet.
+ */
 export function Home() {
   const me = useMe();
   if (me.isPending) {
@@ -16,6 +21,7 @@ export function Home() {
       </div>
     );
   }
+  if (me.isError && isFirstRunMode(me.error)) return <FirstRunNeeded message={me.error.message} />;
   if (me.isError) return <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
   if (me.data === null) return <Landing />;
   return <SignedIn me={me.data} />;
```

In `apps/web/src/routes/Approve/Approve.tsx` (before anything else is chosen, so the redirect to GitHub sign-in in the effect above it never matters on this server):

```diff
--- a/apps/web/src/routes/Approve/Approve.tsx
+++ b/apps/web/src/routes/Approve/Approve.tsx
@@ -2,9 +2,10 @@ import { BRAND, type CliRequestView } from '@nitpilot/protocol';
 import { useEffect, useRef, useState, type ReactNode } from 'react';
 import { useLocation, useSearchParams } from 'react-router';
 import { useCliRequest, useDecideCliRequest } from '../../api/cli-requests';
-import { ApiError } from '../../api/client';
+import { ApiError, isFirstRunMode } from '../../api/client';
 import { useMe } from '../../api/me';
 import { ErrorState } from '../../components/ErrorState/ErrorState';
+import { FirstRunNeeded } from '../../components/FirstRunNeeded/FirstRunNeeded';
 import { Wordmark } from '../../components/Wordmark/Wordmark';
 import { browser } from '../../lib/browser';
 import { itemTime, useNow } from '../../lib/time';
@@ -29,6 +30,9 @@ export function Approve() {
     if (signedOut) browser.goTo(`/auth/github/login?next=${encodeURIComponent(location.pathname + location.search)}`);
   }, [signedOut, location.pathname, location.search]);
 
+  // A server with no GitHub App yet can't sign anyone in: the setup page comes first.
+  if (me.isError && isFirstRunMode(me.error)) return <FirstRunNeeded message={me.error.message} />;
+
   let content: ReactNode;
   if (me.isError) content = <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
   else if (me.isPending || signedOut) content = <Loading />;
```

Run: `npm test -w apps/web -- src/routes/Home/Home.test.tsx src/routes/Approve/Approve.test.tsx`
Expected: PASS (27 tests)

- [x] **Step 9: The page's tests, first**

Create `apps/web/src/routes/FirstRun/FirstRun.test.tsx`. It covers each state: loading; the form with its defaults (`Nitpilot (<host>)`, trimmed to GitHub's 34 characters); the manifest request and the real form post (the test replaces `browser.submit` and reads the form it was given: `method`, `action`, one hidden `manifest` field); an organization app installable by anyone; keyboard order; Back from GitHub (the browser's back-forward cache shows the page as it was, with the button still "Opening GitHub…", so a `pageshow` event with `persisted` resets it); a wrong code (kept on the field, field focused, everything else kept), too many tries, the fields checked before asking, a server `400` mapped to its field, an unreachable server; a server that already has its app; `?done=1` (polling every 2 s through the downtime, a failed fetch and a proxy's 502 meaning "keep waiting", then Install and Sign in; "Taking a while?" after a minute); and each `?error=` with "Start again".

```tsx
import type { FirstRunManifestResponse, FirstRunStatus } from '@nitpilot/protocol';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../../lib/browser';
import { fakeApi, renderApp, type Answer } from '../../test/render';
import { sent } from '../../test/settings';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SETUP_CODE = 'K7PX-3MQD';
const FIRST_RUN: FirstRunStatus = { mode: 'first_run', publicUrl: 'https://nitpilot.example.com' };
const READY: FirstRunStatus = { mode: 'ready', installUrl: 'https://github.com/apps/nitpilot-example/installations/new' };
const MANIFEST: FirstRunManifestResponse = {
  action: 'https://github.com/settings/apps/new?state=abc123',
  manifest: { name: 'Nitpilot (nitpilot.example.com)', redirect_url: 'https://nitpilot.example.com/first-run/callback' },
};

type Route = () => Answer | Promise<Answer>;

/** A server in first-run mode: `status` for `GET /api/first-run`, `manifest` for the form's request. */
function serveFirstRun(opts: { status?: Route; manifest?: Route } = {}) {
  return fakeApi({
    'GET /api/first-run': opts.status ?? ((): Answer => [200, FIRST_RUN]),
    'POST /api/first-run/manifest': opts.manifest ?? ((): Answer => [200, MANIFEST]),
  });
}

/** Stands in for the browser posting the form to GitHub; answers the forms it was given. */
function catchFormPosts() {
  const posted: HTMLFormElement[] = [];
  vi.spyOn(browser, 'submit').mockImplementation((form) => void posted.push(form));
  return posted;
}

const codeField = () => screen.getByRole('textbox', { name: 'Setup code' });
const nameField = () => screen.getByRole('textbox', { name: 'App name' });
const createButton = () => screen.getByRole('button', { name: 'Create GitHub App' });

async function fillCode(code = SETUP_CODE) {
  await userEvent.type(await screen.findByRole('textbox', { name: 'Setup code' }), code);
}

const setupCodeWrong = (): Answer => [403, { error: { code: 'setup_code', message: "That code doesn't match the one in the server's log." } }];

describe('FirstRun: the form', () => {
  it('says it is loading until the server says which mode it is in', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderApp('/first-run');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
  });

  it('asks for the setup code, the owner, a name and who can install it, with the defaults filled in', async () => {
    serveFirstRun();
    renderApp('/first-run');
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();

    expect(codeField()).toHaveValue('');
    expect(codeField()).toHaveAccessibleDescription("Find it in the server's log: docker compose logs nitpilot");

    const owner = screen.getByRole('radiogroup', { name: 'Create the app on' });
    expect(within(owner).getByRole('radio', { name: 'Your personal account' })).toBeChecked();
    expect(within(owner).getByRole('radio', { name: 'An organization' })).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Organization' })).not.toBeInTheDocument();

    expect(nameField()).toHaveValue('Nitpilot (nitpilot.example.com)');
    expect(nameField()).toHaveAttribute('maxlength', '34');

    const who = screen.getByRole('radiogroup', { name: 'Who can install it' });
    expect(within(who).getByRole('radio', { name: 'Only this account or organization' })).toBeChecked();
    expect(within(who).getByRole('radio', { name: 'Anyone on GitHub' })).not.toBeChecked();

    expect(createButton()).toBeEnabled();
  });

  it("trims the default name to GitHub's 34 characters, keeping the closing bracket", async () => {
    serveFirstRun({ status: (): Answer => [200, { mode: 'first_run', publicUrl: 'https://reviews.engineering.example-company.com' }] });
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    expect(nameField()).toHaveValue('Nitpilot (reviews.engineering.exa)');
    expect((nameField() as HTMLInputElement).value).toHaveLength(34);
  });

  it("asks for the manifest, then posts it to GitHub in a real form (GitHub doesn't take a fetch)", async () => {
    const posted = catchFormPosts();
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());

    expect(sent(fetch, '/api/first-run/manifest')).toEqual([
      `POST ${JSON.stringify({ code: SETUP_CODE, owner: { kind: 'user' }, name: 'Nitpilot (nitpilot.example.com)', isPublic: false })}`,
    ]);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const form = posted[0]!;
    expect(form.method).toBe('post');
    expect(form.action).toBe(MANIFEST.action);
    const fields = [...form.elements] as HTMLInputElement[];
    expect(fields.map((field) => [field.type, field.name, field.value])).toEqual([['hidden', 'manifest', JSON.stringify(MANIFEST.manifest)]]);
    // While the browser leaves for GitHub, the button says so and can't be pressed twice.
    expect(screen.getByRole('button', { name: 'Opening GitHub…' })).toBeDisabled();
  });

  it('makes the app for an organization, installable by anyone, under the name typed', async () => {
    catchFormPosts();
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(screen.getByRole('radio', { name: 'An organization' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Organization' }), 'acme-inc');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme reviews');
    await userEvent.click(screen.getByRole('radio', { name: 'Anyone on GitHub' }));
    await userEvent.click(createButton());

    expect(sent(fetch, '/api/first-run/manifest')).toEqual([
      `POST ${JSON.stringify({ code: SETUP_CODE, owner: { kind: 'org', login: 'acme-inc' }, name: 'Acme reviews', isPublic: true })}`,
    ]);
  });

  it('can be filled in and sent with the keyboard alone, in reading order', async () => {
    const posted = catchFormPosts();
    serveFirstRun();
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    await userEvent.tab();
    expect(codeField()).toHaveFocus();
    await userEvent.keyboard(SETUP_CODE);
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Your personal account' })).toHaveFocus();
    await userEvent.tab();
    expect(nameField()).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Only this account or organization' })).toHaveFocus();
    await userEvent.tab();
    expect(createButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(posted).toHaveLength(1));
  });

  it('comes back usable when the browser returns from GitHub with Back', async () => {
    catchFormPosts();
    serveFirstRun();
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    expect(await screen.findByRole('button', { name: 'Opening GitHub…' })).toBeDisabled();

    // The browser shows the page from its back-forward cache, as it was when it left.
    act(() => void window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(await screen.findByRole('button', { name: 'Create GitHub App' })).toBeEnabled();
    expect(codeField()).toHaveValue(SETUP_CODE);
  });
});

describe('FirstRun: what the form refuses', () => {
  it('a wrong code keeps everything typed and says so on the code field, which gets the focus', async () => {
    const posted = catchFormPosts();
    serveFirstRun({ manifest: setupCodeWrong });
    renderApp('/first-run');
    await fillCode('K7PX-3MQE');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'My reviews');
    await userEvent.click(createButton());

    const field = codeField();
    expect(await screen.findByText("That code doesn't match the one in the server's log.")).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining("That code doesn't match the one in the server's log."));
    expect(field).toHaveFocus();
    expect(field).toHaveValue('K7PX-3MQE');
    expect(nameField()).toHaveValue('My reviews');
    expect(createButton()).toBeEnabled();
    expect(posted).toEqual([]);
  });

  it('fixing the code clears the message', async () => {
    serveFirstRun({ manifest: setupCodeWrong });
    renderApp('/first-run');
    await fillCode('WRONG');
    await userEvent.click(createButton());
    expect(await screen.findByText("That code doesn't match the one in the server's log.")).toBeInTheDocument();
    await userEvent.type(codeField(), 'X');
    expect(screen.queryByText("That code doesn't match the one in the server's log.")).not.toBeInTheDocument();
    expect(codeField()).not.toHaveAttribute('aria-invalid');
  });

  it('too many tries says to wait a minute', async () => {
    serveFirstRun({ manifest: (): Answer => [429, { error: { code: 'rate_limited', message: 'Too many tries from here. Wait a minute and try again.' } }] });
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Wait a minute and try again.');
    expect(codeField()).toHaveValue(SETUP_CODE);
  });

  it('checks the fields before asking the server, and names the one to fix', async () => {
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    await userEvent.click(createButton());
    expect(codeField()).toHaveAttribute('aria-invalid', 'true');
    expect(codeField()).toHaveAccessibleDescription(expect.stringContaining("Enter the setup code from the server's log."));
    expect(codeField()).toHaveFocus();

    await userEvent.type(codeField(), SETUP_CODE);
    await userEvent.click(screen.getByRole('radio', { name: 'An organization' }));
    await userEvent.clear(nameField());
    await userEvent.click(createButton());
    const org = screen.getByRole('textbox', { name: 'Organization' });
    expect(org).toHaveAttribute('aria-invalid', 'true');
    expect(org).toHaveAccessibleDescription("Enter the organization's GitHub login, like acme-inc.");
    expect(org).toHaveFocus();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(nameField()).toHaveAccessibleDescription(expect.stringContaining('Give the app a name.'));

    await userEvent.type(org, 'not a login!');
    await userEvent.click(createButton());
    expect(org).toHaveAccessibleDescription("Enter the organization's GitHub login, like acme-inc.");
    expect(sent(fetch, '/api/first-run/manifest')).toEqual([]);
  });

  it("names the field when the server refuses one the page didn't catch", async () => {
    serveFirstRun({
      manifest: (): Answer => [400, { error: { code: 'validation_error', message: 'request validation failed', details: { issues: [{ path: ['name'], message: 'Too big' }] } } }],
    });
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    await vi.waitFor(() => expect(nameField()).toHaveAttribute('aria-invalid', 'true'));
    expect(nameField()).toHaveAccessibleDescription(expect.stringContaining('Up to 34 characters.'));
  });

  it("shows the server's message for anything else, and keeps the form", async () => {
    serveFirstRun({ manifest: () => Promise.reject(new TypeError('Failed to fetch')) });
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Nitpilot. Check your connection and try again.");
    expect(codeField()).toHaveValue(SETUP_CODE);
  });
});

describe('FirstRun: a server that already has its app', () => {
  it('says so, with Install and Sign in', async () => {
    const fetch = serveFirstRun({ status: (): Answer => [200, READY] });
    renderApp('/first-run');
    expect(await screen.findByRole('heading', { level: 1, name: 'This server is set up' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the app' })).toHaveAttribute('href', READY.installUrl);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/github/login');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(sent(fetch, '/api/first-run')).toEqual(['GET ']);
  });

  it("offers Try again when the server can't be read", async () => {
    let reads = 0;
    serveFirstRun({ status: (): Answer => (++reads <= 3 ? [500, {}] : [200, FIRST_RUN]) });
    renderApp('/first-run');
    expect(await screen.findByRole('alert')).toHaveTextContent('Nitpilot answered 500. Try again in a moment.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();
  });
});

describe('FirstRun: back from GitHub (?done=1)', () => {
  it('waits while the server restarts, asking every 2 seconds and through its downtime, then offers Install and Sign in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers: Route[] = [
      // Not restarted yet, then down, then answering something that isn't the API (a proxy's error page), then ready.
      (): Answer => [200, FIRST_RUN],
      () => Promise.reject(new TypeError('Failed to fetch')),
      (): Answer => [502, 'Bad Gateway'],
      (): Answer => [200, READY],
    ];
    const fetch = serveFirstRun({ status: () => answers.shift()!() });
    renderApp('/first-run?done=1');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Restarting the server…');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    for (const reads of [2, 3]) {
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(sent(fetch, '/api/first-run')).toHaveLength(reads);
      expect(screen.getByRole('status')).toHaveTextContent('Restarting the server…');
    }
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your GitHub App is ready' })).toBeInTheDocument();
    // The same live region says it, so a screen reader hears the change.
    expect(screen.getByRole('status')).toHaveTextContent('Your GitHub App is ready');
    expect(screen.getByRole('link', { name: 'Install the app on your repos' })).toHaveAttribute('href', READY.installUrl);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/github/login');

    // Ready means done: no more asking.
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(sent(fetch, '/api/first-run')).toHaveLength(4);
  });

  it('after a minute, says where to look if the server still has not come back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveFirstRun({ status: () => Promise.reject(new TypeError('Failed to fetch')) });
    renderApp('/first-run?done=1');
    expect(await screen.findByRole('status')).toHaveTextContent('Restarting the server…');
    expect(screen.queryByText(/Taking a while\?/)).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByText(/Taking a while\? Check that the server restarted:/)).toHaveTextContent('docker compose ps');
  });
});

describe('FirstRun: back from GitHub with a problem (?error=)', () => {
  const DELETE_HINT = 'GitHub → Settings → Developer settings → GitHub Apps';

  it.each([
    ['expired', 'This setup link expired', 'Nothing was saved.'],
    ['github', "GitHub didn't finish the setup", 'Nothing was saved.'],
    ['exists', 'This server already has its GitHub App', "The app GitHub just made isn't used."],
    ['something-else', 'This setup link expired', 'Nothing was saved.'],
  ])('%s: says what happened and where to delete the app GitHub made', async (problem, title, body) => {
    serveFirstRun();
    renderApp(`/first-run?error=${problem}`);
    const heading = await screen.findByRole('heading', { level: 1, name: title });
    const card = heading.closest('section')!;
    expect(card).toHaveTextContent(body);
    expect(card).toHaveTextContent(DELETE_HINT);
  });

  it('Start again goes back to the form, without the problem in the address', async () => {
    serveFirstRun();
    renderApp('/first-run?error=github');
    await userEvent.click(await screen.findByRole('button', { name: 'Start again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "GitHub didn't finish the setup" })).not.toBeInTheDocument();
  });
});

describe('FirstRun is a page of its own', () => {
  it("doesn't ask who is signed in: a server in first-run mode has nobody", async () => {
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    expect(sent(fetch, '/api/me')).toEqual([]);
  });
});
```

Run: `npm test -w apps/web -- src/routes/FirstRun`
Expected: FAIL, 22 failed | 1 passed (23): `TestingLibraryElementError: Unable to find role="heading" and name "Set up Nitpilot"`, and for the form posts `Error: The property "submit" is not defined on the object.` (the one that passes is "says it is loading", which only sees Home's own loading text until the page exists).

- [x] **Step 10: `browser.submit` and the page's api hooks**

`browser.submit` is the same trick as `browser.goTo` (it exists so a test can replace it: jsdom can't follow a form post). In `apps/web/src/lib/browser.ts`:

```diff
--- a/apps/web/src/lib/browser.ts
+++ b/apps/web/src/lib/browser.ts
@@ -1,9 +1,14 @@
 /**
- * Leaving the web app for a page the server answers (GitHub sign-in). One object, so a test can replace `goTo` with
- * `vi.spyOn(browser, 'goTo')`: jsdom won't let a test replace `window.location.assign` itself.
+ * Leaving the web app for a page the server answers (GitHub sign-in), or for GitHub itself (the first-run page's form).
+ * One object, so a test can replace these with `vi.spyOn(browser, 'goTo')`: jsdom won't let a test replace
+ * `window.location.assign` itself, and it can't follow a form post.
  */
 export const browser = {
   goTo(url: string): void {
     window.location.assign(url);
   },
+  /** Post a form the page built: a real navigation to its `action`, as if its submit button were pressed. */
+  submit(form: HTMLFormElement): void {
+    form.submit();
+  },
 };
```

Create `apps/web/src/api/first-run.ts`. `useRestartedServer` turns every failed read into `null` on purpose: while the container restarts, nothing answers, and then a proxy such as Caddy answers with its own error page. All of those only mean "not yet", so none of them may show as an error.

```ts
import { FirstRunManifestResponse, FirstRunStatus, type FirstRunManifestRequest } from '@nitpilot/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client';

/** How often the page asks again while the server restarts after GitHub made its app. */
export const RESTART_POLL_MS = 2_000;

/** Which mode the server is in (`GET /api/first-run`): waiting to be set up, or ready with its app. */
export function useFirstRunStatus() {
  return useQuery({ queryKey: ['first-run'], queryFn: () => api.get('/api/first-run', FirstRunStatus) });
}

/**
 * The same question, every 2 seconds, while the server restarts into normal mode (spec §10 "First-run mode"). Until
 * the restart it still answers `first_run`; during it, nothing answers, or a proxy answers with its own error page.
 * All of those just mean "not yet", so a failed read is `null` rather than an error. It stops once the server is ready.
 */
export function useRestartedServer() {
  return useQuery({
    queryKey: ['first-run', 'restart'],
    queryFn: () => api.get('/api/first-run', FirstRunStatus).catch(() => null),
    refetchInterval: (query) => (query.state.data?.mode === 'ready' ? false : RESTART_POLL_MS),
  });
}

/** Trade the setup code and the person's choices for the manifest, and where the page posts it (GitHub). */
export function useManifest() {
  return useMutation({
    mutationFn: (request: FirstRunManifestRequest) => api.send('POST', '/api/first-run/manifest', request, FirstRunManifestResponse),
  });
}
```

- [x] **Step 11: The page**

Create `apps/web/src/routes/FirstRun/FirstRun.tsx`. Its parts: `FirstRun` (the frame, and which of `Problem`, `Restarting` or `Start` to show from `?error=` / `?done=1`), `Start` (asks the server which mode it is in), the form (validates with the same `FirstRunManifestRequest` zod schema the server uses before sending anything, so a bad login is named on its field before a request is made), `Restarting` (polls, and says where to look after a minute), and `Problem` (an unknown `?error=` value shows the `expired` copy, the safest one: start again).

```tsx
import { BRAND, FirstRunManifestRequest, FirstRunProblem, type FirstRunManifestResponse } from '@nitpilot/protocol';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { RESTART_POLL_MS, useFirstRunStatus, useManifest, useRestartedServer } from '../../api/first-run';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { browser } from '../../lib/browser';
import { useNow } from '../../lib/time';
import styles from './FirstRun.module.css';

const SIGN_IN = '/auth/github/login';
/** The longest name GitHub gives an app. */
const NAME_MAX = 34;
/** After this long without the server coming back, the page says where to look. */
const SLOW_RESTART_MS = 60_000;
const GITHUB_APPS_SETTINGS = 'GitHub → Settings → Developer settings → GitHub Apps';

/**
 * `/first-run` (spec §10 "First-run mode", docs/why/first-run-and-app-manifests.md): a self-hosted server with no
 * GitHub App yet has GitHub create one. The person types the setup code from the server's log and a few choices; the
 * page posts the server's manifest to GitHub in a real form; GitHub sends them back to `?done=1` while the server
 * restarts, or to `?error=…` if something went wrong. A page of its own, like device approval: nobody can be signed
 * in yet.
 */
export function FirstRun() {
  const [params, setParams] = useSearchParams();
  const problem = params.get('error');

  let content: ReactNode;
  if (problem !== null) content = <Problem problem={problem} onStartAgain={() => setParams({})} />;
  else if (params.get('done') === '1') content = <Restarting />;
  else content = <Start />;

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Wordmark />
      </header>
      <main className={styles.main}>{content}</main>
    </div>
  );
}

function Loading() {
  return (
    <p className={styles.loading} role="status" aria-busy="true">
      Loading…
    </p>
  );
}

/** Asks the server which mode it's in: the form if it needs setting up, Install and Sign in if it already has its app. */
function Start() {
  const status = useFirstRunStatus();
  if (status.isPending) return <Loading />;
  if (status.isError) return <ErrorState message={status.error.message} onRetry={() => void status.refetch()} />;
  if (status.data.mode === 'ready') {
    return (
      <section className={`${styles.card} ${styles.centered}`} aria-labelledby="first-run-title">
        <span className={styles.icon} data-kind="ready" aria-hidden="true">
          ✓
        </span>
        <h1 id="first-run-title" className={styles.outcomeTitle}>
          This server is set up
        </h1>
        <p className={styles.body}>It has its GitHub App. Install it on your repos, or sign in.</p>
        <InstallAndSignIn installUrl={status.data.installUrl} installLabel="Install the app" />
      </section>
    );
  }
  return <SetupForm publicUrl={status.data.publicUrl} />;
}

type Field = 'code' | 'org' | 'name';
type FieldErrors = Partial<Record<Field, string>>;
/** The fields in the order they're on the page: focus goes to the first one with a problem. */
const FIELD_ORDER: Field[] = ['code', 'org', 'name'];

const MESSAGES = {
  noCode: "Enter the setup code from the server's log.",
  wrongCode: "That code doesn't match the one in the server's log.",
  orgLogin: "Enter the organization's GitHub login, like acme-inc.",
  noName: 'Give the app a name.',
  nameTooLong: `Up to ${NAME_MAX} characters.`,
  tooManyTries: 'Too many tries. Wait a minute and try again.',
};

/** The form: the setup code, whose app it is, its name, who can install it. "Create GitHub App" then leaves for GitHub. */
function SetupForm({ publicUrl }: { publicUrl: string }) {
  const [code, setCode] = useState('');
  const [ownerKind, setOwnerKind] = useState<'user' | 'org'>('user');
  const [org, setOrg] = useState('');
  const [name, setName] = useState(() => defaultAppName(publicUrl));
  const [isPublic, setIsPublic] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const manifest = useManifest();
  const codeInput = useRef<HTMLInputElement>(null);
  const orgInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const ids = { code: `${id}-code`, org: `${id}-org`, name: `${id}-name`, owner: `${id}-owner`, who: `${id}-who` };

  // Back from GitHub with the browser's Back button, the page can come back exactly as it left, "Opening GitHub…"
  // included. Make the form usable again, keeping what was typed.
  const { reset } = manifest;
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);

  function showFieldErrors(next: FieldErrors) {
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field]);
    const inputs = { code: codeInput, org: orgInput, name: nameInput };
    if (first) inputs[first].current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    // The same schema the server checks with, so the page names the field to fix before asking.
    const parsed = FirstRunManifestRequest.safeParse({ code, owner: ownerKind === 'org' ? { kind: 'org', login: org.trim() } : { kind: 'user' }, name, isPublic });
    const problems: FieldErrors = parsed.success ? {} : fieldErrorsFrom(parsed.error.issues, name);
    if (code.trim() === '') problems.code = MESSAGES.noCode;
    if (!parsed.success || problems.code) return showFieldErrors(problems);

    setErrors({});
    manifest.mutate(parsed.data, {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'setup_code') return showFieldErrors({ code: MESSAGES.wrongCode });
        if (err instanceof ApiError && err.code === 'rate_limited') return setFormError(MESSAGES.tooManyTries);
        const named = err instanceof ApiError && err.code === 'validation_error' ? fieldErrorsFrom(issuesIn(err), name) : {};
        if (Object.keys(named).length > 0) return showFieldErrors(named);
        setFormError(err.message);
      },
    });
  }

  /** Typing in a field clears its message. */
  function edit(field: Field, set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  const leaving = manifest.isPending || manifest.isSuccess;
  return (
    <section className={styles.card} aria-labelledby="first-run-title">
      <span className={styles.eyebrow}>First run</span>
      <div className={styles.intro}>
        <h1 id="first-run-title" className={styles.title}>
          Set up {BRAND.name}
        </h1>
        <p className={styles.body}>This server needs a GitHub App of its own. Fill this in, and GitHub creates it after one more click.</p>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <TextField
          id={ids.code}
          ref={codeInput}
          label="Setup code"
          value={code}
          onChange={edit('code', setCode)}
          error={errors.code}
          hint={
            <>
              Find it in the server's log: <code className={styles.inlineCode}>docker compose logs {BRAND.cli}</code>
            </>
          }
          mono
        />

        <fieldset className={styles.choices} role="radiogroup" aria-labelledby={ids.owner}>
          <legend id={ids.owner} className={styles.label}>
            Create the app on
          </legend>
          <Choice name="owner" label="Your personal account" checked={ownerKind === 'user'} onChoose={() => setOwnerKind('user')} />
          <Choice name="owner" label="An organization" checked={ownerKind === 'org'} onChoose={() => setOwnerKind('org')} />
        </fieldset>
        {ownerKind === 'org' && <TextField id={ids.org} ref={orgInput} label="Organization" value={org} onChange={edit('org', setOrg)} error={errors.org} />}

        <TextField
          id={ids.name}
          ref={nameInput}
          label="App name"
          value={name}
          onChange={edit('name', setName)}
          error={errors.name}
          maxLength={NAME_MAX}
          hint="GitHub shows this name, and no two apps on GitHub can share one."
        />

        <fieldset className={styles.choices} role="radiogroup" aria-labelledby={ids.who}>
          <legend id={ids.who} className={styles.label}>
            Who can install it
          </legend>
          <Choice name="who" label="Only this account or organization" checked={!isPublic} onChoose={() => setIsPublic(false)} />
          <Choice name="who" label="Anyone on GitHub" checked={isPublic} onChoose={() => setIsPublic(true)} />
        </fieldset>

        {formError && (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        )}
        <button type="submit" className={styles.primary} disabled={leaving} aria-busy={leaving}>
          {leaving ? 'Opening GitHub…' : 'Create GitHub App'}
        </button>
      </form>
      {/* Outside the form above: a form can't hold another. */}
      {manifest.data && <PostToGithub answer={manifest.data} />}
    </section>
  );
}

/** A labelled text input with its hint and its error, both read out with it (`aria-describedby`). */
function TextField({ ref, ...props }: {
  id: string;
  ref: Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  maxLength?: number;
  mono?: boolean;
}) {
  const hintId = `${props.id}-hint`;
  const errorId = `${props.id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={props.id} className={styles.label}>
        {props.label}
      </label>
      <input
        id={props.id}
        ref={ref}
        className={props.mono ? `${styles.input} ${styles.mono}` : styles.input}
        type="text"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={props.maxLength}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {props.hint && (
        <p id={hintId} className={styles.hint}>
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errorId} className={styles.fieldError}>
          {props.error}
        </p>
      )}
    </div>
  );
}

function Choice(props: { name: string; label: string; checked: boolean; onChoose: () => void }) {
  return (
    <label className={styles.choice}>
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChoose} />
      {props.label}
    </label>
  );
}

/**
 * The manifest, posted to GitHub the only way GitHub takes it: a form the browser submits, which leaves this page.
 * Submitted once, as soon as it's on the page (a ref keeps React's development double-run from posting twice).
 */
function PostToGithub({ answer }: { answer: FirstRunManifestResponse }) {
  const form = useRef<HTMLFormElement>(null);
  const posted = useRef(false);
  useEffect(() => {
    if (posted.current || !form.current) return;
    posted.current = true;
    browser.submit(form.current);
  }, []);
  return (
    <form ref={form} method="post" action={answer.action} hidden>
      <input type="hidden" name="manifest" value={JSON.stringify(answer.manifest)} />
    </form>
  );
}

/**
 * Back from GitHub: the server saved the app and is restarting. Ask every 2 seconds until it answers `ready`. The
 * title and its line sit in a polite live region, so a screen reader hears "ready" when it comes.
 */
function Restarting() {
  const server = useRestartedServer();
  const [startedAt] = useState(() => Date.now());
  const now = useNow(RESTART_POLL_MS);
  const ready = server.data?.mode === 'ready' ? server.data : null;
  const slow = !ready && now.getTime() - startedAt >= SLOW_RESTART_MS;

  return (
    <section className={`${styles.card} ${styles.centered}`} aria-labelledby="first-run-title">
      <div className={styles.status} role="status">
        {ready ? (
          <span className={styles.icon} data-kind="ready" aria-hidden="true">
            ✓
          </span>
        ) : (
          <span className={styles.spinner} aria-hidden="true" />
        )}
        <h1 id="first-run-title" className={styles.outcomeTitle}>
          {ready ? 'Your GitHub App is ready' : 'Restarting the server…'}
        </h1>
        <p className={styles.body}>
          {ready ? 'Install it on the repos you want reviewed, then sign in.' : "GitHub made the app and the server saved it. It's restarting to use it, which takes a few seconds."}
        </p>
      </div>
      {slow && (
        <p className={styles.fine}>
          Taking a while? Check that the server restarted: <code className={styles.inlineCode}>docker compose ps</code>, and its log:{' '}
          <code className={styles.inlineCode}>docker compose logs {BRAND.cli}</code>.
        </p>
      )}
      {ready && <InstallAndSignIn installUrl={ready.installUrl} installLabel="Install the app on your repos" />}
    </section>
  );
}

function InstallAndSignIn({ installUrl, installLabel }: { installUrl: string; installLabel: string }) {
  return (
    <div className={styles.buttons}>
      <a className={styles.primary} href={installUrl}>
        {installLabel}
      </a>
      <a className={styles.secondary} href={SIGN_IN}>
        Sign in
      </a>
    </div>
  );
}

const PROBLEMS: Record<FirstRunProblem, { title: string; body: string; hint: string }> = {
  expired: {
    title: 'This setup link expired',
    body: "Nothing was saved. GitHub's link back works once, within the hour, and only until the server restarts.",
    hint: `If GitHub made an app anyway, delete it in ${GITHUB_APPS_SETTINGS}, then start again.`,
  },
  github: {
    title: "GitHub didn't finish the setup",
    body: "GitHub didn't answer, or its answer was missing part of the new app. Nothing was saved.",
    hint: `If GitHub made an app anyway, delete it in ${GITHUB_APPS_SETTINGS}, then try again in a minute.`,
  },
  exists: {
    title: 'This server already has its GitHub App',
    body: "The app GitHub just made isn't used.",
    hint: `Delete it in ${GITHUB_APPS_SETTINGS}.`,
  },
};

/** GitHub sent the person back, but the server couldn't finish (`/first-run?error=…`, setup/first-run.ts). */
function Problem({ problem, onStartAgain }: { problem: string; onStartAgain: () => void }) {
  const known = FirstRunProblem.safeParse(problem);
  const { title, body, hint } = PROBLEMS[known.success ? known.data : 'expired'];
  return (
    <section className={`${styles.card} ${styles.centered}`} aria-labelledby="first-run-title">
      <span className={styles.icon} data-kind="problem" aria-hidden="true">
        !
      </span>
      <h1 id="first-run-title" className={styles.outcomeTitle}>
        {title}
      </h1>
      <p className={styles.body}>{body}</p>
      <p className={styles.fine}>{hint}</p>
      <button type="button" className={styles.secondary} onClick={onStartAgain}>
        Start again
      </button>
    </section>
  );
}

/** "Nitpilot (nitpilot.example.com)", with the host cut short to fit GitHub's 34 characters. */
function defaultAppName(publicUrl: string): string {
  const host = URL.canParse(publicUrl) ? new URL(publicUrl).host : '';
  if (host === '') return BRAND.name;
  const prefix = `${BRAND.name} (`;
  return `${prefix}${host.slice(0, NAME_MAX - prefix.length - 1)})`;
}

/** Which field each problem is about, from the schema's issues (the page's own check, or a 400's `details.issues`). */
function fieldErrorsFrom(issues: readonly { path: readonly PropertyKey[] }[], name: string): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path } of issues) {
    if (path[0] === 'code') errors.code = MESSAGES.noCode;
    if (path[0] === 'owner') errors.org = MESSAGES.orgLogin;
    if (path[0] === 'name') errors.name = name.trim() === '' ? MESSAGES.noName : MESSAGES.nameTooLong;
  }
  return errors;
}

const Issues = z.object({ issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) })) });

/** The issues a 400 sent along (http/errors.ts puts zod's in `details.issues`), or none. */
function issuesIn(err: ApiError) {
  const parsed = Issues.safeParse(err.details);
  return parsed.success ? parsed.data.issues : [];
}
```

- [x] **Step 12: The page's styles**

Create `apps/web/src/routes/FirstRun/FirstRun.module.css` (Approve's frame and card, the app's tokens, and `--acc-tint` for the selected radio row; `white-space: nowrap` on the inline command so `docker compose logs nitpilot` doesn't break in the middle on a phone):

```css
/* The first-run page. No screen in the handoff: it reuses device approval's frame (routes/Approve: the wordmark top
   left, one centered 440px card with a 24px radius) and the handoff's tokens for fields and buttons. */
.page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20px;
  background: var(--bg);
}

.topBar {
  display: flex;
  padding: 0 4px 8px;
}

.main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.loading {
  margin: 0;
  font-size: 14px;
  color: var(--fg3);
}

.card {
  width: 100%;
  max-width: 440px;
  padding: 28px;
  border: 1px solid var(--b1);
  border-radius: 24px;
  background: var(--surface);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Restarting, ready and the problems: a 56px glyph, the title, a line or two, the buttons. */
.centered {
  align-items: center;
  gap: 14px;
  padding-top: 40px;
  padding-bottom: 40px;
  text-align: center;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg3);
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.outcomeTitle {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.body {
  margin: 0;
  max-width: 24em;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--fg2);
  text-wrap: pretty;
}

.fine {
  margin: 0;
  max-width: 26em;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--fg3);
  text-wrap: pretty;
}

.status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
}

.icon[data-kind='ready'] {
  background: var(--ok-tint);
  color: var(--ok-fg);
}

.icon[data-kind='problem'] {
  background: var(--warn-tint);
  color: var(--warn-fg);
}

/* The setup checklist's waiting spinner, at the glyph's size. Reduced motion stops it (styles/global.css). */
.spinner {
  width: 56px;
  height: 56px;
  border: 3px solid var(--b1);
  border-top-color: var(--acc);
  border-radius: var(--radius-pill);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  padding: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--fg1);
}

.input {
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--bg);
  font-size: 15px;
}

.input:focus {
  border-color: var(--acc);
}

.input[aria-invalid='true'] {
  border-color: var(--red);
}

.mono {
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hint {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--fg3);
}

.inlineCode {
  padding: 1px 5px;
  border: 1px solid var(--b1);
  border-radius: 6px;
  background: var(--code);
  font-size: 0.95em;
  color: var(--fg1);
  /* A command wraps to its own line as a whole rather than breaking inside. */
  white-space: nowrap;
}

.fieldError,
.formError {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--red-fg);
}

.formError {
  padding: 10px 12px;
  border: 1px solid var(--red-line);
  border-radius: var(--radius-control);
  background: var(--red-tint);
}

.choices {
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choices .label {
  margin-bottom: 2px;
}

.choice {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  font-size: 14.5px;
  cursor: pointer;
}

.choice:hover {
  background: var(--hover);
}

.choice:has(input:checked) {
  border-color: var(--acc-line);
  background: var(--acc-tint);
}

.choice input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--acc);
}

/* Install, then Sign in: stacked, so the longer label stays on one line in a 440px card. */
.buttons {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.primary,
.secondary {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 14px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}

.primary {
  border: 0;
  background: var(--acc);
  color: var(--on-acc);
}

.secondary {
  border: 1px solid var(--b1);
  background: var(--surface);
  color: var(--fg1);
}

.secondary:hover {
  background: var(--hover);
}

.primary:disabled {
  cursor: progress;
  opacity: 0.7;
}

/* Start again: one button, not stretched across the card. */
.centered > .secondary {
  flex: none;
}

/* Phone: the 16px side gutters every screen keeps, and a little less padding inside the card. */
@media (max-width: 759px) {
  .page {
    padding: 14px 16px 16px;
  }

  .card {
    padding: 22px;
  }

  .centered {
    padding-top: 32px;
    padding-bottom: 32px;
  }
}
```

- [x] **Step 13: The lazy route**

`/first-run` is opened once per server, so it is its own chunk, like device approval and Setup (the main chunk stays under Vite's 500 kB warning: Step 19). It sits next to `cli/approve`, outside `Home`: nobody can be signed in on a server with no app. In `apps/web/src/app.tsx`:

```diff
--- a/apps/web/src/app.tsx
+++ b/apps/web/src/app.tsx
@@ -9,12 +9,13 @@ import { EmptyPane } from './routes/Shell/Pane';
 import { InboxLayout } from './routes/Shell/Shell';
 
 /**
- * Device approval and the setup checklist are pages most people open once (from `nitpilot login`, and after their first
- * sign-in), so each is a file of its own that the browser fetches only when that page opens (and the rest of the app
- * stays under Vite's 500 kB chunk warning).
+ * Device approval, the setup checklist and the first-run page are pages most people open once (from `nitpilot login`,
+ * after their first sign-in, and once per self-hosted server), so each is a file of its own that the browser fetches
+ * only when that page opens (and the rest of the app stays under Vite's 500 kB chunk warning).
  */
 const Approve = lazy(() => import('./routes/Approve/Approve').then((module) => ({ default: module.Approve })));
 const Setup = lazy(() => import('./routes/Setup/Setup').then((module) => ({ default: module.Setup })));
+const FirstRun = lazy(() => import('./routes/FirstRun/FirstRun').then((module) => ({ default: module.FirstRun })));
 
 /** `queries` lets a test override a default (`retryDelay: 0`) while still using the real retry policy. */
 export function makeQueryClient(queries: { retryDelay?: number } = {}): QueryClient {
@@ -35,9 +36,10 @@ export function App({ queryClient }: { queryClient?: QueryClient }) {
 }
 
 /**
- * Every page. Home decides between the landing page (signed out) and the app. Signed in, the chat pages open beside
- * the inbox (routes/Shell/Shell.tsx `InboxLayout`); Settings and the setup checklist are pages of their own. Device
- * approval (`/cli/approve`, the link `nitpilot login` opens) stands outside Home: no landing page, no inbox, no socket.
+ * Every page. Home decides between the landing page (signed out) and the app, or only a link to /first-run while the
+ * server has no GitHub App. Signed in, the chat pages open beside the inbox (routes/Shell/Shell.tsx `InboxLayout`);
+ * Settings and the setup checklist are pages of their own. Device approval (`/cli/approve`, the link `nitpilot login`
+ * opens) and the first-run page stand outside Home: no landing page, no inbox, no socket.
  */
 export function AppRoutes() {
   return (
@@ -66,6 +68,14 @@ export function AppRoutes() {
           </Suspense>
         }
       />
+      <Route
+        path="first-run"
+        element={
+          <Suspense fallback={null}>
+            <FirstRun />
+          </Suspense>
+        }
+      />
     </Routes>
   );
 }
```

Run: `npm test -w apps/web -- src/routes/FirstRun`
Expected: PASS (23 tests)

Run: `npm test -w apps/web`
Expected: PASS (373 tests)

- [x] **Step 14: A second Playwright server, in first-run mode**

The shared Playwright server (`web-server.ts`) always has a GitHub App, so it can never be in first-run mode. Rather than add a "no credentials" switch to it (and risk the other 19 specs), the first-run spec gets a server of its own: port 4321 for the app, port 4322 for the tests' control API, which is also the stand-in for github.com (the page posts its manifest form there; it records the post and sends the browser straight back to the callback, as GitHub does after "Create GitHub App"). GitHub's API half (trading the code for the app) is a fake fetch. Its own database keeps its stored app away from the shared server's tables.

A real server exits after storing its app and Docker starts it again. Here `exit` takes the server "down" (every request answers 502 plain text, as Caddy does while the container restarts), and the test's `POST /restart` brings it up in ready mode, reading the app it stored (`loadGithubApp` then `setGithubApp`, as `main.ts` does at boot). The test decides when, so "Restarting the server…" is always seen, and the down phase exercises "a failed fetch means keep waiting".

In `apps/web/e2e/ports.ts`:

```diff
--- a/apps/web/e2e/ports.ts
+++ b/apps/web/e2e/ports.ts
@@ -4,3 +4,10 @@ export const WEB_PORT = 4319;
 export const CONTROL_PORT = 4320;
 export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
 export const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;
+
+// The second server, in first-run mode (apps/server/test/e2e/first-run-server.ts), for first-run.spec.ts: the app on
+// one port, and on the other the tests' control API, which is also the stand-in for github.com.
+export const FIRST_RUN_WEB_PORT = 4321;
+export const FIRST_RUN_CONTROL_PORT = 4322;
+export const FIRST_RUN_BASE_URL = `http://127.0.0.1:${FIRST_RUN_WEB_PORT}`;
+export const FIRST_RUN_CONTROL_URL = `http://127.0.0.1:${FIRST_RUN_CONTROL_PORT}`;
```

Create `apps/server/test/e2e/first-run-server.ts`:

```ts
/**
 * The server apps/web/e2e/first-run.spec.ts talks to: a server in first-run mode (no GitHub App in the environment or
 * its database), on a fixed port, serving the built web app. It runs next to web-server.ts (the normal-mode server
 * every other spec uses), with its own database, so neither disturbs the other.
 *
 * Its second port, on 127.0.0.1 only, is both the tests' control API and a stand-in for github.com: the first-run page
 * posts its manifest form there, and the stand-in records it and sends the browser straight back to the callback, as
 * GitHub does after "Create GitHub App". GitHub's API half (trading the code for the app) is a fake fetch.
 *
 * A real server exits after storing the app and Docker starts it again in normal mode. Here `exit` takes the server
 * "down" (every request answers 502, as Caddy does while the container restarts) until the test calls /restart, which
 * brings it back in ready mode, reading the app it stored. The test decides when, so "Restarting…" is always seen.
 *
 * Run by hand: E2E_FIRST_RUN_WEB_PORT=4321 E2E_FIRST_RUN_CONTROL_PORT=4322 npm run e2e:first-run-server -w apps/server
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import setupTestDatabase from '../global-setup';
import { testDatabaseUrl } from '../test-database';
import { TEST_ENV } from '../test-env';

const webPort = Number(process.env.E2E_FIRST_RUN_WEB_PORT);
const controlPort = Number(process.env.E2E_FIRST_RUN_CONTROL_PORT);
if (!webPort || !controlPort) throw new Error('Set E2E_FIRST_RUN_WEB_PORT and E2E_FIRST_RUN_CONTROL_PORT (apps/web/playwright.config.ts does).');

/** The code the server would print in its log; the spec types it. */
const SETUP_CODE = 'E2EF-RSTR';
const publicUrl = `http://127.0.0.1:${webPort}`;
/** Where "github.com" is for this server: the control port. */
const githubWeb = `http://127.0.0.1:${controlPort}`;

// A database of its own (nitpilot_test → nitpilot_first_run_test), created and migrated like the test one, so this
// server's stored app never meets web-server.ts's tables.
const firstRunUrl = testDatabaseUrl(process.env.DATABASE_URL!).replace(/_test(\?|$)/, '_first_run_test$1');
process.env.DATABASE_URL = firstRunUrl;
await setupTestDatabase();
// No GitHub App in the environment: blank, all six, is "not set" (lib/env.ts), which is what makes it first-run mode.
const noApp = { GITHUB_APP_ID: '', GITHUB_APP_SLUG: '', GITHUB_APP_PRIVATE_KEY: '', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', GITHUB_WEBHOOK_SECRET: '' };
Object.assign(process.env, TEST_ENV, noApp, { PUBLIC_URL: publicUrl, DATABASE_URL: firstRunUrl });

// Only now load the server's modules: the database client reads DATABASE_URL when it's first imported.
const { createFirstRunApp } = await import('../../src/http/app');
const { spaRoutes } = await import('../../src/http/spa');
const { getEnv } = await import('../../src/lib/env');
const { prisma } = await import('../../src/lib/prisma');
const { GithubClient } = await import('../../src/platform/github/client');
const { loadGithubApp, setGithubApp } = await import('../../src/setup/credentials');
const { readyRoutes } = await import('../../src/setup/first-run');
const { fakeFetch } = await import('../fake-fetch');

const webDistDir = fileURLToPath(new URL('../../../web/dist', import.meta.url));

/** The code the stand-in GitHub sends back, and what GitHub's API answers for it: the new app and its secrets. */
const GITHUB_CODE = 'e2e-manifest-code';
const NEW_APP_SLUG = 'nitpilot-e2e';
const github = new GithubClient(
  fakeFetch({
    [`POST /app-manifests/${GITHUB_CODE}/conversions`]: () => ({
      id: 777,
      slug: NEW_APP_SLUG,
      client_id: 'Iv23.e2e',
      client_secret: 'e2e-client-secret',
      webhook_secret: 'e2e-webhook-secret',
      pem: '-----BEGIN RSA PRIVATE KEY-----\ne2e\n-----END RSA PRIVATE KEY-----\n',
      owner: { login: 'maya' },
    }),
  }),
  'https://api.github.com',
  githubWeb,
);

type Handler = (req: Request) => Response | Promise<Response>;

/** Fresh first-run mode: nothing stored, no pending state, no tries counted. */
function firstRunMode(): Handler {
  return createFirstRunApp({ github, publicUrl, setupCode: SETUP_CODE, trustProxy: false, exit: goDown, webDistDir }).fetch;
}

/** While the container restarts, the proxy in front of it answers for it. */
const down: Handler = () => new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } });

/**
 * Normal mode, as far as the first-run page can tell: the server read its stored app at boot (as main.ts does) and
 * answers `ready` with where to install it. The rest of normal mode isn't needed here (web-server.ts is that).
 */
async function readyMode(): Promise<Handler> {
  const found = await loadGithubApp(getEnv());
  if (!found) throw new Error('restart: no GitHub App was stored');
  setGithubApp(found.creds);
  const app = new Hono();
  app.route('/', readyRoutes({ github }));
  app.route('/', spaRoutes({ distDir: webDistDir, publicUrl }));
  return app.fetch;
}

let current: Handler = firstRunMode();
function goDown(): void {
  current = down;
}

await prisma.githubAppConfig.deleteMany();
serve({ fetch: (req) => current(req), port: webPort, hostname: '127.0.0.1' });

/** What the stand-in GitHub received last: where the form was posted, and the manifest in it. */
let lastPost: { path: string; state: string | null; manifest: unknown } | null = null;

const control = new Hono();
/**
 * GitHub's "Create GitHub App" page, for a person's account or an organization. GitHub would show the app filled in
 * from the manifest; the stand-in records it and goes straight to the end: back to the manifest's `redirect_url`
 * with a code and the same `state`.
 */
const createApp = async (c: Context) => {
  const form = await c.req.parseBody();
  const manifest = JSON.parse(String(form.manifest)) as { redirect_url: string };
  const state = c.req.query('state') ?? null;
  lastPost = { path: c.req.path, state, manifest };
  return c.redirect(`${manifest.redirect_url}?code=${GITHUB_CODE}&state=${encodeURIComponent(state ?? '')}`);
};
control.post('/settings/apps/new', createApp);
control.post('/organizations/:org/settings/apps/new', createApp);
/** Answers what the stand-in GitHub was last sent. */
control.get('/last-post', (c) => c.json(lastPost));
/** The restart Docker does: back up, in normal mode, with the app the callback stored. */
control.post('/restart', async (c) => {
  current = await readyMode();
  return c.body(null, 204);
});
/** Back to a fresh server in first-run mode: what each test starts from. */
control.post('/reset', async (c) => {
  await prisma.githubAppConfig.deleteMany();
  setGithubApp(null);
  lastPost = null;
  current = firstRunMode();
  return c.body(null, 204);
});
// 127.0.0.1 only: nothing outside this machine can reach the stand-in or the control API.
serve({ fetch: control.fetch, port: controlPort, hostname: '127.0.0.1' });

console.log(`[first-run-e2e] first-run mode on ${publicUrl}, stand-in GitHub and control API on ${githubWeb}`);

const stop = async () => {
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

In `apps/server/package.json`, next to `e2e:web-server`:

```diff
--- a/apps/server/package.json
+++ b/apps/server/package.json
@@ -14,6 +14,7 @@
     "test:db": "vitest run --project db",
     "test:e2e": "vitest run --project e2e",
     "e2e:web-server": "tsx test/e2e/web-server.ts",
+    "e2e:first-run-server": "tsx test/e2e/first-run-server.ts",
     "dev": "tsx watch src/main.ts",
     "start": "tsx src/main.ts",
     "dev:tunnel": "tsx scripts/dev-tunnel.ts",
```

In `apps/web/playwright.config.ts` (`webServer` becomes an array; both servers start before the first test):

```diff
--- a/apps/web/playwright.config.ts
+++ b/apps/web/playwright.config.ts
@@ -1,5 +1,5 @@
 import { defineConfig, devices } from '@playwright/test';
-import { BASE_URL, CONTROL_PORT, WEB_PORT } from './e2e/ports';
+import { BASE_URL, CONTROL_PORT, FIRST_RUN_BASE_URL, FIRST_RUN_CONTROL_PORT, FIRST_RUN_WEB_PORT, WEB_PORT } from './e2e/ports';
 
 export default defineConfig({
   testDir: './e2e',
@@ -15,13 +15,24 @@ export default defineConfig({
     trace: 'retain-on-failure',
   },
   projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
-  // The server for these tests: apps/server/test/e2e/web-server.ts.
-  webServer: {
-    command: 'npm run e2e:web-server -w apps/server',
-    cwd: '../..',
-    url: `${BASE_URL}/healthz`,
-    env: { E2E_WEB_PORT: String(WEB_PORT), E2E_CONTROL_PORT: String(CONTROL_PORT) },
-    reuseExistingServer: !process.env.CI,
-    timeout: 60_000,
-  },
+  // The servers for these tests: apps/server/test/e2e/web-server.ts for every spec, and first-run-server.ts (a server
+  // with no GitHub App yet) for first-run.spec.ts, which points its baseURL there. They start side by side.
+  webServer: [
+    {
+      command: 'npm run e2e:web-server -w apps/server',
+      cwd: '../..',
+      url: `${BASE_URL}/healthz`,
+      env: { E2E_WEB_PORT: String(WEB_PORT), E2E_CONTROL_PORT: String(CONTROL_PORT) },
+      reuseExistingServer: !process.env.CI,
+      timeout: 60_000,
+    },
+    {
+      command: 'npm run e2e:first-run-server -w apps/server',
+      cwd: '../..',
+      url: `${FIRST_RUN_BASE_URL}/healthz`,
+      env: { E2E_FIRST_RUN_WEB_PORT: String(FIRST_RUN_WEB_PORT), E2E_FIRST_RUN_CONTROL_PORT: String(FIRST_RUN_CONTROL_PORT) },
+      reuseExistingServer: !process.env.CI,
+      timeout: 60_000,
+    },
+  ],
 });
```

- [x] **Step 15: The Playwright spec**

Two tests: every other page sends you to the setup page (and from the link, the form is there); and the whole path: a wrong code is said on the field and what was typed stays, the right code posts the manifest to the stand-in GitHub (checked: the post went to `/settings/apps/new`, `state` is 43 URL-safe characters, the manifest has the name, `public: false`, the redirect URL and the webhook URL), the browser lands on `?done=1` with "Restarting the server…", the test restarts the server, and the page shows "Your GitHub App is ready" with Install and Sign in. Each test starts from `POST /reset` (a fresh first-run server), and `pageProblems` fails a test that logged a console error or a blocked request, which is what would catch the browser refusing the form post.

Create `apps/web/e2e/first-run.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { pageProblems } from './control';
import { FIRST_RUN_BASE_URL, FIRST_RUN_CONTROL_URL } from './ports';

// A server with no GitHub App yet (apps/server/test/e2e/first-run-server.ts, spec §10 "First-run mode"), not the
// server the other specs share. Its control port is also the stand-in for github.com.
test.use({ baseURL: FIRST_RUN_BASE_URL });

const SETUP_CODE = 'E2EF-RSTR';

async function control(path: string, method = 'POST'): Promise<Response> {
  const res = await fetch(`${FIRST_RUN_CONTROL_URL}${path}`, { method });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

test.beforeEach(async () => {
  await control('/reset');
});

test('every other page sends you to the setup page', async ({ page }) => {
  const problems = pageProblems(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: "This server isn't set up yet" })).toBeVisible();
  await expect(page.getByText('Finish setup at /first-run.')).toBeVisible();
  await page.getByRole('link', { name: 'Open the setup page' }).click();
  await expect(page).toHaveURL(`${FIRST_RUN_BASE_URL}/first-run`);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('the setup code, the form post to GitHub, the restart, then Install and Sign in', async ({ page }) => {
  const problems = pageProblems(page);
  await page.goto('/first-run');
  const code = page.getByRole('textbox', { name: 'Setup code' });
  await expect(page.getByRole('textbox', { name: 'App name' })).toHaveValue('Nitpilot (127.0.0.1:4321)');

  // A wrong code: said on the field, and what was typed stays.
  await code.fill('E2EF-WRNG');
  await page.getByRole('button', { name: 'Create GitHub App' }).click();
  await expect(page.getByText("That code doesn't match the one in the server's log.")).toBeVisible();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(code).toHaveValue('E2EF-WRNG');

  // The right one: the browser posts the manifest to "GitHub", which sends it back to the callback, then to ?done=1.
  await code.fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Create GitHub App' }).click();
  await expect(page).toHaveURL(`${FIRST_RUN_BASE_URL}/first-run?done=1`);
  await expect(page.getByRole('status')).toHaveText(/Restarting the server…/);

  const posted = (await (await control('/last-post', 'GET')).json()) as { path: string; state: string; manifest: Record<string, unknown> };
  expect(posted.path).toBe('/settings/apps/new');
  expect(posted.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(posted.manifest).toMatchObject({
    name: 'Nitpilot (127.0.0.1:4321)',
    public: false,
    redirect_url: `${FIRST_RUN_BASE_URL}/first-run/callback`,
    hook_attributes: { url: `${FIRST_RUN_BASE_URL}/webhooks/github`, active: true },
  });

  // Docker starts the server again; the page, asking every 2 seconds, sees it ready.
  await control('/restart');
  await expect(page.getByRole('heading', { level: 1, name: 'Your GitHub App is ready' })).toBeVisible({ timeout: 6_000 });
  await expect(page.getByRole('link', { name: 'Install the app on your repos' })).toHaveAttribute('href', `${FIRST_RUN_CONTROL_URL}/apps/nitpilot-e2e/installations/new`);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/github/login');

  // Nothing was blocked on the way, including the form post to another origin (the CSP's form-action allows it).
  expect(problems).toEqual([]);
});
```

Run: `npm run build -w apps/web && (cd apps/web && CI=1 npx playwright test first-run)`
Expected: PASS (2 passed). (`CI=1` makes Playwright start its own servers instead of reusing one from an earlier run.)

- [x] **Step 16: Prove the spec can fail**

The spec was written after the page it tests, so it never failed on its own. Break the one thing it exists to guard, the content security policy that lets the page post a form to GitHub. In `apps/server/src/http/app.ts` (line 103), temporarily change `formActions: [deps.github.webBase]` to `formActions: []`.

Run: `(cd apps/web && CI=1 npx playwright test first-run)`
Expected: FAIL, 1 failed | 1 passed. The second test: `Error: expect(page).toHaveURL(expected) failed`, `Expected: "http://127.0.0.1:4321/first-run?done=1"`, `Received: "http://127.0.0.1:4321/first-run"` (the browser refused the post to the stand-in GitHub).

Then put it back: `git checkout apps/server/src/http/app.ts`, and run the same command again.
Expected: PASS (2 passed).

- [x] **Step 17: The spec (§10)**

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md`, in the "First-run mode" block: the callback bullet, the "With an app" bullet, and a new bullet for the page:

```diff
--- a/docs/superpowers/specs/2026-10-07-nitpilot-design.md
+++ b/docs/superpowers/specs/2026-10-07-nitpilot-design.md
@@ -311,9 +311,10 @@ The message envelope is `{ v: 1, t: "<type>", id?, re?, d: {…} }`, a zod discr
 **First-run mode (Plan 3, §17 "Self-hosting")**, a server with no GitHub App in the environment or the database:
 - `GET /api/first-run` answers `{mode: 'first_run', publicUrl}`.
 - `POST /api/first-run/manifest {code, owner: {kind: 'user'} | {kind: 'org', login}, name, isPublic}` answers `{action, manifest}`: the manifest (§15's events and permissions, every URL built from `PUBLIC_URL`) and where the page posts it as a form (`https://github.com/settings/apps/new?state=…`, or `/organizations/<login>/settings/apps/new?state=…`). `state` is 32 random bytes, kept in memory for an hour and good for one callback. Each client address gets 5 tries a minute (the 6th is a 429 `rate_limited`, counted before the code is looked at); a wrong or missing setup code is a 403 `setup_code`, before the rest of the body is checked; `name` is 1 to 34 characters.
-- `GET /first-run/callback?code&state` (GitHub sends the browser here): a missing, unknown, expired or used `state` is a 400 and nothing is stored. Then `POST /app-manifests/{code}/conversions` (no token); GitHub refusing the code is a 400, GitHub failing or leaving out a secret is a 502 `github_unavailable`. The app is stored encrypted (§8 `GithubAppConfig`); one already there is a 409. Then a redirect to `/first-run?done=1`, and the process exits with 0 half a second later; Docker starts it again in normal mode.
+- `GET /first-run/callback?code&state` (GitHub sends the browser here). It's a browser navigation, so every failure is a 302 back to the page, `/first-run?error=<problem>`, with nothing stored and the process kept running: a missing, unknown, expired or used `state` is `expired`. Then `POST /app-manifests/{code}/conversions` (no token); GitHub refusing the code is `expired` too, GitHub failing or leaving out a secret is `github`. The app is stored encrypted (§8 `GithubAppConfig`); one already there is `exists` (the page asks the person to delete the extra app GitHub just made). On success, a redirect to `/first-run?done=1`, and the process exits with 0 half a second later; Docker starts it again in normal mode.
 - Everything else under the server's paths (`/api/*`, `/auth/*`, `/github/*`, `/webhooks/*`, `/ws/*`, any method) answers 503 `{error: {code: 'first_run', message: 'Finish setup at /first-run.'}}`; `/healthz` still answers, and the web app's pages are still served, with `form-action` also allowing GitHub. WebSocket upgrades get a 404.
-- With an app, `GET /api/first-run` answers `{mode: 'ready', installUrl: 'https://github.com/apps/<slug>/installations/new'}`, and the other two are a JSON 404.
+- With an app, `GET /api/first-run` answers `{mode: 'ready', installUrl: 'https://github.com/apps/<slug>/installations/new'}`, the manifest route is a JSON 404, and the callback redirects to `/first-run?error=exists`.
+- The page `/first-run` (web app, `routes/FirstRun`): in first-run mode the form (setup code, the account or organization, the app's name, who can install it), then a real form post of the manifest to GitHub; on `?done=1` it polls `GET /api/first-run` every 2 s while the server restarts, then offers Install and Sign in; on `?error=` it says what went wrong and offers to start again. Every other page, while `/api/me` answers 503 `first_run`, shows only a link to `/first-run`.
 
 **REST endpoints in Plan 1**
 - Webhooks: `POST /webhooks/github`
```

- [x] **Step 18: The explainers**

In `docs/why/first-run-and-app-manifests.md` (the `state` paragraph, the one-row paragraph, and the file list):

```diff
--- a/docs/why/first-run-and-app-manifests.md
+++ b/docs/why/first-run-and-app-manifests.md
@@ -34,7 +34,7 @@ The code is 8 characters from 31 letters and digits (no `0`/`O` or `1`/`I`/`L`,
 
 ## Why `state`
 
-The callback is a plain URL that anyone can open. `state` is 32 random bytes the server handed out with the manifest, kept in memory for an hour, and good for one callback. A callback with a missing, wrong, expired or already used `state` is refused and nothing is stored. So the only way to reach step 5 is to have started at step 2, with the setup code. It's the same idea as the `state` in "Sign in with GitHub" (docs/why/oauth-pkce.md).
+The callback is a plain URL that anyone can open. `state` is 32 random bytes the server handed out with the manifest, kept in memory for an hour, and good for one callback. A callback with a missing, wrong, expired or already used `state` is refused and nothing is stored. Because the callback is a page load in the person's browser, not a `fetch`, "refused" is a redirect back to `/first-run?error=expired`, where the page says what happened and offers "Start again" (a JSON error would be a blank tab with `{"error":…}` in it). GitHub failing is `?error=github`. So the only way to reach step 5 is to have started at step 2, with the setup code. It's the same idea as the `state` in "Sign in with GitHub" (docs/why/oauth-pkce.md).
 
 ## Why the credentials are encrypted, and why a changed key stops the server
 
@@ -42,7 +42,7 @@ The private key and the two secrets are stored with AES-256-GCM under `ENCRYPTIO
 
 GCM refuses to decrypt with any other key than the one that encrypted. If `ENCRYPTION_KEY` changes (a new `.env` without the old value), the stored app can't be read. The server then **refuses to start** with "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with." It never falls back into first-run mode: the app still exists on GitHub with every installation, and making a second one would strand them. Putting the old key back fixes it. That's why `.env.example` says to keep a copy of the key.
 
-There is only ever one row (`id = 'app'`), and it's insert-only: a second callback (two tabs, say) gets 409 and the first app stays.
+There is only ever one row (`id = 'app'`), and it's insert-only: a second callback (two tabs, say) stores nothing, the first app stays, and the browser lands on `/first-run?error=exists`, which asks the person to delete the extra app GitHub just made.
 
 ## Why the server exits instead of switching modes in place
 
@@ -58,6 +58,7 @@ If the six `GITHUB_*` variables are set (development with `nitpilot-dev`, or any
 - `apps/server/src/setup/manifest.ts`: `buildManifest`, `manifestFormAction`.
 - `apps/server/src/setup/setup-code.ts`: `makeSetupCode`, `setupCodeMatches`.
 - `apps/server/src/setup/first-run.ts`: the three routes (`firstRunRoutes`), and `readyRoutes` for a server that has its app.
+- `apps/web/src/routes/FirstRun/FirstRun.tsx`: the page (the form, the form post to GitHub, "Restarting the server…", the `?error=` messages); `apps/web/src/routes/Home/Home.tsx` shows a link to it on every other page while `/api/me` answers 503 `first_run`.
 - `apps/server/src/setup/boot.ts`: `startFirstRun`, which prints the code. `apps/server/src/main.ts` picks the mode.
 - `apps/server/src/http/app.ts`: `createFirstRunApp`, the 503 for everything else.
 - `apps/server/prisma/schema.prisma`: the `GithubAppConfig` model.
```

In `docs/why/end-to-end-test.md` (the second server, and the port note):

```diff
--- a/docs/why/end-to-end-test.md
+++ b/docs/why/end-to-end-test.md
@@ -22,13 +22,15 @@ It takes a few seconds and starts many programs, so `npm test` leaves it out. CI
 
 Plan 2 adds a second end-to-end suite: Playwright drives a real Chromium against the same setup (`apps/server/test/e2e/web-server.ts` serves the built web app, plus a small control API the tests use to sign people in, open PRs and start CLIs). Its specs (`apps/web/e2e/*.spec.ts`) cover the four flows of spec §19 (the inbox opens, a chat updates live while agents work, Resolve on an escalation, Send on a draft), plus the read-only view and the not-found page for someone who can't see the repo, and the landing, PWA, Settings, Setup and device-approval pages. Each test resets the chats and opens its own PR, so any one spec file passes on its own.
 
+One spec talks to a second server: `first-run.spec.ts` needs a server with no GitHub App yet (first-run mode, docs/why/first-run-and-app-manifests.md), which the shared one can never be. `apps/server/test/e2e/first-run-server.ts` starts one beside it, on port 4321 with its own database, and its control port (4322, on 127.0.0.1 only) also plays github.com: the page's manifest form is posted there, and it sends the browser straight back to the callback. Instead of exiting after the callback, it answers 502 like a proxy whose server is restarting, until the test calls `/restart`.
+
 - **One worker.** All tests share one server and one database, so they run one at a time; two at once would reset each other's chats.
 - **No sleeps.** A test never waits a fixed time ("wait 2 seconds"): it waits for something it can see (`await expect(page.getByText('Ready for your approval')).toBeVisible()`), which Playwright keeps retrying until it shows or times out. A fixed wait is either too short on a slow CI machine (a flaky failure) or wasted time on a fast one.
 - **No retries.** A test that fails is a finding: it gets fixed at its cause, not run again until it passes. A stray `test.only` fails CI (`forbidOnly`).
 - **The browser cache.** CI keeps Playwright's Chromium in `~/.cache/ms-playwright` between runs, keyed on the Playwright version, so most runs skip the ~150 MB download and only install the system libraries Chromium needs.
 - **The trace upload.** A failed test keeps a trace (every action, network request, console line and a DOM snapshot at each step). CI uploads `apps/web/test-results/` as the `playwright-traces` artifact; open one with `npx playwright show-trace trace.zip` to watch what the browser saw, like Redux DevTools' time travel, for a whole test.
 
-Locally: `npm run test:web-e2e` (it builds the web app first). If a server from an earlier run is still on port 4319, Playwright reuses it, except on CI.
+Locally: `npm run test:web-e2e` (it builds the web app first). If a server from an earlier run is still on port 4319 (or 4321), Playwright reuses it, except on CI.
 
 ## The React analogy
 
```

- [x] **Step 19: The bundle check**

Vite warns when a chunk is over 500 kB, and the main chunk sat at 497.79 kB before this task (carry-forward: "the main bundle's margin").

Run: `npm run build -w apps/web`
Expected: no `Some chunks are larger than 500 kB` warning. `dist/assets/index-*.js` 499.08 kB (gzip 152.32 kB), plus the page's own chunk `FirstRun-*.js` about 10.3 kB and `FirstRun-*.css` 4.15 kB. The page and its form are in the lazy chunk; the main chunk grew by about 1.3 kB only for `FirstRunNeeded`, `isFirstRunMode`, `ApiError.details` and the route.

That leaves about 0.9 kB of margin: the next task that adds anything to the main chunk will trip the warning. If the warning shows up here, or in a later task: make `Settings` a lazy route as `Approve` and `Setup` already are. In `apps/web/src/app.tsx`, remove `import { Settings } from './routes/Settings/Settings';`, add `const Settings = lazy(() => import('./routes/Settings/Settings').then((module) => ({ default: module.Settings })));` next to the other three, and wrap the element: `<Route path="settings" element={<Suspense fallback={null}><Settings /></Suspense>} />`. Settings' tests render the whole app, so they keep passing; run them and the build again.

- [x] **Step 20: Look at it in the in-app browser (the controller does this; the implementer reports and stops)**

Build the web app, start a first-run server by hand on spare ports, and open it:

```bash
npm run build -w apps/web
E2E_FIRST_RUN_WEB_PORT=4331 E2E_FIRST_RUN_CONTROL_PORT=4332 npm run e2e:first-run-server -w apps/server
```

Setup code: `E2EF-RSTR`. Open `http://127.0.0.1:4331/first-run`. Check, in the light and the dark theme, at desktop width and at 375 px:
1. `/` shows "This server isn't set up yet" with its link; the link goes to the form.
2. The form: light and dark; with "An organization" picked (the Organization field appears) and a validation error showing; a wrong-code error after "Create GitHub App" (the field keeps the typed text and has the focus); nothing wraps awkwardly (the inline `docker compose logs nitpilot` stays on one line on the phone).
3. After a right code, the browser goes to the stand-in GitHub (port 4332) and back to "Restarting the server…" (a phone-width look); `curl -X POST http://127.0.0.1:4332/restart` moves it to "Your GitHub App is ready" with Install the app on your repos and Sign in stacked, not side by side.
4. `/first-run?error=exists` and `?error=github` (phone, dark): the message, the "delete the app GitHub made" hint with the path through GitHub's settings, and "Start again".
5. After the restart, `/first-run` shows "This server is set up".

Stop the server by its PID when done. Fix anything that looks off in the CSS and re-run Step 13's tests; add a line to the Task's report for each fix.

- [x] **Step 21: Full suite, tick, ledger, commit**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e && CI=1 npm run test:web-e2e`
Expected: protocol 88, CLI 349 + 14 skipped, server 1107, web 373, root 6, e2e 6, Playwright 21, typecheck and lint clean. (Server +1: the old "refuse another app with a JSON 404" test became two tests. Web +29: FirstRun 23, Home 3, client 2, Approve 1. Playwright +2: the two first-run specs.)

Tick this task's boxes, append `Task 8: complete` (plus any `Ruling:` lines) to the ledger, then:

```bash
git add apps/server/src/setup/first-run.ts apps/server/src/setup/first-run.db.test.ts apps/server/package.json apps/server/test/e2e/first-run-server.ts packages/protocol/src/web-api.ts apps/web/src/api/client.ts apps/web/src/api/client.test.ts apps/web/src/api/first-run.ts apps/web/src/lib/browser.ts apps/web/src/app.tsx apps/web/src/components/FirstRunNeeded apps/web/src/routes/FirstRun apps/web/src/routes/Home/Home.tsx apps/web/src/routes/Home/Home.test.tsx apps/web/src/routes/Approve/Approve.tsx apps/web/src/routes/Approve/Approve.test.tsx apps/web/e2e/first-run.spec.ts apps/web/e2e/ports.ts apps/web/playwright.config.ts docs/superpowers/specs/2026-10-07-nitpilot-design.md docs/why/first-run-and-app-manifests.md docs/why/end-to-end-test.md docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
git commit -m "feat(web): the first-run page

/first-run, a lazy page of its own: the setup form (code, owner, name,
who can install), a real form post of the manifest to GitHub, \"Restarting
the server…\" polling every 2 s on ?done=1, then Install and Sign in, and a
message plus Start again for each ?error=. While /api/me answers 503
first_run, Home and the approve page show only a link to /first-run.

The callback's failures now redirect to /first-run?error=expired|github|
exists instead of JSON 400/409/502 (a ready server's callback too).
Playwright gets a second server in first-run mode with a stand-in GitHub.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: `deploy/self-host/`, the docs, and the clean-folder run

**What this task is.** Self-hosting for a team: a folder with three files (`docker-compose.yml`, `Caddyfile`, `.env.example`) that starts the published image, Postgres and Caddy; the docs that walk a stranger through it; two explainers. There is no code to unit-test here (the one code edit is a comment), so the proof is two runs: first **locally from a clean folder with an image built on this Mac** (Step 3, no GitHub, no GHCR), then **live from a clean folder with the real `0.1.0-rc.2` image from GHCR through the dev tunnel** (Step 7, a real GitHub App made through the first-run page, a real review). Step 3 comes first and must pass before anything is pushed.

**Why Compose, Caddy and Postgres in three containers (the React-dev version).** Compose is a `package.json` for running several programs together: one file lists them, `docker compose up -d` starts them all, each can reach the others by its service name (`postgres`, `nitpilot`) like an import path that only works inside this project. Caddy is the front door that does HTTPS; see [docs/why/reverse-proxy-and-tls.md](../../why/reverse-proxy-and-tls.md) (written in Step 4). The names `.env` and `${VAR:?message}` work like environment variables in Vite: one file of settings, and a message that stops the build when a required one is empty.

**Files:**
- Create: `deploy/self-host/docker-compose.yml`, `deploy/self-host/Caddyfile`, `deploy/self-host/.env.example`, `docs/self-hosting.md`, `docs/why/reverse-proxy-and-tls.md`, `docs/why/dns-records.md`
- Modify: `apps/server/src/lib/env.ts` (the `TRUST_PROXY` doc comment only, no behaviour change), `docs/why/trusting-a-proxy.md`, `docs/superpowers/specs/2026-10-07-nitpilot-design.md` (§17 Self-hosting, two bullets), this plan (ticks and ledger)

**Interfaces:**
- Consumes: the image from Task 5 (`ghcr.io/nikosgkikas13/nitpilot:<NITPILOT_VERSION>`; `CMD` runs `prisma migrate deploy` then the server from `/app/apps/server`; the `HEALTHCHECK` asks `/healthz`), the release workflow from Task 6 (a `v0.1.0-rc.2` tag pushes `:0.1.0-rc.2` only), first-run mode and the setup code from Task 7, the `/first-run` page from Task 8, `TRUST_PROXY` and `clientAddress` from Task 2 (the last `X-Forwarded-For` entry is the visitor).
- Produces: the `deploy/self-host/` folder that the docs, the live run and (copied by hand) the hosted instance's compose in Task 11 build on; `docs/self-hosting.md` (README links to it in Task 14); the `TRUSTED_PROXIES` knob (empty by default) that Step 7 uses behind the dev tunnel.
- Environment variables the compose file reads (all from `.env`): required `NITPILOT_DOMAIN`, `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`; optional `SITE_ADDRESS`, `TRUSTED_PROXIES`, `NITPILOT_VERSION`. The whole `.env` is also handed to the server (`env_file`), so the server's own optional settings (VAPID trio, `ALLOWED_LOGINS`, `CLOSED_CHAT_RETENTION_DAYS`, `GITHUB_*`) work by adding a line.

---

- [x] **Step 1: Create the three files and the one comment edit**

Create `deploy/self-host/docker-compose.yml` with exactly this content:

```yaml
# Nitpilot on your own server: the published image, Postgres and Caddy (spec §17 "Self-hosting", docs/self-hosting.md).
#
#   cp .env.example .env     then fill in the three required values
#   docker compose up -d
#   docker compose logs nitpilot     the setup code for https://<your domain>/first-run
#
# Only Caddy is reachable from outside (ports 80 and 443). Nitpilot and Postgres talk on the private network Compose
# makes for this folder, where each service's name is its address (`postgres`, `nitpilot`), like an import path that
# only works inside this project (docs/why/reverse-proxy-and-tls.md).

services:
  nitpilot:
    image: ghcr.io/nikosgkikas13/nitpilot:${NITPILOT_VERSION:-latest}
    # A tiny init process in front of node, so `docker compose stop` / `up -d` (SIGTERM) reaches the server and it shuts
    # down cleanly, telling each CLI "server restarting" (docs/why/docker-images.md).
    init: true
    # Also how first-run mode finishes: after storing the new GitHub App the server exits with 0 and Docker starts it
    # again, in normal mode (docs/why/first-run-and-app-manifests.md). Only `docker compose stop` / `down` keep it down.
    restart: unless-stopped
    # The whole .env goes in, not a hand-picked list, so every optional setting (VAPID keys, ALLOWED_LOGINS, GITHUB_*
    # for an app made by hand, ...) works by adding a line to .env, with no edit here. The extras it also carries
    # (POSTGRES_PASSWORD, NITPILOT_DOMAIN, ...) are harmless: the server ignores names it doesn't know, and the password
    # is in DATABASE_URL anyway. Postgres and Caddy get only what they need, below, never ENCRYPTION_KEY.
    env_file: .env
    # These win over .env (Compose's `environment` beats `env_file`): they're built from .env's values, not typed twice.
    # `${NAME:?message}` stops `docker compose up` (and `config`) with the message when NAME is empty or missing.
    environment:
      DATABASE_URL: postgresql://nitpilot:${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env (openssl rand -hex 24)}@postgres:5432/nitpilot
      PUBLIC_URL: https://${NITPILOT_DOMAIN:?set NITPILOT_DOMAIN in .env (e.g. nitpilot.example.com)}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:?set ENCRYPTION_KEY in .env (openssl rand -base64 32)}
      # Every request reaches the server through Caddy, so the visitor's address is in X-Forwarded-For
      # (docs/why/trusting-a-proxy.md). Safe here because nothing but Caddy can reach the server: it has no port.
      TRUST_PROXY: "true"
    depends_on:
      postgres:
        # Wait for the healthcheck below, not just for the container to exist: the server runs its migrations at start.
        condition: service_healthy
    # No `ports:`: the server (8787) is reached only through Caddy. The image's own HEALTHCHECK (/healthz) applies.

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nitpilot
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env (openssl rand -hex 24)}
      POSTGRES_DB: nitpilot
    volumes:
      # The database lives in a named volume, so it survives `docker compose down` and new images. `down -v` deletes it.
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      # -h 127.0.0.1 asks over TCP. On its very first start Postgres runs a temporary server on its local socket only
      # (to create the database), then restarts; asking the socket would say "ready" too early.
      test: ["CMD", "pg_isready", "-h", "127.0.0.1", "-U", "nitpilot", "-d", "nitpilot"]
      interval: 5s
      timeout: 5s
      retries: 10
    # No `ports:`: only the server reaches the database.

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      # 80 and 443 must be open to the internet: Let's Encrypt checks the domain on them before giving Caddy a
      # certificate (docs/why/reverse-proxy-and-tls.md). 443/udp is HTTP/3.
      - "80:80"
      - "443:443"
      - "443:443/udp"
    environment:
      # What the Caddyfile serves: your domain (Caddy gets and renews its HTTPS certificate), or `:80` for plain HTTP
      # behind something else that already does HTTPS.
      SITE_ADDRESS: ${SITE_ADDRESS:-${NITPILOT_DOMAIN}}
      # Behind that other proxy only: its addresses, so Caddy believes the X-Forwarded-* headers it sends. Empty: nobody.
      TRUSTED_PROXIES: ${TRUSTED_PROXIES:-}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      # Caddy's certificates and keys. Keep them across restarts, or Caddy asks Let's Encrypt again each time and can
      # hit its rate limit.
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - nitpilot

volumes:
  postgres_data:
  caddy_data:
  caddy_config:
```

Why these choices, in short (the comments in the file say the rest):

- `${NAME:?message}` stops `docker compose up` and `config` with the message when `NAME` is empty. `ENCRYPTION_KEY` is also listed under `environment:` (it is already in `.env`, which `env_file` hands over) only so that a missing key fails at `docker compose up`, not later inside the container.
- `environment:` beats `env_file:`, so `DATABASE_URL` and `PUBLIC_URL` are built from `.env`'s three values and can't disagree with them.
- Only `caddy` has `ports:`. The server and Postgres are reachable only on Compose's private network.
- There is no top-level `name:`: the project is named after the folder. A fixed `name: nitpilot` would collide with this repo's own dev compose project (also `nitpilot`) on this Mac, and `docker compose down -v` in one could remove the other's volume.

Create `deploy/self-host/Caddyfile` with exactly this content:

```caddyfile
# Caddy: the front door (docs/why/reverse-proxy-and-tls.md). It answers on ports 80 and 443, does HTTPS, and passes
# every request on to the Nitpilot server. Both {$NAME} values come from .env, through docker-compose.yml.
{
	servers {
		# Only when SITE_ADDRESS=:80 behind another proxy that does HTTPS (TRUSTED_PROXIES in .env): believe the
		# X-Forwarded-For and X-Forwarded-Proto that proxy sends. Empty (the default) believes nobody, and Caddy writes
		# both headers itself from the connection it sees.
		trusted_proxies static {$TRUSTED_PROXIES}
		# Read X-Forwarded-For from the right, skipping the trusted proxies: the first address left is the visitor's.
		trusted_proxies_strict
	}
}

# SITE_ADDRESS is your domain (nitpilot.example.com): Caddy gets an HTTPS certificate for it from Let's Encrypt, renews
# it, and redirects http:// to https://. Or `:80`, which means "any name, port 80, plain HTTP": for when something in
# front already does HTTPS.
{$SITE_ADDRESS} {
	# WebSockets (/ws/cli, /ws/web) go through as they are, and Caddy sends the server X-Forwarded-For (who connected),
	# X-Forwarded-Proto (http or https) and the original Host: all by default, nothing to configure.
	reverse_proxy nitpilot:8787 {
		# The visitor alone, as the last entry the server reads (docs/why/trusting-a-proxy.md). Directly on the internet
		# that's what Caddy sends anyway; behind a trusted proxy Caddy would otherwise add that proxy's address last,
		# and every visitor would share its rate limit.
		header_up X-Forwarded-For {client_ip}
	}
}
```

The `servers { trusted_proxies … }` block and `header_up` are not in the task-level text. Without them, `SITE_ADDRESS=:80` behind another HTTPS proxy (the dev tunnel in Step 7, or any load balancer) sends sign-in into a redirect loop: Caddy overwrites `X-Forwarded-Proto` with `http`, and the server's sign-in route (`cameInElsewhere` in `http/routes/auth.ts`) redirects every http sign-in to `PUBLIC_URL`. Caddy also adds the outer proxy's address as the last `X-Forwarded-For` entry, which the server reads as the visitor, so every visitor would share one rate-limit bucket. Empty `TRUSTED_PROXIES` (the default) means Caddy trusts nobody, which is exactly what it did before. See [docs/why/trusting-a-proxy.md](../../why/trusting-a-proxy.md).

Create `deploy/self-host/.env.example` with exactly this content:

```bash
# Copy to .env next to docker-compose.yml and fill in the first three (docs/self-hosting.md). Keep .env private and
# keep a copy of it somewhere safe (a password manager): a database backup is useless without ENCRYPTION_KEY.

# Required: the domain people open, without https:// (its DNS A record must point at this server first).
NITPILOT_DOMAIN=
# Required: the database password. Make one with: openssl rand -hex 24
POSTGRES_PASSWORD=
# Required: encrypts GitHub tokens and the GitHub App's secrets. Make one with: openssl rand -base64 32 (never change it).
ENCRYPTION_KEY=

# Optional: what Caddy serves. Empty = NITPILOT_DOMAIN with automatic HTTPS; :80 = plain HTTP behind another HTTPS proxy.
SITE_ADDRESS=
# Optional, with SITE_ADDRESS=:80 only: that proxy's addresses (e.g. private_ranges), so Caddy believes its forwarded headers.
TRUSTED_PROXIES=
# Optional: the image version to run (e.g. 0.1.0). Empty = latest.
NITPILOT_VERSION=

# Optional, all three or none (push notifications in the browser). Keys: docker compose run --rm --no-deps nitpilot node -e "const k = require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + k.publicKey + '\nVAPID_PRIVATE_KEY=' + k.privateKey)"
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
# A contact for the push services: https://<your domain> or mailto:you@example.com
VAPID_SUBJECT=

# Optional: delete chats this many days after their PR closed. Empty = keep them forever.
CLOSED_CHAT_RETENTION_DAYS=
# Optional: comma-separated GitHub logins allowed to sign in. Empty = anyone can (each sees only repos they can read).
ALLOWED_LOGINS=

# No GITHUB_* here: the first-run page creates the GitHub App and the server stores it. If you made an app by hand,
# set all six GITHUB_* variables from apps/server/.env.example instead; they win over a stored app.
```

In `apps/server/src/lib/env.ts`, the `TRUST_PROXY` doc comment now also names the self-host compose. Replace

```ts
  /**
   * Hosted instance: this server sits behind our own reverse proxy (Caddy), which puts the real client address last in
   * X-Forwarded-For. Leave it false anywhere else, or anyone could fake their address (docs/why/trusting-a-proxy.md).
   */
  
```

with

```ts
  /**
   * Behind our own reverse proxy (Caddy: the hosted instance and deploy/self-host), which puts the real client address
   * last in X-Forwarded-For. Leave it false anywhere else, or anyone could fake their address (docs/why/trusting-a-proxy.md).
   */
  
```

(Comment only. `TRUST_PROXY` still defaults to `false` and the compose file sets it to `"true"`.)

- [x] **Step 2: Validate the compose file**

`docker compose config` renders the file with every `${…}` filled in and fails on a bad one. `.env.example` can't be used as-is, because its required values are empty on purpose and `${NAME:?…}` refuses them. First the failure, which is the safety working:

Run: from the repo root,
```bash
tmp=$(mktemp -d) && cp deploy/self-host/docker-compose.yml deploy/self-host/Caddyfile "$tmp" && cp deploy/self-host/.env.example "$tmp/.env" && docker compose --project-directory "$tmp" config --quiet; echo "exit=$?"; rm -rf "$tmp"
```
Expected: it prints one line starting `error while interpolating services.` and ending `required variable POSTGRES_PASSWORD is missing a value: set POSTGRES_PASSWORD in .env (openssl rand -hex 24)`, then `exit=1`. (Compose reports only the first missing variable; I saw it name `services.nitpilot.environment.DATABASE_URL`, the builder saw `services.postgres.environment.POSTGRES_PASSWORD`. Either is right.)

The copy goes to a temp folder because the compose file's `env_file: .env` needs a real `.env` next to it, and the repo's `deploy/self-host/` must stay free of one. Now the same with the three required values filled in:

Run:
```bash
tmp=$(mktemp -d) && cp deploy/self-host/docker-compose.yml deploy/self-host/Caddyfile "$tmp" && sed -e 's/^NITPILOT_DOMAIN=$/NITPILOT_DOMAIN=nitpilot.example.com/' -e 's/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=example/' -e 's/^ENCRYPTION_KEY=$/ENCRYPTION_KEY=example/' deploy/self-host/.env.example > "$tmp/.env" && docker compose --project-directory "$tmp" config --quiet; echo "exit=$?"; rm -rf "$tmp"
```
Expected: nothing on stderr, then `exit=0`. (Both runs verified on Docker 28.3.0 / Compose v2.38.1.)

- [x] **Step 3: The clean-folder run, locally, with an image built on this Mac**

This is the run to pass before anything is pushed. It uses the repo's `Dockerfile` as it is now (it contains Tasks 7 and 8, first-run mode), the three files from Step 1 copied into an empty folder (so nothing from the repo helps), and no GitHub and no GHCR: the only network use is Docker Hub for `postgres:16-alpine` and `caddy:2-alpine` (already in the local cache). The GitHub App the server needs is faked straight into the database; the real manifest round trip is Step 7's job. Docker Desktop must be running, and ports 80 and 443 free (`lsof -nP -iTCP:80 -iTCP:443 -sTCP:LISTEN` prints nothing).

**3a. Build the image and make the clean folder.** The tag `d3-scratch` is local only; `NITPILOT_VERSION` will point at it, so Compose finds it without pulling.

Run: `cd ~/Desktop/PracticeProjects/nitpilot && docker build -t ghcr.io/nikosgkikas13/nitpilot:d3-scratch .`
Expected: ends with `naming to ghcr.io/nikosgkikas13/nitpilot:d3-scratch` (about a minute, longer the very first time).

Run:
```bash
mkdir ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && cp ~/Desktop/PracticeProjects/nitpilot/deploy/self-host/{docker-compose.yml,Caddyfile,.env.example} . && ls -A
```
Expected: `.env.example  Caddyfile  docker-compose.yml`. (If `mkdir` says the folder exists, it is left from an earlier run: in it run `docker compose down -v`, then delete the folder, then try again.)

Fill `.env`. `sed -i ''` is macOS's spelling; the `$(…)` parts make fresh secrets that are never printed:

Run:
```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && cp .env.example .env && sed -i '' -e "s|^NITPILOT_DOMAIN=\$|NITPILOT_DOMAIN=localhost|" -e "s|^POSTGRES_PASSWORD=\$|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" -e "s|^ENCRYPTION_KEY=\$|ENCRYPTION_KEY=$(openssl rand -base64 32)|" -e "s|^SITE_ADDRESS=\$|SITE_ADDRESS=:80|" -e "s|^NITPILOT_VERSION=\$|NITPILOT_VERSION=d3-scratch|" .env && grep -c '=.' .env
```
Expected: a number above 5 (a sanity check that the file isn't empty; it was `11` in my run).

**3b. Start it, first-run mode.**

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose up -d`
Expected: three volumes and a network created, then `Container selfhost-postgres-1  Healthy`, `selfhost-nitpilot-1  Started`, `selfhost-caddy-1  Started` (about 6 seconds). The project name `selfhost` is the folder's name.

Run: `docker compose ps --format '{{.Service}} {{.Status}} {{.Ports}}'` (after about 10 seconds)
Expected: `postgres Up … (healthy) 5432/tcp`, `nitpilot Up … (healthy) 8787/tcp`, `caddy Up … 0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp, …443/udp`. Only Caddy publishes anything to the Mac; `5432/tcp` and `8787/tcp` on the other two are the container's own ports, not published.

Run: `docker compose logs nitpilot`
Expected: 13 migrations applied and `All migrations have been successfully applied.`, then `[first-run] Open https://localhost/first-run and enter the setup code: XXXX-XXXX` and `Nitpilot server listening on http://localhost:8787, in first-run mode`.

**3c. What first-run mode answers through Caddy.** (Plain http on port 80 is enough here: `SITE_ADDRESS=:80`.)

Run: `curl -s localhost/healthz; echo; curl -s -o /dev/null -w '%{http_code}\n' localhost/first-run; curl -s -w ' %{http_code}\n' localhost/api/me; curl -s localhost/api/first-run; echo`
Expected, in order: `{"ok":true,"version":"0.1.0"}`; `200`; `{"error":{"code":"first_run","message":"Finish setup at /first-run."}} 503`; `{"mode":"first_run","publicUrl":"https://localhost"}`.

Run: `CODE=$(docker compose logs nitpilot | grep "setup code" | tail -1 | sed 's/.*: //') && curl -s -X POST localhost/api/first-run/manifest -H 'content-type: application/json' -d "{\"code\":\"$CODE\",\"owner\":{\"kind\":\"user\"},\"name\":\"Nitpilot test\",\"isPublic\":false}" | head -c 400; echo`
Expected: starts `{"action":"https://github.com/settings/apps/new?state=` and goes on into the manifest: `"url":"https://localhost"`, the hook `https://localhost/webhooks/github`, `redirect_url` `https://localhost/first-run/callback`. This is the form the page would post to GitHub; nothing is sent to GitHub here.

**3d. The setup code is rate-limited per visitor, not per Caddy.** Wrong code, seven times in a row from this Mac. The `X-Forwarded-For` header is forged on purpose; Caddy (which trusts nobody, `TRUSTED_PROXIES` empty) must ignore it, so every try counts against the same address:

Run: `for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w '%{http_code} ' -X POST localhost/api/first-run/manifest -H 'content-type: application/json' -H "X-Forwarded-For: 9.9.9.$i" -d '{"code":"AAAA-AAAA","owner":{"kind":"user"},"name":"x","isPublic":false}'; done; echo`
Expected: `403 403 403 403 429 429 429` (the valid request in 3c was the first of five tries in that minute; if you run 3d a minute later, it is `403 403 403 403 403 429 429`). The 429s while the forged header changes each time prove the server counts the address Caddy saw, not the one the visitor claimed. Wait a minute before going on, or the 429s carry over.

**3e. A stored app is picked up after the server's own exit.** Normally the first-run page stores the app and the server exits so that Docker restarts it. Do the same without GitHub: store a made-up app with the server's own function (it encrypts with this run's `ENCRYPTION_KEY`), then stop the server the way the callback does. `--input-type=module` is needed for the top-level `await`.

Run:
```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose exec -T nitpilot node --import tsx --input-type=module -e "
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { saveGithubApp } from './src/setup/credentials.ts';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
await saveGithubApp({ appId: '999999999', slug: 'nitpilot-selfhost-fake', privateKey, clientId: 'Iv1.fakeclientid', clientSecret: randomBytes(20).toString('hex'), webhookSecret: randomBytes(20).toString('hex') }, 'selfhost-test');
console.log('stored');
process.exit(0);
"
```
Expected: `stored`.

Run: `docker compose exec -T postgres psql -U nitpilot -d nitpilot -c 'select id, slug, length("privateKeyEnc") from "GithubAppConfig"'`
Expected: one row, `app | nitpilot-selfhost-fake | 2272` (a long encrypted string, not a PEM: the key is never stored readable).

Run: `docker compose exec -T nitpilot sh -c 'kill -TERM 1'; sleep 12; docker inspect -f 'restarts={{.RestartCount}} running={{.State.Running}} lastExit={{.State.ExitCode}}' selfhost-nitpilot-1`
Expected: `restarts=1 running=true lastExit=0`. Process 1 is `tini` (the compose file's `init: true`); it passes SIGTERM to node, whose handler stops cleanly and exits 0, and `restart: unless-stopped` starts it again, as it will after the first-run callback.

Run: `docker compose logs --tail 40 nitpilot | grep "boot\] GitHub App\|No pending\|listening"`
Expected: `No pending migrations to apply.`, `[boot] GitHub App nitpilot-selfhost-fake, from the database`, `Nitpilot server listening on http://localhost:8787`. (A `[recovery] could not ask GitHub for failed deliveries … 404 … "Integration not found"` block above them is right too: the made-up app signed a real token for its one boot-time call to api.github.com, and GitHub answered that the app does not exist. The server logs it and carries on.)

Run: `curl -s localhost/api/first-run; echo; curl -s -w ' %{http_code}\n' localhost/api/me; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'localhost/first-run/callback?code=x&state=y'`
Expected: `{"mode":"ready","installUrl":"https://github.com/apps/nitpilot-selfhost-fake/installations/new"}`; `{"error":{"code":"unauthorized","message":"Sign in with GitHub first."}} 401` (normal mode now, no more 503); `302 http://localhost/first-run?error=exists` (this server already has its app).

**3f. Behind another HTTPS proxy: the loopback override and `TRUSTED_PROXIES`.** This is how Step 7 will run. Docker Desktop on a Mac shows a container the clients of a port published on `0.0.0.0` as one public-looking address (`140.82.121.6` in the builder's run), not a private one, so `TRUSTED_PROXIES=private_ranges` would not match. A port published only on `127.0.0.1` shows its clients as the network's gateway (`172.x.0.1`, a private address), which does match. So an override file binds Caddy to the loopback address; Compose reads `docker-compose.override.yml` by itself. (This also keeps the Mac's Caddy off the network, which is right when something on the same machine is the only way in.)

Run:
```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && printf 'services:\n  caddy:\n    ports: !override\n      - "127.0.0.1:80:80"\n' > docker-compose.override.yml && sed -i '' -e 's|^TRUSTED_PROXIES=$|TRUSTED_PROXIES=private_ranges|' .env && docker compose up -d && sleep 4 && docker compose ps --format '{{.Service}} {{.Ports}}'
```
Expected: only `caddy` is recreated; the ports line says `caddy 127.0.0.1:80->80/tcp` (443 is no longer published; `SITE_ADDRESS=:80` doesn't use it).

The loop the Caddyfile fix prevents: pretend to be the outer HTTPS proxy by sending `X-Forwarded-Proto: https` and a visitor address.

Run: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-For: 203.0.113.10' localhost/auth/github/login`
Expected: `302 https://github.com/login/oauth/authorize?client_id=Iv1.fakeclientid&redirect_uri=https%3A%2F%2Flocalhost%2Fauth%2Fgithub%2Fcallback&…` (sent on to GitHub, not back to `https://localhost/auth/github/login`, which would be the loop).

Rate limits are keyed on the visitor named in `X-Forwarded-For`, one bucket per address. `POST /api/cli/login` allows 10 a minute, and an empty body (`400`) counts:

Run: `for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-For: 203.0.113.10' localhost/api/cli/login; done; echo; curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'X-Forwarded-For: 203.0.113.11' localhost/api/cli/login`
Expected: `400 400 400 400 400 400 400 400 400 400 429 ` and then `400` (a second visitor has their own bucket).

**3g. VAPID keys from the image.** The task-level text had `docker compose run --rm nitpilot npm run vapid:keys -w apps/server`. That fails in the image (`npm error No workspaces found: --workspace=apps/server`: the image has no root workspace and no `apps/server/scripts/`). The `web-push` package is in the image, so ask it directly (this is the command already in `.env.example` and `docs/self-hosting.md`):

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose run --rm --no-deps nitpilot node -e "const k = require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + k.publicKey + '\nVAPID_PRIVATE_KEY=' + k.privateKey)" > vapid.txt; wc -l < vapid.txt`
Expected: `2`. Then put them in `.env` (the two empty lines are replaced, never printed) and restart:

Run:
```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && sed -i '' -e '/^VAPID_PUBLIC_KEY=$/d' -e '/^VAPID_PRIVATE_KEY=$/d' -e 's|^VAPID_SUBJECT=$|VAPID_SUBJECT=https://localhost|' .env && cat vapid.txt >> .env && rm vapid.txt && docker compose up -d && sleep 8 && docker compose ps --format '{{.Service}} {{.Status}}'
```
Expected: `nitpilot Up … (healthy)` (the server checks the key pair at boot and refuses a bad one).

**3h. Two ways it must refuse to start.**

Half-set `GITHUB_*`:

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && printf 'GITHUB_APP_ID=123456\nGITHUB_APP_SLUG=my-nitpilot\n' >> .env && docker compose up -d && sleep 6 && docker compose ps --format '{{.Service}} {{.Status}}' | grep nitpilot; docker compose logs --tail 20 nitpilot | grep -A2 "Error: Invalid"`
Expected: `nitpilot Restarting (1) …` (or `Up Less than a second` between two restarts), and the log: `Error: Invalid environment:` / `GITHUB_APP_PRIVATE_KEY: set all six GitHub App variables, or none to start in first-run mode; missing: GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET` / `See apps/server/.env.example.` (that last line points a self-hoster at a file they don't have; it comes from `getEnv` and is left alone, see the deviations).

Run (removes the two lines, then breaks the encryption key on purpose):
```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && sed -i '' -e '/^GITHUB_APP_ID=/d' -e '/^GITHUB_APP_SLUG=/d' .env && grep '^ENCRYPTION_KEY=' .env > key-backup.txt && sed -i '' "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env && docker compose up -d && sleep 6 && docker compose logs --tail 20 nitpilot | grep "Error: The stored" | tail -1
```
Expected: `Error: The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with.` and the container restarting in a loop (`docker compose ps` shows `Restarting`). The server will not start a new first run on top of a stored app it can't read.

Put the right key back:

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && K=$(cat key-backup.txt) && sed -i '' "s|^ENCRYPTION_KEY=.*|$K|" .env && rm key-backup.txt && docker compose up -d && sleep 8 && docker compose ps --format '{{.Service}} {{.Status}}' | grep nitpilot`
Expected: `nitpilot Up … (healthy)`.

**3i. Backup, and restore into a fresh volume.**

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose exec -T postgres pg_dump -U nitpilot -d nitpilot | gzip > nitpilot-$(date +%F).sql.gz && ls -l nitpilot-*.sql.gz`
Expected: one file of about 7.8 KB.

Run: `docker compose down -v`
Expected: containers, the network and the three volumes `selfhost_postgres_data`, `selfhost_caddy_data`, `selfhost_caddy_config` removed (this is what a lost server looks like).

Run: `docker compose up -d --wait postgres && gunzip -c nitpilot-$(date +%F).sql.gz | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot; echo "exit=$?"`
Expected: `Container selfhost-postgres-1  Healthy`, a one-row table headed `set_config` (harmless), `exit=0`.

Run: `docker compose up -d && sleep 8 && docker compose logs nitpilot | grep "No pending\|\[boot\] GitHub App"; curl -s localhost/api/first-run; echo`
Expected: `No pending migrations to apply.`, `[boot] GitHub App nitpilot-selfhost-fake, from the database`, and `{"mode":"ready","installUrl":"https://github.com/apps/nitpilot-selfhost-fake/installations/new"}`: the restored database brought the app back, with the same key from `.env`.

**3j. Upgrading, and a new setup code.** `docker compose pull` can't run here (the tag is local-only; Step 7 runs it for real), but the half of upgrading that matters is "a new image tag recreates only the server":

Run: `docker tag ghcr.io/nikosgkikas13/nitpilot:d3-scratch ghcr.io/nikosgkikas13/nitpilot:d3-scratch-b && sed -i '' 's|^NITPILOT_VERSION=.*|NITPILOT_VERSION=d3-scratch-b|' .env && docker compose up -d && sleep 8 && docker compose logs --tail 5 nitpilot | grep "No pending"`
Expected: only `Container selfhost-nitpilot-1  Recreate` / `Started` in the output (Postgres and Caddy untouched), then `No pending migrations to apply.`.

Run: `docker compose exec -T postgres psql -U nitpilot -d nitpilot -c 'delete from "GithubAppConfig"' && docker compose restart nitpilot && sleep 6 && docker compose logs nitpilot | grep "setup code" | tail -1`
Expected: `DELETE 1`, then a line ending `enter the setup code: XXXX-XXXX` that is different from any earlier one (each boot in first-run mode prints a new code; `logs` keeps the old lines across a restart, which is why the docs say `| tail -1`).

**3k. Caddy's own HTTPS with no override (the self-hoster's default).** Back to a plain `.env` with `SITE_ADDRESS` empty, which means `NITPILOT_DOMAIN` (here `localhost`, for which Caddy makes a certificate from its own local authority; Let's Encrypt is never involved on a Mac, the hosted instance in Task 12 proves that part):

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && rm docker-compose.override.yml && sed -i '' -e 's|^SITE_ADDRESS=.*|SITE_ADDRESS=|' -e 's|^TRUSTED_PROXIES=.*|TRUSTED_PROXIES=|' .env && docker compose up -d && sleep 6 && docker compose logs caddy | grep -c "certificate obtained successfully"; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost/healthz; curl -sk -w ' %{http_code} %{http_version}\n' https://localhost/healthz`
Expected: `1` (or more), `308 https://localhost/healthz`, `{"ok":true,"version":"0.1.0"} 200 2`.

**3l. Clean up.** The scratch folder keeps its three files and is reused by nothing; everything Docker made is removed:

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose down -v && docker rmi ghcr.io/nikosgkikas13/nitpilot:d3-scratch-b ghcr.io/nikosgkikas13/nitpilot:d3-scratch && rm -f .env nitpilot-*.sql.gz docker-compose.override.yml && docker ps -a --format '{{.Names}}' | grep selfhost; docker volume ls -q | grep selfhost; echo clean`
Expected: containers, network and volumes removed, the two image tags untagged, and only `clean` printed after (no `selfhost` container or volume left). The `caddy:2-alpine` and `postgres:16-alpine` images stay in the local cache.

If any expected line differs, stop and tell me what you saw before going on: the point of this step is to find surprises here, on the Mac, before the live run.

- [x] **Step 4: The docs and the explainers**

Create `docs/self-hosting.md` with exactly this content (the commands in it were run as written in Step 3, except the `curl` download of the three files, `dig`, `docker compose pull`, `npm install -g nitpilot` and `nitpilot login`, which need the public repo, a real DNS record, GHCR or GitHub; Step 7 covers `pull` and `login`, Task 15's fresh-install check the rest):

````markdown
# Self-hosting Nitpilot

Run your own Nitpilot server: for private repos, or to keep everything on your own machine. It's one folder with three files (`deploy/self-host/` in this repo): the published image, Postgres and Caddy, started with Docker Compose. The server creates its own GitHub App the first time you open it. Why it's built this way: spec §17 "Self-hosting", [why/first-run-and-app-manifests.md](why/first-run-and-app-manifests.md), [why/reverse-proxy-and-tls.md](why/reverse-proxy-and-tls.md).

## What you need

- **A server with Docker** (Docker Engine with the Compose plugin: `docker compose version` prints a version). 1 GB of memory is plenty; Nitpilot is one Node process and Postgres.
- **A domain or subdomain** for it, e.g. `nitpilot.example.com`, whose DNS you can edit.
- **Ports 80 and 443 open** to the internet on that server (Caddy needs both to get its HTTPS certificate). Nothing else needs to be open.
- **A GitHub account or organization** to own the GitHub App (for an organization you must be one of its owners).

Private repos work: `PUBLIC_REPOS_ONLY` is off unless you set it, so the app can be installed on any repo you choose.

## Set it up

### 1. Point the domain at the server

At your DNS provider, add an **A record**: name `nitpilot` (or whatever subdomain you picked), value your server's public IPv4 address. Add an **AAAA** record too if the server has IPv6. Check it from your own computer before going on; it must print the server's address:

```bash
dig +short nitpilot.example.com
```

Caddy asks Let's Encrypt for a certificate as soon as it starts, and Let's Encrypt checks the domain by connecting to it, so the record has to be right first ([why/dns-records.md](why/dns-records.md)).

### 2. Get the folder and fill in `.env`

On the server:

```bash
mkdir nitpilot && cd nitpilot
for f in docker-compose.yml Caddyfile .env.example; do curl -fsSLO "https://raw.githubusercontent.com/NikosGkikas13/nitpilot/main/deploy/self-host/$f"; done
cp .env.example .env
```

Every `docker compose` command below runs in this folder.

Open `.env` and fill in the three required values:

- `NITPILOT_DOMAIN=nitpilot.example.com` (no `https://`)
- `POSTGRES_PASSWORD=` the output of `openssl rand -hex 24`
- `ENCRYPTION_KEY=` the output of `openssl rand -base64 32`

`ENCRYPTION_KEY` encrypts people's GitHub tokens and the GitHub App's private key and secrets in the database. **Save a copy of `.env` somewhere safe now** (a password manager): a backup of the database can't be used without this key, and a server whose key changed refuses to start.

The rest of `.env.example` is optional, one comment line each: web push keys, `ALLOWED_LOGINS`, `CLOSED_CHAT_RETENTION_DAYS`, `NITPILOT_VERSION`. Web push keys are made with the image itself:

```bash
docker compose run --rm --no-deps nitpilot node -e "const k = require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + k.publicKey + '\nVAPID_PRIVATE_KEY=' + k.privateKey)"
```

Paste both lines into `.env`, and set `VAPID_SUBJECT=https://nitpilot.example.com`. Run it once: a new key pair means everyone has to turn push on again.

### 3. Start it

```bash
docker compose up -d
docker compose ps
```

After a few seconds `docker compose ps` shows `postgres` and `nitpilot` as `(healthy)` and `caddy` as `Up`. On its first start the server creates its tables (`docker compose logs nitpilot` shows `Applying migration …` and `All migrations have been successfully applied.`), and Caddy gets its certificate (`docker compose logs caddy` shows `certificate obtained successfully`).

### 4. Create the GitHub App on the first-run page

The server has no GitHub App yet, so it starts in **first-run mode** and prints a one-time setup code. Find it:

```bash
docker compose logs nitpilot | grep "setup code" | tail -1
```

It prints `[first-run] Open https://nitpilot.example.com/first-run and enter the setup code: XXXX-XXXX`. Only someone who can read the server's log has the code, so nobody else can claim the server before you.

Open `https://nitpilot.example.com/first-run`, enter the code, choose your personal account or an organization, a name for the app, and who may install it (keep "only this account" unless you want strangers to install your server's app), then **Create GitHub App**. GitHub shows its own "Create GitHub App" page, already filled in: click **Create GitHub App** there. GitHub sends you back; the page says "Restarting the server…" while the server stores the app (encrypted with `ENCRYPTION_KEY`) and Docker starts it again in normal mode.

### 5. Install the app, sign in, and connect your CLI

When the page offers **Install the app on your repos**, click it, choose the repos Nitpilot should work on (private ones too), and install. Then **Sign in** with GitHub.

Everyone who uses this server points their CLI at it (`npm install -g nitpilot` first):

```bash
NITPILOT_SERVER=https://nitpilot.example.com nitpilot login
```

`login` saves the address as `"server"` in the CLI's config file (`~/.config/nitpilot/config.json`), so later commands (`nitpilot repos add`, `nitpilot start`) use it without the variable. You can also write `"server": "https://nitpilot.example.com"` in that file yourself.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

`pull` downloads the newest image for the tag in `NITPILOT_VERSION` (`latest` when it's empty), and `up -d` replaces only the containers whose image or settings changed. The server stops politely (connected CLIs reconnect on their own), runs any new database migrations, and starts.

To stay on one version, set `NITPILOT_VERSION=0.1.0` in `.env` and run `docker compose up -d`; to move, change it and run the same command (Compose downloads a version it doesn't have yet). Back up before upgrading: migrations only go forward, so returning to an older version after one ran is not guaranteed to work.

After editing `.env`, `docker compose up -d` recreates the containers that use it. `docker compose restart nitpilot` restarts the server with its current settings.

## Backups

The database holds everything: chats, settings, the GitHub App. Dump it to a file:

```bash
docker compose exec -T postgres pg_dump -U nitpilot -d nitpilot | gzip > nitpilot-$(date +%F).sql.gz
```

Copy the file off the server, and run it every day (from cron, for example). **Keep `.env` too**, in a separate safe place: the GitHub App's private key and secrets, and people's GitHub tokens, are stored encrypted with its `ENCRYPTION_KEY`, so a dump without the key can't bring the server back.

## Restoring

On a new server (or after losing the database), with the same `.env` (same `ENCRYPTION_KEY`) and the dump file in the folder:

```bash
docker compose up -d --wait postgres
gunzip -c nitpilot-2026-10-24.sql.gz | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot
docker compose up -d
```

The server finds its GitHub App in the restored database and starts in normal mode (`docker compose logs nitpilot` shows `[boot] GitHub App <your app>, from the database`). If the domain moved to a new IP, update the DNS record first. Restoring over an existing database needs it empty first: `docker compose down -v` deletes it (and Caddy's certificates) for good, so only do that when the dump is safe.

## Behind another HTTPS proxy

If something in front of this server already does HTTPS (a load balancer, Cloudflare Tunnel, another Caddy or nginx), let Caddy serve plain HTTP on port 80 and trust that proxy's headers. In `.env`:

```
SITE_ADDRESS=:80
TRUSTED_PROXIES=private_ranges
```

`TRUSTED_PROXIES` lists the addresses the outer proxy connects from (`private_ranges` covers the private networks, including Docker's own; or give exact ranges like `10.0.0.0/8`). Without it, Caddy tells the server every request came in over plain http, and sign-in keeps redirecting to `https://` in a loop. `NITPILOT_DOMAIN` stays the public name people open.

Make sure only that proxy can reach port 80, since Caddy now believes what it says. When the proxy runs on the same machine, bind Caddy to the loopback address with a `docker-compose.override.yml` next to the other files (Compose reads it automatically):

```yaml
services:
  caddy:
    ports: !override
      - "127.0.0.1:80:80"
```

## Troubleshooting

Start with `docker compose ps` and `docker compose logs nitpilot` (or `logs caddy`).

- **Lost the setup code, or it says it doesn't match:** use the last one printed (`docker compose logs nitpilot | grep "setup code" | tail -1`). `docker compose restart nitpilot` prints a new one; the old one stops working. Five tries a minute per address; after that the page asks you to wait.
- **`nitpilot` keeps restarting with "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with."** `ENCRYPTION_KEY` in `.env` isn't the one the app was stored with. Put the old value back from your saved copy and run `docker compose up -d`. The server never starts a new first run over the stored app.
- **`nitpilot` keeps restarting with "set all six GitHub App variables, or none to start in first-run mode; missing: …"** Some `GITHUB_*` lines are in `.env` and some are empty. Remove them all (to use the app first-run mode made) or fill in all six (for an app you made by hand; they win over a stored app).
- **No certificate / the browser can't connect:** `docker compose logs caddy`. Usually the DNS record doesn't point at this server yet (`dig +short` it) or ports 80 and 443 are blocked by a firewall.
- **Sign-in loops back to the same page behind another proxy:** set `TRUSTED_PROXIES` (above).
````

Create `docs/why/reverse-proxy-and-tls.md` with exactly this content:

````markdown
# Reverse proxy and TLS (Caddy, the front door)

**In one sentence:** Caddy is the only thing on a self-hosted server that the internet talks to: it does HTTPS (getting and renewing the certificate by itself) and hands every request on to the Nitpilot server, which never faces the internet directly.

## The React comparison

You already use a reverse proxy in development. In `apps/web/vite.config.ts`, Vite's `server.proxy` sends `/api`, `/auth` and `/ws` on to the server on port 8787 ([serving-a-spa.md](serving-a-spa.md)). The browser only ever talks to Vite on 5173; Vite talks to the server for it.

Caddy is the same idea in production: the browser talks to Caddy on ports 80 and 443, and Caddy talks to `nitpilot:8787` on the private network Docker Compose makes for the folder. The one line that does it, in `deploy/self-host/Caddyfile`:

```
reverse_proxy nitpilot:8787
```

"Reverse" because it stands in front of a server (a normal "forward" proxy stands in front of browsers, like a company's web filter).

## Why not let the server answer the internet itself

- **HTTPS.** Browsers need it (the `.dev` domains are HTTPS-only, and a session cookie marked `Secure` is only sent over it). The Nitpilot server speaks plain HTTP. Caddy adds the encryption on the way in and out, so the server's code never deals with certificates.
- **One door.** Only Caddy publishes ports. The server and Postgres have none in `docker-compose.yml`, so the only way in is through Caddy.

## TLS and certificates, briefly

HTTPS is HTTP inside **TLS**, an encrypted connection. To start one, the server shows a **certificate**: a signed statement "this key belongs to `nitpilot.example.com`", signed by a certificate authority browsers already trust. Without a valid certificate the browser shows a full-page warning.

**Let's Encrypt** is a free certificate authority run by a non-profit, built to be used by programs, not people. Before it signs, it checks that you really control the domain: it connects to the domain on port 80 (or 443) and asks for a one-time answer that only the requester knows. Caddy does all of this on its own the first time it starts with a domain as its address, and renews the certificate before it expires (every few months). It also redirects `http://` to `https://` (the clean-folder run saw a `308` to `https://localhost/healthz`).

That's why the order matters when you set up:

1. **The DNS record first** ([dns-records.md](dns-records.md)): Let's Encrypt looks the domain up, and must land on this server.
2. **Ports 80 and 443 open**: that's where it knocks.
3. **Then `docker compose up -d`.** Started too early, Caddy fails, waits and tries again, and repeated failures can hit Let's Encrypt's rate limits.

Caddy keeps its certificates in the `caddy_data` volume, so a restart or a new image reuses them instead of asking again.

## What Caddy tells the server about the visitor

The server's socket is connected to Caddy, not to the visitor. So Caddy adds headers to every request it passes on, without any configuration:

- `X-Forwarded-For`: the visitor's address. The server uses it for rate limits (five setup-code tries a minute, ten `nitpilot login` starts a minute, per address), and only because `TRUST_PROXY=true` says a proxy is really there ([trusting-a-proxy.md](trusting-a-proxy.md)). Caddy ignores an `X-Forwarded-For` the visitor sent and writes the address it saw, so nobody can pretend to be someone else.
- `X-Forwarded-Proto`: `https` or `http`, how the visitor came in. Sign-in checks it: a sign-in started over plain `http` is sent to the `https` address first, because GitHub always returns people to `PUBLIC_URL`.
- The original `Host`.

WebSockets (`/ws/cli` for CLIs, `/ws/web` for the web app) go through too: Caddy sees the "upgrade to a WebSocket" request and keeps the connection open in both directions.

## `:80` behind another proxy

Sometimes something in front already does HTTPS: a cloud load balancer, a Cloudflare Tunnel, the dev tunnel this project uses for live runs. Then Caddy shouldn't get a certificate (it can't: the visitors never reach it directly). `SITE_ADDRESS=:80` makes Caddy's address "any name, port 80, plain HTTP".

Now the request has two proxies in front of the server, and Caddy's defaults get in the way: it sees the outer proxy as "the visitor", so it writes `X-Forwarded-Proto: http` (the outer proxy connected over plain HTTP) and that proxy's address in `X-Forwarded-For`. The clean-folder run showed what that does: with `PUBLIC_URL=https://…`, every sign-in looked like it came in over `http`, and the server redirected to the `https` address, which arrived as `http` again: a loop.

`TRUSTED_PROXIES` in `.env` fixes it. It goes into the Caddyfile's `trusted_proxies`: requests from those addresses keep the `X-Forwarded-*` headers they bring, so `https` reaches the server. And `header_up X-Forwarded-For {client_ip}` sends the server one address, the real visitor (Caddy reads the incoming header from the right, skipping trusted proxies), not "visitor, outer proxy", whose last entry the server would read as everyone's address. Left empty (directly on the internet) neither changes anything: nobody is trusted, and `{client_ip}` is the connection's own address, which is what Caddy sends anyway.

Trusting a proxy means believing what it says, so only it may reach Caddy's port 80. On the same machine, bind Caddy to `127.0.0.1` (docs/self-hosting.md shows the override file). On a Mac, Docker Desktop also shows a `0.0.0.0`-bound port's clients to containers with an outside address, so the loopback binding is what makes `private_ranges` match there.

## Where

- `deploy/self-host/Caddyfile`: the site address, `reverse_proxy`, `trusted_proxies`, `header_up`.
- `deploy/self-host/docker-compose.yml`: the `caddy` service (ports, `SITE_ADDRESS`, `TRUSTED_PROXIES`, the certificate volumes) and `TRUST_PROXY=true` for the server.
- `apps/server/src/lib/client-address.ts`: reads `X-Forwarded-For`. `apps/server/src/http/routes/auth.ts` (`cameInElsewhere`): reads `X-Forwarded-Proto`.
- `docs/self-hosting.md`: the setup, "Behind another HTTPS proxy", troubleshooting.
````

Create `docs/why/dns-records.md` with exactly this content:

````markdown
# DNS records (how a name finds the server)

**In one sentence:** a DNS record is a public entry saying "the name `nitpilot.example.com` means the server at `203.0.113.10`", and a self-hosted Nitpilot needs one before it starts, because browsers, GitHub and Let's Encrypt all find the server by its name.

## The React comparison

An import map in the browser, or `paths` in a `tsconfig.json`: a table that turns a friendly name (`@app/api`) into where the thing really is (`./src/api/index.ts`). Your code only uses the name; change the table and every import follows.

DNS is that table for the whole internet. People and programs use the name; the record says which IP address it means. Move the server to a new machine and you change one record, not every link.

## The records you'll meet

- **A**: name → IPv4 address (`nitpilot.example.com` → `203.0.113.10`). The one a self-hosted server needs.
- **AAAA**: name → IPv6 address. Add it as well if your server has IPv6; otherwise leave it out (a wrong AAAA record breaks visitors who prefer IPv6).
- **CNAME**: name → another name (`www.example.com` → `example.com`), "look that one up instead". Handy for aliases; it can't sit on the bare domain itself.

You add them at whoever runs the domain's DNS (usually where you bought it). The name field is usually just the part before your domain: `nitpilot` for `nitpilot.example.com`, or `@` for the bare domain.

## TTL and "propagation"

Every record has a **TTL** (time to live, in seconds): how long other computers may cache the answer before asking again. Like a `staleTime` in React Query: after a change, anyone holding an old answer keeps using it until it expires.

So a new record usually works within minutes, but a **changed** one can take up to the old TTL to reach everyone. That delay is what people call "propagation". Before moving a server, lower the TTL (to 300, say) a day ahead.

Check what the world sees from your own computer:

```bash
dig +short nitpilot.example.com
```

It prints the address (or nothing, if the record isn't there yet).

## Why Nitpilot needs it right first

- **Let's Encrypt** looks the name up and connects to that address to check you control it, before Caddy can have a certificate ([reverse-proxy-and-tls.md](reverse-proxy-and-tls.md)). A missing or wrong record means no HTTPS.
- **GitHub** sends webhooks, and sends people back after sign-in and install, to URLs built from `PUBLIC_URL` (`https://<NITPILOT_DOMAIN>`), which the first-run page writes into the GitHub App. They are written once, so the domain should be the one you mean to keep.
- **Browsers and CLIs** open `https://<domain>` and connect `wss://<domain>/ws/cli`.

If your DNS provider also offers to proxy traffic (Cloudflare's orange cloud), that proxy is "another HTTPS proxy" in front of Caddy: either switch it to DNS only, or follow "Behind another HTTPS proxy" in `docs/self-hosting.md`.

## Where

- `deploy/self-host/.env.example`: `NITPILOT_DOMAIN`, which becomes `PUBLIC_URL` and Caddy's address in `deploy/self-host/docker-compose.yml`.
- `docs/self-hosting.md`, step 1.
- The hosted instance's records for `nitpilot.dev` and `www`: spec §17 "Hosted instance".
````

In `docs/why/trusting-a-proxy.md`, three edits. First, in the section "Why it is ignored without a proxy", replace the paragraph

```markdown
If there is no proxy (a self-hoster running the server directly, or `npm run dev`), nobody adds a true entry, so every `X-Forwarded-For` is the visitor's own claim. Trusting it would let anyone choose their own address. So the server only reads the header when `TRUST_PROXY=true` is set, which the hosted setup does and nothing else should.
```

with

```markdown
If there is no proxy (a self-hoster running the server directly, or `npm run dev`), nobody adds a true entry, so every `X-Forwarded-For` is the visitor's own claim. Trusting it would let anyone choose their own address. So the server only reads the header when `TRUST_PROXY=true` is set. The two Compose setups set it (the hosted instance, and `deploy/self-host/docker-compose.yml`, where Caddy is the only way in); a server run any other way should leave it off.
```

Second, insert this new section between that section and "## Where":

```markdown
## Two proxies

When Caddy itself sits behind another HTTPS proxy (`SITE_ADDRESS=:80`), the last entry would be that outer proxy, the same for everyone. The self-host Caddyfile then trusts the outer proxy (`TRUSTED_PROXIES`) and sends the server only the real visitor's address, so the server's "last entry" rule still holds ([reverse-proxy-and-tls.md](reverse-proxy-and-tls.md)).
```

Third, in "## Where", replace the paragraph

```markdown
`apps/server/src/lib/client-address.ts` (`clientAddress(c, trustProxy)`), used by the login rate limit in `http/routes/cli.ts`. The flag is `TRUST_PROXY` in `lib/env.ts`.
```

with

```markdown
`apps/server/src/lib/client-address.ts` (`clientAddress(c, trustProxy)`), used by the login rate limit in `http/routes/cli.ts` and the setup-code limit in `setup/first-run.ts`. The flag is `TRUST_PROXY` in `lib/env.ts`, set in `deploy/self-host/docker-compose.yml`; the headers come from `deploy/self-host/Caddyfile`.
```

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md`, §17 "Self-hosting" (the code differs from the spec, so the spec changes in the same commit). Replace the bullet

```markdown
  - **Caddy's address** comes from `.env` (`SITE_ADDRESS`, default the domain), so the same Caddyfile can also serve plain `:80` behind something else that already does TLS.
```

with

```markdown
  - **Caddy's address** comes from `.env` (`SITE_ADDRESS`, default the domain), so the same Caddyfile can also serve plain `:80` behind something else that already does TLS. Then `TRUSTED_PROXIES` (empty by default) names that proxy's addresses, so Caddy keeps the `X-Forwarded-Proto: https` it sends (without it, sign-in redirects to `https://` in a loop) and passes the server only the real visitor's address in `X-Forwarded-For` (`header_up X-Forwarded-For {client_ip}`), which keeps the server's `TRUST_PROXY` rule (the last entry) right. The server and Postgres publish no ports.
```

and replace the bullet

```markdown
  - **Verified** by running the self-host compose from a clean folder on the Mac with `SITE_ADDRESS=:80` behind the dev tunnel (Cloudflare does the TLS there, so Caddy's certificate step is proven by the hosted instance's Caddy instead), creating a throwaway app through the first-run page, and doing a single-player review on the sandbox repo; then deleting that app.
```

with

```markdown
  - **Verified** by running the self-host compose from a clean folder on the Mac with `SITE_ADDRESS=:80` and `TRUSTED_PROXIES=private_ranges` (Caddy bound to `127.0.0.1:80` by an override file in that folder) behind the dev tunnel (Cloudflare does the TLS there, so Caddy's certificate step is proven by the hosted instance's Caddy instead), creating a throwaway app through the first-run page, and doing a single-player review on the sandbox repo; then deleting that app.
```

Run: `git diff --stat`
Expected: the nine files of this task (the three `deploy/self-host/` files and `docs/self-hosting.md`, `docs/why/reverse-proxy-and-tls.md`, `docs/why/dns-records.md` as new; `apps/server/src/lib/env.ts`, `docs/why/trusting-a-proxy.md` and the spec as changed).

- [x] **Step 5: Whole suite, then commit the code and docs**

Nothing but a comment changed in code, so the counts do not move.

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS: protocol 88, CLI 349 + 14 skipped, server 1107, web 373; typecheck and lint clean. (`npm run test:e2e` 6 is untouched; run it if you want the extra proof.)

Run (not yet the plan file: the ticks come in Step 9, after the live run):
```bash
git add deploy/self-host/docker-compose.yml deploy/self-host/Caddyfile deploy/self-host/.env.example docs/self-hosting.md docs/why/reverse-proxy-and-tls.md docs/why/dns-records.md docs/why/trusting-a-proxy.md docs/superpowers/specs/2026-10-07-nitpilot-design.md apps/server/src/lib/env.ts
```
```bash
git commit -m "feat(deploy): self-hosting with Compose, verified from a clean folder

deploy/self-host/ (docker-compose.yml, Caddyfile, .env.example): the published
image, Postgres 16 and Caddy 2. Only Caddy publishes ports; required values fail
\`docker compose up\`/\`config\` loudly; the server gets TRUST_PROXY=true. For a
Caddy on \`:80\` behind another HTTPS proxy, TRUSTED_PROXIES makes Caddy keep that
proxy's X-Forwarded-Proto (without it sign-in loops to https://) and
\`header_up X-Forwarded-For {client_ip}\` hands the server the real visitor.

docs/self-hosting.md (setup, upgrading, backups, restoring, behind another
proxy, troubleshooting) and the explainers docs/why/reverse-proxy-and-tls.md and
docs/why/dns-records.md; trusting-a-proxy.md and spec §17 updated.

Verified locally from a clean folder with a locally built image: first-run mode
through Caddy, the setup code's rate limit per visitor, a stored app picked up
after the server's own exit and Docker's restart, VAPID keys from the image,
half-set GITHUB_* and a changed ENCRYPTION_KEY refusing to start, and a
pg_dump backup restored into a fresh volume.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: a commit with nine changed files. (The message is the checkpoint's. If a later step finds a fix, it goes into a separate commit in Step 9.)

- [x] **Step 6: (user, say first: writes to GitHub and GHCR) The `v0.1.0-rc.2` image**

`v0.1.0-rc.1` was built before first-run mode existed, so the live run needs a new pre-release tag, on this commit. I check `git status` is clean and `git log -1` is the Step 5 commit, then say "this pushes the branch and a tag to GitHub, and the tag pushes an image to GHCR" and wait for go. The user runs, from the repo folder (I don't push), one command at a time:

```bash
git push origin plan-3-deploy-and-launch
```
```bash
git tag v0.1.0-rc.2
```
```bash
git push origin v0.1.0-rc.2
```

(`-u` is not needed: the branch was pushed with `-u` in Task 6.)

Click-steps, in the browser signed in to GitHub as **NikosGkikas13**:
1. Open https://github.com/NikosGkikas13/nitpilot/actions. At the top of the list is a run called **Release**, on `v0.1.0-rc.2`. Click it.
2. The run's page shows three jobs: **Check the tag**, **Image to GHCR**, **CLI to npm**. Wait until the first two have a green tick (a few minutes; the image layers that haven't changed since `rc.1` come from cache) and **CLI to npm** is grey with "This job was skipped". The skip is right: an `-rc` tag never goes to npm.
3. Open https://github.com/NikosGkikas13/nitpilot. In the right-hand column under **Packages**, click **nitpilot**. The page shows `ghcr.io/nikosgkikas13/nitpilot` with the tags **0.1.0-rc.2** and **0.1.0-rc.1** and no `latest`, and the **Private** label.
4. The **CI** run for the pushed branch (Actions → the top **CI** run on `plan-3-deploy-and-launch`) should be green too: **typecheck + lint + tests** and **Docker image (build + smoke test)**.

I read the **Image to GHCR** job's log (`gh run view --log`, read-only) and note the pushed tag and digest in the ledger.

- [x] **Step 7: (live, say first) The clean-folder run with the `0.1.0-rc.2` image, through the dev tunnel**

What this adds to Step 3: the real image from GHCR (`pull`), a real GitHub App made through the real manifest round trip, real webhooks signed with the stored secret, GitHub sign-in through the tunnel and Caddy, the CLI's WebSocket through both, and a real review posted by the test app. It writes to GitHub (creates and later deletes an app, installs it on the sandbox, opens a PR on the sandbox), so I announce each part and wait for go.

**Dev tunnel: not `npm run dev:tunnel`.** `apps/server/scripts/dev-tunnel.ts` does two things this run must not: it points `cloudflared` at `http://localhost:${PORT}` (the dev server on 8787, not Caddy on 80), and as soon as the tunnel's URL appears it calls `PATCH /app/hook/config` with `nitpilot-dev`'s credentials from `apps/server/.env`, which re-points the real dev app's webhook at the new URL. So I run `cloudflared` directly, a plain quick tunnel that needs no account and changes nothing on GitHub. Nobody runs `npm run dev:tunnel` or the dev server during this step, and `nitpilot-dev`'s webhook keeps pointing at its old, dead URL, so only the test app hears about the sandbox PR.

**7a. (user) Log Docker in to GHCR.** The image is private until D4, so the user runs this in their own terminal (it feeds `gh`'s token to Docker without showing it; `gh` is signed in as NikosGkikas13, which owns the package):

```bash
gh auth token | docker login ghcr.io -u NikosGkikas13 --password-stdin
```
Expected: `Login Succeeded`. If it says `unauthorized` or `denied`, `gh`'s token lacks the `read:packages` scope: the user runs `gh auth refresh -h github.com -s read:packages` (a browser approval as NikosGkikas13) and tries again.

**7b. The tunnel.** I open a Terminal tab in the app (tab name `tunnel`) and run, and leave it running:

```bash
cloudflared tunnel --url http://127.0.0.1:80
```
Expected: within a few seconds the tab prints a box with `https://<random-words>.trycloudflare.com`. I read it with `read_terminal` and call it `<host>` below (no `https://`). It changes every time `cloudflared` starts, so do 7c right away and don't restart the tunnel until the run is over. Until Caddy is up, that URL answers a Cloudflare error page; that is fine.

**7c. The clean folder.** (Literal `rm -rf` of the old scratch folder first, if Step 3 left one: its `.env` is already gone, and Step 3l ran `down -v`.)

Run:
```bash
rm -rf ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && mkdir ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && cp ~/Desktop/PracticeProjects/nitpilot/deploy/self-host/{docker-compose.yml,Caddyfile,.env.example} . && printf 'services:\n  caddy:\n    ports: !override\n      - "127.0.0.1:80:80"\n' > docker-compose.override.yml && ls -A
```
Expected: `.env.example  Caddyfile  docker-compose.override.yml  docker-compose.yml`.

Fill `.env` (I type the tunnel's host in place of `<host>` myself; the secrets are fresh and never printed):

```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && cp .env.example .env && sed -i '' -e "s|^NITPILOT_DOMAIN=\$|NITPILOT_DOMAIN=<host>|" -e "s|^POSTGRES_PASSWORD=\$|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" -e "s|^ENCRYPTION_KEY=\$|ENCRYPTION_KEY=$(openssl rand -base64 32)|" -e "s|^SITE_ADDRESS=\$|SITE_ADDRESS=:80|" -e "s|^TRUSTED_PROXIES=\$|TRUSTED_PROXIES=private_ranges|" -e "s|^NITPILOT_VERSION=\$|NITPILOT_VERSION=0.1.0-rc.2|" .env && grep -E '^(NITPILOT_DOMAIN|SITE_ADDRESS|TRUSTED_PROXIES|NITPILOT_VERSION)=' .env
```
Expected: four lines: the tunnel host, `SITE_ADDRESS=:80`, `TRUSTED_PROXIES=private_ranges`, `NITPILOT_VERSION=0.1.0-rc.2`. Why each: the domain is what ends up in `PUBLIC_URL` and in the manifest's webhook and callback URLs, so it must be the tunnel's host; `:80` because Cloudflare already does the HTTPS; `private_ranges` plus the loopback override so Caddy believes the proxy in front (Step 3f explains the Mac detail).

**7d. Pull and start.**

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose pull nitpilot`
Expected: `Container … Pulled` for `nitpilot` (a download of the image from GHCR; this is the first real `pull`). Then:

Run: `docker compose up -d && sleep 10 && docker compose ps --format '{{.Service}} {{.Status}} {{.Ports}}'`
Expected: `postgres … (healthy)`, `nitpilot … (healthy)`, `caddy Up … 127.0.0.1:80->80/tcp`.

Run: `curl -s https://<host>/healthz; echo; docker compose logs nitpilot | grep "setup code" | tail -1`
Expected: `{"ok":true,"version":"0.1.0"}` through Cloudflare and Caddy, and `[first-run] Open https://<host>/first-run and enter the setup code: XXXX-XXXX`. I show the user the code in chat (it is only good for this throwaway server).

**7e. (user) Create the app, install it, sign in.** In the browser signed in to GitHub as **NikosGkikas13** (the one that owns `nitpilot-sandbox`):

1. Open `https://<host>/first-run`. You see the Nitpilot wordmark at the top left and a card titled **Set up Nitpilot** with a small label **First run** above it. The card has: a text box **Setup code**, two radio buttons under **Create the app on** (**Your personal account**, already chosen, and **An organization**), a text box **App name** already filled with `Nitpilot (<host>)`, two radio buttons under **Who can install it** (**Only this account or organization**, already chosen, and **Anyone on GitHub**), and a button **Create GitHub App**.
2. Click the **Setup code** box and type the code I gave you (like `K3F9-2MXA`). Leave **Your personal account** and **Only this account or organization** as they are. Click into **App name**, select everything in it (Cmd+A) and type `Nitpilot selfhost test`. Click **Create GitHub App**.
3. The button changes to **Opening GitHub…** and the browser leaves for `github.com/settings/apps/new?state=…`. You see GitHub's page for registering a GitHub App with the name `Nitpilot selfhost test`, the homepage and webhook URL (`https://<host>/webhooks/github`), the callback URL and the permissions already filled in. Don't change anything. If GitHub first asks you to confirm access (a password, passkey or code prompt, GitHub's "sudo mode"), do that yourself.
4. Scroll to the bottom and click the green button **Create GitHub App for NikosGkikas13**. GitHub creates the app and sends the browser straight back to `https://<host>/first-run/callback?code=…&state=…`, which bounces to `https://<host>/first-run?done=1`.
5. You see a card with a spinner and the title **Restarting the server…** (the server stored the app and exited; Docker is starting it again). After a few seconds (the page asks every 2 seconds) the title becomes **Your GitHub App is ready** with a green tick, and two buttons: **Install the app on your repos** and **Sign in**. If it still says Restarting after a minute, a line appears telling you to check `docker compose ps`; tell me.
6. Click **Install the app on your repos**. GitHub's install page opens (`github.com/apps/nitpilot-selfhost-test/installations/new/permissions?target_id=…`; the end of the address may differ) with the title **Install Nitpilot selfhost test**. Under **Install on your personal account** (NikosGkikas13) choose **Only select repositories**, click the **Select repositories** drop-down that appears and pick **nitpilot-sandbox** (only that one). Click the green **Install** button.
7. GitHub sends the browser to `https://<host>/github/setup?installation_id=…`. You are not signed in to this server yet, so it passes you on to GitHub's sign-in for the app: a page **Authorize Nitpilot selfhost test** (it asks to act on your behalf). Click the green **Authorize NikosGkikas13**. This is the step that loops forever if the proxy headers are wrong; it must not.
8. You land on the Nitpilot web app's setup checklist (`https://<host>/setup`) with **Install the GitHub App** ticked. If you land on the Nitpilot sign-in page instead, click **Sign in** once more.

I check what the server saw (all read-only):

Run: `cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose logs nitpilot | grep "boot\] GitHub App\|No pending"` then `docker compose exec -T postgres psql -U nitpilot -d nitpilot -c 'select slug from "GithubAppConfig"' -c 'select event, action, status, count(*) from "RawEvent" group by 1,2,3 order by 1,2' -c 'select login from "User"'`
Expected: `[boot] GitHub App nitpilot-selfhost-test, from the database`; the slug row; `RawEvent` rows for `installation`/`created` and `installation_repositories` (or `ping`) with status `processed` or `ignored` (a row stuck in `received`, `retrying` or `failed` means the webhook's signature check failed: stop and tell me); and `User` has `NikosGkikas13`.

**7f. The CLI, as NikosGkikas13, with the fake agent.** The fake agent exists only in a source checkout, so this runs the CLI from source, like `nit-b` in the acceptance runbook, with a fresh config folder so nothing from earlier runs leaks in. In a Terminal tab (`cli`), from the repo folder (`<host>` filled in by me):

```bash
cd ~/Desktop/PracticeProjects/nitpilot && export TUNNEL=https://<host> && nit-sh() { NITPILOT_CONFIG_DIR="$HOME/.nitpilot-selfhost" NITPILOT_SERVER="$TUNNEL" NITPILOT_FAKE_SCENARIO="$PWD/docs/acceptance/scenarios/sandbox-happy.json" "$PWD/node_modules/.bin/tsx" "$PWD/apps/cli/src/index.ts" "$@"; } && nit-sh login
```
Expected: it prints a link and a code and opens the default browser (NikosGkikas13's, which is the right account here). In that browser: the page **Approve this device?** on `https://<host>/…` shows the same code as the terminal; click **Approve**. The terminal then prints `Logged in as NikosGkikas13. The token is in …/config.json, readable by you only.` (codes last 10 minutes). The check this proves: the CLI's HTTPS requests and the sign-in link work through Cloudflare and Caddy.

Run (same tab):
```bash
nit-sh repos add ~/nitpilot-acceptance/b/nitpilot-sandbox && jq '.agent = "fake"' ~/.nitpilot-selfhost/config.json > ~/.nitpilot-selfhost/config.json.tmp && chmod 600 ~/.nitpilot-selfhost/config.json.tmp && mv ~/.nitpilot-selfhost/config.json.tmp ~/.nitpilot-selfhost/config.json && nit-sh doctor
```
Expected: `repos add` confirms the sandbox repo is linked to this clone; `doctor` prints no `✗` lines. Then:

Run: `nit-sh start`
Expected: `Connected as NikosGkikas13.` and the command keeps running (leave the tab open). That is the WebSocket (`/ws/cli`) working through Cloudflare, Caddy and the server. Check the other side: in the `selfhost` folder, `docker compose logs --tail 20 nitpilot` shows the CLI connecting and no `401`.

**7g. (user) ngkdev93-jpg opens a small PR and asks NikosGkikas13 for a review.** First I put a branch on GitHub as ngkdev93-jpg. **(say first: this pushes a branch to `NikosGkikas13/nitpilot-sandbox`.)** On go, in a third tab, from the repo folder (`new-branch.sh` copies `docs/acceptance/seed/orders-demo` onto a new branch off `main` in clone A, which is signed in as ngkdev93-jpg, and pushes it):

```bash
cd ~/nitpilot-acceptance/a/nitpilot-sandbox && REPO=~/Desktop/PracticeProjects/nitpilot bash ~/Desktop/PracticeProjects/nitpilot/docs/acceptance/new-branch.sh selfhost-reviewer
```
Expected: git pushes `acc/selfhost-reviewer` and prints `Branch pushed. Open the pull request as account A:` and a link like `https://github.com/NikosGkikas13/nitpilot-sandbox/compare/main...acc/selfhost-reviewer?expand=1`. (If git says `acc/selfhost-reviewer` already exists, an earlier run left it: use `selfhost-reviewer-2`.)

Click-steps, in the browser signed in to GitHub as **ngkdev93-jpg** (a private window, or the other browser profile; not the one signed in as NikosGkikas13):
1. Open that link. You see GitHub's **Open a pull request** page comparing `acc/selfhost-reviewer` with `main`.
2. Click the **Title** box at the top and type `Self-host test: reviewer`.
3. On the right, in the column of small headings (**Reviewers**, **Assignees**, **Labels** …), click the gear next to **Reviewers**. A small drop-down with a search box opens. Type `NikosGkikas13` and click their name in the list; a tick appears next to it. Click anywhere outside the drop-down to close it. **Reviewers** now shows `NikosGkikas13`.
4. Click the green **Create pull request** button at the bottom left of the form. The PR page opens; note its number (`#<PR>` in the title).

What should happen, with no further clicks: in the `cli` tab, within about 5 seconds, `→ review of NikosGkikas13/nitpilot-sandbox#<PR> (attempt 1)` and then `✓ review of …: done`. In the browser signed in as **NikosGkikas13**, open the PR (https://github.com/NikosGkikas13/nitpilot-sandbox/pulls → the PR → **Files changed**): one review by **NikosGkikas13** carrying the badge of the test app (`Nitpilot selfhost test`), with three inline comments on `orders-demo/src/orders.js` at lines 5, 12 and 18, and no summary comment (only one side of this PR is on Nitpilot).

I check from the terminal (read-only), with `PR=<number>`:

```bash
gh api repos/NikosGkikas13/nitpilot-sandbox/pulls/$PR/reviews --jq '[.[] | {user: .user.login, app: .performed_via_github_app.slug}]'
```
```bash
gh api repos/NikosGkikas13/nitpilot-sandbox/pulls/$PR/comments --jq '[.[] | {user: .user.login, line: .line}]'
```
```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose exec -T postgres psql -U nitpilot -d nitpilot -v pr=$PR -f - < ~/Desktop/PracticeProjects/nitpilot/docs/acceptance/check.sql
```
Expected: one review, `user` `NikosGkikas13`, `app` `nitpilot-selfhost-test` (the badge); three comments by `NikosGkikas13` on lines 5, 12 and 18; and in `check.sql`'s output the chat READY, one `review` job `done` for NikosGkikas13, no duplicate jobs (section 3 prints no rows), the `pull_request` `opened` and `review_requested` webhooks as `processed`, and no webhook left `received`/`retrying`/`failed`. Last, `docker compose logs --tail 80 nitpilot | grep -ci error` should be `0` or only lines I can explain (the boot-time `[recovery]` 404 is not expected here: this is a real app); I report anything else.

**What this step must still prove (from the builder's local run).** I tick each one in my report, with the evidence:
- [x] The real image from GHCR (`0.1.0-rc.2`): `docker compose pull` worked and the server runs from it (7d).
- [x] The real manifest round trip, in a browser: GitHub's create page from the posted form, `/first-run/callback` with GitHub's real `code` and `state`, the conversion, the server's own exit after storing, and the page's **Restarting…** then **Your GitHub App is ready** (7e 3 to 5).
- [x] Sign-in does not loop through Cloudflare, Caddy and the server: the Authorize step in 7e lands on `/setup`. This needs `cloudflared` to send `X-Forwarded-Proto: https`, which the builder could not check locally. If the browser loops, I stop and report; the first thing to read is what Caddy received (add `log` to the Caddyfile's site block, or `curl -s -H 'X-Forwarded-Proto: https' http://127.0.0.1/auth/github/login -o /dev/null -w '%{redirect_url}'` from the Mac).
- [x] Rate limits count per visitor behind the tunnel (the setup-code limit from the Mac's browser, not shared with another visitor): after 7e, `docker compose logs caddy` shows the client address Caddy used is the visitor's, not `172.x.0.1`.
- [x] Real webhooks reach `https://<host>/webhooks/github` and pass the signature check with the stored secret (the `RawEvent` rows in 7e and 7g).
- [x] The installation on `nitpilot-sandbox` only; GitHub sign-in with the new app.
- [x] `NITPILOT_SERVER=<tunnel> login` and the WebSocket over the tunnel and Caddy (7f).
- [x] A real review posted by the test app on a real PR (7g).
- Not provable here: Caddy's real Let's Encrypt certificate (the hosted instance's Caddy proves it in Task 12).

**Live run, 2026-10-24** (image `ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.2@sha256:0105527e4e66ba087aaa70f9e8dd7c7c957e5739cc5fc66835d44be0d1b646c1`, from `e98f5de`; sandbox PR #15). Everything above held. What differed from the step text:
- `gh`'s token had no `read:packages`, so the first `pull` got `403 Forbidden`; the 7a fallback (`gh auth refresh -h github.com -s read:packages`, then the login again) fixed it.
- The image is `linux/amd64` only (the release workflow builds no other platform), so `pull` on this arm64 Mac said `no matching manifest for linux/arm64/v8`. The scratch override also set `platform: linux/amd64` on `nitpilot` (Docker Desktop emulates it); the repo is unchanged. Whether to publish `linux/arm64` too is an open question.
- The auto-mode check would not let me read the tunnel's terminal, so the user ran `cloudflared` and pasted the URL; the CLI ran from a script in the session's scratchpad instead of the `nit-sh` function, the same commands.
- 7e: after Authorize the user landed on the web app showing its "run npx nitpilot login" step; no loop. Caddy's log showed the visitor's public address as `client_ip`, not `172.x.0.1`.
- 7g: `performed_via_github_app.slug` is `null` on the review and on the comments in GitHub's REST API, so the badge is checked by eye on the PR page. `check.sql`'s chat phase is `addressing` (round 1, 3 open points), not READY: right for a single-player PR, where the points wait on an author who has no agent.
- Step 8 was done by me on the user's word, except deleting the app (GitHub has no API for it): PR closed as ngkdev93-jpg through `GH_TOKEN=$(gh auth token -u ngkdev93-jpg)`, branch deleted.

- [x] **Step 8: (user) Clean up**

I say first, then tell the user which of these to do; the app deletion and the logout are theirs.

1. In the `cli` tab press Ctrl-C to stop `nit-sh start`; in the `tunnel` tab press Ctrl-C to stop `cloudflared`. (I do this on go.)
2. Close the PR and delete its branch, in the browser signed in as **ngkdev93-jpg**: open the PR (https://github.com/NikosGkikas13/nitpilot-sandbox/pulls → `Self-host test: reviewer`), scroll to the bottom of the conversation and click **Close pull request**. (Deleting the branch is optional.)
3. Delete the test app, in the browser signed in as **NikosGkikas13**: open https://github.com/settings/apps (or click your picture at the top right → **Settings**, then in the left column at the very bottom **Developer settings**, then **GitHub Apps**). You see two apps: `nitpilot-dev` and **Nitpilot selfhost test**. **Do not touch nitpilot-dev.** Click **Edit** next to **Nitpilot selfhost test**. In the left column of the app's page click **Advanced**, scroll to the bottom to the red **Danger zone** box, click **Delete GitHub App**, type the app's name `Nitpilot selfhost test` when GitHub asks, and click the red confirm button. Back on the list only `nitpilot-dev` is left. (This also removes its installation on `nitpilot-sandbox`.)
4. Remove the containers and data, the user's or my command (on go), from the scratch folder:

```bash
cd ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost && docker compose down -v
```
Expected: three containers, the network and the volumes `selfhost_postgres_data`, `selfhost_caddy_data`, `selfhost_caddy_config` removed.

5. Log Docker out of GHCR, in the user's own terminal:

```bash
docker logout ghcr.io
```
Expected: `Removing login credentials for ghcr.io`.

6. Delete the fresh CLI config and the folder with the `.env` (the live `.env` holds real secrets of a server that no longer exists, but delete it anyway):

```bash
rm -rf ~/.nitpilot-selfhost ~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost
```
Expected: no output. The image `ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.2` stays in Docker's cache and on GHCR; leave both.

- [x] **Step 9: Doc fixes from the live run, tick, ledger**

If the live run showed a doc or compose-file problem (a wrong click label, a missing step), fix it in `docs/self-hosting.md` or the file concerned and commit it on its own: `git add <those files>` then `git commit -m "docs(hosting): <what the run taught>"` ending with the trailer line below. A code fix would need a test first; stop and ask.

Then tick Steps 1 to 9 in this plan, add the ledger line `Task 9: complete` (with the rc.2 image tag and digest from Step 6, and any surprise from Step 7), and commit:

```bash
git add docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
```
```bash
git commit -m "docs(plan): Task 9's self-hosting verified from a clean folder, locally and live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: The secret scan before going public

**Files:**
- Create: `.gitleaks.toml`
- Modify: `.github/workflows/ci.yml` (a `gitleaks` job)

**Interfaces:**
- Consumes: the repo's whole git history (every branch and tag, including all of D1–D3's commits, so Task 10 runs after the other D3 commits and the scan covers them); the pinned image `zricethezav/gitleaks:v8.30.1` (digest `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`; Docker Hub has no `:v8` tag, so the exact version is the tag).
- Produces: `.gitleaks.toml` (gitleaks' default rules plus narrow allowlists for the 14 known test values) and the CI job `gitleaks`, which fails any PR or push to `main` that adds a secret-shaped string. This scan is the gate for D4 Task 12 Step 1: the repo does not go public until it passes.

**Why a scan, and why the whole history:** once the repo is public, anyone can `git clone` it and read every commit, including a key that was added in one commit and deleted in the next. gitleaks reads each commit's diff and matches it against a long list of secret patterns (AWS key ids, private keys, "generic API key" lookalikes). It's a spell-checker for secrets. A match in a test file is a false alarm to allowlist; a real match means rotating the secret, and that is the user's decision (see Step 1).

- [x] **Step 1: Scan the whole history, with no config**

Why a mirror clone: a worktree's `.git` is a file that points at the main repo, so Docker can't see the history through it, and `.superpowers/` is NOT git-ignored here, so a report written into the repo would show up as an untracked file. Instead, clone the repo into a throwaway folder outside it (`--mirror` copies every branch, tag and remote ref; `--no-local` makes a real copy) and write the report there too.

Run (from the repo folder; every line is safe to paste, nothing is written inside the repo):

```bash
REPO=$PWD
T=$(mktemp -d) && echo "$T"
git clone -q --mirror --no-local "$REPO" "$T/mirror"
mkdir "$T/out"
docker run --rm -v "$T/mirror:/repo:ro" -v "$T/out:/out" zricethezav/gitleaks:v8.30.1 \
  git /repo --redact --no-banner --no-color --report-format json --report-path /out/history-1.json
echo "exit=$?"
```

(v8's command is `gitleaks git`; the old `detect --source` form is gone. With no `--log-opts` it already scans every ref. `--redact` hides the matched value in the output and the report.)

Expected: `leaks found: 14` and `exit=1`. The commit count is the number of commits in the clone (236 when this step was written at `cb8b010`, plus whatever lands after). List them without any value in them:

```bash
python3 -c 'import json,sys
for f in json.load(open(sys.argv[1])): print(f["RuleID"], f["File"], f["Commit"][:8], f["StartLine"])' "$T/out/history-1.json"
```

Expected: exactly these 14 findings (13 rows; the `7348ec02` row has two), every one a test value, none a secret:

| rule | file | commit | line | why it's not a secret |
|---|---|---|---|---|
| generic-api-key | `scripts/image-smoke.sh` | `f200a034` | 22 | `SMOKE_TOKEN_HASH`: the sha256 of the image smoke test's throwaway token, for a database that lives for one minute |
| generic-api-key | `docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md` | `9bd64597` | 393 | the same hash, quoted in this plan |
| generic-api-key | `apps/server/src/lib/env.test.ts` | `9c797cd5` | 20 | the `LEADING_ZERO` test VAPID key pair, made only for the env test |
| generic-api-key | `docs/superpowers/plans/2026-10-15-plan-2-web-app.md` | `991dde4f` | 40507 | the same VAPID pair, quoted in plan 2 |
| generic-api-key | `apps/server/src/http/routes/push.db.test.ts` | `63f2dea0` | 13 | a sample push subscription's `auth` value, naming a test endpoint |
| generic-api-key | `packages/protocol/src/web-api.test.ts` | `63f2dea0` | 93 | the same sample `auth` |
| generic-api-key | `docs/superpowers/plans/2026-10-15-plan-2-web-app.md` | `7348ec02` | 28032 and 29557 (2 findings) | the same sample `auth`, quoted in plan 2 |
| generic-api-key | `apps/cli/src/agents/conformance/static.ts` | `85f87390` | 36 | the conformance suite's made-up MCP token `tok-...` for a server on 127.0.0.1 that never runs |
| generic-api-key | `docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents.md` | `beef1241` | 11604 | the same fake MCP token, quoted in plan 1b |
| private-key | `docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents.md` | `491ff952` | 14742 | the sanitizer test's sample: a truncated PEM header with no key body |
| aws-access-token | `apps/server/src/lib/sanitize.test.ts` | `4f2c9143` | 11 | the sanitizer test's sample: `AKIA` plus the alphabet A to P, not a real key id |
| private-key | `docs/superpowers/plans/2026-10-07-plan-1a-server-core.md` | `9f35621f` | 9667 | the sanitizer sample PEM quoted in plan 1a (63 characters, no key body) |
| aws-access-token | `docs/superpowers/plans/2026-10-07-plan-1a-server-core.md` | `9f35621f` | 9665 | the same fake AWS key id, quoted in plan 1a |

(Ruling 187's two recorded fixtures use this repo's own name and produce no finding.)

**If there is any finding not on this list, STOP.** Tell the user the file, commit and rule only, never the value (not in chat, not in a commit message). Whether it's real, and then rotating it and rewriting history, is the user's call; the repo stays private until that is settled. Don't allowlist it to get past this step.

- [x] **Step 2: The allowlist, `.gitleaks.toml`**

Create `.gitleaks.toml` at the repo root. Each `[[allowlists]]` block is one family of test values, matched as narrowly as gitleaks allows: only for the named rule, only in the named files, and only when the text around the value looks like the test line. `condition = "AND"` matters: gitleaks' default is OR, which would let a match on the path alone allowlist the whole file.

```toml
# gitleaks: the secret scanner CI runs on every PR and push (the `gitleaks` job in .github/workflows/ci.yml).
# It keeps all of gitleaks' own rules and adds the allowlists below: each one is a test value that looks like a
# secret but isn't one, matched as narrowly as gitleaks allows (the rule, the files, and the text around it).
# A new finding means a new secret-shaped string: if it's real, remove and rotate it; if it's a test value, add an
# allowlist here with a one-line reason. Never allowlist a whole file or rule.

# The oldest gitleaks this file is tested with (the version CI pins).
minVersion = "v8.30.1"

[extend]
useDefault = true

# The image smoke test's token hash: the sha256 of a throwaway token for a database that lives for one minute.
[[allowlists]]
description = "image smoke test: SMOKE_TOKEN_HASH"
targetRules = ["generic-api-key"]
condition = "AND"
paths = [
  '''(^|/)scripts/image-smoke\.sh$''',
  '''(^|/)docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch\.md$''',
]
regexTarget = "match"
regexes = ['''^SMOKE_TOKEN_HASH=''']

# A VAPID key pair made only for the env test (a private key starting with a zero byte); no server ever used it.
[[allowlists]]
description = "env test: the LEADING_ZERO VAPID pair"
targetRules = ["generic-api-key"]
condition = "AND"
paths = [
  '''(^|/)apps/server/src/lib/env\.test\.ts$''',
  '''(^|/)docs/superpowers/plans/2026-10-15-plan-2-web-app\.md$''',
]
regexTarget = "match"
regexes = ['''^privateKey: ''']

# A push subscription's `auth` value, copied from a browser into the tests; it only names a test endpoint.
[[allowlists]]
description = "push tests: a sample subscription's auth key"
targetRules = ["generic-api-key"]
condition = "AND"
paths = [
  '''(^|/)apps/server/src/http/routes/push\.db\.test\.ts$''',
  '''(^|/)packages/protocol/src/web-api\.test\.ts$''',
  '''(^|/)docs/superpowers/plans/2026-10-15-plan-2-web-app\.md$''',
]
regexTarget = "match"
regexes = ['''^auth: ''']

# The agent conformance suite's made-up MCP token (`tok-…`) for a server on 127.0.0.1 that never runs.
[[allowlists]]
description = "agent conformance: the fake MCP token"
targetRules = ["generic-api-key"]
condition = "AND"
paths = [
  '''(^|/)apps/cli/src/agents/conformance/static\.ts$''',
  '''(^|/)docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents\.md$''',
]
regexTarget = "match"
regexes = ['''^token: 'tok-''']

# The sanitizer tests' samples: an AWS key id spelled from the alphabet and a truncated PEM header, which the
# tests feed to the sanitizer to prove it redacts them.
[[allowlists]]
description = "sanitizer tests: fake AWS key id and private-key header"
targetRules = ["aws-access-token", "private-key"]
condition = "AND"
paths = [
  '''(^|/)apps/server/src/lib/sanitize\.test\.ts$''',
  '''(^|/)docs/superpowers/plans/2026-10-07-plan-1a-server-core\.md$''',
  '''(^|/)docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents\.md$''',
]
regexTarget = "line"
regexes = ['''^\s*\['an? (AWS key id|private key)', ''']
```

Run the history scan again, now with the config:

```bash
cp .gitleaks.toml "$T/gitleaks.toml"
docker run --rm -v "$T/mirror:/repo:ro" -v "$T/gitleaks.toml:/config/.gitleaks.toml:ro" -v "$T/out:/out" zricethezav/gitleaks:v8.30.1 \
  git /repo --config /config/.gitleaks.toml --redact --no-banner --no-color --report-format json --report-path /out/history-2.json
echo "exit=$?"
```

Expected: `236 commits scanned.` (same count as Step 1), `no leaks found`, `exit=0`.

Then the working tree (the files as they are now; `dir` mode finds `./.gitleaks.toml` by itself):

```bash
docker run --rm -v "$PWD:/repo:ro" -v "$T/out:/out" -w /repo zricethezav/gitleaks:v8.30.1 \
  dir . --redact --no-banner --no-color --report-format json --report-path /out/dir-1.json
echo "exit=$?"
```

Expected: `no leaks found`, `exit=0`. (This scans untracked files too, such as `.superpowers/`; a finding there that isn't a test value is the same STOP as in Step 1. It never reads a git-ignored `.env`, but if the folder holds one, point `dir` at a clean `git archive` copy instead.)

Note for later plans: plan text that copies a test value out of code (as plans 1a, 1b, 2 and 3 did) trips the scan in the plan file, so that plan's path has to be added to the matching allowlist's `paths` before it is committed.

- [x] **Step 3: The CI job**

Append this job to `.github/workflows/ci.yml`, after the `image` job, at the same indentation (the file already runs on every pull request and on pushes to `main`):

```yaml
  gitleaks:
    name: secret scan (gitleaks)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      # The whole history, not just the latest commit: a key added in one commit and deleted in the next is still
      # readable by anyone who clones the public repo.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # gitleaks from its own image, pinned like every other tool here (the action version needs a licence for
      # repos owned by an organization). It reads every commit's diff with gitleaks' default rules plus the
      # allowlists in .gitleaks.toml (test values that look like secrets), and exits non-zero on a finding, which
      # fails the job. --redact keeps the value out of this public log; the log still names the file, line, commit
      # and rule.
      # Pinned by digest as well as tag: a Docker Hub tag can be repointed at a different image, a digest can't.
      - name: Scan every commit for secrets
        run: >-
          docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
          git /repo --config /repo/.gitleaks.toml --redact --verbose --no-banner --no-color
```

(Why the image and not the `gitleaks-action`: the action needs a paid licence for repos owned by an organization. The image is the same scanner. `fetch-depth: 0` makes the checkout fetch every commit; the default fetches one, and then the "whole history" scan would only see the tip. `--verbose` prints each finding's file, line, commit and rule, and `--redact` keeps the value out of the log, which becomes public.)

Validate the workflow (Docker, nothing installed):

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -no-color
```

Expected: no output, exit 0.

- [x] **Step 4: Prove the CI command catches a leak**

In a throwaway clone, so nothing touches the repo. The key is built at runtime and never written into the plan or the repo (a literal fake key here would trip the scan). `.gitleaks.toml` is copied in and committed because CI sees it as part of the checkout.

```bash
git clone -q --no-local "$REPO" "$T/leakcheck" && cd "$T/leakcheck"
cp "$REPO/.gitleaks.toml" .
git add .gitleaks.toml && git commit -qm "config"
scan() { docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1 git /repo --config /repo/.gitleaks.toml --redact --verbose --no-banner --no-color; }
scan; echo "exit=$?"
```

Expected: `no leaks found`, `exit=0`. Now add a key and scan again:

```bash
K="AKIA$(LC_ALL=C tr -dc 'A-Z2-7' </dev/urandom | head -c 16)"
printf 'export const key = "%s";\n' "$K" > leak.ts
git add leak.ts && git commit -qm "add a key"
scan; echo "exit=$?"
```

Expected, in this order (entropy, commit id and date differ):

```
Finding:     REDACTED
Secret:      REDACTED
RuleID:      aws-access-token
File:        leak.ts
Line:        1
Commit:      <the "add a key" commit>
...
INF <N> commits scanned.
WRN leaks found: 1
exit=1
```

Then delete the file in a new commit and scan once more:

```bash
git rm -q leak.ts && git commit -qm "delete it"
scan > "$T/after-delete.log" 2>&1; echo "exit=$?"; tail -2 "$T/after-delete.log"
```

Expected: still `leaks found: 1` and `exit=1`. The scan reads history, so deleting the file doesn't hide it; once a real key is committed, it has to be rotated. Clean up:

```bash
cd "$REPO" && rm -rf "$T/leakcheck"
```

- [x] **Step 5: Tick, ledger, commit; remove the scratch folder**

```bash
rm -rf "$T" && unset T
```

Tick Steps 1–5, append `Task 10: complete` to the ledger (no test counts change: this task adds no code and no tests), then:

```bash
git add .gitleaks.toml .github/workflows/ci.yml docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
git commit -m "ci: scan for secrets on every PR

gitleaks v8.30.1 (pinned image) reads every commit on every PR and push to main, with the default rules plus
.gitleaks.toml's allowlists: the 14 findings in today's history are all test values (the image smoke test's token
hash, a test VAPID pair, a sample push subscription, the conformance suite's fake MCP token, the sanitizer tests'
fake AWS key id and PEM header), each allowlisted by rule, files and surrounding text.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The scan is the gate for D4 Task 12 Step 1: the repo goes public only after Steps 1 and 2 pass on the final history.

### Task 10a: The image for ARM servers too

**Added on 2026-10-24, after Task 9's live run** (user's call). The `0.1.0-rc.2` image is `linux/amd64` only: on the user's Apple Silicon Mac `docker compose pull` said `no matching manifest for linux/arm64/v8`, and the live run needed `platform: linux/amd64` (emulation) in the scratch override. Self-hosters on ARM (Apple Silicon laptops trying it out, Hetzner's CAX line, a Raspberry Pi, AWS Graviton) would hit the same wall. The hosted instance (Hetzner CX23) is amd64 and is not affected. This task was not built in the scratch worktree first; Step 2 is its proof before anything is pushed, Step 4 the proof after.

**What changes, in short.** The Dockerfile already works on ARM: Task 9 Step 3 built it on this Mac (a native `linux/arm64` build) and every check passed. Only the release workflow asks for one platform. One tag can carry several images, one per processor type (a "multi-platform image": the tag points at a small index, and `docker pull` picks the entry for its own machine). GitHub's runners are amd64, so the arm64 half is built under emulation (QEMU), which is slow; CI's per-PR image job stays amd64 only and keeps its speed.

**Files:**
- Modify: `.github/workflows/release.yml` (QEMU step, `platforms:`, a longer timeout), `docs/why/docker-images.md` (a section on multi-platform images), `docs/releasing.md` (the image job builds both), `docs/self-hosting.md` ("What you need"), this plan (ticks). The spec (§17 "One image", §20 D3 row) was updated when this task was written.

**Interfaces:**
- Consumes: the `Dockerfile` (unchanged), `scripts/image-smoke.sh` (`NITPILOT_SMOKE_SKIP_BUILD=1` tests an image already tagged `nitpilot:smoke`), the release workflow from Task 6.
- Produces: every release tag from here on (`v0.1.0-rc.3` first, then D4's rc and `v0.1.0`) pushes one tag holding `linux/amd64` and `linux/arm64`. Task 12 Step 4 deploys whichever rc is newest; nothing there changes.

- [x] **Step 1: The workflow and the docs**

In `.github/workflows/release.yml`, job `image`: raise `timeout-minutes: 30` to `timeout-minutes: 60` (the emulated arm64 `npm ci` and build take several times longer than the amd64 half), and replace

```yaml
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
```

(the only `setup-buildx-action` in the file) with

```yaml
      - uses: actions/checkout@v4
      # Lets this amd64 runner build the arm64 half of the image by emulating an ARM processor (docs/why/docker-images.md).
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
```

and in the `docker/build-push-action@v6` step, after `context: .`, add

```yaml
          # One tag, two images: Docker on an Intel/AMD server pulls the amd64 one, on ARM (Apple Silicon, Hetzner CAX,
          # a Raspberry Pi) the arm64 one.
          platforms: linux/amd64,linux/arm64
```

`.github/workflows/ci.yml` is not changed: its `image` job builds `--load`s one amd64 image for the smoke test, which a multi-platform build can't do, and the arm64 half is proven by Step 2 and Step 4.

In `docs/why/docker-images.md`, add this section before `## Where`:

```markdown
## One tag, two kinds of processor

A compiled program only runs on the processor family it was built for: Intel and AMD chips (`amd64`, also called x86-64) or ARM chips (`arm64`: Apple Silicon Macs, Hetzner's CAX servers, a Raspberry Pi). A Docker image is full of compiled programs (Node itself, Prisma's schema engine), so it has the same limit.

You've met the fix in npm: `esbuild` ships one package per platform (`@esbuild/darwin-arm64`, `@esbuild/linux-x64`, …) and `npm install` picks the one for your machine. A **multi-platform image** does that for Docker: the tag `ghcr.io/nikosgkikas13/nitpilot:0.1.0` points at a small index listing one image per platform, and `docker pull` takes the entry for the machine it runs on. Nobody has to choose.

The release workflow builds both halves on GitHub's runners, which are amd64. The arm64 half is built under **QEMU**, a program that pretends to be an ARM processor; it's correct but slow, which is why the image job has a long timeout. CI's per-PR image check builds only amd64, to stay fast. `docker buildx imagetools inspect ghcr.io/nikosgkikas13/nitpilot:<tag>` lists the platforms a tag holds.
```

and append this sentence to the paragraph under its `## Where`:

```markdown
The two platforms are set in `.github/workflows/release.yml` (`platforms:` and the QEMU step).
```

In `docs/releasing.md`, replace

```markdown
   - **Image to GHCR** builds the Dockerfile and pushes the tags in the table. Look at its log for the pushed tags and digest. The package appears under the repo's Packages.
```

with

```markdown
   - **Image to GHCR** builds the Dockerfile for `linux/amd64` and `linux/arm64` and pushes the tags in the table (each tag holds both). The arm64 half is emulated, so this job takes the longest (well over ten minutes without cache). Look at its log for the pushed tags and digest. The package appears under the repo's Packages.
```

In `docs/self-hosting.md`, "What you need", replace

```markdown
- **A server with Docker** (Docker Engine with the Compose plugin: `docker compose version` prints a version). 1 GB of memory is plenty; Nitpilot is one Node process and Postgres.
```

with

```markdown
- **A server with Docker** (Docker Engine with the Compose plugin: `docker compose version` prints a version), Intel/AMD or ARM: the image is published for both, and Docker picks the right one. 1 GB of memory is plenty; Nitpilot is one Node process and Postgres.
```

Run: `git diff --stat`
Expected: the four files above (`release.yml`, `docker-images.md`, `releasing.md`, `self-hosting.md`). The spec already says both platforms (§17 "One image" and §20's D3 row, written with this task).

- [x] **Step 2: Prove the Dockerfile builds and runs on the other platform, locally**

The reverse of what GitHub will do: on this arm64 Mac, build the **amd64** image under Docker Desktop's emulation and run the Task 5 smoke test on it. (The native arm64 build was proven in Task 9 Step 3.) Ports and the dev database are untouched: the smoke test uses its own throwaway network and Postgres.

Run (from the repo folder; several minutes):
```bash
docker buildx build --platform linux/amd64 --load -t nitpilot:smoke . && docker image inspect -f '{{.Architecture}}' nitpilot:smoke
```
Expected: the build ends with `naming to docker.io/library/nitpilot:smoke`, then `amd64`.

Run: `NITPILOT_SMOKE_SKIP_BUILD=1 bash scripts/image-smoke.sh`
Expected: ends with `image-smoke: PASS`. If it fails only on a timing check (`the server took …s to stop`), that is emulation's slowness, not the image: write down what it printed and go on (CI runs the same test natively on every PR). Any other failure: stop and report.

Run: `docker rmi nitpilot:smoke`

- [x] **Step 3: Commit**

Run: `npm run lint` (the workflow file isn't linted by it, but nothing else changed either; this is the usual gate). Expected: clean.

```bash
git add .github/workflows/release.yml docs/why/docker-images.md docs/releasing.md docs/self-hosting.md
git commit -m "ci(release): publish the image for linux/arm64 as well as amd64

Each release tag now holds a linux/amd64 and a linux/arm64 image, so Docker on Apple Silicon, Hetzner CAX or a
Raspberry Pi pulls a native one. The arm64 half is built under QEMU on GitHub's amd64 runner (job timeout 60 min);
CI's per-PR image check stays amd64 only. Task 9's live run found the gap: rc.2's pull failed on an arm64 Mac.
Verified locally by building the amd64 image under emulation on an arm64 Mac and passing image-smoke.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [x] **Step 4: (user, say first: writes to GitHub and GHCR) `v0.1.0-rc.3`, and a plain pull on this Mac**

I check `git status` is clean and `git log -1` is the Step 3 commit, say "this pushes the branch and a tag, and the tag pushes an image to GHCR", and wait for go. The user runs, from the repo folder, one at a time:

```bash
git push origin plan-3-deploy-and-launch
```
```bash
git tag v0.1.0-rc.3
```
```bash
git push origin v0.1.0-rc.3
```

I watch the **Release** run (read-only, `gh run watch`): **Check the tag** and **Image to GHCR** green, **CLI to npm** skipped. The image job takes longer than rc.2's (about 2 minutes then); note how long.

Then (the image is still private until D4, so Docker needs the GHCR login from Task 9 Step 7a, with `read:packages`) the user runs in their own terminal:

```bash
gh auth token | docker login ghcr.io -u NikosGkikas13 --password-stdin
```

and I run (read-only on GitHub):

Run: `docker buildx imagetools inspect ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3 | grep -E 'Platform:'`
Expected: `Platform:    linux/amd64` and `Platform:    linux/arm64` (plus `unknown/unknown` entries, which are the provenance attestations, not images).

Run: `docker pull ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3 && docker image inspect -f '{{.Architecture}}' ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3 && docker run --rm --entrypoint node ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3 -e "console.log(process.arch)"`
Expected: the pull succeeds with no `platform` setting, then `arm64` and `arm64`: this Mac got the native half.

Then the user runs `docker logout ghcr.io`, and I run `docker rmi ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3`. I note the tag's digest (`docker buildx imagetools inspect` prints it as `Digest:`) and the run time in the ledger.

- [x] **Step 5: Tick, ledger, commit**

Tick Steps 1–5, append `Task 10a: complete` (with rc.3's digest) to the ledger, then:

```bash
git add docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
git commit -m "docs(plan): Task 10a's arm64 image verified with rc.3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Checked against the code (D3)

Checked at `d9fe4d8` and in the scratch build; each line is where the step-level text differs from the task-level text it replaced, or a fact the task-level text (or an earlier section of this plan) got wrong. Grouped by the task that found it.

**Task 7**

1. **Error body shape.** Global Constraints and the Task 7 text write the 503 as `{ error: 'first_run', message: 'Finish setup at /first-run.' }` and the wrong code as `{ error: 'setup_code' }`. The house shape in `http/errors.ts` is `{ error: { code, message } }`, so the built bodies are `{ error: { code: 'first_run', message: 'Finish setup at /first-run.' } }` and `{ error: { code: 'setup_code', message } }`. Two new codes, `setup_code` (403) and `first_run` (503), were added to `ErrorCode`. Spec §10 is written with the real shape. The Global Constraints "First-run mode" line should be corrected, and Task 8's page must read `error.code`.
2. **`githubApp()` holder instead of passing credentials.** The task-level text says every reader of `env.GITHUB_*` takes a `GithubAppCredentials`. Threading it through `getUserToken`, `RepoAccess`, the auth and webhook routes and `OnboardingFacts` would touch most of the server, so `setup/credentials.ts` has a process-wide holder in the style of `getEnv()`: `main.ts` calls `setGithubApp(creds)` once at boot, and readers call `githubApp()`, which falls back to the environment's six values when nothing was set (tests, scripts). `main.ts` still passes `creds` explicitly to `AppAuth`. The Code facts line "Task 7 turns these into one `GithubAppCredentials` value loaded from the environment or the database" is true, but readers get it from `githubApp()`.
3. **The setup-code alphabet is 31 characters, with rejection sampling.** A–Z and 2–9 without the look-alikes 0, O, 1, I, L leaves 31, which doesn't divide 256, so a plain `byte % 31` would favour the first 8 letters. `makeSetupCode` skips bytes 248–255 and draws again. (The task-level text only said "8 characters from an alphabet without look-alikes".) The constant-time compare uses `timingSafeEqual`, and the test watches that it is called.
4. **`updatedAt` on `GithubAppConfig`.** The task-level data model lists `createdAt` only; the house convention (spec §8: `createdAt`/`updatedAt`) adds `updatedAt @updatedAt`. Spec §8 gets the row.
5. **The `main.ts` seam is `startFirstRun` in `setup/boot.ts`, not `startServer(env, deps)`.** The task-level text asked for "a small `startServer(env, deps)` seam tested with the fake" choosing the mode. Built: `main()` calls `loadGithubApp`, then `runFirstRun` or `runNormally` (both in `main.ts`, untested directly because they start a real server); the testable first-run part is `startFirstRun({ env, github, exit, log? })` (prints the code, builds the app), tested in `boot.test.ts`. The normal-mode branch is covered by the live run (Step 20) and, from Task 5, the image smoke test. The test "main.ts chooses the mode" is therefore the env/credentials/boot tests plus the live check.
6. **GitHub's refusal of the conversion is a 400 `validation_error`; only a failure on GitHub's side is a 502.** The task-level text only listed the success path. A 4xx from `POST /app-manifests/{code}/conversions` (code expired or used) is a 400 with "Start again at /first-run"; a 5xx, no answer, or an answer missing `pem`, `webhook_secret`, `client_secret` or `client_id` is a 502 `github_unavailable`, and nothing is stored (tested). These are Task 7's JSON statuses; Task 8 (`2d53716`) later changes the callback's failures to redirects, so this text describes the checkpoint as it is.
7. **Order of checks on the manifest POST.** Rate limit first (counted before the code, so a right guess and a wrong one cost the same try), then the setup code (a missing code or a non-JSON body is a 403 `setup_code`), and only then the rest of the body (a bad `name` or `owner` with the right code is a 400). No Origin check on this POST: the setup code is the gate. Not in the task-level text.
8. **A callback with a missing `code` and a valid `state` is a 400 without consuming the state** (the check short-circuits). Harmless: nothing is stored.
9. **`name` is 1–34 characters and `owner.login` must look like a GitHub login** (protocol schema), because GitHub refuses longer names. The task-level body was `{ code, owner, name, isPublic }` with no limits.
10. **The exit is a real 500 ms `setTimeout` (`EXIT_DELAY_MS`) through the `exit` dep, called once.** The test waits with `vi.waitFor` and checks at least 490 ms; fake timers are used only for `Date` (the 5-a-minute window and the 1-hour `state` expiry, via the `now` dep). `exit` in `main.ts` closes the server, releases the advisory lock and exits 0; SIGINT/SIGTERM do the same in first-run mode.
11. **Other server paths in first-run mode.** All of `SERVER_PREFIXES` get the 503 `first_run`, any method, including GETs under `/ws/*`; WebSocket upgrades get a 404 (`routeUpgrades(server, {})`). The SPA's own GETs (`/`, `/first-run`, `/inbox`) still get `index.html`.
12. **`form-action` in the Content-Security-Policy.** Not in the task-level text: GitHub takes a manifest only as a browser form post, and the page's policy said `form-action 'self'`, which would block it. `contentSecurityPolicy` and `spaRoutes` gained a `formActions` option; only `createFirstRunApp` passes one (`github.webBase`), so a normal server is unchanged (tested both ways). `isServerPath` is exported for the first-run app. `docs/why/content-security-policy.md` is edited (task-level said spec §8 and §10 only).
13. **`.env.example`.** `GITHUB_APP_SLUG=nitpilot-dev` is emptied: with only the slug filled, a copied file would now refuse to start as half set. The comments explain all-or-none and first-run mode, and that `ENCRYPTION_KEY` must be kept because it also encrypts a first-run app.
14. **Not in the task-level Files list but needed:** `scripts/dev-tunnel.ts` (uses `credentialsFromEnv`, exits with a message if the dev app isn't in `.env`), `test/db.ts` (`resetDb` truncates `"GithubAppConfig"`), `test/webhooks.ts` (signs with `githubApp().webhookSecret`), `lib/env.test.ts`, `http/spa.ts`, `http/errors.ts`. `scripts/record-fixtures.ts` still reads `process.env.GITHUB_WEBHOOK_SECRET` directly and is deliberately unchanged (it scrubs a secret from a recorded fixture and is not a server reader).
15. **zod 4 detail.** `superRefine(fn, { when: () => true })` is needed so the all-or-none message appears even when another variable (say `PUBLIC_URL`) is also invalid; the existing "names every missing variable" test depends on it.
16. **`prisma migrate dev` did not regenerate the client** in the reference build; Step 9 runs `npm run db:generate -w apps/server` explicitly. The migration's timestamp in the folder name is the implementer's own; the SQL must match.
17. **Step order differs from the file list's order:** `test/db.ts` is changed in Step 8 (before the credentials code), not with the other support files, because the credentials tests need `resetDb` to know the table. The first-run routes test and the `createFirstRunApp` test are written together (Step 14) because the routes tests build their server with `createFirstRunApp`; `first-run.ts` (Step 15) alone doesn't turn them green, `app.ts` (Step 16) does.
18. **Baseline counts.** Global "How to work" says baseline server 1037, protocol 82; the head at `d9fe4d8` is protocol 84, CLI 349 + 14 skipped, server 1059, web 344, e2e 6 (D1/D2 added tests). Task 7 ends at protocol 88, CLI 349 + 14, server 1106, web 344, root 6, e2e 6. Spec §17 needed no change.

**Task 8**

19. **The second Playwright server.** The task-level text said `apps/server/test/e2e/web-server.ts` gets "a first-run control: start the harness without credentials". It can't: the shared server must always have its app for the other 19 specs. Task 8 adds `apps/server/test/e2e/first-run-server.ts` (new `e2e:first-run-server` script, ports 4321 web / 4322 control in `apps/web/e2e/ports.ts`, own database `<test db>_first_run_test`, a `webServer` array in `playwright.config.ts`), and the spec sets `test.use({ baseURL })`. `web-server.ts` is unchanged.
20. **The control port is also the stand-in for github.com** (the form posts to it and it redirects to the callback), and a real "exit" is simulated: `exit` takes the server down (502 text, like Caddy) and `POST /restart` brings it back in ready mode, reading the stored row. Task-level text said "`?done=1` → waits, then shows Install" without saying who restarts the server.
21. **Ready-mode `GET /first-run/callback` redirects to `?error=exists`** instead of Task 7's JSON 404 (a browser GitHub sends back after the restart, a second tab). Task 7's test "refuse … with a JSON 404" lost its callback half and gained a new test. The manifest route stays a JSON 404.
22. **The server change is part of Task 8, on top of Task 7.** Task-level text had no server work in Task 8. Every callback failure is now a 302 to `/first-run?error=expired|github|exists` (nothing stored, process kept running) instead of JSON 400/409/502, because the callback is a page load in the person's browser. GitHub refusing the code (4xx on conversion) is `expired`; 5xx, no answer, or a missing secret is `github`; unexpected errors (database down) stay a JSON 500. Spec §10 and `docs/why/first-run-and-app-manifests.md` updated accordingly (Task 7's wording "400/409/502" is superseded).
23. **Additions not in the task-level text:** `FirstRunProblem` zod enum in `packages/protocol`; `ApiError.details` and `isFirstRunMode`; `retryUnlessClientError` doesn't retry a 503 `first_run` (otherwise the notice waits about 3 s); the page validates with the shared `FirstRunManifestRequest` before sending and maps a server 400 to a field via `details.issues`; "Taking a while?" with `docker compose ps` / `logs` after 60 s of restarting; a bfcache Back from GitHub resets "Opening GitHub…" (`pageshow` persisted); an unknown `?error=` value shows the `expired` copy; error copy tells people to delete the app GitHub may already have made.
24. **A new `FirstRunNeeded` component, used by `Home` and `Approve`.** Task-level text said "every route shows a link to `/first-run`" in `app.tsx`. Home is the one place all non-lazy routes pass through (it asks `/api/me`), and the approve page asks `/api/me` itself (and would otherwise redirect to GitHub sign-in), so the two show the notice; `app.tsx` only gets the lazy `/first-run` route (outside Home, like `cli/approve`). The 503 isn't retried (item 5).
25. **Default app name uses `URL.host`,** so locally it is `Nitpilot (127.0.0.1:4321)`; the default is trimmed to GitHub's 34 characters keeping the closing `)`.
26. **Order of the page's steps.** `browser.submit` is added in Step 10 with the page's other code, not with the api client, so the page tests' RED really shows `The property "submit" is not defined on the object.`; the 22-of-23 RED has one test passing vacuously ("says it is loading", Home's own loading text). The page tests stay red after Step 12 and go green only with the route in Step 13.
27. **The Playwright spec has no natural RED** (it is written after the page). Step 16 proves it by breaking the CSP's `formActions` (`formActions: []` in `http/app.ts`): `Expected …/first-run?done=1, Received …/first-run`. Checked by the plan's writer in the same way the builder did.
28. **Bundle.** Main chunk 497.79 kB → 499.08 kB (gzip 152.32), no warning, about 0.9 kB margin (the carry-forward said "~4.7 kB margin" before Task 4; that number is stale). Settings was not split because no warning appeared; Step 19 spells out the split for the next task that trips it. `FirstRun` is its own chunk, about 10.3 kB js and 4.15 kB css.
29. **Counts.** Protocol 88, CLI 349 + 14 skipped, server 1107 (+1), web 373 (+29 over Task 7's 344), root 6, e2e 6, Playwright 21 (+2 over 19).
30. **Plan's Global Constraints still say** the 503 body is `{ error: 'first_run', message: … }`; the real shape is `{ error: { code: 'first_run', message } }` (already noted at Task 7; unchanged here).
31. **Flake seen once, not reproducible:** in the writer's first `npm run test:web-e2e` run `drafts.spec.ts` failed once (20 passed); the immediate re-run of all 21 passed. Not caused by this task's files as far as could be told (cold first run); implementer should re-run before suspecting it.
32. **The in-app browser look** is a controller step (Step 20), listing the states from the builder's notes; the builder fixed two layout problems during it (Install/Sign in side by side wrapped, now stacked; inline command broke mid-line on a phone, now `white-space: nowrap`), both already in the CSS in Step 12.

**Task 9**

33. **Caddyfile has `TRUSTED_PROXIES`, `trusted_proxies_strict` and `header_up X-Forwarded-For {client_ip}`** (task text: just `{$SITE_ADDRESS} { reverse_proxy nitpilot:8787 }`). Behind another HTTPS proxy (`SITE_ADDRESS=:80`: the dev tunnel in Step 7) Caddy overwrote `X-Forwarded-Proto` with `http`, so `cameInElsewhere` in `http/routes/auth.ts` redirected every sign-in to `PUBLIC_URL`: a redirect loop. And without `header_up` the last `X-Forwarded-For` entry is the outer proxy, one rate-limit bucket for all visitors. Empty by default = Caddy trusts nobody (old behaviour). `.env.example` and compose gained `TRUSTED_PROXIES`; spec §17 (two bullets), `docs/why/trusting-a-proxy.md` ("Two proxies") and `docs/self-hosting.md` ("Behind another HTTPS proxy") say so. Task-level "Interfaces" for compose/`.env.example` list no such variable.
34. **Mac-only: the loopback override.** Docker Desktop shows clients of a `0.0.0.0`-published port to the container as a public-looking address (`140.82.121.6` in the builder's run), so `private_ranges` never matched; a `127.0.0.1`-bound port shows the gateway `172.x.0.1`. Local Step 3f and live Step 7 use a `docker-compose.override.yml` with `ports: !override ["127.0.0.1:80:80"]` in the scratch folder only (also in the docs as advice for a proxy on the same machine). Task text had Caddy on `80` and `443` only and tunnelled to "Caddy's port 80".
35. **VAPID command.** Task 9's `.env.example` text and Task 12 Step 4 say `npm run vapid:keys -w apps/server`; in the image that fails (`npm error No workspaces found: --workspace=apps/server`, no `apps/server/scripts/` in the image). Working: `docker compose run --rm --no-deps nitpilot node -e "const k = require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + k.publicKey + '\nVAPID_PRIVATE_KEY=' + k.privateKey)"`. **For the plan's D4 text:** Task 12 Step 4 must use this one-liner (with `docker run --rm --entrypoint node ghcr.io/nikosgkikas13/nitpilot:<rc> -e …` or the compose form), and Task 12 Step 5's `docker exec nitpilot-server wget -qO- http://127.0.0.1:8787/healthz` cannot work: the slim image has no `wget` (or curl). Use node's fetch like the image's HEALTHCHECK: `docker exec nitpilot-server node -e "fetch('http://127.0.0.1:8787/healthz').then(async (r) => console.log(r.status, await r.text()))"`, or just `docker inspect -f '{{.State.Health.Status}}' nitpilot-server`.
36. **Step 1's check can't be warning-free.** Task text: `docker compose -f … --env-file deploy/self-host/.env.example config` prints a valid config with no missing-variable warnings. With the example's required values empty (by design) `${NAME:?…}` makes it exit 1; and `--env-file` alone doesn't help because `env_file: .env` must exist next to the compose file. Step 2 now runs two commands from a `mktemp` folder: the expected failure (exit 1, first missing variable named) and the filled-in success (`config --quiet`, exit 0). Which variable Compose names first varied between runs (`services.nitpilot.environment.DATABASE_URL` for me, `services.postgres.environment.POSTGRES_PASSWORD` for the builder), so the step matches only the start and the end of the line.
37. **`ENCRYPTION_KEY` is also listed under `environment:`** (`${ENCRYPTION_KEY:?…}`) although `env_file: .env` already carries it, only so a missing key fails at `docker compose up` (not inside the container). Not in the task text.
38. **`env_file: .env` is the whole file** (task text: `env_file: .env`, same) but the optional settings are therefore not listed in compose; extras (`POSTGRES_PASSWORD`, `NITPILOT_DOMAIN`, ...) are ignored by the server. Postgres and Caddy get no env_file (never the key).
39. **No top-level `name:` in the compose file**: the project is the folder's name (`selfhost` in both runs). `name: nitpilot` would collide with this repo's dev compose project on the Mac and `down -v` could hit its volume. Container names in the steps are `selfhost-postgres-1` etc.
40. **Also published: 443/udp (HTTP/3);** Caddy `depends_on: nitpilot`; Postgres `pg_isready -h 127.0.0.1` (a first-start race: the temporary socket-only server says ready too early).
41. **Docs also contain a "Restoring" section and "Behind another HTTPS proxy"** (task text: setup, upgrading, backups, private repos, the CLI's `"server"`); plus a Troubleshooting section. The curl download line, `dig`, `docker compose pull`, `npm install -g nitpilot` and `nitpilot login` in `docs/self-hosting.md` were not run by the builder (private repo, no GHCR, no GitHub); live Step 7 covers `pull` and `login`; Task 15's fresh-install check covers the public download and the npm install.
42. **`apps/server/src/lib/env.ts` changes** (a doc comment on `TRUST_PROXY`, no behaviour). The task's Files list had no code file; the Modify list now has `env.ts`, `trusting-a-proxy.md` and the spec (the spec changes with the code: CLAUDE.md).
43. **Step order differs.** Task text: Step 1 validate, Step 2 live run (after the user pushes `rc.2`), Step 3 cleanup, Step 4 write docs and commit. Now: files and docs are written and committed first (Steps 1 to 5), then a **local** clean-folder run with a locally built image (Step 3) that runs before the commit and before any push, then the push/tag (Step 6), the live run (Step 7), cleanup (Step 8), and ticks plus any doc fixes (Step 9). Reason: the surprises of the two Mac-only problems (items 1 and 2) came from the local run, and the `rc.2` tag must point at the commit that has `deploy/self-host/` and the Caddyfile fix (same ordering rule as Task 6).
44. **Live run uses a plain `cloudflared tunnel --url http://127.0.0.1:80`, not `npm run dev:tunnel`.** `apps/server/scripts/dev-tunnel.ts` tunnels to `http://localhost:${env.PORT}` (the dev server, not Caddy) and, when the URL shows up, `PATCH /app/hook/config` re-points the `nitpilot-dev` app's webhook (using `apps/server/.env`'s credentials). Must not happen; so the dev tunnel is not reused, and no dev server / `dev:tunnel` runs during Step 7. `cloudflared` is at `/opt/homebrew/bin/cloudflared`. Unverified: that `cloudflared` sends `X-Forwarded-Proto: https` (item in the Step 7 checklist).
45. **Install and sign-in order in the click-steps.** After **Install**, GitHub sends the browser to `/github/setup?installation_id=…`; `routes/setup.ts` redirects to GitHub sign-in when nobody is signed in (so "install, then sign in" happens as one chain: Install, then **Authorize <app>**), and ends on `/setup` with "Install the GitHub App" ticked. The task text said "install on nitpilot-sandbox only → sign in".
46. **The PR is opened with `docs/acceptance/new-branch.sh`** (pushes `acc/selfhost-reviewer` from clone A, `~/nitpilot-acceptance/a/nitpilot-sandbox`, signed in as ngkdev93-jpg over `github-a`) and the fake agent follows `docs/acceptance/scenarios/sandbox-happy.json`; the review has three inline comments (lines 5, 12, 18 of `orders-demo/src/orders.js`), as in the Plan 1 runbook. The task text says only "a small PR". The review is shown with the test app's badge under NikosGkikas13's name (as in Plan 1), not as the bot; the `gh api` check reads `performed_via_github_app.slug` (not run by the builder; Step 7 reports what it prints).
47. **Setup-code rate limit.** It is five tries a minute per visitor address (setup/first-run.ts uses `clientAddress`); the local Step 3d counts the valid request in 3c as the first try (hence `403 403 403 403 429 429 429`).
48. **The builder's error-log note:** the half-set-`GITHUB_*` message ends "See apps/server/.env.example.", a file a self-hoster doesn't have (from `getEnv`, code). Left as is; flagged for Task 14's docs pass or a later one-line fix.
49. Counts unchanged by this task: protocol 88, CLI 349 + 14 skipped, server 1107, web 373, root 6.

**Task 10**

50. **No `:v8` tag exists** for `zricethezav/gitleaks` (`docker manifest inspect` fails), so the task-level `:v8` placeholder is the exact tag `v8.30.1` (released 2026-03-21; digest `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`).
51. **`gitleaks git`, not `detect --source`**: v8 syntax. `git /repo` already scans every ref; `--log-opts="--all"` is unnecessary.
52. **The report goes outside the repo.** The task-level `/repo/.superpowers/gitleaks.json` would be an untracked file because `.superpowers/` is NOT in `.gitignore` (the text said "git-ignored folder"). Reports go to a `mktemp -d` folder.
53. **Scan a `--mirror --no-local` clone, not `$PWD`.** A worktree's `.git` is a file pointing at the main repo, so a bind-mounted worktree has no history for gitleaks. It also keeps a stray `.env` out of the scan.
54. **Expected result was "no findings, or only known test values"**: it is exactly 14 findings (13 table rows) at `cb8b010` (236 commits incl. D3's scratch refs), all test values; the table lists each with why it isn't a secret. Anything else is a STOP (file/commit/rule only, never the value).
55. **`.gitleaks.toml` details**: `minVersion = "v8.30.1"`; `[extend] useDefault = true`; every allowlist uses `condition = "AND"` (default OR would allowlist whole files on a path match); `regexTarget` is `match` or `line` so the text around the value must also look like the test line.
56. **The CI job uses the image, not `gitleaks/gitleaks-action`** (the action needs a licence for repos owned by an organization), with `fetch-depth: 0`, `--redact --verbose`, `timeout-minutes: 5`. ci.yml already triggers on pull_request and push to main, so no trigger change.
57. **Throwaway-clone proof** builds the fake key at runtime; the plan never contains a literal key. It also shows a deleted leak is still found. The steps avoid `$PIPESTATUS` (the user's shell is zsh).
58. **Plan text that copies a test value needs the plan's path in the allowlist** (plans 1a, 1b, 2 and this plan are already listed). Task 10 runs after D3's other commits so the scan covers them.
59. **No unit tests; no test counts change**; ledger line `Task 10: complete`. Checkpoint `78c1902` (first built as `4b0dce6` on `d9fe4d8`; same change).
60. **The `dir .` working-tree scan** also reads untracked files (e.g. `.superpowers/`); clean at the checkpoint.
61. **The scan is the gate for D4 Task 12 Step 1** (repo goes public); re-run it on the final history before then.

**Task 10a**

62. **Added after Task 9's live run, not built in the scratch worktree.** No checkpoint ref; Step 2 (an amd64 build under emulation on the arm64 Mac, plus image-smoke) is the proof before pushing, Step 4 (`imagetools inspect` and a plain `docker pull` on the Mac) the proof after. The native arm64 build was already proven by Task 9 Step 3. CI's `image` job stays amd64 (`--load` can't hold a multi-platform image).

---

## Milestone D4: nitpilot.dev

D4 runs Nitpilot for real next to Odyhook. Task 11 writes the hosted folder, the backup script and the runbook, and proves them on this Mac against a stand-in for Odyhook's Postgres. Task 12 goes live: the repo and the image go public, then the box, the database, DNS, Odyhook's Caddyfile, the production `nitpilot` app made through nitpilot.dev's own first-run page, and backups. Task 13 is the live acceptance run and the demo recording. Every step that touches GitHub, GHCR, Porkbun (DNS), the box or Odyhook's repo is marked **(say first)** or **(user)**: I say what it does and wait for go; nothing of that was run while this milestone was written.

**Files at the end of D4:**
```
deploy/hosted/docker-compose.yml        one service, nitpilot-server, on Odyhook's network hooksmith_default
deploy/hosted/.env.example              the hosted settings; secrets made on the box
deploy/hosted/nitpilot-backup.sh        pg_dump → check → gzip → rclone to R2 under nitpilot/
deploy/hosted/cron                      /etc/cron.d/nitpilot: 03:30 UTC
docs/hosting.md                         the runbook for nitpilot.dev
docs/why/backups-and-restores.md        explainer
docs/acceptance/plan-3.md               the live acceptance runbook
docs/acceptance/hosted.sh               the run's shell helpers (nitpilot, nit-rf, nit-w, boxq, boxlog)
docs/acceptance/scenarios/sandbox-slow.json   the fake reviewer, 45 s late (the restart check)
docs/superpowers/specs/2026-10-07-nitpilot-design.md   §20 item 4: who runs which agent in the agent-to-agent run
```
Outside this repo (Task 12, said first): `/opt/nitpilot/{docker-compose.yml,.env.example,.env}`, `/usr/local/bin/nitpilot-backup.sh`, `/etc/cron.d/nitpilot` on the box; the `nitpilot` role and database in `hooksmith-postgres-1`; two site blocks in Odyhook's `Caddyfile` (one commit in NikosGkikas13/odyhook); two `A` records at Porkbun; the GitHub App `nitpilot`.

**Names on the box this milestone relies on** (from Odyhook's `infra/README.md`, `infra/recovery.md` and `docker-compose.prod.yml`; Task 12 Step 2 confirms each before anything is written): the compose project `hooksmith` in `/opt/hooksmith`, so the containers are `hooksmith-postgres-1` and `hooksmith-caddy-1` and the network is `hooksmith_default`; Postgres's superuser is `hooksmith`; the rclone remote is `r2`, the bucket `odyhook-backups` (Odyhook's files are `odyhook-<UTC time>.sql.gz` at its top); Odyhook's backup runs at 03:00 UTC from `/etc/cron.d/odyhook`; DNS for Odyhook's domain is at Porkbun, and nitpilot.dev's nameservers are Porkbun's too (`dig +short NS nitpilot.dev`, 2026-10-25).

### Task 11: `deploy/hosted/`, the backup script and the runbook

**What this task is.** The hosted instance is one container that borrows Odyhook's Postgres and Caddy, so its folder is much smaller than `deploy/self-host/`: a compose file with one service, an `.env.example`, a backup script and a cron line. Then the runbook (`docs/hosting.md`) and one explainer. No code changes, so no unit tests: the proof is a local run on this Mac (Step 6) against a stand-in for Odyhook's Postgres, on a stand-in network, with a stand-in for rclone that writes to a folder. Nothing touches the box, GitHub or R2.

**Why one container on someone else's network (the React-dev version).** Odyhook's compose project is like an app that already has a router (Caddy) and a data layer (Postgres). Nitpilot doesn't bring its own; it registers itself with the router (a site block that points at `nitpilot-server`) and asks the data layer for its own table space (a database and a role). Joining Odyhook's Docker network is what lets both find it by name, like two components inside one provider.

**Files:**
- Create: `deploy/hosted/docker-compose.yml`, `deploy/hosted/.env.example`, `deploy/hosted/nitpilot-backup.sh` (mode 755), `deploy/hosted/cron`, `docs/hosting.md`, `docs/why/backups-and-restores.md`
- Modify: this plan (ticks), the ledger

**Interfaces:**
- Consumes: the image (`ghcr.io/nikosgkikas13/nitpilot:<version>`; `CMD` runs `prisma migrate deploy` then the server; `HEALTHCHECK` asks `/healthz` with node's `fetch`; no `curl`/`wget` inside), first-run mode (the setup code line `[first-run] Open … and enter the setup code: XXXX-XXXX`, printed again with a new code at every start), `TRUST_PROXY` (Task 2), the advisory-lock exit when Postgres goes away (Task 2), `CLOSED_CHAT_RETENTION_DAYS` (Task 2).
- Produces: what Task 12 copies to the box, and the runbook Task 12 and Task 13 follow.

---

- [x] **Step 1: The compose file**

Create `deploy/hosted/docker-compose.yml` with exactly this content:

```yaml
# The hosted instance, https://nitpilot.dev (spec §17 "Hosted instance", docs/hosting.md). It lives in /opt/nitpilot on
# the Hetzner box, next to Odyhook, and is one container: Odyhook's Postgres holds its database and Odyhook's Caddy is
# its front door. So unlike deploy/self-host/ there is no Postgres or Caddy here.
#
#   cd /opt/nitpilot
#   docker compose pull && docker compose up -d      deploy the version named in .env (NITPILOT_VERSION)
#   docker compose logs -f nitpilot-server           its log
#
# No top-level `name:`: Compose names the project after the folder, so in /opt/nitpilot it is `nitpilot`. Leaving it
# out also means a copy of this file run elsewhere (a check on a laptop) can't take over another `nitpilot` project.

services:
  nitpilot-server:
    # Never `web`, `postgres` or `redis`: those are Odyhook's names on the shared network below, and two containers
    # answering to one name there would send Caddy's requests to the wrong one.
    container_name: nitpilot-server
    image: ghcr.io/nikosgkikas13/nitpilot:${NITPILOT_VERSION:?set NITPILOT_VERSION in .env (e.g. 0.1.0-rc.3)}
    # A tiny init process in front of node, so `docker compose up -d` / `restart` (SIGTERM) reaches the server and it
    # shuts down cleanly, telling each CLI "server restarting" (docs/why/docker-images.md).
    init: true
    # Docker starts it again after a crash, a reboot, and the planned exit at the end of first-run mode
    # (docs/why/first-run-and-app-manifests.md). Only `docker compose stop` / `down` keep it down.
    restart: unless-stopped
    # Every setting, secrets included, is in /opt/nitpilot/.env on the box only (from .env.example; docs/hosting.md).
    env_file: .env
    # Caps, not reservations: the box has 4 GB and Odyhook's own caps already add up to about 4.2 GB. If the server
    # ever needs more, `docker stats` shows it first (docs/hosting.md, "Memory").
    mem_limit: 384m
    pids_limit: 256
    # Keep the log from filling the disk: three files of 10 MB, the oldest dropped first. `docker compose logs` reads them.
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
    networks:
      - hooksmith
    # No `ports:`: the server (8787) is reached only through Odyhook's Caddy, by the name nitpilot-server, on the
    # shared network. The image's own HEALTHCHECK (/healthz) applies.

networks:
  # Odyhook's network (its compose project is `hooksmith`, from /opt/hooksmith). `external` means "made by someone else,
  # just join it": this file never creates or deletes it. On it, `postgres` is Odyhook's Postgres and Caddy finds us.
  hooksmith:
    name: hooksmith_default
    external: true
```

- [x] **Step 2: The settings file**

Create `deploy/hosted/.env.example` with exactly this content:

```bash
# The hosted instance's settings: copied to /opt/nitpilot/.env on the box and filled in there (docs/hosting.md, "Set it
# up"). The real file never leaves the box except as one copy in the owner's password manager: the GitHub App's private
# key and secrets live in the database encrypted with ENCRYPTION_KEY, so a backup without this file can't bring the
# instance back. Never commit it, never paste it anywhere.

# The image to run: a release (0.1.0) or a pre-release (0.1.0-rc.3). Deploying a new version = change this line, then
# docker compose pull && docker compose up -d.
NITPILOT_VERSION=

# Fixed for nitpilot.dev.
PUBLIC_URL=https://nitpilot.dev
# The hosted instance takes public repos only (spec §18); webhooks from a private repo are dropped.
PUBLIC_REPOS_ONLY=true
# Every request comes through Odyhook's Caddy, which puts the visitor's address last in X-Forwarded-For
# (docs/why/trusting-a-proxy.md). Safe because the container publishes no port: only containers on Odyhook's network
# can reach it, and of those only Caddy talks to it.
TRUST_PROXY=true
# Chats are deleted 90 days after their PR closed (spec §17 "Closed-chat retention").
CLOSED_CHAT_RETENTION_DAYS=90
# Empty: anyone can sign in (each person sees only the repos they can read on GitHub).
ALLOWED_LOGINS=

# Made on the box, never printed (docs/hosting.md). `postgres` is Odyhook's Postgres on the shared network; the
# `nitpilot` role and database are Nitpilot's own inside it.
DATABASE_URL=
# Encrypts people's GitHub tokens and the GitHub App's secrets: openssl rand -base64 32. Never change it.
ENCRYPTION_KEY=
# Web Push (all three). The two keys are made by the image itself (docs/hosting.md).
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=https://nitpilot.dev

# No GITHUB_* here: the production app `nitpilot` is made through https://nitpilot.dev/first-run and stored in the
# database, encrypted (docs/why/first-run-and-app-manifests.md).
```

`NODE_ENV` isn't listed: the image already sets `NODE_ENV=production`.

- [x] **Step 3: The backup script and its cron line**

Create `deploy/hosted/nitpilot-backup.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# Nitpilot's nightly backup on the Hetzner box (spec §17 "Hosted instance", docs/hosting.md "Backups",
# docs/why/backups-and-restores.md). Installed as /usr/local/bin/nitpilot-backup.sh and run by /etc/cron.d/nitpilot at
# 03:30 UTC, after Odyhook's own backup at 03:00. Odyhook's script and cron file are left alone.
#
# What it does: dump the `nitpilot` database from inside Odyhook's Postgres container, check the dump is whole, gzip
# it, and upload it to the same R2 bucket as Odyhook's backups under nitpilot/, through the rclone remote already set
# up on the box. One line goes to the log either way.
#
# The defaults are the box's real names (infra/README.md in Odyhook's repo); each can be changed for a check elsewhere:
#   NITPILOT_PG_CONTAINER=other-postgres NITPILOT_BACKUP_DEST=r2:some-bucket/nitpilot nitpilot-backup.sh
set -euo pipefail

pg_container="${NITPILOT_PG_CONTAINER:-hooksmith-postgres-1}"
dest="${NITPILOT_BACKUP_DEST:-r2:odyhook-backups/nitpilot}"

# The same naming as Odyhook's backups: UTC time, with dashes so the name sorts and works in any shell.
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
name="nitpilot-$stamp.sql.gz"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) nitpilot-backup: $*"; }

# Any other step that fails (the temporary folder, gzip on a full disk, ...) still leaves a FAILED line in the log,
# saying where. The `if !` checks below don't trigger this: they write their own, clearer line.
trap 'log "FAILED: line $LINENO"' ERR

# A temporary folder only root can read, deleted however the script ends.
work="$(mktemp -d "${TMPDIR:-/tmp}/nitpilot-backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
dump="$work/nitpilot.sql"

# Inside the Postgres container a local connection needs no password. --no-owner / --no-privileges keep the dump
# loadable as any role, so a restore into a scratch database (or a new server) doesn't depend on role names.
if ! docker exec "$pg_container" pg_dump -U nitpilot -d nitpilot --no-owner --no-privileges > "$dump"; then
  log "FAILED: pg_dump from $pg_container"
  exit 1
fi

# pg_dump writes this line near the end (newer versions add a line or two after it, hence 20). If it's missing, the
# dump stopped half way and must not be uploaded as if it were good.
if ! tail -n 20 "$dump" | grep -q -- '-- PostgreSQL database dump complete'; then
  log "FAILED: the dump is incomplete"
  exit 1
fi

gzip -9 "$dump"
if ! rclone copyto "$dump.gz" "$dest/$name"; then
  log "FAILED: upload to $dest/$name"
  exit 1
fi

log "ok $dest/$name ($(wc -c < "$dump.gz" | tr -d ' ') bytes)"
```

Make it executable (git keeps the bit): `chmod 755 deploy/hosted/nitpilot-backup.sh`

Create `deploy/hosted/cron` with exactly this content (it must end with a newline: cron ignores a last line without one):

```text
# Nitpilot's nightly backup (deploy/hosted/nitpilot-backup.sh), installed on the box as /etc/cron.d/nitpilot
# (docs/hosting.md, "Backups"). cron reads /etc/cron.d/ every minute; no restart needed after a change.
# Times are the box's clock, UTC. 03:30 is after Odyhook's own backup at 03:00 (/etc/cron.d/odyhook), so the two
# dumps never run at once.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

30 3 * * * root /usr/local/bin/nitpilot-backup.sh >> /var/log/nitpilot-cron.log 2>&1
```

- [x] **Step 4: Validate**

The compose file, three ways, from a temporary folder (Compose reads `.env` from the folder it runs in):

```bash
T=$(mktemp -d) && cp deploy/hosted/docker-compose.yml deploy/hosted/.env.example "$T"/ && cd "$T" && docker compose config --quiet; echo "exit $?"; cp .env.example .env && docker compose config --quiet; echo "exit $?"; sed -i '' 's/^NITPILOT_VERSION=$/NITPILOT_VERSION=0.1.0-rc.3/' .env && docker compose config --quiet; echo "exit $?"; docker compose config | grep -E 'container_name|image:|mem_limit|pids_limit|name: hooksmith|external'; cd - >/dev/null && rm -rf "$T"
```
Expected, in order: `error while interpolating services.nitpilot-server.image: required variable NITPILOT_VERSION is missing a value: set NITPILOT_VERSION in .env (e.g. 0.1.0-rc.3)` and `exit 1` (no `.env`); the same message and `exit 1` (`.env` copied, version empty); `exit 0`; then `container_name: nitpilot-server`, `image: ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3`, `mem_limit: "402653184"` (384 MiB), `pids_limit: 256`, `name: hooksmith_default`, `external: true`.

The script, with shellcheck from its image (nothing installed):

```bash
docker run --rm -v "$PWD/deploy/hosted:/mnt:ro" koalaman/shellcheck:v0.11.0 /mnt/nitpilot-backup.sh; echo "exit $?"
```
Expected: no findings, `exit 0`.

- [x] **Step 5: The runbook and the explainer**

Create `docs/hosting.md` with exactly this content:

````markdown
# Running nitpilot.dev

The runbook for the hosted instance at **https://nitpilot.dev**. For running Nitpilot on your own server, see [self-hosting.md](self-hosting.md) instead.

## The layout

nitpilot.dev runs on the same Hetzner box as Odyhook (a CX23: 2 vCPU, 4 GB, Helsinki; `ssh root@157.180.91.106`, hostname `hooksmith`). It borrows two of Odyhook's containers and adds one of its own:

| What | Where | Whose |
|---|---|---|
| `nitpilot-server`, the one Nitpilot container (the published image) | `/opt/nitpilot` (`docker-compose.yml` from `deploy/hosted/`, and `.env`) | Nitpilot |
| Postgres: the `nitpilot` database and role | inside `hooksmith-postgres-1` | Odyhook's container, Nitpilot's database |
| Caddy: HTTPS for `nitpilot.dev`, `www` → apex | `hooksmith-caddy-1`, two site blocks in Odyhook's `Caddyfile` | Odyhook's container and repo |
| The nightly backup | `/usr/local/bin/nitpilot-backup.sh`, `/etc/cron.d/nitpilot`, log `/var/log/nitpilot-cron.log` | Nitpilot |
| Backup files | R2 bucket `odyhook-backups`, under `nitpilot/` (rclone remote `r2`) | Odyhook's bucket, Nitpilot's folder |

All three containers are on Odyhook's Docker network `hooksmith_default`, where each is reached by its name: Caddy sends `nitpilot.dev` to `nitpilot-server:8787`, and the server reaches the database at `postgres:5432`. `nitpilot-server` publishes no port, so only containers on that network can reach it, and of those only Caddy talks to it.

Odyhook's own files (`/opt/hooksmith`, its backup script, its cron file) are never edited by hand. The `nitpilot.dev` blocks in its Caddyfile are changed only by a commit to Odyhook's repo, deployed by Odyhook's workflow (see "Caddy" below).

**Settings** are in `/opt/nitpilot/.env` (mode 600; made from `deploy/hosted/.env.example`): `NITPILOT_VERSION`, `PUBLIC_URL=https://nitpilot.dev`, `PUBLIC_REPOS_ONLY=true`, `TRUST_PROXY=true`, `CLOSED_CHAT_RETENTION_DAYS=90`, `ALLOWED_LOGINS` empty, and the secrets (`DATABASE_URL`, `ENCRYPTION_KEY`, the VAPID keys). The GitHub App `nitpilot` is not in `.env`: it was made through https://nitpilot.dev/first-run and is stored in the database, encrypted with `ENCRYPTION_KEY`.

**The one copy of `.env` off the box** is in the owner's password manager. Without it a backup can't bring the instance back ([why/backups-and-restores.md](why/backups-and-restores.md)). After any change to `.env`, run `cat /opt/nitpilot/.env` in your own terminal and update that copy; never paste it into a chat, an issue or a commit.

## Everyday commands

All on the box, in `/opt/nitpilot`:

```bash
ssh root@157.180.91.106
cd /opt/nitpilot
```

| To | Run |
|---|---|
| See if it's up | `docker compose ps` (look for `(healthy)`) |
| Ask it directly | `docker exec nitpilot-server node -e "fetch('http://127.0.0.1:8787/healthz').then(async (r) => console.log(r.status, await r.text()))"` (the image has no `curl` or `wget`) |
| Read the log | `docker compose logs --tail 100 nitpilot-server`, or `-f` to follow |
| Restart it | `docker compose restart` (CLIs see "server restarting" and reconnect; jobs carry on) |
| See its memory | `docker stats --no-stream` |
| Which version runs | `grep ^NITPILOT_VERSION= .env` and `docker inspect -f '{{.Config.Image}}' nitpilot-server` |

From anywhere: `curl -s https://nitpilot.dev/healthz` prints `{"ok":true,"version":"…"}`.

## Deploying a new version

Releases come from the release workflow (a `v*` tag, [releasing.md](releasing.md)); nothing is built on the box.

```bash
cd /opt/nitpilot
sed -i 's/^NITPILOT_VERSION=.*/NITPILOT_VERSION=0.1.1/' .env
docker compose pull
docker compose up -d
docker compose ps
```

`up -d` replaces the container: the old server gets SIGTERM, finishes the step it's on and tells each CLI "server restarting"; the new one runs any new migrations, then starts. Expect `(healthy)` within a minute and the new version in `curl -s https://nitpilot.dev/healthz`.

**Going back** is the same with the old version number. The newer version's migrations stay in the database, so check its release notes first: going back is safe when they only added tables or columns.

## Memory

The box has 4 GB. Odyhook's containers have caps that add up to about 4.2 GB (caps limit, they don't reserve), and `nitpilot-server` is capped at 384 MB (`mem_limit` in `docker-compose.yml`). `docker stats --no-stream` shows what each really uses. If `nitpilot-server` sits near its cap, raise it in `docker-compose.yml` (in this repo, then copy it over) only if `free -m` shows the room; if the box itself is short, stop and ask rather than add anything.

## Backups

Every night at 03:30 UTC, after Odyhook's 03:00 backup, cron runs `nitpilot-backup.sh`: `pg_dump` of the `nitpilot` database inside Odyhook's Postgres, checked for completeness, gzipped, uploaded to `r2:odyhook-backups/nitpilot/nitpilot-<UTC time>.sql.gz`. Each run writes one line to `/var/log/nitpilot-cron.log`, `ok …` or `FAILED: …`.

| To | Run |
|---|---|
| Back up now | `/usr/local/bin/nitpilot-backup.sh` |
| See the last runs | `tail -n 5 /var/log/nitpilot-cron.log` |
| List the backups | `rclone ls r2:odyhook-backups/nitpilot \| sort -k2 \| tail` |

How long R2 keeps them is the bucket's lifecycle rule, set up for Odyhook (14 days); see that rule in Cloudflare's dashboard (R2 → `odyhook-backups` → Settings → Object lifecycle rules) for whether it covers `nitpilot/`.

Odyhook's own listings (`rclone ls r2:odyhook-backups …` in its `infra/` docs) look inside folders, so they now show these `nitpilot/…` files too. Odyhook's are the `odyhook-…` files at the top level; nothing changes on its side.

Installing them (done once, in Plan 3 Task 12): copy `deploy/hosted/nitpilot-backup.sh` to `/usr/local/bin/` (mode 755) and `deploy/hosted/cron` to `/etc/cron.d/nitpilot` (mode 644). cron reads `/etc/cron.d/` every minute.

## Restoring

### Check a backup (do this now and then)

Loads the newest backup into a scratch database next to the real one, counts rows in both, and drops the scratch one. The live database isn't touched. It first drops any scratch copy an earlier check left behind (one cut short half way), so that copy can never be counted by mistake.

```bash
f="$(rclone lsf r2:odyhook-backups/nitpilot | sort | tail -n 1)" && echo "$f"
docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -q -v ON_ERROR_STOP=1 -c 'set client_min_messages = warning' -c 'drop database if exists nitpilot_restore_check' -c 'create database nitpilot_restore_check owner nitpilot'
rclone cat "r2:odyhook-backups/nitpilot/$f" | gunzip | docker exec -i hooksmith-postgres-1 psql -q -o /dev/null -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot_restore_check
for db in nitpilot nitpilot_restore_check; do docker exec hooksmith-postgres-1 psql -U nitpilot -d "$db" -Atc 'select current_database(), (select count(*) from "_prisma_migrations"), (select count(*) from "User"), (select count(*) from "PrChat"), (select count(*) from "GithubAppConfig")'; done
docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -qc 'drop database nitpilot_restore_check'
```

The two count lines should match, except for whatever happened since the backup (new chats, new people). `GithubAppConfig` is `1` in both.

### Put a backup back (the database was lost or broken)

This replaces the live `nitpilot` database. Nitpilot is down meanwhile; Odyhook isn't touched. Not between 03:00 and 04:00 UTC, so the nightly backup can't dump a half-restored database.

First download the backup and check it's whole. Go on only if it prints `file ok`: the live database isn't touched until the next block.

```bash
cd /opt/nitpilot
f=nitpilot-2026-10-25T03-30-01Z.sql.gz     # the backup to restore, from rclone ls
rclone copyto "r2:odyhook-backups/nitpilot/$f" "/root/$f" && gunzip -c "/root/$f" | tail -n 20 | grep -q -- '-- PostgreSQL database dump complete' && echo "file ok"
```

Then replace the database with it:

```bash
docker compose stop
docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -c 'drop database nitpilot' -c 'create database nitpilot owner nitpilot'
gunzip -c "/root/$f" | docker exec -i hooksmith-postgres-1 psql -q -o /dev/null -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot && rm "/root/$f"
docker compose up -d --wait
docker compose logs --tail 20 nitpilot-server
```

`--wait` returns once the server answers its health check, so the log shows this start. The log should say `[boot] GitHub App nitpilot, from the database` and the server listening, not first-run mode. If it says first-run mode, the dump was empty or from before the app was made: stop (`docker compose stop`) and pick another file; never create a second app over it.

### On a new box

1. Set up Odyhook first (its `infra/recovery.md`), so `hooksmith-postgres-1`, its Caddy (with the `nitpilot.dev` blocks, from its repo) and the `hooksmith_default` network exist, and the rclone remote `r2` works.
2. `mkdir -p /opt/nitpilot`; copy `deploy/hosted/docker-compose.yml` there; paste `.env` from the password manager into `/opt/nitpilot/.env` (`umask 077` first, so it's mode 600).
3. Make the role and database with the password inside that `.env`'s `DATABASE_URL`: the commands in "Set it up" step 3 below.
4. Restore the newest backup with the "Put a backup back" commands, leaving out the `psql … drop database … create database` line: step 3 already made the empty database.
5. Point the DNS records at the new box's address (Porkbun), install the backup script and cron file again.

## Set it up (once)

What Plan 3 Task 12 does, here so a new box can be set up the same way. Every command runs on the box; none prints a secret.

1. `mkdir -p /opt/nitpilot` and copy `deploy/hosted/docker-compose.yml` and `deploy/hosted/.env.example` there (`scp` from a checkout).
2. Make `.env`, with fresh secrets written straight into the file. `VERSION` is the image to run. Paste the whole block: it runs in its own `bash`, which stops at the first error (and an `exit` there doesn't close your ssh session):
   ```bash
   bash -s <<'EOF'
   set -euo pipefail
   cd /opt/nitpilot && VERSION=0.1.0 && umask 077
   test ! -e .env || { echo "STOP: .env already exists"; exit 1; }
   cp .env.example .env
   set_env() { K="$1" V="$2" awk 'BEGIN { FS = OFS = "=" } $1 == ENVIRON["K"] { $0 = ENVIRON["K"] "=" ENVIRON["V"] } { print }' .env > .env.tmp && mv .env.tmp .env; }
   set_env NITPILOT_VERSION "$VERSION"
   set_env DATABASE_URL "postgresql://nitpilot:$(openssl rand -hex 24)@postgres:5432/nitpilot"
   set_env ENCRYPTION_KEY "$(openssl rand -base64 32)"
   read -r pub priv < <(docker run --rm --entrypoint node "ghcr.io/nikosgkikas13/nitpilot:$VERSION" -e "const k = require('web-push').generateVAPIDKeys(); console.log(k.publicKey, k.privateKey)")
   set_env VAPID_PUBLIC_KEY "$pub" && set_env VAPID_PRIVATE_KEY "$priv" && unset pub priv
   ls -l .env && awk -F= '!/^#/ && NF { print $1, ($2 == "" ? "(empty)" : "(set)") }' .env
   EOF
   ```
   Every name says `(set)` except `ALLOWED_LOGINS`, and `ls` shows `-rw-------`.
3. The role and database, inside Odyhook's Postgres, with the password from `.env` (passed on standard input, so it never shows up in a process list). Again one block in its own `bash`:
   ```bash
   bash -s <<'EOF'
   set -euo pipefail
   cd /opt/nitpilot
   pw="$(sed -n 's|^DATABASE_URL=postgresql://nitpilot:\([0-9a-f]*\)@postgres:5432/nitpilot$|\1|p' .env)"
   test ${#pw} -eq 48 || { echo "STOP: no password in .env's DATABASE_URL"; exit 1; }
   docker exec -i hooksmith-postgres-1 psql -U hooksmith -d postgres -v ON_ERROR_STOP=1 -q <<SQL
   CREATE ROLE nitpilot LOGIN PASSWORD '$pw';
   CREATE DATABASE nitpilot OWNER nitpilot;
   REVOKE ALL ON DATABASE nitpilot FROM PUBLIC;
   SQL
   unset pw
   EOF
   ```
4. `docker compose up -d`, then `docker compose logs nitpilot-server | grep 'setup code' | tail -n 1` for the setup code (it changes each time the server starts), and make the GitHub App at https://nitpilot.dev/first-run.
5. The backup script and cron file ("Backups" above), and save `.env` in the password manager.

## Caddy

Odyhook's Caddy answers for both sites. Its `Caddyfile` (in NikosGkikas13/odyhook) has these two blocks for Nitpilot, with a comment saying so:

```
nitpilot.dev {
    reverse_proxy nitpilot-server:8787
}

www.nitpilot.dev {
    redir https://nitpilot.dev{uri} permanent
}
```

Caddy gets and renews the `nitpilot.dev` certificate itself, redirects `http://` to `https://`, and passes WebSockets (`/ws/cli`, `/ws/web`) through. To change them: a commit to Odyhook's repo, merged to its `main`, which redeploys Odyhook. That deploy does `git pull` and `docker compose up -d --build`, which doesn't restart Caddy, and a running Caddy never rereads its file. So after the deploy, restart Caddy once (odyhook.dev and nitpilot.dev both blink for a second or two):

```bash
cd /opt/hooksmith && docker compose -f docker-compose.prod.yml restart caddy
docker exec hooksmith-caddy-1 grep -c 'nitpilot.dev' /etc/caddy/Caddyfile
```

The `grep` should count `3` (the three lines that name the domain). `0` means Caddy still has the old file: restart it again.

**DNS** (Porkbun, the `nitpilot.dev` domain): `A` for the bare domain and `A` for `www`, both `157.180.91.106`.

## After Odyhook's own deploys

Odyhook redeploys on every push to its `main`. Nitpilot needs nothing from you then, but if something looks off afterwards:

- **Odyhook's Postgres was restarted** (a new Postgres image, a box reboot): `nitpilot-server` loses its database connection, exits on purpose, and Docker starts it again; it's back within a minute. `docker compose ps` in `/opt/nitpilot` shows it `(healthy)`, and `docker inspect -f '{{.RestartCount}}' nitpilot-server` went up by one.
- **Odyhook ran `docker compose down`**: Compose says `Network hooksmith_default Resource is still in use` and leaves the network (Nitpilot is still on it); Odyhook's next `up -d` uses it again. Nothing to do.
- **nitpilot.dev answers 502**: Caddy is up but `nitpilot-server` isn't. `docker compose ps` and `docker compose logs --tail 50 nitpilot-server` in `/opt/nitpilot`.
- **nitpilot.dev doesn't answer at all, odyhook.dev neither**: Caddy is down; that's Odyhook's side (`docker compose -f docker-compose.prod.yml ps` in `/opt/hooksmith`).
````

Create `docs/why/backups-and-restores.md` with exactly this content:

```markdown
# Backups and restores (and why a backup you never restored isn't one)

**In one sentence:** a backup is a copy of the database taken every night and kept somewhere else, and it only counts once you've loaded one back and seen your data in it.

## The React comparison

Think of `git push` for your work in progress. Your laptop holds the real thing; the remote holds a copy, somewhere that doesn't die with the laptop. If the laptop is stolen you `git clone` and carry on.

A database backup is the same idea for the server's data. The server's disk holds the live database; every night a copy goes to another company's storage (Cloudflare R2), so a dead disk, a deleted server or a bad migration costs at most one day.

The difference from git: nobody runs `git clone` on a backup until the day they need it. A backup that was silently empty for three months looks exactly like a good one until then. That's why Nitpilot's setup includes **restoring one on purpose** into a scratch database and counting the rows.

## What gets copied

- **`pg_dump`** writes the whole database out as SQL: `CREATE TABLE …` for every table, then every row. Loading that file into an empty database (`psql < dump.sql`) rebuilds it exactly. It reads a consistent snapshot, so the server can keep running while it works.
- **gzip** shrinks it (SQL text compresses well).
- **rclone** uploads it. It's `cp` for cloud storage: the box already has an rclone "remote" called `r2` set up for Odyhook's backups, and Nitpilot's files go into the same bucket under `nitpilot/`.

The script checks that `pg_dump` finished (its output ends with a "dump complete" line) before it uploads, so a dump cut short by a crash is never stored as if it were good.

## What a backup can't bring back on its own

The database holds the GitHub App's private key and secrets and people's GitHub tokens, **encrypted with `ENCRYPTION_KEY`** ([first-run-and-app-manifests.md](first-run-and-app-manifests.md)). That key lives in the server's `.env`, not in the database, on purpose: someone who gets a copy of the backup gets only scrambled secrets.

So a restore needs two things: the dump **and** the `.env` it was made with. The dump is in R2; the `.env` has one copy outside the server, in the owner's password manager. Lose the key and the restored database still has every chat, but the server can't use its GitHub App and refuses to start; you'd have to make a new app.

## Where

- `deploy/hosted/nitpilot-backup.sh`: the nightly backup for nitpilot.dev (dump, check, gzip, upload, one log line).
- `deploy/hosted/cron`: runs it at 03:30 UTC, after Odyhook's own backup.
- `docs/hosting.md`, "Backups" and "Restoring": the commands, including the restore into a scratch database.
- `docs/self-hosting.md`, "Backups" and "Restoring": the same idea for a team's own server.
```

- [x] **Step 6: The local run, against stand-ins for Odyhook**

What this proves before the box: the compose file starts the image on an external network, the server finds Postgres by the name `postgres` there and runs its migrations, the `.env` and database commands that Task 12 runs on the box work as written and print no secret, a Caddy on the same network reaches `nitpilot-server:8787` by name, Odyhook's Caddyfile with the two new blocks is valid, the backup script uploads a complete dump and refuses a failed one, a restore into a scratch database matches, and the server comes back by itself when "Odyhook's" Postgres restarts. The stand-ins: a network `d4_hooksmith_default` (not the real name: this Mac already has a `hooksmith_default` from Odyhook's own local dev, which is left alone) and a Postgres container `d4-hooksmith-postgres-1` with the alias `postgres` and the superuser `hooksmith`, like the box. Everything lives in `~/Desktop/PracticeProjects/.nitpilot-scratch/` and is removed in 6k.

**6a. The image.** Build it from this checkout and give it a version tag the compose file can name (the real rc is private until Task 12):

```bash
docker build -q -t ghcr.io/nikosgkikas13/nitpilot:0.1.0-local .
```
Expected: one `sha256:` line.

**6b. The stand-ins.**

```bash
export S=~/Desktop/PracticeProjects/.nitpilot-scratch && docker network create d4_hooksmith_default && docker run -d --name d4-hooksmith-postgres-1 --network d4_hooksmith_default --network-alias postgres -e POSTGRES_USER=hooksmith -e POSTGRES_PASSWORD=hooksmith-local -e POSTGRES_DB=hooksmith postgres:16-alpine && sleep 6 && docker exec d4-hooksmith-postgres-1 pg_isready -h 127.0.0.1
```
Expected: the network id, the container id, `127.0.0.1:5432 - accepting connections`.

```bash
rm -rf "$S/hosted" && mkdir "$S/hosted" && cp deploy/hosted/docker-compose.yml deploy/hosted/.env.example "$S/hosted"/ && printf 'networks:\n  hooksmith:\n    name: d4_hooksmith_default\n    external: true\n' > "$S/hosted/docker-compose.override.yml" && ls -A "$S/hosted"
```
Expected: `.env.example  docker-compose.override.yml  docker-compose.yml`. The override only renames the network; Compose merges it automatically.

**6c. `.env`, exactly as Task 12 Step 3 makes it on the box** (only the folder and the version differ; `bash -s` as there, so `exit` and `< <( … )` behave the same in a zsh tab):

```bash
bash -s <<'EOF'
set -euo pipefail
cd "$S/hosted" && VERSION=0.1.0-local && umask 077
test ! -e .env || { echo "STOP: .env already exists"; exit 1; }
cp .env.example .env
set_env() { K="$1" V="$2" awk 'BEGIN { FS = OFS = "=" } $1 == ENVIRON["K"] { $0 = ENVIRON["K"] "=" ENVIRON["V"] } { print }' .env > .env.tmp && mv .env.tmp .env; }
set_env NITPILOT_VERSION "$VERSION"
set_env DATABASE_URL "postgresql://nitpilot:$(openssl rand -hex 24)@postgres:5432/nitpilot"
set_env ENCRYPTION_KEY "$(openssl rand -base64 32)"
read -r pub priv < <(docker run --rm --entrypoint node "ghcr.io/nikosgkikas13/nitpilot:$VERSION" -e "const k = require('web-push').generateVAPIDKeys(); console.log(k.publicKey, k.privateKey)")
set_env VAPID_PUBLIC_KEY "$pub" && set_env VAPID_PRIVATE_KEY "$priv" && unset pub priv
ls -l .env && awk -F= '!/^#/ && NF { print $1, ($2 == "" ? "(empty)" : "(set)") }' .env
EOF
```
Expected: `-rw-------` for `.env`, then `NITPILOT_VERSION (set)`, `PUBLIC_URL (set)`, `PUBLIC_REPOS_ONLY (set)`, `TRUST_PROXY (set)`, `CLOSED_CHAT_RETENTION_DAYS (set)`, `ALLOWED_LOGINS (empty)`, `DATABASE_URL (set)`, `ENCRYPTION_KEY (set)`, `VAPID_PUBLIC_KEY (set)`, `VAPID_PRIVATE_KEY (set)`, `VAPID_SUBJECT (set)`. No value is printed. The lengths, still without values:

```bash
awk '/^(ENCRYPTION_KEY|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|DATABASE_URL)=/ { i = index($0, "="); print substr($0, 1, i - 1), length(substr($0, i + 1)) }' "$S/hosted/.env"
```
Expected: `DATABASE_URL 93`, `ENCRYPTION_KEY 44`, `VAPID_PUBLIC_KEY 87`, `VAPID_PRIVATE_KEY 43`. (Why `awk` and not `sed -i`: one command works the same on this Mac and on the box's Linux, and none of the values (hex, base64, base64url) can contain the `=`-free key names it matches on.)

**6d. The role and database, exactly as Task 12 Step 4** (container name differs). The password goes in on standard input, never on a command line:

```bash
bash -s <<'EOF'
set -euo pipefail
cd "$S/hosted" && PG=d4-hooksmith-postgres-1
pw="$(sed -n 's|^DATABASE_URL=postgresql://nitpilot:\([0-9a-f]*\)@postgres:5432/nitpilot$|\1|p' .env)"
test ${#pw} -eq 48 || { echo "STOP: no password in .env's DATABASE_URL"; exit 1; }
docker exec -i "$PG" psql -U hooksmith -d postgres -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE nitpilot LOGIN PASSWORD '$pw';
CREATE DATABASE nitpilot OWNER nitpilot;
REVOKE ALL ON DATABASE nitpilot FROM PUBLIC;
SQL
unset pw
docker exec "$PG" psql -U hooksmith -d postgres -Atc "select datname, pg_get_userbyid(datdba) from pg_database where datname = 'nitpilot'"
EOF
```
Expected: `nitpilot|nitpilot`. (Whether the password itself works is proved by the next step: the server's migrations connect with it.)

**6e. Start it.**

```bash
cd "$S/hosted" && docker compose up -d && sleep 15 && docker compose ps --format '{{.Name}} {{.Status}} {{.Ports}}' && docker compose logs nitpilot-server | grep -E 'successfully applied|first-run|listening'
```
Expected: `nitpilot-server Up 15 seconds (healthy) 8787/tcp` (no host port), `All migrations have been successfully applied.`, `[first-run] Open https://nitpilot.dev/first-run and enter the setup code: XXXX-XXXX` and `Nitpilot server listening on http://localhost:8787, in first-run mode`.

```bash
docker exec nitpilot-server node -e "fetch('http://127.0.0.1:8787/healthz').then(async (r) => console.log(r.status, await r.text()))" && docker inspect -f '{{.State.Health.Status}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}} {{.HostConfig.Init}} {{.HostConfig.RestartPolicy.Name}}' nitpilot-server && docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.PIDs}}' nitpilot-server
```
Expected: `200 {"ok":true,"version":"0.1.0"}`, `healthy 402653184 256 true unless-stopped`, and the memory line (the builder saw `170.5MiB / 384MiB`, 24 PIDs, idle in first-run mode).

**6f. Caddy reaches it by name, and Odyhook's Caddyfile stays valid.** A throwaway Caddy on the stand-in network, plain HTTP on a local port:

```bash
N=$(mktemp -d) && printf ':8080 {\n    reverse_proxy nitpilot-server:8787\n}\n' > "$N/Caddyfile" && docker run -d --rm --name d4-caddy --network d4_hooksmith_default -p 127.0.0.1:18080:8080 -v "$N/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine && sleep 3 && curl -s http://127.0.0.1:18080/healthz; echo; curl -s -w ' %{http_code}\n' http://127.0.0.1:18080/api/me; docker stop d4-caddy
```
Expected: `{"ok":true,"version":"0.1.0"}` and `{"error":{"code":"first_run","message":"Finish setup at /first-run."}} 503`.

Then Odyhook's current Caddyfile with Task 12 Step 8's two blocks appended (`$N/Caddyfile.odyhook`; the blocks are the ones in Task 12 Step 8, copied by hand into the file), checked by Caddy itself, which needs no DNS or certificate for this:

```bash
cp ~/Desktop/PracticeProjects/hooksmith/Caddyfile "$N/Caddyfile.odyhook" && cat >> "$N/Caddyfile.odyhook" <<'EOF'

# Nitpilot (github.com/NikosGkikas13/nitpilot) shares this box: its own container, nitpilot-server, joins this
# project's network from /opt/nitpilot. These two blocks are Nitpilot's; see docs/hosting.md in that repo.
nitpilot.dev {
    reverse_proxy nitpilot-server:8787
}

www.nitpilot.dev {
    redir https://nitpilot.dev{uri} permanent
}
EOF
docker run --rm -v "$N/Caddyfile.odyhook:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | grep -E 'Valid|Error'; grep -c 'nitpilot.dev' "$N/Caddyfile.odyhook"; rm -rf "$N"
```
Expected: `Valid configuration` and `3` (the count `docs/hosting.md` tells you to expect inside Caddy's container after the deploy).

**6g. The backup script, with a stand-in for rclone.** The stand-in is a two-line `rclone` that runs rclone's own image with the remote `r2` set to a local folder, so the script's real `rclone copyto` runs:

```bash
mkdir -p "$S/d4-bin" "$S/d4-r2" "$S/d4-tmp" && printf '#!/bin/sh\nexec docker run --rm -i -v "%s:%s" -w "%s/d4-r2" -e RCLONE_CONFIG_R2_TYPE=local rclone/rclone:1.71.2 "$@"\n' "$S" "$S" "$S" > "$S/d4-bin/rclone" && chmod +x "$S/d4-bin/rclone"
```
```bash
PATH="$S/d4-bin:$PATH" TMPDIR="$S/d4-tmp" NITPILOT_PG_CONTAINER=d4-hooksmith-postgres-1 bash deploy/hosted/nitpilot-backup.sh 2>&1 | grep -v NOTICE; PATH="$S/d4-bin:$PATH" rclone ls r2:odyhook-backups/nitpilot 2>/dev/null; ls -A "$S/d4-tmp"; echo "(tmp listed)"
```
Expected: `<time> nitpilot-backup: ok r2:odyhook-backups/nitpilot/nitpilot-<UTC time>.sql.gz (<about 5400> bytes)`, the same file in the listing, and nothing in the temporary folder (the `trap` removed it). The rclone image's `Config file … not found - using defaults` notices are expected and filtered.

The failure path:

```bash
PATH="$S/d4-bin:$PATH" TMPDIR="$S/d4-tmp" NITPILOT_PG_CONTAINER=no-such-container bash deploy/hosted/nitpilot-backup.sh; echo "exit $?"; ls -A "$S/d4-tmp"; PATH="$S/d4-bin:$PATH" rclone lsf r2:odyhook-backups/nitpilot 2>/dev/null
```
Expected: Docker's `No such container: no-such-container`, `nitpilot-backup: FAILED: pg_dump from no-such-container`, `exit 1`, an empty temporary folder, and still only the one file (nothing uploaded).

A failure no `if !` check covers (here the temporary folder can't be made) still writes a `FAILED` line, from the `ERR` trap:

```bash
TMPDIR="$S/no-such-folder" NITPILOT_PG_CONTAINER=d4-hooksmith-postgres-1 bash deploy/hosted/nitpilot-backup.sh; echo "exit $?"
```
Expected: `mktemp`'s own error, `nitpilot-backup: FAILED: line 28`, `exit 1`.

**6h. The restore checks from `docs/hosting.md`, verbatim.** Written in Step 5; here with the stand-in names (`sed` swaps the container name; the stand-in `rclone` is on `PATH`):

```bash
sed -n '/^### Check a backup/,/^The two count lines/p' docs/hosting.md | sed -n '/^```bash$/,/^```$/p' | grep -v '^```' | sed 's/hooksmith-postgres-1/d4-hooksmith-postgres-1/g' > "$S/check-backup.sh" && PATH="$S/d4-bin:$PATH" bash "$S/check-backup.sh" 2>&1 | grep -v NOTICE
```
Expected: the file name, then `nitpilot|13|0|0|0` and `nitpilot_restore_check|13|0|0|0` (13 migrations, no people, chats or app yet in first-run mode), and the scratch database gone afterwards (`docker exec d4-hooksmith-postgres-1 psql -U hooksmith -d postgres -Atc "select count(*) from pg_database where datname = 'nitpilot_restore_check'"` prints `0`).

Then "Put a backup back", also verbatim from `docs/hosting.md` (both blocks; `sed` swaps the container name, `/root/` for the scratch folder, the folder, and puts in the file name from the listing):

```bash
f=<the file name> && sed -n '/^### Put a backup back/,/^The log should say/p' docs/hosting.md | sed -n '/^```bash$/,/^```$/p' | grep -v '^```' | sed -e 's/hooksmith-postgres-1/d4-hooksmith-postgres-1/g' -e "s|/root/|$S/|g" -e "s|^cd /opt/nitpilot|cd \"$S/hosted\"|" -e "s|^f=.*|f=$f|" > "$S/put-back.sh" && PATH="$S/d4-bin:$PATH" bash "$S/put-back.sh" 2>&1 | grep -E 'file ok|DATABASE|No pending|first-run|listening|ERROR'; ls "$S"/nitpilot-*.sql.gz 2>/dev/null | wc -l; docker compose -f "$S/hosted/docker-compose.yml" -f "$S/hosted/docker-compose.override.yml" ps --format '{{.Name}} {{.Status}}'
```
Expected: `file ok`, `DROP DATABASE`, `CREATE DATABASE`, `No pending migrations to apply.`, the first-run line (no app was ever made here), the listening line, `0` (the downloaded file was removed after the load) and `(healthy)`. On the box, the log ends in `[boot] GitHub App nitpilot, from the database`.

**6i. "Odyhook's" Postgres restarts under the running server** (Review Focus 5, and `docs/hosting.md` "After Odyhook's own deploys"):

```bash
docker inspect -f '{{.RestartCount}}' nitpilot-server && docker restart d4-hooksmith-postgres-1 && sleep 25 && docker inspect -f '{{.RestartCount}} {{.State.Health.Status}}' nitpilot-server && docker compose -f "$S/hosted/docker-compose.yml" -f "$S/hosted/docker-compose.override.yml" logs --since 40s nitpilot-server | grep -E 'No pending|first-run|listening'
```
Expected: `0`, then `1 healthy` (the server exited when its lock connection died and Docker started it again), `No pending migrations to apply.`, a **new** setup code (it changes at every start: Task 12 reads the newest line), and the listening line.

**6j. Odyhook's `docker compose down` while Nitpilot is on its network** (also for "After Odyhook's own deploys"). A tiny stand-in project:

```bash
T=$(mktemp -d)/d4ody && mkdir -p "$T" && cd "$T" && printf 'services:\n  web:\n    image: caddy:2-alpine\n' > docker-compose.yml && docker compose up -d && docker run -d --rm --name d4-attached --network d4ody_default caddy:2-alpine && docker compose down; echo "down exit $?"; docker network ls --filter name=d4ody --format '{{.Name}}'; docker compose up -d && docker network inspect d4ody_default -f '{{range .Containers}}{{.Name}} {{end}}'; docker stop d4-attached; docker compose down; cd - >/dev/null
```
Expected: `Network d4ody_default  Resource is still in use`, `down exit 0`, the network still listed, and after `up -d` both `d4ody-web-1` and `d4-attached` on it. So an Odyhook `down`/`up` leaves Nitpilot connected.

**6k. Clean up.**

```bash
cd "$S/hosted" && docker compose down && docker rm -f d4-hooksmith-postgres-1 && docker network rm d4_hooksmith_default && docker rmi ghcr.io/nikosgkikas13/nitpilot:0.1.0-local && rm -rf "$S/hosted" "$S/d4-bin" "$S/d4-r2" "$S/d4-tmp" "$S/check-backup.sh" && docker ps -a --format '{{.Names}}' | grep -c d4
```
Expected: `Container nitpilot-server  Removed`, the removals, and `0`. This Mac's own `hooksmith_default` network was never used.

- [x] **Step 7: Secret scan of the new files, tick, ledger, commit**

The Task 10 scan over the new files, copied to a throwaway folder with the config (so no other file of the checkout, such as `apps/server/.env`, is read):

```bash
R=$(mktemp -d) && mkdir -p "$R/src/docs/why" && cp -R deploy .gitleaks.toml "$R/src/" && cp docs/hosting.md "$R/src/docs/" && cp docs/why/backups-and-restores.md "$R/src/docs/why/" && docker run --rm -v "$R/src:/repo:ro" zricethezav/gitleaks:v8.30.1 dir /repo --config /repo/.gitleaks.toml --redact --no-banner --no-color; echo "exit=$?"; rm -rf "$R"
```
Expected: `no leaks found`, `exit=0`.

Tick Steps 1 to 7, add the ledger line `Task 11: complete`, and commit:

```bash
git add deploy/hosted docs/hosting.md docs/why/backups-and-restores.md docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
```
```bash
git commit -m "feat(deploy): the hosted instance's compose, backups and runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Then `git ls-files -s deploy/hosted/nitpilot-backup.sh` starts with `100755`.

### Task 12: Going live (ops, every step said first)

**What this task is.** nitpilot.dev goes live, in an order where each step can be checked before the next depends on it: the repo and image public (so the box pulls without a token), a read-only look at the box, the folder and `.env`, the database, the container in first-run mode, the `.env` copy, DNS, Odyhook's Caddyfile (so `https://nitpilot.dev` answers with a certificate), the production app through the first-run page, and backups. **No step here runs without the user's go**: each one is said first (what it changes, where), or is a click-step for the user (named account, every click). Commands that could print a secret are the user's, in their own terminal; the ones I run print names and `(set)`, never values.

**Odyhook while this runs.** Only Step 8 touches it: one commit to its Caddyfile, deployed by its own workflow, then one Caddy restart (odyhook.dev blinks for a second or two). Step 2 records what's running, and Step 8 checks odyhook.dev answers afterwards.

**Files:** none planned. If the run shows a doc or compose-file problem, it's fixed in Step 11 (`docs(hosting): …`). A code problem: stop and ask (it needs a test first, and a new `rc`).

---

- [x] **Step 1: (user, say first: GitHub and GHCR become public) The secret scan on the final history, then the repo and the image go public**

First the Task 10 scan, again, on everything committed by now (Checked D3 item 61), the same commands as Task 10 Step 2. From the repo folder:

```bash
T=$(mktemp -d) && mkdir "$T/out" && git clone -q --mirror --no-local "$PWD" "$T/mirror" && cp .gitleaks.toml "$T/gitleaks.toml"
docker run --rm -v "$T/mirror:/repo:ro" -v "$T/gitleaks.toml:/config/.gitleaks.toml:ro" -v "$T/out:/out" zricethezav/gitleaks:v8.30.1 \
  git /repo --config /config/.gitleaks.toml --redact --no-banner --no-color --report-format json --report-path /out/history.json
echo "exit=$?"; rm -rf "$T"
```
Expected: `<n> commits scanned.`, `no leaks found`, `exit=0`. Anything else is a STOP: I report the file, commit and rule only (never the value) and nothing goes public.

Then the user, in the browser signed in to GitHub as **NikosGkikas13**:

1. **The repo.** Open https://github.com/NikosGkikas13/nitpilot. Click **Settings** (the gear tab at the right end of the row under the repo name; it's there because you own the repo). You're on **General**. Scroll all the way down to the red box **Danger Zone**. In its first row, **Change repository visibility**, click **Change visibility**, then **Change to public**. GitHub shows a few warnings, each with a button; click through them (**I want to make this repository public**, **I have read and understand these effects**), then type `NikosGkikas13/nitpilot` in the box it shows and click **Make this repository public**. GitHub may ask for your password, a passkey or a 2FA code first. Back on the page, the repo name at the top now has a **Public** label.
2. **The image.** Open https://github.com/NikosGkikas13/nitpilot/pkgs/container/nitpilot (or: the repo's main page → right-hand column → **Packages** → `nitpilot`). You see `ghcr.io/nikosgkikas13/nitpilot` with the tags `0.1.0-rc.1`, `0.1.0-rc.2`, `0.1.0-rc.3` and a **Private** label. Click **Package settings** (right-hand column, near the bottom). Scroll down to the red **Danger Zone**, click **Change visibility**, choose **Public**, type `nitpilot` where it asks, and click **I understand the consequences, change package visibility**. The package page now says **Public**.

I check, without any login (`docker logout` first, so nothing of the user's is used):

```bash
docker logout ghcr.io; docker pull ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3 2>&1 | tail -2; curl -s -o /dev/null -w '%{http_code}\n' https://github.com/NikosGkikas13/nitpilot
```
Expected: `Status: Downloaded newer image …` (or `Image is up to date …`) and `200`.

**Which version goes live:** `0.1.0-rc.3` unless the image's inputs changed since that tag. Check:

```bash
git diff --stat v0.1.0-rc.3 HEAD -- Dockerfile .dockerignore apps packages package.json package-lock.json | tail -n 1
```
Expected: nothing (Tasks 10a, 11 and 13 touch none of those). If it lists files, the user pushes the branch and the next tag (`v0.1.0-rc.4`, the commands as in Task 10a Step 4) first, and every `0.1.0-rc.3` below becomes that one.

- [x] **Step 2: (say first: reads the box, changes nothing) What's on the box**

One ssh session, read-only (no command prints a secret: the backup script and cron file hold commands and names, the rclone listing only remote names):

```bash
ssh root@157.180.91.106 'bash -s' <<'EOF'
hostname; uptime
echo "== containers"; docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}'
echo "== memory"; docker stats --no-stream --format '{{.Name}}  {{.MemUsage}}  {{.MemPerc}}'; free -m
echo "== disk"; df -h / | tail -n 1
echo "== network"; docker network inspect hooksmith_default -f '{{.Name}} {{len .Containers}} containers'
echo "== nitpilot names free?"; docker ps -a --format '{{.Names}}' | grep -c '^nitpilot' ; ls -d /opt/nitpilot 2>&1 | tail -n 1
echo "== postgres"; docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -Atc "select current_user, (select rolsuper from pg_roles where rolname = current_user), version()"; docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -Atc "select rolname from pg_roles where rolname = 'nitpilot' union all select datname from pg_database where datname = 'nitpilot'"
echo "== rclone"; command -v rclone; rclone version | head -n 1; rclone listremotes; rclone lsf r2:odyhook-backups | sort | tail -n 2
echo "== odyhook backup"; grep -nE 'rclone|pg_dump|docker' /usr/local/bin/odyhook-backup.sh; cat /etc/cron.d/odyhook
echo "== odyhook checkout"; cd /opt/hooksmith && git status --short | head -n 5 && git log -1 --oneline && git rev-parse --abbrev-ref HEAD
echo "== clock"; date -u; timedatectl 2>/dev/null | grep -i 'time zone'
EOF
```
Expected, and what to do when it differs:
- Containers `hooksmith-postgres-1`, `hooksmith-redis-1`, `hooksmith-web-1`, `hooksmith-worker-1`, `hooksmith-caddy-1`, all `Up`. Other names: stop and ask (the names in this milestone come from Odyhook's docs).
- **Memory:** I write every container's real use and `free -m`'s `available` in the task report. Rule from the spec: if `available` is under about 600 MB (the 384 MB cap plus room for the box), stop and ask; don't add swap or anything else.
- `hooksmith_default 5 containers`; `0` containers named `nitpilot…`; `/opt/nitpilot` doesn't exist (`No such file or directory`).
- Postgres: `hooksmith|t|PostgreSQL 16.…`, and no `nitpilot` role or database yet (no lines). If `rolsuper` is `f`, stop and ask.
- rclone: a path, `rclone v1.7x`, `r2:` among the remotes, and Odyhook's two newest `odyhook-…sql.gz` files. If the remote isn't `r2` or the bucket isn't `odyhook-backups`, the script's defaults are wrong: stop; the fix is a one-line change of `NITPILOT_BACKUP_DEST`'s default in `deploy/hosted/nitpilot-backup.sh` (commit, then copy).
- Odyhook's script pipes `pg_dump` into `rclone rcat r2:odyhook-backups/…`, and `/etc/cron.d/odyhook` has `0 3 * * * root /usr/local/bin/odyhook-backup.sh …`. If its backup runs at another time, move Nitpilot's line in `deploy/hosted/cron` to 30 minutes after it.
- `/opt/hooksmith`: no changes (empty `git status`), on `main`, at the same commit as `git -C ~/Desktop/PracticeProjects/hooksmith log -1 --oneline origin/main` on this Mac. A dirty checkout would make Odyhook's deploy fail in Step 8: stop and ask.
- The clock in UTC (`Time zone: Etc/UTC` or `UTC`), so 03:30 in the cron file is 03:30 UTC.

- [x] **Step 3: (say first: creates /opt/nitpilot on the box and writes its .env) The folder and `.env`**

```bash
ssh root@157.180.91.106 'mkdir -p /opt/nitpilot && chmod 700 /opt/nitpilot' && scp deploy/hosted/docker-compose.yml deploy/hosted/.env.example root@157.180.91.106:/opt/nitpilot/ && ssh root@157.180.91.106 'ls -la /opt/nitpilot && docker pull -q ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3'
```
Expected: the two files, and the image's `ghcr.io/…:0.1.0-rc.3` line (pulled anonymously: the package is public since Step 1).

Then `.env`, with every secret made on the box and written straight into the file (the same commands as Task 11 Step 6c and `docs/hosting.md` "Set it up"):

```bash
ssh root@157.180.91.106 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/nitpilot && VERSION=0.1.0-rc.3 && umask 077
test ! -e .env || { echo "STOP: .env already exists"; exit 1; }
cp .env.example .env
set_env() { K="$1" V="$2" awk 'BEGIN { FS = OFS = "=" } $1 == ENVIRON["K"] { $0 = ENVIRON["K"] "=" ENVIRON["V"] } { print }' .env > .env.tmp && mv .env.tmp .env; }
set_env NITPILOT_VERSION "$VERSION"
set_env DATABASE_URL "postgresql://nitpilot:$(openssl rand -hex 24)@postgres:5432/nitpilot"
set_env ENCRYPTION_KEY "$(openssl rand -base64 32)"
read -r pub priv < <(docker run --rm --entrypoint node "ghcr.io/nikosgkikas13/nitpilot:$VERSION" -e "const k = require('web-push').generateVAPIDKeys(); console.log(k.publicKey, k.privateKey)")
set_env VAPID_PUBLIC_KEY "$pub" && set_env VAPID_PRIVATE_KEY "$priv" && unset pub priv
ls -l .env && awk -F= '!/^#/ && NF { print $1, ($2 == "" ? "(empty)" : "(set)") }' .env
awk '/^(ENCRYPTION_KEY|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|DATABASE_URL)=/ { i = index($0, "="); print substr($0, 1, i - 1), length(substr($0, i + 1)) }' .env
EOF
```
Expected: as in Task 11 Step 6c: `-rw------- 1 root root … .env`, every name `(set)` except `ALLOWED_LOGINS (empty)`, and the lengths `DATABASE_URL 93`, `ENCRYPTION_KEY 44`, `VAPID_PUBLIC_KEY 87`, `VAPID_PRIVATE_KEY 43`. `VAPID_SUBJECT` is `https://nitpilot.dev` from the example (not a secret). The VAPID one-liner uses `--entrypoint node` because the image has no `vapid:keys` npm script (Checked D3 item 35).

- [x] **Step 4: (say first: creates a role and a database inside Odyhook's Postgres) The database**

```bash
ssh root@157.180.91.106 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/nitpilot
pw="$(sed -n 's|^DATABASE_URL=postgresql://nitpilot:\([0-9a-f]*\)@postgres:5432/nitpilot$|\1|p' .env)"
test ${#pw} -eq 48 || { echo "STOP: no password in .env's DATABASE_URL"; exit 1; }
docker exec -i hooksmith-postgres-1 psql -U hooksmith -d postgres -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE nitpilot LOGIN PASSWORD '$pw';
CREATE DATABASE nitpilot OWNER nitpilot;
REVOKE ALL ON DATABASE nitpilot FROM PUBLIC;
SQL
unset pw
docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -Atc "select datname, pg_get_userbyid(datdba) from pg_database where datname = 'nitpilot'"
EOF
```
Expected: `nitpilot|nitpilot`. The `nitpilot` role owns only its own database: it has no rights on Odyhook's tables (Postgres gives a new role none), and `REVOKE ALL … FROM PUBLIC` keeps other roles out of Nitpilot's (Odyhook's `hooksmith` is a superuser and is not affected; nothing of Odyhook's changes).

- [x] **Step 5: (say first: starts nitpilot-server on the box) Start it**

```bash
ssh root@157.180.91.106 'bash -s' <<'EOF'
cd /opt/nitpilot && docker compose up -d && sleep 20
docker compose ps --format '{{.Name}} {{.Status}} {{.Ports}}'
docker compose logs nitpilot-server | grep -E 'successfully applied|first-run mode'
docker exec nitpilot-server node -e "fetch('http://127.0.0.1:8787/healthz').then(async (r) => console.log(r.status, await r.text()))"
docker inspect -f '{{.State.Health.Status}} {{.HostConfig.Memory}}' nitpilot-server
docker stats --no-stream --format '{{.Name}}  {{.MemUsage}}'
docker exec hooksmith-caddy-1 wget -qO- http://nitpilot-server:8787/healthz; echo
EOF
```
Expected: `nitpilot-server Up 20 seconds (healthy) 8787/tcp`, `All migrations have been successfully applied.`, `Nitpilot server listening on http://localhost:8787, in first-run mode` (the setup-code line is left out here on purpose: Step 9's user reads it), `200 {"ok":true,"version":"0.1.0"}`, `healthy 402653184`, everyone's memory (nitpilot-server about 170 MiB), and `{"ok":true,"version":"0.1.0"}` once more, asked from inside Odyhook's Caddy container by name (Caddy's image is Alpine, which has `wget`; Nitpilot's doesn't). Nothing outside can reach it yet: Caddy has no `nitpilot.dev` block.

- [x] **Step 6: (user) The `.env` copy in the password manager**

In the user's own terminal (not one of mine, and not the `!` prompt in the Claude chat, which sends the output into the chat; the output is the secrets):

```bash
ssh root@157.180.91.106 cat /opt/nitpilot/.env
```
Select everything it printed, from `# The hosted instance's settings` to the last line, and save it in your password manager as a secure note named **nitpilot.dev /opt/nitpilot/.env**, with the date. Then clear the terminal (⌘K). That note is what `docs/hosting.md` "On a new box" starts from: without it a backup can't bring the instance back. Tell me "saved"; I don't check it.

- [x] **Step 7: (user) DNS at Porkbun**

nitpilot.dev's nameservers are Porkbun's (`dig +short NS nitpilot.dev`), so the records go there. In the browser, signed in to **porkbun.com** with the account that bought nitpilot.dev:

1. Click **Account** (top right) → **Domain Management**. In the list of domains, find **nitpilot.dev**, and in its row click **DNS** (under the domain name, among the small links; on a narrow window it's behind **Details**). The **DNS Records** page opens with a form at the top (**Type**, **Host**, **Answer**, **TTL**) and the current records below it.
2. Below the form, look at the existing records. Porkbun adds parking records to a new domain: on nitpilot.dev they were `ALIAS  nitpilot.dev  pixie.porkbun.com` and `CNAME  *.nitpilot.dev  pixie.porkbun.com` (both TTL 600). Delete each of those: the trash-can icon at the right end of its row, then **Yes** in the confirmation. Leave any `NS`, `MX` or `TXT` record alone.
3. In the form at the top: **Type** `A - Address record`, **Host** empty (the bare domain), **Answer** `157.180.91.106`, **TTL** `600` (the smallest Porkbun offers; fine). Click **Add**. The new record shows in the list as `A  nitpilot.dev  157.180.91.106`.
4. Again: **Type** `A - Address record`, **Host** `www`, **Answer** `157.180.91.106`, **TTL** `600`, **Add**. It shows as `A  www.nitpilot.dev  157.180.91.106`.

I check from this Mac, a few times a minute until both answer (usually within 5 minutes):

```bash
dig +short nitpilot.dev A; dig +short www.nitpilot.dev A; dig +short @1.1.1.1 nitpilot.dev A
```
Expected: `157.180.91.106` three times. Then `curl -sI --max-time 5 https://nitpilot.dev | head -n 1` fails with a TLS error: right, Caddy doesn't know the name yet (Step 8). DNS goes first so Caddy can get its certificate the moment it loads the block.

- [x] **Step 8: (say first: one commit in Odyhook's repo; the user reviews and merges it, which redeploys Odyhook) Caddy**

The user's Odyhook checkout (`~/Desktop/PracticeProjects/hooksmith`) is on `main` with uncommitted work of theirs (`.gitignore`, `ARCHITECTURE.md` on 2026-10-25), which must not move. So the branch is made in a separate worktree, from `origin/main`:

```bash
cd ~/Desktop/PracticeProjects/hooksmith && git fetch origin && git worktree add -b nitpilot-dev-site ../.hooksmith-nitpilot-site origin/main && cd ../.hooksmith-nitpilot-site && git log -1 --oneline
```
Expected: `Preparing worktree (new branch 'nitpilot-dev-site')` and Odyhook's latest commit (the same one Step 2 saw on the box).

Append the two blocks to its `Caddyfile` (Odyhook's style: 4-space indents, a comment above):

```bash
cat >> Caddyfile <<'EOF'

# Nitpilot (github.com/NikosGkikas13/nitpilot) shares this box: its own container, nitpilot-server, joins this
# project's network from /opt/nitpilot. These two blocks are Nitpilot's; see docs/hosting.md in that repo.
nitpilot.dev {
    reverse_proxy nitpilot-server:8787
}

www.nitpilot.dev {
    redir https://nitpilot.dev{uri} permanent
}
EOF
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | grep -E 'Valid|Error'; git diff --stat
```
Expected: `Valid configuration` and `Caddyfile | 10 ++++++++++`. Commit (only the Caddyfile):

```bash
git add Caddyfile && git commit -m "feat(caddy): serve nitpilot.dev from the nitpilot-server container

Nitpilot (github.com/NikosGkikas13/nitpilot) runs one container on this box,
on the hooksmith_default network, from /opt/nitpilot. www redirects to the apex.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git show --stat HEAD | tail -n 2
```

Then the user (in their own terminal, then the browser signed in as **NikosGkikas13**):

1. Push the branch: `git -C ~/Desktop/PracticeProjects/.hooksmith-nitpilot-site push -u origin nitpilot-dev-site`. Git prints a link `https://github.com/NikosGkikas13/odyhook/pull/new/nitpilot-dev-site`; open it.
2. GitHub's **Open a pull request** page, `nitpilot-dev-site` into `main`. Title `Serve nitpilot.dev from the nitpilot-server container`. Click **Create pull request**.
3. On the PR, click **Files changed**: one file, `Caddyfile`, ten added lines (the comment and the two blocks). Back on **Conversation**, wait for the check **CI & Deploy / tsc + vitest + build** to turn green (a few minutes; on a PR it only tests, it doesn't deploy).
4. Click **Merge pull request**, then **Confirm merge**. Then **Delete branch**.
5. Open https://github.com/NikosGkikas13/odyhook/actions: a new **CI & Deploy** run on `main` starts. Wait until both its jobs (**tsc + vitest + build**, then **Deploy to production**) are green, about 5 minutes. Tell me when.

**In the run (2026-10-25)** the deploy's `next build` on the box used up its memory with `nitpilot-server` running (no swap): the box stopped answering (odyhook.dev down about 25 minutes), GitHub cancelled the deploy at its 15-minute limit, and the user power-cycled the box in the Hetzner console. `git pull` had already run, so every container came back on the merge commit with Odyhook's old image (right: the merge only changed the Caddyfile), and Caddy, started fresh, read the new file: the restart below wasn't needed. `docs/hosting.md` "Memory" now says what to do before an Odyhook deploy until Odyhook builds elsewhere.

Then Caddy. Odyhook's deploy runs `git pull` and `docker compose up -d --build` in `/opt/hooksmith`, which rebuilds Odyhook's app but leaves the Caddy container running with the file it read at start (a file mounted into a container keeps pointing at the old file after `git pull` replaces it, and Caddy doesn't watch it anyway). **(say first: restarts Odyhook's Caddy; odyhook.dev is unreachable for a second or two)**:

```bash
ssh root@157.180.91.106 'bash -s' <<'EOF'
cd /opt/hooksmith && git log -1 --oneline && grep -c 'nitpilot.dev' Caddyfile
docker compose -f docker-compose.prod.yml restart caddy
sleep 10
docker exec hooksmith-caddy-1 grep -c 'nitpilot.dev' /etc/caddy/Caddyfile
docker logs --since 1m hooksmith-caddy-1 2>&1 | grep -E 'nitpilot.dev' | grep -oE '"msg":"[^"]*"' | sort | uniq -c
EOF
```
Expected: the merge commit, `3`, `Container hooksmith-caddy-1  Restarting` / `Started`, `3` inside the container, and Caddy's log naming `nitpilot.dev` with `certificate obtained successfully` (and `www.nitpilot.dev` too). If the certificate lines say `error` or `challenge failed`, DNS isn't right yet (Step 7): Caddy retries on its own; check `dig` again and wait.

From this Mac:

```bash
curl -sI http://nitpilot.dev | grep -iE '^(HTTP|location)'; curl -sI https://www.nitpilot.dev | grep -iE '^(HTTP|location)'; curl -s https://nitpilot.dev/healthz; echo; curl -s -w ' %{http_code}\n' https://nitpilot.dev/api/me; echo | openssl s_client -connect nitpilot.dev:443 -servername nitpilot.dev 2>/dev/null | openssl x509 -noout -subject -issuer -enddate; curl -s -o /dev/null -w 'odyhook %{http_code}\n' https://odyhook.dev
```
Expected: `HTTP/1.1 308 Permanent Redirect` + `Location: https://nitpilot.dev/`; `HTTP/2 301` + `location: https://nitpilot.dev/`; `{"ok":true,"version":"0.1.0"}`; the `first_run` 503 body; `subject=CN=nitpilot.dev`, an `issuer` of Let's Encrypt, an end date about 90 days out; `odyhook 200`.

Last, the worktree (the user's checkout is untouched): `cd ~/Desktop/PracticeProjects/hooksmith && git worktree remove ../.hooksmith-nitpilot-site && git branch -D nitpilot-dev-site && git status --short` shows only the user's own two changed files.

- [x] **Step 9: (user) The production app, through nitpilot.dev's own first-run page**

The setup code, in the user's own terminal (it guards the empty server until the app exists, so it isn't shown in chat):

```bash
ssh root@157.180.91.106 'docker logs nitpilot-server 2>&1 | grep "setup code" | tail -n 1'
```
It prints `[first-run] Open https://nitpilot.dev/first-run and enter the setup code: XXXX-XXXX`. The code changes whenever the server restarts, so use the newest line, and do the clicks below right away.

In the browser signed in to GitHub as **NikosGkikas13**:

1. Open https://nitpilot.dev/first-run. The Nitpilot wordmark is at the top left and a card titled **Set up Nitpilot** (small label **First run** above it) has: a **Setup code** box; **Create the app on** with **Your personal account** (chosen) and **An organization**; **App name**, filled with `Nitpilot (nitpilot.dev)`; **Who can install it** with **Only this account or organization** (chosen) and **Anyone on GitHub**; and a **Create GitHub App** button.
2. Type the setup code into **Setup code**. Leave **Your personal account**. Click into **App name**, select all (⌘A) and type `nitpilot`. Under **Who can install it**, click **Anyone on GitHub** (the hosted instance is for everyone's public repos). Click **Create GitHub App**.
3. The button says **Opening GitHub…** and the browser goes to `github.com/settings/apps/new?state=…`: GitHub's **Register new GitHub App** page. Check the name at the top is `nitpilot` and **Any account** is chosen before going on (in the run the name was left at the default and GitHub made `nitpilot-nitpilot-dev`, private; it was deleted and made again, `docs/hosting.md` "Set it up" step 4). The page has the name `nitpilot`, the homepage `https://nitpilot.dev`, the webhook URL `https://nitpilot.dev/webhooks/github`, the callback URL and the permissions filled in, and **Any account** chosen under *Where can this GitHub App be installed?*. Change nothing. If GitHub asks for your password, a passkey or a code first, do that.
4. At the bottom, click the green **Create GitHub App for NikosGkikas13**. If GitHub says the name is taken, stop and tell me (the spec checked it was free on 2026-10-24; picking another name changes the bot's name everywhere). GitHub sends the browser back to `https://nitpilot.dev/first-run/callback?…`, then `https://nitpilot.dev/first-run?done=1`.
5. A card with a spinner, **Restarting the server…**, then (a few seconds) **Your GitHub App is ready** with a green tick and two buttons, **Install the app on your repos** and **Sign in**.
6. Click **Install the app on your repos**. GitHub's **Install nitpilot** page: under your account choose **Only select repositories**, open **Select repositories**, pick **nitpilot-sandbox** only, and click **Install**.
7. GitHub goes to `https://nitpilot.dev/github/setup?installation_id=…`, which sends you on to **Authorize nitpilot**: click **Authorize NikosGkikas13**. You land on `https://nitpilot.dev/setup` with **Install the GitHub App** ticked.

I check (read-only):

```bash
ssh root@157.180.91.106 'bash -s' <<'EOF'
cd /opt/nitpilot && docker compose logs nitpilot-server | grep -E '\[boot\] GitHub App|listening' | tail -n 2
docker exec hooksmith-postgres-1 psql -U nitpilot -d nitpilot -c 'select slug, "ownerLogin" from "GithubAppConfig"' -c 'select event, action, status, count(*) from "RawEvent" group by 1, 2, 3 order by 1, 2' -c 'select login from "User"' -c 'select "fullName", private from "Repo"'
EOF
```
Expected: `[boot] GitHub App nitpilot, from the database` and `Nitpilot server listening …` (no "first-run mode"); `nitpilot | NikosGkikas13`; `installation`/`created` (and maybe `installation_repositories`) `processed` or `ignored`, nothing `received`/`retrying`/`failed`; `NikosGkikas13`; `NikosGkikas13/nitpilot-sandbox | f`.

Then the app's face, in the same browser: open https://github.com/settings/apps/nitpilot (or your picture → **Settings** → **Developer settings** at the bottom of the left column → **GitHub Apps** → **Edit** next to **nitpilot**). On **General**:
1. Under **Display information**, click **Upload a logo…**, choose `apps/web/public/icons/icon-512.png` from the Nitpilot folder, and click **Set new avatar** in the crop dialog (keep the whole square). Set **Badge background color** to `#0B0D10` if it asks.
2. In **Description** (further down, under **Basic information**), paste: `Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make. https://nitpilot.dev`
3. Click **Save changes** at the bottom. The app's public page (https://github.com/apps/nitpilot) now shows the logo and the description.

- [x] **Step 10: (say first: installs a script and a cron file on the box, writes a backup to R2, and makes and drops a scratch database) Backups**

```bash
scp deploy/hosted/nitpilot-backup.sh root@157.180.91.106:/usr/local/bin/nitpilot-backup.sh && scp deploy/hosted/cron root@157.180.91.106:/etc/cron.d/nitpilot && ssh root@157.180.91.106 'bash -s' <<'EOF'
chmod 755 /usr/local/bin/nitpilot-backup.sh && chown root:root /etc/cron.d/nitpilot && chmod 644 /etc/cron.d/nitpilot
ls -l /usr/local/bin/nitpilot-backup.sh /etc/cron.d/nitpilot
/usr/local/bin/nitpilot-backup.sh
rclone ls r2:odyhook-backups/nitpilot
EOF
```
Expected: `-rwxr-xr-x … nitpilot-backup.sh`, `-rw-r--r-- … nitpilot`, `<time> nitpilot-backup: ok r2:odyhook-backups/nitpilot/nitpilot-<UTC time>.sql.gz (<n> bytes)`, and that one file listed.

The restore check, the commands from `docs/hosting.md` "Check a backup", in one session:

```bash
sed -n '/^### Check a backup/,/^The two count lines/p' docs/hosting.md | sed -n '/^```bash$/,/^```$/p' | grep -v '^```' | ssh root@157.180.91.106 'bash -s'
```
Expected: the file name, then two equal lines, `nitpilot|13|1|0|1` and `nitpilot_restore_check|13|1|0|1` (13 migrations, one person, no chats yet, one app), and no `nitpilot_restore_check` left (the last command drops it).

Odyhook's backup files are untouched: `ssh root@157.180.91.106 'rclone lsf r2:odyhook-backups | grep -c "^odyhook-"'` prints the same count as Step 2's listing implied (its files sit at the top of the bucket; Nitpilot's are only under `nitpilot/`). The first nightly run is checked in Task 13 section 9 (`/var/log/nitpilot-cron.log`).

- [x] **Step 11: Doc fixes from the run, tick, ledger, commit**

If anything above differed from the text (a click label, a name on the box, a command), fix `docs/hosting.md`, a `deploy/hosted/` file or this plan, in a commit of its own: `git add <those files>` then `git commit -m "docs(hosting): <what the run taught>"` with the trailer. Then tick Steps 1 to 11, add the ledger line `Task 12: complete` with the image (tag and digest: `ssh root@157.180.91.106 "docker inspect -f '{{index .RepoDigests 0}}' ghcr.io/nikosgkikas13/nitpilot:0.1.0-rc.3"`), the memory numbers from Step 2 and Step 5, the app's id (`ssh root@157.180.91.106 "docker exec hooksmith-postgres-1 psql -U nitpilot -d nitpilot -Atc 'select \"appId\" from \"GithubAppConfig\"'"`), and the Odyhook merge commit; and commit:

```bash
git add docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
```
```bash
git commit -m "docs(plan): Task 12, nitpilot.dev is live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: The live acceptance run on nitpilot.dev, and the demo

**What this task is.** Spec §20 item 4's acceptance test, run as a runbook like Plans 1 and 2: Step 1 writes it (and its helpers) and commits; Steps 2 to 5 run its sections with the user; Step 6 records the results. The runbook is the source of truth for the clicks; the steps here say which sections each covers and what to watch for.

**Who runs which agent.** The spec's setup line had the author (ngkdev93-jpg) on the fake agent in the agent-to-agent run. The fake agent can only answer points by their number, so as the author it would have to guess how many points the real reviewer (Claude) raised, and a run would fail on a review with two or four. So the roles there are Plan 1's: the reviewer's CLI switches to the fake reviewer (the same three points every time) and the author's Claude fixes them. The single-player run and the demo keep NikosGkikas13 on Claude Code, which is the launch story. Step 1 changes the spec's setup line to match (CLAUDE.md: the spec changes with the plan).

**Files:**
- Create: `docs/acceptance/plan-3.md`, `docs/acceptance/hosted.sh`, `docs/acceptance/scenarios/sandbox-slow.json`
- Modify: `docs/superpowers/specs/2026-10-07-nitpilot-design.md` (§20 item 4, the setup line), this plan (ticks), the ledger

**Reuses** from `docs/acceptance/`: `new-branch.sh` (a PR branch from the seed, pushed as ngkdev93-jpg from clone A), `seed/orders-demo` (three planted bugs), `stamp.pl` (UTC timestamps on the CLI's lines), `check.sql` and `check-web.sql` (run on the box through `boxq`), `scenarios/sandbox-happy.json`.

---

- [ ] **Step 1: The runbook, its helpers and the spec line; commit**

Create `docs/acceptance/hosted.sh` with exactly this content:

```bash
# Source this in every terminal tab of the Plan 3 run (docs/acceptance/plan-3.md), from the Nitpilot checkout:
#   cd /path/to/nitpilot && source docs/acceptance/hosted.sh
# Unlike env.sh there is no local server: every CLI talks to https://nitpilot.dev, the CLI's default (no NITPILOT_SERVER).
export REPO="$PWD"
export SANDBOX=NikosGkikas13/nitpilot-sandbox
export BOX=root@157.180.91.106
export CLONE_A="$HOME/nitpilot-acceptance/a/nitpilot-sandbox"   # ngkdev93-jpg's clone (github-a)
export CLONE_B="$HOME/nitpilot-acceptance/b/nitpilot-sandbox"   # NikosGkikas13's clone (github-b)

# NikosGkikas13, the reviewer: the built CLI with Claude Code, named like the installed one so the demo shows
# `nitpilot start`. Build it first: npm run build -w apps/cli
nitpilot() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-hosted-r" node "$REPO/apps/cli/dist/index.js" "$@"
}

# NikosGkikas13 again, from source with the fake agent (it only exists in a source checkout), same config folder.
# Follows $R_SCENARIO. Its config must say "agent": "fake" first: nit-edit r '.agent = "fake"'.
nit-rf() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-hosted-r" \
    NITPILOT_FAKE_SCENARIO="${R_SCENARIO:-$REPO/docs/acceptance/scenarios/sandbox-happy.json}" \
    "$REPO/node_modules/.bin/tsx" "$REPO/apps/cli/src/index.ts" "$@"
}

# ngkdev93-jpg, the author in the agent-to-agent run: the built CLI with Claude Code.
nit-w() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-hosted-w" node "$REPO/apps/cli/dist/index.js" "$@"
}

# nit-edit r '.agent = "fake"'   changes ~/.nitpilot-hosted-r/config.json with a jq filter, readable by you only.
nit-edit() {
  local file="$HOME/.nitpilot-hosted-$1/config.json"
  jq "$2" "$file" > "$file.tmp" && chmod 600 "$file.tmp" && mv "$file.tmp" "$file"
}

# boxq -c 'select 1'   or   boxq -v pr=5 -f - < docs/acceptance/check.sql
# psql on nitpilot.dev's database, over ssh, inside Odyhook's Postgres container. Read-only use only.
boxq() {
  ssh "$BOX" "docker exec -i hooksmith-postgres-1 psql -U nitpilot -d nitpilot $(printf '%q ' "$@")"
}

# boxlog 50   the last lines of the server's log.
boxlog() {
  ssh "$BOX" "cd /opt/nitpilot && docker compose logs --tail ${1:-50} nitpilot-server"
}
```

Create `docs/acceptance/scenarios/sandbox-slow.json` with exactly this content (the happy scenario's review, 45 seconds late):

```json
{
  "review": [
    { "sleep": 45000 },
    { "add_point": { "path": "orders-demo/src/orders.js", "line": 5, "severity": "major", "category": "bug", "title": "Page 1 skips the first page", "body": "Pages start at 1 (see the comment above), but the start is page * size, so page 1 begins at item `size`. Use (page - 1) * size." } },
    { "add_point": { "path": "orders-demo/src/orders.js", "line": 12, "severity": "major", "category": "bug", "title": "averageTotal([]) is NaN", "body": "With no orders the sum is 0 and totals.length is 0, so this divides 0 by 0. Return 0 when there are no totals." } },
    { "add_point": { "path": "orders-demo/src/orders.js", "line": 18, "severity": "minor", "category": "bug", "title": "describeOrder throws for an id that does not exist", "body": "orders.find returns undefined for an unknown id, so order.id throws a TypeError. Say the order was not found instead." } },
    { "finish": "Three bugs in orders.js: the page offset, the empty average and the missing order." }
  ]
}
```

Create `docs/acceptance/plan-3.md` with exactly this content:

````markdown
# Plan 3 acceptance run (live, on nitpilot.dev)

The manual end-to-end test of the hosted instance, from [spec §20](../superpowers/specs/2026-10-07-nitpilot-design.md) item 4 ("Plan 3 acceptance test"): the real https://nitpilot.dev on the Hetzner box, the production GitHub App `nitpilot`, real GitHub, two real accounts, a phone, and Claude Code. No tunnel and no local server: every CLI talks to nitpilot.dev, the CLI's default. Follow it top to bottom and tick the boxes. [why/live-acceptance.md](../why/live-acceptance.md) explains why this is a document and not a test.

**Time:** about 2 hours. **Cost:** about 3 Claude Code runs of your Claude plan (section 3, section 4, and one or two in section 6). Sections 7 and 8 use the scripted fake agent and cost nothing. If a run ends with a `quota` failure, wait for the plan's window to reset and carry on.

## Who is who

| Account | Role | CLI | Agent | Where you click |
|---|---|---|---|---|
| `NikosGkikas13` | reviewer, owns the sandbox repo and the `nitpilot` app | `nitpilot` (the built CLI) in sections 2–4; `nit-rf` (from source) in sections 6–7 | **Claude Code**, then the **fake agent** | **NikosGkikas13's browser**: your normal Chrome window, signed in to GitHub as `NikosGkikas13`; and **NikosGkikas13's iPhone** |
| `ngkdev93-jpg` | author | none until section 6, then `nit-w` (the built CLI) | **Claude Code** (section 6) | **ngkdev93-jpg's browser**: a Chrome private window (⇧⌘N) signed in to GitHub as `ngkdev93-jpg` |

Sections 3 and 4 are the launch story: one person on Nitpilot, the reviewer, while the author is just someone on GitHub. In section 6 the author joins too and the two agents work it out in the chat. There the reviewer's agent is the fake one and the author's is Claude, as in Plan 1: the fake reviewer raises the same three points every time, so the author's Claude has something definite to fix, and a run never depends on how many points a real reviewer happens to raise.

The sandbox is `NikosGkikas13/nitpilot-sandbox`, with `ngkdev93-jpg` as a collaborator, and the clones from [plan-1.md](plan-1.md) section 1: `~/nitpilot-acceptance/a/nitpilot-sandbox` (ngkdev93-jpg, over `github-a`) and `~/nitpilot-acceptance/b/nitpilot-sandbox` (NikosGkikas13, over `github-b`).

**Terminals:** **T1** NikosGkikas13's CLI, **T2** ngkdev93-jpg's CLI (from section 6), **T3** commands. In each, first run `cd /path/to/nitpilot && source docs/acceptance/hosted.sh`. It defines `nitpilot`, `nit-rf`, `nit-w`, `nit-edit`, and two read-only views of the box: `boxq` (psql on nitpilot.dev's database) and `boxlog` (the server's log).

**If something goes wrong**, stop and keep the evidence: a screenshot, the T1/T2 output, `boxlog 200`, and `check.sql`'s output. A bug found here gets a failing test first and a fix after; don't patch it live and carry on. A fix to the server reaches nitpilot.dev only through a new `rc` image and a deploy ([hosting.md](../hosting.md), "Deploying a new version").

**Ask before:** every step that writes to GitHub (each PR, each review request, the private repo in section 8), each Claude Code run, turning push on, and the restart in section 7 (it restarts nitpilot.dev).

---

## 0. Before you start

- [ ] nitpilot.dev is up: `curl -s https://nitpilot.dev/healthz` prints `{"ok":true,"version":"0.1.0"}`, and `boxlog 5` (it asks the box over ssh) shows no error.
- [ ] The production app is installed on the sandbox: `boxq -c 'select slug, "ownerLogin" from "GithubAppConfig"' -c 'select "fullName", private from "Repo"'` prints `nitpilot | NikosGkikas13` and a row `NikosGkikas13/nitpilot-sandbox | f`.
- [ ] Claude Code is signed in: `claude auth status` prints `"loggedIn": true`.
- [ ] The tools exist: `command -v jq perl gh git node ssh` prints six paths.
- [ ] The CLI is built from this branch: `npm run build -w apps/cli`, then `nitpilot --version` prints `0.1.0`.
- [ ] Nothing points the CLI elsewhere: `echo "${NITPILOT_SERVER:-unset}"` prints `unset`, and `ls ~/.nitpilot-hosted-r ~/.nitpilot-hosted-w` finds neither folder (each person starts fresh).
- [ ] Plan 1's one-time setup is still there: `ssh -T git@github-a` greets `ngkdev93-jpg`, `ssh -T git@github-b` greets `NikosGkikas13`, both clones exist (`ls "$CLONE_A" "$CLONE_B"`), and clone A's commits are ngkdev93-jpg's: `git -C "$CLONE_A" config user.email` prints `340081894+ngkdev93-jpg@users.noreply.github.com`.
- [ ] `gh` knows both accounts: `gh auth status` lists `NikosGkikas13` and `ngkdev93-jpg`.
- [ ] macOS lets Chrome show notifications: System Settings → **Notifications** → **Google Chrome** → *Allow notifications* is on.

## 1. The addresses (no clicks)

Already checked when nitpilot.dev went live (Plan 3 Task 12); repeat it here so the results are in one place.

**T3:**
```bash
curl -sI http://nitpilot.dev | grep -iE '^(HTTP|location)'
curl -sI https://www.nitpilot.dev | grep -iE '^(HTTP|location)'
curl -sI http://www.nitpilot.dev | grep -iE '^(HTTP|location)'
curl -s https://nitpilot.dev/healthz; echo
echo | openssl s_client -connect nitpilot.dev:443 -servername nitpilot.dev 2>/dev/null | openssl x509 -noout -subject -issuer -enddate
```
Expect: `308` (or `301`) to `https://nitpilot.dev/`; `301` to `https://nitpilot.dev/`; a redirect that ends at `https://nitpilot.dev/` (http → https first, then to the apex); the health answer; and a certificate for `CN=nitpilot.dev` from Let's Encrypt with an end date about three months away.

- [ ] `http://nitpilot.dev` and `www.nitpilot.dev` (http and https) end at `https://nitpilot.dev`, with a valid certificate.

## 2. NikosGkikas13 connects a CLI (about 5 minutes)

NikosGkikas13 signed in to nitpilot.dev when installing the app (Task 12), so only the CLI is new.

1. **T1:** `nitpilot login`. It prints a link and a code and opens your default browser (**NikosGkikas13's browser**). On **Approve this device?** (on `https://nitpilot.dev/…`) check the code is the one in T1 and click **Approve**. T1 prints `Logged in as NikosGkikas13.`
2. **T1:** link the clone and check:
   ```bash
   nitpilot repos add "$CLONE_B" && nitpilot doctor
   ```
   Expect `repos add` to confirm `NikosGkikas13/nitpilot-sandbox` is linked to that clone, and `doctor` to print no `✗` line.
3. **T1:** `nitpilot start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Expect `Connected as NikosGkikas13. Linked: NikosGkikas13/nitpilot-sandbox.` Leave it running.

- [ ] `nitpilot login` and `start` work against nitpilot.dev with no `NITPILOT_SERVER` and no tunnel.

## 3. Single-player reviewer (the first PR; one Claude run)

The launch story: ngkdev93-jpg, who isn't on Nitpilot, asks NikosGkikas13 for a review, and NikosGkikas13's own agent posts it within seconds.

1. **T3** (say first: pushes a branch as ngkdev93-jpg):
   ```bash
   cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" hosted-reviewer; cd "$REPO"
   ```
   Expect `Branch pushed. Open the pull request as account A:` and a link.
2. **ngkdev93-jpg's browser:** open that link. GitHub's **Open a pull request** page compares `acc/hosted-reviewer` with `main`. Click the **Title** box and type `Hosted: reviewer`. Don't pick a reviewer yet. Click the green **Create pull request** button. Note the number (`#<PR>` after the title); in **T3** run `export PR=<number>`.
3. Wait about ten seconds (so the PR's own webhooks are done), then, still in **ngkdev93-jpg's browser**, on the PR's **Conversation** tab: in the right-hand column click the gear next to **Reviewers**, type `NikosGkikas13`, click the name (a tick appears), and click outside the list. **Reviewers** now shows NikosGkikas13 with a small dot (requested).
4. Within about 5 seconds **T1** prints `→ review of NikosGkikas13/nitpilot-sandbox#<PR> (attempt 1)`. Claude works for one to three minutes; then `✓ review of …: done`.
5. **ngkdev93-jpg's browser:** reload the PR. A review by **NikosGkikas13**, with the `nitpilot` app badge next to the name, and inline comments on `orders-demo/src/orders.js` (the seed has three planted bugs; Claude usually finds them and may add others). No comment from `nitpilot[bot]` (only one side is on Nitpilot).
6. **T3:**
   ```bash
   boxq -v pr=$PR -f - < docs/acceptance/check.sql
   gh api repos/$SANDBOX/pulls/$PR/reviews --jq '[.[] | {user: .user.login, state, submitted_at}]'
   gh api repos/$SANDBOX/issues/$PR/comments --jq '[.[] | .user.login]'
   ```
   Compare the `review_requested` arrival time in `check.sql` section 4 with the `→ review of …` stamp in T1 (both UTC).

- [ ] The review job started within 5 seconds of "Request review" (`check.sql` §4 `pull_request.review_requested` against T1's `→ review` stamp).
- [ ] The review is on the PR in NikosGkikas13's name (with the app badge); no `nitpilot[bot]` comment.
- [ ] Every webhook was processed or ignored (`check.sql` §5), and no job ran twice (§3 prints no rows).

## 4. The demo recording (the second PR; one Claude run)

The README's video ([spec §20](../superpowers/specs/2026-10-07-nitpilot-design.md) item 4, "Demo video"): about 45 seconds of the same story on a fresh PR. You record; nothing is trimmed here (that happens with the README, Plan 3 Task 14).

**Get ready (no recording yet):**
1. **T3** (say first: pushes a branch): `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" hosted-demo; cd "$REPO"`.
2. **ngkdev93-jpg's browser:** open the link, title `Add order paging and a summary line`, **Create pull request**. Don't request a reviewer. `export PR=<number>` in **T3**.
3. Turn on Do Not Disturb (Control Center, top right of the menu bar → **Focus** → **Do Not Disturb**), so no notification pops up on the video.
4. Lay out the screen:
   - **Left half: ngkdev93-jpg's browser** on the new PR's **Conversation** tab, scrolled so the **Reviewers** box on the right is visible.
   - **Right half: T1** with the CLI running. Make the text big (⌘+ three or four times) and clear it first: stop the CLI (Ctrl-C), run `clear`, then start it again without the timestamps so the screen reads like a user's: `nitpilot start`. It prints `Connected as NikosGkikas13. Linked: NikosGkikas13/nitpilot-sandbox.`
   - **NikosGkikas13's browser**, behind the other two, open on `https://nitpilot.dev/c/NikosGkikas13/nitpilot-sandbox/<PR>` (the chat). Before the review starts it says this PR has no chat yet; that's fine, it fills in by the end.

**Record (about a minute and a half; the wait while Claude works is cut later):**
5. Press ⇧⌘5. A bar appears at the bottom of the screen: click **Record Entire Screen** (the icon with a solid rectangle), then **Record**. A small stop button appears in the menu bar.
6. Pause two seconds on the PR page. In **ngkdev93-jpg's browser** click the gear next to **Reviewers**, type `NikosGkikas13`, click the name, click outside the list.
7. Look at **T1**: within a second or two `→ review of NikosGkikas13/nitpilot-sandbox#<PR> (attempt 1)`. Keep still while Claude works (this part is cut later); when T1 prints `✓ review of …: done`, reload **ngkdev93-jpg's browser** (⌘R) and scroll slowly down the conversation through NikosGkikas13's review and its inline comments.
8. Click **NikosGkikas13's browser** to bring it to the front and reload it (⌘R): the chat with the review's points. Pause three seconds.
9. Click the stop button in the menu bar. The recording opens in a corner preview; click it, then **File → Save…**, name it `nitpilot-demo`, save it in **Movies**. Keep the file: Task 14 makes the README's MP4 and GIF from it.
10. Turn Do Not Disturb off. In **T1**, stop the CLI and start it with timestamps again: `nitpilot start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`.

- [ ] `~/Movies/nitpilot-demo.mov` exists and shows the PR, "Request review", the terminal taking the job, the review on the PR, and the chat; the bot or account it shows is the production one (`nitpilot`), not `nitpilot-dev`.

## 5. Push on desktop Chrome and on the iPhone (about 10 minutes)

Ask first: turning push on registers each browser with its push service (Google's for Chrome, Apple's for the iPhone). Unlike Plan 2, there is no callback address to add for the run: `https://nitpilot.dev` is the app's own address for good.

1. **NikosGkikas13's browser**, on https://nitpilot.dev/inbox: click your avatar at the top left beside the Nitpilot wordmark (*Settings · NikosGkikas13*). In the **Notifications** card click the **Push notifications** switch (grey). Chrome shows *nitpilot.dev wants to Show notifications* under the address bar: click **Allow**. The switch turns blue.
2. **NikosGkikas13's iPhone:** open **Safari**, type `https://nitpilot.dev` (with the `https://`), tap **Sign in with GitHub** and sign in as `NikosGkikas13`; GitHub asks once to **Authorize nitpilot**. You land in the inbox.
3. Tap **Share** (the square with an arrow up, in the bottom bar) → scroll down → **Add to Home Screen** → **Add**.
4. Go to the Home Screen and open the new **Nitpilot** icon. If it shows the landing page, tap **Sign in with GitHub** again inside it (it keeps its own cookies).
5. Tap your avatar → **Settings** → **Notifications** → the **Push notifications** switch → **Allow**.
6. **T3:** `boxq -v pr=0 -f - < docs/acceptance/check-web.sql`. Section 4 lists two rows for `NikosGkikas13`: *Chrome on macOS* and *Safari on iPhone*.

- [ ] Push is on in NikosGkikas13's Chrome and in the iPhone's Home Screen app (two subscriptions in `check-web.sql` §4), with no callback URL added anywhere.

## 6. Agent to agent (the third PR; one or two Claude runs)

ngkdev93-jpg joins, with Claude Code fixing; NikosGkikas13's agent becomes the fake reviewer.

1. **ngkdev93-jpg's browser:** open https://nitpilot.dev and click **Sign in with GitHub**; on GitHub click **Authorize nitpilot**. You land on the setup checklist.
2. **T2:** `nit-w login --no-open`. Copy the link it prints into **ngkdev93-jpg's browser**, check the code, click **Approve**. T2 prints `Logged in as ngkdev93-jpg.`
3. **T2:** `nit-w repos add "$CLONE_A" && nit-w doctor` (no `✗`), then `nit-w start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Expect `Connected as ngkdev93-jpg.`
4. **T1:** stop the CLI (Ctrl-C), switch NikosGkikas13 to the fake agent and start it from source:
   ```bash
   nit-edit r '.agent = "fake"' && unset R_SCENARIO && nit-rf start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
   Expect `Connected as NikosGkikas13.`
5. **T3** (say first: a branch, then Claude runs on ngkdev93-jpg's side): `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" hosted-pair; cd "$REPO"`. In **ngkdev93-jpg's browser** open the link, title `Hosted: agent to agent`, and this time pick the reviewer before creating it: the gear next to **Reviewers** → `NikosGkikas13` → click outside → **Create pull request**. `export PR=<number>` in **T3**.
6. Expect, with no clicks:
   - **T1** within 5 seconds: `→ review of …#<PR>`, then `✓ review … done` (three points, a second or two).
   - GitHub: one comment from **`nitpilot[bot]`** (the summary) a few seconds later.
   - **T2** about 30 seconds after the review (`debounce_seconds`): `→ address of …#<PR> (attempt 1)`; Claude edits `orders.js`, replies to each point, and a commit lands on the branch; `✓ address … done`.
   - **T1:** `→ re_review of …`, `✓ … done` (all three resolved).
   - The chat is ready: **NikosGkikas13's Mac** shows a notification from **Google Chrome** titled *Ready for your approval* (top right); click it and Chrome opens the chat. **NikosGkikas13's iPhone** shows the same from **Nitpilot**; tap it and the Home Screen app opens the chat. T1 prints a `🔔 Ready for your approval …` line, and no notification from **Script Editor** appears on the Mac (that's the CLI's fallback when push didn't reach you).
7. **T3:**
   ```bash
   boxq -v pr=$PR -f - < docs/acceptance/check.sql
   gh api repos/$SANDBOX/issues/$PR/comments | jq --arg link "/c/$SANDBOX/$PR" '[.[] | select(.user.login == "nitpilot[bot]")] | {bot_comments: length, edited: (.[0].updated_at != .[0].created_at), has_log: (.[0].body | contains("<summary>Review log")), has_transcript_link: (.[0].body | contains($link))}'
   gh api repos/$SANDBOX/pulls/$PR/commits --jq '[.[] | {sha: .sha[0:7], author: .author.login, message: .commit.message}]'
   ```
   Expect `check.sql` §1 phase `ready`; the `jq` line `bot_comments: 1` with `edited`, `has_log` and `has_transcript_link` all `true`; and every commit's `author` `ngkdev93-jpg`.

- [ ] The chat reached READY with exactly one `nitpilot[bot]` summary comment, edited across rounds.
- [ ] The fix commit is authored by ngkdev93-jpg.
- [ ] Web Push arrived on desktop Chrome and on the iPhone Home Screen app, and clicking it opened the chat; the CLI showed no OS notification.

## 7. A restart in the middle of a job (the fourth PR; no Claude run)

`docker compose restart` on the box while NikosGkikas13's agent is in the middle of a review. The fake reviewer waits 45 seconds before it raises its points (`scenarios/sandbox-slow.json`), which leaves time to restart.

1. **T2:** stop ngkdev93-jpg's CLI (Ctrl-C), so no Claude address job starts in this section.
2. **T1:** stop the CLI and start it on the slow scenario:
   ```bash
   R_SCENARIO="$REPO/docs/acceptance/scenarios/sandbox-slow.json" nit-rf start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
3. **T3** (say first: a branch): `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" hosted-restart; cd "$REPO"`. **ngkdev93-jpg's browser:** open the link, title `Hosted: restart`, pick **NikosGkikas13** under **Reviewers**, **Create pull request**. `export PR=<number>`.
4. The moment **T1** prints `→ review of …#<PR> (attempt 1)`, in **T3** (say first: restarts nitpilot.dev):
   ```bash
   ssh $BOX 'cd /opt/nitpilot && docker compose restart && docker compose ps --format "{{.Name}} {{.Status}}"'
   ```
   Expect `Container nitpilot-server  Restarting`, `Started`, and a status line. **T1** shows the connection dropping and, within a few seconds, `Connected as NikosGkikas13.` again, with no `■ Stopped` and no new `→ review` line.
5. About 45 seconds after the job started, **T1** prints `✓ review of …: done`. **ngkdev93-jpg's browser:** the PR has NikosGkikas13's review with three inline comments (lines 5, 12, 18).
6. **T3:** `boxq -v pr=$PR -f - < docs/acceptance/check.sql` and `boxlog 60 | grep -iE 'shutting|1012|listening|lock'`.

- [ ] The restart lost nothing: one `review` job, `done` at attempt 1 (`check.sql` §2), no duplicates (§3), the review on the PR, and the CLI reconnected by itself; the log shows the shutdown and the new start.

## 8. A webhook from a private repo is dropped (no agent runs)

The hosted instance takes public repos only (`PUBLIC_REPOS_ONLY=true`). Ask first: this makes a private repo on NikosGkikas13's account, installs the app on it and opens a PR there.

1. **T3:** make the repo with one commit on `main` and a branch:
   ```bash
   gh repo create NikosGkikas13/nitpilot-private-check --private --add-readme --description "Plan 3 acceptance: a private repo the hosted instance must ignore"
   gh api -X PUT repos/NikosGkikas13/nitpilot-private-check/contents/check.txt -f message="Add check.txt" -f content="$(printf 'private\n' | base64)" -f branch=main
   ```
   That makes the repo (and `README.md` on `main`) and adds a file. Then a branch with a change, and its PR:
   ```bash
   sha=$(gh api repos/NikosGkikas13/nitpilot-private-check/git/ref/heads/main --jq .object.sha)
   gh api repos/NikosGkikas13/nitpilot-private-check/git/refs -f ref=refs/heads/check -f sha="$sha"
   blob=$(gh api repos/NikosGkikas13/nitpilot-private-check/contents/check.txt --jq .sha)
   gh api -X PUT repos/NikosGkikas13/nitpilot-private-check/contents/check.txt -f message="Change check.txt" -f content="$(printf 'private, changed\n' | base64)" -f branch=check -f sha="$blob"
   ```
2. **NikosGkikas13's browser:** install the app on it. Open https://github.com/settings/installations, click **Configure** next to **nitpilot**. Under **Repository access** (**Only select repositories** is already chosen), click **Select repositories**, type `nitpilot-private-check`, click it, and click **Save** at the bottom. GitHub may ask for your password or a code first.
3. **T3:** open the PR, asking for no review (there's nobody else on this repo):
   ```bash
   gh pr create -R NikosGkikas13/nitpilot-private-check --head check --base main --title "Private check" --body "Must be dropped by nitpilot.dev."
   ```
4. **T3**, after about 10 seconds:
   ```bash
   boxq -c "select event, action, status, note from \"RawEvent\" where body::jsonb -> 'repository' ->> 'full_name' = 'NikosGkikas13/nitpilot-private-check' order by \"createdAt\"" -c "select \"fullName\", private from \"Repo\" where \"fullName\" like '%private-check'" -c "select count(*) as chats from \"PrChat\" c join \"Repo\" r on r.id = c.\"repoId\" where r.\"fullName\" like '%private-check'"
   ```
   Expect the `installation_repositories` / `pull_request` rows for that repo `ignored` with the note `private repo (public-only mode)` (an `installation_repositories` delivery carries no `repository` field, so it may not be listed), and `0` chats. The `Repo` query may list the repo with `private` `t` (the installation sync records it); what matters is that nothing about its PR got through.
5. Remove the repo again, **NikosGkikas13's browser**: open https://github.com/NikosGkikas13/nitpilot-private-check/settings, scroll to the red **Danger Zone** at the bottom, **Delete this repository**, confirm the steps GitHub shows (it asks you to type `NikosGkikas13/nitpilot-private-check`), and click the red delete button. (GitHub also removes it from the app's installation.)

- [ ] The private repo's PR webhooks were stored as `ignored` (`private repo (public-only mode)`), and no chat or job came from them.

## 9. Backups, memory, and Odyhook (no clicks)

1. **T3:** a backup of what this run made, then the restore check (both on the box; "say first" covers the scratch database it makes and drops):
   ```bash
   ssh $BOX '/usr/local/bin/nitpilot-backup.sh && tail -n 3 /var/log/nitpilot-cron.log'
   ```
   Expect `nitpilot-backup: ok r2:odyhook-backups/nitpilot/nitpilot-<time>.sql.gz (<n> bytes)`. Then the commands under "Check a backup" in [hosting.md](../hosting.md), on the box (`ssh $BOX`, paste them, `exit`). Expect the two count lines to match: the same number of migrations, people (`User`: 2 now), chats (this run's four PRs, plus Task 12's), and `1` app.
2. **T3:** the cron line is in place: `ssh $BOX 'grep -c nitpilot-backup /etc/cron.d/nitpilot'` prints `1`. If a night has passed since Task 12, the log shows an `ok` line from 03:30 UTC.
3. **T3:** `ssh $BOX 'docker stats --no-stream; free -m'`, and `curl -s -o /dev/null -w '%{http_code}\n' https://odyhook.dev`.

- [ ] The nightly backup holds the `nitpilot` database, and restoring it into a scratch database works (the two count lines match).
- [ ] `docker stats` after the run shows `nitpilot-server` under its 384 MiB limit, and odyhook.dev answers `200`.

## 10. Wrap up

1. **T1** and **T2:** stop both CLIs (Ctrl-C). Put NikosGkikas13 back on Claude Code: `nit-edit r '.agent = "claude-code"'`.
2. Close the four PRs, as ngkdev93-jpg (say first): for each number, `GH_TOKEN=$(gh auth token -u ngkdev93-jpg) gh pr close <n> -R $SANDBOX --delete-branch`. Their chats close on nitpilot.dev and are deleted 90 days later (`CLOSED_CHAT_RETENTION_DAYS`).
3. Keep `~/.nitpilot-hosted-r` (NikosGkikas13 stays on nitpilot.dev). For ngkdev93-jpg, either keep `~/.nitpilot-hosted-w` or sign that CLI out: in **ngkdev93-jpg's browser**, https://nitpilot.dev → avatar → **Settings** → **Devices** → **Revoke** on the device, then `rm -rf ~/.nitpilot-hosted-w`. (D5 repeats the single-player run with a fresh config anyway.)
4. Turn off nothing on the box: nitpilot.dev stays up.

## 11. Results

Run on: <date>, <UTC times>, with nitpilot.dev on image `0.1.0-rc.<n>` (<digest>), the CLI from commit `<sha>`. Agents: Claude Code <version> (NikosGkikas13 in sections 3–4, ngkdev93-jpg in 6); the fake agent from source (NikosGkikas13 in 6–7). Desktop: Chrome <version> on macOS <version>. Phone: iPhone on iOS <version>. PRs: sandbox #<n> (3), #<n> (4), #<n> (6), #<n> (7), `nitpilot-private-check` #1 (8, repo deleted after).

| Criterion (spec §20 item 4) | Section | Evidence |
|---|---|---|
| `http://nitpilot.dev` and `www.nitpilot.dev` end at `https://nitpilot.dev`, with a valid certificate | 1 | |
| Single-player reviewer: the review job starts within 5 s of "Request review", and the review is posted in the reviewer's name | 3 | |
| Agent to agent: the chat reaches READY with exactly one `nitpilot[bot]` summary comment | 6 | |
| Web Push arrives on desktop Chrome and on the iPhone Home Screen app, with no per-run callback URL | 5, 6 | |
| A webhook from a private repo is dropped (`PUBLIC_REPOS_ONLY`) | 8 | |
| `docker compose restart` in `/opt/nitpilot` mid-job loses nothing: the CLI reconnects and the job completes | 7 | |
| The nightly backup contains the `nitpilot` database, and restoring it into a scratch database works | 9 | |
| `docker stats` after the run shows `nitpilot-server` under its limit, and Odyhook still answers | 9 | |
| The demo is recorded on nitpilot.dev, showing `nitpilot`, not `nitpilot-dev` | 4 | |

**What was found and fixed during the run** (each with its commit): <none yet>
````

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md`, §20 item 4, "Plan 3 acceptance test (live, on nitpilot.dev)", **Setup** bullet, replace

```
the author (ngkdev93-jpg) is not on Nitpilot for the single-player run, and runs the CLI with the fake agent for the agent-to-agent run.
```
with
```
the author (ngkdev93-jpg) is not on Nitpilot for the single-player run, and joins with Claude Code for the agent-to-agent run, where the reviewer's CLI switches to the scripted fake agent (as in Plan 1: the same three points every time, so the run never depends on how many points a real reviewer raises). The runbook is `docs/acceptance/plan-3.md`.
```

Check the helpers load and the scenario parses (no network):

```bash
zsh -c 'source docs/acceptance/hosted.sh && whence -w nitpilot nit-rf nit-w nit-edit boxq boxlog' && node -e 'const s = require("./docs/acceptance/scenarios/sandbox-slow.json"); console.log(s.review.length, JSON.stringify(s.review[0]))'
```
Expected: six `…: function` lines, then `5 {"sleep":45000}`.

Commit:

```bash
git add docs/acceptance/plan-3.md docs/acceptance/hosted.sh docs/acceptance/scenarios/sandbox-slow.json docs/superpowers/specs/2026-10-07-nitpilot-design.md
```
```bash
git commit -m "docs(acceptance): the Plan 3 runbook for nitpilot.dev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: (say first: GitHub writes and a Claude run) The single-player run: runbook sections 0 to 3**

I start the terminals (T1 to T3, each `source docs/acceptance/hosted.sh`) and run the checks of section 0 and section 1 myself; I say first before each GitHub write (the branch, then the user's PR and review request) and before Claude runs. The user approves the device in section 2 and does the clicks in section 3 as **ngkdev93-jpg**. Watch for: the `→ review` stamp in T1 against `check.sql` §4's `review_requested` time (the 5-second criterion), and the app badge on the review.

- [ ] **Step 3: (user, say first: a GitHub write and a Claude run) The demo: runbook section 4**

The user records with ⇧⌘5 following the runbook's layout and shot list; I push the branch and set up T1 (`clear`, `nitpilot start` without timestamps). I trim nothing; the user keeps `~/Movies/nitpilot-demo.mov` for Task 14.

- [ ] **Step 4: (say first: push registration, GitHub writes, Claude runs) Push and agent to agent: runbook sections 5 and 6**

The user turns push on in Chrome and on the iPhone (section 5) and signs ngkdev93-jpg in (section 6); I switch NikosGkikas13's CLI to the fake agent and start ngkdev93-jpg's. Watch for: exactly one `nitpilot[bot]` comment, the fix commit authored by ngkdev93-jpg, the *Ready for your approval* push on both devices, and no Script Editor notification.

- [ ] **Step 5: (say first: restarts nitpilot.dev; makes and deletes a private repo) The remaining criteria: runbook sections 7 to 10**

The restart (section 7) is the one moment the hosted instance goes down on purpose: I run it the moment T1 shows `→ review`. The private repo (section 8) is made with `gh` as NikosGkikas13 and deleted by the user at the end of that section. Section 9's backup and restore check run on the box (they write one more backup and make and drop the scratch database). Section 10 closes the PRs as ngkdev93-jpg.

- [ ] **Step 6: Results, tick, commit**

Fill section 11's table in `docs/acceptance/plan-3.md` with what was seen (times, PR numbers, the image digest, versions), tick every box in the runbook, and write "What was found and fixed during the run". A fix found during the run is its own commit first (TDD for code; a code fix reaches nitpilot.dev only through a new `rc` and `docs/hosting.md` "Deploying a new version", said first). Then tick Steps 1 to 6 here, add the ledger line `Task 13: complete`, and commit:

```bash
git add docs/acceptance/plan-3.md docs/superpowers/plans/2026-10-24-plan-3-deploy-and-launch.md
```
```bash
git commit -m "test(acceptance): the Plan 3 live run on nitpilot.dev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Checked against the code (D4)

Checked at `528639f` and in the scratch build (`~/Desktop/PracticeProjects/.nitpilot-scratch/d4`, detached at `528639f`; checkpoints pinned as `refs/scratch/d4/task-11` = `5848d1f` and `refs/scratch/d4/task-13` = `c77c61a`; the local run used its own containers and network, all removed). Each line is where the step-level text differs from the task-level text it replaced, or a fact the task-level text got wrong. Nothing that writes outside the repo was run.

**Task 11**

1. **`rclone copyto` of a checked temp file, not `pg_dump | gzip | rclone copy`.** Odyhook's script streams into `rclone rcat` (no temp file). A streamed upload stores a dump cut short by a `pg_dump` failure as if it were whole (`pipefail` fails the script, but the object is already in R2). The script dumps to a `mktemp -d` folder, checks the `-- PostgreSQL database dump complete` line, gzips, then `copyto`; the `trap` removes the folder. Both failure paths were seen in the local run (a failed upload, and a missing container: `FAILED: …`, exit 1, nothing uploaded).
2. **File name** `nitpilot/nitpilot-YYYY-MM-DDTHH-MM-SSZ.sql.gz` (task text: `nitpilot/<UTC date>.sql.gz`): Odyhook's naming, sorts by time, and two runs on one day don't overwrite each other.
3. **`mktemp -d "${TMPDIR:-/tmp}/nitpilot-backup.XXXXXX"`**, not bare `mktemp -d`: macOS's `mktemp` ignores `TMPDIR` without a template (it used `/var/folders/…`, which the rclone stand-in couldn't see). Same behaviour on the box's Linux.
4. **`pg_dump --no-owner --no-privileges`** (not in the task text), so the dump loads as any role into any database (the scratch database, or a new box before the role exists).
5. **The box's names are taken from Odyhook's docs, and confirmed on the box in Task 12 Step 2, not read from the box while writing.** The task text said "reads the remote's name from the box (`rclone listremotes`) and Odyhook's script, never guessing". Reading the box would touch the server, which this milestone said it wouldn't do while writing; Odyhook's `infra/README.md` documents the remote `r2`, the bucket `odyhook-backups`, the script's `pg_dump | gzip | rclone rcat`, the 03:00 cron line, and `recovery.md` the superuser `hooksmith`. The script's defaults use them, overridable with `NITPILOT_PG_CONTAINER` / `NITPILOT_BACKUP_DEST` (which is also how the local run pointed it at stand-ins). Task 12 Step 2 stops if any differs.
6. **No top-level `name: nitpilot` in the compose file** (task text: "project name `nitpilot`"). The folder `/opt/nitpilot` already names the project `nitpilot`; an explicit `name:` would make a copy run anywhere else (the local check on this Mac) join this repo's dev project `nitpilot` (`nitpilot-postgres-1`), where a `down --remove-orphans` could remove the dev database. Same reasoning as Checked D3 item 39.
7. **`NITPILOT_VERSION` is required** (`${NITPILOT_VERSION:?…}`) instead of defaulting to `latest`: the hosted instance always names its version, and before D5 there is no `latest` (an rc never pushes it).
8. **Added to the compose file:** a `logging` cap (json-file, 3 × 10 MB), so a chatty log can't fill the 40 GB disk; the network is declared as `hooksmith: { name: hooksmith_default, external: true }` (the service refers to it as `hooksmith`).
9. **`.env.example` has no `NODE_ENV`** (the image sets `NODE_ENV=production`), and `DATABASE_URL=` is empty with a comment rather than `postgresql://nitpilot:<password>@postgres:5432/nitpilot` (the task text): the box command writes the whole URL with a fresh password, so there's no placeholder to forget.
10. **The `.env` and database commands avoid `sed -i` and command-line secrets.** `set_env` is an `awk` rewrite (same on macOS and Linux) that takes the name and value from its environment (`K=… V=… awk …`, read as `ENVIRON["K"]`), not as `-v` arguments, because a program's arguments are visible to anyone in `ps` while it runs and its environment only to its owner (Task 11 review, fixed in the same task); the VAPID keys are read with `read -r pub priv < <(docker run --rm --entrypoint node …)` (Checked D3 item 35), never echoed; the database password is read back from `.env` and sent to `psql` on standard input (a here-document), never as an argument (where `ps` would show it). The task text said "`openssl rand -hex 24`, written straight into `/opt/nitpilot/.env`, never echoed" without the commands.
11. **Database step order:** `.env` first (Task 12 Step 3, which makes the password), then the role (Step 4, which reads it back). The task text had the database first. `REVOKE ALL ON DATABASE nitpilot FROM PUBLIC` is added. "`psql` as `nitpilot` connects" is checked by the server's own migrations at start (Step 5) rather than a separate `psql` with the password on its command line.
12. **Caddy restart after Odyhook's deploy** (not in the task text, which said Odyhook's workflow redeploys Caddy). Odyhook's deploy is `git pull --ff-only && docker compose -f docker-compose.prod.yml up -d --build` (its `infra/README.md`); `up -d` leaves an unchanged Caddy container running, Caddy doesn't watch its file, and `git pull` replaces the file, which a single-file bind mount doesn't follow. So Task 12 Step 8 restarts `hooksmith-caddy-1` once (said first) and checks the file inside the container. Not seen live; the `grep -c` inside the container is the check.
13. **Odyhook's checkout has the user's uncommitted work** (`.gitignore`, `ARCHITECTURE.md`, on `main`, 2026-10-25), so the Caddyfile branch is made in a separate worktree from `origin/main` and removed afterwards; the user's checkout never moves. Odyhook's deploy workflow runs its test gate on the PR before the merge.
14. **`docs/hosting.md` "After Odyhook's own deploys"** comes from two local checks: Postgres restarted under the server (it exited, Docker restarted it, healthy again, a new setup code in first-run mode), and an Odyhook `docker compose down` with Nitpilot attached (`Network … Resource is still in use`, exit 0, the network kept and reused by the next `up`).
15. **Restore check commands** use `psql -q -o /dev/null`: a plain-SQL dump has a `SELECT pg_catalog.set_config(…)`, whose one-row result `-q` alone still prints.
16. **The R2 lifecycle rule** (14 days, Odyhook's) may or may not cover `nitpilot/`; `docs/hosting.md` says where to look in Cloudflare's dashboard. Not checked (it needs the user's Cloudflare login); the dumps are a few KB, so either way costs nothing.
17. **Memory in the local run:** `nitpilot-server` used 170.5 MiB of its 384 MiB, idle in first-run mode (arm64 build on this Mac). The box's numbers come in Task 12.
18. **No counts change** (no code). The new files passed the Task 10 gitleaks scan (`dir`, `no leaks found`) and shellcheck v0.11.0.
18a. **Task 11 review fixes (after `aed7bc8`).** `set_env` reads its value from the environment (item 10). The restore check drops a leftover `nitpilot_restore_check` first (`drop database if exists`, with `client_min_messages = warning` so a normal run prints no NOTICE), so a check cut short earlier can't leave a stale copy that the counts then compare. The backup script has `trap 'log "FAILED: line $LINENO"' ERR`, so a failure outside its three `if !` checks (`mktemp`, `gzip` on a full disk) still leaves a `FAILED` line in `/var/log/nitpilot-cron.log`; Step 6g has a third case for it.
18b. **Task 11 review minors (after `c0cc700`).** "Set it up" steps 2 and 3 in `docs/hosting.md` run as one `bash -s` block each with `set -euo pipefail` (as Task 12 runs them), so step 3 stops on a missing password instead of creating the role with an empty one, and an `exit` doesn't close the ssh session. "Put a backup back" downloads the file and checks its "dump complete" line before the live database is dropped, and says to avoid 03:00–04:00 UTC; Step 6h replays it verbatim. Its `up -d` became `up -d --wait` (seen in the re-run: without it, `logs --tail 20` right after the start showed the previous start's lines, not this one's). "On a new box" step 4 says which line to leave out. The completeness check reads the last 20 lines, not 5 (Postgres 16.10+ writes `\unrestrict …` after the "dump complete" line). "Only Caddy can reach it" now says any container on Odyhook's network could, and only Caddy does. The runbook notes that Odyhook's own `rclone ls r2:odyhook-backups` now shows `nitpilot/` files too.

**Task 12**

19. **Steps reordered and split** (task text: 10 steps). New order: public (1), a read-only look at the box (2, new), folder and `.env` (3), database (4), start (5), the `.env` copy (6, was inside Step 4), DNS (7), Caddy (8; DNS now comes first, not "just before Step 6's push lands", so Caddy gets its certificate at once), the app (9), backups (10), ticks (11).
20. **Item 61 of Checked D3 is Step 1's first half**: the Task 10 mirror-clone scan with `.gitleaks.toml`, on the history as it is when the repo goes public; a finding stops the step.
21. **Version:** the newest rc is `0.1.0-rc.3` (tags `v0.1.0-rc.1..3`), and `git diff --stat v0.1.0-rc.3 528639f -- Dockerfile .dockerignore apps packages package.json package-lock.json` is empty: D4 changes nothing in the image. Step 1 repeats the check and names the rule for an `rc.4`.
22. **Health checks** use node's `fetch` inside the container and `docker inspect … Health.Status` (Checked D3 item 35); from Odyhook's Caddy container (Alpine) `wget` is available, which proves the by-name route Caddy will use.
23. **The setup code is read by the user** in their own terminal (`docker logs … | grep "setup code" | tail -n 1`), not by me and shown in chat (task text: "I read it from the log"): on the production server it guards the empty instance, and the How-to-work rule says commands that print secrets are the user's. It changes at every server start (seen locally), hence `tail -n 1`.
24. **DNS at Porkbun:** nitpilot.dev's nameservers are Porkbun's (`dig +short NS`, 2026-10-25), so the click-steps are Porkbun's DNS page. Porkbun's smallest TTL is 600, not 300 (task text). The parking records it adds by default are deleted. The labels in the click-steps are from Porkbun's page as it was described in Odyhook's setup, not seen this session; the user's report corrects them in Step 11 if they differ.
25. **The redirect codes:** Caddy's automatic http→https redirect is a `308`, and the `www` block's `redir … permanent` a `301` (task text: `301` for both).
26. **The app's name** `nitpilot` is typed over the page's default `Nitpilot (nitpilot.dev)` (Checked D3 item 25: the default uses `URL.host`); **Who can install it** = **Anyone on GitHub** (`public: true` in the manifest). GitHub's own page text in Step 9 3–7 is as seen in Task 9's live run with the throwaway app.
27. **Step 9's app description** is the spec's §1 pitch plus the address; the badge colour is the web app's dark background token (an assumption: the user can leave GitHub's default).
28. **Odyhook's Caddyfile commit carries the user's `Co-Authored-By` trailer** too (the user's rule is "every commit"); its message follows Odyhook's `feat(…)` style.

**Task 13**

29. **Agent-to-agent roles** (the spec's setup line changes in Step 1): the reviewer's CLI on the fake agent and the author's on Claude Code, as in Plan 1, because the fake agent answers points by number and can't play an author facing a real reviewer's unknown number of points (`apps/cli/src/agents/fake/agent.ts`: `reply: { point, … }`). The single-player run and the demo keep the reviewer on Claude Code.
30. **The restart check uses the fake reviewer, 45 s late** (`scenarios/sandbox-slow.json`, new), so the restart lands mid-job every time and costs no Claude run; the author's CLI is stopped so no Claude address job follows. Points are buffered in the CLI until `finish` (`apps/cli/src/mcp/tools/write.ts`), and unacked answers are sent again after the CLI's next `Connected as …` (`apps/cli/src/daemon.ts`), which is what the check relies on.
31. **`hosted.sh`** (new, next to `env.sh`): `nitpilot` is the built CLI under that name so the demo shows `nitpilot start`; `nit-rf` the same config folder from source (the fake agent exists only in a source checkout); `nit-w` ngkdev93-jpg's built CLI; `boxq`/`boxlog` read the box over ssh (arguments quoted with `printf '%q '`, checked in zsh against bash on the far side). No `NITPILOT_SERVER` anywhere: `DEFAULT_SERVER` is `https://nitpilot.dev`.
32. **No `nitpilot logout` command exists** (`apps/cli/src/commands/`: doctor, login, repos, retry, start, status), so the wrap-up revokes the device in Settings → Devices instead.
33. **The private-repo check** makes its repo with `gh` (a README, a file, a branch, a PR) and the user only adds it to the installation and deletes it, both in the browser; the drop is `RawEvent.status = 'ignored'` with the note `private repo (public-only mode)` (`apps/server/src/ingest/handle.ts`). An `installation_repositories` delivery has no `repository` field, so it isn't filtered there and the installation sync may record the repo (`private` true): that's expected, and the check is that no chat or job comes from its PR.
34. **Push needs no callback-URL step** on nitpilot.dev (the Plan 2 run added the tunnel's callback to the dev app); the *Ready for your approval* push is the reviewer's, so it is checked in the agent-to-agent run, where NikosGkikas13's approval is what's asked for.
35. **The demo layout** puts ngkdev93-jpg's PR page and T1 side by side and the chat (NikosGkikas13's Chrome) behind, recorded with ⇧⌘5 (whole screen); the wait while Claude works is cut in Task 14, where the MP4 and GIF are made.
36. **Not verified while writing:** anything on the box, GitHub, Porkbun or R2; the CLI's exact words when the server restarts (only the second `Connected as …` line is certain); and the number of points Claude raises in sections 3 and 4 (the runbook doesn't depend on it).

---

## Milestone D5: Launch

### Task 14: README, docs pass, demo in the README

**Files:** Modify `README.md` (rewrite), `docs/architecture.md` (deploy: one image, first-run mode, the hosted layout; Chosen / Alternatives / Why), `docs/why/README` index if there is one, `docs/adapters.md` (check it still matches), `apps/cli/package.json` `description` and its own `README.md` (npm shows it).

- [ ] **Step 1:** README order: the one-line pitch; the demo video (the user uploads the MP4 by dragging it into a GitHub issue or the README editor on github.com, which gives a `user-attachments` URL; click-steps) and a GIF fallback (`ffmpeg` from the MP4, under 5 MB, in `docs/media/`); the launch story in three sentences; Install (`npm install -g nitpilot`, `nitpilot login`, install the app, `nitpilot repos add`, `nitpilot start`); "When your teammate is on it too"; How it works (short, links to architecture and `docs/why/`); Self-hosting (link); Security (what the agent can and can't do, the scrub list, a contact line using an address the user picks); Development (the current "Running it locally"); License.
- [ ] **Step 2:** Docs pass: every `docs/why/` file still names files that exist (`grep` each path), architecture covers Plan 3, no "Plan 3 adds…" future tense left anywhere (`grep -rn "Plan 3" README.md docs/*.md docs/why`).
- [ ] **Step 3:** The user reads the README on GitHub (rendered) and says go; commit `docs: the launch README, with the demo`.

### Task 15: v0.1.0, the fresh-install check, and the Show HN draft

- [ ] **Step 1: (say first) Release.** First the trusted publisher (click-steps on npmjs.com, signed in as the package owner): open https://www.npmjs.com/package/nitpilot → **Settings** → **Trusted Publisher** → **GitHub Actions**; fill **Organization or user** `NikosGkikas13`, **Repository** `nitpilot`, **Workflow filename** `release.yml`, **Environment name** empty; for **Permissions** choose `npm publish` (not `npm stage publish`); **Set up connection**, approve with 2FA. npm wants the connection used within 48 hours (it shows "Pending validation"), so push the tag right after; if it expires, delete the connection and make it again (the fields can't be edited). The user pushes the branch's state to `main` (their merge) and the tag `v0.1.0` (commands given). The workflow: image `0.1.0` and `latest` on GHCR; `nitpilot@0.1.0` on npm with the provenance badge (check npmjs.com/package/nitpilot shows "Built and signed on GitHub Actions"). If npm's staged publishing holds the version for approval, the user approves it with 2FA (npmjs.com → the package's **Staged Packages** tab, or `npm stage approve <stage-id>`). Deprecate the placeholder: the user runs `npm deprecate nitpilot@0.0.0 "Placeholder; use 0.1.0 or later"`.
- [ ] **Step 2:** Deploy `0.1.0` on the box (`NITPILOT_VERSION=0.1.0`, `docker compose pull && docker compose up -d`) and check `/healthz`.
- [ ] **Step 3: The fresh-install check:** in a new folder with a fresh `NITPILOT_CONFIG_DIR`, `npm install -g nitpilot` (from npm, not the repo), `nitpilot --version` = 0.1.0, `nitpilot login` against nitpilot.dev, repeat Task 13 Step 2's single-player run once. Tick spec §20's D5 line in `docs/acceptance/plan-3.md`.
- [ ] **Step 4: The Show HN draft** in `docs/launch/show-hn.md`: a title under 80 characters starting "Show HN:", a first comment in the user's voice (what it is, why: the launch story; how: own agent, own machine, own subscription, one server process; what's honest: Claude Code only today, Gemini waiting on Google's sign-in, public repos on the hosted instance, self-host for private ones; the links). Plain, no hype words. The user posts it themselves.
- [ ] **Step 5:** Commit `docs(launch): the Show HN draft`; then the plan's final review (one opus reviewer over the whole branch against the spec, Global Constraints and Review Focus), the fix chunks the user picks, and the rulings and minors written to `docs/superpowers/plans/2026-10-24-plan-3-rulings-and-minors.md`.
