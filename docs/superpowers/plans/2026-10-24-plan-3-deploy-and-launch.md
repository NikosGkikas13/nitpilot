# Plan 3: Deploy and Launch (D1–D5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: D1 and D2 at step level (D2 written 2026-10-24 against `c302c25`, see "Checked against the code (D2)"); D3–D5 at task level.** Written on 2026-10-24 against `main` at `61fbd64` plus the Plan 3 spec decisions in `a0b2e19` on branch `plan-3-deploy-and-launch`. As in Plan 2, each milestone after D1 is written at step level just before it is built, checked against the code at the head at that point, and gets its own "Checked against the code (Dn)" section. Steps marked **(user)** need the user's own accounts and are click-steps for them; steps marked **(say first)** write to something outside this repo (GitHub, npm, GHCR, DNS, the Hetzner box, the Odyhook repo) and are announced, then done only after the user says go.

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
- **First-run mode:** the setup code is printed in the server log at boot and is required by every first-run write; the manifest's `state` is checked on the way back; credentials are stored encrypted with `ENCRYPTION_KEY` in one row; credentials from the environment win and first-run mode never happens then. Everything but the web app, `/first-run`, `/api/first-run/*`, `/first-run/callback` and `/healthz` answers 503 `{ error: 'first_run', message: 'Finish setup at /first-run.' }` in first-run mode.
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

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run it to see it fail**

Run: `node --test 'scripts/*.test.mjs'`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/scripts/check-release-version.mjs' imported from …/scripts/check-release-version.test.mjs`.

- [ ] **Step 3: Implement `scripts/check-release-version.mjs`, then see it pass**

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

- [ ] **Step 4: The workflow, the package metadata, the docs; full suite; commit**

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

- [ ] **Step 5: (user, say first: writes to npm) Claim the npm name**

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

- [ ] **Step 6: (user, say first: changes npm settings) Link the package to the workflow**

Click-steps on npmjs.com, signed in with the same npm account:
1. Open https://www.npmjs.com/package/nitpilot and click the **Settings** tab (top of the package page, next to Readme / Code / Dependents / Versions; only the owner sees it).
2. Find the **Trusted Publisher** section and click the **GitHub Actions** button.
3. Fill in: **Organization or user** `NikosGkikas13`, **Repository** `nitpilot`, **Workflow filename** `release.yml` (just the file name, not the path), **Environment name** left empty. Click **Set up connection**. The section now shows one GitHub Actions publisher for `NikosGkikas13/nitpilot`, `release.yml`.
4. Further down, under **Publishing access**, choose **Require two-factor authentication and disallow tokens** and click **Update Package Settings**. npm asks for 2FA once more; approve. From now on no npm token can publish `nitpilot`; only the workflow (and you, with 2FA) can.

- [ ] **Step 7: (user, say first: writes to GitHub and GHCR) An `-rc` image from this branch**

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

- [ ] **Step 8: Tick Steps 5–7**

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

---

## Milestone D3: Self-hosting

D3 lets a server start with no GitHub App at all and create one itself, and packages that for a team as one Compose folder. It ends with a clean-folder run on the Mac and the git-history secret scan, so the repo can go public at the start of D4.

**Data model (spec §8 gets this row in Task 7):** `GithubAppConfig` — one row (`id = 'app'`): `appId`, `slug`, `clientId`, `privateKeyEnc`, `clientSecretEnc`, `webhookSecretEnc` (AES-256-GCM with `ENCRYPTION_KEY`, `lib/crypto.ts`), `ownerLogin`, `createdAt`.

### Task 7: First-run mode on the server

**Files:**
- Create: `apps/server/src/setup/credentials.ts`, `apps/server/src/setup/first-run.ts` (routes), `apps/server/src/setup/manifest.ts` (pure: build the manifest), `apps/server/src/setup/setup-code.ts`, their tests; a Prisma migration `…_github_app_config`; `docs/why/first-run-and-app-manifests.md`
- Modify: `apps/server/src/lib/env.ts` (the six `GITHUB_*` become optional, all-or-none), `apps/server/src/main.ts` (load credentials → normal mode or first-run mode), `apps/server/src/http/app.ts` (a first-run app), every reader of `env.GITHUB_*` (take a `GithubAppCredentials` instead), `packages/protocol/src/web-api.ts` (first-run bodies), spec §8 and §10

**Interfaces:**
- `type GithubAppCredentials = { appId: string; slug: string; privateKey: string; clientId: string; clientSecret: string; webhookSecret: string }`.
- `loadGithubApp(env: Env): Promise<{ source: 'env' | 'database'; creds: GithubAppCredentials } | null>` — env first (all six set), else the row (decrypted; a row that won't decrypt throws "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with."), else `null`.
- `saveGithubApp(creds, ownerLogin): Promise<void>` — insert only; a second save throws (one app per server).
- `buildManifest({ publicUrl, name, isPublic }): AppManifest` — `url` = publicUrl, `hook_attributes.url` = `<publicUrl>/webhooks/github`, `redirect_url` = `<publicUrl>/first-run/callback`, `callback_urls` = [`<publicUrl>/auth/github/callback`], `setup_url` = `<publicUrl>/github/setup`, `setup_on_update: true`, `public: isPublic`, `request_oauth_on_install: false`, `default_events` and `default_permissions` exactly spec §15's (pull_request, pull_request_review, pull_request_review_comment, pull_request_review_thread, issue_comment, repository; pull_requests write, contents read, issues read, metadata read). Check §15 and the dev app's settings when writing the step.
- `SetupCode`: 8 characters from an alphabet without look-alikes, made at boot in first-run mode, printed as `[first-run] Open <PUBLIC_URL>/first-run and enter the setup code: XXXX-XXXX`; compared in constant time; 5 tries per minute per client address (`clientAddress`, Task 2).
- Routes (first-run app only): `GET /api/first-run` → `{ mode: 'first_run', publicUrl }`; `POST /api/first-run/manifest` `{ code, owner: { kind: 'user' } | { kind: 'org', login }, name, isPublic }` → `{ action: 'https://github.com/settings/apps/new?state=…' | 'https://github.com/organizations/<login>/settings/apps/new?state=…', manifest }` (the page posts it as a form), `state` = 32 random bytes kept in memory 1 hour; `GET /first-run/callback?code&state` → checks `state`, `POST /app-manifests/{code}/conversions` (no auth), `saveGithubApp`, answers a redirect to `/first-run?done=1`, then exits the process 500 ms later (`process.exit(0)`; Docker restarts it). In normal mode `GET /api/first-run` answers `{ mode: 'ready', installUrl: 'https://github.com/apps/<slug>/installations/new' }` and the other two 404.
- Everything else in first-run mode: 503 `{ error: 'first_run', message: 'Finish setup at /first-run.' }`; the SPA's GETs still get `index.html`.

- [ ] Steps (TDD, as D1): tests first for `loadGithubApp` (env wins; half-set env refuses naming the missing variables; row decrypts; wrong key refuses with the message above), `buildManifest` (every field above), `SetupCode` (format; wrong code 403 `{ error: 'setup_code' }`; 6th try in a minute 429), the routes (no code → 403 and nothing stored; wrong/missing `state` → 400 and nothing stored; a conversion answered by the fake GitHub → one row, encrypted columns not equal to the plain values, the exit hook called once; a second callback → 409), the 503 for `/api/me` in first-run mode, and `main.ts` choosing the mode (a small `startServer(env, deps)` seam tested with the fake). Then implement, full suite, `npm run test:e2e`, commit `feat(server): first-run mode: a fresh server creates its own GitHub App`. Write the explainer: what a GitHub App manifest is, why the setup code exists, why the server restarts itself, in React terms (a setup wizard that writes config, then reloads the app).

### Task 8: The first-run page

**Files:**
- Create: `apps/web/src/routes/FirstRun/{FirstRun.tsx,FirstRun.module.css,FirstRun.test.tsx}`, `apps/web/src/api/first-run.ts`, `apps/web/e2e/first-run.spec.ts`
- Modify: `apps/web/src/app.tsx` (route `/first-run`; when `/api/me` answers 503 `first_run`, every route shows a link to `/first-run`), `apps/server/test/e2e/web-server.ts` (a first-run control: start the harness without credentials)

**Interfaces:** consumes Task 7's three routes and bodies. The page, in the handoff's visual system (tokens, Wordmark, one card, no new design): (1) setup code field ("Find it in the server's log: `docker compose logs nitpilot`"); (2) "Create the app on" personal account / organization (login field); app name (default `Nitpilot (<host>)`); "Who can install it" only this account or organization (default) / anyone; (3) "Create GitHub App" submits a real `<form method="post" action={action}>` with a hidden `manifest` field (GitHub requires a form post, not fetch); (4) `?done=1`: "Restarting the server…" polling `/api/first-run` every 2 s until `mode: 'ready'`, then "Install the app on your repos" (the `installUrl`) and "Sign in" buttons. A 403 `setup_code` keeps the form and shows "That code doesn't match the one in the server's log."

- [ ] Steps: component tests first (each state above, the wrong-code message, the form's action and hidden manifest), then a Playwright test against the harness in first-run mode (code → the form posts to the stubbed GitHub URL; `?done=1` → waits, then shows Install). Implement; full suite + `npm run test:web-e2e`; `npm run build -w apps/web` with no chunk warning; in-app browser look at both themes and phone width; commit `feat(web): the first-run page`.

### Task 9: `deploy/self-host/`, the docs, and the clean-folder run

**Files:**
- Create: `deploy/self-host/docker-compose.yml`, `deploy/self-host/Caddyfile`, `deploy/self-host/.env.example`, `docs/self-hosting.md`, `docs/why/reverse-proxy-and-tls.md`, `docs/why/dns-records.md`

**Interfaces:**
- Compose: `nitpilot` (image `ghcr.io/nikosgkikas13/nitpilot:${NITPILOT_VERSION:-latest}`, `init: true`, `restart: unless-stopped`, `env_file: .env`, `DATABASE_URL` built from `POSTGRES_PASSWORD`, `PUBLIC_URL=https://${NITPILOT_DOMAIN}`, `TRUST_PROXY=true`, depends on a healthy Postgres), `postgres` (16-alpine, volume, healthcheck; no published port), `caddy` (2-alpine, ports 80 and 443, `SITE_ADDRESS=${SITE_ADDRESS:-${NITPILOT_DOMAIN}}`, volumes for data/config). Caddyfile: `{$SITE_ADDRESS} { reverse_proxy nitpilot:8787 }`.
- `.env.example`: `NITPILOT_DOMAIN`, `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `ENCRYPTION_KEY` (`openssl rand -base64 32`), optional `SITE_ADDRESS`, `NITPILOT_VERSION`, the VAPID trio (`docker compose run --rm nitpilot npm run vapid:keys -w apps/server`), `CLOSED_CHAT_RETENTION_DAYS`, `ALLOWED_LOGINS`; each with one comment line.
- `docs/self-hosting.md`: what you need (a server with Docker, a domain, a GitHub account or org), the five steps (DNS, `.env`, `docker compose up -d`, `/first-run` with the code from `docker compose logs nitpilot`, install the app + `nitpilot login` with `NITPILOT_SERVER=https://<domain>`), upgrading (`docker compose pull && docker compose up -d`), backups (a `pg_dump` one-liner and why the `.env` must be kept too), private repos work, and the CLI's `"server"` setting.

- [ ] **Step 1:** `docker compose -f deploy/self-host/docker-compose.yml --env-file deploy/self-host/.env.example config` prints a valid config (no missing-variable warnings).
- [ ] **Step 2: The clean-folder run (live; say first).** First the user pushes the branch and a new pre-release tag (`v0.1.0-rc.2`, commands given), because `rc.1` predates first-run mode; the run uses that image. I copy `deploy/self-host/` to `~/Desktop/PracticeProjects/.nitpilot-scratch/selfhost`, fill `.env` (domain = the dev tunnel's host, `SITE_ADDRESS=:80`, fresh secrets, `NITPILOT_VERSION=0.1.0-rc.2`; the image is private until D4, so the user runs `gh auth token | docker login ghcr.io -u NikosGkikas13 --password-stdin` in their own terminal first), start the tunnel to Caddy's port 80 and `docker compose up -d`. Click-steps for the user, in the browser signed in as NikosGkikas13: open the tunnel URL → the first-run page → paste the setup code I read from the log → "Create the app on" personal account, name `Nitpilot selfhost test`, only this account → Create → GitHub's "Create GitHub App" page → Create → back on the page, "Restarting…" then Install → install on `nitpilot-sandbox` only → sign in. Then `NITPILOT_SERVER=<tunnel URL> nitpilot login` with a fresh config dir, `repos add` in the sandbox clone, `start` with the fake agent; ngkdev93-jpg opens a small PR and requests NikosGkikas13's review (click-steps); the review appears on the PR from the test app.
- [ ] **Step 3: (user) Clean up:** delete the `Nitpilot selfhost test` app (github.com → Settings → Developer settings → GitHub Apps → it → Advanced → Delete), `docker compose down -v` in the scratch folder, stop the tunnel.
- [ ] **Step 4:** Write the docs and explainers from what the run showed (with any surprise fixed in code first, TDD); commit `feat(deploy): self-hosting with Compose, verified from a clean folder`.

### Task 10: The secret scan before going public

- [ ] **Step 1:** `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8 git /repo --redact --report-path /repo/.superpowers/gitleaks.json` (pin the exact version tag when the task is written at step level; the report goes in a git-ignored folder). Expected: no findings, or only known test values.
- [ ] **Step 2:** For each finding: a test key or a recorded fixture value → add it to `.gitleaks.toml`'s allowlist with a one-line reason; anything real → stop and tell the user (rotating it and rewriting history is their decision, and the repo stays private until it's settled).
- [ ] **Step 3:** Add a `gitleaks` job to CI (the same image, on every PR, `--redact`), so nothing new slips in after going public. Commit `ci: scan for secrets on every PR`.

---

## Milestone D4: nitpilot.dev

D4 runs Nitpilot for real next to Odyhook. Every step that touches GitHub, the registrar, the box or the Odyhook repo is announced first. It ends with the live acceptance run on nitpilot.dev and the demo recording.

### Task 11: `deploy/hosted/`, the backup script and the runbook

**Files:**
- Create: `deploy/hosted/docker-compose.yml`, `deploy/hosted/.env.example`, `deploy/hosted/nitpilot-backup.sh`, `deploy/hosted/cron`, `docs/hosting.md`, `docs/why/backups-and-restores.md`

**Interfaces:**
- Compose (project name `nitpilot`): one service `nitpilot-server` (`container_name: nitpilot-server`, image `ghcr.io/nikosgkikas13/nitpilot:${NITPILOT_VERSION}`, `init: true`, `restart: unless-stopped`, `env_file: .env`, `mem_limit: 384m`, `pids_limit: 256`, network `hooksmith_default` external, no published ports).
- `.env.example`: every hosted setting from the Global Constraints, `DATABASE_URL=postgresql://nitpilot:<password>@postgres:5432/nitpilot`, no values.
- `nitpilot-backup.sh`: `docker exec` into Odyhook's Postgres container, `pg_dump -U nitpilot nitpilot | gzip` → `rclone copy` to the existing R2 remote under `nitpilot/<UTC date>.sql.gz`; `set -euo pipefail`; logs one line. The step-level text reads the remote's name from the box (`rclone listremotes`) and Odyhook's script, never guessing. `cron`: `30 3 * * * root /usr/local/bin/nitpilot-backup.sh >> /var/log/nitpilot-cron.log 2>&1` (after Odyhook's 03:00).
- `docs/hosting.md`: the box, the folders, deploy a version, logs, restart, the backup and a restore into a scratch database, where the `.env` copy lives (the user's password manager), and what to check after Odyhook's own deploys.

- [ ] Steps: `docker compose -f deploy/hosted/docker-compose.yml config` valid; `shellcheck` (from its Docker image) clean on the script; the docs; commit `feat(deploy): the hosted instance's compose, backups and runbook`.

### Task 12: Going live (ops, every step said first)

- [ ] **Step 1: (user) The repo and the image go public.** Click-steps, signed in as NikosGkikas13: github.com/NikosGkikas13/nitpilot → Settings → General → bottom "Danger Zone" → Change visibility → Make public → type the name → confirm. Then the repo page → right sidebar "Packages" → `nitpilot` → Package settings → bottom "Danger Zone" → Change visibility → Public.
- [ ] **Step 2: Memory check.** `ssh root@157.180.91.106 'docker stats --no-stream; free -m'`. Write the numbers in the task report. If free memory plus what Odyhook's containers really use leaves less than 384 MB, stop and ask.
- [ ] **Step 3: The database.** On the box: create role `nitpilot` with a password made there (`openssl rand -hex 24`, written straight into `/opt/nitpilot/.env`, never echoed) and database `nitpilot` owned by it, inside Odyhook's Postgres container. Check: `psql` as `nitpilot` connects.
- [ ] **Step 4: `/opt/nitpilot`.** If anything changed since the last `rc` (Tasks 10–11), the user pushes the next `rc` tag first; `NITPILOT_VERSION` is that rc. Copy `deploy/hosted/docker-compose.yml` there; build `.env` on the box from `.env.example` with `ENCRYPTION_KEY` and VAPID keys made there (`docker run --rm ghcr.io/nikosgkikas13/nitpilot:<the newest rc> npm run vapid:keys -w apps/server` piped into the file). **(user)** The user runs `cat /opt/nitpilot/.env` in their own terminal and saves it in their password manager.
- [ ] **Step 5: Start it.** `docker compose up -d`; the log shows first-run mode and the setup code; `docker exec nitpilot-server wget -qO- http://127.0.0.1:8787/healthz` answers.
- [ ] **Step 6: (say first) Caddy, through Odyhook's repo.** In `~/Desktop/PracticeProjects/hooksmith` on a new branch `nitpilot-dev-site`: add the `nitpilot.dev` block (`reverse_proxy nitpilot-server:8787`) and `www.nitpilot.dev` → `https://nitpilot.dev{uri}` 301, with a comment saying they belong to Nitpilot. Commit there. The user reviews, merges and pushes it (Odyhook's workflow redeploys Caddy). Check odyhook.dev still answers afterwards.
- [ ] **Step 7: (user) DNS**, done just before Step 6's push lands: at the registrar, for nitpilot.dev, `A @ 157.180.91.106` and `A www 157.180.91.106` (TTL 300, delete any parking records the registrar added). I check with `dig +short nitpilot.dev www.nitpilot.dev` until both answer the IP, then `curl -sI http://nitpilot.dev` (301 to https), `curl -sI https://www.nitpilot.dev` (301 to the apex), and the certificate from `curl -vI https://nitpilot.dev`.
- [ ] **Step 8: (user) The production app.** Signed in as NikosGkikas13: open https://nitpilot.dev/first-run → paste the setup code (I read it from the log) → personal account → name `nitpilot` → "Who can install it": anyone → Create → on GitHub, Create GitHub App → back on the page, Install → install on `nitpilot-sandbox`. Then set the app's logo (github.com → Settings → Developer settings → GitHub Apps → nitpilot → Display information → upload `apps/web/public/icons/icon-512.png`) and its description from the spec's pitch.
- [ ] **Step 9: Backups.** Install the script and cron line; run the script once by hand; `rclone ls` shows today's file; restore it into a scratch database `nitpilot_restore_check` on the same Postgres and count `PrChat` rows; drop the scratch database.
- [ ] **Step 10:** Tick the steps and commit any doc fixes the run taught (`docs(hosting): …`).

### Task 13: The live acceptance run on nitpilot.dev, and the demo

**Files:** Create `docs/acceptance/plan-3.md` (the runbook: setup, each pass criterion from spec §20 item 4 as a checkbox, the click-steps, the SQL checks), reusing `docs/acceptance/` helpers where they fit.

- [ ] **Step 1:** Write the runbook from spec §20 item 4 and commit it.
- [ ] **Step 2: (say first) The single-player run.** NikosGkikas13's CLI (fresh `NITPILOT_CONFIG_DIR`, no `NITPILOT_SERVER`, from this branch's build) logs in to nitpilot.dev, links the sandbox clone and starts with Claude Code; ngkdev93-jpg (not on nitpilot.dev) opens the seeded demo PR and requests NikosGkikas13's review. Check: the job starts within 5 s (server log timestamps), the review lands on the PR in NikosGkikas13's name.
- [ ] **Step 3: The demo recording (user).** Same flow on a fresh seeded PR, recorded with QuickTime following the shot list in spec §20 item 4: what to have open (GitHub PR page signed in as ngkdev93-jpg on the left, the terminal running `nitpilot start` on the right, the nitpilot.dev chat in a second tab), when to start and stop. I trim nothing; the user keeps the file for Task 14.
- [ ] **Step 4: The agent-to-agent run:** ngkdev93-jpg's CLI with the fake agent joins; a PR reaches READY with one `nitpilot[bot]` summary comment.
- [ ] **Step 5: The remaining criteria:** Web Push on desktop Chrome and the iPhone Home Screen app (no callback URL to add); a webhook from a private repo dropped (make a private repo, install the app on it, open a PR, check `RawEvent.status`); `docker compose restart` in `/opt/nitpilot` mid-job and the job completes; the backup holds the database (Task 12 Step 9 counts); `docker stats` after the run under the limit and odyhook.dev answers.
- [ ] **Step 6:** Tick every criterion in `docs/acceptance/plan-3.md` with what was seen; fixes found during the run get their own commits (TDD) before ticking; commit `test(acceptance): the Plan 3 live run on nitpilot.dev`.

---

## Milestone D5: Launch

### Task 14: README, docs pass, demo in the README

**Files:** Modify `README.md` (rewrite), `docs/architecture.md` (deploy: one image, first-run mode, the hosted layout; Chosen / Alternatives / Why), `docs/why/README` index if there is one, `docs/adapters.md` (check it still matches), `apps/cli/package.json` `description` and its own `README.md` (npm shows it).

- [ ] **Step 1:** README order: the one-line pitch; the demo video (the user uploads the MP4 by dragging it into a GitHub issue or the README editor on github.com, which gives a `user-attachments` URL; click-steps) and a GIF fallback (`ffmpeg` from the MP4, under 5 MB, in `docs/media/`); the launch story in three sentences; Install (`npm install -g nitpilot`, `nitpilot login`, install the app, `nitpilot repos add`, `nitpilot start`); "When your teammate is on it too"; How it works (short, links to architecture and `docs/why/`); Self-hosting (link); Security (what the agent can and can't do, the scrub list, a contact line using an address the user picks); Development (the current "Running it locally"); License.
- [ ] **Step 2:** Docs pass: every `docs/why/` file still names files that exist (`grep` each path), architecture covers Plan 3, no "Plan 3 adds…" future tense left anywhere (`grep -rn "Plan 3" README.md docs/*.md docs/why`).
- [ ] **Step 3:** The user reads the README on GitHub (rendered) and says go; commit `docs: the launch README, with the demo`.

### Task 15: v0.1.0, the fresh-install check, and the Show HN draft

- [ ] **Step 1: (say first) Release.** The user pushes the branch's state to `main` (their merge) and the tag `v0.1.0` (commands given). The workflow: image `0.1.0` and `latest` on GHCR; `nitpilot@0.1.0` on npm with the provenance badge (check npmjs.com/package/nitpilot shows "Built and signed on GitHub Actions"). Deprecate the placeholder: the user runs `npm deprecate nitpilot@0.0.0 "Placeholder; use 0.1.0 or later"`.
- [ ] **Step 2:** Deploy `0.1.0` on the box (`NITPILOT_VERSION=0.1.0`, `docker compose pull && docker compose up -d`) and check `/healthz`.
- [ ] **Step 3: The fresh-install check:** in a new folder with a fresh `NITPILOT_CONFIG_DIR`, `npm install -g nitpilot` (from npm, not the repo), `nitpilot --version` = 0.1.0, `nitpilot login` against nitpilot.dev, repeat Task 13 Step 2's single-player run once. Tick spec §20's D5 line in `docs/acceptance/plan-3.md`.
- [ ] **Step 4: The Show HN draft** in `docs/launch/show-hn.md`: a title under 80 characters starting "Show HN:", a first comment in the user's voice (what it is, why: the launch story; how: own agent, own machine, own subscription, one server process; what's honest: Claude Code only today, Gemini waiting on Google's sign-in, public repos on the hosted instance, self-host for private ones; the links). Plain, no hype words. The user posts it themselves.
- [ ] **Step 5:** Commit `docs(launch): the Show HN draft`; then the plan's final review (one opus reviewer over the whole branch against the spec, Global Constraints and Review Focus), the fix chunks the user picks, and the rulings and minors written to `docs/superpowers/plans/2026-10-24-plan-3-rulings-and-minors.md`.
