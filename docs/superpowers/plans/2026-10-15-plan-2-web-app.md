# Plan 2: Web App (W1–W8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: W1, W2 and W3 at step level; W4–W8 at task level.** W3 (Tasks 7–10) was written at step level on 2026-10-16 against the branch at `16ca658`; see "Checked against the code (W3)". W2 (Tasks 4–6) was written at step level on 2026-10-15 against the branch at `b6cf319`; see "Checked against the code (W2)". The task-level plan was written on 2026-10-15 against `main` at `97268c9` (Plans 1a and 1b merged) plus the Plan 2 spec decisions in `6330847` on branch `plan-2-web-app`. W1 (Tasks 1–3) has full TDD steps (test and implementation code, exact commands, expected output), written on 2026-10-15 against the branch at `eebbddd`; "Checked against the code (W1)" below lists where it differs from the task-level text. Each later milestone is written at step level just before it is built, checked against the code at the head at that point, and gets its own "Checked against the code (Wn)" section.

**Goal:** Give Nitpilot its web app: an installable PWA, served by the Nitpilot server, where people see their PR inbox and each PR's chat live, drive the chat (notes, Resolve / Continue, Retry, Review, Auto, drafts) and get Web Push notifications, built pixel-accurately from the Claude Design handoff.

**Architecture:**
- **Web app** (`apps/web`): React + Vite + TypeScript, React Router (library mode), TanStack Query, CSS Modules over one `tokens.css`. Reads go through REST into the query cache; `/ws/web` pushes are written into the same cache (`setQueryData`); every change is a REST call that becomes an engine event. No optimistic updates.
- **Server** (`apps/server`): serves the built app from the same origin with an SPA fallback, adds the web REST endpoints, a second WebSocket hub (`/ws/web`) beside `/ws/cli` behind one upgrade router, chat access rules, five new engine events, publish jobs, server-owned settings, and Web Push as a second notifier with the CLI as fallback.
- **CLI** (`apps/cli`): protocol v2: publish jobs (push an author's draft commit), draft results with a capped diff, settings from the server, `usedToday` in `ping`, and stage changes that skip the progress throttle.

**Tech Stack:** everything from Plans 1a and 1b, plus `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `vite`, `@vitejs/plugin-react`, `@fontsource-variable/bricolage-grotesque`, `@fontsource/fragment-mono`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `eslint-plugin-react-hooks`, `@playwright/test` (Chromium only), and `web-push` on the server. Exact versions are pinned when each milestone is written at step level, checked against npm that day.

**Spec:** `docs/superpowers/specs/2026-10-07-nitpilot-design.md`. Read §6.1, §7, §8, §9 (Auto, Drafts, §9.2, §9.3, §9.4), §10 (protocol v2, `/ws/web`, REST in Plan 2), §11 (draft mode, publish jobs), §13, §14, §16 and §20 (W table, Plan 2 acceptance) before starting. **UI:** `docs/design/handoff/design_handoff_nitpilot_web/README.md` (Turn 3 of the canvas is the spec; §16's two "Fixes for Plan 2" override the mockups). **Builds on:** Plans 1a and 1b, and `docs/superpowers/plans/2026-10-07-plan-1b-rulings-and-minors.md`.

## Global Constraints

Plans 1a and 1b's Global Constraints apply. In addition (values copied from the spec and the handoff):

- **One Node process + Postgres.** The server serves the built web app; no second server, no Redis, no queue. Anything that seems to need more infrastructure: stop and ask (CLAUDE.md).
- **The engine stays pure.** The five new events and `set_apply_state` live in `apps/server/src/engine/` with no database, platform or WebSocket imports, and are table-tested.
- **Shared contract.** Every REST body and every `/ws/web` message is a zod schema in `packages/protocol` (`web-api.ts`, `web-messages.ts`); the web app parses every response and socket message with them.
- **Same origin.** Production: the server serves `apps/web/dist` and answers any GET that isn't `/api`, `/auth`, `/github`, `/webhooks`, `/healthz` or `/ws/*` with `index.html`. Development: Vite on port 5173 proxies `/api`, `/auth`, `/github` and `/ws` (WebSockets included) to port 8787, and `PUBLIC_URL` is `http://localhost:5173`.
- **Every page** is sent with `Content-Security-Policy: frame-ancestors 'none'` (spec §10).
- **Auth.** The session cookie for the web app, the `Bearer nit_…` token for the CLI, on the same `/api` routes where both apply. Every cookie-authenticated write and the `/ws/web` upgrade get the Origin check (`lib/csrf.ts`, §14).
- **Access** (§16): reading or subscribing needs read access to the repo (`RepoAccess`, 5 minutes); a chat that doesn't exist and one you can't see are the same 404; an expired GitHub sign-in is a 401 that says so. Writes also pass `can(viewer, chat, action)`: notes = author and reviewers on Nitpilot; Resolve = only the reviewer who raised the point (GitHub points are resolved on GitHub); Continue = the author or that reviewer; Review = a requested reviewer; Auto, drafts, Retry = only your own.
- **CLI protocol version 2** (§10): `welcome.settings`, the `settings` message, `ping.usedToday`, publish bundles, `JobResult.draft`; `hello.defaults` is gone. Old `auto` / `dailyJobCap` keys in `config.json` are accepted and ignored.
- **Settings** (§8 `User`): `autoReview` true, `autoAddress` true, `dailyJobCap` 40 by default; the Settings stepper moves in steps of 5 between 5 and 200 (handoff §7).
- **Auto off** means the job runs and its result waits as a draft (§6.1). Discard never loops (§9 "Drafts"). Continue at the round limit adds 1 to `PrChat.extraRounds`; the limit is `max_rounds + extraRounds` (§9.3).
- **Draft diff** is capped at 200 KB; over that, `diff` is null and the web app shows the file list and `git show` (§11).
- **Notifications** (§16): Web Push to every subscription first; the CLI's OS notification only when no subscription worked for that notification; the terminal line always. Push sending runs inside the notify task. 404/410 deletes a subscription.
- **Design tokens and rules** (handoff): the exact colors, radii, type scale and spacing of the handoff's tables; red only for escalations, blocker points, − diff and Revoke; failures are amber; every status is a glyph plus a word; `--fg4` never carries essential text; WCAG AA in both themes; `prefers-reduced-motion: reduce` turns off the ping, the spinner and transitions; desktop at ≥760 px (sidebar 360 px, details panel 300 px, auto-hidden below 1180 px), phone below 760 px.
- **Fonts are bundled** (`@fontsource`), never loaded from Google, so the installed PWA calls no third party.
- **Names** come from `BRAND` (CLI command, cookie names, ref namespace), never hard-coded.
- **Copy** comes from the handoff verbatim where it gives copy, and from §16's fixes where they override it: the disabled Auto-switch tooltip names one reason per case; a `Closed` pill sits next to `Merged`.
- **Explainers** (CLAUDE.md): each new backend concept gets a `docs/why/<topic>.md` in the task that first uses it, in React terms, naming the file that uses it.

## Review Focus

Spec-implied conditions no single test naturally covers, most likely first. Each gets a test in the task named.

1. **The browser's socket drops while the agents are writing, then reconnects.** The chat must show every timeline item exactly once, in order: items committed while the server reads the catch-up from the database are neither lost nor doubled, and the client re-subscribes from its own `lastSeq`. → Task 7 (hub: an item committed between subscribe and catch-up arrives once), Task 10 (client: a duplicate and an out-of-order batch merge to one ordered list).
2. **Someone loses access while a tab is open:** removed from the repo, or their GitHub sign-in expired. Within the 5-minute window reads and writes are refused (404, or 401 "sign in again"); an open subscription is re-checked when its cached answer expires and gets `chat.error`; the screen shows the reconnect or not-found state, never a blank page or a stale chat that still accepts clicks. → Task 7 (re-check on expiry), Task 8 (401 vs 404), Task 12 (writes), Task 10 (UI states).
3. **Double clicks and races on actions:** Send pressed twice, two people pressing Resolve, Discard while a publish job is queued, Send on a draft that is no longer waiting, Continue on a point someone just resolved. Exactly one effect; the other request gets a 409 with a plain message, and the button shows it as a toast. → Task 15 (engine ignores the second), Task 12 and Task 16 (routes answer 409).
4. **The laptop that holds an author's draft is offline, re-cloned or gone.** The publish job shows "waiting: offline since…" for that device only (another device of the same person being online doesn't count); a draft ref that is missing or moved fails it `setup_failed`, not retryable; the draft is marked out of date and the chat carries on. → Task 16 (activity and assigner pin the device), Task 17 (CLI refuses a moved ref).
5. **A push subscription goes stale** (site data cleared, permission revoked, the push service answers 410): the row is deleted, and that same notification still reaches the person through the CLI fallback: never zero pings for a person with a CLI online, never two. → Task 19.

## Carry-forwards

From Plan 1b (its rulings and deferred minors) and from Plan 1a's deferred minors (memory "plan-1b-carry-forwards"). Each has a home:

| Item | Where it lands |
|---|---|
| `job.progress` reaches the server and nothing shows it (Plan 2's live status line; ruling 186) | Task 9 (forwarded on `/ws/web`), Task 10 (progress line) |
| Deferred minor (Tasks 7 and 17): the CLI's 2-second progress throttle drops stage changes, so the status line can show a stale stage | Task 9 (a stage change is sent at once) |
| The Retry button (`nitpilot retry` exists; the engine has `retry_requested`; ruling 186) | Task 12 (the route takes the cookie), Task 13 (the button) |
| Deferred minors (Task 6): `status`/Retry treat a write-failed flag like a failed job; two concurrent retries answer `waiting` | Task 12 (`failureKind` decides: a write failure gets "Reconnect GitHub", never Retry; a second retry while one is pending gets 409), Task 13 (the banner) |
| Drafts: `applyState: draft` exists on `Job`, Auto is always on in Plan 1, nothing sends or discards a draft | Tasks 14–18 |
| Human "continue" / Resolve on escalated points | Task 11 (engine), Task 12 (routes), Task 13 (banner) |
| Web Push replacing the CLI's OS notifications | Task 19 (server, CLI fallback), Task 20 (service worker and subscribe) |
| Deferred minors (Task 23): `loadActivity` reads the chat a second time; `ActiveJob.failure` is a loose string; untested route-level 403 and "running beats an earlier queued job" | Task 4 (the inbox reuses the activity for many chats at once) |
| Plan 1a M2: `save.ts` writes every point field, so it can null a thread link | Task 11 (new events change points: save only the fields that changed) |
| Plan 1a M4: no timeout on GitHub calls | Task 8 (web requests now wait on GitHub for access and files; `GithubClient` gets a timeout) |
| Plan 1a M5: user-token refresh race (refresh tokens are single-use) | Task 8 (the web app calls GitHub with the viewer's token while the task runner may refresh it: refreshes run one at a time per user) |
| Plan 1a M6: installation sync reads only 100 repos | Plan 3 (hosting with many repos); not touched here |
| Plan 1a M11: the advisory-lock connection has no error listener | Plan 3 (deploy hardening); not touched here |
| Plan 1a M1 (summary reschedule resets attempts), M3 (a human deleting an agent point's comment counts as our own write), `reuseIfContains` (any author, first 100 items) | Still deferred: no Plan 2 code touches them |
| Final minor: stopping `nitpilot start` mid-job counts a timeout attempt | Still deferred (CLI-only; the web app shows the "waiting" it causes correctly) |
| Plan 1b ruling 185 / Task 5 minors: the rate limiter behind a proxy, a server URL with a path prefix, http for non-local hosts | Plan 3 (deployment) |
| Task 20 (Gemini CLI adapter) | Still on hold. The UI shows whichever agent the CLI reports in `hello` |

## Code facts this plan is built on

Read from `main` at `97268c9`; the step-level text re-checks each one.

- **`CliHub.attach(server)` owns every upgrade** and refuses any path but `/ws/cli` with a 404 (`ws/cli-hub.ts:57,109`). A second hub needs one upgrade router in front of both (Task 7).
- **`CliHub` has no presence events**: connections come and go inside `upgrade`/close handlers with no listener. Task 9 adds `onPresence`.
- **`/api/me` and `/api/chats/:id/retry` accept only the CLI token** (`requireCliToken`, `http/routes/cli.ts`). Task 3 adds `requireUser` (cookie or token).
- **`Dispatcher.onCommit(listener(chatId, effects))`** exists; `DispatchEffects` has `jobsChanged`, `tasksCreated`, `cancelledJobs` and nothing about the timeline. Task 9 adds the new items' seq range.
- **Drafts are half built:** `enqueueJob` sets `applyState: draft` when `autoFor` is false (`engine/jobs.ts:18`), `onJobCompleted` stores a draft, flags `drafts` and notifies (`engine/results.ts:18`), and the CLI keeps an author's draft commit at `refs/nitpilot/drafts/<job>` and reports `push: null` (`apps/cli/src/runner/push.ts:70`). Nothing sends or discards, the result doesn't name the commit, and `advance` only holds *reviewers* with `drafts` (`engine/advance.ts:49`): an author with a waiting draft would get a second address job on the next event (Task 15 fixes it).
- **`Participant.auto` exists, always true; `hello.defaults` is sent and never read** (`apps/cli/src/daemon.ts:298`). The CLI enforces `dailyJobCap` from `config.json` and counts in `state.json` (`daemon.ts:223`).
- **The engine already has `human_note` and `manual_review`** (`engine/lifecycle.ts`), and `withPeople` fills their `userId` (`chats/people.ts`); no route calls them yet.
- **`RepoAccess`** (5-minute cache, bounded map, 401 → `reauth`) and **`loadActivity`/`deriveActivity`** exist for the transcript page (`auth/repo-access.ts`, `chats/activity.ts`).
- **`Notifier`** is one interface with `CliNotifier` behind it (`tasks/notifier.ts`, `tasks/cli-notifier.ts`), called from the notify task (`tasks/handlers/notify.ts`), whose titles already follow the handoff's push copy.
- **Server pages:** `http/pages/{home,approve,transcript,layout}.tsx` with `renderPage` (which adds `frame-ancestors`), served by `/`, `/cli/approve` and `/c/:owner/:repo/:number`.
- **The end-to-end harness** is `apps/server/test/e2e/harness.ts` (`startE2e`, `waitFor`): the real server with `FakePlatform`, Postgres, and real `nitpilot start` daemons on the fake agent.
- **`packages/protocol` exports TypeScript source** (`"exports": { ".": "./src/index.ts" }`) and imports only `zod`, so Vite can consume it as is.
- **CI** (`.github/workflows/ci.yml`) runs typecheck, lint, `npm test` and `npm run test:e2e` against a Postgres service.

## Checked against the code (W1)

W1 was written at step level on 2026-10-15, against branch `plan-2-web-app` at `eebbddd` (main `97268c9` plus the Plan 2 spec and this plan). Its code was built and run in a scratch worktree first (protocol 41 → 43, server 599 → 606 → 615, web 0 → 10 → 22, CLI 293 + 14 skipped unchanged, end to end 5, Playwright 3; typecheck and lint clean), and every code block below was generated from those tested files by a script. The two guards were checked by breaking them: dropping the path check in `spa.ts` fails the traversal test, and letting Vite inline small files fails the Playwright test with the CSP violation. The landing page was looked at in a real browser at 1280 px (light and dark) and 375 px. Where W1 differs from the task-level text, and why:

- **The server's error body is `{ error: { code, message } }`** (`http/errors.ts`), not `{ code, message }`. `ApiError` reads that shape.
- **Unmatched routes are JSON 404s for every method** (`app.notFound`). Hono's default was a plain-text 404, which the web app couldn't parse.
- **The dev proxy also forwards `/c/` and `/cli/`** until Tasks 10 and 23 retire those server pages: with `PUBLIC_URL` on port 5173, `nitpilot login` sends people to `http://localhost:5173/cli/approve`, which must still reach the server.
- **The CSP is a whole policy**, not only `frame-ancestors 'none'`: `default-src 'self'`, `connect-src 'self'` plus the WebSocket origin from `PUBLIC_URL` (Safari doesn't count `ws:` as `'self'`), `img-src` adds GitHub's avatars and `data:`, `style-src` allows inline `style` attributes (React uses them), `font-src 'self'`, `base-uri` and `form-action 'self'`. Vite's asset inlining is off (`assetsInlineLimit: 0`), because an inlined font is a `data:` URL the policy blocks; the Playwright test found it.
- **Server tests never serve a real build:** `testApp` defaults `webDistDir` to a folder that doesn't exist, so the server's tests don't depend on whether `apps/web/dist` was built. A test that serves the app passes its own temporary folder.
- **The home page's two checks change** (Task 2): `auth.db.test.ts`'s "shows who is signed in on the home page" is deleted (Task 3's `me.db.test.ts` replaces it), and `transcript.db.test.ts` checks that `/` *contains* `frame-ancestors 'none'`. `home.tsx` had no tests of its own.
- **`/api/me` moved to `routes/me.ts`** behind `requireUser`, with one answer for both callers (`WebMe`, a superset of `MeResponse`); the CLI's zod parse drops the extra fields, and `cli.db.test.ts`'s exact match becomes `toMatchObject`. A request that sends an `Authorization` header is always treated as a CLI: a wrong token is a 401 even with a valid cookie.
- **No `Button` component yet** (YAGNI): the landing's call to action and the placeholder's Sign out are styled where they are. Task 6 adds shared controls when the inbox needs them. **`ErrorState`** is new: the "one plain error line with Retry" the task-level text asked for.
- **`BRAND.repoUrl`** is new: the landing's Docs and GitHub links are name-bearing strings.
- **The signed-in placeholder keeps Sign out** (a plain form POST to `/auth/logout`, which checks the Origin), because the server home page that had it is gone until Settings (Task 21).
- **Fonts:** `@fontsource-variable/bricolage-grotesque/opsz.css` (weights and the optical-size axis the handoff asks for) and `@fontsource/fragment-mono/400.css`. The families are `'Bricolage Grotesque Variable'` and `'Fragment Mono'`.
- **Playwright's plumbing:** the ports live in `e2e/ports.ts`, because Playwright refuses imports from its config file in tests. `test/test-env.ts` holds the environment both Vitest and the Playwright server use. The harness gets `port` and `webDistDir` options. The control API has only `POST /signin` for now; later tasks add what they need. The Playwright server listens on `127.0.0.1:4319` (control on 4320), and its `PUBLIC_URL` is that origin. CI installs Chromium and uploads traces when a test fails.
- **The live sign-in check moved from Task 2 to Task 3** (Step 12), where there is a sign-in button to click.
- **npm 11.21 holds back install scripts** (it warns about esbuild's); nothing in W1 needs them.

## Checked against the code (W2)

W2 was written at step level on 2026-10-15, against branch `plan-2-web-app` at `b6cf319` (W1 done, plus the CLI's Node 22 WebSocket fix from the first CI run). Its code was built and run in a scratch worktree first, on a database of its own (protocol 43 → 44 → 45, server 621 → 637 → 655, web 28 → 69, CLI 293 + 14 skipped unchanged, end to end 5, Playwright 3 → 4; typecheck and lint clean), and every code block below was generated from those tested files by a script. The inbox was looked at in a real browser at 1280 px and 375 px, light and dark, with six seeded PRs covering every status. Where W2 differs from the task-level text, and why:

- **`inboxStatus` takes `you`** (the reader's login), because "a human turn that is yours is Needs you" can't be decided without it, **and no `closed` flag**: phase `closed` already says it, and `merged` tells Merged from Closed.
- **"A waiting agent beats a working one"** is `deriveActivity`'s rule and already has its test ("shows the agent that waits when another is working"); `inbox-status.test.ts` instead pins "what you have to do beats an agent at work".
- **Counting queries:** `lib/prisma.ts` now emits a `query` event per query and `test/queries.ts` counts them. The tests pin the property (1 chat and 3 or 30 chats take the same number of queries), not an exact count: Prisma sends one query per `include`d relation, so "three queries" would be wrong and brittle. No chats, no queries. New explainer: `docs/why/n-plus-one-queries.md`.
- **`loadActivity` of a chat that is gone answers `none`** instead of throwing, which settles Plan 1b's "chat read twice → 500" minor without touching `transcript.tsx`.
- **Two carry-forward tests pass at once** (running beats an earlier queued job; the transcript's plain 403 is "Nothing here"): they pin behaviour that was right and untested.
- **Prisma 7's `migrate dev` doesn't regenerate the client**, so Task 5 runs `db:generate` after it.
- **Marking read needs a participant, not a GitHub access check** (spec §10 updated in Task 5): it only moves your own cursor. The cursor never passes the chat's newest item, and only moves forward. A plain `upsert` raced (Prisma reads, then inserts) and failed the "two tabs at once" test under the full parallel run; the route creates the row, ignores a unique violation (`isUniqueViolation`), then moves the cursor forward.
- **`loadInboxRow(chatId, userId, …)`** looks the user up itself; Task 9 has participants' user ids. **`InboxRow.url`** is the PR on GitHub; the web app builds its own `/c/…` path (`chatPath`). **`other`** never picks you (an author who also reviews), and its avatar falls back to GitHub's public `avatars.githubusercontent.com/u/<id>`, which the CSP already allows.
- **`needsYou`** is decided on the server (escalated, needs you, or a reviewer's ready); `tabCounts` just counts it, so "ready counts only for reviewer rows" is tested in Task 5.
- **No generic `Popover` or `Banner` component** (YAGNI): the filter popover owns its outside-click handling (`InboxFilter`), the two inbox banners live in `InboxBanners.tsx`, and the chat's banners (Task 10) are a different shape. `searchRows` is part of `filterRows`. **New small parts:** `Ping` (the pill now, the progress line in Task 10), `lib/time.ts` (`rowTime`), `lib/viewport.ts` (`useIsDesktop`), and `defaultTab` (the inbox opens on the tab that needs you).
- **Routes:** `Home` is the layout route: signed out it shows the landing page on any path; signed in it renders `Shell`, whose `<Outlet>` shows the index (`EmptyPane` "Pick a pull request"), `/c/:owner/:repo/:number` (`ChatPlaceholder` until Task 10), `/settings` (`SettingsPlaceholder` with Sign out until Task 21, since W1's signed-in placeholder that had it is gone) and `*`. A full page load of `/c/…` still reaches the server's transcript until Task 10, so the placeholder links to it with a plain `<a>`.
- **The keyboard cursor takes the focus** (the listbox pattern): the screen test found that after clicking a row, `j` then Enter opened the clicked row (the focused button), not the cursor's. Now Enter reaches the cursor's row as a button press, `useInboxKeys` handles Enter only when no button has focus, and the focus ring and the cursor ring are one inset ring. Esc on a phone goes back through `useEscapeBack` in `Shell`, where the inbox isn't mounted.
- **Pill words:** "leo's agent working" uses the login as GitHub spells it ("Your agent working" for yours). Merged and Closed have no glyph (handoff); the glyph-plus-word rule is for live statuses.
- **The landing page's sample pills are `StatusPill`s** (Task 3's deferred minor).
- **Playwright:** the control API gains `POST /pr` (a real `pull_request.opened` webhook), and the signed-in landing test now expects the inbox.

## Checked against the code (W3)

W3 was written at step level on 2026-10-16, against branch `plan-2-web-app` at `16ca658` (W2 done, with its fix rounds). Its code was built and run in a scratch worktree first, on a database of its own (protocol 45 → 48 → 49, server 665 → 686 → 708 → 716 → 700, CLI 293 → 294 passed + 14 skipped, web 73 → 115, end to end 5, Playwright 4 → 5; typecheck and lint clean), and every code block below was generated from those tested files by a script. The chat was looked at in a real browser at 1280 px and 375 px, light and dark, with three seeded chats (waiting, two points; escalated security blocker; one to review), and leo's CLI started and stopped while a chat was open. Where W3 differs from the task-level text, and why:

- **Each task defines the messages it can use.** Task 7's `ServerToWeb` has no `chat.state`: the view it carries is Task 8's `ChatView`, so `chat.state` arrives with it.
- **The catch-up sends every missed item, in `chat.items` messages of at most 200**, not "at most 500, then REST": the client would otherwise need to notice the gap and page forward, and a reconnecting tab rarely misses more than a few items. `chat.error` also has `unavailable` (GitHub didn't answer the access check): the subscription is dropped and the client asks again after 5 s, so a GitHub hiccup doesn't lock anyone out.
- **The REST answer is `{ view, items, hasOlder }`, and `ChatView` carries no items.** `chat.state` resends the view after every change; carrying 200 items in it each time would be wasteful, and the items already arrive in `chat.items`.
- **No `drafts` and no `permissions` in `ChatView` yet, and no `chats/permissions.ts`.** Nothing in W3 can be clicked, so both would be always-empty fields; W4 (Task 12, `can()` and `permissions`) and W5 (drafts) add them with the code that uses them.
- **The server fills `pointNumber` for a person's reply in a point's GitHub thread** (`toTimelineItem`, from `data.threadRootId` and the points' comment ids), so the web app puts the reply in that point's card without knowing GitHub's thread ids.
- **`job.progress` reaches a chat only for the sending CLI owner's own job**, and carries `action` (`reviewing` or `fixing`) so the line can say "leo's agent is reviewing…". Nobody's CLI can put words in someone else's chat.
- **A GitHub call that times out (15 s, M4) is a `GithubError` with status 504**, not "status null": every caller already treats a 5xx as "GitHub is down" (the inbox's and the chat's 502, for one), so none of them needed a new case.
- **M5 was half done:** Plan 1 already shared one in-flight refresh per user, but a call that read the row just before another's refresh committed could still refresh again with the spent token. Refreshes now run under a per-user `KeyedLock`, and whoever gets it reads the row again first. There's no test that fails first: the gap is a race between a read and another request's commit, which no test can make happen on demand.
- **`TtlCache`** (`lib/ttl-cache.ts`) is `RepoAccess`'s bounded, expiring map pulled out, because the file lists need the same thing. `RepoAccess`'s behaviour and tests are unchanged.
- **A new `ErrorCode` `reauth` (401)** for an expired GitHub sign-in, and the inbox uses it too: the web app tells "sign in with GitHub again" from "signed out" by code, not by message text.
- **`AppDeps` gains `platform`** (`PlatformReads`, for `listPrFiles` with the installation token); `testDeps` passes a `FakePlatform`. The file list stops at 300 files and says `truncated`.
- **`makeGithubSignIn`** (`test/db.ts`) is added in Task 7, where the hub's tests first need people with a GitHub sign-in; Tasks 8 and 9 reuse it.
- **No Auto switch in W3**, not even read-only: `ChatView` doesn't carry the viewer's Auto yet, and a switch that can't be used reads as broken. Task 18 adds it with `viewer.auto`.
- **No `Toast` in W3:** nothing can fail on a click yet. Task 13 adds it with the buttons.
- **Fewer files than the task-level list:** the header's round pips and presence, and the timeline's system lines, summaries, messages, progress line and untrusted card are small components inside `ChatHeader.tsx` and `Timeline.tsx`; the severity badge and status glyph are inside `PointCard.tsx`; "Nothing here" is W2's `EmptyPane`. `useCopy` (`lib/clipboard.ts`) is shared by the inbox's offline banner and the chat's command chips. `Avatar` gains the chat's sizes (22, 28, 30), `AgentBadge` a `size` and `decorative` (beside an agent's name it only decorates). `useIsWide` (1180 px) decides whether the details panel fits. `Shell` passes `me` to the pages as the outlet's context, so `Chat` doesn't fetch it again.
- **A message over 64 KB from a browser closes the socket with 1009** (the `ws` library's `maxPayload`), not 1008; one that doesn't parse closes with 1008. A ping every 30 s, so a dead socket goes within 60 s.
- **The look found a stale presence dot.** The task-level text re-sent, on a CLI's connect or disconnect, only the chats where that person's agent had work; a reviewer whose review was done went offline and the open chat still said "online". Task 9 now also re-sends every chat someone has open in which that person takes part (`WebHub.followedChats`, one test), and the spec says so.
- **The first Playwright run found two test-setup gaps.** The pretend GitHub only kept `refs/pull/42/head`, so a CLI couldn't fetch any other PR (`localGithub().addPull`); and the Playwright tests share one database, so the chat test's PR showed up in the inbox test (control `POST /reset`, called before each test that opens PRs).
- **A point card without a snippet** (a GitHub comment on the whole PR) ended right on its last line of text; the handoff only draws cards with one. It keeps the 14 px the snippet's margin gives.
- **Two W2 carry-forwards are in Task 10:** ↑/↓ leave the page beside the inbox alone (the feed's scroll area is focusable, so clicking into it puts focus there; j/k still move the cursor), and the inbox rows' times move on every minute (`useNow`).
- **Deferred to W4 (Task 13): the phone inbox keeping its tab, search and filters when a chat opens.** On a phone the inbox unmounts, and its state lives in `useState`. Keeping it means URL parameters or a context above `Shell`, a choice that fits with the composer's own state; nothing in W3 makes it worse.
- **The spec catches up in each task** (CLAUDE.md: if the code differs, update the spec in the same change): §10's socket messages (`job.progress` with `action`, `inbox.upsert {chatId, rows}`, `chat.error`, the 200-item catch-up) and §16's re-check in Task 7; the chat read's answer, the 300-file list and the 15 s timeout in Task 8; which chats a presence change re-sends, and inbox rows only for readers, in Task 9.
- **Noticed, not changed:** the engine's system line "maya's agent is working on 2 points" is written when the address job is queued, so it says "working" while maya's CLI is offline and the banner says "Waiting for your agent" (Plan 1's text; Task 11 is the next task to touch the engine). `useMarkRead` skips a hidden tab and tries again only when a new item arrives, so a chat opened in a background tab stays unread until then.
- **Launching the look:** the Playwright server (`nitpilot-e2e-web`) uses the same test database as `npm test`, so it must be stopped before the suites run; with it running, the task runner's and the end-to-end tests fail.

## How to work in this repo

- Plans 1a and 1b's "How to work in this repo" apply: Postgres in Docker on port 5433 (`open -a Docker`, then `docker start nitpilot-postgres-1`), `apps/server/.env`, tests use the `nitpilot_test` database.
- Baseline at `97268c9`: `npm test` = protocol 41, CLI 293 passed + 14 skipped, server 599; `npm run test:e2e` = 5; typecheck and lint clean. Each task's step-level text names the counts it ends with.
- Web app: `npm run dev -w apps/web` (Vite on 5173) next to `npm run dev -w apps/server` (8787). Web unit tests run inside `npm test`; Playwright runs with `npm run test:web-e2e` (from Task 3).
- UI tasks are also checked in the in-app browser: both themes, desktop and phone widths, with screenshots in the task report.
- One task per turn, then stop for review. Strict TDD: watch each new test fail, then pass, then run the full suite with `npm test && npm run typecheck && npm run lint` (plus `npm run test:e2e` and `npm run test:web-e2e` when a task touches them).
- Live checks use the dev GitHub App `nitpilot-dev` (credentials in `apps/server/.env`; never print them) and the sandbox `NikosGkikas13/nitpilot-sandbox` (author `ngkdev93-jpg`, reviewer `NikosGkikas13`). Ask before anything writes to GitHub or runs Claude Code. Click-steps name the GitHub account and spell out every move.
- Commit after every task, with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Milestone W1: Skeleton

W1 makes `apps/web` exist and reach the browser two ways: through Vite in development and served by the Nitpilot server in production. It ends with the landing page and GitHub sign-in working, and Playwright running three smoke tests against a real server.

**Files at the end of W1:**
```
apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts
  src/main.tsx, src/app.tsx                 the data cache and the routes
  src/styles/tokens.css, src/styles/global.css
  src/theme.ts                              system | light | dark, remembered in localStorage
  src/api/client.ts                         api.get / api.send with zod parsing, ApiError, retryUnlessClientError
  src/api/me.ts                             useMe (null = signed out)
  src/components/{Wordmark,ThemeToggle,ErrorState}/…
  src/routes/{Landing,Home}/…               Home = Landing when signed out, a placeholder when signed in
  src/test/setup.ts
  e2e/{ports.ts,control.ts,landing.spec.ts}
apps/server/
  src/http/spa.ts                           the built app's files, the SPA fallback, the CSP
  src/auth/request-user.ts                  requireUser (cookie or CLI token), requireSameOrigin
  src/http/routes/me.ts                     GET /api/me for the browser and the CLI (moved out of routes/cli.ts)
  test/test-env.ts                          the environment every test run uses
  test/e2e/web-server.ts                    the harness on a fixed port, serving apps/web/dist, plus a test-only control API
  (deleted) src/http/pages/home.tsx
packages/protocol/src/web-api.ts            WebMe; BRAND.repoUrl
docs/why/serving-a-spa.md
```

Package versions (checked against npm on 2026-10-15): `react` and `react-dom` 19.3.1, `react-router` 8.4.0, `@tanstack/react-query` 5.104.3, `vite` 8.3.3 (the one Vitest already brings), `@vitejs/plugin-react` 6.1.2, `jsdom` 30.1.3, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.8, `@testing-library/jest-dom` 7.0.1, `@types/react` and `@types/react-dom` 19.3.0, `@fontsource-variable/bricolage-grotesque` and `@fontsource/fragment-mono` 5.3.0, `eslint-plugin-react-hooks` 7.1.1, `globals` 17.13.0, `@playwright/test` 1.64.1 (Chromium only). Vitest stays on 4.1.11, which accepts Vite 8.

### Task 1: `apps/web` skeleton: Vite, React, router, tokens, theme

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/test/setup.ts`, `apps/web/src/theme.ts` and `theme.test.ts`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/global.css`, `apps/web/src/components/Wordmark/{Wordmark.tsx,Wordmark.module.css,Wordmark.test.tsx}`, `apps/web/src/components/ThemeToggle/{ThemeToggle.tsx,ThemeToggle.module.css,ThemeToggle.test.tsx}`, `apps/web/src/app.tsx`, `apps/web/src/main.tsx`.
- Modify: root `package.json` (a `build` script; `eslint-plugin-react-hooks` and `globals` as dev dependencies), `package-lock.json`, `eslint.config.mjs`.

**Interfaces:**
- Produces: `type ThemeChoice = 'system' | 'light' | 'dark'`, `THEME_KEY`, `readTheme(store?)`, `writeTheme(choice, store?)`, `applyTheme(choice, root?)`, `systemPrefersDark()`, `shownTheme(choice, systemDark)` (`src/theme.ts`); `<Wordmark size?: 19 | 22 | 26 />`; `<ThemeToggle />`; `makeQueryClient()` and `<App queryClient? />` (`src/app.tsx`). `tokens.css` defines every handoff token as a CSS variable, plus `--font-sans`, `--font-mono`, the radii and the shadows.

- [x] **Step 1: The package**

Create `apps/web/package.json`:

```json
{
  "name": "@nitpilot/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@fontsource-variable/bricolage-grotesque": "^5.3.0",
    "@fontsource/fragment-mono": "^5.3.0",
    "@nitpilot/protocol": "*",
    "@tanstack/react-query": "^5.104.3",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "react-router": "^8.4.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.2",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.8",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "jsdom": "^30.1.3",
    "vite": "^8.3.3"
  }
}
```

Then install it, and the two lint packages at the root:

```bash
npm install --no-audit --no-fund
npm install -D --no-audit --no-fund eslint-plugin-react-hooks@^7.1.1 globals@^17.13.0
```

Expected: both finish without errors (npm 11 may warn that it held back esbuild's install script; nothing here needs it). `git status` shows `apps/web/package.json`, `package.json` and `package-lock.json`.

- [x] **Step 2: TypeScript, Vite and the test setup**

Create `apps/web/tsconfig.json` (the browser's types instead of Node's; Task 3 adds Playwright's files):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `apps/web/vite.config.ts`. The proxy is what makes development one origin (docs/why/serving-a-spa.md, Task 2). Two server-rendered pages are proxied too, until Tasks 10 and 23 replace them: with `PUBLIC_URL` on port 5173, `nitpilot login` sends people to `http://localhost:5173/cli/approve`, which must still reach the server. No asset is inlined as a `data:` URL, because Task 2's Content-Security-Policy only allows the app's own files (Task 3's Playwright test catches an inlined font):

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Where `npm run dev -w apps/server` listens. Vite forwards the server's paths there, so the browser sees one origin. */
const SERVER = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  build: {
    // Never inline files as data: URLs: the server's Content-Security-Policy only allows our own files
    // (apps/server/src/http/spa.ts), so an inlined font would be blocked.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': SERVER,
      '/auth': SERVER,
      '/github': SERVER,
      '/ws': { target: SERVER, ws: true },
      // Still rendered by the server: the transcript until Task 10, device approval until Task 23.
      '/c/': SERVER,
      '/cli/': SERVER,
    },
  },
  test: {
    environment: 'jsdom',
    // Only the unit tests: e2e/*.spec.ts are Playwright's (npm run test:e2e).
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#16707f" />
    <title>Nitpilot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/web/src/test/setup.ts`:

```ts
// Adds matchers such as toBeInTheDocument() to Vitest's expect.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Each test starts with an empty page.
afterEach(() => cleanup());
```

- [x] **Step 3: Write the failing tests**

Create `apps/web/src/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyTheme, readTheme, shownTheme, THEME_KEY, writeTheme } from './theme';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  };
}

describe('theme', () => {
  it('reads a saved choice, and anything else as "system"', () => {
    expect(readTheme(memory({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readTheme(memory({ [THEME_KEY]: 'purple' }))).toBe('system');
    expect(readTheme(memory())).toBe('system');
    expect(readTheme(null)).toBe('system');
  });

  it('falls back to "system" when storage throws', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); } };
    expect(readTheme(broken)).toBe('system');
  });

  it('remembers light and dark, and forgets "system"', () => {
    const store = memory();
    writeTheme('dark', store);
    expect(store.items.get(THEME_KEY)).toBe('dark');
    writeTheme('system', store);
    expect(store.items.has(THEME_KEY)).toBe(false);
  });

  it('does not throw when storage refuses to save', () => {
    const full = { setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    expect(() => writeTheme('light', full)).not.toThrow();
  });

  it('sets data-theme for light and dark, and removes it for system', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('works out the theme on screen', () => {
    expect(shownTheme('system', true)).toBe('dark');
    expect(shownTheme('system', false)).toBe('light');
    expect(shownTheme('light', true)).toBe('light');
  });
});
```

Create `apps/web/src/components/Wordmark/Wordmark.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('is announced as the product name, not as its letters', () => {
    render(<Wordmark />);
    expect(screen.getByRole('img', { name: 'Nitpilot' })).toBeInTheDocument();
  });

  it('draws the name with a dotless i', () => {
    const { container } = render(<Wordmark size={22} />);
    expect(container.textContent).toBe('nıtpilot');
  });
});
```

Create `apps/web/src/components/ThemeToggle/ThemeToggle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_KEY } from '../../theme';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
  it('switches to the opposite of what is on screen and remembers it', async () => {
    // jsdom has no matchMedia, so "system" shows light here.
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('starts from the remembered choice', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});
```

- [x] **Step 4: Run them to see them fail**

Run: `npm test -w apps/web`
Expected: 3 failed suites, starting with `Error: Failed to resolve import "./theme" from "apps/web/src/theme.test.ts". Does the file exist?`

- [x] **Step 5: The tokens, the global styles and the theme**

Create `apps/web/src/styles/tokens.css` (every value from the handoff's color table; dark applies when the system is dark and the toggle didn't choose light, or when the toggle chose dark):

```css
/*
 * Design tokens from the Claude Design handoff (docs/design/handoff/design_handoff_nitpilot_web/README.md).
 * Light is the default. Dark follows the system unless the theme toggle chose light, or applies when it chose dark.
 */
:root {
  --font-sans: 'Bricolage Grotesque Variable', system-ui, sans-serif;
  --font-mono: 'Fragment Mono', ui-monospace, monospace;

  --bg: #eef2ee;
  --side: #f7f9f6;
  --surface: #ffffff;
  --muted: #e8ede7;
  --hover: #eef2ed;
  --sel: #e6ece6;
  --fg1: #16201b;
  --fg2: #44514a;
  --fg3: #5f6c65;
  --fg4: #9aa59f;
  --b1: #dfe6df;
  --b2: #edf1ec;
  --acc: #16707f;
  --on-acc: #ffffff;
  --acc-tint: #e0f0f2;
  --acc-text: #0f6170;
  --acc-line: #b7dbe0;
  --bubble: #dcefef;
  --hl: #e0f0f2;
  --code: #f7f9f6;
  --ok: #2f9e5b;
  --ok-fg: #1f7444;
  --ok-tint: #e3f3e8;
  --warn: #e09a1a;
  --warn-fg: #93600a;
  --warn-tint: #fbf0d9;
  --red: #d6453a;
  --red-fg: #b3322a;
  --red-tint: #fbe9e6;
  --red-line: #f1c6c0;

  --radius-card: 16px;
  --radius-control: 12px;
  --radius-input: 18px;
  --radius-pill: 999px;
  --shadow-card: 0 1px 2px rgba(16, 32, 24, 0.05), 0 6px 20px rgba(16, 32, 24, 0.06);
  --shadow-popover: 0 8px 24px rgba(0, 0, 0, 0.12);
  --shadow-toast: 0 6px 20px rgba(0, 0, 0, 0.18);

  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0f1412;
    --side: #121815;
    --surface: #18201c;
    --muted: #222b26;
    --hover: #1c2420;
    --sel: #202925;
    --fg1: #e8efea;
    --fg2: #bfcac3;
    --fg3: #93a198;
    --fg4: #5f6c65;
    --b1: #2b3630;
    --b2: #1f2823;
    --acc: #5cc3d1;
    --on-acc: #06191c;
    --acc-tint: #13292c;
    --acc-text: #86d6e1;
    --acc-line: #245055;
    --bubble: #13292c;
    --hl: #13292c;
    --code: #121815;
    --ok: #3fbf74;
    --ok-fg: #62d293;
    --ok-tint: #13261b;
    --warn: #efaa34;
    --warn-fg: #f3bf62;
    --warn-tint: #2a2213;
    --red: #ef5e52;
    --red-fg: #ff8579;
    --red-tint: #2b1715;
    --red-line: #5a2a25;
    --shadow-card: none;
    color-scheme: dark;
  }
}

:root[data-theme='dark'] {
  --bg: #0f1412;
  --side: #121815;
  --surface: #18201c;
  --muted: #222b26;
  --hover: #1c2420;
  --sel: #202925;
  --fg1: #e8efea;
  --fg2: #bfcac3;
  --fg3: #93a198;
  --fg4: #5f6c65;
  --b1: #2b3630;
  --b2: #1f2823;
  --acc: #5cc3d1;
  --on-acc: #06191c;
  --acc-tint: #13292c;
  --acc-text: #86d6e1;
  --acc-line: #245055;
  --bubble: #13292c;
  --hl: #13292c;
  --code: #121815;
  --ok: #3fbf74;
  --ok-fg: #62d293;
  --ok-tint: #13261b;
  --warn: #efaa34;
  --warn-fg: #f3bf62;
  --warn-tint: #2a2213;
  --red: #ef5e52;
  --red-fg: #ff8579;
  --red-tint: #2b1715;
  --red-line: #5a2a25;
  --shadow-card: none;
  color-scheme: dark;
}
```

Create `apps/web/src/styles/global.css`:

```css
@import './tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg1);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

button,
input,
textarea {
  font: inherit;
  color: inherit;
}

code,
kbd,
pre,
samp {
  font-family: var(--font-mono);
}

/* Every interactive element gets the same keyboard focus ring (handoff: "Focus"). */
:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 2px;
}

/* The handoff: reduced motion turns off the ping, the spinner and every transition. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

Create `apps/web/src/theme.ts`:

```ts
import { BRAND } from '@nitpilot/protocol';

/** What the person picked. `system` follows the operating system's light or dark setting. */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = `${BRAND.cli}.theme`;

/**
 * localStorage can be missing or throw (a private window, blocked site data), so every use is
 * wrapped: without it, the theme just follows the system.
 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readTheme(store: Pick<Storage, 'getItem'> | null = storage()): ThemeChoice {
  try {
    const saved = store?.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function writeTheme(choice: ThemeChoice, store: Pick<Storage, 'setItem' | 'removeItem'> | null = storage()): void {
  try {
    if (choice === 'system') store?.removeItem(THEME_KEY);
    else store?.setItem(THEME_KEY, choice);
  } catch {
    // Not remembered; the choice still applies until the page reloads.
  }
}

/** tokens.css reads `data-theme` on <html>: none means "follow the system". */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme on screen right now. */
export function shownTheme(choice: ThemeChoice, systemDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}
```

- [x] **Step 6: The wordmark and the theme toggle**

Create `apps/web/src/components/Wordmark/Wordmark.module.css`:

```css
.wordmark {
  display: inline-flex;
  align-items: baseline;
  font-family: var(--font-mono);
  font-weight: 400;
  line-height: 1;
  color: var(--fg1);
  white-space: nowrap;
}

/* The dotless ı carries the mark: a teal diamond in place of the dot. */
.dot {
  position: relative;
}

.diamond {
  position: absolute;
  left: 50%;
  top: -0.02em;
  width: 0.26em;
  height: 0.26em;
  background: var(--acc);
  transform: translateX(-50%) rotate(45deg);
}
```

Create `apps/web/src/components/Wordmark/Wordmark.tsx`:

```tsx
import { BRAND } from '@nitpilot/protocol';
import styles from './Wordmark.module.css';

// The wordmark is the CLI name with its first "i" drawn as a dotless ı under a teal diamond.
const SPLIT = BRAND.cli.indexOf('i');
const BEFORE = BRAND.cli.slice(0, SPLIT);
const AFTER = BRAND.cli.slice(SPLIT + 1);

/** `nıtpilot` in Fragment Mono with the teal diamond (handoff: "Mark"). 19 px in the sidebar, 22 on the landing nav, 26 on the splash. */
export function Wordmark({ size = 19 }: { size?: 19 | 22 | 26 }) {
  return (
    <span className={styles.wordmark} style={{ fontSize: size }} role="img" aria-label={BRAND.name}>
      <span aria-hidden="true">
        {BEFORE}
        <span className={styles.dot}>
          ı<span className={styles.diamond} />
        </span>
        {AFTER}
      </span>
    </span>
  );
}
```

Create `apps/web/src/components/ThemeToggle/ThemeToggle.module.css`:

```css
.toggle {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg2);
  cursor: pointer;
}

.toggle:hover {
  background: var(--hover);
}
```

Create `apps/web/src/components/ThemeToggle/ThemeToggle.tsx`:

```tsx
import { useState } from 'react';
import { applyTheme, readTheme, shownTheme, systemPrefersDark, writeTheme, type ThemeChoice } from '../../theme';
import styles from './ThemeToggle.module.css';

/** Switches between light and dark, starting from whatever is on screen, and remembers the choice. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme());
  const shown = shownTheme(choice, systemPrefersDark());
  const next = shown === 'dark' ? 'light' : 'dark';

  function toggle() {
    writeTheme(next);
    applyTheme(next);
    setChoice(next);
  }

  return (
    <button type="button" className={styles.toggle} aria-label={`Switch to ${next} theme`} onClick={toggle}>
      {shown === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" strokeLinejoin="round" />
    </svg>
  );
}
```

- [x] **Step 7: Run the tests to see them pass**

Run: `npm test -w apps/web`
Expected: `Test Files  3 passed (3)`, `Tests  10 passed (10)`.

- [x] **Step 8: The app, its entry point, lint and the build**

Create `apps/web/src/app.tsx` (a placeholder route; Task 3 replaces it):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ThemeToggle } from './components/ThemeToggle/ThemeToggle';
import { Wordmark } from './components/Wordmark/Wordmark';

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
}

/** The whole app: data cache, then routes. Task 3 replaces the placeholder with the landing page and the inbox. */
export function App({ queryClient = makeQueryClient() }: { queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Placeholder />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function Placeholder() {
  return (
    <main style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Wordmark />
      <ThemeToggle />
    </main>
  );
}
```

Create `apps/web/src/main.tsx` (the fonts come from the `@fontsource` packages: the variable Bricolage Grotesque with its optical-size axis, and Fragment Mono 400):

```tsx
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/fragment-mono/400.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { applyTheme, readTheme } from './theme';

// Before the first paint, so a dark choice never flashes light.
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

In `eslint.config.mjs`, add the two imports after `import js from '@eslint/js';`:

```js
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
```

and this block right after `...tseslint.configs.recommended,`:

```js
  {
    // The web app runs in the browser, and its components follow React's rules of hooks.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat['recommended-latest'],
  },
```

In the root `package.json`, add `"build": "npm run build -w apps/web"` as the first script. (`dist/` is already in `.gitignore`.)

Run: `npm run build && npm run typecheck && npm run lint`
Expected: Vite prints `✓ built in …` with `dist/index.html`, the fonts under `dist/assets/` as `.woff2` files, and one CSS and one JS file; typecheck and lint print no errors.

- [x] **Step 9: Look at it**

Run `npm run dev -w apps/web` and open `http://localhost:5173`. Expected: the wordmark `nıtpilot` in Fragment Mono with the teal diamond over the ı, and the 32 px theme button; clicking it switches light ↔ dark (background `#eef2ee` ↔ `#0f1412`), and a reload keeps the choice. Take a screenshot of each theme for the task report. Stop Vite.

- [x] **Step 10: The whole suite, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: protocol 41, CLI 293 passed + 14 skipped, server 599, web 10; typecheck and lint clean.

```bash
git add apps/web package.json package-lock.json eslint.config.mjs docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(web): apps/web skeleton with the design tokens, theme and wordmark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The server serves the web app (SPA fallback, CSP, dev setup)

**Files:**
- Create: `apps/server/src/http/spa.ts`, `apps/server/src/http/spa.test.ts`, `docs/why/serving-a-spa.md`.
- Modify: `apps/server/src/http/app.ts` (mount the app last, a JSON 404 for everything else, no `/` home route), `apps/server/src/lib/env.ts` (`WEB_DIST_DIR`), `apps/server/test/app.ts` (tests never use a real build), `apps/server/src/http/routes/auth.db.test.ts` and `transcript.db.test.ts` (the home page's two checks), `apps/server/.env.example`, `.github/workflows/ci.yml`.
- Delete: `apps/server/src/http/pages/home.tsx` (no tests of its own; the landing page is the web app's from Task 3).

**Interfaces:**
- Consumes: `errorBody` (`http/errors.ts`), `getEnv`.
- Produces: `spaRoutes(opts: { distDir: string; publicUrl: string }): Hono`, `contentSecurityPolicy(publicUrl): string`, `DEFAULT_WEB_DIST`, `BUILD_HINT` (`http/spa.ts`); `AppDeps.webDistDir?: string`; `Env.WEB_DIST_DIR?: string`. Every unmatched route answers `404 { error: { code: 'not_found', message: 'no such route' } }`.

- [x] **Step 1: Tests never serve a real build**

In `apps/server/test/app.ts`, add to the object `testDeps` returns, after the `clis` line:

```ts
    // No web app build, whatever is in apps/web/dist: a test that serves the app passes its own folder.
    webDistDir: '/nonexistent/nitpilot-web-dist',
```

- [x] **Step 2: Write the failing test**

Create `apps/server/src/http/spa.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/app';
import { BUILD_HINT } from './spa';

// A pretend build: dist/ with an index, a hashed asset and a service worker, and a secret next to it.
let outer: string;
let dist: string;

beforeAll(() => {
  outer = mkdtempSync(path.join(tmpdir(), 'nitpilot-spa-'));
  dist = path.join(outer, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("push", () => {})');
  writeFileSync(path.join(outer, 'secret.txt'), 'TOP-SECRET');
});

afterAll(() => rmSync(outer, { recursive: true, force: true }));

describe('serving the web app', () => {
  it('answers an app route with index.html, the CSP and no-cache', async () => {
    const res = await testApp({ webDistDir: dist }).request('/inbox/whatever');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>app</title>');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers / with the app', async () => {
    const res = await testApp({ webDistDir: dist }).request('/');
    expect(await res.text()).toContain('<title>app</title>');
  });

  it('serves a hashed asset with a long cache, and other files with no-cache', async () => {
    const app = testApp({ webDistDir: dist });
    const asset = await app.request('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const sw = await app.request('/sw.js');
    expect(await sw.text()).toContain('push');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('keeps unknown server paths as JSON 404s', async () => {
    const app = testApp({ webDistDir: dist });
    for (const url of ['/api/nope', '/auth/nope', '/webhooks/nope']) {
      const res = await app.request(url);
      expect(res.status, url).toBe(404);
      expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'no such route' } });
    }
  });

  it('answers only GETs with the app', async () => {
    const res = await testApp({ webDistDir: dist }).request('/inbox', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('leaves the health check alone', async () => {
    const res = await testApp({ webDistDir: dist }).request('/healthz');
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('never serves a file outside dist, however the path is spelled', async () => {
    const app = testApp({ webDistDir: dist });
    for (const url of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/%252e%252e/%252e%252e/secret.txt']) {
      const res = await app.request(url);
      expect(await res.text(), url).not.toContain('TOP-SECRET');
    }
  });

  it('says how to build the app when there is no build', async () => {
    const res = await testApp({ webDistDir: path.join(outer, 'missing') }).request('/inbox');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(BUILD_HINT);
  });
});
```

- [x] **Step 3: Run it to see it fail**

Run: `npm run test:unit -w apps/server -- src/http/spa.test.ts`
Expected: FAIL, `Error: Cannot find module './spa'`.

- [x] **Step 4: Serve the app**

Create `apps/server/src/http/spa.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

/** apps/web/dist, next to this package. WEB_DIST_DIR overrides it (the Playwright server, a container). */
export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

/** Paths the server answers itself. A miss under them is a JSON 404, never the web app's page. */
const SERVER_PREFIXES = ['/api/', '/auth/', '/github/', '/webhooks/', '/ws/'];
const SERVER_PATHS = new Set(['/api', '/auth', '/github', '/webhooks', '/ws', '/healthz']);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

export const BUILD_HINT = "The web app isn't built. Run `npm run build -w apps/web`, then restart the server.";

/**
 * What the browser may load, for every page and file the web app is served with. `frame-ancestors 'none'`
 * keeps other sites from framing it (spec §10). Styles allow inline `style` attributes, which React uses.
 */
export function contentSecurityPolicy(publicUrl: string): string {
  const url = new URL(publicUrl);
  const socket = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
  return [
    "default-src 'self'",
    `connect-src 'self' ${socket}`,
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function isServerPath(pathname: string): boolean {
  return SERVER_PATHS.has(pathname) || SERVER_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** The file a URL path names inside `root`, or null when there's none (or the path tries to leave `root`). */
async function fileIn(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  if (relative === '') return null;
  const full = path.resolve(root, relative);
  // `..` in any spelling ends up outside root after resolve(): refuse it.
  if (!full.startsWith(root + path.sep)) return null;
  const info = await stat(full).catch(() => null);
  return info?.isFile() ? full : null;
}

/**
 * Serves the built web app (spec §7): its files, and its index.html for every other GET that isn't one of
 * the server's own paths, so a link like /c/octo/sandbox/42 opens the app, which then shows that chat.
 * Mounted after every other route. See docs/why/serving-a-spa.md.
 */
export function spaRoutes(opts: { distDir: string; publicUrl: string }): Hono {
  const app = new Hono();
  const root = path.resolve(opts.distDir);
  const csp = contentSecurityPolicy(opts.publicUrl);

  app.get('*', async (c, next) => {
    if (isServerPath(c.req.path)) return next();
    c.header('Content-Security-Policy', csp);

    const file = await fileIn(root, c.req.path);
    if (file) {
      // Vite puts a content hash in every name under assets/, so those never change; the rest must be re-checked.
      const hashed = file.startsWith(path.join(root, 'assets') + path.sep);
      c.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      c.header('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      return c.body(await readFile(file));
    }

    const index = await readFile(path.join(root, 'index.html')).catch(() => null);
    if (!index) return c.text(BUILD_HINT, 503);
    c.header('Cache-Control', 'no-cache');
    return c.html(index.toString('utf8'));
  });

  return app;
}
```

In `apps/server/src/lib/env.ts`, add before `PUBLIC_REPOS_ONLY`:

```ts
  /** Where the built web app is (apps/web/dist by default; see http/spa.ts). */
  WEB_DIST_DIR: z.string().min(1).optional(),
```

Replace `apps/server/src/http/app.ts` with (the home page route and its imports go; the app is mounted last, and anything still unmatched is a JSON 404):

```ts
import type { HealthResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import type { LiveClis } from '../chats/activity';
import type { Dispatch } from '../chats/dispatch';
import type { Ingest } from '../ingest/process';
import { getEnv } from '../lib/env';
import type { AppAuth } from '../platform/github/app-auth';
import type { GithubClient } from '../platform/github/client';
import { SERVER_VERSION } from '../version';
import { errorBody, onError } from './errors';
import { authRoutes } from './routes/auth';
import { cliRoutes } from './routes/cli';
import { cliApproveRoutes } from './routes/cli-approve';
import { setupRoutes } from './routes/setup';
import { transcriptRoutes } from './routes/transcript';
import { webhookRoutes } from './routes/webhooks';
import { DEFAULT_WEB_DIST, spaRoutes } from './spa';

/** What the HTTP layer needs from outside. Tests pass fakes. Later tasks add fields. */
export type AppDeps = {
  github: GithubClient;
  appAuth: AppAuth;
  ingest: Ingest;
  dispatch: Dispatch;
  clis: LiveClis;
  /** The built web app (apps/web/dist). Tests pass a folder of their own. */
  webDistDir?: string;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true, version: SERVER_VERSION };
    return c.json(body);
  });
  app.route('/', authRoutes(deps));
  app.route('/', cliRoutes(deps));
  app.route('/', cliApproveRoutes());
  app.route('/', setupRoutes(deps));
  app.route('/', transcriptRoutes(deps));
  app.route('/', webhookRoutes(deps));
  // Last: everything else is the web app's (spec §7).
  const env = getEnv();
  app.route('/', spaRoutes({ distDir: deps.webDistDir ?? env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST, publicUrl: env.PUBLIC_URL }));
  app.notFound((c) => c.json(errorBody('not_found', 'no such route'), 404));
  return app;
}
```

Delete the old home page: `git rm apps/server/src/http/pages/home.tsx`.

- [x] **Step 5: Run the test to see it pass**

Run: `npm run test:unit -w apps/server -- src/http/spa.test.ts`
Expected: `Tests  8 passed (8)`.

- [x] **Step 6: Prove the path check matters**

In `spa.ts`, delete the line `  if (!full.startsWith(root + path.sep)) return null;` and run the test again.
Expected: 1 failed, `× never serves a file outside dist, however the path is spelled`. Put the line back (`git diff apps/server/src/http/spa.ts` shows nothing beyond Step 4's file) and run it again: 8 passed.

- [x] **Step 7: The home page's two checks**

Run: `npm test -w apps/server`
Expected: 2 failed: `auth.db.test.ts > GitHub sign-in > shows who is signed in on the home page` (the page is gone) and `transcript.db.test.ts > … frame-ancestors …` (`/` now carries the web app's whole policy).

In `apps/server/src/http/routes/auth.db.test.ts`, delete the test `it('shows who is signed in on the home page', …)` (Task 3's `me.db.test.ts` checks who is signed in). In `apps/server/src/http/routes/transcript.db.test.ts`, replace its last assertion with:

```ts
    // The web app's pages say the same (http/spa.ts).
    expect((await testApp().request('/')).headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
```

Run: `npm test -w apps/server`
Expected: `Tests  606 passed (606)`.

- [x] **Step 8: The explainer, the example environment and CI**

Create `docs/why/serving-a-spa.md`:

```markdown
# Serving the web app from the API server

**In one sentence:** the Nitpilot server hands out the built React app itself, from the same address as its API, and answers every app URL it doesn't know with the app's `index.html` (spec §7, `apps/server/src/http/spa.ts`).

## What a "build" is

`npm run build -w apps/web` turns the React code into plain files in `apps/web/dist`: one `index.html`, and JavaScript, CSS and fonts under `assets/`. A browser needs nothing else. Something has to send those files when the browser asks, and in Nitpilot that something is the server that already runs the API, so there is still one process to deploy.

## Why the same address (origin) matters

An origin is scheme + host + port: `https://nitpilot.dev` and `https://api.nitpilot.dev` are two origins; so are `localhost:5173` and `localhost:8787`.

- **The sign-in cookie just works.** The browser sends a site's cookie with requests to that same origin. With the app and the API on one origin, every `fetch('/api/…')` carries the session, with no cross-site cookie settings.
- **No CORS.** A page may call another origin only if that origin says so in special headers (CORS). On one origin there's nothing to allow, so nothing to get wrong.

## The fallback: why every app URL gets `index.html`

The app has its own routes (`/`, `/c/octo/sandbox/42`, `/settings`), but there is no file called `c/octo/sandbox/42`. React Router reads the address bar once the app loads. So for any GET the server doesn't know, it sends `index.html`, the app starts, and the router shows the right screen. That is why a link in a GitHub summary comment opens the chat directly.

Two rules keep the fallback honest:

- **The server's own paths never fall back.** A typo under `/api/…`, `/auth/…`, `/github/…`, `/webhooks/…` or `/ws/…` gets a JSON 404. Otherwise a broken API call would get a 200 with a web page in it, and the app would choke on it in a confusing way.
- **Files come only from `dist`.** A path such as `/..%2f..%2f.env` is resolved and refused if it would leave the folder, however it's spelled.

## Caching

Vite puts a content hash in every file name under `assets/` (`index-Dywsqop4.js`): a new build means a new name. So those are cached for a year. `index.html`, the service worker and the manifest keep their names across builds, so the browser must check them every time (`no-cache`), or an old `index.html` would point at files that no longer exist.

## In development

You run two things: the API server on port 8787 and Vite on port 5173, which rebuilds as you type. Vite **proxies** the server's paths (`/api`, `/auth`, `/github`, `/ws`, plus the two pages the server still renders for now) to 8787 (`apps/web/vite.config.ts`). The browser only ever talks to 5173, so it's one origin there too. That's why `PUBLIC_URL` is `http://localhost:5173` in development: GitHub's sign-in sends you back to that address, and Vite passes the callback on to the server.

## The React analogy

The fallback is the server side of client-side routing. It's like a `<Route path="*">` at the very end of your routes, except that on the server it doesn't show "not found": it boots the app, and the app's own routes decide what to show.
```

In `apps/server/.env.example`, replace the `PUBLIC_URL` lines with:

```bash
# Where people reach Nitpilot. In development that's Vite (npm run dev -w apps/web), which passes the
# server's paths on to port 8787 (docs/why/serving-a-spa.md); with the dev tunnel it's the tunnel URL.
PUBLIC_URL=http://localhost:5173
```

and add before `# Hosted instance only`:

```bash
# The built web app; leave unset to use apps/web/dist
# WEB_DIST_DIR=

```

Your own `apps/server/.env` needs the same `PUBLIC_URL` change for development; GitHub's sign-in only accepts it once Task 3's live step has added the callback URL (until then, sign-in from port 8787 keeps working with the old value).

In `.github/workflows/ci.yml`, add after `- run: npm run typecheck`:

```yaml
      # The web app's files, which the server serves (spec §7).
      - run: npm run build
```

- [x] **Step 9: Look at it through the server**

Run `npm run build`, then `npm run dev -w apps/server` (it serves `apps/web/dist`), and open `http://localhost:8787/` and `http://localhost:8787/c/x/y/1`: the first shows Task 1's placeholder; the second is still the server's transcript route (signed out, it sends you to GitHub sign-in), because server routes come first. `curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/api/nope` prints `404`. Stop the server.

- [x] **Step 10: The whole suite, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: protocol 41, CLI 293 passed + 14 skipped, server 606, web 10; typecheck and lint clean.

```bash
git add apps/server docs/why/serving-a-spa.md .github/workflows/ci.yml docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(server): serve the web app with an SPA fallback and a CSP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Sign-in, `/api/me` for the browser, landing page, Playwright

**Files:**
- Create: `packages/protocol/src/web-api.ts` and `web-api.test.ts`; `apps/server/src/auth/request-user.ts` and `request-user.db.test.ts`, `apps/server/src/http/routes/me.ts` and `me.db.test.ts`, `apps/server/test/test-env.ts`, `apps/server/test/e2e/web-server.ts`; `apps/web/src/api/{client.ts,client.test.ts,me.ts}`, `apps/web/src/components/ErrorState/{ErrorState.tsx,ErrorState.module.css}`, `apps/web/src/routes/Landing/{Landing.tsx,Landing.module.css,Landing.test.tsx}`, `apps/web/src/routes/Home/{Home.tsx,Home.module.css,Home.test.tsx}`, `apps/web/playwright.config.ts`, `apps/web/e2e/{ports.ts,control.ts,landing.spec.ts}`.
- Modify: `packages/protocol/src/index.ts`, `packages/protocol/src/brand.ts` (`repoUrl`); `apps/server/src/http/routes/cli.ts` (`/api/me` moves out), `apps/server/src/http/app.ts`, `apps/server/src/http/routes/cli.db.test.ts`, `apps/server/vitest.config.ts`, `apps/server/test/e2e/harness.ts`, `apps/server/package.json`; `apps/web/src/app.tsx`, `apps/web/tsconfig.json`, `apps/web/package.json`; root `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`.

**Interfaces:**
- Consumes: `currentUser` (`auth/session.ts`), `authenticateCliToken` (`auth/cli-token.ts`), `isAllowedOrigin` (`lib/csrf.ts`), `startE2e` (`test/e2e/harness.ts`), `sessionCookieFor` (`test/http.ts`).
- Produces (protocol): `WebMe` = `MeResponse` + `id`, `githubId`; `BRAND.repoUrl`.
- Produces (server): `type UserVariables = { user: SessionUser; via: 'session' | 'cli' }`, `requireUser`, `requireSameOrigin` (`auth/request-user.ts`); `meRoutes()`; `TEST_ENV` (`test/test-env.ts`); `startE2e(opts?: { port?: number; webDistDir?: string })`; the test-only control API `POST /signin { login: 'maya' | 'leo' } → { name, value }` (the session cookie).
- Produces (web): `api.get(path, schema)`, `api.send(method, path, body?, schema?)`, `class ApiError { status; code; message }`, `retryUnlessClientError(failureCount, error)` (`src/api/client.ts`); `useMe()` (`src/api/me.ts`); `<Landing />`, `SIGN_IN_URL`; `<Home />`; `<ErrorState message onRetry />`; `signIn(context, login)`, `pageProblems(page)` (`e2e/control.ts`); `WEB_PORT`, `CONTROL_PORT`, `BASE_URL`, `CONTROL_URL` (`e2e/ports.ts`).

- [x] **Step 1: `WebMe` in the protocol**

Create `packages/protocol/src/web-api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MeResponse } from './api';
import { WebMe } from './web-api';

describe('web API bodies', () => {
  const me: WebMe = { id: 'user_1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok' };

  it('round-trips WebMe', () => {
    expect(WebMe.parse(JSON.parse(JSON.stringify(me)))).toEqual(me);
  });

  it('leaves the CLI able to read the same /api/me answer', () => {
    expect(MeResponse.parse(me)).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'ok' });
  });
});
```

Run: `npm test -w packages/protocol`
Expected: FAIL, `Error: Cannot find module './web-api'`.

Create `packages/protocol/src/web-api.ts`:

```ts
import { z } from 'zod';
import { MeResponse } from './api';

// REST bodies the web app reads and sends (spec §10 "REST endpoints in Plan 2"). The web app parses every
// answer with these, as the CLI does with api.ts.

/**
 * `GET /api/me`, as the web app reads it: the CLI's answer plus who you are. The CLI parses the same answer
 * with `MeResponse`, which ignores the extra fields. Later milestones add settings, onboarding and push.
 */
export const WebMe = MeResponse.extend({
  id: z.string(),
  githubId: z.string(),
});
export type WebMe = z.infer<typeof WebMe>;
```

In `packages/protocol/src/index.ts`, add `export * from './web-api';` after `export * from './api';`. In `packages/protocol/src/brand.ts`, add after `userAgent`:

```ts
  /** Where the code and docs live; the web app's landing page links here. */
  repoUrl: 'https://github.com/NikosGkikas13/nitpilot',
```

Run: `npm test -w packages/protocol`
Expected: `Tests  43 passed (43)`.

- [x] **Step 2: Write the failing server tests**

Create `apps/server/src/auth/request-user.db.test.ts`:

```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { makeCliToken, makeUser } from '../../test/db';
import { sessionCookieFor } from '../../test/http';
import { onError } from '../http/errors';
import { requireSameOrigin, requireUser, type UserVariables } from './request-user';

// A small app with one read and one write, behind the two checks.
const app = new Hono<{ Variables: UserVariables }>();
app.onError(onError);
app.get('/who', requireUser, (c) => c.json({ login: c.get('user').login, via: c.get('via') }));
app.post('/change', requireUser, requireSameOrigin, (c) => c.json({ ok: true }));

const OURS = { origin: 'http://localhost:8787' };

describe('requireUser', () => {
  it('knows a browser by its session cookie', async () => {
    const user = await makeUser({ login: 'maya-web' });
    const res = await app.request('/who', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await res.json()).toEqual({ login: 'maya-web', via: 'session' });
  });

  it('knows a CLI by its token', async () => {
    const user = await makeUser({ login: 'maya-cli' });
    const { raw } = await makeCliToken(user.id);
    const res = await app.request('/who', { headers: { authorization: `Bearer ${raw}` } });
    expect(await res.json()).toEqual({ login: 'maya-cli', via: 'cli' });
  });

  it('turns away a request with neither', async () => {
    const res = await app.request('/who');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Sign in with GitHub first.' } });
  });

  it('does not fall back to the cookie when the token is wrong', async () => {
    const user = await makeUser();
    const res = await app.request('/who', { headers: { authorization: 'Bearer nit_wrong', cookie: await sessionCookieFor(user.id) } });
    expect(res.status).toBe(401);
  });
});

describe('requireSameOrigin', () => {
  it('lets a browser change things from our own pages only', async () => {
    const cookie = await sessionCookieFor((await makeUser()).id);
    expect((await app.request('/change', { method: 'POST', headers: { cookie, ...OURS } })).status).toBe(200);
    expect((await app.request('/change', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await app.request('/change', { method: 'POST', headers: { cookie } })).status).toBe(403);
  });

  it('needs no Origin from a CLI', async () => {
    const { raw } = await makeCliToken((await makeUser()).id);
    expect((await app.request('/change', { method: 'POST', headers: { authorization: `Bearer ${raw}` } })).status).toBe(200);
  });
});
```

Create `apps/server/src/http/routes/me.db.test.ts`:

```ts
import { WebMe } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeCliToken, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';

describe('GET /api/me', () => {
  it('tells a signed-in browser who it is', async () => {
    const user = await makeUser({ login: 'maya-me' });
    const res = await testApp().request('/api/me', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(res.status).toBe(200);
    expect(WebMe.parse(await res.json())).toEqual({ id: user.id, githubId: user.githubId, login: 'maya-me', avatarUrl: null, githubAuth: 'needs_reauth' });
  });

  it('gives a CLI the same answer', async () => {
    const user = await makeUser({ login: 'maya-me-cli' });
    const { raw } = await makeCliToken(user.id);
    const res = await testApp().request('/api/me', { headers: { authorization: `Bearer ${raw}` } });
    expect(await res.json()).toMatchObject({ login: 'maya-me-cli', githubAuth: 'needs_reauth' });
  });

  it('is a 401 for a browser that is not signed in', async () => {
    const res = await testApp().request('/api/me');
    expect(res.status).toBe(401);
  });
});
```

Run: `npm run test:db -w apps/server -- src/auth/request-user.db.test.ts src/http/routes/me.db.test.ts`
Expected: `request-user.db.test.ts` fails with `Cannot find module './request-user'`; in `me.db.test.ts`, `tells a signed-in browser who it is` fails with `expected 401 to be 200` (today `/api/me` only knows the CLI's token).

- [x] **Step 3: Who is asking, and `/api/me` for both**

Create `apps/server/src/auth/request-user.ts`:

```ts
import { BRAND } from '@nitpilot/protocol';
import { createMiddleware } from 'hono/factory';
import { HttpError } from '../http/errors';
import { isAllowedOrigin } from '../lib/csrf';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { authenticateCliToken } from './cli-token';
import { currentUser, type SessionUser } from './session';

/** Who is asking, and how they proved it: the web app's session cookie, or a CLI's token. */
export type UserVariables = { user: SessionUser; via: 'session' | 'cli' };

/**
 * For routes both the web app and the CLI call (`/api/me`, retry). A request with an `Authorization` header
 * is a CLI and must carry a valid `Bearer nit_…` token; anything else must have a signed-in session cookie.
 */
export const requireUser = createMiddleware<{ Variables: UserVariables }>(async (c, next) => {
  const header = c.req.header('authorization');
  if (header) {
    const auth = await authenticateCliToken(header);
    if (!auth) throw new HttpError('unauthorized', `Missing or invalid CLI token. Run \`${BRAND.cli} login\`.`);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    c.set('user', { id: user.id, githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl });
    c.set('via', 'cli');
  } else {
    const user = await currentUser(c);
    if (!user) throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    c.set('user', user);
    c.set('via', 'session');
  }
  await next();
});

/**
 * A browser sends our cookie with any request to us, even one another site's page started. So a change made
 * with the cookie must come from our own pages (spec §14). A CLI's token isn't sent by browsers on their own,
 * so CLI requests need no such check. Goes after `requireUser`.
 */
export const requireSameOrigin = createMiddleware<{ Variables: UserVariables }>(async (c, next) => {
  const changes = c.req.method !== 'GET' && c.req.method !== 'HEAD';
  if (changes && c.get('via') === 'session' && !isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) {
    throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
  }
  await next();
});
```

Create `apps/server/src/http/routes/me.ts`:

```ts
import type { WebMe } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireUser, type UserVariables } from '../../auth/request-user';
import { prisma } from '../../lib/prisma';

/** `GET /api/me` (spec §10): who you are and whether your GitHub sign-in still works. For the web app and the CLI alike. */
export function meRoutes(): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/me', requireUser, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('user').id }, include: { githubAuth: true } });
    const body: WebMe = {
      id: user.id,
      githubId: user.githubId,
      login: user.login,
      avatarUrl: user.avatarUrl,
      githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth',
    };
    return c.json(body);
  });

  return app;
}
```

In `apps/server/src/http/routes/cli.ts`, delete the `app.get('/api/me', requireCliToken, …)` route and `type MeResponse` from the protocol import. In `apps/server/src/http/app.ts`, import `meRoutes` (`import { meRoutes } from './routes/me';`, after the `cli-approve` import) and mount it first among the API routes: `app.route('/', meRoutes());` right before `app.route('/', cliRoutes(deps));`.

In `apps/server/src/http/routes/cli.db.test.ts`, the `/api/me` check now gets two more fields: change its `.toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'needs_reauth' })` to `.toMatchObject(…)` with the same object.

Run: `npm run test:db -w apps/server -- src/auth/request-user.db.test.ts src/http/routes/me.db.test.ts src/http/routes/cli.db.test.ts`
Expected: `Tests  21 passed (21)` (6 + 3 + the CLI routes' 12).

- [x] **Step 4: Write the failing web tests**

Create `apps/web/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError, retryUnlessClientError } from './client';

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  const Thing = z.object({ name: z.string() });

  it('returns a body that matches the schema', async () => {
    vi.stubGlobal('fetch', answer(200, { name: 'maya' }));
    await expect(api.get('/api/thing', Thing)).resolves.toEqual({ name: 'maya' });
  });

  it("turns the server's error body into an ApiError", async () => {
    vi.stubGlobal('fetch', answer(409, { error: { code: 'conflict', message: 'Someone already resolved P1.' } }));
    const err = await api.send('POST', '/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', message: 'Someone already resolved P1.' });
  });

  it('refuses a body with the wrong shape instead of passing it on', async () => {
    vi.stubGlobal('fetch', answer(200, { nom: 'maya' }));
    await expect(api.get('/api/thing', Thing)).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api.get('/api/thing', Thing)).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('sends JSON with the cookie', async () => {
    const fetch = answer(200, {});
    vi.stubGlobal('fetch', fetch);
    await api.send('POST', '/api/chats/c1/notes', { body: 'hi' });
    expect(fetch).toHaveBeenCalledWith('/api/chats/c1/notes', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"body":"hi"}' }));
  });
});

describe('retryUnlessClientError', () => {
  it('retries network failures and 5xx a little, and 4xx never', () => {
    expect(retryUnlessClientError(0, new ApiError(0, 'network', ''))).toBe(true);
    expect(retryUnlessClientError(0, new ApiError(503, 'server_error', ''))).toBe(true);
    expect(retryUnlessClientError(2, new ApiError(503, 'server_error', ''))).toBe(false);
    expect(retryUnlessClientError(0, new ApiError(404, 'not_found', ''))).toBe(false);
  });
});
```

Create `apps/web/src/routes/Landing/Landing.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

describe('Landing', () => {
  it('pitches Nitpilot and starts GitHub sign-in, coming back to the home page', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1, name: "Your agents review each other's PRs the moment they open." })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute('href', '/auth/github/login?next=%2F');
  });

  it('explains how it works in three steps', () => {
    render(<Landing />);
    const steps = screen.getByRole('region', { name: 'How it works' });
    expect(steps.querySelectorAll('h2')).toHaveLength(3);
  });

  it('keeps the sample inbox out of the accessibility tree', () => {
    render(<Landing />);
    expect(screen.queryByText('Fix race in session refresh')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
```

Create `apps/web/src/routes/Home/Home.test.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeQueryClient } from '../../app';
import { Home } from './Home';

function renderHome() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <Home />
    </QueryClientProvider>,
  );
}

function answers(...responses: [number, unknown][]) {
  const fetch = vi.fn();
  for (const [status, body] of responses) fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('Home', () => {
  it('shows the landing page to someone who is not signed in', async () => {
    answers([401, { error: { code: 'unauthorized', message: 'Sign in with GitHub first.' } }]);
    renderHome();
    expect(await screen.findByRole('link', { name: /Sign in with GitHub/ })).toBeInTheDocument();
  });

  it('greets someone who is signed in', async () => {
    answers([200, { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok' }]);
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
  });

  it('shows the error with a way to try again, instead of a blank page', async () => {
    const fail: [number, unknown] = [500, { error: { code: 'server_error', message: 'internal server error' } }];
    // The first try and the client's two retries fail; "Try again" then succeeds.
    answers(fail, fail, fail, [200, { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok' }]);
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }, { timeout: 10_000 }));
    expect(await screen.findByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
  });
});
```

Run: `npm test -w apps/web`
Expected: 3 failed suites, e.g. `Error: Failed to resolve import "./client" from "apps/web/src/api/client.test.ts". Does the file exist?`

- [x] **Step 5: The API client and `useMe`**

Create `apps/web/src/api/client.ts` (the server's errors are `{ error: { code, message } }`, `http/errors.ts`):

```ts
import { z } from 'zod';

/** Every failed request, in one shape: the HTTP status (0 = no answer), the server's error code, and a message to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** How the server answers an error (apps/server/src/http/errors.ts). */
const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

async function request<T>(method: string, path: string, schema: z.ZodType<T> | null, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      // The session cookie goes along; it's the same origin (docs/why/serving-a-spa.md).
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach Nitpilot. Check your connection and try again.");
  }

  if (!res.ok) {
    const error = ErrorBody.safeParse(await res.json().catch(() => null));
    if (error.success) throw new ApiError(res.status, error.data.error.code, error.data.error.message);
    throw new ApiError(res.status, 'server_error', `Nitpilot answered ${res.status}. Try again in a moment.`);
  }
  if (schema === null || res.status === 204) return undefined as T;

  // Never trust an answer's shape: a body that doesn't match the schema is an error, not data.
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new ApiError(res.status, 'bad_response', `Unexpected answer from ${path}.`);
  return parsed.data;
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>) => request('GET', path, schema),
  send: <T = void>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, schema: z.ZodType<T> | null = null) => request<T>(method, path, schema, body),
};

/** A 4xx won't change by asking again; a network failure or a 5xx might. Used as TanStack Query's `retry`. */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}
```

Create `apps/web/src/api/me.ts`:

```ts
import { WebMe } from '@nitpilot/protocol';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './client';

/** Who is signed in. `null` means nobody: the server answered 401. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<WebMe | null> => {
      try {
        return await api.get('/api/me', WebMe);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}
```

- [x] **Step 6: The landing page, the home switch and the error state**

Create `apps/web/src/routes/Landing/Landing.module.css`:

```css
.page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.nav,
.hero,
.steps {
  box-sizing: border-box;
  width: 100%;
  max-width: 1160px;
  margin: 0 auto;
}

.nav {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
}

.spacer {
  flex: 1;
}

.navLink {
  font-size: 14px;
  font-weight: 500;
  color: var(--fg2);
  text-decoration: none;
}

.navLink:hover {
  color: var(--fg1);
}

.hero {
  padding: clamp(20px, 4vw, 56px) 24px 32px;
  display: flex;
  flex-wrap: wrap;
  gap: 48px;
  align-items: center;
}

.pitch {
  flex: 1 1 440px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.eyebrow {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  border: 1px solid var(--b1);
  font-size: 13px;
  color: var(--fg2);
}

.diamond {
  width: 6px;
  height: 6px;
  background: var(--acc);
  transform: rotate(45deg);
}

.title {
  margin: 0;
  font-size: clamp(34px, 4.6vw, 60px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.035em;
  text-wrap: balance;
}

.sub {
  margin: 0;
  max-width: 30em;
  font-size: clamp(17px, 1.6vw, 20px);
  line-height: 1.45;
  color: var(--fg2);
  text-wrap: pretty;
}

.action {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.signIn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 22px;
  border-radius: 14px;
  background: var(--fg1);
  color: var(--bg);
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
}

.note {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--fg3);
}

/* An illustration of the inbox: three rows from the design brief's sample data. */
.card {
  flex: 1 1 380px;
  min-width: 0;
  max-width: 520px;
  padding: 14px;
  border-radius: 22px;
  background: var(--surface);
  border: 1px solid var(--b1);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
}

.rowFirst {
  background: var(--bg);
}

.avatar {
  flex: none;
  position: relative;
  width: 38px;
  height: 38px;
}

.initials {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-pill);
  background: var(--muted);
  color: var(--fg2);
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agentBadge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 15px;
  height: 15px;
  border-radius: 5px;
  background: var(--fg1);
  box-shadow: 0 0 0 2px var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
}

.agentBadge::after {
  content: '';
  width: 5px;
  height: 5px;
  background: var(--surface);
  transform: rotate(45deg);
}

.rowText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ref {
  display: flex;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg3);
}

.ref span:first-child {
  flex: 1;
}

.rowTitle {
  font-size: 14.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pill {
  flex: none;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}

.pillRed {
  background: var(--red-tint);
  color: var(--red-fg);
}

.pillMuted {
  background: var(--muted);
  color: var(--fg2);
}

.pillOk {
  background: var(--ok-tint);
  color: var(--ok-fg);
}

.last {
  font-size: 12.5px;
  color: var(--fg3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.steps {
  padding: 8px 24px 40px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.step {
  padding: 20px;
  border-radius: 18px;
  background: var(--surface);
  border: 1px solid var(--b1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stepNumber {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--acc-tint);
  color: var(--acc-text);
  font-family: var(--font-mono);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stepTitle {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.stepBody {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--fg2);
  text-wrap: pretty;
}

@media (max-width: 759px) {
  .nav,
  .hero,
  .steps {
    padding-left: 16px;
    padding-right: 16px;
  }
}
```

Create `apps/web/src/routes/Landing/Landing.tsx` (copy and sample rows from the handoff §4 and the prototype's data):

```tsx
import { BRAND } from '@nitpilot/protocol';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import styles from './Landing.module.css';

/** Where GitHub sign-in starts; afterwards the server sends you back to `next` (apps/server/src/http/routes/auth.ts). */
export const SIGN_IN_URL = `/auth/github/login?next=${encodeURIComponent('/')}`;

type Tone = 'red' | 'muted' | 'ok';
const TONE: Record<Tone, string> = { red: styles.pillRed!, muted: styles.pillMuted!, ok: styles.pillOk! };

// The illustration's rows: the design brief's sample data (handoff §4), not real PRs.
const SAMPLE_ROWS: { ref: string; time: string; title: string; initials: string; pill: string; tone: Tone; last: string }[] = [
  { ref: 'acme/shop-api #139', time: '16:40', title: 'Fix race in session refresh', initials: 'SO', pill: 'Needs you', tone: 'red', last: 'A security point needs you' },
  { ref: 'acme/shop-api #147', time: 'now', title: 'Bump Prisma to 7.2', initials: 'LP', pill: "Leo's agent working", tone: 'muted', last: 'reading src/db/client.ts' },
  { ref: 'acme/shop-api #142', time: '14:13', title: 'Add cursor pagination to /orders', initials: 'LP', pill: 'Ready', tone: 'ok', last: '2 rounds, 3 points resolved' },
];

const STEPS = [
  { title: 'A review is requested', body: 'Your agent reviews right away, on your machine. When points come back on your PR, it fixes them and pushes.' },
  { title: 'The agents talk it out', body: 'One chat per pull request, like a messenger. The PR on GitHub stays clean.' },
  { title: 'You make the call', body: 'Approve when everything is resolved, settle a disagreement, or judge a security concern. Nothing else pings you.' },
];

/** The signed-out home page (handoff §4, canvas 3b). */
export function Landing() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Wordmark size={22} />
        <span className={styles.spacer} />
        <a className={styles.navLink} href={`${BRAND.repoUrl}/tree/main/docs`}>
          Docs
        </a>
        <a className={styles.navLink} href={BRAND.repoUrl}>
          GitHub ↗
        </a>
      </nav>

      <main className={styles.hero}>
        <div className={styles.pitch}>
          <span className={styles.eyebrow}>
            <span className={styles.diamond} aria-hidden="true" />
            For Claude Code and Gemini CLI
          </span>
          <h1 className={styles.title}>Your agents review each other's PRs the moment they open.</h1>
          <p className={styles.sub}>You only hear about it when there's a decision to make.</p>
          <div className={styles.action}>
            <a className={styles.signIn} href={SIGN_IN_URL}>
              Sign in with GitHub <span aria-hidden="true">→</span>
            </a>
            <span className={styles.note}>Free for public repos · Open source · Self-host for private repos</span>
          </div>
        </div>

        <div className={styles.card} aria-hidden="true">
          {SAMPLE_ROWS.map((row, i) => (
            <div key={row.ref} className={i === 0 ? `${styles.row} ${styles.rowFirst}` : styles.row}>
              <span className={styles.avatar}>
                <span className={styles.initials}>{row.initials}</span>
                <span className={styles.agentBadge} />
              </span>
              <span className={styles.rowText}>
                <span className={styles.ref}>
                  <span>{row.ref}</span>
                  {row.time}
                </span>
                <span className={styles.rowTitle}>{row.title}</span>
                <span className={styles.status}>
                  <span className={`${styles.pill} ${TONE[row.tone]}`}>{row.pill}</span>
                  <span className={styles.last}>{row.last}</span>
                </span>
              </span>
            </div>
          ))}
        </div>
      </main>

      <section className={styles.steps} aria-label="How it works">
        {STEPS.map((step, i) => (
          <div key={step.title} className={styles.step}>
            <span className={styles.stepNumber}>{i + 1}</span>
            <h2 className={styles.stepTitle}>{step.title}</h2>
            <p className={styles.stepBody}>{step.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
```

Create `apps/web/src/components/ErrorState/ErrorState.module.css`:

```css
.error {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 16px;
  text-align: center;
  color: var(--fg2);
}

.retry {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  font-weight: 500;
  cursor: pointer;
}

.retry:hover {
  background: var(--hover);
}
```

Create `apps/web/src/components/ErrorState/ErrorState.tsx`:

```tsx
import styles from './ErrorState.module.css';

/** One plain line and a way to try again, instead of a blank page. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <p>{message}</p>
      <button type="button" className={styles.retry} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
```

Create `apps/web/src/routes/Home/Home.module.css`:

```css
.loading {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.signedIn {
  max-width: 620px;
  margin: 0 auto;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.spacer {
  flex: 1;
}

.signOut {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  cursor: pointer;
}
```

Create `apps/web/src/routes/Home/Home.tsx` (the signed-in placeholder keeps the old server home page's Sign out):

```tsx
import type { WebMe } from '@nitpilot/protocol';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { useMe } from '../../api/me';
import { Landing } from '../Landing/Landing';
import styles from './Home.module.css';

/** `/`: the landing page when signed out; when signed in, a placeholder until the inbox arrives (Task 6). */
export function Home() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className={styles.loading} aria-busy="true">
        <Wordmark size={26} />
      </div>
    );
  }
  if (me.isError) return <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Landing />;
  return <SignedIn me={me.data} />;
}

function SignedIn({ me }: { me: WebMe }) {
  return (
    <div className={styles.signedIn}>
      <header className={styles.header}>
        <Wordmark />
        <span className={styles.spacer} />
        <ThemeToggle />
      </header>
      <main>
        <h1>Signed in as @{me.login}</h1>
        {/* A plain form: the browser sends our Origin, which /auth/logout checks, then follows its redirect. */}
        <form method="post" action="/auth/logout">
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </main>
    </div>
  );
}
```

Replace `apps/web/src/app.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { retryUnlessClientError } from './api/client';
import { Home } from './routes/Home/Home';

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: retryUnlessClientError } } });
}

/** The whole app: the data cache, then the routes. */
export function App({ queryClient = makeQueryClient() }: { queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

Run: `npm test -w apps/web`
Expected: `Test Files  6 passed (6)`, `Tests  22 passed (22)` (the "Try again" test waits out the client's two retries, about 3 s).

- [x] **Step 7: A shared test environment and a harness on a fixed port**

Create `apps/server/test/test-env.ts`:

```ts
/**
 * Values the server reads from the environment, for every test run: Vitest (vitest.config.ts) and the
 * Playwright tests' server (test/e2e/web-server.ts). Tests that care about one override it.
 * DATABASE_URL isn't here: each runner points it at the test database (test/test-database.ts).
 */
export const TEST_ENV = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:8787',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GITHUB_APP_ID: '12345',
  GITHUB_APP_SLUG: 'nitpilot-dev',
  GITHUB_APP_PRIVATE_KEY: 'tests-that-need-a-key-generate-one',
  GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
  PUBLIC_REPOS_ONLY: 'false',
  ALLOWED_LOGINS: '',
};
```

Replace `apps/server/vitest.config.ts` (the values move to `TEST_ENV`; the projects are unchanged):

```ts
import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-database.ts';
import { TEST_ENV } from './test/test-env.ts';

// Tests that care about one value override it with vi.stubEnv.
const testEnv = {
  ...TEST_ENV,
  // Tests use their own database next to the dev one (nitpilot_test), so a test run never
  // empties your dev data. test/global-setup.ts creates and migrates it.
  ...(process.env.DATABASE_URL ? { DATABASE_URL: testDatabaseUrl(process.env.DATABASE_URL) } : {}),
};

export default defineConfig({
  test: {
    env: testEnv,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}', 'test/fixtures/**/*.test.ts'], exclude: ['**/*.db.test.{ts,tsx}'] },
      },
      {
        // Real Postgres. Files run one at a time; tests use unique data (see test/db.ts).
        extends: true,
        test: {
          name: 'db',
          include: ['src/**/*.db.test.{ts,tsx}', 'test/**/*.db.test.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
          globalSetup: ['./test/global-setup.ts'],
        },
      },
      {
        // Plan 1 end to end (spec §19): the server, two CLIs and the fake agent. Slower, so it runs on its own
        // (npm run test:e2e), against the same test database.
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.test.ts'],
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 30_000,
          globalSetup: ['./test/global-setup.ts'],
        },
      },
    ],
  },
});
```

In `apps/server/test/e2e/harness.ts`: `startE2e()` becomes `startE2e(opts: { port?: number; webDistDir?: string } = {})`; its app is `testApp({ ingest, dispatch: dispatcher.dispatch, clis: hub, ...(opts.webDistDir ? { webDistDir: opts.webDistDir } : {}) })`; `serve(…)` listens on `opts.port ?? 0`; and its doc comment gains "The Playwright tests' server (web-server.ts) passes a fixed port and the built web app."

Create `apps/server/test/e2e/web-server.ts`:

```ts
/**
 * The server the Playwright tests in apps/web/e2e talk to: Plan 1's end-to-end harness (the real server with
 * FakePlatform, Postgres and fake-agent CLIs) on a fixed port, serving the built web app, plus a small
 * control API on a second port that only the tests use (sign someone in, and later: send webhooks, read
 * state). Playwright starts it (apps/web/playwright.config.ts); it is never imported by src/.
 *
 * Run by hand: E2E_WEB_PORT=4319 E2E_CONTROL_PORT=4320 npm run e2e:web-server -w apps/server
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import setupTestDatabase from '../global-setup';
import { testDatabaseUrl } from '../test-database';
import { TEST_ENV } from '../test-env';

const webPort = Number(process.env.E2E_WEB_PORT);
const controlPort = Number(process.env.E2E_CONTROL_PORT);
if (!webPort || !controlPort) throw new Error('Set E2E_WEB_PORT and E2E_CONTROL_PORT (apps/web/playwright.config.ts does).');

// The test database, created and migrated as Vitest's global setup does (it reads the dev DATABASE_URL).
await setupTestDatabase();
const devUrl = process.env.DATABASE_URL!;
// Then the environment the server reads. The page and its API are on this origin.
Object.assign(process.env, TEST_ENV, { PUBLIC_URL: `http://127.0.0.1:${webPort}`, DATABASE_URL: testDatabaseUrl(devUrl) });

// Only now load the server's modules: the database client reads DATABASE_URL when it's first imported.
const { startE2e } = await import('./harness');
const { sessionCookieFor } = await import('../http');

const e2e = await startE2e({ port: webPort, webDistDir: fileURLToPath(new URL('../../../web/dist', import.meta.url)) });

const control = new Hono();
/** Sign someone in: answers the session cookie for the browser to use. */
control.post('/signin', async (c) => {
  const { login } = (await c.req.json()) as { login: 'maya' | 'leo' };
  const user = e2e.users[login];
  if (!user) return c.json({ error: `no test user "${login}"` }, 400);
  const [name, value] = (await sessionCookieFor(user.id)).split('=') as [string, string];
  return c.json({ name, value });
});
serve({ fetch: control.fetch, port: controlPort, hostname: '127.0.0.1' });

console.log(`[web-e2e] app on ${e2e.url}, control API on http://127.0.0.1:${controlPort}`);

const stop = async () => {
  await e2e.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

In `apps/server/package.json`, add the script `"e2e:web-server": "tsx test/e2e/web-server.ts"`.

Run: `npm test -w apps/server && npm run test:e2e`
Expected: server 615 (606 + 6 + 3), end to end 5.

- [x] **Step 8: Playwright**

```bash
npm install -D -w apps/web --no-audit --no-fund @playwright/test@^1.64.1
npx playwright install chromium
```

Expected: Playwright 1.64.1, and Chrome Headless Shell (about 100 MB) in `~/Library/Caches/ms-playwright/`.

In `apps/web/package.json`, add the script `"test:e2e": "playwright test"`. In the root `package.json`, add after `"test:e2e"`: `"test:web-e2e": "npm run build && npm run test:e2e -w apps/web"`. In `apps/web/tsconfig.json`, `types` becomes `["vite/client", "node"]` and `include` becomes `["src", "e2e", "vite.config.ts", "playwright.config.ts"]`. Add to `.gitignore`:

```
# Playwright
test-results/
playwright-report/
```

Create `apps/web/e2e/ports.ts` (Playwright doesn't let tests import from its config file, so both import these):

```ts
// Where the Playwright tests' server listens (apps/server/test/e2e/web-server.ts): the app and its API on one
// port, the tests' control API on another.
export const WEB_PORT = 4319;
export const CONTROL_PORT = 4320;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;
```

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, CONTROL_PORT, WEB_PORT } from './e2e/ports';

export default defineConfig({
  testDir: './e2e',
  // One server and one database for every test, so one test at a time.
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The server for these tests: apps/server/test/e2e/web-server.ts.
  webServer: {
    command: 'npm run e2e:web-server -w apps/server',
    cwd: '../..',
    url: `${BASE_URL}/healthz`,
    env: { E2E_WEB_PORT: String(WEB_PORT), E2E_CONTROL_PORT: String(CONTROL_PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

Create `apps/web/e2e/control.ts`:

```ts
import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, CONTROL_URL } from './ports';

/** Sign a test user in: the browser gets the session cookie a real GitHub sign-in would have set. */
export async function signIn(context: BrowserContext, login: 'maya' | 'leo'): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/signin`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`signing in ${login} failed: ${res.status} ${await res.text()}`);
  const cookie = (await res.json()) as { name: string; value: string };
  await context.addCookies([{ ...cookie, url: BASE_URL }]);
}

/**
 * What went wrong on the page: a script error, or something the Content-Security-Policy blocked. (A request
 * that answers 401 is logged by the browser too, but signed out that's expected, so it isn't collected.)
 */
export function pageProblems(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
```

Create `apps/web/e2e/landing.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { pageProblems, signIn } from './control';

test('someone signed out gets the landing page, with nothing blocked or broken', async ({ page }) => {
  const errors = pageProblems(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Your agents review each other's PRs the moment they open.");
  await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute('href', '/auth/github/login?next=%2F');
  // The bundled fonts loaded (a CSP that blocked them would log an error and fall back to system-ui).
  expect(await page.evaluate(() => document.fonts.check('16px "Bricolage Grotesque Variable"'))).toBe(true);
  expect(errors).toEqual([]);
});

test('a link deep into the app opens the app', async ({ page }) => {
  await page.goto('/c/acme/shop-api/142?from=github');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('someone signed in is greeted by name', async ({ page, context }) => {
  await signIn(context, 'maya');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Signed in as @maya' })).toBeVisible();
});
```

Run: `CI=1 npm run test:web-e2e`
Expected: the build, then `3 passed`.

- [x] **Step 9: Prove the CSP check matters**

In `apps/web/vite.config.ts`, change `assetsInlineLimit: 0` to `assetsInlineLimit: 4096` (Vite's default) and run `CI=1 npm run test:web-e2e` again.
Expected: 1 failed, `someone signed out gets the landing page, with nothing blocked or broken`, listing `Loading the font 'data:font/woff2;base64,…' violates the following Content Security Policy directive: "font-src 'self'"`. Put `0` back and run it again: 3 passed.

- [x] **Step 10: CI**

In `.github/workflows/ci.yml`, add after `- run: npm run test:e2e`:

```yaml
      # Plan 2: the web app in a real browser against that same setup (spec §19).
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e -w apps/web
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: apps/web/test-results/
```

(`npm run build` already runs earlier in the job, from Task 2.)

- [x] **Step 11: Look at it**

Run `E2E_WEB_PORT=4319 E2E_CONTROL_PORT=4320 npm run e2e:web-server -w apps/server` and open `http://127.0.0.1:4319/` in the browser: the landing page as in the handoff's canvas 3b, at 1280 px in light and dark and at 375 px (one column, nothing scrolls sideways). Screenshots of all three go in the task report. Stop the server.

- [x] **Step 12: Live check: sign in through Vite (ask first)**

This changes the dev GitHub App's settings, so ask before doing it. Then the person, signed in to github.com as **NikosGkikas13** (the app's owner):
1. Opens https://github.com/settings/apps, clicks **nitpilot-dev**, and on the **General** tab scrolls to **Callback URL**.
2. Clicks **Add Callback URL**, types `http://localhost:5173/auth/github/callback` in the new box, scrolls down and clicks **Save changes**. The page reloads with a green "Your GitHub App was updated" note.
3. Sets `PUBLIC_URL=http://localhost:5173` in `apps/server/.env` (as Task 2's `.env.example` says).

Then start `npm run dev -w apps/server` and `npm run dev -w apps/web` (two Terminal-panel tabs), open `http://localhost:5173`, click **Sign in with GitHub →**, approve on GitHub if asked, and see "Signed in as @NikosGkikas13". **Sign out** returns to the landing page. Stop both.

- [x] **Step 13: The whole suite, then commit**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e && CI=1 npm run test:web-e2e`
Expected: protocol 43, CLI 293 passed + 14 skipped, server 615, web 22; typecheck and lint clean; end to end 5; Playwright 3.

```bash
git add packages/protocol apps/server apps/web package.json package-lock.json .gitignore .github/workflows/ci.yml docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(web): landing page and sign-in, /api/me for the browser, Playwright smoke tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Milestone W2: Inbox

W2 shows a person their real inbox: every chat they're part of, with the right status pill, round and unread count, sorted with "Needs you" first, searchable and filterable, keyboard-driven, in both themes and on a phone. It isn't live yet (W3 adds pushes); a refresh shows the latest.

**Files at the end of W2:**
```
packages/protocol/src/web-api.ts      InboxStatus, InboxRow, InboxResponse, MarkReadRequest; WebMe.agentOnline
apps/server/
  prisma: ChatRead (migration 2026…_chat_read)
  src/lib/prisma.ts                   the client emits query events (tests count them)
  src/chats/inbox-status.ts           inboxStatus (pure)
  src/chats/activity.ts               loadActivities (many chats, a fixed number of queries), typed failures
  src/chats/inbox.ts                  loadInboxRows, loadInboxRow, unreadCounts
  src/http/routes/inbox.ts            GET /api/inbox, POST /api/chats/:id/read
  src/http/routes/me.ts               + agentOnline
  test/queries.ts                     countQueries
  test/db.ts                          + makeParticipant, makeMessage
  test/e2e/web-server.ts              + control POST /pr
apps/web/src/
  api/inbox.ts                        useInbox
  lib/inbox.ts                        sortRows, filterRows, statusFilterOf, tabCounts, defaultTab, chatPath
  lib/keys.ts                         useInboxKeys, useEscapeBack, isTyping
  lib/time.ts                         rowTime
  lib/viewport.ts                     useIsDesktop (760 px)
  components/{StatusPill,Avatar,AgentBadge,Kbd,Ping}/…
  routes/Shell/{Shell,Pane}.tsx       desktop sidebar + main, phone single pane; EmptyPane
  routes/Inbox/…                      header, banners, search, filter, tabs, rows, empty states, footer
  routes/Chat/ChatPlaceholder.tsx     /c/:owner/:repo/:number until Task 10
  routes/Settings/SettingsPlaceholder.tsx   /settings (Sign out) until Task 21
  test/render.tsx                     fakeApi, renderApp, fakeViewport
apps/web/e2e/inbox.spec.ts            the inbox in a real browser
docs/why/n-plus-one-queries.md
```

No new packages: W2 uses what W1 installed.

### Task 4: Inbox status and activity for many chats

**Files:**
- Create: `apps/server/src/chats/inbox-status.ts`, `apps/server/src/chats/inbox-status.test.ts`, `apps/server/test/queries.ts`, `docs/why/n-plus-one-queries.md`.
- Modify: `apps/server/src/lib/prisma.ts` (query events), `apps/server/src/chats/activity.ts` (`loadActivities`, typed `failure`, a gone chat has no activity), `apps/server/src/chats/activity.test.ts`, `apps/server/src/chats/activity.db.test.ts`, `apps/server/src/http/routes/transcript.db.test.ts` (the plain-403 carry-forward), `packages/protocol/src/web-api.ts` (`InboxStatus`), `packages/protocol/src/web-api.test.ts`.

**Interfaces:**
- Consumes: `deriveActivity(facts)`, `Activity`, `LiveClis` (`chats/activity.ts`); `Phase`, `Role`, `Attention`, `FailureReason` (protocol).
- Produces: `InboxStatus = { kind: 'working' | 'waiting' | 'their_turn' | 'needs_you' | 'escalated' | 'ready' | 'merged' | 'closed' | 'quiet'; who: string | null; reason: 'offline' | 'repo_not_linked' | 'cap_reached' | 'decision' | 'manual_review' | 'failed' | 'drafts' | null }` (protocol). `inboxStatus(f: InboxStatusFacts): InboxStatus` with `InboxStatusFacts = { phase: Phase; merged: boolean; activity: Activity; attention: Attention; role: Role; you: string }` (`you` = the reader's login). `loadActivities(chatIds: string[], clis: LiveClis, now?): Promise<Map<string, Activity>>` (a chat id that doesn't exist is left out; no ids, no queries); `loadActivity(chatId, clis, now?)` is a one-item call of it and answers `{ kind: 'none' }` for a chat that is gone. `ActiveJob.failure: FailureReason | null`. `countQueries(run: () => Promise<unknown>): Promise<number>` (`test/queries.ts`).

- [x] **Step 1: Let tests count queries**

"No N+1" means reading 30 chats takes as many database queries as reading 1. To test it, the Prisma client emits an event per query and a test helper counts them. In `apps/server/src/lib/prisma.ts`, replace `createPrisma` and the `globalForPrisma` line:

```ts
function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: ['error'] });
}

// One client per process. In development, keep it on globalThis so hot reloads reuse it.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
```

with:

```ts
/** The client, able to tell listeners about each query it sends (tests count them: test/queries.ts). */
type Client = PrismaClient<'query'>;

function createPrisma(): Client {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
    ],
  });
}

// One client per process. In development, keep it on globalThis so hot reloads reuse it.
const globalForPrisma = globalThis as unknown as { prisma?: Client };
```

(`PrismaClient<'query'>` is still a `PrismaClient` wherever one is expected: Prisma's log type parameter only adds `$on('query')`.)

Create `apps/server/test/queries.ts`:

```ts
import { prisma } from '../src/lib/prisma';

// Counts the SQL queries Prisma sends, for "no N+1" tests: reading 30 chats must take as many queries as
// reading 1. See docs/why/n-plus-one-queries.md.

let sent = 0;
let listening = false;

/** How many queries `run` sent to the database. */
export async function countQueries(run: () => Promise<unknown>): Promise<number> {
  if (!listening) {
    prisma.$on('query', () => (sent += 1));
    listening = true;
  }
  const before = sent;
  await run();
  return sent - before;
}
```

Create `docs/why/n-plus-one-queries.md` (CLAUDE.md: the first time a backend concept shows up in the code):

````markdown
# N+1 queries: why the inbox reads all its chats at once

**In one sentence:** the inbox needs facts about many chats, and asking the database once per chat would make the page slower with every PR a person is part of, so the server asks once for all of them (`loadActivities` in `apps/server/src/chats/activity.ts`, and the inbox rows in `apps/server/src/chats/inbox.ts`).

## The problem

The obvious way to build a list is a loop: read the list (1 query), then for each item read its details (N more queries). That's "N+1". With 3 chats it's 4 queries and nobody notices. With 200 chats it's 201 round trips to Postgres, one after another, every time someone opens the inbox.

Each query costs a round trip (the request goes to Postgres and the answer comes back), even when Postgres finds the rows instantly. Round trips add up; rows mostly don't.

## The fix

Ask for everything at once and sort it out in memory:

```ts
// N+1: one query per chat
for (const id of chatIds) activities.set(id, await loadActivity(id, clis));

// Constant: one query for all the chats, then plain JavaScript
const chats = await prisma.prChat.findMany({ where: { id: { in: chatIds } }, include: { jobs: true, … } });
for (const chat of chats) activities.set(chat.id, deriveActivity(…));
```

Prisma's `include` still sends a few queries (one per relation: the chats, then their jobs, then their participants…), but that number is fixed. Reading 1 chat or 200 chats takes the same handful of queries.

## How the tests check it

`test/queries.ts` has `countQueries(run)`: it counts the SQL queries Prisma sends while `run` runs (Prisma emits a `query` event for each one; `apps/server/src/lib/prisma.ts` turns the events on). A test reads 1 chat, then 3 (or 30), and expects the same count. It doesn't pin the exact number, which would break whenever Prisma changes how it splits an `include`; it pins the property that matters: the count doesn't grow with the list.

## The React analogy

It's the difference between each `<InboxRow>` calling `useQuery(['chat', id])` on mount, which sends one request per row (a waterfall the Network tab makes obvious), and the `<Inbox>` calling `useQuery(['inbox'])` once and handing each row its data as props. Same screen, one request instead of a hundred.
````

- [x] **Step 2: Write the failing test for the status pill**

Create `apps/server/src/chats/inbox-status.test.ts`:

```ts
import type { InboxStatus } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import type { Activity } from './activity';
import { inboxStatus, type InboxStatusFacts } from './inbox-status';

const working: Activity = { kind: 'agent_working', who: 'leo' };

function facts(over: Partial<InboxStatusFacts> = {}): InboxStatusFacts {
  return { phase: 'reviewing', merged: false, activity: { kind: 'none' }, attention: 'none', role: 'author', you: 'maya', ...over };
}

const status = (kind: InboxStatus['kind'], who: string | null = null, reason: InboxStatus['reason'] = null): InboxStatus => ({ kind, who, reason });

describe('inboxStatus (spec §16 "Inbox", handoff §1 status pills)', () => {
  it('is merged or closed once the PR is', () => {
    expect(inboxStatus(facts({ phase: 'closed', merged: true }))).toEqual(status('merged'));
    expect(inboxStatus(facts({ phase: 'closed' }))).toEqual(status('closed'));
  });

  it('is merged even when an escalation was still waiting for you', () => {
    expect(inboxStatus(facts({ phase: 'closed', merged: true, attention: 'decision' }))).toEqual(status('merged'));
  });

  it('is escalated (the red pill) when a decision waits for you', () => {
    expect(inboxStatus(facts({ phase: 'escalated', attention: 'decision' }))).toEqual(status('escalated', null, 'decision'));
  });

  it('is needs_you, with the reason, for a manual review, a failure or drafts', () => {
    for (const attention of ['manual_review', 'failed', 'drafts'] as const) {
      expect(inboxStatus(facts({ attention }))).toEqual(status('needs_you', null, attention));
    }
  });

  it('puts what you have to do before an agent at work', () => {
    expect(inboxStatus(facts({ attention: 'failed', activity: working }))).toEqual(status('needs_you', null, 'failed'));
  });

  it('is ready for a reviewer, and their turn (approving) for the author, once nothing is open', () => {
    expect(inboxStatus(facts({ phase: 'ready', role: 'reviewer' }))).toEqual(status('ready'));
    expect(inboxStatus(facts({ phase: 'ready', role: 'author' }))).toEqual(status('their_turn'));
  });

  it('is waiting, with who and why, when an agent can not start', () => {
    expect(inboxStatus(facts({ activity: { kind: 'agent_waiting', who: 'leo', why: 'offline', offlineSince: null } }))).toEqual(status('waiting', 'leo', 'offline'));
    expect(inboxStatus(facts({ activity: { kind: 'agent_waiting', who: 'leo', why: 'repo_not_linked' } }))).toEqual(status('waiting', 'leo', 'repo_not_linked'));
    expect(inboxStatus(facts({ activity: { kind: 'agent_waiting', who: 'leo', why: 'cap_reached' } }))).toEqual(status('waiting', 'leo', 'cap_reached'));
  });

  it("is working, with whose agent, while one works", () => {
    expect(inboxStatus(facts({ activity: working }))).toEqual(status('working', 'leo'));
  });

  it("is their turn when a person is up, and needs_you when that person is you", () => {
    expect(inboxStatus(facts({ phase: 'addressing', activity: { kind: 'human_turn', who: 'leo' } }))).toEqual(status('their_turn', 'leo'));
    expect(inboxStatus(facts({ phase: 'addressing', activity: { kind: 'human_turn', who: 'maya' } }))).toEqual(status('needs_you'));
  });

  it('is quiet when nothing is pending', () => {
    expect(inboxStatus(facts())).toEqual(status('quiet'));
    expect(inboxStatus(facts({ phase: 'idle' }))).toEqual(status('quiet'));
  });
});
```

- [x] **Step 3: Run it to see it fail**

Run: `npm run test:unit -w apps/server -- src/chats/inbox-status.test.ts`
Expected: FAIL, `Error: Cannot find module './inbox-status'`.

- [x] **Step 4: The `InboxStatus` body**

Append to `packages/protocol/src/web-api.ts`:

```ts

/**
 * A row's status pill in the inbox (spec §16, handoff §1), worked out on the server for the person reading
 * it (`apps/server/src/chats/inbox-status.ts`). `who` is a GitHub login ("leo" → "Leo's agent working");
 * `reason` says why someone waits or is needed. `quiet` shows no pill.
 */
export const InboxStatus = z.object({
  kind: z.enum(['working', 'waiting', 'their_turn', 'needs_you', 'escalated', 'ready', 'merged', 'closed', 'quiet']),
  who: z.string().nullable(),
  reason: z.enum(['offline', 'repo_not_linked', 'cap_reached', 'decision', 'manual_review', 'failed', 'drafts']).nullable(),
});
export type InboxStatus = z.infer<typeof InboxStatus>;
```

In `packages/protocol/src/web-api.test.ts`, import it (`import { InboxStatus, WebMe } from './web-api';`) and add, after the last test:

```ts

  it('knows every inbox status, and nothing else', () => {
    expect(InboxStatus.parse({ kind: 'waiting', who: 'leo', reason: 'offline' })).toEqual({ kind: 'waiting', who: 'leo', reason: 'offline' });
    expect(() => InboxStatus.parse({ kind: 'busy', who: null, reason: null })).toThrow();
  });
```

- [x] **Step 5: Work out the pill**

Create `apps/server/src/chats/inbox-status.ts`:

```ts
import type { Attention, InboxStatus, Phase, Role } from '@nitpilot/protocol';
import type { Activity } from './activity';

/** What a chat looks like to one person reading their inbox. */
export type InboxStatusFacts = {
  phase: Phase;
  merged: boolean;
  activity: Activity;
  /** The reader's attention in this chat, for this role. */
  attention: Attention;
  /** The reader's role in this chat: the author's row and a reviewer's row can differ. */
  role: Role;
  /** The reader's GitHub login, so "your turn" can be told from "their turn". */
  you: string;
};

/**
 * The status pill of one inbox row (spec §16, handoff §1). Rules are checked in order, most important first:
 * a finished PR, then what you have to do, then a ready chat, then what the agents and people are doing.
 */
export function inboxStatus(f: InboxStatusFacts): InboxStatus {
  if (f.merged) return pill('merged');
  if (f.phase === 'closed') return pill('closed');

  if (f.attention === 'decision') return pill('escalated', null, 'decision');
  if (f.attention !== 'none') return pill('needs_you', null, f.attention);

  // Nothing open: the reviewer approves on GitHub, and the author waits for that.
  if (f.phase === 'ready') return pill(f.role === 'reviewer' ? 'ready' : 'their_turn');

  const a = f.activity;
  if (a.kind === 'agent_waiting') return pill('waiting', a.who, a.why);
  if (a.kind === 'agent_working') return pill('working', a.who);
  if (a.kind === 'human_turn') return a.who === f.you ? pill('needs_you') : pill('their_turn', a.who);
  return pill('quiet');
}

function pill(kind: InboxStatus['kind'], who: string | null = null, reason: InboxStatus['reason'] = null): InboxStatus {
  return { kind, who, reason };
}
```

- [x] **Step 6: Run the tests to see them pass**

Run: `npm run test:unit -w apps/server -- src/chats/inbox-status.test.ts && npm test -w packages/protocol`
Expected: PASS, 10 tests; protocol 44.

- [x] **Step 7: Write the failing tests for many chats at once**

In `apps/server/src/chats/activity.test.ts`, the failure strings become typed, so mark the loop's list `as const`:

```ts
    for (const failure of ['daily_cap', 'quota'] as const) {
```

and add, before `it("is human_turn for the author …`:

```ts
  it('names the running agent before a queued one that could start too', () => {
    const jobs = [job({ login: 'sam', userId: 'user-sam' }), job({ status: 'running' })];
    expect(deriveActivity(facts({ jobs }, { 'user-sam': online([REPO]) }))).toEqual({ kind: 'agent_working', who: 'leo' });
  });

```

(This one passes at once: it pins a rule `deriveActivity` already follows and no test covered, a Plan 1b carry-forward.)

Replace `apps/server/src/chats/activity.db.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser } from '../../test/db';
import { countQueries } from '../../test/queries';
import { prisma } from '../lib/prisma';
import { loadActivities, loadActivity, type LiveClis } from './activity';

const noClis = { connectionsFor: () => [] };

/** A reviewing chat with no job, and one addressed point raised by leo, a reviewer, with this origin. */
async function chatWithAddressedPoint(origin: 'agent' | 'github') {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
  await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'reviewing' } });
  await prisma.participant.create({ data: { chatId: chat.id, githubId: maya.githubId, role: 'author', userId: maya.id, login: 'maya' } });
  await prisma.participant.create({ data: { chatId: chat.id, githubId: leo.githubId, role: 'reviewer', userId: leo.id, login: 'leo' } });
  await prisma.point.create({
    data: { chatId: chat.id, number: 1, raisedByGithubId: leo.githubId, origin, severity: 'major', category: 'bug', title: 'A point', body: 'Body.', status: 'addressed', authorResolution: 'answered', round: 1 },
  });
  return chat;
}

/** A reviewing chat whose reviewer has a review job in this state. Their CLI was last seen at `lastSeenAt`. */
async function chatWithJob(status: 'queued' | 'running', lastSeenAt: Date) {
  const author = await makeUser();
  const reviewer = await makeUser();
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: author.githubId });
  await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'reviewing' } });
  const participant = await prisma.participant.create({ data: { chatId: chat.id, githubId: reviewer.githubId, role: 'reviewer', userId: reviewer.id, login: reviewer.login } });
  await prisma.job.create({ data: { chatId: chat.id, participantId: participant.id, activeFor: participant.id, userId: reviewer.id, type: 'review', status, round: 1, headSha: chat.headSha } });
  await prisma.cliToken.create({ data: { userId: reviewer.id, name: 'laptop', tokenHash: `hash-${reviewer.id}`, prefix: 'nit_x', lastSeenAt } });
  return { chat, reviewer };
}

describe('loadActivity (spec §9.1)', () => {
  it("is nobody's turn for an addressed point an agent raised", async () => {
    const chat = await chatWithAddressedPoint('agent');
    expect(await loadActivity(chat.id, noClis)).toEqual({ kind: 'none' });
  });

  it("is the reviewer's turn for an addressed point they raised on GitHub", async () => {
    const chat = await chatWithAddressedPoint('github');
    expect(await loadActivity(chat.id, noClis)).toEqual({ kind: 'human_turn', who: 'leo' });
  });

  it("is none for a chat that is gone, so a page that read it a moment ago still renders", async () => {
    expect(await loadActivity('no-such-chat', noClis)).toEqual({ kind: 'none' });
  });
});

describe('loadActivities (many chats at once, for the inbox)', () => {
  it('gives each chat the answer loadActivity gives it', async () => {
    const seen = new Date('2026-10-15T09:30:00.000Z');
    const a = await chatWithJob('running', seen);
    const b = await chatWithJob('queued', seen);
    const c = await chatWithAddressedPoint('github');
    const clis: LiveClis = { connectionsFor: () => [] };

    const all = await loadActivities([a.chat.id, b.chat.id, c.id], clis);
    expect(all.get(a.chat.id)).toEqual({ kind: 'agent_working', who: a.reviewer.login });
    expect(all.get(b.chat.id)).toEqual({ kind: 'agent_waiting', who: b.reviewer.login, why: 'offline', offlineSince: seen });
    expect(all.get(c.id)).toEqual({ kind: 'human_turn', who: 'leo' });
    for (const id of [a.chat.id, b.chat.id, c.id]) expect(all.get(id)).toEqual(await loadActivity(id, clis));
  });

  it('reads three chats with as many queries as one (no query per chat)', async () => {
    const seen = new Date('2026-10-15T09:30:00.000Z');
    const chats = [await chatWithJob('queued', seen), await chatWithJob('queued', seen), await chatWithJob('running', seen)];
    const one = await countQueries(() => loadActivities([chats[0]!.chat.id], noClis));
    const three = await countQueries(() => loadActivities(chats.map((c) => c.chat.id), noClis));
    expect(one).toBeGreaterThan(0);
    expect(three).toBe(one);
  });

  it('asks the database nothing for no chats', async () => {
    expect(await countQueries(() => loadActivities([], noClis))).toBe(0);
  });
});
```

- [x] **Step 8: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/chats/activity.db.test.ts`
Expected: FAIL, 4 tests: `TypeError: loadActivities is not a function` (3), and the gone chat throws `PrismaClientKnownRequestError` (`findUniqueOrThrow`).

- [x] **Step 9: Read many chats with a fixed number of queries**

In `apps/server/src/chats/activity.ts`:

1. The first import becomes `import { FailureReason, type Phase } from '@nitpilot/protocol';`.
2. `ActiveJob.failure` becomes typed: `export type ActiveJob = { login: string; userId: string; status: 'queued' | 'running'; runAfter: Date; failure: FailureReason | null };`
3. So does the set of limits: `const LIMITS: ReadonlySet<FailureReason> = new Set(['daily_cap', 'quota']);`
4. Replace `loadActivity` (from its doc comment to the end of the file) with:

```ts
/** The activity of one chat, read from the database and the connected CLIs. A chat that is gone has none. */
export async function loadActivity(chatId: string, clis: LiveClis, now = new Date()): Promise<Activity> {
  const activities = await loadActivities([chatId], clis, now);
  return activities.get(chatId) ?? { kind: 'none' };
}

/**
 * The activity of many chats, by chat id, for the inbox. The number of queries doesn't grow with the number
 * of chats: one read of the chats with their people, points and jobs, and one of when each person's CLIs were
 * last seen (docs/why/n-plus-one-queries.md). A chat id that doesn't exist is left out.
 */
export async function loadActivities(chatIds: string[], clis: LiveClis, now = new Date()): Promise<Map<string, Activity>> {
  if (chatIds.length === 0) return new Map();
  const chats = await prisma.prChat.findMany({
    where: { id: { in: chatIds } },
    include: {
      repo: true,
      participants: true,
      // Only a point a person raised on GitHub waits for them to answer; an agent's point doesn't.
      points: { where: { status: 'addressed', origin: 'github' }, orderBy: { number: 'asc' } },
      jobs: { where: { status: { in: ['queued', 'running'] } }, include: { participant: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  const userIds = [...new Set(chats.flatMap((chat) => chat.jobs.map((j) => j.userId)))];
  // When each of them was last seen: the newest lastSeenAt of their CLI tokens (spec §8).
  const seen = userIds.length > 0 ? await prisma.cliToken.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { lastSeenAt: true } }) : [];
  const lastSeen = (userId: string) => seen.find((s) => s.userId === userId)?._max.lastSeenAt ?? null;
  const presence = (userId: string): Presence => ({ connected: clis.connectionsFor(userId).map((c) => c.repos), lastSeenAt: lastSeen(userId) });

  const activities = new Map<string, Activity>();
  for (const chat of chats) {
    const loginOf = (githubId: string) => chat.participants.find((p) => p.githubId === githubId)?.login ?? null;
    activities.set(
      chat.id,
      deriveActivity({
        phase: chat.phase as Phase,
        repoFullName: chat.repo.fullName,
        author: loginOf(chat.authorGithubId),
        reviewerToAnswer: chat.points[0] ? loginOf(chat.points[0].raisedByGithubId) : null,
        jobs: chat.jobs.map((j) => ({ login: j.participant.login, userId: j.userId, status: j.status as ActiveJob['status'], runAfter: j.runAfter, failure: failureOf(j.failure) })),
        presence,
        now,
      }),
    );
  }
  return activities;
}

/** The stored failure as a FailureReason, or null for one this version doesn't know. */
function failureOf(stored: string | null): FailureReason | null {
  const parsed = FailureReason.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
```

`transcript.tsx` keeps calling `loadActivity(chat.id, …)`: a chat deleted between its two reads now shows no activity instead of a 500 (Plan 1b's "chat read twice" minor).

- [x] **Step 10: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/chats/activity.test.ts && npm run test:db -w apps/server -- src/chats/activity.db.test.ts`
Expected: PASS, 10 and 6 tests.

- [x] **Step 11: The transcript's plain 403 (carry-forward)**

A route-level test that GitHub's plain 403 (no rate limit) renders "Nothing here", like its 404. In `apps/server/src/http/routes/transcript.db.test.ts`, give `scene` a `forbidden` option:

```ts
async function scene(opts: { canRead?: boolean; forbidden?: boolean; revoked?: boolean; githubDown?: boolean; clis?: (leoId: string) => LiveClis } = {}) {
```

and in its `fakeFetch`, answer it after the `canRead === false` case:

```ts
  const github = fakeFetch({ [`GET /repos/${repo.fullName}`]: () => (opts.githubDown ? json({ message: 'Server Error' }, 500) : opts.revoked ? json({ message: 'Bad credentials' }, 401) : opts.canRead === false ? json({ message: 'Not Found' }, 404) : opts.forbidden ? json({ message: 'Resource not accessible' }, 403) : { id: Number(repo.id) }) });
```

Add, after the test "answers 404 when GitHub says the viewer can't read the repo …":

```ts
  it("shows 'Nothing here' when GitHub answers a plain 403 (no rate limit), like a 404", async () => {
    const { maya, view } = await scene({ forbidden: true });
    await githubAuthFor(maya.id);
    const res = await view(maya.id);
    expect(res.status).toBe(404);
    expect(await textOf(res)).toContain('Nothing here');
  });
```

Run: `npm run test:db -w apps/server -- src/http/routes/transcript.db.test.ts`
Expected: PASS, 16 tests (the new one passes at once: it pins `RepoAccess`'s existing rule at the route).

- [x] **Step 12: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: protocol 44, CLI 293 passed + 14 skipped, server 637, web 28; typecheck and lint clean.

- [x] **Step 13: Commit**

```bash
git add packages/protocol/src/web-api.ts packages/protocol/src/web-api.test.ts apps/server/src/lib/prisma.ts apps/server/test/queries.ts apps/server/src/chats/inbox-status.ts apps/server/src/chats/inbox-status.test.ts apps/server/src/chats/activity.ts apps/server/src/chats/activity.test.ts apps/server/src/chats/activity.db.test.ts apps/server/src/http/routes/transcript.db.test.ts docs/why/n-plus-one-queries.md docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(server): inbox status, and the activity of many chats in a fixed number of queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: `GET /api/inbox`, `ChatRead` and unread counts

**Files:**
- Create: `apps/server/src/chats/inbox.ts`, `apps/server/src/chats/inbox.db.test.ts`, `apps/server/src/http/routes/inbox.ts`, `apps/server/src/http/routes/inbox.db.test.ts`, the migration `apps/server/prisma/migrations/<timestamp>_chat_read/`.
- Modify: `apps/server/prisma/schema.prisma` (`ChatRead`), `packages/protocol/src/web-api.ts` and its test (`InboxRow`, `InboxResponse`, `MarkReadRequest`, `WebMe.agentOnline`), `apps/server/src/http/routes/me.ts` and `me.db.test.ts`, `apps/server/src/http/app.ts`, `apps/server/test/db.ts` (`makeParticipant`, `makeMessage`), `apps/web/src/routes/Home/Home.test.tsx` (its `/api/me` answers gain `agentOnline`), `docs/superpowers/specs/2026-10-07-nitpilot-design.md` (§10: what marking read needs; §16: how the inbox status is worked out).

**Interfaces:**
- Consumes: `loadActivities`, `inboxStatus`, `countQueries` (Task 4); `requireUser`, `requireSameOrigin`, `UserVariables` (Task 3); `rulesFromJson` (`chats/rules.ts`); `isUniqueViolation` (`lib/prisma.ts`).
- Produces: model `ChatRead { id, userId, chatId, lastReadSeq Int @default(0), createdAt, updatedAt; @@unique([userId, chatId]) }`, cascading from `User` and `PrChat`. `InboxRow = { chatId, repo, number, title, url (the PR on GitHub), role: Role, other: { login: string; avatarUrl: string | null; agentActive: boolean } | null, status: InboxStatus, round, maxRounds, lastActivity, updatedAt, unread, needsYou }`; `InboxResponse = { rows: InboxRow[] }`; `MarkReadRequest = { seq: int ≥ 0 }`; `WebMe.agentOnline: boolean`. `loadInboxRows(user: InboxViewer, clis, now?): Promise<InboxRow[]>`, `loadInboxRow(chatId, userId, clis, now?): Promise<InboxRow[]>` (one row per role that person has in that chat, for Task 9's `inbox.upsert`), `unreadCounts(user, chats): Promise<Map<string, number>>` with `InboxViewer = { id; githubId; login }` (`chats/inbox.ts`). `inboxRoutes(deps: { clis })`: `GET /api/inbox` → `InboxResponse`; `POST /api/chats/:id/read { seq }` → 204. `meRoutes(deps: { clis })`. Test helpers `makeParticipant(chatId, user, role, over?)` and `makeMessage(chatId, author | null, body?)`.

- [x] **Step 1: The `ChatRead` table**

In `apps/server/prisma/schema.prisma`, add the back-relations: `chatReads     ChatRead[]` as the last field of `User` (after `jobs`), and `reads        ChatRead[]` after `githubWrites GithubWrite[]` in `PrChat`. Then add the model before `/// One item in a chat's timeline.`:

```prisma
/// How far a person has read a chat (Plan 2). The inbox's unread count is the number of timeline items
/// after `lastReadSeq` that someone else wrote.
model ChatRead {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  chatId      String
  chat        PrChat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  lastReadSeq Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, chatId])
}
```

Run: `npm run db:migrate -w apps/server -- --name chat_read`, then `npm run db:generate -w apps/server` (Prisma 7's `migrate dev` no longer regenerates the client by itself; without this step `prisma.chatRead` doesn't exist).
Expected: a new `prisma/migrations/<timestamp>_chat_read/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "ChatRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRead_userId_chatId_key" ON "ChatRead"("userId", "chatId");

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "PrChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [x] **Step 2: The inbox bodies**

Replace `packages/protocol/src/web-api.ts` with:

```ts
import { z } from 'zod';
import { MeResponse } from './api';
import { Role } from './enums';

// REST bodies the web app reads and sends (spec §10 "REST endpoints in Plan 2"). The web app parses every
// answer with these, as the CLI does with api.ts.

/**
 * `GET /api/me`, as the web app reads it: the CLI's answer plus who you are. The CLI parses the same answer
 * with `MeResponse`, which ignores the extra fields. Later milestones add settings, onboarding and push.
 */
export const WebMe = MeResponse.extend({
  id: z.string(),
  githubId: z.string(),
  /** True while any of your CLIs is connected: the inbox's "Your agent is offline" banner reads it. */
  agentOnline: z.boolean(),
});
export type WebMe = z.infer<typeof WebMe>;

/**
 * A row's status pill in the inbox (spec §16, handoff §1), worked out on the server for the person reading
 * it (`apps/server/src/chats/inbox-status.ts`). `who` is a GitHub login ("leo" → "Leo's agent working");
 * `reason` says why someone waits or is needed. `quiet` shows no pill.
 */
export const InboxStatus = z.object({
  kind: z.enum(['working', 'waiting', 'their_turn', 'needs_you', 'escalated', 'ready', 'merged', 'closed', 'quiet']),
  who: z.string().nullable(),
  reason: z.enum(['offline', 'repo_not_linked', 'cap_reached', 'decision', 'manual_review', 'failed', 'drafts']).nullable(),
});
export type InboxStatus = z.infer<typeof InboxStatus>;

/** One row of `GET /api/inbox`: one chat, seen in one of your roles (an author who also reviews gets two rows). */
export const InboxRow = z.object({
  chatId: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  /** The PR on GitHub. */
  url: z.string(),
  role: Role,
  /** The person on the other side: a reviewer for your PR, the author for a review. */
  other: z.object({ login: z.string(), avatarUrl: z.string().nullable(), agentActive: z.boolean() }).nullable(),
  status: InboxStatus,
  round: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  /** The newest timeline item, on one line. */
  lastActivity: z.string(),
  updatedAt: z.string(),
  /** Timeline items someone else wrote after the last one you read. */
  unread: z.number().int().nonnegative(),
  /** Counts toward the tab's "need you" badge. */
  needsYou: z.boolean(),
});
export type InboxRow = z.infer<typeof InboxRow>;

export const InboxResponse = z.object({ rows: z.array(InboxRow) });
export type InboxResponse = z.infer<typeof InboxResponse>;

/** `POST /api/chats/:id/read`: you've read up to this timeline item. */
export const MarkReadRequest = z.object({ seq: z.number().int().nonnegative() });
export type MarkReadRequest = z.infer<typeof MarkReadRequest>;
```

Replace `packages/protocol/src/web-api.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { MeResponse } from './api';
import { InboxResponse, InboxStatus, MarkReadRequest, WebMe, type InboxRow } from './web-api';

describe('web API bodies', () => {
  const me: WebMe = { id: 'user_1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };

  it('round-trips WebMe', () => {
    expect(WebMe.parse(JSON.parse(JSON.stringify(me)))).toEqual(me);
  });

  it('leaves the CLI able to read the same /api/me answer', () => {
    expect(MeResponse.parse(me)).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'ok' });
  });

  it('knows every inbox status, and nothing else', () => {
    expect(InboxStatus.parse({ kind: 'waiting', who: 'leo', reason: 'offline' })).toEqual({ kind: 'waiting', who: 'leo', reason: 'offline' });
    expect(() => InboxStatus.parse({ kind: 'busy', who: null, reason: null })).toThrow();
  });

  it('round-trips an inbox row, and refuses a negative read cursor', () => {
    const row: InboxRow = {
      chatId: 'chat_1', repo: 'acme/shop-api', number: 142, title: 'Cursor pagination', url: 'https://github.com/acme/shop-api/pull/142',
      role: 'author', other: { login: 'leo', avatarUrl: null, agentActive: true }, status: { kind: 'working', who: 'leo', reason: null },
      round: 2, maxRounds: 3, lastActivity: 'leo raised 2 points', updatedAt: '2026-10-15T12:00:00.000Z', unread: 2, needsYou: false,
    };
    expect(InboxResponse.parse(JSON.parse(JSON.stringify({ rows: [row] })))).toEqual({ rows: [row] });
    expect(() => MarkReadRequest.parse({ seq: -1 })).toThrow();
  });
});
```

In `apps/web/src/routes/Home/Home.test.tsx`, both `/api/me` answers gain the new field: `{ id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true }` (Task 6 rewrites this file).

Run: `npm test -w packages/protocol`
Expected: PASS, 45 tests. (`npm run typecheck` fails in `me.ts` until Step 8: `agentOnline` is missing there.)

- [x] **Step 3: Test helpers for people and timeline items**

In `apps/server/test/db.ts`, add before `resetDb`:

```ts
/** `user` as a participant of a chat, the way the dispatcher saves one. */
export async function makeParticipant(
  chatId: string,
  user: { id?: string; githubId: string; login: string },
  role: 'author' | 'reviewer',
  over: { requested?: boolean; attention?: string } = {},
) {
  return prisma.participant.create({
    data: { chatId, githubId: user.githubId, login: user.login, userId: user.id ?? null, role, requested: over.requested ?? false, attention: over.attention ?? 'none' },
  });
}

/** The chat's next timeline item, with its seq taken the way the dispatcher takes one (`++lastSeq`). `author` null = a system item. */
export async function makeMessage(chatId: string, author: { githubId: string; login: string } | null, body = 'Something happened.') {
  const chat = await prisma.prChat.update({ where: { id: chatId }, data: { lastSeq: { increment: 1 } } });
  return prisma.message.create({
    data: { chatId, seq: chat.lastSeq, kind: author ? 'human' : 'system', authorGithubId: author?.githubId ?? null, authorLogin: author?.login ?? null, body },
  });
}
```

(`resetDb`'s `TRUNCATE … CASCADE` empties `ChatRead` with `User` and `PrChat`.)

- [x] **Step 4: Write the failing tests for the rows**

Create `apps/server/src/chats/inbox.db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage, makeParticipant, makeRepo, makeUser } from '../../test/db';
import { countQueries } from '../../test/queries';
import type { SessionUser } from '../auth/session';
import { prisma } from '../lib/prisma';
import type { LiveClis } from './activity';
import { loadInboxRow, loadInboxRows } from './inbox';

const noClis: LiveClis = { connectionsFor: () => [] };
const DAY = 86_400_000;

const viewer = (u: { id: string; githubId: string; login: string; avatarUrl: string | null }): SessionUser => ({ id: u.id, githubId: u.githubId, login: u.login, avatarUrl: u.avatarUrl });

/** maya's PR, reviewed by leo (requested, on Nitpilot) and sam (not on Nitpilot). */
async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await prisma.user.update({ where: { id: (await makeUser({ login: 'leo' })).id }, data: { avatarUrl: 'https://avatars.githubusercontent.com/u/2' } });
  const sam = { githubId: `gh-sam-${maya.id}`, login: 'sam' };
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  await makeParticipant(chat.id, sam, 'reviewer');
  await makeParticipant(chat.id, leo, 'reviewer', { requested: true });
  return { maya, leo, sam, repo, chat };
}

describe('loadInboxRows (spec §16 "Inbox")', () => {
  it('lists the author row with the requested reviewer, and the reviewer row with the author', async () => {
    const { maya, leo, repo, chat } = await scene();
    const [mine] = await loadInboxRows(viewer(maya), noClis);
    expect(mine).toMatchObject({
      chatId: chat.id, repo: repo.fullName, number: chat.number, title: chat.title, url: chat.url, role: 'author',
      other: { login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/2', agentActive: false },
      status: { kind: 'quiet', who: null, reason: null }, round: 1, maxRounds: 3, needsYou: false,
    });
    const [review] = await loadInboxRows(viewer(leo), noClis);
    expect(review).toMatchObject({ chatId: chat.id, role: 'reviewer', other: { login: 'maya', avatarUrl: `https://avatars.githubusercontent.com/u/${maya.githubId}` } });
  });

  it('gives a person who is both author and reviewer one row per role', async () => {
    const { maya, chat } = await scene();
    await makeParticipant(chat.id, maya, 'reviewer');
    const rows = await loadInboxRows(viewer(maya), noClis);
    expect(rows.map((r) => r.role).sort()).toEqual(['author', 'reviewer']);
  });

  it("keeps chats closed in the last 14 days, and never lists someone else's chat", async () => {
    const { maya, leo, repo } = await scene();
    const recent = await makeChat(repo.id, { authorGithubId: maya.githubId });
    await makeParticipant(recent.id, maya, 'author');
    await prisma.prChat.update({ where: { id: recent.id }, data: { phase: 'closed', closedAt: new Date(Date.now() - 2 * DAY) } });
    const old = await makeChat(repo.id, { authorGithubId: maya.githubId });
    await makeParticipant(old.id, maya, 'author');
    await prisma.prChat.update({ where: { id: old.id }, data: { phase: 'closed', closedAt: new Date(Date.now() - 15 * DAY) } });
    const leosOwn = await makeChat(repo.id, { authorGithubId: leo.githubId });
    await makeParticipant(leosOwn.id, leo, 'author');

    const ids = (await loadInboxRows(viewer(maya), noClis)).map((r) => r.chatId);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(old.id);
    expect(ids).not.toContain(leosOwn.id);
  });

  it('marks the other side’s agent active while it has a job, and says who works', async () => {
    const { maya, leo, chat } = await scene();
    const leoAsReviewer = await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, githubId: leo.githubId } });
    await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'reviewing' } });
    await prisma.job.create({ data: { chatId: chat.id, participantId: leoAsReviewer.id, activeFor: leoAsReviewer.id, userId: leo.id, type: 'review', status: 'running', round: 1, headSha: chat.headSha } });
    const [row] = await loadInboxRows(viewer(maya), noClis);
    expect(row!.other).toMatchObject({ login: 'leo', agentActive: true });
    expect(row!.status).toEqual({ kind: 'working', who: 'leo', reason: null });
  });

  it('counts a ready chat as needing the reviewer, not the author', async () => {
    const { maya, leo, chat } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'ready' } });
    expect((await loadInboxRows(viewer(leo), noClis))[0]).toMatchObject({ status: { kind: 'ready' }, needsYou: true });
    expect((await loadInboxRows(viewer(maya), noClis))[0]).toMatchObject({ status: { kind: 'their_turn' }, needsYou: false });
  });

  it('shows the newest timeline item on one line, cut at 120 characters', async () => {
    const { maya, leo, chat } = await scene();
    await makeMessage(chat.id, null, 'Pull request opened by maya');
    await makeMessage(chat.id, leo, `First line\nsecond   line ${'x'.repeat(200)}`);
    const [row] = await loadInboxRows(viewer(maya), noClis);
    expect(row!.lastActivity).toHaveLength(120);
    expect(row!.lastActivity.startsWith('First line second line xxx')).toBe(true);
    expect(row!.lastActivity.endsWith('…')).toBe(true);
  });

  it("counts as unread everything someone else wrote (system items too) until the person reads it, and never their own", async () => {
    const { maya, leo, chat } = await scene();
    await makeMessage(chat.id, null); // 1: system
    await makeMessage(chat.id, leo); // 2
    await makeMessage(chat.id, maya); // 3: maya's own
    await makeMessage(chat.id, leo); // 4
    await makeMessage(chat.id, leo); // 5
    await makeMessage(chat.id, leo); // 6
    expect((await loadInboxRows(viewer(maya), noClis))[0]!.unread).toBe(5);

    await prisma.chatRead.create({ data: { userId: maya.id, chatId: chat.id, lastReadSeq: 5 } });
    expect((await loadInboxRows(viewer(maya), noClis))[0]!.unread).toBe(1);
  });

  it('reads 30 chats with as many queries as one (no query per chat)', async () => {
    const { maya, leo, repo, chat } = await scene();
    await makeMessage(chat.id, leo);
    const user = viewer(maya);
    const one = await countQueries(() => loadInboxRows(user, noClis));
    for (let i = 0; i < 29; i++) {
      const more = await makeChat(repo.id, { authorGithubId: maya.githubId });
      await makeParticipant(more.id, maya, 'author');
      await makeParticipant(more.id, leo, 'reviewer', { requested: true });
      await makeMessage(more.id, leo);
    }
    const rows = await loadInboxRows(user, noClis);
    expect(rows).toHaveLength(30);
    expect(await countQueries(() => loadInboxRows(user, noClis))).toBe(one);
  });
});

describe('loadInboxRow (one chat, for live updates)', () => {
  it('gives the same rows the full list gives for that chat', async () => {
    const { maya, chat } = await scene();
    await makeParticipant(chat.id, maya, 'reviewer');
    const all = (await loadInboxRows(viewer(maya), noClis)).filter((r) => r.chatId === chat.id);
    expect(await loadInboxRow(chat.id, maya.id, noClis)).toEqual(all);
  });
});
```

- [x] **Step 5: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/chats/inbox.db.test.ts`
Expected: FAIL, `Error: Cannot find module './inbox'`.

- [x] **Step 6: Build the rows**

Create `apps/server/src/chats/inbox.ts`:

```ts
import type { Attention, InboxRow, InboxStatus, Phase, Role } from '@nitpilot/protocol';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { loadActivities, type LiveClis } from './activity';
import { inboxStatus } from './inbox-status';
import { rulesFromJson } from './rules';

/** How long a closed or merged PR stays in the inbox. */
export const CLOSED_KEEP_MS = 14 * 86_400_000;

/** The most rows the inbox lists. */
export const MAX_ROWS = 200;

/** How long the "last activity" line may be. */
const LAST_ACTIVITY_CHARS = 120;

/** The person whose inbox it is. */
export type InboxViewer = { id: string; githubId: string; login: string };

/** Each of the viewer's participant rows comes with its chat, the chat's people and its active jobs. */
const WITH_CHAT = {
  chat: {
    include: {
      repo: true,
      participants: { orderBy: { createdAt: 'asc' } },
      jobs: { where: { status: { in: ['queued', 'running'] } }, select: { participant: { select: { githubId: true } } } },
    },
  },
} satisfies Prisma.ParticipantInclude;

type Mine = Prisma.ParticipantGetPayload<{ include: typeof WITH_CHAT }>;
type Chat = Mine['chat'];

/**
 * Your inbox (spec §16): one row per chat and role you have in it, open chats and those closed in the last
 * 14 days, newest first. Every fact for every row is read with a fixed number of queries, however many
 * chats there are (docs/why/n-plus-one-queries.md).
 */
export async function loadInboxRows(user: InboxViewer, clis: LiveClis, now = new Date()): Promise<InboxRow[]> {
  const closedSince = new Date(now.getTime() - CLOSED_KEEP_MS);
  const mine = await prisma.participant.findMany({
    where: { githubId: user.githubId, chat: { OR: [{ closedAt: null }, { closedAt: { gte: closedSince } }] } },
    include: WITH_CHAT,
    orderBy: [{ chat: { updatedAt: 'desc' } }, { role: 'asc' }],
    take: MAX_ROWS,
  });
  return buildRows(user, mine, clis, now);
}

/** The rows one chat has in one person's inbox (one per role), for live updates (Task 9's `inbox.upsert`). */
export async function loadInboxRow(chatId: string, userId: string, clis: LiveClis, now = new Date()): Promise<InboxRow[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];
  const mine = await prisma.participant.findMany({ where: { chatId, githubId: user.githubId }, include: WITH_CHAT, orderBy: { role: 'asc' } });
  return buildRows(user, mine, clis, now);
}

async function buildRows(user: InboxViewer, mine: Mine[], clis: LiveClis, now: Date): Promise<InboxRow[]> {
  if (mine.length === 0) return [];
  const chats = [...new Map(mine.map((p) => [p.chat.id, p.chat])).values()];
  const others = mine.map((p) => otherSide(p, user.githubId));
  const [activities, avatars, lastItems, unread] = await Promise.all([
    loadActivities(chats.map((c) => c.id), clis, now),
    avatarsOf(others.flatMap((o) => (o ? [o.githubId] : []))),
    lastItemsOf(chats),
    unreadCounts(user, chats),
  ]);

  return mine.map((p, i): InboxRow => {
    const chat = p.chat;
    const role = p.role as Role;
    const other = others[i];
    const status = inboxStatus({
      phase: chat.phase as Phase,
      merged: chat.merged,
      activity: activities.get(chat.id) ?? { kind: 'none' },
      attention: p.attention as Attention,
      role,
      you: user.login,
    });
    return {
      chatId: chat.id,
      repo: chat.repo.fullName,
      number: chat.number,
      title: chat.title,
      url: chat.url,
      role,
      other: other
        ? { login: other.login, avatarUrl: avatars.get(other.githubId) ?? githubAvatar(other.githubId), agentActive: chat.jobs.some((j) => j.participant.githubId === other.githubId) }
        : null,
      status,
      round: chat.round,
      maxRounds: rulesFromJson(chat.repo.rulesJson).max_rounds,
      lastActivity: oneLine(lastItems.get(chat.id) ?? ''),
      updatedAt: chat.updatedAt.toISOString(),
      unread: unread.get(chat.id) ?? 0,
      needsYou: needsYou(status),
    };
  });
}

/** Who a row shows: for your PR, the first requested reviewer (else the first reviewer); for a review, the author. */
function otherSide(p: Mine, yourGithubId: string): { githubId: string; login: string } | null {
  const others = p.chat.participants.filter((q) => q.githubId !== yourGithubId);
  if (p.role === 'author') return others.find((q) => q.role === 'reviewer' && q.requested) ?? others.find((q) => q.role === 'reviewer') ?? null;
  return others.find((q) => q.role === 'author') ?? null;
}

/** The tab badge counts these (handoff "State management"). A ready chat is only ever a reviewer's `ready`. */
function needsYou(status: InboxStatus): boolean {
  return status.kind === 'needs_you' || status.kind === 'escalated' || status.kind === 'ready';
}

/** Profile pictures of the people who are on Nitpilot, by GitHub id. */
async function avatarsOf(githubIds: string[]): Promise<Map<string, string>> {
  if (githubIds.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { githubId: { in: [...new Set(githubIds)] } }, select: { githubId: true, avatarUrl: true } });
  return new Map(users.flatMap((u) => (u.avatarUrl ? [[u.githubId, u.avatarUrl] as const] : [])));
}

/** GitHub's public profile picture for anyone, on Nitpilot or not. */
function githubAvatar(githubId: string): string {
  return `https://avatars.githubusercontent.com/u/${githubId}`;
}

/** The body of each chat's newest timeline item: the one whose seq is the chat's `lastSeq`. */
async function lastItemsOf(chats: Chat[]): Promise<Map<string, string>> {
  const newest = chats.filter((c) => c.lastSeq > 0).map((c) => ({ chatId: c.id, seq: c.lastSeq }));
  if (newest.length === 0) return new Map();
  const items = await prisma.message.findMany({ where: { OR: newest }, select: { chatId: true, body: true } });
  return new Map(items.map((m) => [m.chatId, m.body]));
}

/**
 * How many timeline items in each chat someone else wrote after the last one `user` read (spec §8 `ChatRead`).
 * System items have no author and count. No `ChatRead` row means nothing was read yet.
 */
export async function unreadCounts(user: InboxViewer, chats: Pick<Chat, 'id' | 'lastSeq'>[]): Promise<Map<string, number>> {
  if (chats.length === 0) return new Map();
  const reads = await prisma.chatRead.findMany({ where: { userId: user.id, chatId: { in: chats.map((c) => c.id) } } });
  const lastRead = (chatId: string) => reads.find((r) => r.chatId === chatId)?.lastReadSeq ?? 0;
  const behind = chats.filter((c) => c.lastSeq > lastRead(c.id));
  if (behind.length === 0) return new Map();
  const counts = await prisma.message.groupBy({
    by: ['chatId'],
    where: {
      AND: [
        { OR: behind.map((c) => ({ chatId: c.id, seq: { gt: lastRead(c.id) } })) },
        { OR: [{ authorGithubId: null }, { authorGithubId: { not: user.githubId } }] },
      ],
    },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.chatId, c._count._all]));
}

/** One line of at most 120 characters, with … when it was cut. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LAST_ACTIVITY_CHARS ? `${flat.slice(0, LAST_ACTIVITY_CHARS - 1)}…` : flat;
}
```

- [x] **Step 7: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/chats/inbox.db.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 8: Write the failing route tests**

Create `apps/server/src/http/routes/inbox.db.test.ts`:

```ts
import { InboxResponse } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeMessage, makeParticipant, makeRepo, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';
import { prisma } from '../../lib/prisma';

const ORIGIN = 'http://localhost:8787'; // PUBLIC_URL in test/test-env.ts

/** maya's PR with leo reviewing, and six items in its timeline, all written by leo. */
async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  await makeParticipant(chat.id, leo, 'reviewer', { requested: true });
  for (let i = 0; i < 6; i++) await makeMessage(chat.id, leo);
  const app = testApp();
  const cookie = await sessionCookieFor(maya.id);
  const inbox = async () => InboxResponse.parse(await (await app.request('/api/inbox', { headers: { cookie } })).json());
  const read = (seq: unknown, headers: Record<string, string> = { origin: ORIGIN }, chatId = chat.id) =>
    app.request(`/api/chats/${chatId}/read`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ seq }) });
  return { maya, leo, chat, app, cookie, inbox, read };
}

describe('GET /api/inbox', () => {
  it('lists the signed-in person’s chats', async () => {
    const { chat, inbox } = await scene();
    const { rows } = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chatId: chat.id, role: 'author', unread: 6 });
  });

  it('is a 401 for a browser that is not signed in', async () => {
    expect((await testApp().request('/api/inbox')).status).toBe(401);
  });
});

describe('POST /api/chats/:id/read', () => {
  it('moves the read cursor, so only later items count as unread', async () => {
    const { read, inbox } = await scene();
    expect((await read(5)).status).toBe(204);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it('never moves the cursor back', async () => {
    const { read, inbox } = await scene();
    await read(5);
    expect((await read(2)).status).toBe(204);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it('stops at the newest item, so items that arrive later are unread', async () => {
    const { leo, chat, read, inbox } = await scene();
    await read(999);
    await makeMessage(chat.id, leo);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it("is a 404 for a chat you're not part of, or one that doesn't exist", async () => {
    const { read } = await scene();
    const outsider = await scene();
    expect((await read(1, { origin: ORIGIN }, outsider.chat.id)).status).toBe(404);
    expect((await read(1, { origin: ORIGIN }, 'no-such-chat')).status).toBe(404);
  });

  it('is a 403 from another site (the Origin check), and a 400 for a bad seq', async () => {
    const { read } = await scene();
    expect((await read(1, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await read(-1)).status).toBe(400);
  });

  it('stores one cursor per person and chat, however many times it is called', async () => {
    const { maya, chat, read } = await scene();
    await Promise.all([read(3), read(4), read(2)]);
    const rows = await prisma.chatRead.findMany({ where: { userId: maya.id, chatId: chat.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastReadSeq).toBe(4);
  });
});
```

In `apps/server/src/http/routes/me.db.test.ts`, the first test's expected body gains `agentOnline: false` (`…, githubAuth: 'needs_reauth', agentOnline: false });`), and a test follows it:

```ts

  it('says whether any of your CLIs is connected', async () => {
    const user = await makeUser({ login: 'maya-online' });
    const clis = { connectionsFor: (userId: string) => (userId === user.id ? [{ repos: new Set<string>() }] : []) };
    const res = await testApp({ clis }).request('/api/me', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await res.json()).toMatchObject({ agentOnline: true });
  });
```

Run: `npm run test:db -w apps/server -- src/http/routes/inbox.db.test.ts src/http/routes/me.db.test.ts`
Expected: FAIL: everything new except the 404 test, which passes already because the route doesn't exist yet (the app's JSON 404 answers).

- [x] **Step 9: The routes**

Create `apps/server/src/http/routes/inbox.ts`:

```ts
import { MarkReadRequest, type InboxResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import type { LiveClis } from '../../chats/activity';
import { loadInboxRows } from '../../chats/inbox';
import { isUniqueViolation, prisma } from '../../lib/prisma';
import { HttpError } from '../errors';

/** `GET /api/inbox` and `POST /api/chats/:id/read` (spec §10 "REST endpoints in Plan 2"). */
export function inboxRoutes(deps: { clis: LiveClis }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/inbox', requireUser, async (c) => {
    const body: InboxResponse = { rows: await loadInboxRows(c.get('user'), deps.clis) };
    return c.json(body);
  });

  // You've read the chat up to `seq`. Only someone in the chat has a cursor; for anyone else the chat
  // doesn't exist, like everywhere else (spec §16).
  app.post('/api/chats/:id/read', requireUser, requireSameOrigin, async (c) => {
    const { seq } = MarkReadRequest.parse(await c.req.json());
    const user = c.get('user');
    const chat = await prisma.prChat.findFirst({ where: { id: c.req.param('id'), participants: { some: { githubId: user.githubId } } } });
    if (!chat) throw new HttpError('not_found', 'No such chat.');
    // Never past the newest item: items that arrive later must count as unread.
    const upTo = Math.min(seq, chat.lastSeq);
    const key = { userId: user.id, chatId: chat.id };
    // Two tabs can mark the same chat at the same moment. Both may find no row and both create one; the
    // unique (userId, chatId) lets only one through, and the other carries on. Then the cursor only moves forward.
    try {
      await prisma.chatRead.create({ data: { ...key, lastReadSeq: upTo } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    await prisma.chatRead.updateMany({ where: { ...key, lastReadSeq: { lt: upTo } }, data: { lastReadSeq: upTo } });
    return c.body(null, 204);
  });

  return app;
}
```

Why not `prisma.chatRead.upsert`: for this upsert Prisma reads first and then inserts, so two tabs marking the same chat at the same moment can both find no row and both insert; the second gets a unique-constraint error and the request a 500. The "stores one cursor …" test caught exactly that when the database tests ran in parallel.

In `apps/server/src/http/routes/me.ts`: import `type LiveClis` from `'../../chats/activity'`, take the CLIs, and answer `agentOnline`:

```ts
/**
 * `GET /api/me` (spec §10): who you are, whether your GitHub sign-in still works, and whether one of your CLIs
 * is connected. For the web app and the CLI alike.
 */
export function meRoutes(deps: { clis: LiveClis }): Hono<{ Variables: UserVariables }> {
```

```ts
      githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth',
      agentOnline: deps.clis.connectionsFor(user.id).length > 0,
    };
```

In `apps/server/src/http/app.ts`: `import { inboxRoutes } from './routes/inbox';`, and replace `app.route('/', meRoutes());` with:

```ts
  app.route('/', meRoutes(deps));
  app.route('/', inboxRoutes(deps));
```

- [x] **Step 10: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/http/routes/inbox.db.test.ts src/http/routes/me.db.test.ts`
Expected: PASS, 8 and 4 tests. Then run `npm run test:db -w apps/server` twice: the concurrent-cursor test must pass under the full parallel load too.

- [x] **Step 11: Record the decisions in the spec**

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §10, after the "Chat writes:" list's last item (`` `POST /api/chats/:id/read`. ``), add: "Marking a chat read only moves the person's own cursor and changes nothing anyone else sees, so it needs the Origin check and the person being a participant, not a GitHub access check; for anyone else the chat is a 404."

In §16, the **Inbox** bullet gains: "The server works the status out for the person reading it: a finished PR first, then what that person has to do (an escalation is the red Needs you), then Ready (a reviewer's) or Their turn (the author waiting for approval), then a waiting or working agent, then whose turn it is; with nothing pending the row shows no pill."

- [x] **Step 12: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e`
Expected: protocol 45, CLI 293 passed + 14 skipped, server 655, web 28; end to end 5; typecheck and lint clean.

- [x] **Step 13: Commit**

```bash
git add apps/server/prisma packages/protocol/src/web-api.ts packages/protocol/src/web-api.test.ts apps/server/src/chats/inbox.ts apps/server/src/chats/inbox.db.test.ts apps/server/src/http/routes/inbox.ts apps/server/src/http/routes/inbox.db.test.ts apps/server/src/http/routes/me.ts apps/server/src/http/routes/me.db.test.ts apps/server/src/http/app.ts apps/server/test/db.ts apps/web/src/routes/Home/Home.test.tsx docs/superpowers/specs/2026-10-07-nitpilot-design.md docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(server): GET /api/inbox with unread counts, and marking a chat read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The inbox screen

**Files:**
- Create: `apps/web/src/lib/{inbox,time,keys,viewport}.ts` (and `inbox.test.ts`, `time.test.ts`, `keys.test.tsx`), `apps/web/src/api/inbox.ts`, `apps/web/src/test/render.tsx`, `apps/web/src/components/{StatusPill,Avatar,AgentBadge,Kbd,Ping}/…` (`StatusPill.test.tsx`), `apps/web/src/routes/Inbox/{Inbox,InboxHeader,InboxBanners,InboxFilter,InboxTabs,InboxRow,EmptyState}.tsx` with their `.module.css` and `Inbox.test.tsx`, `apps/web/src/routes/Shell/{Shell,Pane}.tsx` with their `.module.css` and `Shell.test.tsx`, `apps/web/src/routes/Chat/ChatPlaceholder.tsx`, `apps/web/src/routes/Settings/SettingsPlaceholder.tsx`, `apps/web/e2e/inbox.spec.ts`.
- Modify: `apps/web/src/app.tsx` (`AppRoutes`: Home is the layout route), `apps/web/src/routes/Home/{Home.tsx,Home.module.css,Home.test.tsx}` (signed in = the Shell; Sign out moves to the Settings placeholder), `apps/web/src/routes/Landing/{Landing.tsx,Landing.module.css}` (the sample rows use `StatusPill`: Task 3's deferred minor), `apps/web/e2e/{control.ts,landing.spec.ts}`, `apps/server/test/e2e/web-server.ts` (control `POST /pr`).

**Interfaces:**
- Consumes: `InboxRow`, `InboxStatus`, `InboxResponse`, `WebMe` (protocol, Task 5), `useMe`, `api`, `makeQueryClient` (W1), `Wordmark`, `ThemeToggle`, `ErrorState` (W1).
- Produces: `useInbox()` (query key `['inbox']`, data = rows). `Tab = 'review' | 'mine'`, `STATUS_FILTERS`, `StatusFilter`, `statusFilterOf(status)`, `sortRows(rows)` (needs you first, then `updatedAt` desc), `filterRows(rows, { tab, query, repos, statuses })`, `tabCounts(rows) → { review, mine }`, `defaultTab(rows)`, `chatPath(row) → '/c/<repo>/<number>'` (`lib/inbox.ts`). `rowTime(iso, now?)` (`lib/time.ts`). `useInboxKeys({ rows, cursor, setCursor, open, focusSearch, escape })`, `useEscapeBack(active, back)`, `isTyping(target)` (`lib/keys.ts`). `useIsDesktop()` (`lib/viewport.ts`, 760 px). `<StatusPill status viewerLogin />`, `<Avatar login src size={32|38}>{badge}</Avatar>`, `<AgentBadge login />`, `<Kbd boxed? />`, `<Ping />`. `<Shell me />` renders the inbox and an `<Outlet>`; `<Pane>` and `<EmptyPane title body />` (`routes/Shell/Pane.tsx`) are the right-hand pages. `AppRoutes` (`app.tsx`). Test helpers `fakeApi(routes)`, `renderApp(path)`, `fakeViewport(desktop)` (`src/test/render.tsx`). Playwright: `openPr({ number, title, author, reviewer })` (`e2e/control.ts`).

- [x] **Step 1: Write the failing tests for the list logic**

Create `apps/web/src/lib/inbox.test.ts`:

```ts
import type { InboxRow, InboxStatus } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { chatPath, defaultTab, filterRows, sortRows, statusFilterOf, tabCounts, type InboxFilters } from './inbox';

const status = (kind: InboxStatus['kind'], who: string | null = null): InboxStatus => ({ kind, who, reason: null });

function row(over: Partial<InboxRow> = {}): InboxRow {
  return {
    chatId: 'chat-1', repo: 'acme/shop-api', number: 142, title: 'Add cursor pagination to /orders', url: 'https://github.com/acme/shop-api/pull/142',
    role: 'author', other: { login: 'leo', avatarUrl: null, agentActive: false }, status: status('quiet'),
    round: 1, maxRounds: 3, lastActivity: '', updatedAt: '2026-10-15T12:00:00.000Z', unread: 0, needsYou: false, ...over,
  };
}

const noFilters: InboxFilters = { tab: 'mine', query: '', repos: new Set(), statuses: new Set() };

describe('sortRows', () => {
  it('puts the rows that need you first, then the newest first', () => {
    const rows = [
      row({ chatId: 'old', updatedAt: '2026-10-15T09:00:00.000Z' }),
      row({ chatId: 'needs-old', needsYou: true, updatedAt: '2026-10-14T09:00:00.000Z' }),
      row({ chatId: 'new', updatedAt: '2026-10-15T11:00:00.000Z' }),
      row({ chatId: 'needs-new', needsYou: true, updatedAt: '2026-10-15T10:00:00.000Z' }),
    ];
    expect(sortRows(rows).map((r) => r.chatId)).toEqual(['needs-new', 'needs-old', 'new', 'old']);
  });
});

describe('filterRows', () => {
  const rows = [
    row({ chatId: 'mine-142' }),
    row({ chatId: 'review-139', role: 'reviewer', number: 139, title: 'Fix race in session refresh', other: { login: 'sam', avatarUrl: null, agentActive: false } }),
    row({ chatId: 'mine-other-repo', repo: 'acme/web', number: 7, title: 'Dark mode', status: status('working', 'leo') }),
    row({ chatId: 'mine-merged', number: 136, title: 'Remove legacy coupons', status: status('merged') }),
  ];
  const ids = (filters: Partial<InboxFilters>) => filterRows(rows, { ...noFilters, ...filters }).map((r) => r.chatId);

  it('keeps the tab’s rows: To review is where you review, Mine is your PRs', () => {
    expect(ids({ tab: 'review' })).toEqual(['review-139']);
    expect(ids({ tab: 'mine' })).toEqual(['mine-142', 'mine-other-repo', 'mine-merged']);
  });

  it('searches the repo, the number, the title and the other person, ignoring case', () => {
    expect(ids({ query: 'ACME/WEB' })).toEqual(['mine-other-repo']);
    expect(ids({ query: '#136' })).toEqual(['mine-merged']);
    expect(ids({ query: 'coupons' })).toEqual(['mine-merged']);
    expect(ids({ tab: 'review', query: 'sam' })).toEqual(['review-139']);
    expect(ids({ query: '   ' })).toHaveLength(3);
  });

  it('keeps only the chosen repos and statuses (Merged counts as Closed)', () => {
    expect(ids({ repos: new Set(['acme/web']) })).toEqual(['mine-other-repo']);
    expect(ids({ statuses: new Set(['working']) })).toEqual(['mine-other-repo']);
    expect(ids({ statuses: new Set(['closed']) })).toEqual(['mine-merged']);
    expect(ids({ statuses: new Set(['working', 'closed']) })).toEqual(['mine-other-repo', 'mine-merged']);
  });
});

describe('statusFilterOf', () => {
  it('files an escalation under Needs you, Merged under Closed, and a quiet row under nothing', () => {
    expect(statusFilterOf(status('escalated'))).toBe('needs_you');
    expect(statusFilterOf(status('merged'))).toBe('closed');
    expect(statusFilterOf(status('quiet'))).toBeNull();
    expect(statusFilterOf(status('their_turn'))).toBe('their_turn');
  });
});

describe('tabCounts', () => {
  it('counts the rows that need you, per tab', () => {
    const rows = [row({ needsYou: true }), row({ role: 'reviewer', needsYou: true }), row({ role: 'reviewer', needsYou: true }), row({ role: 'reviewer' })];
    expect(tabCounts(rows)).toEqual({ review: 2, mine: 1 });
  });
});

describe('defaultTab', () => {
  it('opens the tab that needs you, else To review if it has anything, else Mine', () => {
    expect(defaultTab([row({ needsYou: true }), row({ role: 'reviewer' })])).toBe('mine');
    expect(defaultTab([row({ needsYou: true }), row({ role: 'reviewer', needsYou: true })])).toBe('review');
    expect(defaultTab([row(), row({ role: 'reviewer' })])).toBe('review');
    expect(defaultTab([row()])).toBe('mine');
    expect(defaultTab([])).toBe('review');
  });
});

describe('chatPath', () => {
  it("is the chat's address in the app", () => {
    expect(chatPath(row())).toBe('/c/acme/shop-api/142');
  });
});
```

Create `apps/web/src/lib/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rowTime } from './time';

// Local times, so the test reads the same in every time zone.
const now = new Date(2026, 9, 15, 18, 30); // Thursday 15 October 2026, 18:30
const at = (day: number, hour: number, minute: number, second = 0) => new Date(2026, 9, day, hour, minute, second).toISOString();

describe('rowTime (the time on an inbox row)', () => {
  it('says "now" for the last minute', () => {
    expect(rowTime(at(15, 18, 29, 30), now)).toBe('now');
  });

  it('shows the clock time earlier today', () => {
    expect(rowTime(at(15, 9, 5), now)).toBe('09:05');
    expect(rowTime(at(15, 16, 40), now)).toBe('16:40');
  });

  it('says "Yesterday", then the weekday for the last week, then the date', () => {
    expect(rowTime(at(14, 23, 59), now)).toBe('Yesterday');
    expect(rowTime(at(12, 10, 0), now)).toBe('Mon');
    expect(rowTime(at(3, 10, 0), now)).toBe('Oct 3');
  });
});
```

- [x] **Step 2: Run them to see them fail**

Run: `npm test -w apps/web -- src/lib`
Expected: FAIL, `Failed to resolve import "./inbox"` and `"./time"`.

- [x] **Step 3: Sort, filter, count, and say when**

Create `apps/web/src/lib/inbox.ts`:

```ts
import type { InboxRow, InboxStatus } from '@nitpilot/protocol';

/** The inbox tabs (spec §16): PRs you review, and your own. */
export type Tab = 'review' | 'mine';

/** The Filter popover's status choices, in the handoff's order. */
export const STATUS_FILTERS = [
  ['needs_you', 'Needs you'],
  ['working', 'Agent working'],
  ['waiting', 'Waiting'],
  ['their_turn', 'Their turn'],
  ['ready', 'Ready'],
  ['closed', 'Closed'],
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number][0];

export type InboxFilters = { tab: Tab; query: string; repos: ReadonlySet<string>; statuses: ReadonlySet<StatusFilter> };

/** Which status filter a row falls under: an escalation is a Needs you, Merged is Closed, a quiet row is none. */
export function statusFilterOf(status: InboxStatus): StatusFilter | null {
  switch (status.kind) {
    case 'escalated':
      return 'needs_you';
    case 'merged':
      return 'closed';
    case 'quiet':
      return null;
    default:
      return status.kind;
  }
}

/** The rows that need you first, then the most recently changed (handoff §1). */
export function sortRows(rows: readonly InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || b.updatedAt.localeCompare(a.updatedAt));
}

/** The rows of one tab that match the search and the filters. An empty set of repos or statuses means all. */
export function filterRows(rows: readonly InboxRow[], f: InboxFilters): InboxRow[] {
  const role = f.tab === 'review' ? 'reviewer' : 'author';
  const query = f.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.role !== role) return false;
    if (f.repos.size > 0 && !f.repos.has(row.repo)) return false;
    if (f.statuses.size > 0) {
      const kind = statusFilterOf(row.status);
      if (kind === null || !f.statuses.has(kind)) return false;
    }
    if (query && !`${row.repo} #${row.number} ${row.title} ${row.other?.login ?? ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

/** Each tab's badge: how many of its rows need you. */
export function tabCounts(rows: readonly InboxRow[]): Record<Tab, number> {
  return {
    review: rows.filter((r) => r.role === 'reviewer' && r.needsYou).length,
    mine: rows.filter((r) => r.role === 'author' && r.needsYou).length,
  };
}

/** The tab the inbox opens on: the one that needs you, else To review when it has anything, else Mine. */
export function defaultTab(rows: readonly InboxRow[]): Tab {
  const counts = tabCounts(rows);
  if (counts.review > 0) return 'review';
  if (counts.mine > 0) return 'mine';
  const reviews = rows.some((r) => r.role === 'reviewer');
  const mine = rows.some((r) => r.role === 'author');
  return mine && !reviews ? 'mine' : 'review';
}

/** A chat's address in the app: the same URL as its transcript (spec §10). */
export function chatPath(row: Pick<InboxRow, 'repo' | 'number'>): string {
  return `/c/${row.repo}/${row.number}`;
}
```

Create `apps/web/src/lib/time.ts`:

```ts
const DAY_MS = 86_400_000;

/**
 * When a row last changed, the way the handoff writes it: "now", "16:40" today, "Yesterday", "Mon" within the
 * last week, then "Oct 3". In the reader's own time zone.
 */
export function rowTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (now.getTime() - at.getTime() < 60_000) return 'now';
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString('en-US', { weekday: 'short' });
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
```

Run: `npm test -w apps/web -- src/lib`
Expected: PASS, 11 tests.

- [x] **Step 4: Write the failing test for the keyboard**

Create `apps/web/src/lib/keys.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useInboxKeys } from './keys';

const ROWS = [{ chatId: 'a' }, { chatId: 'b' }, { chatId: 'c' }];

/** A search box and the cursor, driven by the inbox keys. */
function Harness({ open = vi.fn(), escape = vi.fn() }: { open?: (id: string) => void; escape?: () => void }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useInboxKeys({ rows: ROWS, cursor, setCursor, open, focusSearch: () => search.current?.focus(), escape });
  return (
    <>
      <input ref={search} aria-label="Search pull requests" />
      <output aria-label="cursor">{cursor ?? 'none'}</output>
    </>
  );
}

const cursor = () => screen.getByLabelText('cursor').textContent;

describe('useInboxKeys (handoff "Keyboard")', () => {
  it('moves the cursor with j/k and the arrow keys, and stops at the ends', async () => {
    render(<Harness />);
    await userEvent.keyboard('j');
    expect(cursor()).toBe('a');
    await userEvent.keyboard('j{ArrowDown}j');
    expect(cursor()).toBe('c');
    await userEvent.keyboard('k{ArrowUp}k');
    expect(cursor()).toBe('a');
  });

  it('opens the row under the cursor with Enter, and nothing without a cursor', async () => {
    const open = vi.fn();
    render(<Harness open={open} />);
    await userEvent.keyboard('{Enter}');
    expect(open).not.toHaveBeenCalled();
    await userEvent.keyboard('jj{Enter}');
    expect(open).toHaveBeenCalledWith('b');
  });

  it('focuses the search box with /, and ignores the keys while you type in it', async () => {
    render(<Harness />);
    await userEvent.keyboard('/');
    expect(screen.getByLabelText('Search pull requests')).toHaveFocus();
    await userEvent.keyboard('j');
    expect(cursor()).toBe('none');
    expect(screen.getByLabelText('Search pull requests')).toHaveValue('j');
  });

  it('leaves the search box on Esc, and calls escape when not typing', async () => {
    const escape = vi.fn();
    render(<Harness escape={escape} />);
    await userEvent.keyboard('/');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByLabelText('Search pull requests')).not.toHaveFocus();
    expect(escape).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(escape).toHaveBeenCalledOnce();
  });

  it('leaves shortcuts with a modifier (⌘J, Ctrl+K) to the browser', async () => {
    render(<Harness />);
    await userEvent.keyboard('{Meta>}j{/Meta}{Control>}k{/Control}');
    expect(cursor()).toBe('none');
  });
});
```

Run: `npm test -w apps/web -- src/lib/keys.test.tsx`
Expected: FAIL, `Failed to resolve import "./keys"`.

- [x] **Step 5: The keyboard**

Create `apps/web/src/lib/keys.ts`:

```ts
import { useEffect, useEffectEvent } from 'react';

/** True while the person is typing somewhere: then the letters are theirs, not shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

/** A focused button or link handles Enter itself. */
function isButton(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
}

type InboxKeys = {
  /** The rows on screen, in order. */
  rows: readonly { chatId: string }[];
  cursor: string | null;
  setCursor(chatId: string | null): void;
  open(chatId: string): void;
  focusSearch(): void;
  /** Esc outside a text field: closes the filter, and on a phone goes back to the inbox. */
  escape(): void;
};

/**
 * The inbox's keyboard (handoff "Keyboard"): j/k or ↓/↑ move the cursor, Enter opens its row, / jumps to the
 * search box, Esc leaves it. Ignored while typing, and when ⌘, Ctrl or Alt is held (those are the browser's).
 */
export function useInboxKeys(keys: InboxKeys): void {
  // An effect event always sees the latest rows and cursor, so the listener is added once, not on every render.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) {
      if (e.key === 'Escape' && e.target instanceof HTMLElement) e.target.blur();
      return;
    }
    const at = keys.cursor === null ? -1 : keys.rows.findIndex((r) => r.chatId === keys.cursor);
    const last = keys.rows.length - 1;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = keys.rows[Math.min(last, at + 1)];
      if (next) keys.setCursor(next.chatId);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = keys.rows[Math.max(0, at - 1)];
      if (next) keys.setCursor(next.chatId);
    } else if (e.key === 'Enter' && at >= 0 && !isButton(e.target)) {
      // The cursor's row has focus, so Enter usually reaches it as a button press; this covers the rest.
      keys.open(keys.rows[at]!.chatId);
    } else if (e.key === '/') {
      e.preventDefault();
      keys.focusSearch();
    } else if (e.key === 'Escape') {
      keys.escape();
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}

/** Esc goes back to the inbox. For the phone, where an open chat or page covers the inbox. */
export function useEscapeBack(active: boolean, back: () => void): void {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (active && e.key === 'Escape' && !isTyping(e.target)) back();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
```

Run: `npm test -w apps/web -- src/lib/keys.test.tsx`
Expected: PASS, 5 tests.

- [x] **Step 6: Write the failing test for the pill**

Create `apps/web/src/components/StatusPill/StatusPill.test.tsx`:

```tsx
import type { InboxStatus } from '@nitpilot/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill';

const pill = (kind: InboxStatus['kind'], who: string | null = null) => render(<StatusPill status={{ kind, who, reason: null }} viewerLogin="maya" />);

describe('StatusPill (handoff §1 "Status pills")', () => {
  it.each([
    ['working', 'leo', "leo's agent working"],
    ['working', 'maya', 'Your agent working'],
    ['waiting', 'leo', 'Waiting'],
    ['their_turn', 'leo', 'Their turn'],
    ['needs_you', null, 'Needs you'],
    ['escalated', null, 'Needs you'],
    ['ready', null, 'Ready'],
    ['merged', null, 'Merged'],
    ['closed', null, 'Closed'],
  ] as const)('%s (%s) reads "%s"', (kind, who, words) => {
    pill(kind, who);
    expect(screen.getByText(words)).toBeInTheDocument();
  });

  it('gives every live status a glyph next to its word, and Merged and Closed none', () => {
    for (const kind of ['working', 'waiting', 'their_turn', 'needs_you', 'escalated', 'ready'] as const) {
      const { container, unmount } = pill(kind, 'leo');
      expect(container.querySelector('[data-glyph]'), kind).not.toBeNull();
      unmount();
    }
    for (const kind of ['merged', 'closed'] as const) {
      const { container, unmount } = pill(kind);
      expect(container.querySelector('[data-glyph]'), kind).toBeNull();
      unmount();
    }
  });

  it('is red only for an escalation', () => {
    const { container, unmount } = pill('escalated');
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'red');
    expect(container.querySelector('[data-glyph]')).toHaveAttribute('data-glyph', 'diamond');
    unmount();
    expect(pill('needs_you').container.firstElementChild).toHaveAttribute('data-tone', 'accent');
  });

  it('shows nothing for a quiet chat', () => {
    expect(pill('quiet').container).toBeEmptyDOMElement();
  });
});
```

Run: `npm test -w apps/web -- src/components/StatusPill`
Expected: FAIL, `Failed to resolve import "./StatusPill"`.

- [x] **Step 7: The pill and the small parts of a row**

Create `apps/web/src/components/Ping/Ping.tsx`:

```tsx
import styles from './Ping.module.css';

/** "An agent is working": a 7 px accent dot with a ring that grows and fades, looping (handoff "Motion"). */
export function Ping() {
  return (
    <span className={styles.ping} aria-hidden="true">
      <span className={styles.ring} />
    </span>
  );
}
```

Create `apps/web/src/components/Ping/Ping.module.css`:

```css
.ping {
  position: relative;
  display: inline-block;
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--acc);
}

.ring {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-pill);
  background: var(--acc);
  animation: ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
}

/* global.css turns this off for prefers-reduced-motion. */
@keyframes ping {
  0% {
    transform: scale(1);
    opacity: 0.55;
  }
  70%,
  100% {
    transform: scale(2.6);
    opacity: 0;
  }
}
```

Create `apps/web/src/components/StatusPill/StatusPill.tsx`:

```tsx
import type { InboxStatus } from '@nitpilot/protocol';
import { Ping } from '../Ping/Ping';
import styles from './StatusPill.module.css';

type Tone = 'muted' | 'accent' | 'red' | 'ok' | 'done';
type Glyph = 'ping' | 'ring' | 'dot' | 'diamond' | 'check' | null;

/** How each status looks (handoff §1 "Status pills"). Every live status is a glyph and a word, never colour alone. */
const LOOK: Record<Exclude<InboxStatus['kind'], 'quiet'>, { tone: Tone; glyph: Glyph; word: string }> = {
  working: { tone: 'muted', glyph: 'ping', word: 'Agent working' },
  waiting: { tone: 'muted', glyph: 'ring', word: 'Waiting' },
  their_turn: { tone: 'muted', glyph: 'ring', word: 'Their turn' },
  needs_you: { tone: 'accent', glyph: 'dot', word: 'Needs you' },
  // Red is for escalations only.
  escalated: { tone: 'red', glyph: 'diamond', word: 'Needs you' },
  ready: { tone: 'ok', glyph: 'check', word: 'Ready' },
  merged: { tone: 'done', glyph: null, word: 'Merged' },
  closed: { tone: 'done', glyph: null, word: 'Closed' },
};

/** An inbox row's status. A quiet chat has none. */
export function StatusPill({ status, viewerLogin }: { status: InboxStatus; viewerLogin: string }) {
  if (status.kind === 'quiet') return null;
  const look = LOOK[status.kind];
  return (
    <span className={`${styles.pill} ${styles[look.tone]} ${status.kind === 'merged' ? styles.struck : ''}`} data-tone={look.tone}>
      {look.glyph && <GlyphMark glyph={look.glyph} />}
      {status.kind === 'working' ? workingWords(status.who, viewerLogin) : look.word}
    </span>
  );
}

/** "leo's agent working", or "Your agent working" when it's yours. */
function workingWords(who: string | null, viewerLogin: string): string {
  if (who === null) return 'Agent working';
  return who === viewerLogin ? 'Your agent working' : `${who}'s agent working`;
}

function GlyphMark({ glyph }: { glyph: Exclude<Glyph, null> }) {
  if (glyph === 'ping') {
    return (
      <span data-glyph="ping" className={styles.glyphBox}>
        <Ping />
      </span>
    );
  }
  if (glyph === 'check') {
    return (
      <span data-glyph="check" className={styles.check} aria-hidden="true">
        ✓
      </span>
    );
  }
  return <span data-glyph={glyph} className={styles[glyph]} aria-hidden="true" />;
}
```

Create `apps/web/src/components/StatusPill/StatusPill.module.css`:

```css
.pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 7px;
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.muted {
  background: var(--muted);
  color: var(--fg2);
}

.accent {
  background: var(--acc-tint);
  color: var(--acc-text);
}

.red {
  background: var(--red-tint);
  color: var(--red-fg);
}

.ok {
  background: var(--ok-tint);
  color: var(--ok-fg);
}

.done {
  background: transparent;
  color: var(--fg3);
}

.struck {
  text-decoration: line-through;
}

.glyphBox {
  display: inline-flex;
}

.ring {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  border: 1.5px solid currentColor;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--acc);
}

.diamond {
  width: 6px;
  height: 6px;
  background: var(--red);
  transform: rotate(45deg);
}

.check {
  font-size: 10px;
  font-weight: 700;
}
```

Create `apps/web/src/components/AgentBadge/AgentBadge.tsx`:

```tsx
import styles from './AgentBadge.module.css';

/** The mark on a person's avatar while their agent works (handoff: a dark rounded square holding a diamond). */
export function AgentBadge({ login }: { login: string }) {
  return (
    <span className={styles.badge} role="img" aria-label={`${login}'s agent is active`}>
      <span className={styles.diamond} />
    </span>
  );
}
```

Create `apps/web/src/components/AgentBadge/AgentBadge.module.css`:

```css
.badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 15px;
  height: 15px;
  border-radius: 4px;
  background: var(--fg1);
  box-shadow: 0 0 0 2px var(--side);
  display: flex;
  align-items: center;
  justify-content: center;
}

.diamond {
  width: 5px;
  height: 5px;
  background: var(--side);
  transform: rotate(45deg);
}
```

Create `apps/web/src/components/Avatar/Avatar.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import styles from './Avatar.module.css';

/**
 * A person's GitHub picture in a circle, or their initials when there is none or it doesn't load.
 * `children` sits on top, bottom-right (the AgentBadge).
 */
export function Avatar({ login, src, size, children }: { login: string; src: string | null; size: 32 | 38; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={styles.avatar} style={{ width: size, height: size }}>
      {src && !broken ? (
        <img className={styles.image} src={src} alt={login} width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className={styles.initials} style={{ fontSize: size === 38 ? 13 : 11 }} role="img" aria-label={login}>
          {initials(login)}
        </span>
      )}
      {children}
    </span>
  );
}

/** "maya" → "MA", "leo-park" → "LP". */
export function initials(login: string): string {
  const parts = login.split(/[-_.\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : login.slice(0, 2);
  return letters.toUpperCase();
}
```

Create `apps/web/src/components/Avatar/Avatar.module.css`:

```css
.avatar {
  position: relative;
  flex: none;
  display: inline-block;
}

.image,
.initials {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-pill);
}

.image {
  display: block;
  object-fit: cover;
  background: var(--muted);
}

.initials {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--muted);
  color: var(--fg2);
  font-weight: 600;
}
```

Create `apps/web/src/components/Kbd/Kbd.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

/** A key, as in "/ search". `boxed` draws the outline the search box's hint has. */
export function Kbd({ children, boxed = false }: { children: ReactNode; boxed?: boolean }) {
  return <kbd className={boxed ? `${styles.kbd} ${styles.boxed}` : styles.kbd}>{children}</kbd>;
}
```

Create `apps/web/src/components/Kbd/Kbd.module.css`:

```css
.kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg3);
}

.boxed {
  padding: 0 5px;
  border: 1px solid var(--b1);
  border-radius: 4px;
  line-height: 17px;
}
```

Run: `npm test -w apps/web -- src/components/StatusPill`
Expected: PASS, 12 tests.

- [x] **Step 8: The data, the viewport, and test helpers for whole screens**

Create `apps/web/src/api/inbox.ts`:

```ts
import { InboxResponse } from '@nitpilot/protocol';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/** Your inbox rows, as the server sorted them (newest first). Not live yet: W3 pushes changes into this cache. */
export function useInbox() {
  return useQuery({
    queryKey: ['inbox'],
    queryFn: async () => (await api.get('/api/inbox', InboxResponse)).rows,
  });
}
```

Create `apps/web/src/lib/viewport.ts`:

```ts
import { useSyncExternalStore } from 'react';

/** The handoff's breakpoint: the sidebar and the chat side by side from 760 px, one pane below. */
const DESKTOP = '(min-width: 760px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DESKTOP);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

// Without matchMedia (tests, very old browsers), assume a desktop.
function isDesktop(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia(DESKTOP).matches;
}

/** True at 760 px and wider. Follows the window as it's resized. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, isDesktop);
}
```

Create `apps/web/src/test/render.tsx` (a pretend server answering by method and path, so a screen that asks for `/api/me` and `/api/inbox` in any order gets the right answers):

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppRoutes, makeQueryClient } from '../app';

/** One answer: the status and the JSON body. */
export type Answer = [status: number, body: unknown];

/**
 * A pretend Nitpilot server for component tests: answers each request by its method and path ('GET /api/me').
 * A request it has no answer for gets the server's JSON 404. Returns the fetch mock, to check what was sent.
 */
export function fakeApi(routes: Record<string, () => Answer>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}`;
    const [status, body] = routes[key]?.() ?? [404, { error: { code: 'not_found', message: 'no such route' } }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** The app's routes at `path`, with a fresh data cache that doesn't wait between retries. */
export function renderApp(path = '/') {
  return render(
    <QueryClientProvider client={makeQueryClient({ retryDelay: 0 })}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A stand-in for the browser's media queries: a phone (below 760 px) or a desktop, in the light theme. */
export function fakeViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') ? desktop : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
```

- [x] **Step 9: Write the failing screen tests**

Create `apps/web/src/routes/Inbox/Inbox.test.tsx`:

```tsx
import type { InboxRow, WebMe } from '@nitpilot/protocol';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };

function row(over: Partial<InboxRow>): InboxRow {
  return {
    chatId: 'chat', repo: 'acme/shop-api', number: 1, title: 'A PR', url: 'https://github.com/acme/shop-api/pull/1', role: 'reviewer',
    other: { login: 'sam', avatarUrl: null, agentActive: false }, status: { kind: 'quiet', who: null, reason: null },
    round: 1, maxRounds: 3, lastActivity: '', updatedAt: '2026-10-15T10:00:00.000Z', unread: 0, needsYou: false, ...over,
  };
}

const ROWS: InboxRow[] = [
  row({ chatId: 'r144', number: 144, title: 'Refactor webhook retries', status: { kind: 'waiting', who: 'maya', reason: 'offline' }, updatedAt: '2026-10-15T18:11:00.000Z' }),
  row({ chatId: 'r139', number: 139, title: 'Fix race in session refresh', status: { kind: 'escalated', who: null, reason: 'decision' }, needsYou: true, unread: 2, lastActivity: 'P1 needs a human decision', round: 2 }),
  row({ chatId: 'm147', number: 147, role: 'author', title: 'Bump Prisma to 7.2', other: { login: 'leo', avatarUrl: null, agentActive: true }, status: { kind: 'working', who: 'leo', reason: null } }),
];

function serve(opts: { me?: Partial<WebMe>; rows?: InboxRow[] } = {}) {
  return fakeApi({
    'GET /api/me': (): Answer => [200, { ...me, ...opts.me }],
    'GET /api/inbox': (): Answer => [200, { rows: opts.rows ?? ROWS }],
  });
}

const list = async () => within(await screen.findByRole('listbox', { name: 'Pull requests' }));
const titles = async () => (await list()).getAllByRole('option').map((o) => within(o).getByTestId('title').textContent);

afterEach(() => vi.unstubAllGlobals());

describe('Inbox (handoff §1)', () => {
  it('opens on the tab that needs you, with the rows that need you first', async () => {
    serve();
    renderApp('/');
    expect(await screen.findByRole('tab', { name: /To review/ })).toHaveAttribute('aria-selected', 'true');
    expect(await titles()).toEqual(['Fix race in session refresh', 'Refactor webhook retries']);
    expect(screen.getByLabelText('1 need you')).toHaveTextContent('1');
  });

  it("shows each row's repo and number, pill, last activity, round and unread dot", async () => {
    serve();
    renderApp('/');
    const first = (await list()).getAllByRole('option')[0]!;
    expect(first).toHaveTextContent('acme/shop-api #139');
    expect(within(first).getByText('Needs you')).toBeInTheDocument();
    expect(first).toHaveTextContent('P1 needs a human decision');
    expect(within(first).getByLabelText('Round 2 of 3')).toHaveTextContent('2/3');
    expect(within(first).getByLabelText('Unread')).toBeInTheDocument();
  });

  it('switches to Mine, where the other side’s agent badge shows', async () => {
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('tab', { name: /Mine/ }));
    expect(await titles()).toEqual(['Bump Prisma to 7.2']);
    expect(screen.getByRole('img', { name: "leo's agent is active" })).toBeInTheDocument();
    expect(screen.getByText("leo's agent working")).toBeInTheDocument();
  });

  it('says your agent is offline, with the command to copy', async () => {
    serve({ me: { agentOnline: false } });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    renderApp('/');
    expect(await screen.findByText('Your agent is offline')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy nitpilot start' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('nitpilot start');
    expect(screen.getByRole('button', { name: 'Copy nitpilot start' })).toHaveTextContent('Copied');
  });

  it('asks to reconnect GitHub when the sign-in expired, and stays quiet when all is well', async () => {
    serve({ me: { githubAuth: 'needs_reauth' } });
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub sign-in expired');
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/auth/github/login?next=%2F');
    expect(screen.queryByText('Your agent is offline')).not.toBeInTheDocument();
  });

  it('searches, and says when nothing matches', async () => {
    serve();
    renderApp('/');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search pull requests' }), 'webhook');
    expect(await titles()).toEqual(['Refactor webhook retries']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search pull requests' }), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.getByText('No pull requests match “webhookzzz”.')).toBeInTheDocument();
  });

  it('filters by status, and counts the filters on the button', async () => {
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Waiting' }));
    expect(await titles()).toEqual(['Refactor webhook retries']);
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('is all quiet when there is nothing', async () => {
    serve({ rows: [] });
    renderApp('/');
    expect(await screen.findByText('All quiet.')).toBeInTheDocument();
    expect(screen.getByText("Nitpilot will ping you when you're needed.")).toBeInTheDocument();
  });

  it('opens a chat by click, and by j and Enter', async () => {
    serve();
    renderApp('/');
    await userEvent.click((await list()).getAllByRole('option')[1]!);
    expect(await screen.findByRole('heading', { name: 'Refactor webhook retries' })).toBeInTheDocument();
    expect((await list()).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('j{Enter}');
    expect(await screen.findByRole('heading', { name: 'Fix race in session refresh' })).toBeInTheDocument();
  });

  it('shows the error with a way to try again', async () => {
    let calls = 0;
    fakeApi({
      'GET /api/me': (): Answer => [200, me],
      'GET /api/inbox': (): Answer => (++calls <= 3 ? [500, { error: { code: 'server_error', message: 'internal server error' } }] : [200, { rows: ROWS }]),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await titles()).toHaveLength(2);
  });
});
```

Create `apps/web/src/routes/Shell/Shell.test.tsx`:

```tsx
import type { WebMe } from '@nitpilot/protocol';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };

function serve() {
  fakeApi({ 'GET /api/me': (): Answer => [200, me], 'GET /api/inbox': (): Answer => [200, { rows: [] }] });
}

afterEach(() => vi.unstubAllGlobals());

describe('Shell (handoff "App shell and layout")', () => {
  it('shows the inbox beside the open page on a desktop', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick a pull request' })).toBeInTheDocument();
  });

  it('shows one pane on a phone: the inbox at /, the page elsewhere, and Esc goes back', async () => {
    fakeViewport(false);
    serve();
    renderApp('/c/acme/shop-api/139');
    expect(await screen.findByRole('heading', { name: 'Pull request #139' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Inbox' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pull request #139' })).not.toBeInTheDocument();
  });

  it('keeps Sign out on the Settings page, reached from your avatar', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings · maya' }));
    expect(await screen.findByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
```

Replace `apps/web/src/routes/Home/Home.test.tsx` (signed in now means the inbox, and the answers go by path):

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, type Answer } from '../../test/render';

const me = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };
const noRows = (): Answer => [200, { rows: [] }];

afterEach(() => vi.unstubAllGlobals());

describe('Home', () => {
  it('tells a screen reader it is loading while /api/me has not answered', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderApp('/');
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('shows the landing page to someone who is not signed in', async () => {
    fakeApi({ 'GET /api/me': (): Answer => [401, { error: { code: 'unauthorized', message: 'Sign in with GitHub first.' } }] });
    renderApp('/');
    expect(await screen.findByRole('link', { name: /Sign in with GitHub/ })).toBeInTheDocument();
  });

  it('opens the inbox for someone who is signed in', async () => {
    fakeApi({ 'GET /api/me': (): Answer => [200, me], 'GET /api/inbox': noRows });
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('shows the error with a way to try again, instead of a blank page', async () => {
    let calls = 0;
    // The first try and the client's two retries (no waiting between them in tests) fail; "Try again" then succeeds.
    fakeApi({
      'GET /api/me': (): Answer => (++calls <= 3 ? [500, { error: { code: 'server_error', message: 'internal server error' } }] : [200, me]),
      'GET /api/inbox': noRows,
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
  });
});
```

Run: `npm test -w apps/web -- src/routes`
Expected: FAIL: `app.tsx` has no `AppRoutes` yet, and there is no Shell or Inbox.

- [x] **Step 10: The inbox**

Create `apps/web/src/routes/Inbox/InboxHeader.tsx`:

```tsx
import type { WebMe } from '@nitpilot/protocol';
import { Link } from 'react-router';
import { Avatar } from '../../components/Avatar/Avatar';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import styles from './InboxHeader.module.css';

/** The wordmark, the theme toggle, and your avatar, which leads to Settings. */
export function InboxHeader({ me }: { me: WebMe }) {
  return (
    <header className={styles.header}>
      <Wordmark />
      <span className={styles.spacer} />
      <ThemeToggle />
      <Link to="/settings" className={styles.me} aria-label={`Settings · ${me.login}`}>
        <Avatar login={me.login} src={me.avatarUrl} size={32} />
      </Link>
    </header>
  );
}
```

Create `apps/web/src/routes/Inbox/InboxHeader.module.css`:

```css
.header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 10px;
}

.spacer {
  flex: 1;
}

.me {
  display: inline-flex;
  border-radius: var(--radius-pill);
  color: inherit;
  text-decoration: none;
}
```

Create `apps/web/src/routes/Inbox/InboxBanners.tsx`:

```tsx
import { BRAND } from '@nitpilot/protocol';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import styles from './InboxBanners.module.css';

const START = `${BRAND.cli} start`;

/** None of your CLIs is connected, so your agent can't pick anything up (handoff §1, item 2). */
export function OfflineBanner() {
  const [copied, setCopied] = useState(false);

  // "Copied" for 1.6 s, then back to "Copy".
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  function copy() {
    // The clipboard can be missing or refused (an insecure origin); the command is on screen either way.
    navigator.clipboard?.writeText(START).catch(() => {});
    setCopied(true);
  }

  return (
    <div className={styles.offline} role="status">
      <div className={styles.offlineTitle}>
        <span className={styles.ring} aria-hidden="true" />
        Your agent is offline
      </div>
      <div className={styles.offlineRun}>
        Run
        <button type="button" className={styles.chip} onClick={copy} aria-label={`Copy ${START}`}>
          {START}
          <span className={styles.copy}>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

/** Your GitHub sign-in expired: Nitpilot can't act as you until you sign in again (handoff §10, `github`). */
export function ExpiredStrip() {
  const here = useLocation();
  const next = encodeURIComponent(here.pathname + here.search);
  return (
    <div className={styles.expired} role="alert">
      <span className={styles.bang} aria-hidden="true">
        !
      </span>
      <span className={styles.expiredText}>GitHub sign-in expired</span>
      {/* A full page load: the sign-in starts on the server. */}
      <a className={styles.reconnect} href={`/auth/github/login?next=${next}`}>
        Reconnect
      </a>
    </div>
  );
}
```

Create `apps/web/src/routes/Inbox/InboxBanners.module.css`:

```css
.offline,
.expired {
  flex: none;
  margin: 2px 12px 10px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
}

.offline {
  border: 1px solid var(--b1);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.offlineTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
}

.ring {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--fg3);
}

.offlineRun {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--fg2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-pill);
  background: var(--code);
  color: var(--fg1);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}

.copy {
  color: var(--fg3);
  font-family: var(--font-sans);
  font-size: 11px;
}

.expired {
  background: var(--warn-tint);
  display: flex;
  align-items: center;
  gap: 10px;
}

.bang {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--warn);
  color: #1a1205;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expiredText {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
}

.reconnect {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  background: var(--fg1);
  color: var(--bg);
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
```

Create `apps/web/src/routes/Inbox/InboxFilter.tsx`:

```tsx
import { useEffect, useEffectEvent, useRef } from 'react';
import { STATUS_FILTERS, type StatusFilter } from '../../lib/inbox';
import styles from './InboxFilter.module.css';

type Props = {
  open: boolean;
  setOpen(open: boolean): void;
  /** Every repo in your inbox. */
  repos: readonly string[];
  chosenRepos: ReadonlySet<string>;
  chosenStatuses: ReadonlySet<StatusFilter>;
  toggleRepo(repo: string): void;
  toggleStatus(status: StatusFilter): void;
};

/** The Filter button and its popover: repos, then statuses (handoff §1, item 4). Esc closes it (useInboxKeys). */
export function InboxFilter(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const count = p.chosenRepos.size + p.chosenStatuses.size;

  // A press anywhere outside the button and the popover closes it.
  const close = useEffectEvent(() => p.setOpen(false));
  useEffect(() => {
    if (!p.open) return;
    const onPress = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [p.open]);

  return (
    <div className={styles.box} ref={box}>
      <button type="button" className={count > 0 ? `${styles.button} ${styles.active}` : styles.button} aria-expanded={p.open} aria-haspopup="menu" onClick={() => p.setOpen(!p.open)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        {count > 0 ? `Filter · ${count}` : 'Filter'}
      </button>
      {p.open && (
        <div className={styles.menu} role="menu" aria-label="Filter pull requests">
          <div className={styles.group} aria-hidden="true">
            Repo
          </div>
          {p.repos.map((repo) => (
            <Choice key={repo} label={repo} mono on={p.chosenRepos.has(repo)} toggle={() => p.toggleRepo(repo)} />
          ))}
          <div className={styles.divider} />
          <div className={styles.group} aria-hidden="true">
            Status
          </div>
          {STATUS_FILTERS.map(([status, label]) => (
            <Choice key={status} label={label} on={p.chosenStatuses.has(status)} toggle={() => p.toggleStatus(status)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Choice({ label, on, toggle, mono = false }: { label: string; on: boolean; toggle(): void; mono?: boolean }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={on} className={mono ? `${styles.choice} ${styles.mono}` : styles.choice} onClick={toggle}>
      <span className={styles.mark} aria-hidden="true">
        {on ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}
```

Create `apps/web/src/routes/Inbox/InboxFilter.module.css`:

```css
.box {
  position: relative;
  flex: none;
}

.button {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg2);
  font-size: 13px;
  cursor: pointer;
}

.active {
  border-color: var(--acc);
}

.menu {
  position: absolute;
  z-index: 5;
  top: 40px;
  right: 0;
  width: 220px;
  padding: 6px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-popover);
  display: flex;
  flex-direction: column;
}

.group {
  padding: 6px 8px 4px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg3);
}

.divider {
  height: 1px;
  margin: 4px 0;
  background: var(--b2);
}

.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.choice:hover {
  background: var(--hover);
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.mark {
  width: 14px;
  color: var(--acc-text);
}
```

Create `apps/web/src/routes/Inbox/InboxTabs.tsx`:

```tsx
import type { Tab } from '../../lib/inbox';
import styles from './InboxTabs.module.css';

const TABS: [Tab, string][] = [
  ['review', 'To review'],
  ['mine', 'Mine'],
];

/** "To review" and "Mine", each with a badge counting what needs you (hidden at 0). */
export function InboxTabs({ tab, counts, pick }: { tab: Tab; counts: Record<Tab, number>; pick(tab: Tab): void }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Inbox tabs">
      {TABS.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={styles.tab} onClick={() => pick(id)}>
          {label}
          {counts[id] > 0 && (
            <span className={styles.count} aria-label={`${counts[id]} need you`}>
              {counts[id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
```

Create `apps/web/src/routes/Inbox/InboxTabs.module.css`:

```css
.tabs {
  flex: none;
  display: flex;
  gap: 18px;
  padding: 0 16px;
  border-bottom: 1px solid var(--b1);
}

.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  margin-bottom: -1px;
  padding: 0 2px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--fg3);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
}

.tab[aria-selected='true'] {
  color: var(--fg1);
  border-bottom-color: var(--fg1);
}

.count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--acc);
  color: var(--on-acc);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

Create `apps/web/src/routes/Inbox/InboxRow.tsx` (the cursor's row takes the focus, so Enter reaches it as a button press and a screen reader reads the row the cursor is on):

```tsx
import type { InboxRow } from '@nitpilot/protocol';
import { useEffect, useRef } from 'react';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { rowTime } from '../../lib/time';
import styles from './InboxRow.module.css';

type Props = {
  row: InboxRow;
  viewerLogin: string;
  /** The chat open on the right (desktop). */
  selected: boolean;
  /** The keyboard cursor is on this row: it takes the focus, so Enter opens it and a screen reader reads it. */
  cursor: boolean;
  onOpen(): void;
};

/** One pull request in the list (handoff §1, item 6). */
export function InboxRowItem({ row, viewerLogin, selected, cursor, onOpen }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (cursor) button.current?.focus();
  }, [cursor]);
  const finished = row.status.kind === 'merged' || row.status.kind === 'closed';
  const classes = [styles.row, selected && styles.selected, cursor && styles.cursor, finished && styles.finished].filter(Boolean).join(' ');
  return (
    <button ref={button} type="button" role="option" aria-selected={selected} className={classes} onClick={onOpen}>
      <Avatar login={row.other?.login ?? '?'} src={row.other?.avatarUrl ?? null} size={38}>
        {row.other?.agentActive && <AgentBadge login={row.other.login} />}
      </Avatar>
      <span className={styles.text}>
        <span className={styles.top}>
          <span className={styles.ref}>
            {row.repo} #{row.number}
          </span>
          <span className={styles.time}>{rowTime(row.updatedAt)}</span>
        </span>
        <span className={styles.middle}>
          <span className={row.unread > 0 ? `${styles.title} ${styles.unread}` : styles.title} data-testid="title">
            {row.title}
          </span>
          {row.unread > 0 && <span className={styles.dot} role="img" aria-label="Unread" />}
        </span>
        <span className={styles.bottom}>
          <StatusPill status={row.status} viewerLogin={viewerLogin} />
          <span className={styles.last}>{row.lastActivity}</span>
          <span className={styles.round} aria-label={`Round ${row.round} of ${row.maxRounds}`}>
            {row.round}/{row.maxRounds}
          </span>
        </span>
      </span>
    </button>
  );
}
```

Create `apps/web/src/routes/Inbox/InboxRow.module.css`:

```css
.row {
  flex: none;
  width: 100%;
  display: flex;
  gap: 12px;
  padding: 11px 10px;
  border: 0;
  border-radius: var(--radius-card);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: var(--hover);
}

.selected,
.selected:hover {
  background: var(--sel);
}

/* The keyboard cursor (j/k), which is also where the focus is: one inset ring, not an outline as well. */
.cursor,
.row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--acc);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.top,
.middle,
.bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ref,
.title,
.last {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg3);
}

.time {
  flex: none;
  font-size: 12px;
  color: var(--fg3);
}

.title {
  font-size: 14px;
  font-weight: 500;
  color: var(--fg1);
}

.unread {
  font-weight: 600;
}

.finished .title {
  color: var(--fg3);
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--acc);
}

.last {
  font-size: 12.5px;
  color: var(--fg3);
}

.round {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg3);
}
```

Create `apps/web/src/routes/Inbox/EmptyState.tsx`:

```tsx
import styles from './EmptyState.module.css';

/** The list has nothing to show: a calm inbox, or a search or filter that matched nothing (handoff §1, item 7). */
export function EmptyState({ query, filtering }: { query: string; filtering: boolean }) {
  const [title, body] = query
    ? ['No matches', `No pull requests match “${query}”.`]
    : filtering
      ? ['No matches', 'Nothing in this tab matches the filter.']
      : ['All quiet.', "Nitpilot will ping you when you're needed."];
  return (
    <div className={styles.empty}>
      <span className={styles.diamond} aria-hidden="true" />
      <div className={styles.title}>{title}</div>
      <div className={styles.body}>{body}</div>
    </div>
  );
}
```

Create `apps/web/src/routes/Inbox/EmptyState.module.css`:

```css
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
}

.diamond {
  width: 10px;
  height: 10px;
  margin-bottom: 6px;
  background: var(--b1);
  transform: rotate(45deg);
}

.title {
  font-size: 14px;
  font-weight: 500;
}

.body {
  max-width: 240px;
  font-size: 13px;
  color: var(--fg3);
  text-wrap: pretty;
}
```

Create `apps/web/src/routes/Inbox/Inbox.tsx`:

```tsx
import type { InboxRow, WebMe } from '@nitpilot/protocol';
import { useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { useInbox } from '../../api/inbox';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Kbd } from '../../components/Kbd/Kbd';
import { chatPath, defaultTab, filterRows, sortRows, tabCounts, type StatusFilter, type Tab } from '../../lib/inbox';
import { useInboxKeys } from '../../lib/keys';
import { EmptyState } from './EmptyState';
import styles from './Inbox.module.css';
import { ExpiredStrip, OfflineBanner } from './InboxBanners';
import { InboxFilter } from './InboxFilter';
import { InboxHeader } from './InboxHeader';
import { InboxRowItem } from './InboxRow';
import { InboxTabs } from './InboxTabs';

/** The inbox (spec §16, handoff §1): the sidebar on a desktop, the whole screen on a phone. */
export function Inbox({ me }: { me: WebMe }) {
  const inbox = useInbox();
  const navigate = useNavigate();
  const open = useMatch('/c/:owner/:repo/:number')?.params;
  const search = useRef<HTMLInputElement>(null);

  // Until you pick a tab, the inbox shows the one that needs you.
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<ReadonlySet<string>>(new Set());
  const [statuses, setStatuses] = useState<ReadonlySet<StatusFilter>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  const all = inbox.data ?? [];
  const tab = chosenTab ?? defaultTab(all);
  const rows = sortRows(filterRows(all, { tab, query, repos, statuses }));
  const allRepos = [...new Set(all.map((r) => r.repo))].sort();
  const isOpen = (row: InboxRow) => open !== undefined && row.repo === `${open.owner}/${open.repo}` && String(row.number) === open.number;

  useInboxKeys({
    rows,
    cursor,
    setCursor,
    open: (chatId) => {
      const row = rows.find((r) => r.chatId === chatId);
      if (row) void navigate(chatPath(row));
    },
    focusSearch: () => search.current?.focus(),
    escape: () => setFilterOpen(false),
  });

  function pickTab(next: Tab) {
    setChosenTab(next);
    setCursor(null);
  }

  return (
    <section className={styles.inbox} aria-label="Inbox">
      <InboxHeader me={me} />
      {!me.agentOnline && <OfflineBanner />}
      {me.githubAuth === 'needs_reauth' && <ExpiredStrip />}

      <div className={styles.tools}>
        <label className={styles.search}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={search}
            className={styles.searchInput}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(null);
            }}
            placeholder="Search pull requests"
            aria-label="Search pull requests"
          />
          {!query && (
            <span className={styles.slashHint}>
              <Kbd boxed>/</Kbd>
            </span>
          )}
        </label>
        <InboxFilter
          open={filterOpen}
          setOpen={setFilterOpen}
          repos={allRepos}
          chosenRepos={repos}
          chosenStatuses={statuses}
          toggleRepo={(repo) => setRepos((set) => toggled(set, repo))}
          toggleStatus={(status) => setStatuses((set) => toggled(set, status))}
        />
      </div>

      <InboxTabs tab={tab} counts={tabCounts(all)} pick={pickTab} />

      <div className={styles.scroll}>
        {inbox.isPending ? (
          <p className={styles.loading} role="status">
            Loading…
          </p>
        ) : inbox.isError ? (
          <ErrorState message={inbox.error.message} onRetry={() => void inbox.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState query={query.trim()} filtering={repos.size + statuses.size > 0} />
        ) : (
          <div className={styles.list} role="listbox" aria-label="Pull requests">
            {rows.map((row) => (
              <InboxRowItem
                key={row.chatId}
                row={row}
                viewerLogin={me.login}
                selected={isOpen(row)}
                cursor={row.chatId === cursor}
                onOpen={() => {
                  setCursor(null);
                  void navigate(chatPath(row));
                }}
              />
            ))}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <span>
          <Kbd>j</Kbd> <Kbd>k</Kbd> move
        </span>
        <span>
          <Kbd>↵</Kbd> open
        </span>
        <span>
          <Kbd>/</Kbd> search
        </span>
      </footer>
    </section>
  );
}

/** A copy of `set` with `item` added, or removed if it was there. */
function toggled<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
```

Create `apps/web/src/routes/Inbox/Inbox.module.css`:

```css
.inbox {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--side);
}

.tools {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 0 12px 10px;
}

.search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg3);
}

.searchInput {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 13.5px;
  color: var(--fg1);
}

.searchInput::placeholder {
  color: var(--fg3);
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.list {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.loading {
  margin: 0;
  padding: 24px 16px;
  color: var(--fg3);
  font-size: 13px;
}

.footer {
  flex: none;
  display: flex;
  gap: 14px;
  padding: 10px 16px;
  border-top: 1px solid var(--b2);
  font-size: 11.5px;
  color: var(--fg3);
}

/* The keyboard hints are for desktops. */
@media (max-width: 759px) {
  .slashHint,
  .footer {
    display: none;
  }
}
```

- [x] **Step 11: The shell, the pages beside it, and the routes**

Create `apps/web/src/routes/Shell/Shell.tsx`:

```tsx
import type { WebMe } from '@nitpilot/protocol';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { useEscapeBack } from '../../lib/keys';
import { useIsDesktop } from '../../lib/viewport';
import { Inbox } from '../Inbox/Inbox';
import styles from './Shell.module.css';

/**
 * The signed-in app (handoff "App shell and layout"). Desktop: the 360 px inbox sidebar beside the page that's
 * open. Phone: one pane, the inbox at `/` and the open page anywhere else, with Esc (or ‹) going back.
 */
export function Shell({ me }: { me: WebMe }) {
  const desktop = useIsDesktop();
  const atInbox = useMatch('/') !== null;
  const navigate = useNavigate();
  useEscapeBack(!desktop && !atInbox, () => void navigate('/'));

  if (!desktop) {
    return atInbox ? (
      <div className={styles.phone}>
        <Inbox me={me} />
      </div>
    ) : (
      <main className={styles.phone}>
        <Outlet />
      </main>
    );
  }
  return (
    <div className={styles.shell}>
      <div className={styles.sidebar}>
        <Inbox me={me} />
      </div>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
```

Create `apps/web/src/routes/Shell/Shell.module.css`:

```css
.shell {
  height: 100%;
  display: flex;
  overflow: hidden;
}

.sidebar {
  width: 360px;
  flex: none;
  min-height: 0;
  border-right: 1px solid var(--b1);
}

.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--bg);
}

.phone {
  height: 100%;
  overflow: auto;
}
```

Create `apps/web/src/routes/Shell/Pane.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import styles from './Pane.module.css';

/** A page on the right of the inbox (or on its own on a phone, with a way back). */
export function Pane({ children }: { children: ReactNode }) {
  return (
    <div className={styles.pane}>
      <Link to="/" className={styles.back} aria-label="Back to inbox">
        <span className={styles.chevron} aria-hidden="true" />
      </Link>
      {children}
    </div>
  );
}

/** The right side when nothing is open, or when the address leads nowhere. */
export function EmptyPane({ title, body }: { title: string; body: string }) {
  return (
    <Pane>
      <div className={styles.empty}>
        <span className={styles.diamond} aria-hidden="true" />
        <h1 className={styles.emptyTitle}>{title}</h1>
        <p className={styles.muted}>{body}</p>
      </div>
    </Pane>
  );
}
```

Create `apps/web/src/routes/Shell/Pane.module.css`:

```css
.pane {
  max-width: 780px;
  margin: 0 auto;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* The way back to the inbox: only on a phone, where the inbox isn't beside the page. */
.back {
  display: none;
  width: 44px;
  height: 44px;
  margin: -10px 0 0 -12px;
  align-items: center;
  justify-content: center;
  color: var(--acc-text);
}

.chevron {
  width: 10px;
  height: 10px;
  border-top: 2px solid currentColor;
  border-left: 2px solid currentColor;
  transform: rotate(-45deg);
}

@media (max-width: 759px) {
  .pane {
    padding: 16px 12px;
  }

  .back {
    display: inline-flex;
  }
}

.empty {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}

.diamond {
  width: 10px;
  height: 10px;
  margin-bottom: 6px;
  background: var(--b1);
  transform: rotate(45deg);
}

.emptyTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}

.muted {
  margin: 0;
  font-size: 13px;
  color: var(--fg3);
}

.ref {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg2);
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg1);
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
```

Create `apps/web/src/routes/Chat/ChatPlaceholder.tsx` (until Task 10: a full page load of `/c/…` still gets the server's transcript, so the link to it is a plain `<a>`):

```tsx
import { useParams } from 'react-router';
import { useInbox } from '../../api/inbox';
import { Pane } from '../Shell/Pane';
import styles from '../Shell/Pane.module.css';

/** `/c/:owner/:repo/:number` until the chat screen arrives (Task 10): the PR's name and the way to its transcript. */
export function ChatPlaceholder() {
  const { owner, repo, number } = useParams();
  const fullName = `${owner}/${repo}`;
  const row = useInbox().data?.find((r) => r.repo === fullName && String(r.number) === number);
  return (
    <Pane>
      <p className={styles.ref}>
        {fullName} #{number}
      </p>
      <h1 className={styles.title}>{row?.title ?? `Pull request #${number}`}</h1>
      <p className={styles.muted}>The live chat opens here soon. Until then, the transcript shows everything so far.</p>
      <div className={styles.actions}>
        {/* A full page load: the server still renders the transcript at this address. */}
        <a className={styles.button} href={`/c/${fullName}/${number}`}>
          Open the transcript
        </a>
        {row && (
          <a className={styles.button} href={row.url} target="_blank" rel="noreferrer">
            Open on GitHub <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </Pane>
  );
}
```

Create `apps/web/src/routes/Settings/SettingsPlaceholder.tsx` (Sign out stays reachable until Task 21's Settings page):

```tsx
import { useMe } from '../../api/me';
import { Pane } from '../Shell/Pane';
import styles from '../Shell/Pane.module.css';

/** `/settings` until the Settings page arrives (Task 21): who you are, and Sign out. */
export function SettingsPlaceholder() {
  const me = useMe().data;
  return (
    <Pane>
      <h1 className={styles.title}>Signed in as @{me?.login}</h1>
      <p className={styles.muted}>Devices, notifications and defaults come to this page later.</p>
      {/* A plain form: the browser sends our Origin, which /auth/logout checks, then follows its redirect. */}
      <form method="post" action="/auth/logout">
        <button type="submit" className={styles.button}>
          Sign out
        </button>
      </form>
    </Pane>
  );
}
```

Replace `apps/web/src/app.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { retryUnlessClientError } from './api/client';
import { ChatPlaceholder } from './routes/Chat/ChatPlaceholder';
import { Home } from './routes/Home/Home';
import { SettingsPlaceholder } from './routes/Settings/SettingsPlaceholder';
import { EmptyPane } from './routes/Shell/Pane';

/** `queries` lets a test override a default (`retryDelay: 0`) while still using the real retry policy. */
export function makeQueryClient(queries: { retryDelay?: number } = {}): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: retryUnlessClientError, ...queries } } });
}

/** The whole app: the data cache, then the routes. */
export function App({ queryClient }: { queryClient?: QueryClient }) {
  // Made once and kept across re-renders; a new client would drop every cached query.
  const [client] = useState(() => queryClient ?? makeQueryClient());
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Every page. Home decides between the landing page (signed out) and the app; signed in, the pages below
 * open beside the inbox (routes/Shell/Shell.tsx).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Home />}>
        <Route index element={<EmptyPane title="Pick a pull request" body="Its chat opens here." />} />
        <Route path="c/:owner/:repo/:number" element={<ChatPlaceholder />} />
        <Route path="settings" element={<SettingsPlaceholder />} />
        <Route path="*" element={<EmptyPane title="Nothing here" body="This page doesn't exist." />} />
      </Route>
    </Routes>
  );
}
```

Replace `apps/web/src/routes/Home/Home.tsx` with:

```tsx
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { useMe } from '../../api/me';
import { Landing } from '../Landing/Landing';
import { Shell } from '../Shell/Shell';
import styles from './Home.module.css';

/** Every page starts here: the landing page when signed out, the app (inbox and pages) when signed in. */
export function Home() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className={styles.loading} role="status" aria-busy="true">
        <Wordmark size={26} />
        <span className={styles.visuallyHidden}>Loading…</span>
      </div>
    );
  }
  if (me.isError) return <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Landing />;
  return <Shell me={me.data} />;
}
```

Replace `apps/web/src/routes/Home/Home.module.css` with (the signed-in placeholder's styles go):

```css
.loading {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [x] **Step 12: Run the web tests to see them pass**

Run: `npm test -w apps/web`
Expected: PASS, 69 tests.

- [x] **Step 13: The landing page's sample rows use the real pill (Task 3's deferred minor)**

In `apps/web/src/routes/Landing/Landing.tsx`: the imports become

```ts
import { BRAND, type InboxStatus } from '@nitpilot/protocol';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { Wordmark } from '../../components/Wordmark/Wordmark';
```

delete the `Tone` type and the `TONE` map, replace `SAMPLE_ROWS` with

```ts
// The pills are the inbox's own (components/StatusPill), so the picture matches the product.
const SAMPLE_ROWS: { ref: string; time: string; title: string; initials: string; status: InboxStatus; last: string }[] = [
  { ref: 'acme/shop-api #139', time: '16:40', title: 'Fix race in session refresh', initials: 'SO', status: { kind: 'escalated', who: null, reason: 'decision' }, last: 'A security point needs you' },
  { ref: 'acme/shop-api #147', time: 'now', title: 'Bump Prisma to 7.2', initials: 'LP', status: { kind: 'working', who: 'Leo', reason: null }, last: 'reading src/db/client.ts' },
  { ref: 'acme/shop-api #142', time: '14:13', title: 'Add cursor pagination to /orders', initials: 'LP', status: { kind: 'ready', who: null, reason: null }, last: '2 rounds, 3 points resolved' },
];
```

and the row's pill `<span className={`${styles.pill} ${TONE[row.tone]}`}>{row.pill}</span>` with `<StatusPill status={row.status} viewerLogin="" />`. In `Landing.module.css`, delete the `.pill`, `.pillRed`, `.pillMuted` and `.pillOk` rules.

Run: `npm test -w apps/web && npm run typecheck && npm run lint`
Expected: PASS, 69 tests; typecheck and lint clean.

- [x] **Step 14: The inbox in a real browser (Playwright)**

The Playwright server learns to open a PR the way GitHub does, with a webhook. In `apps/server/test/e2e/web-server.ts`, after `const { sessionCookieFor } = await import('../http');` add

```ts
const { people, prEvent, pull } = await import('../fixtures/github');
```

and before `serve({ fetch: control.fetch, … })`:

```ts
/** Open a PR on octo/sandbox, as GitHub's webhook would: `author`'s PR, with `reviewer` requested. */
control.post('/pr', async (c) => {
  const { number, title, author, reviewer } = (await c.req.json()) as { number: number; title: string; author: 'maya' | 'leo'; reviewer: 'maya' | 'leo' };
  const base = pull();
  await e2e.deliver(
    'pull_request',
    prEvent('opened', {
      pull: {
        number,
        title,
        html_url: `https://github.com/${base.base.repo.full_name}/pull/${number}`,
        user: people[author],
        requested_reviewers: [people[reviewer]],
        head: { ...base.head, ref: `feature-${number}`, sha: e2e.github.headSha },
        base: { ...base.base, sha: e2e.github.baseSha },
      },
    }),
  );
  return c.body(null, 204);
});
```

In `apps/web/e2e/control.ts`, add before `pageProblems`:

```ts
/** Open a pull request on the test repo (octo/sandbox), as GitHub's webhook would. */
export async function openPr(pr: { number: number; title: string; author: 'maya' | 'leo'; reviewer: 'maya' | 'leo' }): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/pr`, { method: 'POST', body: JSON.stringify(pr) });
  if (!res.ok) throw new Error(`opening PR #${pr.number} failed: ${res.status} ${await res.text()}`);
}

```

In `apps/web/e2e/landing.spec.ts`, the last test becomes:

```ts
test('someone signed in lands in their inbox', async ({ page, context }) => {
  await signIn(context, 'maya');
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Inbox' })).toBeVisible();
});
```

Create `apps/web/e2e/inbox.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { openPr, pageProblems, signIn } from './control';

test('the inbox lists the PRs you review and your own, each under its tab', async ({ page, context }) => {
  await openPr({ number: 42, title: 'Cursor pagination for orders', author: 'maya', reviewer: 'leo' });
  await openPr({ number: 43, title: 'Retry webhooks with backoff', author: 'leo', reviewer: 'maya' });
  const errors = pageProblems(page);
  await signIn(context, 'maya');
  await page.goto('/');

  const list = page.getByRole('listbox', { name: 'Pull requests' });
  await expect(page.getByRole('tab', { name: 'To review' })).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option').first()).toContainText('octo/sandbox #43');
  await expect(list.getByRole('option').first()).toContainText('Retry webhooks with backoff');

  await page.getByRole('tab', { name: 'Mine' }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  // leo's review is queued, and leo's CLI isn't connected: his agent waits.
  await expect(list.getByRole('option').first()).toContainText('Cursor pagination for orders');
  await expect(list.getByRole('option').first()).toContainText('Waiting');

  await list.getByRole('option').first().click();
  await expect(page.getByRole('heading', { name: 'Cursor pagination for orders' })).toBeVisible();
  await expect(page).toHaveURL(/\/c\/octo\/sandbox\/42$/);
  expect(errors).toEqual([]);
});
```

Run: `npm run build && npm run test:e2e -w apps/web`
Expected: PASS, 4 tests.

- [x] **Step 15: Look at it (controller, in the in-app browser)**

Start the Playwright server (launch config `nitpilot-e2e-web`), seed it, and sign in:

```bash
for pr in '139|Fix race in session refresh|leo|maya' '151|Add Turkish translations|leo|maya' '144|Refactor webhook retries|leo|maya' '147|Bump Prisma to 7.2|maya|leo' '142|Add cursor pagination to /orders|maya|leo' '136|Remove legacy coupon endpoint|maya|leo'; do IFS='|' read n t a r <<< "$pr"; curl -s -X POST http://127.0.0.1:4320/pr -d "{\"number\":$n,\"title\":\"$t\",\"author\":\"$a\",\"reviewer\":\"$r\"}"; done
```

Then give the rows every kind of status, in the test database (`docker exec -i nitpilot-postgres-1 psql -U nitpilot -d nitpilot_test`): `#139` phase `escalated` and maya's attention `decision`; `#151` maya's attention `manual_review`; `#147`'s job `running`; `#142` phase `ready` with its job `done` (`activeFor` null); `#136` phase `closed`, `merged` true, `closedAt` a day ago, its job `cancelled`. Sign in with `curl -s -X POST http://127.0.0.1:4320/signin -d '{"login":"maya"}'` and set that cookie in the tab (`document.cookie`).

Check at 1280 px and 375 px, light and dark: the red escalated pill with its diamond, the accent Needs you, the ring for Waiting and Their turn, the ping and the agent badge on #147, Merged muted with a line through; the unread dots; the offline banner and the expired strip (the test users have no GitHub sign-in); the filter popover (repos, then statuses) and Esc closing it; `j` drawing one inset ring on the first row; a click opening the PR beside the inbox (desktop) or on its own with ‹ and Esc going back (phone); the `/` hint and the footer hidden on the phone; GitHub avatars loading (the CSP allows them); no console errors after sign-in. Screenshots in the task report.

- [x] **Step 16: Run everything, then commit**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e && npm run test:e2e -w apps/web`
Expected: protocol 45, CLI 293 passed + 14 skipped, server 655, web 69; end to end 5; Playwright 4; typecheck and lint clean.

```bash
git add apps/web apps/server/test/e2e/web-server.ts docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(web): the inbox, with tabs, search, filters, keys, and the phone layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Milestone W3: Live chat (read-only)

W3 opens a chat: header, timeline, point cards, banners and the details panel, kept live over `/ws/web` while agents work, with the progress line. It replaces the server's transcript page at the same URL. Nothing can be clicked to change the chat yet (W4).

**Files at the end of W3:**
```
packages/protocol/src/web-api.ts       TimelineItem, MessagesResponse, ActivityView, ParticipantView, PointView, ChatView, ChatResponse, PrFile, FilesResponse
packages/protocol/src/web-messages.ts  WEB_WS_PATH, MAX_WEB_MESSAGE_BYTES, WebToServer, ServerToWeb
apps/server/src/
  ws/upgrade-router.ts                 one 'upgrade' listener, by path; refuse()
  ws/cli-hub.ts                        handleUpgrade (was attach), onPresence
  ws/web-hub.ts                        WebHub: Origin + session before upgrade, subscriptions, resume without gaps, access re-checks
  ws/web-wire.ts                       commits, CLI presence and job.progress → WebHub
  chats/timeline.ts                    toTimelineItem, loadItemsAfter, loadItemsBefore (pages of 200)
  chats/access.ts                      chatAccess, chatAccessByPath (one 404 for "missing" and "hidden")
  chats/views.ts                       loadChatView, loadChatPage
  chats/save.ts, apply-commands.ts, dispatch.ts   DispatchEffects.timeline (the seqs a commit added)
  http/routes/chats.ts                 GET chat, messages?before=, files
  http/errors.ts                       ErrorCode 'reauth' (401)
  lib/ttl-cache.ts                     TtlCache (RepoAccess and the file lists)
  lib/csrf.ts                          isAllowedUpgradeOrigin
  auth/session.ts                      sessionUserFromCookieHeader
  auth/users.ts                        loadWebMe (GET /api/me and me.update)
  auth/user-tokens.ts                  one refresh at a time per user, re-reading the row (M5)
  platform/{types,github/reads,github/payloads,fake/fake-platform}.ts   listPrFiles (up to 300)
  platform/github/client.ts            15 s timeout, a GithubError 504 (M4)
  http/routes/transcript.tsx, http/pages/transcript.tsx                  deleted
apps/server/test/web-ws.ts             startWebHub, TestTab (a browser tab's socket)
apps/server/test/e2e/                  harness serves /ws/web; github.ts addPull; web-server.ts control /reset, /cli
apps/cli/src/daemon.ts                 a stage change skips the progress throttle
apps/cli/src/agents/fake/scenarios/paced.json   a review slow enough to watch
apps/web/src/
  live/socket.ts, live/apply.ts, live/progress.ts, live/LiveProvider.tsx
  api/chat.ts                          useChat, fetchOlderItems, useFiles, useMarkRead
  lib/banner.ts, lib/timeline.ts, lib/snippet.ts, lib/names.ts, lib/clipboard.ts
  lib/time.ts                          + itemTime, useNow; lib/viewport.ts + useIsWide; lib/keys.ts ↑/↓ inside <main>
  routes/Chat/{Chat,ChatHeader,ChatBanner,Timeline,PointCard,DetailsPanel}.tsx (+ .module.css)
  routes/Shell/Shell.tsx               LiveProvider; the outlet passes `me`
  test/chat.ts, test/socket.ts
apps/web/e2e/chat-live.spec.ts
docs/why/web-socket-and-origin.md, docs/why/chat-access-rules.md, docs/why/chat-page.md (was transcript-page.md)
```

No new packages: W3 uses what W1 installed (`ws` was already the server's).

### Task 7: `/ws/web`: upgrade router, `WebHub`, resuming without gaps

**Files:**
- Create: `packages/protocol/src/web-messages.ts`, `packages/protocol/src/web-messages.test.ts`, `apps/server/src/ws/upgrade-router.ts`, `apps/server/src/ws/upgrade-router.test.ts`, `apps/server/src/chats/timeline.ts`, `apps/server/src/chats/timeline.db.test.ts`, `apps/server/src/chats/access.ts`, `apps/server/src/chats/access.db.test.ts`, `apps/server/src/ws/web-hub.ts`, `apps/server/src/ws/web-hub.db.test.ts`, `apps/server/test/web-ws.ts`, `docs/why/web-socket-and-origin.md`.
- Modify: `packages/protocol/src/web-api.ts` (`TimelineItem`), `packages/protocol/src/index.ts`, `apps/server/src/ws/cli-hub.ts` (`attach` → `handleUpgrade`; the path check and `refuse` move to the router), `apps/server/src/ws/cli-hub.db.test.ts`, `apps/server/test/ws.ts`, `apps/server/src/lib/csrf.ts` and `csrf.test.ts`, `apps/server/src/auth/session.ts`, `apps/server/test/db.ts` (`makeGithubSignIn`), `apps/server/src/main.ts`, `apps/server/test/e2e/harness.ts`, `docs/superpowers/specs/2026-10-07-nitpilot-design.md` (§10: the socket's messages; §16: an open subscription is checked again).

**Interfaces:**
- Consumes: `RepoAccess` and `ACCESS_TTL_MS` (`auth/repo-access.ts`), the session lookup inside `currentUser` (`auth/session.ts`), `SerialQueue` (`lib/serial-queue.ts`), `CLOSE_CODES` and `message()` (protocol), `InboxRow` and `WebMe` (Task 5), test helpers `makeRepo`, `makeChat`, `makeUser`, `makeMessage`, `sessionCookieFor`, `upgradeStatus`, `fakeFetch`, `json`.
- Produces (protocol): `TimelineItem = { seq, kind: MessageKind, author: { githubId, login } | null, pointNumber: number | null, jobId: string | null, body, data: Record<string, unknown> | null, at: string }` (`web-api.ts`). `WEB_WS_PATH = '/ws/web'`, `MAX_WEB_MESSAGE_BYTES = 64 KB`. `WebToServer = chat.subscribe { chatId, afterSeq } | chat.unsubscribe { chatId }`. `ServerToWeb = chat.items { chatId, items: TimelineItem[], lastSeq } | chat.error { chatId, code: 'not_found' | 'reauth' | 'unavailable' } | job.progress { chatId, who, action: 'reviewing' | 'fixing', stage, text } | inbox.upsert { chatId, rows: InboxRow[] } | me.update { me: WebMe }`, all in the `{ v: 1, t, d }` envelope. Task 8 adds `chat.state`.
- Produces (server): `routeUpgrades(server: Server, routes: Record<string, UpgradeHandler>): void` and `refuse(socket, status: 401 | 403 | 404 | 500)` (`ws/upgrade-router.ts`); `CliHub.handleUpgrade(req, socket, head)` replaces `attach(server)`. `isAllowedUpgradeOrigin(headers: { origin?: string; host?: string }, publicUrl: string): boolean` (`lib/csrf.ts`). `sessionUserFromCookieHeader(header: string | undefined, now?): Promise<SessionUser | null>` (`auth/session.ts`). `ITEMS_PER_PAGE = 200`, `ThreadPoints`, `toTimelineItem(m: Message, threads: ThreadPoints): TimelineItem`, `threadPointsOf(chatId)`, `loadItemsAfter(chatId, afterSeq): Promise<TimelineItem[]>` (`chats/timeline.ts`). `ChatAccess = { kind: 'read'; chat: { id; repoFullName } } | { kind: 'none' } | { kind: 'reauth' }`, `chatAccess(user: { id }, chatId, access: RepoAccess): Promise<ChatAccess>` (`chats/access.ts`; GitHub not answering is thrown). `WebHubDeps = { access: RepoAccess; loadItems(chatId, afterSeq): Promise<TimelineItem[]>; now?: () => number; heartbeatMs?: number }`; `class WebHub { handleUpgrade; publishItems(chatId, items); sendToChat(chatId, msg); sendToChatViewer(chatId, userId, msg); sendToUser(userId, msg); subscribers(chatId): SessionUser[]; idle(): Promise<void>; close(code, reason?) }`. Test helpers: `makeGithubSignIn(userId, status?: 'ok' | 'needs_reauth')` (`test/db.ts`); `startWebHub(deps)` and `TestTab` (`open`, `send`, `subscribe`, `next(t)`, `seqs(chatId)`, `nothing(t)`, `closed`) in `test/web-ws.ts`.

- [x] **Step 1: Write the failing test for the socket's messages**

Create `packages/protocol/src/web-messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TimelineItem } from './web-api';
import { ServerToWeb, WebToServer } from './web-messages';

const item: TimelineItem = {
  seq: 3,
  kind: 'point_raised',
  author: { githubId: '1002', login: 'leo' },
  pointNumber: 1,
  jobId: 'job_1',
  body: 'Cursor pagination skips rows',
  data: { severity: 'major', category: 'bug', path: 'src/orders.ts', line: 48 },
  at: '2026-10-16T09:00:00.000Z',
};

describe('/ws/web messages', () => {
  it('round-trips what a browser sends', () => {
    const subscribe: WebToServer = { v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: 0 } };
    expect(WebToServer.parse(JSON.parse(JSON.stringify(subscribe)))).toEqual(subscribe);
    expect(WebToServer.parse({ v: 1, t: 'chat.unsubscribe', d: { chatId: 'chat_1' } }).t).toBe('chat.unsubscribe');
  });

  it('refuses a negative cursor and anything a browser may not send', () => {
    expect(() => WebToServer.parse({ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: -1 } })).toThrow();
    expect(() => WebToServer.parse({ v: 1, t: 'chat.items', d: { chatId: 'chat_1', items: [], lastSeq: 0 } })).toThrow();
  });

  it('round-trips what the server sends', () => {
    const sent: ServerToWeb[] = [
      { v: 1, t: 'chat.items', d: { chatId: 'chat_1', items: [item], lastSeq: 3 } },
      { v: 1, t: 'chat.error', d: { chatId: 'chat_1', code: 'reauth' } },
      { v: 1, t: 'job.progress', d: { chatId: 'chat_1', who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading src/orders.ts' } },
      { v: 1, t: 'inbox.upsert', d: { chatId: 'chat_1', rows: [] } },
    ];
    for (const msg of sent) expect(ServerToWeb.parse(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `npm test -w packages/protocol -- src/web-messages.test.ts`
Expected: FAIL: `./web-messages` doesn't exist yet, so the file doesn't load.

- [x] **Step 3: The timeline item and the socket's messages**

A timeline item is what the browser reads of a stored `Message`. In `packages/protocol/src/web-api.ts`, import `MessageKind` beside `Role` (`import { MessageKind, Role } from './enums';`) and add at the end:

```ts
/**
 * One item of a chat's timeline (spec §8 `Message`), as the web app reads it over REST and `/ws/web`. `seq` is the
 * chat's resume cursor: 1, 2, 3… with no gaps. `pointNumber` also names the point for a person's reply in its
 * GitHub thread, so the web app can show the reply in that point's card. `author` is null for a system event.
 */
export const TimelineItem = z.object({
  seq: z.number().int().positive(),
  kind: MessageKind,
  author: z.object({ githubId: z.string(), login: z.string() }).nullable(),
  pointNumber: z.number().int().positive().nullable(),
  jobId: z.string().nullable(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  at: z.string(),
});
export type TimelineItem = z.infer<typeof TimelineItem>;
```

Create `packages/protocol/src/web-messages.ts` (`chat.state` comes in Task 8, with the view it carries):

```ts
import { z } from 'zod';
import { message } from './envelope';
import { InboxRow, TimelineItem, WebMe } from './web-api';

/** Where the web app opens its WebSocket (spec §10 "Web ↔ server"). */
export const WEB_WS_PATH = '/ws/web';

/** The biggest message a browser may send. Subscribing is all it does, so anything bigger is a mistake. */
export const MAX_WEB_MESSAGE_BYTES = 64 * 1024;

// ── browser → server ─────────────────────────────────────────

/** Send me this chat's new items: everything after `afterSeq` first, then each one as it happens. */
export const ChatSubscribe = message('chat.subscribe', z.object({ chatId: z.string(), afterSeq: z.number().int().nonnegative() }));
export const ChatUnsubscribe = message('chat.unsubscribe', z.object({ chatId: z.string() }));

export const WebToServer = z.discriminatedUnion('t', [ChatSubscribe, ChatUnsubscribe]);
export type WebToServer = z.infer<typeof WebToServer>;

// ── server → browser ─────────────────────────────────────────

/** New timeline items for a chat you subscribed to, oldest first. `lastSeq` is the newest one you now have. */
export const ChatItems = message('chat.items', z.object({ chatId: z.string(), items: z.array(TimelineItem), lastSeq: z.number().int().nonnegative() }));

/**
 * You can't (or can no longer) follow this chat. `not_found` covers "no such chat" and "you can't see its repo"
 * alike (spec §16); `reauth` means your GitHub sign-in expired; `unavailable` means GitHub didn't answer when
 * we asked. The subscription is gone either way.
 */
export const ChatError = message('chat.error', z.object({ chatId: z.string(), code: z.enum(['not_found', 'reauth', 'unavailable']) }));

/** A line of what an agent is doing right now (spec §10 `job.progress`, forwarded from its CLI; never stored). */
export const WebJobProgress = message('job.progress', z.object({
  chatId: z.string(),
  /** Whose agent: a GitHub login. */
  who: z.string(),
  action: z.enum(['reviewing', 'fixing']),
  stage: z.enum(['preparing', 'running_agent', 'pushing', 'finishing']),
  text: z.string(),
}));

/** Your inbox rows for one chat changed. `rows` replaces every row you had for `chatId`; empty removes them. */
export const InboxUpsert = message('inbox.upsert', z.object({ chatId: z.string(), rows: z.array(InboxRow) }));

/** What `GET /api/me` would answer now: one of your CLIs connected or disconnected. */
export const MeUpdate = message('me.update', z.object({ me: WebMe }));

export const ServerToWeb = z.discriminatedUnion('t', [ChatItems, ChatError, WebJobProgress, InboxUpsert, MeUpdate]);
export type ServerToWeb = z.infer<typeof ServerToWeb>;
```

In `packages/protocol/src/index.ts`, add `export * from './web-messages';` after `export * from './web-api';`.

- [x] **Step 4: Run it to see it pass**

Run: `npm test -w packages/protocol`
Expected: PASS, 48 tests (3 new).

- [x] **Step 5: Write the failing tests for the router and the Origin check**

Node gives an HTTP server one `'upgrade'` event for every WebSocket path, so two hubs can't each listen: one router picks the hub by path. Create `apps/server/src/ws/upgrade-router.test.ts`:

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { upgradeStatus } from '../../test/ws';
import { refuse, routeUpgrades } from './upgrade-router';

describe('routeUpgrades', () => {
  let server: Server;
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  async function serve(routes: Parameters<typeof routeUpgrades>[1]): Promise<number> {
    server = createServer();
    routeUpgrades(server, routes);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  it('hands each path to its own hub, and a query string does not change the path', async () => {
    const seen: string[] = [];
    const port = await serve({
      '/ws/cli': (req, socket) => (seen.push(`cli ${req.url}`), refuse(socket, 401)),
      '/ws/web': (req, socket) => (seen.push(`web ${req.url}`), refuse(socket, 403)),
    });
    expect(await upgradeStatus(port, '/ws/cli')).toBe(401);
    expect(await upgradeStatus(port, '/ws/web?tab=2')).toBe(403);
    expect(seen).toEqual(['cli /ws/cli', 'web /ws/web?tab=2']);
  });

  it('refuses a path no hub owns with a 404', async () => {
    const port = await serve({ '/ws/cli': (_req, socket) => refuse(socket, 401) });
    expect(await upgradeStatus(port, '/ws/other')).toBe(404);
    expect(await upgradeStatus(port, '/')).toBe(404);
  });
});
```

A browser sends the cookie on a WebSocket to any site, so the upgrade checks `Origin` the way writes do. In `apps/server/src/lib/csrf.test.ts`, import `isAllowedUpgradeOrigin` beside `isAllowedOrigin` and add at the end:

```ts
describe('isAllowedUpgradeOrigin', () => {
  it('accepts the public origin, and the host the socket was opened on', () => {
    expect(isAllowedUpgradeOrigin({ origin: PUBLIC, host: '10.0.0.5:8787' }, PUBLIC)).toBe(true);
    expect(isAllowedUpgradeOrigin({ origin: 'http://10.0.0.5:8787', host: '10.0.0.5:8787' }, PUBLIC)).toBe(true);
  });
  it('rejects another site, even with our host', () => expect(isAllowedUpgradeOrigin({ origin: 'https://evil.example', host: '10.0.0.5:8787' }, PUBLIC)).toBe(false));
  it('rejects a socket with no Origin', () => expect(isAllowedUpgradeOrigin({ host: '10.0.0.5:8787' }, PUBLIC)).toBe(false));
});
```

- [x] **Step 6: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/ws/upgrade-router.test.ts src/lib/csrf.test.ts`
Expected: FAIL: `./upgrade-router` doesn't exist, and the 3 new csrf tests fail with `TypeError: isAllowedUpgradeOrigin is not a function`.

- [x] **Step 7: One upgrade listener, and the Origin check for sockets**

Create `apps/server/src/ws/upgrade-router.ts` (`refuse` moves here from `cli-hub.ts`, so both hubs answer a refused upgrade the same way):

```ts
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

/** What handles a WebSocket upgrade for one path: a hub's `handleUpgrade`. */
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * Send each WebSocket upgrade on this HTTP server to the hub for its path (`/ws/cli`, `/ws/web`). Node gives a
 * server one 'upgrade' event for every path, so one listener has to pick; two hubs listening would both answer.
 * A path no hub owns gets a 404.
 */
export function routeUpgrades(server: Server, routes: Record<string, UpgradeHandler>): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const handler = routes[path];
    if (!handler) return refuse(socket, 404);
    handler(req, socket, head);
  });
}

/** Answer an upgrade request with a plain HTTP error and hang up. */
export function refuse(socket: Duplex, status: 401 | 403 | 404 | 500): void {
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
```

In `apps/server/src/ws/cli-hub.ts`:
1. The imports: `import type { IncomingMessage } from 'node:http';` (no more `STATUS_CODES` or `Server`), drop `CLI_WS_PATH` from the protocol import, and add `import { refuse } from './upgrade-router';`.
2. Replace `attach(server)` with the router's handler:

```ts
  /** An upgrade request for /ws/cli, handed over by the upgrade router (ws/upgrade-router.ts). */
  handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void this.upgrade(req, socket, head);
  };
```

3. In `upgrade`, delete the path check, `if (new URL(req.url ?? '/', 'http://localhost').pathname !== CLI_WS_PATH) return refuse(socket, 404);` (the router does it).
4. Delete the `refuse` function at the end of the file (with its doc comment).

In `apps/server/test/ws.ts`, `listen` serves the hub behind the router as `main.ts` does: import `routeUpgrades` from `'../src/ws/upgrade-router'`, change its doc comment to `/** Serve \`hub\` on a random local port, behind the upgrade router as in main.ts. */`, and replace `hub.attach(server);` with `routeUpgrades(server, { [CLI_WS_PATH]: hub.handleUpgrade });`.

In `apps/server/src/ws/cli-hub.db.test.ts`, `/ws/web` is no longer an unknown path: the 404 line becomes `expect(await upgradeStatus(port, '/ws/other', bearer(token.raw))).toBe(404);`.

In `apps/server/src/lib/csrf.ts`, add at the end:

```ts
/**
 * The same check for a WebSocket upgrade (spec §10): browsers send the cookie on a socket to any site, and
 * SameSite doesn't stop it, so the Origin header is what tells our pages from another site's
 * (docs/why/web-socket-and-origin.md). Browsers always send Origin on a WebSocket, so none is a no.
 */
export function isAllowedUpgradeOrigin(headers: { origin?: string; host?: string }, publicUrl: string): boolean {
  if (!headers.origin) return false;
  const allowed = new Set([new URL(publicUrl).origin]);
  if (headers.host) allowed.add(`http://${headers.host}`).add(`https://${headers.host}`);
  return allowed.has(headers.origin);
}
```

(The `host` the socket was opened on counts as ours, as `isAllowedOrigin` counts the request's own origin: a developer reaching the server on `127.0.0.1` or a LAN address still gets a socket.)

- [x] **Step 8: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/ws/upgrade-router.test.ts src/lib/csrf.test.ts && npm run test:db -w apps/server -- src/ws/cli-hub.db.test.ts`
Expected: PASS, 2 and 8 tests; the CLI hub's 10 tests still pass behind the router.

- [x] **Step 9: Write the failing tests for reading items and who can read a chat**

The tests make people with a GitHub sign-in on file. In `apps/server/test/db.ts`, import `encrypt` from `'../src/lib/crypto'` and add before `resetDb`:

```ts
/** A GitHub sign-in for `userId` that lasts a day, as signing in stores one (`needs_reauth` once it expired). */
export async function makeGithubSignIn(userId: string, status: 'ok' | 'needs_reauth' = 'ok') {
  const later = new Date(Date.now() + 86_400_000);
  return prisma.githubAuth.create({ data: { userId, accessTokenEnc: encrypt(`ghu_${userId}`), accessExpiresAt: later, refreshTokenEnc: encrypt('ghr_x'), refreshExpiresAt: later, status } });
}
```

Create `apps/server/src/chats/timeline.db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage, makeRepo, makeUser } from '../../test/db';
import { prisma } from '../lib/prisma';
import { loadItemsAfter } from './timeline';

describe('loadItemsAfter', () => {
  it('reads every item after a seq, oldest first, as the web app shows them', async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    const leo = await makeUser({ login: 'leo' });
    await makeMessage(chat.id, null, 'Pull request opened by maya');
    const said = await makeMessage(chat.id, leo, 'Please add a test');
    const items = await loadItemsAfter(chat.id, 0);
    expect(items.map((i) => i.seq)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ kind: 'system', author: null, body: 'Pull request opened by maya', pointNumber: null, data: null });
    expect(items[1]).toEqual({ seq: 2, kind: 'human', author: { githubId: leo.githubId, login: 'leo' }, pointNumber: null, jobId: null, body: 'Please add a test', data: null, at: said.createdAt.toISOString() });
    expect(await loadItemsAfter(chat.id, 2)).toEqual([]);
  });

  it("gives a person's reply in a point's GitHub thread that point's number", async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    const raisedBy = await makeUser();
    await prisma.point.create({
      data: { chatId: chat.id, number: 4, raisedByGithubId: raisedBy.githubId, origin: 'github', githubCommentId: '900', githubThreadRootId: '900', severity: 'minor', category: 'style', title: 'Name', body: 'Rename it', status: 'open', trusted: true, round: 1 },
    });
    await prisma.message.createMany({
      data: [
        { chatId: chat.id, seq: 1, kind: 'human', authorGithubId: raisedBy.githubId, authorLogin: raisedBy.login, body: 'Still not renamed', data: { threadRootId: '900' } },
        { chatId: chat.id, seq: 2, kind: 'human', authorGithubId: raisedBy.githubId, authorLogin: raisedBy.login, body: 'Elsewhere', data: { threadRootId: '901' } },
      ],
    });
    expect((await loadItemsAfter(chat.id, 0)).map((i) => i.pointNumber)).toEqual([4, null]);
  });
});
```

Create `apps/server/src/chats/access.db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeChat, makeGithubSignIn, makeRepo, makeUser } from '../../test/db';
import { fakeFetch, json } from '../../test/fake-fetch';
import { RepoAccess } from '../auth/repo-access';
import { GithubClient } from '../platform/github/client';
import { chatAccess } from './access';

async function viewer(status: 'ok' | 'needs_reauth' = 'ok') {
  const user = await makeUser();
  await makeGithubSignIn(user.id, status);
  return user;
}

describe('chatAccess (spec §16 "Who can see a chat")', () => {
  it("lets in anyone GitHub shows the repo to, and says none for a hidden repo or a chat that doesn't exist", async () => {
    const [open, hidden] = [await makeRepo(), await makeRepo()];
    const [a, b] = [await makeChat(open.id), await makeChat(hidden.id)];
    const fetch = fakeFetch({ [`GET /repos/${open.fullName}`]: () => ({ id: 1 }), [`GET /repos/${hidden.fullName}`]: () => json({ message: 'Not Found' }, 404) });
    const access = new RepoAccess(new GithubClient(fetch));
    const user = await viewer();
    expect(await chatAccess(user, a.id, access)).toEqual({ kind: 'read', chat: { id: a.id, repoFullName: open.fullName } });
    expect(await chatAccess(user, b.id, access)).toEqual({ kind: 'none' });
    const calls = fetch.calls.length;
    expect(await chatAccess(user, 'no-such-chat', access)).toEqual({ kind: 'none' });
    expect(fetch.calls).toHaveLength(calls);
  });

  it('says reauth when your GitHub sign-in expired', async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    const access = new RepoAccess(new GithubClient(fakeFetch({})));
    expect(await chatAccess(await viewer('needs_reauth'), chat.id, access)).toEqual({ kind: 'reauth' });
  });
});
```

- [x] **Step 10: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/chats/timeline.db.test.ts src/chats/access.db.test.ts`
Expected: FAIL: `./timeline` and `./access` don't exist.

- [x] **Step 11: Items after a seq, and who can read a chat**

Create `apps/server/src/chats/timeline.ts` (a person's reply in a point's GitHub thread is stored with `data.threadRootId` and no point number; the server fills the number in, so the web app can put the reply in that point's card):

```ts
import type { MessageKind, TimelineItem } from '@nitpilot/protocol';
import type { Message } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

/** Timeline items go to the browser in pages of at most this many, over REST and over `/ws/web`. */
export const ITEMS_PER_PAGE = 200;

/** Which point each GitHub thread belongs to: a thread's root comment id → the point's number. */
export type ThreadPoints = ReadonlyMap<string, number>;

/** A stored timeline item, as the web app reads it. A person's reply in a point's GitHub thread is given that point's number. */
export function toTimelineItem(m: Message, threads: ThreadPoints): TimelineItem {
  const data = (m.data as Record<string, unknown> | null) ?? null;
  const threadRootId = typeof data?.threadRootId === 'string' ? data.threadRootId : null;
  return {
    seq: m.seq,
    kind: m.kind as MessageKind,
    author: m.authorGithubId && m.authorLogin ? { githubId: m.authorGithubId, login: m.authorLogin } : null,
    pointNumber: m.pointNumber ?? (threadRootId ? (threads.get(threadRootId) ?? null) : null),
    jobId: m.jobId,
    body: m.body,
    data,
    at: m.createdAt.toISOString(),
  };
}

/** The chat's points by their GitHub thread: by the thread's root comment, and by the point's own comment. */
export async function threadPointsOf(chatId: string): Promise<ThreadPoints> {
  const points = await prisma.point.findMany({ where: { chatId }, select: { number: true, githubCommentId: true, githubThreadRootId: true } });
  const threads = new Map<string, number>();
  for (const p of points) {
    if (p.githubCommentId) threads.set(p.githubCommentId, p.number);
    if (p.githubThreadRootId) threads.set(p.githubThreadRootId, p.number);
  }
  return threads;
}

/** Every item after `afterSeq`, oldest first: what a browser that reconnects missed (spec §10 "Resuming without gaps"). */
export async function loadItemsAfter(chatId: string, afterSeq: number): Promise<TimelineItem[]> {
  const [messages, threads] = await Promise.all([
    prisma.message.findMany({ where: { chatId, seq: { gt: afterSeq } }, orderBy: { seq: 'asc' } }),
    threadPointsOf(chatId),
  ]);
  return messages.map((m) => toTimelineItem(m, threads));
}
```

Create `apps/server/src/chats/access.ts`:

```ts
import type { RepoAccess } from '../auth/repo-access';
import { prisma } from '../lib/prisma';

/** The chat you may read, with its repo; or why not. */
export type ChatAccess = { kind: 'read'; chat: { id: string; repoFullName: string } } | { kind: 'none' } | { kind: 'reauth' };

/**
 * Can this person read the chat (spec §16 "Who can see a chat")? Anyone whose GitHub account can read the repo,
 * asked with their own token and kept 5 minutes (auth/repo-access.ts). A chat that doesn't exist and one you
 * can't see are the same `none`, so nobody learns which chats exist (docs/why/chat-access-rules.md).
 * GitHub not answering is thrown, for the caller to say so.
 */
export async function chatAccess(user: { id: string }, chatId: string, access: RepoAccess): Promise<ChatAccess> {
  const chat = await prisma.prChat.findUnique({ where: { id: chatId }, select: { id: true, repo: { select: { fullName: true } } } });
  if (!chat) return { kind: 'none' };
  const answer = await access.check(user.id, chat.repo.fullName);
  return answer === 'read' ? { kind: 'read', chat: { id: chat.id, repoFullName: chat.repo.fullName } } : { kind: answer };
}
```

- [x] **Step 12: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/chats/timeline.db.test.ts src/chats/access.db.test.ts`
Expected: PASS, 2 and 2 tests.

- [x] **Step 13: Write the failing hub tests**

A test client that opens a socket the way a browser tab does: Node's built-in `WebSocket` with a cookie and an `Origin`. Create `apps/server/test/web-ws.ts`:

```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WEB_WS_PATH, type ServerToWeb, type WebToServer } from '@nitpilot/protocol';
import { routeUpgrades } from '../src/ws/upgrade-router';
import { WebHub, type WebHubDeps } from '../src/ws/web-hub';
import { sleep } from './ws';

// Helpers for testing /ws/web over real WebSockets: a hub on a random port, and a pretend browser tab.

type FromServer<T extends ServerToWeb['t']> = Extract<ServerToWeb, { t: T }>;

/** A WebHub behind the upgrade router, as main.ts serves it, on a random local port. */
export async function startWebHub(deps: WebHubDeps) {
  const hub = new WebHub(deps);
  const server = createServer();
  routeUpgrades(server, { [WEB_WS_PATH]: hub.handleUpgrade });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    hub,
    port,
    url: `ws://127.0.0.1:${port}${WEB_WS_PATH}`,
    /** The Origin our own pages would send: the address the socket is opened on. */
    origin: `http://127.0.0.1:${port}`,
    async close(): Promise<void> {
      hub.close(1001, 'test over');
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A browser tab's socket: Node's built-in WebSocket with the headers a browser sends, plus an inbox. */
export class TestTab {
  private readonly inbox: ServerToWeb[] = [];
  private readonly waiting = new Set<() => void>();
  /** Resolves when the socket closes, with the code the server gave. */
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.inbox.push(JSON.parse(String(event.data)) as ServerToWeb);
      for (const wake of this.waiting) wake();
    });
    this.closed = new Promise((resolve) => ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })));
  }

  /** Open a socket with this cookie and Origin. Rejects when the server refuses the upgrade. */
  static open(url: string, headers: { cookie: string; origin: string }): Promise<TestTab> {
    const ws = new WebSocket(url, { headers });
    const tab = new TestTab(ws);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(tab));
      ws.addEventListener('error', () => reject(new Error('the server refused the WebSocket')));
    });
  }

  send(msg: WebToServer): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  subscribe(chatId: string, afterSeq = 0): void {
    this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq } });
  }

  close(): void {
    this.ws.close();
  }

  /** Take the next message of type `t` out of the inbox, waiting up to `ms` for it. Other messages stay. */
  async next<T extends ServerToWeb['t']>(t: T, ms = 2_000): Promise<FromServer<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as FromServer<T>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms} ms; the inbox has: ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await this.anyMessage(left);
    }
  }

  /** Every item seq received so far in chat.items, in arrival order (the messages stay in the inbox). */
  seqs(chatId: string): number[] {
    return this.inbox.flatMap((m) => (m.t === 'chat.items' && m.d.chatId === chatId ? m.d.items.map((i) => i.seq) : []));
  }

  /** Fail if a message of type `t` is in the inbox after waiting `ms`. */
  async nothing(t: ServerToWeb['t'], ms = 300): Promise<void> {
    await sleep(ms);
    const got = this.inbox.find((m) => m.t === t);
    if (got) throw new Error(`expected no ${t}, got ${JSON.stringify(got)}`);
  }

  private anyMessage(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiting.add(done);
    });
  }
}
```

Create `apps/server/src/ws/web-hub.db.test.ts` (Review Focus 1: the item saved while the catch-up is read arrives once; Review Focus 2: a refused re-check after 5 minutes stops delivery):

```ts
import { WEB_WS_PATH, type TimelineItem } from '@nitpilot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { makeChat, makeGithubSignIn, makeMessage, makeRepo, makeUser } from '../../test/db';
import { fakeFetch, json } from '../../test/fake-fetch';
import { sessionCookieFor } from '../../test/http';
import { startWebHub, TestTab } from '../../test/web-ws';
import { sleep, upgradeStatus } from '../../test/ws';
import { ACCESS_TTL_MS, RepoAccess } from '../auth/repo-access';
import { loadItemsAfter } from '../chats/timeline';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';

/** What GitHub answers about each repo, by full name: read access (200), none (404), or a revoked token (401). */
const github: Record<string, 200 | 401 | 404> = {};
const githubRoutes = new Proxy({} as Parameters<typeof fakeFetch>[0], {
  get: (_routes, key: string) => {
    const repo = key.replace('GET /repos/', '');
    const status = github[repo];
    if (!status) return undefined;
    return () => (status === 200 ? { id: 1 } : json({ message: status === 404 ? 'Not Found' : 'Bad credentials' }, status));
  },
});

let clock = Date.now();
const now = () => clock;
let server: Awaited<ReturnType<typeof startWebHub>> | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(loadItems: (chatId: string, afterSeq: number) => Promise<TimelineItem[]> = loadItemsAfter) {
  server = await startWebHub({ access: new RepoAccess(new GithubClient(fakeFetch(githubRoutes)), now), loadItems, now });
  return server;
}

/** A signed-in person whose GitHub sign-in is `status`, with the cookie their browser sends. */
async function person(status: 'ok' | 'needs_reauth' = 'ok') {
  const user = await makeUser();
  await makeGithubSignIn(user.id, status);
  return { user, cookie: await sessionCookieFor(user.id) };
}

/** A chat in a repo GitHub says `access` about, with `items` system items already in it. */
async function chatWith(items: number, access: 200 | 401 | 404 = 200) {
  const repo = await makeRepo();
  github[repo.fullName] = access;
  const chat = await makeChat(repo.id);
  for (let i = 0; i < items; i++) await makeMessage(chat.id, null, `item ${i + 1}`);
  return { repo, chat };
}

/** Save one more item, as the dispatcher would, and tell the hub. */
async function commitItem(chatId: string): Promise<TimelineItem> {
  const m = await makeMessage(chatId, null, 'live');
  const [item] = await loadItemsAfter(chatId, m.seq - 1);
  server!.hub.publishItems(chatId, [item!]);
  return item!;
}

describe('WebHub: who may open a socket (spec §10)', () => {
  it('refuses an upgrade without a session (401), from another site (403) or with no Origin (403)', async () => {
    const { port, origin } = await start();
    const { cookie } = await person();
    expect(await upgradeStatus(port, WEB_WS_PATH, { origin })).toBe(401);
    expect(await upgradeStatus(port, WEB_WS_PATH, { origin: 'https://evil.example', cookie })).toBe(403);
    expect(await upgradeStatus(port, WEB_WS_PATH, { cookie })).toBe(403);
    expect(await upgradeStatus(port, WEB_WS_PATH, { origin, cookie })).toBe(101);
  });

  it('closes a socket that sends something that is not a message (1008)', async () => {
    const { url, origin } = await start();
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.sendRaw('{"t":"chat.items"}');
    expect((await tab.closed).code).toBe(1008);
  });

  it('closes the socket with 4401 when its session has ended', async () => {
    const { url, origin } = await start();
    const { user, cookie } = await person();
    const { chat } = await chatWith(0);
    const tab = await TestTab.open(url, { cookie, origin });
    await prisma.webSession.deleteMany({ where: { userId: user.id } });
    tab.subscribe(chat.id);
    expect((await tab.closed).code).toBe(4401);
  });
});

describe('WebHub: resuming without gaps (spec §10, Review Focus 1)', () => {
  it('sends what came after afterSeq, then each new item as it is saved', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(3);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 1);
    expect((await tab.next('chat.items')).d).toMatchObject({ chatId: chat.id, lastSeq: 3, items: [{ seq: 2, body: 'item 2' }, { seq: 3 }] });
    await commitItem(chat.id);
    expect((await tab.next('chat.items')).d).toMatchObject({ lastSeq: 4, items: [{ seq: 4, body: 'live' }] });
  });

  it('says "caught up" with no items when afterSeq is the newest, then sends live items', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(2);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 2);
    expect((await tab.next('chat.items')).d).toEqual({ chatId: chat.id, items: [], lastSeq: 2 });
    await commitItem(chat.id);
    expect((await tab.next('chat.items')).d.items.map((i) => i.seq)).toEqual([3]);
  });

  it('sends an item saved while the catch-up is being read exactly once', async () => {
    const { chat } = await chatWith(2);
    const { url, origin } = await start(async (chatId, afterSeq) => {
      // The dispatcher saves item 3 and publishes it in the middle of the hub's read…
      await commitItem(chatId);
      // …so the read sees it too.
      return loadItemsAfter(chatId, afterSeq);
    });
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 0);
    await expect.poll(() => tab.seqs(chat.id)).toEqual([1, 2, 3]);
    await server!.hub.idle();
    await sleep(100);
    expect(tab.seqs(chat.id)).toEqual([1, 2, 3]);
  });

  it('sends a long catch-up in pages of 200, in order', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(0);
    const many = Array.from({ length: 450 }, (_, i) => ({ chatId: chat.id, seq: i + 1, kind: 'system', body: `item ${i + 1}` }));
    await prisma.message.createMany({ data: many });
    await prisma.prChat.update({ where: { id: chat.id }, data: { lastSeq: 450 } });
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 0);
    const pages = [await tab.next('chat.items'), await tab.next('chat.items'), await tab.next('chat.items')];
    expect(pages.map((p) => p.d.items.length)).toEqual([200, 200, 50]);
    expect(pages.map((p) => p.d.lastSeq)).toEqual([200, 400, 450]);
  });
});

describe('WebHub: reading needs access (spec §16, Review Focus 2)', () => {
  it("answers not_found for a chat you can't see or that doesn't exist, and never sends its items", async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(1, 404);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id);
    expect((await tab.next('chat.error')).d).toEqual({ chatId: chat.id, code: 'not_found' });
    tab.subscribe('no-such-chat');
    expect((await tab.next('chat.error')).d).toEqual({ chatId: 'no-such-chat', code: 'not_found' });
    await commitItem(chat.id);
    await tab.nothing('chat.items');
  });

  it('answers reauth when your GitHub sign-in expired', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(1);
    const tab = await TestTab.open(url, { cookie: (await person('needs_reauth')).cookie, origin });
    tab.subscribe(chat.id);
    expect((await tab.next('chat.error')).d.code).toBe('reauth');
  });

  it('asks GitHub again once the answer is 5 minutes old, and stops sending to someone who lost access', async () => {
    const { url, origin } = await start();
    const { repo, chat } = await chatWith(1);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 1);
    await tab.next('chat.items');
    // Removed from the repo on GitHub. Within the 5 minutes, items still arrive…
    github[repo.fullName] = 404;
    await commitItem(chat.id);
    expect((await tab.next('chat.items')).d.items.map((i) => i.seq)).toEqual([2]);
    // …after them, the next item asks GitHub, which now says no.
    clock += ACCESS_TTL_MS;
    await commitItem(chat.id);
    expect((await tab.next('chat.error')).d).toEqual({ chatId: chat.id, code: 'not_found' });
    await tab.nothing('chat.items');
    expect(server!.hub.subscribers(chat.id)).toEqual([]);
  });
});

describe('WebHub: subscriptions', () => {
  it('stops sending after an unsubscribe, and forgets a closed socket', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(0);
    const { user, cookie } = await person();
    const tab = await TestTab.open(url, { cookie, origin });
    tab.subscribe(chat.id);
    await tab.next('chat.items');
    expect(server!.hub.subscribers(chat.id).map((u) => u.id)).toEqual([user.id]);
    tab.send({ v: 1, t: 'chat.unsubscribe', d: { chatId: chat.id } });
    await server!.hub.idle();
    await commitItem(chat.id);
    await tab.nothing('chat.items');

    const other = await TestTab.open(url, { cookie, origin });
    other.subscribe(chat.id);
    await other.next('chat.items');
    other.close();
    await other.closed;
    await expect.poll(() => server!.hub.subscribers(chat.id)).toEqual([]);
  });

  it('follows several chats on one socket, and sends to a person every socket of theirs', async () => {
    const { url, origin } = await start();
    const [a, b] = [await chatWith(0), await chatWith(0)];
    const { user, cookie } = await person();
    const tab = await TestTab.open(url, { cookie, origin });
    const second = await TestTab.open(url, { cookie, origin });
    tab.subscribe(a.chat.id);
    tab.subscribe(b.chat.id);
    await tab.next('chat.items');
    await tab.next('chat.items');
    await commitItem(b.chat.id);
    expect((await tab.next('chat.items')).d.chatId).toBe(b.chat.id);
    server!.hub.sendToUser(user.id, { v: 1, t: 'inbox.upsert', d: { chatId: a.chat.id, rows: [] } });
    expect((await tab.next('inbox.upsert')).d.chatId).toBe(a.chat.id);
    expect((await second.next('inbox.upsert')).d.chatId).toBe(a.chat.id);
  });
});
```

- [x] **Step 14: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/ws/web-hub.db.test.ts`
Expected: FAIL: `../src/ws/web-hub` doesn't exist (imported by `test/web-ws.ts`).

- [x] **Step 15: The hub**

An upgrade arrives as Node's raw request, not a Hono `Context`, so the session is read from the `cookie` header. In `apps/server/src/auth/session.ts`, import `parse` from `'hono/utils/cookie'` and replace `currentUser`'s first line (`const raw = getCookie(c, BRAND.sessionCookie);`) so the lookup is shared:

```ts
export async function currentUser(c: Context, now = new Date()): Promise<SessionUser | null> {
  return sessionUser(getCookie(c, BRAND.sessionCookie), now);
}

/**
 * The same, for a request Hono doesn't handle: a WebSocket upgrade arrives as Node's raw request, with only
 * its `cookie` header (ws/web-hub.ts). The hub also calls it again later, to notice a sign-out.
 */
export async function sessionUserFromCookieHeader(header: string | undefined, now = new Date()): Promise<SessionUser | null> {
  return sessionUser(header ? parse(header, BRAND.sessionCookie)[BRAND.sessionCookie] : undefined, now);
}

async function sessionUser(raw: string | undefined, now: Date): Promise<SessionUser | null> {
```

(The rest of the old `currentUser` body, from `if (!raw) return null;` on, is now `sessionUser`'s.)

Create `apps/server/src/ws/web-hub.ts`:

```ts
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { CLOSE_CODES, MAX_WEB_MESSAGE_BYTES, WebToServer, type ServerToWeb, type TimelineItem } from '@nitpilot/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { ACCESS_TTL_MS, type RepoAccess } from '../auth/repo-access';
import { sessionUserFromCookieHeader, type SessionUser } from '../auth/session';
import { chatAccess } from '../chats/access';
import { ITEMS_PER_PAGE } from '../chats/timeline';
import { isAllowedUpgradeOrigin } from '../lib/csrf';
import { getEnv } from '../lib/env';
import { SerialQueue } from '../lib/serial-queue';
import { refuse } from './upgrade-router';

/** WebSocket's "policy violation" close code: the browser sent something it never should. */
const CLOSE_POLICY = 1008;
/** A ping every 30 s; a socket that didn't answer the previous one is dead. So a dead socket goes within 60 s. */
const HEARTBEAT_MS = 30_000;

/** One chat a socket follows. */
type Subscription = {
  chatId: string;
  repoFullName: string;
  /** When read access was last confirmed. */
  checkedAt: number;
  /** The newest item this socket has been sent. */
  sentUpTo: number;
  /** While the catch-up is read from the database, live items wait here; null once it was sent. */
  buffer: TimelineItem[] | null;
};

/** One browser tab's socket. */
type Client = {
  ws: WebSocket;
  user: SessionUser;
  /** The cookie it connected with, to notice a sign-out later. */
  cookie: string | undefined;
  subs: Map<string, Subscription>;
  /** Everything for this socket happens in order: subscribes, catch-ups, sends. */
  queue: SerialQueue;
  /** Answered the last ping. */
  alive: boolean;
};

export type WebHubDeps = {
  access: RepoAccess;
  /** Every item of a chat after `afterSeq`, oldest first (chats/timeline.ts). Tests pass their own. */
  loadItems: (chatId: string, afterSeq: number) => Promise<TimelineItem[]>;
  now?: () => number;
  heartbeatMs?: number;
};

/**
 * The browser end of `/ws/web` (spec §10 "Web ↔ server"). A tab opens one socket, signed in by its cookie, and
 * subscribes to the chats it shows; the server pushes their new items, and whatever else changed for that person.
 * Changes never come in this way: they're REST calls. See docs/why/web-socket-and-origin.md.
 */
export class WebHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WEB_MESSAGE_BYTES });
  private readonly clients = new Set<Client>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly deps: WebHubDeps) {
    this.now = deps.now ?? Date.now;
    this.heartbeat = setInterval(() => this.checkAlive(), deps.heartbeatMs ?? HEARTBEAT_MS);
    // The timer alone never keeps the process running.
    this.heartbeat.unref();
  }

  /** An upgrade request for /ws/web, handed over by the upgrade router (ws/upgrade-router.ts). */
  handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void this.upgrade(req, socket, head);
  };

  /**
   * New items of a chat, after the dispatcher saved them. A socket still catching up keeps them until its
   * catch-up is sent; any it already has are skipped.
   */
  publishItems(chatId: string, items: TimelineItem[]): void {
    for (const client of this.clients) {
      const sub = client.subs.get(chatId);
      if (!sub) continue;
      if (sub.buffer) {
        sub.buffer.push(...items);
        continue;
      }
      client.queue.push(async () => {
        if (await this.stillAllowed(client, sub)) this.sendItems(client, sub, items);
      });
    }
  }

  /** A message for everyone following this chat (the live progress line, say). */
  sendToChat(chatId: string, msg: ServerToWeb): void {
    for (const client of this.clients) this.sendIfSubscribed(client, chatId, msg);
  }

  /** A message for one person's sockets that follow this chat (their own view of it). */
  sendToChatViewer(chatId: string, userId: string, msg: ServerToWeb): void {
    for (const client of this.clients) if (client.user.id === userId) this.sendIfSubscribed(client, chatId, msg);
  }

  /** A message for every socket of one person, whatever they follow (their inbox, their CLIs). */
  sendToUser(userId: string, msg: ServerToWeb): void {
    for (const client of this.clients) {
      if (client.user.id === userId) client.queue.push(async () => send(client.ws, msg));
    }
  }

  /** Who follows this chat right now, once each. */
  subscribers(chatId: string): SessionUser[] {
    const users = new Map<string, SessionUser>();
    for (const client of this.clients) if (client.subs.has(chatId)) users.set(client.user.id, client.user);
    return [...users.values()];
  }

  /** Resolves once everything queued so far for every socket has run. Tests use it. */
  async idle(): Promise<void> {
    await Promise.all([...this.clients].map((c) => c.queue.idle()));
  }

  /** Close every socket and stop the heartbeat. With 1012 on shutdown, the tabs reconnect. */
  close(code: number, reason = ''): void {
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.close(code, reason);
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const onError = () => socket.destroy();
    socket.on('error', onError);
    try {
      // Both are checked before the upgrade, so another site's page never gets a socket (spec §10).
      if (!isAllowedUpgradeOrigin(req.headers, getEnv().PUBLIC_URL)) return refuse(socket, 403);
      const user = await sessionUserFromCookieHeader(req.headers.cookie);
      if (!user) return refuse(socket, 401);
      socket.removeListener('error', onError);
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, user, req.headers.cookie));
    } catch (err) {
      console.error('[web-hub] upgrade failed:', err);
      refuse(socket, 500);
    }
  }

  private accept(ws: WebSocket, user: SessionUser, cookie: string | undefined): void {
    const client: Client = { ws, user, cookie, subs: new Map(), queue: new SerialQueue(), alive: true };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data, isBinary) => {
      const msg = readMessage(data, isBinary);
      if (!msg) return ws.close(CLOSE_POLICY, 'not a message this server understands');
      if (msg.t === 'chat.subscribe') client.queue.push(() => this.subscribe(client, msg.d.chatId, msg.d.afterSeq));
      else client.queue.push(async () => void client.subs.delete(msg.d.chatId));
    });
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', (err) => console.warn('[web-hub] socket error:', err.message));
  }

  /**
   * Resuming without gaps (spec §10): register the subscription first, so items saved from now on wait in its
   * buffer; then send everything after `afterSeq` from the database; then the buffer, skipping what the
   * database already had. An item saved during the read is in both, and goes once.
   */
  private async subscribe(client: Client, chatId: string, afterSeq: number): Promise<void> {
    if (!(await this.sessionStillValid(client))) return;
    let allowed: Awaited<ReturnType<typeof chatAccess>>;
    try {
      allowed = await chatAccess(client.user, chatId, this.deps.access);
    } catch (err) {
      console.error(`[web-hub] could not check access to chat ${chatId}:`, err);
      return send(client.ws, chatError(chatId, 'unavailable'));
    }
    if (allowed.kind !== 'read') return send(client.ws, chatError(chatId, allowed.kind === 'reauth' ? 'reauth' : 'not_found'));

    const sub: Subscription = { chatId, repoFullName: allowed.chat.repoFullName, checkedAt: this.now(), sentUpTo: afterSeq, buffer: [] };
    client.subs.set(chatId, sub);
    const missed = await this.deps.loadItems(chatId, afterSeq);
    // Even with nothing missed, one chat.items says "you're caught up".
    if (missed.length === 0) send(client.ws, { v: 1, t: 'chat.items', d: { chatId, items: [], lastSeq: afterSeq } });
    for (let i = 0; i < missed.length; i += ITEMS_PER_PAGE) this.sendItems(client, sub, missed.slice(i, i + ITEMS_PER_PAGE));
    const live = sub.buffer ?? [];
    sub.buffer = null;
    this.sendItems(client, sub, live);
  }

  /** Send the items this socket doesn't have yet, oldest first. */
  private sendItems(client: Client, sub: Subscription, items: TimelineItem[]): void {
    const fresh = items.filter((item) => item.seq > sub.sentUpTo).sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;
    sub.sentUpTo = fresh[fresh.length - 1]!.seq;
    send(client.ws, { v: 1, t: 'chat.items', d: { chatId: sub.chatId, items: fresh, lastSeq: sub.sentUpTo } });
  }

  private sendIfSubscribed(client: Client, chatId: string, msg: ServerToWeb): void {
    if (!client.subs.has(chatId)) return;
    client.queue.push(async () => {
      const sub = client.subs.get(chatId);
      if (sub && (await this.stillAllowed(client, sub))) send(client.ws, msg);
    });
  }

  /**
   * Access is kept 5 minutes, like everywhere else (spec §16). Past that, the next thing sent for this chat
   * asks again: a person removed from the repo gets `chat.error` and nothing more. If GitHub doesn't answer,
   * the subscription stays and is asked about again next time: a GitHub hiccup isn't a reason to cut people off.
   */
  private async stillAllowed(client: Client, sub: Subscription): Promise<boolean> {
    if (this.now() - sub.checkedAt < ACCESS_TTL_MS) return true;
    if (!(await this.sessionStillValid(client))) return false;
    let answer: Awaited<ReturnType<RepoAccess['check']>>;
    try {
      answer = await this.deps.access.check(client.user.id, sub.repoFullName);
    } catch (err) {
      console.error(`[web-hub] could not check access to ${sub.repoFullName} again:`, err);
      return true;
    }
    if (answer === 'read') {
      sub.checkedAt = this.now();
      return true;
    }
    client.subs.delete(sub.chatId);
    send(client.ws, chatError(sub.chatId, answer === 'reauth' ? 'reauth' : 'not_found'));
    return false;
  }

  /** A socket whose session ended (signed out, expired) is closed with 4401: the tab shows the landing page. */
  private async sessionStillValid(client: Client): Promise<boolean> {
    if (await sessionUserFromCookieHeader(client.cookie)) return true;
    client.ws.close(CLOSE_CODES.reauth, 'signed out');
    return false;
  }

  /** Terminate sockets that didn't answer the last ping, and ping the rest. */
  private checkAlive(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }
}

function chatError(chatId: string, code: 'not_found' | 'reauth' | 'unavailable'): ServerToWeb {
  return { v: 1, t: 'chat.error', d: { chatId, code } };
}

function send(ws: WebSocket, msg: ServerToWeb): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** One frame as a browser message, or null when it isn't one. */
function readMessage(data: RawData, isBinary: boolean): WebToServer | null {
  if (isBinary) return null;
  try {
    const parsed = WebToServer.safeParse(JSON.parse(data.toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

- [x] **Step 16: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/ws/web-hub.db.test.ts`
Expected: PASS, 12 tests.

- [x] **Step 17: Serve it**

In `apps/server/src/main.ts`:
1. Imports: `CLI_WS_PATH` and `WEB_WS_PATH` beside `CLOSE_CODES` from `@nitpilot/protocol`; `RepoAccess` from `'./auth/repo-access'`; `loadItemsAfter` from `'./chats/timeline'`; `routeUpgrades` from `'./ws/upgrade-router'`; `WebHub` from `'./ws/web-hub'`.
2. After `const notifier = new CliNotifier(hub);`:

```ts
  // Browsers follow chats live over /ws/web: their new items as they're saved (spec §10, docs/why/web-socket-and-origin.md).
  const webHub = new WebHub({ access: new RepoAccess(github), loadItems: loadItemsAfter });
```

3. Replace `hub.attach(server as Server);` and its comment with:

```ts
  // serve() makes a plain HTTP/1 server. Each WebSocket upgrade on it goes to the hub for its path.
  routeUpgrades(server as Server, { [CLI_WS_PATH]: hub.handleUpgrade, [WEB_WS_PATH]: webHub.handleUpgrade });
```

4. In the shutdown handler, after `hub.closeAll(CLOSE_CODES.serverRestart, 'server restarting');`: `webHub.close(CLOSE_CODES.serverRestart, 'server restarting');`.

In `apps/server/test/e2e/harness.ts`, the same wiring:
1. Imports: `CLI_WS_PATH`, `WEB_WS_PATH` from `@nitpilot/protocol`; `RepoAccess`; `loadItemsAfter`; `routeUpgrades`; `WebHub`; `fakeFetch` from `'../fake-fetch'`; and `GithubClient` as a value (`import { GithubClient } from '../../src/platform/github/client';`, no longer `import type`).
2. Replace the `const app = testApp(…)` line with:

```ts
  // GitHub's API for people's own access checks; nothing answers unless the caller passes one that does.
  const githubApi = opts.github ?? new GithubClient(fakeFetch({}));
  const webHub = new WebHub({ access: new RepoAccess(githubApi), loadItems: loadItemsAfter });
  const app = testApp({ ingest, dispatch: dispatcher.dispatch, clis: hub, github: githubApi, ...(opts.webDistDir ? { webDistDir: opts.webDistDir } : {}) });
```

3. In `close()`, after `hub.closeAll(1001, 'test over');`: `webHub.close(1001, 'test over');`.
4. Replace `hub.attach(listening);` with `routeUpgrades(listening, { [CLI_WS_PATH]: hub.handleUpgrade, [WEB_WS_PATH]: webHub.handleUpgrade });`.
5. Return `webHub` beside `hub`.

- [x] **Step 18: The explainer, and the spec**

Create `docs/why/web-socket-and-origin.md` (CLAUDE.md: the first time a backend concept shows up in the code):

````markdown
# The browser's WebSocket: cookies, Origin, and resuming without gaps

**In one sentence:** each browser tab opens one WebSocket to `/ws/web`, signed in by the same cookie as every REST call, and the server pushes new chat items down it the moment they're saved, so a chat updates while the agents work without anyone reloading.

## Two hubs, one server (`ws/upgrade-router.ts`)

Node gives an HTTP server a single `'upgrade'` event for every WebSocket request, whatever its path. With two hubs (`/ws/cli` for CLIs, `/ws/web` for browsers) both listening, both would answer the same request. So one small router listens, reads the path, and hands the request to that path's hub; any other path gets a 404. It's a `<Routes>` for sockets.

## Who may open one (`ws/web-hub.ts`)

A CLI proves who it is with a `Bearer` token it sends on purpose. A browser sends the session cookie on its own, to any request for our address, including a WebSocket that another site's page opens. That's the catch:

- **SameSite doesn't help.** `SameSite=Lax` keeps the cookie off cross-site POSTs, but browsers send it on a cross-site WebSocket anyway. A page on `evil.example` could open `wss://nitpilot.dev/ws/web` and receive your chats as you. That attack is called cross-site WebSocket hijacking.
- **The Origin header does.** Every WebSocket request carries `Origin`: the site whose page opened it. The browser sets it, and a page can't change it. The hub checks it before upgrading (`isAllowedUpgradeOrigin` in `lib/csrf.ts`): our own address, or `PUBLIC_URL`, or no socket (403). No `Origin` at all is a no too: browsers always send one.
- **Then the cookie.** No valid session: 401, and no socket.

Both checks happen before the upgrade, while it's still an ordinary HTTP request that can be refused with a status code.

In React terms: the REST writes already do this check (`requireSameOrigin`), because a form on another site could post to us with your cookie. A WebSocket is the same risk in a different shape.

## Who may follow which chat

Opening the socket only proves who you are. Each chat a tab wants is a `chat.subscribe`, and the hub asks the same question as the REST routes: can your GitHub account read this repo (`chats/access.ts`, `auth/repo-access.ts`, spec §16)? If not, the tab gets `chat.error not_found`, the same answer as for a chat that doesn't exist, and nothing of that chat is ever sent.

The answer is kept 5 minutes. A socket can stay open for hours, so when an answer is older than that, the next thing about to be sent for that chat asks GitHub again. Someone removed from the repo stops getting items within those 5 minutes, and gets `chat.error`. A session that ended (signed out, expired) closes the socket with `4401`, and the tab shows the landing page.

## Resuming without gaps

A tab that reconnects (the laptop slept, the Wi-Fi dropped) must show every item exactly once, in order. Every item has a `seq`: 1, 2, 3… per chat, with no gaps (spec §8). The tab subscribes with the newest `seq` it has (`afterSeq`). The hard part is the moment between "read what you missed from the database" and "start sending live items": an item saved right then could fall between the two, or arrive twice.

So the hub does it in this order:

```
1. register the subscription, with an empty buffer   ← from now on, live items wait in the buffer
2. read every item after afterSeq from the database  ← an item saved during this read is in the DB…
3. send them                                         ← …and goes out here
4. send the buffer, skipping any seq already sent    ← …so its copy in the buffer is skipped
5. from now on, send live items straight away
```

An item saved before step 1 is in the database: step 2 reads it. An item saved after step 1 lands in the buffer: step 4 sends it, unless step 2 already did. Nothing falls in between, and nothing goes twice. The test "sends an item saved while the catch-up is being read exactly once" in `ws/web-hub.db.test.ts` saves an item in the middle of step 2.

The browser keeps a second guard: it drops any `seq` it already has, and after a reconnect it subscribes again with each open chat's newest `seq`.

## Keeping it honest

- Everything for one socket happens in order (`lib/serial-queue.ts`), so a catch-up and the live items after it can't overtake each other.
- A browser only ever sends `chat.subscribe` and `chat.unsubscribe`. Anything else, or anything over 64 KB, closes the socket (1008, or 1009 for the size).
- A ping every 30 s; a socket that didn't answer the last one is closed, so a dead tab is gone within a minute.

## The React analogy

- `chat.subscribe` is a `useEffect` that subscribes to a store and returns an unsubscribe, with the `seq` as a cursor, like a paginated query's `getNextPageParam`.
- The buffer is what you'd do if a subscription could fire while your initial `fetch` was still loading: hold the updates, then apply them on top of the fetched data, ignoring those the fetch already included.
````

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §10 "Web ↔ server", make the messages match `web-messages.ts`:
- `job.progress {chatId, who, stage, text}` becomes `job.progress {chatId, who, action, stage, text}` (`action` is `reviewing` or `fixing`, so the line can say "leo's agent is reviewing…").
- `inbox.upsert {row}` becomes `inbox.upsert {chatId, rows}`: every row that person has for that chat (an author who also reviews has two), an empty list removing them.
- After the `me.update` item, add: "`chat.error {chatId, code}` when a subscribe is refused, or an open subscription's access check fails: `not_found` (no such chat, or you can't see its repo), `reauth` (your GitHub sign-in expired), `unavailable` (GitHub didn't answer; the client asks again a little later). The subscription is gone. A socket whose session ended is closed with 4401."
- In "Resuming without gaps", "then catch up from `afterSeq` out of the database" becomes "then catch up from `afterSeq` out of the database, every missed item, in `chat.items` messages of at most 200".

In §16 "Who can see a chat", after "checked with their own token and cached for 5 minutes.", add: "A chat open on `/ws/web` is checked again once that answer is 5 minutes old, the next time something is sent for it; losing access ends the subscription with `chat.error`."

- [x] **Step 19: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e`
Expected: protocol 48, CLI 293 passed + 14 skipped, server 686, web 73; end to end 5; typecheck and lint clean.

- [x] **Step 20: Commit**

```bash
git add packages/protocol/src apps/server/src/ws apps/server/src/chats/timeline.ts apps/server/src/chats/timeline.db.test.ts apps/server/src/chats/access.ts apps/server/src/chats/access.db.test.ts apps/server/src/lib/csrf.ts apps/server/src/lib/csrf.test.ts apps/server/src/auth/session.ts apps/server/src/main.ts apps/server/test/db.ts apps/server/test/ws.ts apps/server/test/web-ws.ts apps/server/test/e2e/harness.ts docs/why/web-socket-and-origin.md docs/superpowers/specs/2026-10-07-nitpilot-design.md docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(server): /ws/web, the browser's socket, resuming without gaps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Chat view, messages and files over REST (+ GitHub timeouts, one token refresh at a time)

**Files:**
- Create: `apps/server/src/lib/ttl-cache.ts`, `apps/server/src/lib/ttl-cache.test.ts`, `apps/server/src/chats/views.ts`, `apps/server/src/chats/views.db.test.ts`, `apps/server/src/http/routes/chats.ts`, `apps/server/src/http/routes/chats.db.test.ts`, `docs/why/chat-access-rules.md`.
- Modify: `packages/protocol/src/web-api.ts` and its test (the chat's bodies), `packages/protocol/src/web-messages.ts` (`chat.state`), `apps/server/src/auth/repo-access.ts` (on `TtlCache`), `apps/server/src/auth/user-tokens.ts` (**M5**), `apps/server/src/platform/github/client.ts` and its test (**M4**), `apps/server/src/platform/types.ts`, `apps/server/src/platform/github/payloads.ts`, `apps/server/src/platform/github/reads.ts` and its test, `apps/server/src/platform/fake/fake-platform.ts` and its test (`listPrFiles`), `apps/server/src/chats/access.ts` (`chatAccessByPath`), `apps/server/src/chats/timeline.ts` (`loadItemsBefore`), `apps/server/src/chats/inbox.ts` (export `githubAvatar`), `apps/server/src/http/errors.ts` (`reauth`), `apps/server/src/http/routes/inbox.ts` and `inbox.db.test.ts`, `apps/server/src/http/app.ts`, `apps/server/test/app.ts`, `apps/server/src/main.ts`, `apps/server/test/e2e/harness.ts`, `docs/superpowers/specs/2026-10-07-nitpilot-design.md` (§10: what the chat read answers).

**Interfaces:**
- Consumes: `chatAccess`, `ChatAccess`, `ITEMS_PER_PAGE`, `threadPointsOf`, `toTimelineItem` (Task 7); `loadActivity`, `LiveClis` (`chats/activity.ts`); `failureKind` (`chats/failed-flags.ts`, `'agent' | 'github_post' | null`); `rulesFromJson`, `repoRef` (`chats/rules.ts`); `requireUser`, `UserVariables` (Task 3); `HttpError`; `KeyedLock` (`lib/key-lock.ts`); `makeParticipant`, `makeMessage`, `makeCliToken`, `makeGithubSignIn`.
- Produces (protocol): `MessagesResponse = { items: TimelineItem[]; hasOlder }`. `ActivityView = { kind: 'agent_working' | 'agent_waiting' | 'human_turn' | 'none'; who: string | null; why: 'offline' | 'repo_not_linked' | 'cap_reached' | null; offlineSince: string | null }`. `ParticipantView = { githubId, login, avatarUrl, role, isBot, onNitpilot, requested, agent: { online, offlineSince: string | null, working } | null }`. `PointView = { number, raisedBy: { githubId, login }, origin, path, line, side, url: string | null, severity, category, title, body, snippet, status, authorResolution, escalationReason, trusted, round }`. `ChatView = { id, repo, number, title, url, author, headRef, baseRef, phase, round, maxRounds, merged, closed, trusted, isDraft, viewer: { role: Role | null; attention; failure: 'agent' | 'github_post' | null }, participants, activity, points, rules: { maxRounds, alwaysEscalate, autoReview, autoAddress, error: string | null }, summaryUrl: string | null, lastSeq }`. `ChatResponse = { view: ChatView; items: TimelineItem[]; hasOlder }`. `PrFile = { path, oldPath: string | null, status: 'added' | 'modified' | 'removed' | 'renamed', adds, dels }`. `FilesResponse = { files: PrFile[]; adds; dels; truncated }`. `ServerToWeb` gains `chat.state { chatId, view: ChatView }`.
- Produces (server): `TtlCache<V>(ttlMs, maxEntries, now?)` with `get(key): V | undefined` and `set(key, value)` (`lib/ttl-cache.ts`). `ErrorCode` gains `'reauth'` (401). `isGithubName(s): boolean` and `chatAccessByPath(user, path: { owner; repo; number }, access): Promise<ChatAccess>` (`chats/access.ts`). `loadItemsBefore(chatId, beforeSeq: number | null): Promise<MessagesResponse>` (`chats/timeline.ts`). `ChatViewer = { githubId }`, `loadChatView(chatId, viewer, clis, now?): Promise<ChatView>`, `loadChatPage(chatId, viewer, clis): Promise<ChatResponse>` (`chats/views.ts`). `chatRoutes(deps: { github; platform: PlatformReads; clis })` with `FILES_TTL_MS = 10 min`, `MAX_FILE_LISTS = 500`. `PlatformReads.listPrFiles(pr: PrRef): Promise<{ files: PrFile[]; truncated: boolean }>`, `MAX_PR_FILES = 300` (`platform/types.ts`); `FakePlatform.prFiles` (`Map<"owner/repo#n", PrFile[]>`) and `fileLists` (what was asked). `GITHUB_TIMEOUT_MS = 15_000`; `GithubClient`'s fourth constructor argument is `timeoutMs`. `AppDeps.platform: PlatformReads`. `githubAvatar(githubId)` is exported from `chats/inbox.ts`.
- Routes: `GET /api/chats/:owner/:repo/:number` → `ChatResponse` (newest 200 items); `GET /api/chats/:id/messages?before=<seq>` → `MessagesResponse`; `GET /api/chats/:id/files` → `FilesResponse`, kept per `(chatId, headSha)` for 10 minutes. Each: `requireUser`, then the access check; "no such chat" and "can't see it" are the same 404 `{ code: 'not_found' }`; an expired GitHub sign-in is a 401 `{ code: 'reauth', message: 'Sign in with GitHub again to see this chat.' }`; GitHub not answering is a 502 `github_unavailable`.

- [ ] **Step 1: Write the failing test for the chat's bodies**

In `packages/protocol/src/web-api.test.ts`, import `ChatResponse`, `FilesResponse` and `type ChatView` beside the others, and add after the last test:

```ts
  it('round-trips a chat with its points and items, and a files list', () => {
    const view: ChatView = {
      id: 'chat_1', repo: 'acme/shop-api', number: 142, title: 'Cursor pagination', url: 'https://github.com/acme/shop-api/pull/142',
      author: 'maya', headRef: 'feature/cursor-pagination', baseRef: 'main', phase: 'escalated', round: 2, maxRounds: 3,
      merged: false, closed: false, trusted: true, isDraft: false,
      viewer: { role: 'reviewer', attention: 'decision', failure: null },
      participants: [{ githubId: '1002', login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/1002', role: 'reviewer', isBot: false, onNitpilot: true, requested: true, agent: { online: false, offlineSince: '2026-10-16T18:04:00.000Z', working: false } }],
      activity: { kind: 'none', who: null, why: null, offlineSince: null },
      points: [{
        number: 1, raisedBy: { githubId: '1002', login: 'leo' }, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT',
        url: 'https://github.com/acme/shop-api/blob/abc1234/src/orders/list.ts#L48', severity: 'blocker', category: 'security',
        title: 'SQL built from input', body: 'Use a parameter.', snippet: { startLine: 43, lines: ['const q = `…`;'] },
        status: 'escalated', authorResolution: null, escalationReason: 'category', trusted: true, round: 1,
      }],
      rules: { maxRounds: 3, alwaysEscalate: ['security'], autoReview: true, autoAddress: true, error: null },
      summaryUrl: null, lastSeq: 7,
    };
    const body = { view, items: [], hasOlder: false };
    expect(ChatResponse.parse(JSON.parse(JSON.stringify(body)))).toEqual(body);
    expect(() => ChatResponse.parse({ ...body, view: { ...view, phase: 'waiting' } })).toThrow();
    const files = { files: [{ path: 'locales/tr.json', oldPath: null, status: 'added', adds: 412, dels: 0 }], adds: 412, dels: 0, truncated: false };
    expect(FilesResponse.parse(files)).toEqual(files);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w packages/protocol -- src/web-api.test.ts`
Expected: FAIL: `TypeError: Cannot read properties of undefined (reading 'parse')` (no `ChatResponse` yet).

- [ ] **Step 3: The chat's bodies, and `chat.state`**

In `packages/protocol/src/web-api.ts`, the enums import becomes `import { Attention, Category, EscalationReason, MessageKind, Phase, PointOrigin, PointStatus, Resolution, Role, Severity, Side } from './enums';`, add `import { Snippet } from './job-result';`, and add after `TimelineItem`:

```ts
/** `GET /api/chats/:id/messages?before=`: older items, oldest first. `hasOlder` says whether there are more before them. */
export const MessagesResponse = z.object({ items: z.array(TimelineItem), hasOlder: z.boolean() });
export type MessagesResponse = z.infer<typeof MessagesResponse>;

/**
 * What a chat is waiting on right now (spec §9.1 "Activity"), worked out when it's read: an agent at work, an
 * agent that can't start (`why`), a person's turn, or nothing. `who` is a GitHub login.
 */
export const ActivityView = z.object({
  kind: z.enum(['agent_working', 'agent_waiting', 'human_turn', 'none']),
  who: z.string().nullable(),
  why: z.enum(['offline', 'repo_not_linked', 'cap_reached']).nullable(),
  /** For an agent waiting offline: when its CLI was last seen (null if it never connected). */
  offlineSince: z.string().nullable(),
});
export type ActivityView = z.infer<typeof ActivityView>;

/** A person in the chat, and their agent: null for someone who isn't on Nitpilot (or a bot). */
export const ParticipantView = z.object({
  githubId: z.string(),
  login: z.string(),
  avatarUrl: z.string(),
  role: Role,
  isBot: z.boolean(),
  onNitpilot: z.boolean(),
  /** A reviewer the author asked for. */
  requested: z.boolean(),
  agent: z.object({ online: z.boolean(), offlineSince: z.string().nullable(), working: z.boolean() }).nullable(),
});
export type ParticipantView = z.infer<typeof ParticipantView>;

/** A review point (spec §8 `Point`), with who raised it and a link to its line on GitHub. */
export const PointView = z.object({
  number: z.number().int().positive(),
  raisedBy: z.object({ githubId: z.string(), login: z.string() }),
  origin: PointOrigin,
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  side: Side.nullable(),
  /** The file at that line on GitHub; null for a point about the whole PR. */
  url: z.string().nullable(),
  severity: Severity,
  category: Category,
  title: z.string(),
  body: z.string(),
  snippet: Snippet.nullable(),
  status: PointStatus,
  authorResolution: Resolution.nullable(),
  escalationReason: EscalationReason.nullable(),
  trusted: z.boolean(),
  round: z.number().int().positive(),
});
export type PointView = z.infer<typeof PointView>;

/**
 * A chat as the person reading it sees it (spec §10, handoff §2): the PR, the people and their agents, the
 * points, the team rules, and the reader's own place in it (`viewer`). `/ws/web` sends it again (`chat.state`)
 * whenever it changes. The timeline items travel separately: in `ChatResponse`, then in `chat.items`.
 */
export const ChatView = z.object({
  id: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  /** The PR on GitHub. */
  url: z.string(),
  /** The PR author's GitHub login. */
  author: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  phase: Phase,
  round: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  merged: z.boolean(),
  closed: z.boolean(),
  /** False for a PR from an outside contributor: agents don't start on it by themselves (spec §6.1). */
  trusted: z.boolean(),
  isDraft: z.boolean(),
  viewer: z.object({
    /** Your role here, or null if you only read along. An author who also reviews is the author. */
    role: Role.nullable(),
    attention: Attention,
    /** Why you're flagged `failed`: your agent's job failed (Retry), or a GitHub post in your name did (Reconnect). */
    failure: z.enum(['agent', 'github_post']).nullable(),
  }),
  participants: z.array(ParticipantView),
  activity: ActivityView,
  points: z.array(PointView),
  rules: z.object({
    maxRounds: z.number().int().positive(),
    alwaysEscalate: z.array(Category),
    autoReview: z.boolean(),
    autoAddress: z.boolean(),
    /** Why `.nitpilot.yml` couldn't be used, so the defaults apply; null when it's fine or missing. */
    error: z.string().nullable(),
  }),
  /** Nitpilot's summary comment on GitHub, once it's posted. */
  summaryUrl: z.string().nullable(),
  /** The newest timeline item's seq (0 for none). */
  lastSeq: z.number().int().nonnegative(),
});
export type ChatView = z.infer<typeof ChatView>;

/** `GET /api/chats/:owner/:repo/:number`: the chat, and its newest 200 timeline items, oldest first. */
export const ChatResponse = z.object({ view: ChatView, items: z.array(TimelineItem), hasOlder: z.boolean() });
export type ChatResponse = z.infer<typeof ChatResponse>;

/** One changed file of the PR (spec §10 `GET /api/chats/:id/files`). */
export const PrFile = z.object({
  path: z.string(),
  /** Its old path, for a renamed file. */
  oldPath: z.string().nullable(),
  status: z.enum(['added', 'modified', 'removed', 'renamed']),
  adds: z.number().int().nonnegative(),
  dels: z.number().int().nonnegative(),
});
export type PrFile = z.infer<typeof PrFile>;

/** The PR's changed files, at most 300; `truncated` when it has more. `adds` and `dels` add up the files listed. */
export const FilesResponse = z.object({ files: z.array(PrFile), adds: z.number().int(), dels: z.number().int(), truncated: z.boolean() });
export type FilesResponse = z.infer<typeof FilesResponse>;
```

The view carries no items: they come once in `ChatResponse`, then only the new ones in `chat.items`. In `packages/protocol/src/web-messages.ts`, import `ChatView` beside `InboxRow`, add after `ChatItems`:

```ts
/** The chat changed: its view as you see it now (points, phase, people, presence). Items come in chat.items. */
export const ChatState = message('chat.state', z.object({ chatId: z.string(), view: ChatView }));
```

and add `ChatState` to `ServerToWeb`'s list, after `ChatItems`.

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -w packages/protocol`
Expected: PASS, 49 tests.

- [ ] **Step 5: Write the failing tests for GitHub's timeout, the file list and the cache**

**M4:** a GitHub call that never answers must not hold a request forever. In `apps/server/src/platform/github/client.test.ts`, add at the end:

```ts
describe('a GitHub call that never answers', () => {
  it('gives up after the timeout, as a 504 the callers already treat as GitHub being down', async () => {
    // A fetch that never answers, but stops when it's told to, as the real one does.
    const hang = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    const github = new GithubClient(hang, 'https://api.github.com', 'https://github.com', 50);
    const err = await github.api('GET', '/repos/octo/sandbox').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err).toMatchObject({ status: 504, message: "GitHub didn't answer GET /repos/octo/sandbox in 0.05 s" });
    await expect(github.oauth('/login/oauth/access_token', {})).rejects.toMatchObject({ status: 504 });
  });
});
```

In `apps/server/src/platform/github/reads.test.ts`, add at the end:

```ts
describe('listPrFiles', () => {
  const file = (i: number) => ({ filename: `src/f${i}.ts`, status: 'modified', additions: 2, deletions: 1 });

  it('reads the changed files page by page, renamed ones with their old path', async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => file(i)), [{ filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed', additions: 0, deletions: 0 }, { filename: 'b.txt', status: 'copied', additions: 3, deletions: 0 }]];
    const { platform, fetch } = reads({ 'GET /repos/octo/sandbox/pulls/42/files': (req) => pages[Number(req.url.searchParams.get('page')) - 1] ?? [] });
    const { files, truncated } = await platform.listPrFiles(ref);
    expect(files).toHaveLength(102);
    expect(files.slice(100)).toEqual([
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', adds: 0, dels: 0 },
      { path: 'b.txt', oldPath: null, status: 'added', adds: 3, dels: 0 },
    ]);
    expect(truncated).toBe(false);
    expect(fetch.calls.filter((c) => c.url.pathname.endsWith('/files')).map((c) => c.headers.get('authorization'))).toEqual(['Bearer ghs_x', 'Bearer ghs_x']);
  });

  it('stops at 300 files and says the list was cut', async () => {
    const { platform } = reads({ 'GET /repos/octo/sandbox/pulls/42/files': () => Array.from({ length: 100 }, (_, i) => file(i)) });
    const { files, truncated } = await platform.listPrFiles(ref);
    expect(files).toHaveLength(300);
    expect(truncated).toBe(true);
  });
});
```

In `apps/server/src/platform/fake/fake-platform.test.ts`, add as the last test:

```ts
  it("lists a PR's changed files it was given, and records each time it's asked", async () => {
    const fake = new FakePlatform();
    const file = { path: 'src/a.ts', oldPath: null, status: 'modified' as const, adds: 1, dels: 0 };
    fake.prFiles.set('octo/sandbox#42', [file]);
    expect(await fake.listPrFiles(ref)).toEqual({ files: [file], truncated: false });
    expect(await fake.listPrFiles({ ...ref, number: 43 })).toEqual({ files: [], truncated: false });
    expect(fake.fileLists).toEqual(['octo/sandbox#42', 'octo/sandbox#43']);
  });
```

`RepoAccess`'s bounded, expiring map is needed again for the file lists, so it becomes its own class. Create `apps/server/src/lib/ttl-cache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('keeps a value for its time to live, then forgets it', () => {
    let now = 0;
    const cache = new TtlCache<string>(1_000, 10, () => now);
    cache.set('a', 'one');
    now = 999;
    expect(cache.get('a')).toBe('one');
    now = 1_000;
    expect(cache.get('a')).toBeUndefined();
  });

  it('drops the oldest entry once full, and setting a key again makes it the newest', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([3, undefined, 4]);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/platform src/lib/ttl-cache.test.ts`
Expected: FAIL: the timeout test times out (the fake fetch never answers), `listPrFiles is not a function` (3), and `./ttl-cache` doesn't exist.

- [ ] **Step 7: A timeout on every GitHub call, the file list, and the cache**

Replace `apps/server/src/platform/github/client.ts` with (an abort becomes a `GithubError` with status 504, so every caller that already treats a 5xx as "GitHub is down" handles a timeout too):

```ts
import { BRAND } from '@nitpilot/protocol';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GithubError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
    /** How long GitHub asked us to wait before trying again (rate limits), if it said. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

/**
 * How long a rate-limited response asks us to wait: `retry-after` (seconds) for a secondary rate
 * limit, or until `x-ratelimit-reset` (a Unix time) once the hourly allowance is used up.
 */
export function retryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-remaining') === '0' && reset > 0) return Math.max(reset * 1000 - now, 0);
  return undefined;
}

/** How long one GitHub call may take before we give up on it: a request waiting on GitHub never waits forever. */
export const GITHUB_TIMEOUT_MS = 15_000;

export type GithubRequest = {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  accept?: string;
  /** Return the response body as text, without JSON.parse (e.g. to keep 64-bit ids exact). */
  raw?: boolean;
};
export type GithubResponse<T> = { status: number; data: T; headers: Headers };

/**
 * A small typed wrapper around fetch for GitHub. Tests pass a fake fetch (test/fake-fetch.ts).
 * Statuses below 400 (including 304 Not Modified) are returned; 400+ throw GithubError. A call that gets no
 * answer within `timeoutMs` is a GithubError with status 504, like any other GitHub outage.
 */
export class GithubClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    readonly apiBase = 'https://api.github.com',
    readonly webBase = 'https://github.com',
    private readonly timeoutMs = GITHUB_TIMEOUT_MS,
  ) {}

  async api<T = unknown>(method: string, path: string, opts: GithubRequest = {}): Promise<GithubResponse<T>> {
    const headers: Record<string, string> = {
      accept: opts.accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': BRAND.userAgent,
      ...opts.headers,
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const { res, data } = await this.timed(`${method} ${path}`, async (signal) => {
      const res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal,
      });
      return { res, data: opts.raw ? await res.text() : await readBody(res) };
    });
    if (res.status >= 400) throw new GithubError(res.status, data, `GitHub ${method} ${path} failed with ${res.status}`, retryAfterMs(res.headers));
    return { status: res.status, data: data as T, headers: res.headers };
  }

  /** POST to github.com/login/oauth/*. GitHub reports OAuth errors as 200 + `{ error }`. */
  async oauth<T>(path: string, params: Record<string, string>): Promise<T> {
    const { res, data } = await this.timed(`OAuth ${path}`, async (signal) => {
      const res = await this.fetchImpl(`${this.webBase}${path}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': BRAND.userAgent },
        body: JSON.stringify(params),
        signal,
      });
      return { res, data: (await readBody(res)) as (T & { error?: string }) | null };
    });
    if (res.status >= 400 || !data || data.error) {
      throw new GithubError(res.status, data, `GitHub OAuth ${path} failed: ${data?.error ?? res.status}`);
    }
    return data;
  }

  /** Run one call (the request and reading its answer), giving up after `timeoutMs`. */
  private async timed<T>(what: string, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await call(AbortSignal.timeout(this.timeoutMs));
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new GithubError(504, null, `GitHub didn't answer ${what} in ${this.timeoutMs / 1000} s`);
      }
      throw err;
    }
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  if ((res.headers.get('content-type') ?? '').includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
```

In `apps/server/src/platform/types.ts`, import `type PrFile` from `@nitpilot/protocol`, add to `PlatformReads` after `findOpenPrsFor`:

```ts
  /** The PR's changed files, at most `MAX_PR_FILES`; `truncated` when there may be more. */
  listPrFiles(pr: PrRef): Promise<{ files: PrFile[]; truncated: boolean }>;
```

and after the interface:

```ts
/** How many changed files a PR's file list shows: three pages of 100. */
export const MAX_PR_FILES = 300;
```

In `apps/server/src/platform/github/payloads.ts`, add at the end:

```ts
/** One changed file of a PR, as `GET /repos/{o}/{r}/pulls/{n}/files` describes it. */
export type GhPrFile = {
  filename: string;
  previous_filename?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
};
```

In `apps/server/src/platform/github/reads.ts`, the imports become `import type { PrFile } from '@nitpilot/protocol';`, `import { MAX_PR_FILES, type FoundPr, type GitSpec, type GitSpecInput, type NormalizedEvent, type PlatformReads, type PrRef, type PrSnapshot, type RepoRef } from '../types';` and `import type { GhPrFile, GhPull, GhReviewComment } from './payloads';`. Add as the class's last method:

```ts
  /** Page by page, 100 at a time, with the installation token, up to MAX_PR_FILES. */
  async listPrFiles(ref: PrRef): Promise<{ files: PrFile[]; truncated: boolean }> {
    const token = await this.appAuth.installationToken(ref.installationId);
    const files: PrFile[] = [];
    for (let page = 1; files.length < MAX_PR_FILES; page++) {
      const { data } = await this.github.api<GhPrFile[]>('GET', `/repos/${ref.repoFullName}/pulls/${ref.number}/files?per_page=100&page=${page}`, { token });
      files.push(...data.map(toPrFile));
      if (data.length < 100) return { files, truncated: false };
    }
    return { files, truncated: true };
  }
```

and after the class:

```ts
/** GitHub's file statuses, as the four the web app shows: a copy is new, a mode change is a change. */
function toPrFile(f: GhPrFile): PrFile {
  const status = f.status === 'copied' ? 'added' : f.status === 'changed' || f.status === 'unchanged' ? 'modified' : f.status;
  return { path: f.filename, oldPath: f.status === 'renamed' ? (f.previous_filename ?? null) : null, status, adds: f.additions, dels: f.deletions };
}
```

In `apps/server/src/platform/fake/fake-platform.ts`, import `type PrFile` from `@nitpilot/protocol`, add two fields after `searches`:

```ts
  /** `${repoFullName}#${number}` → that PR's changed files */
  readonly prFiles = new Map<string, PrFile[]>();
  /** Which PRs' files were listed, in order. */
  readonly fileLists: string[] = [];
```

and after `findOpenPrsFor`:

```ts
  async listPrFiles(pr: PrRef): Promise<{ files: PrFile[]; truncated: boolean }> {
    this.fileLists.push(prKey(pr));
    return { files: this.prFiles.get(prKey(pr)) ?? [], truncated: false };
  }
```

Create `apps/server/src/lib/ttl-cache.ts`:

```ts
/**
 * A Map whose entries expire, and which never holds more than `maxEntries`: past that, the oldest entry goes.
 * For answers worth keeping a few minutes (who can read a repo, a PR's changed files), when the keys come from
 * requests and so must not grow without bound.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The value, if it was set less than `ttlMs` ago. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    return entry && this.now() - entry.at < this.ttlMs ? entry.value : undefined;
  }

  /** A Map remembers the order keys were added in: deleting first moves a repeated key to the end, so the first key is always the oldest. */
  set(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, at: this.now() });
  }
}
```

Replace `apps/server/src/auth/repo-access.ts` with (the same answers, now kept in a `TtlCache`):

```ts
import { TtlCache } from '../lib/ttl-cache';
import { GithubError, type GithubClient } from '../platform/github/client';
import { getUserToken, NeedsReauthError } from './user-tokens';

/** How long an answer is kept: someone removed from a repo can still see its chats for this long. */
export const ACCESS_TTL_MS = 5 * 60_000;

/** The most answers kept at once. The repo name comes from the URL, so a viewer could otherwise fill the map with made-up names. */
export const MAX_ANSWERS = 1_000;

/** read: GitHub shows them the repo. none: it doesn't. reauth: their GitHub sign-in has to be renewed first. */
export type RepoAccessResult = 'read' | 'none' | 'reauth';

/**
 * Who can see a chat: anyone who can read the repo on GitHub, asked with their own token (spec §16).
 * Answers are kept for 5 minutes per person and repo, so reading a chat doesn't call GitHub every time.
 */
export class RepoAccess {
  private readonly answers: TtlCache<'read' | 'none'>;

  constructor(
    private readonly github: GithubClient,
    now: () => number = () => Date.now(),
    maxAnswers: number = MAX_ANSWERS,
  ) {
    // The repo name comes from the URL, so the cache is bounded: a viewer can't grow it with made-up names.
    this.answers = new TtlCache(ACCESS_TTL_MS, maxAnswers, now);
  }

  async check(userId: string, repoFullName: string): Promise<RepoAccessResult> {
    const key = `${userId} ${repoFullName}`;
    const kept = this.answers.get(key);
    if (kept) return kept;

    let token: string;
    try {
      token = await getUserToken(userId, this.github);
    } catch (err) {
      if (err instanceof NeedsReauthError) return 'reauth';
      throw err;
    }
    let result: 'read' | 'none';
    try {
      await this.github.api('GET', `/repos/${repoFullName}`, { token });
      result = 'read';
    } catch (err) {
      // 401: GitHub no longer takes the token (revoked there, say). Only signing in again helps.
      if (err instanceof GithubError && err.status === 401) return 'reauth';
      // A 403 that says when to retry is GitHub's rate limit, not a no: pass it on, and don't remember it.
      if (err instanceof GithubError && err.status === 403 && err.retryAfterMs !== undefined) throw err;
      // GitHub hides a private repo you can't read behind a 404; a plain 403 is a no too.
      if (err instanceof GithubError && (err.status === 404 || err.status === 403)) result = 'none';
      else throw err;
    }
    this.answers.set(key, result);
    return result;
  }
}
```

- [ ] **Step 8: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/platform src/lib/ttl-cache.test.ts && npm run test:db -w apps/server -- src/auth/repo-access.db.test.ts`
Expected: PASS: client 4, reads 15, fake platform 5, ttl-cache 2; `RepoAccess`'s 5 tests unchanged.

- [ ] **Step 9: One token refresh at a time (M5)**

Plan 1 already shared one in-flight refresh per user, but a call that read the row just before another call's refresh finished could still start a second refresh with the spent refresh token, which signs the person out (refresh tokens are single-use). Now a refresh runs under a per-user lock, and whoever gets the lock reads the row again first. Replace `apps/server/src/auth/user-tokens.ts` with:

```ts
import type { GithubAuth } from '../generated/prisma/client';
import { decrypt, encrypt } from '../lib/crypto';
import { getEnv } from '../lib/env';
import { KeyedLock } from '../lib/key-lock';
import { prisma } from '../lib/prisma';
import { GithubError, type GithubClient } from '../platform/github/client';
import { refreshTokens, type OAuthTokens } from './github-oauth';

/** The user must sign in with GitHub again before Nitpilot can act as them. */
export class NeedsReauthError extends Error {
  constructor(readonly userId: string) {
    super(`GitHub sign-in expired for user ${userId}`);
    this.name = 'NeedsReauthError';
  }
}

/** Refresh a little early, so a token never expires halfway through a write. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * One refresh per user at a time: refresh tokens are single-use (spec §8 `GithubAuth`), and a second refresh
 * with a spent one would sign the person out. Whoever waits re-reads the row once it's their turn, so they find
 * the token the first refresh saved instead of refreshing again.
 */
const refreshes = new KeyedLock();

export async function getUserToken(userId: string, github: GithubClient, now = new Date()): Promise<string> {
  const auth = await readAuth(userId);
  if (isFresh(auth, now)) return decrypt(auth.accessTokenEnc);
  return refreshes.run(userId, async () => {
    const latest = await readAuth(userId);
    if (isFresh(latest, now)) return decrypt(latest.accessTokenEnc);
    return refreshOnce(latest, github, now);
  });
}

async function readAuth(userId: string): Promise<GithubAuth> {
  const auth = await prisma.githubAuth.findUnique({ where: { userId } });
  if (!auth || auth.status !== 'ok') throw new NeedsReauthError(userId);
  return auth;
}

/** Good for more than 5 minutes. */
function isFresh(auth: GithubAuth, now: Date): boolean {
  return auth.accessExpiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS;
}

async function refreshOnce(auth: GithubAuth, github: GithubClient, now: Date): Promise<string> {
  if (auth.refreshExpiresAt <= now) {
    await markNeedsReauth(auth.id);
    throw new NeedsReauthError(auth.userId);
  }

  const env = getEnv();
  let tokens: OAuthTokens;
  try {
    tokens = await refreshTokens(github, { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, refreshToken: decrypt(auth.refreshTokenEnc) }, now);
  } catch (err) {
    // GitHub answered and said no (e.g. bad_refresh_token): only a new sign-in fixes that.
    if (err instanceof GithubError && err.status < 500) {
      await markNeedsReauth(auth.id);
      throw new NeedsReauthError(auth.userId);
    }
    throw err; // network trouble or a GitHub outage: try again later
  }

  // Save only if nobody refreshed meanwhile (compare-and-swap on `version`).
  const { count } = await prisma.githubAuth.updateMany({
    where: { id: auth.id, version: auth.version },
    data: {
      accessTokenEnc: encrypt(tokens.accessToken),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshTokenEnc: encrypt(tokens.refreshToken),
      refreshExpiresAt: tokens.refreshExpiresAt,
      version: { increment: 1 },
    },
  });
  if (count === 0) {
    const fresh = await prisma.githubAuth.findUniqueOrThrow({ where: { id: auth.id } });
    return decrypt(fresh.accessTokenEnc);
  }
  return tokens.accessToken;
}

async function markNeedsReauth(id: string): Promise<void> {
  await prisma.githubAuth.update({ where: { id }, data: { status: 'needs_reauth' } });
}
```

No new test: the gap is a race between a database read and another request's commit, which no test can make happen on demand; the existing tests pin the behaviour around it.

Run: `npm run test:db -w apps/server -- src/auth/user-tokens.db.test.ts`
Expected: PASS, 6 tests (unchanged, including "runs only one refresh when several writes need the token at once").

- [ ] **Step 10: Write the failing tests for the view and the routes**

Create `apps/server/src/chats/views.db.test.ts`:

```ts
import { ChatView } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeMessage, makeParticipant, makeRepo, makeUser } from '../../test/db';
import { prisma } from '../lib/prisma';
import type { LiveClis } from './activity';
import { loadChatPage, loadChatView } from './views';

/** maya's PR, reviewed by leo, with an agent point escalated and a GitHub point answered. maya's CLI is connected. */
async function scene() {
  const repo = await makeRepo({ rulesJson: { max_rounds: 4, always_escalate: ['security', 'bug'] } });
  await prisma.repo.update({ where: { id: repo.id }, data: { rulesError: 'line 3: unknown key max_round' } });
  const [maya, leo] = [await makeUser({ login: 'maya' }), await makeUser({ login: 'leo' })];
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId, headSha: 'c'.repeat(40) });
  await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'escalated', round: 2, summaryCommentId: '555' } });
  await makeParticipant(chat.id, maya, 'author');
  const leoP = await makeParticipant(chat.id, leo, 'reviewer', { requested: true, attention: 'decision' });
  const lastSeen = new Date('2026-10-16T18:04:00Z');
  const leoToken = await makeCliToken(leo.id);
  await prisma.cliToken.update({ where: { id: leoToken.id }, data: { lastSeenAt: lastSeen } });
  await makeCliToken(maya.id);
  const point = { chatId: chat.id, raisedByGithubId: leo.githubId, severity: 'blocker', category: 'security', body: 'Use a parameter.', trusted: true, round: 1 };
  await prisma.point.createMany({
    data: [
      { ...point, number: 1, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT', commitSha: 'a'.repeat(40), title: 'SQL built from input', status: 'escalated', escalationReason: 'category', snippet: { startLine: 43, lines: ['const q = 1;'] } },
      { ...point, number: 2, origin: 'github', path: 'src/old name.ts', line: 7, side: 'LEFT', commitSha: null, severity: 'minor', category: 'style', title: 'Naming', status: 'addressed', authorResolution: 'fixed', githubCommentId: '900' },
      { ...point, number: 3, origin: 'agent', path: null, line: null, side: null, title: 'Add a test', status: 'open' },
    ],
  });
  const clis: LiveClis = { connectionsFor: (userId) => (userId === maya.id ? [{ repos: new Set([repo.fullName]) }] : []) };
  return { repo, chat, maya, leo, leoP, lastSeen, clis };
}

describe('loadChatView (spec §10, handoff §2)', () => {
  it('shows the PR, the rules and the points, with links to their lines on GitHub', async () => {
    const { repo, chat, leo, clis } = await scene();
    const view = ChatView.parse(await loadChatView(chat.id, leo, clis));
    expect(view).toMatchObject({
      id: chat.id, repo: repo.fullName, number: chat.number, author: 'maya', headRef: chat.headRef, baseRef: 'main',
      phase: 'escalated', round: 2, maxRounds: 4, merged: false, closed: false, trusted: true,
      rules: { maxRounds: 4, alwaysEscalate: ['security', 'bug'], autoReview: true, autoAddress: true, error: 'line 3: unknown key max_round' },
      summaryUrl: `${chat.url}#issuecomment-555`,
    });
    const repoUrl = `https://github.com/${repo.fullName}`;
    expect(view.points.map((p) => [p.number, p.raisedBy.login, p.url])).toEqual([
      [1, 'leo', `${repoUrl}/blob/${'a'.repeat(40)}/src/orders/list.ts#L48`],
      // A comment on the old side of the diff links to the base commit; the space in the path is encoded.
      [2, 'leo', `${repoUrl}/blob/${'b'.repeat(40)}/src/old%20name.ts#L7`],
      [3, 'leo', null],
    ]);
    expect(view.points[0]).toMatchObject({ severity: 'blocker', status: 'escalated', escalationReason: 'category', snippet: { startLine: 43 } });
  });

  it("is the viewer's own: your role and why you're needed, or a reader's nothing", async () => {
    const { chat, leo, maya, clis } = await scene();
    expect((await loadChatView(chat.id, leo, clis)).viewer).toEqual({ role: 'reviewer', attention: 'decision', failure: null });
    expect((await loadChatView(chat.id, maya, clis)).viewer).toEqual({ role: 'author', attention: 'none', failure: null });
    expect((await loadChatView(chat.id, await makeUser(), clis)).viewer).toEqual({ role: null, attention: 'none', failure: null });
  });

  it("shows each person's agent: online, offline since it was last seen, and working while its job runs", async () => {
    const { chat, leo, leoP, lastSeen, clis } = await scene();
    await prisma.job.create({ data: { chatId: chat.id, participantId: leoP.id, userId: leo.id, type: 're_review', status: 'running', round: 2, headSha: chat.headSha, runAfter: new Date() } });
    const { participants, activity } = await loadChatView(chat.id, leo, clis);
    expect(participants.map((p) => [p.login, p.role, p.requested, p.agent])).toEqual([
      ['maya', 'author', false, { online: true, offlineSince: null, working: false }],
      ['leo', 'reviewer', true, { online: false, offlineSince: lastSeen.toISOString(), working: true }],
    ]);
    expect(participants[0]!.avatarUrl).toMatch(/^https:\/\/avatars\.githubusercontent\.com\/u\//);
    // leo's CLI is offline and his job runs: the job was bound to a CLI that went away, which the leases will notice.
    expect(activity).toEqual({ kind: 'agent_working', who: 'leo', why: null, offlineSince: null });
  });

  it("says when an agent waits, and gives no agent to someone who isn't on Nitpilot", async () => {
    const { chat, leo, leoP, lastSeen, clis } = await scene();
    await prisma.job.create({ data: { chatId: chat.id, participantId: leoP.id, activeFor: leoP.id, userId: leo.id, type: 're_review', status: 'queued', round: 2, headSha: chat.headSha, runAfter: new Date() } });
    const outsider = { githubId: '424242', login: 'sam' };
    await makeParticipant(chat.id, outsider, 'reviewer');
    const view = await loadChatView(chat.id, leo, clis);
    expect(view.activity).toEqual({ kind: 'agent_waiting', who: 'leo', why: 'offline', offlineSince: lastSeen.toISOString() });
    expect(view.participants.find((p) => p.login === 'sam')).toMatchObject({ onNitpilot: false, agent: null, avatarUrl: 'https://avatars.githubusercontent.com/u/424242' });
  });
});

describe('loadChatPage', () => {
  it('gives the newest 200 items, oldest first, and says there are older ones', async () => {
    const { chat, leo, clis } = await scene();
    await prisma.message.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ chatId: chat.id, seq: i + 1, kind: 'system', body: `item ${i + 1}` })) });
    await prisma.prChat.update({ where: { id: chat.id }, data: { lastSeq: 250 } });
    const page = await loadChatPage(chat.id, leo, clis);
    expect(page.items.map((i) => i.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 51));
    expect(page.hasOlder).toBe(true);
    expect(page.view.lastSeq).toBe(250);
  });

  it('has nothing older when the whole timeline fits', async () => {
    const { chat, leo, clis } = await scene();
    await makeMessage(chat.id, null, 'Pull request opened by maya');
    expect(await loadChatPage(chat.id, leo, clis)).toMatchObject({ items: [{ seq: 1 }], hasOlder: false });
  });
});
```

Create `apps/server/src/http/routes/chats.db.test.ts` (Review Focus 2: a reader whose GitHub sign-in expired gets a 401 that says so):

```ts
import { ChatResponse, FilesResponse, MessagesResponse } from '@nitpilot/protocol';
import { describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeGithubSignIn, makeParticipant, makeRepo, makeUser } from '../../../test/db';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { prisma } from '../../lib/prisma';
import { FakePlatform } from '../../platform/fake/fake-platform';
import { GithubClient } from '../../platform/github/client';

/**
 * maya's chat in a repo, a reader signed in with GitHub, and what GitHub says about the reader and the repo:
 * 200 (can read), 404 (can't), or 500 (GitHub is down).
 */
async function scene(opts: { github?: 200 | 404 | 500; signIn?: 'ok' | 'needs_reauth' } = {}) {
  const repo = await makeRepo();
  const maya = await makeUser({ login: 'maya' });
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  const reader = await makeUser();
  await makeGithubSignIn(reader.id, opts.signIn ?? 'ok');
  const status = opts.github ?? 200;
  const fetch = fakeFetch({ [`GET /repos/${repo.fullName}`]: () => (status === 200 ? { id: 1 } : json({ message: 'no' }, status)) });
  const platform = new FakePlatform();
  const app = testApp({ github: new GithubClient(fetch), platform });
  const cookie = await sessionCookieFor(reader.id);
  const get = (path: string) => app.request(path, { headers: { cookie } });
  return { repo, chat, reader, fetch, platform, app, get, path: `/api/chats/${repo.fullName}/${chat.number}` };
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe('GET /api/chats/:owner/:repo/:number', () => {
  it('answers the chat as the reader sees it, with its newest items', async () => {
    const { chat, get, path } = await scene();
    await prisma.message.create({ data: { chatId: chat.id, seq: 1, kind: 'system', body: 'Pull request opened by maya' } });
    await prisma.prChat.update({ where: { id: chat.id }, data: { lastSeq: 1 } });
    const res = await get(path);
    expect(res.status).toBe(200);
    const body = ChatResponse.parse(await res.json());
    expect(body.view).toMatchObject({ id: chat.id, author: 'maya', viewer: { role: null } });
    expect(body.items.map((i) => i.body)).toEqual(['Pull request opened by maya']);
  });

  it("is the same 404 for a chat that doesn't exist and one whose repo you can't see", async () => {
    const hidden = await scene({ github: 404 });
    const missing = await scene();
    const a = await hidden.get(hidden.path);
    const b = await missing.get(`/api/chats/${missing.repo.fullName}/9999`);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(await errorOf(a)).toEqual(await errorOf(b));
  });

  it('is a 401 that says so when your GitHub sign-in expired (Review Focus 2)', async () => {
    const { get, path } = await scene({ signIn: 'needs_reauth' });
    const res = await get(path);
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toEqual({ code: 'reauth', message: 'Sign in with GitHub again to see this chat.' });
  });

  it("is a 404 without asking GitHub when the owner or repo isn't a GitHub name", async () => {
    const { get, fetch, chat } = await scene();
    expect((await get(`/api/chats/a%20b/repo/${chat.number}`)).status).toBe(404);
    expect((await get('/api/chats/octo/repo/not-a-number')).status).toBe(404);
    expect(fetch.calls).toEqual([]);
  });

  it("is a 502 that says so when GitHub doesn't answer", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { get, path } = await scene({ github: 500 });
    const res = await get(path);
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('github_unavailable');
    vi.restoreAllMocks();
  });

  it('is a 401 without a session', async () => {
    const { app, path } = await scene();
    expect((await app.request(path)).status).toBe(401);
  });
});

describe('GET /api/chats/:id/messages?before=', () => {
  it('pages backwards, 200 at a time', async () => {
    const { chat, get } = await scene();
    await prisma.message.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ chatId: chat.id, seq: i + 1, kind: 'system', body: `item ${i + 1}` })) });
    const first = MessagesResponse.parse(await (await get(`/api/chats/${chat.id}/messages`)).json());
    expect([first.items[0]!.seq, first.items.at(-1)!.seq, first.hasOlder]).toEqual([51, 250, true]);
    const older = MessagesResponse.parse(await (await get(`/api/chats/${chat.id}/messages?before=51`)).json());
    expect([older.items.length, older.items[0]!.seq, older.hasOlder]).toEqual([50, 1, false]);
    expect((await get(`/api/chats/${chat.id}/messages?before=zero`)).status).toBe(400);
  });

  it("is a 404 for a chat you can't see", async () => {
    const { chat, get } = await scene({ github: 404 });
    expect((await get(`/api/chats/${chat.id}/messages`)).status).toBe(404);
  });
});

describe('GET /api/chats/:id/files', () => {
  it('lists the changed files with their totals, asking GitHub once per head commit', async () => {
    const { repo, chat, get, platform } = await scene();
    platform.prFiles.set(`${repo.fullName}#${chat.number}`, [
      { path: 'locales/tr.json', oldPath: null, status: 'added', adds: 412, dels: 0 },
      { path: 'src/i18n.ts', oldPath: null, status: 'modified', adds: 3, dels: 1 },
    ]);
    const body = FilesResponse.parse(await (await get(`/api/chats/${chat.id}/files`)).json());
    expect(body).toMatchObject({ adds: 415, dels: 1, truncated: false });
    expect(body.files.map((f) => f.path)).toEqual(['locales/tr.json', 'src/i18n.ts']);
    await get(`/api/chats/${chat.id}/files`);
    expect(platform.fileLists).toHaveLength(1);
    // A push: a new head, a new list.
    await prisma.prChat.update({ where: { id: chat.id }, data: { headSha: 'd'.repeat(40) } });
    await get(`/api/chats/${chat.id}/files`);
    expect(platform.fileLists).toHaveLength(2);
  });

  it("is a 404 for a chat you can't see, without asking for its files", async () => {
    const { chat, get, platform } = await scene({ github: 404 });
    expect((await get(`/api/chats/${chat.id}/files`)).status).toBe(404);
    expect(platform.fileLists).toEqual([]);
  });
});
```

- [ ] **Step 11: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/chats/views.db.test.ts src/http/routes/chats.db.test.ts`
Expected: FAIL: `./views` doesn't exist, and every chat route answers the app's JSON 404 (there are none yet), so only its tests that expect a 404 pass.

- [ ] **Step 12: The view, the routes, and a 401 that says "reauth"**

A web app can't tell "sign in again with GitHub" from "you're signed out" by status alone, so it gets its own code. In `apps/server/src/http/errors.ts`, add to `ErrorCode` after `'unauthorized'`:

```ts
  /** Signed in to Nitpilot, but the GitHub sign-in expired: only signing in again helps (spec §16). */
  | 'reauth'
```

and `reauth: 401,` after `unauthorized: 401,` in `STATUS`. The inbox's expired sign-in uses it too: in `apps/server/src/http/routes/inbox.ts`, `throw new HttpError('unauthorized', …)` becomes `throw new HttpError('reauth', …)` (same message), and in `inbox.db.test.ts` the 401 test's last line becomes `expect(await errorOf(res)).toMatchObject({ code: 'reauth', message: expect.stringMatching(/sign in again/i) });`.

Replace `apps/server/src/chats/access.ts` with (`chatAccessByPath` for the chat screen's address; the name check is the transcript route's):

```ts
import type { RepoAccess } from '../auth/repo-access';
import { prisma } from '../lib/prisma';

/** The chat you may read, with its repo; or why not. */
export type ChatAccess = { kind: 'read'; chat: { id: string; repoFullName: string } } | { kind: 'none' } | { kind: 'reauth' };

/** GitHub owner and repo names: letters, digits, `-`, `_` and `.`. They go into a GitHub API path, so nothing else is let through. */
export const isGithubName = (s: string) => /^[A-Za-z0-9_.-]+$/.test(s) && s !== '.' && s !== '..';

/**
 * Can this person read the chat (spec §16 "Who can see a chat")? Anyone whose GitHub account can read the repo,
 * asked with their own token and kept 5 minutes (auth/repo-access.ts). A chat that doesn't exist and one you
 * can't see are the same `none`, so nobody learns which chats exist (docs/why/chat-access-rules.md).
 * GitHub not answering is thrown, for the caller to say so.
 */
export async function chatAccess(user: { id: string }, chatId: string, access: RepoAccess): Promise<ChatAccess> {
  const chat = await prisma.prChat.findUnique({ where: { id: chatId }, select: { id: true, repo: { select: { fullName: true } } } });
  if (!chat) return { kind: 'none' };
  const answer = await access.check(user.id, chat.repo.fullName);
  return answer === 'read' ? { kind: 'read', chat: { id: chat.id, repoFullName: chat.repo.fullName } } : { kind: answer };
}

/**
 * The same, for the chat screen's address, `/c/:owner/:repo/:number`. GitHub is asked about the repo before the
 * chat is looked up, as the transcript page did: someone whose GitHub sign-in expired is asked to sign in again,
 * whether or not that chat exists.
 */
export async function chatAccessByPath(user: { id: string }, path: { owner: string; repo: string; number: string }, access: RepoAccess): Promise<ChatAccess> {
  const number = Number(path.number);
  if (!isGithubName(path.owner) || !isGithubName(path.repo) || !Number.isSafeInteger(number) || number <= 0) return { kind: 'none' };
  const fullName = `${path.owner}/${path.repo}`;
  const answer = await access.check(user.id, fullName);
  if (answer !== 'read') return { kind: answer };
  const chat = await prisma.prChat.findFirst({ where: { number, repo: { fullName } }, select: { id: true } });
  return chat ? { kind: 'read', chat: { id: chat.id, repoFullName: fullName } } : { kind: 'none' };
}
```

In `apps/server/src/chats/timeline.ts`, import `type MessagesResponse` beside `MessageKind`, and add at the end:

```ts
/**
 * The newest page of items before `beforeSeq` (or the newest of all, for null), oldest first: the chat screen's
 * first page, then "Load earlier". Seqs have no gaps, so there are older items exactly when the first isn't 1.
 */
export async function loadItemsBefore(chatId: string, beforeSeq: number | null): Promise<MessagesResponse> {
  const [newestFirst, threads] = await Promise.all([
    prisma.message.findMany({ where: { chatId, ...(beforeSeq === null ? {} : { seq: { lt: beforeSeq } }) }, orderBy: { seq: 'desc' }, take: ITEMS_PER_PAGE }),
    threadPointsOf(chatId),
  ]);
  const items = newestFirst.reverse().map((m) => toTimelineItem(m, threads));
  return { items, hasOlder: (items[0]?.seq ?? 1) > 1 };
}
```

In `apps/server/src/chats/inbox.ts`, export `githubAvatar` (`export function githubAvatar(githubId: string): string {`): the chat's people use the same fallback picture.

Create `apps/server/src/chats/views.ts`:

```ts
import type {
  ActivityView, Attention, Category, ChatResponse, ChatView, EscalationReason, ParticipantView, Phase, PointOrigin, PointStatus, PointView, Resolution, Role, Severity, Side, Snippet,
} from '@nitpilot/protocol';
import type { Point, PrChat } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { loadActivity, type Activity, type LiveClis } from './activity';
import { failureKind } from './failed-flags';
import { githubAvatar } from './inbox';
import { rulesFromJson } from './rules';
import { loadItemsBefore } from './timeline';

/** Who is looking: views differ per person (your role, your attention, your failure). */
export type ChatViewer = { githubId: string };

/**
 * One chat as `viewer` sees it (spec §10 `GET /api/chats/:owner/:repo/:number`, handoff §2): the PR, its people
 * and their agents right now, the points, the team rules. Read fresh each time, like the inbox: presence and
 * activity change without any event (docs/why/n-plus-one-queries.md keeps the number of queries fixed).
 */
export async function loadChatView(chatId: string, viewer: ChatViewer, clis: LiveClis, now = new Date()): Promise<ChatView> {
  const chat = await prisma.prChat.findUniqueOrThrow({
    where: { id: chatId },
    include: {
      repo: true,
      participants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      points: { orderBy: { number: 'asc' } },
      jobs: { where: { status: 'running' }, select: { participantId: true } },
    },
  });
  const users = await prisma.user.findMany({ where: { githubId: { in: chat.participants.map((p) => p.githubId) } }, select: { id: true, githubId: true, avatarUrl: true } });
  const userOf = new Map(users.map((u) => [u.githubId, u]));
  const [activity, failure, seen] = await Promise.all([
    loadActivity(chatId, clis, now),
    failureKind(chatId, viewer.githubId),
    users.length > 0 ? prisma.cliToken.groupBy({ by: ['userId'], where: { userId: { in: users.map((u) => u.id) } }, _max: { lastSeenAt: true } }) : [],
  ]);
  const lastSeen = (userId: string) => seen.find((s) => s.userId === userId)?._max.lastSeenAt ?? null;
  const loginOf = (githubId: string) => chat.participants.find((p) => p.githubId === githubId)?.login ?? githubId;
  const rules = rulesFromJson(chat.repo.rulesJson);
  const yours = chat.participants.filter((p) => p.githubId === viewer.githubId);

  const participants = chat.participants.map((p): ParticipantView => {
    const user = p.isBot ? undefined : userOf.get(p.githubId);
    const online = user ? clis.connectionsFor(user.id).length > 0 : false;
    return {
      githubId: p.githubId,
      login: p.login,
      avatarUrl: user?.avatarUrl ?? githubAvatar(p.githubId),
      role: p.role as Role,
      isBot: p.isBot,
      onNitpilot: user !== undefined,
      requested: p.requested,
      agent: user ? { online, offlineSince: online ? null : (lastSeen(user.id)?.toISOString() ?? null), working: chat.jobs.some((j) => j.participantId === p.id) } : null,
    };
  });

  return {
    id: chat.id,
    repo: chat.repo.fullName,
    number: chat.number,
    title: chat.title,
    url: chat.url,
    author: loginOf(chat.authorGithubId),
    headRef: chat.headRef,
    baseRef: chat.baseRef,
    phase: chat.phase as Phase,
    round: chat.round,
    maxRounds: rules.max_rounds,
    merged: chat.merged,
    closed: chat.closedAt !== null,
    trusted: chat.trusted,
    isDraft: chat.isDraft,
    viewer: {
      role: yours.some((p) => p.role === 'author') ? 'author' : yours.length > 0 ? 'reviewer' : null,
      attention: (yours.find((p) => p.attention !== 'none')?.attention ?? 'none') as Attention,
      failure,
    },
    participants,
    activity: activityView(activity),
    points: chat.points.map((p) => pointView(chat, p, loginOf(p.raisedByGithubId))),
    rules: { maxRounds: rules.max_rounds, alwaysEscalate: rules.always_escalate, autoReview: rules.auto.review, autoAddress: rules.auto.address, error: chat.repo.rulesError },
    summaryUrl: chat.summaryCommentId ? `${chat.url}#issuecomment-${chat.summaryCommentId}` : null,
    lastSeq: chat.lastSeq,
  };
}

/** What the chat screen loads first: the view, and the newest page of the timeline. */
export async function loadChatPage(chatId: string, viewer: ChatViewer, clis: LiveClis): Promise<ChatResponse> {
  const [view, page] = await Promise.all([loadChatView(chatId, viewer, clis), loadItemsBefore(chatId, null)]);
  return { view, ...page };
}

function activityView(a: Activity): ActivityView {
  switch (a.kind) {
    case 'agent_working':
      return { kind: a.kind, who: a.who, why: null, offlineSince: null };
    case 'agent_waiting':
      return { kind: a.kind, who: a.who, why: a.why, offlineSince: a.why === 'offline' ? (a.offlineSince?.toISOString() ?? null) : null };
    case 'human_turn':
      return { kind: a.kind, who: a.who, why: null, offlineSince: null };
    case 'none':
      return { kind: a.kind, who: null, why: null, offlineSince: null };
  }
}

function pointView(chat: PrChat, p: Point, raisedByLogin: string): PointView {
  return {
    number: p.number,
    raisedBy: { githubId: p.raisedByGithubId, login: raisedByLogin },
    origin: p.origin as PointOrigin,
    path: p.path,
    line: p.line,
    side: p.side as Side | null,
    url: fileUrl(chat, p),
    severity: p.severity as Severity,
    category: p.category as Category,
    title: p.title,
    body: p.body,
    snippet: p.snippet as Snippet | null,
    status: p.status as PointStatus,
    authorResolution: p.authorResolution as Resolution | null,
    escalationReason: p.escalationReason as EscalationReason | null,
    trusted: p.trusted,
    round: p.round,
  };
}

/**
 * The point's line on GitHub, in the commit it was raised on. A comment on the left side of a diff is about the
 * old code, so it links to the base commit.
 */
function fileUrl(chat: PrChat, p: Point): string | null {
  if (!p.path) return null;
  const repoUrl = chat.url.replace(/\/pull\/\d+$/, '');
  const sha = p.side === 'LEFT' ? chat.baseSha : (p.commitSha ?? chat.headSha);
  const path = p.path.split('/').map(encodeURIComponent).join('/');
  return `${repoUrl}/blob/${sha}/${path}${p.line ? `#L${p.line}` : ''}`;
}
```

Create `apps/server/src/http/routes/chats.ts`:

```ts
import type { ChatResponse, FilesResponse, MessagesResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { z } from 'zod';
import { RepoAccess } from '../../auth/repo-access';
import { requireUser, type UserVariables } from '../../auth/request-user';
import { chatAccess, chatAccessByPath, type ChatAccess } from '../../chats/access';
import type { LiveClis } from '../../chats/activity';
import { repoRef } from '../../chats/rules';
import { loadItemsBefore } from '../../chats/timeline';
import { loadChatPage } from '../../chats/views';
import { prisma } from '../../lib/prisma';
import { TtlCache } from '../../lib/ttl-cache';
import { GithubError, type GithubClient } from '../../platform/github/client';
import type { PlatformReads } from '../../platform/types';
import { HttpError } from '../errors';

/** A PR's file list is kept this long per head commit: a push makes a new list. */
export const FILES_TTL_MS = 10 * 60_000;
/** The most file lists kept at once. */
export const MAX_FILE_LISTS = 500;

const BeforeQuery = z.object({ before: z.coerce.number().int().positive().optional() });

/**
 * The chat screen's reads (spec §10 "REST endpoints in Plan 2"): the chat, older timeline items, and the PR's
 * changed files. Each one first asks whether you can read the chat (chats/access.ts, docs/why/chat-access-rules.md).
 */
export function chatRoutes(deps: { github: GithubClient; platform: PlatformReads; clis: LiveClis }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();
  const access = new RepoAccess(deps.github);
  const fileLists = new TtlCache<FilesResponse>(FILES_TTL_MS, MAX_FILE_LISTS);

  app.get('/api/chats/:owner/:repo/:number', requireUser, async (c) => {
    const user = c.get('user');
    const chat = readable(await askingGithub(() => chatAccessByPath(user, { owner: c.req.param('owner'), repo: c.req.param('repo'), number: c.req.param('number') }, access)));
    const body: ChatResponse = await loadChatPage(chat.id, user, deps.clis);
    return c.json(body);
  });

  app.get('/api/chats/:id/messages', requireUser, async (c) => {
    const { before } = BeforeQuery.parse(c.req.query());
    const chat = readable(await askingGithub(() => chatAccess(c.get('user'), c.req.param('id'), access)));
    const body: MessagesResponse = await loadItemsBefore(chat.id, before ?? null);
    return c.json(body);
  });

  app.get('/api/chats/:id/files', requireUser, async (c) => {
    const { id } = readable(await askingGithub(() => chatAccess(c.get('user'), c.req.param('id'), access)));
    const chat = await prisma.prChat.findUniqueOrThrow({ where: { id }, include: { repo: true } });
    const key = `${chat.id} ${chat.headSha}`;
    let body = fileLists.get(key);
    if (!body) {
      const { files, truncated } = await askingGithub(() => deps.platform.listPrFiles({ ...repoRef(chat.repo), number: chat.number }));
      body = { files, adds: files.reduce((n, f) => n + f.adds, 0), dels: files.reduce((n, f) => n + f.dels, 0), truncated };
      fileLists.set(key, body);
    }
    return c.json(body);
  });

  return app;
}

/** The chat you may read, or the answer for one you can't: the same 404 for "no such chat" and "not yours to see". */
function readable(access: ChatAccess): { id: string; repoFullName: string } {
  if (access.kind === 'reauth') throw new HttpError('reauth', 'Sign in with GitHub again to see this chat.');
  if (access.kind === 'none') throw new HttpError('not_found', 'No such chat.');
  return access.chat;
}

/** GitHub down, slow or rate limiting us is a 502 that says so, not a bare 500. */
async function askingGithub<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof GithubError)) throw err;
    console.error('[chats] GitHub did not answer:', err.message);
    throw new HttpError('github_unavailable', "GitHub didn't answer. Try again in a minute.");
  }
}
```

In `apps/server/src/http/app.ts`: `import type { PlatformReads } from '../platform/types';` and `import { chatRoutes } from './routes/chats';`; `AppDeps` gains

```ts
  /** GitHub reads with the app's installation token (the chat screen's file list). */
  platform: PlatformReads;
```

after `clis`; and `app.route('/', chatRoutes(deps));` goes after `app.route('/', inboxRoutes(deps));`.

In `apps/server/test/app.ts`, import `FakePlatform` from `'../src/platform/fake/fake-platform'` and add `platform: new FakePlatform(),` after `clis` in `testDeps`. In `apps/server/src/main.ts`, `createApp({ …, clis: hub })` becomes `createApp({ github, appAuth, ingest, dispatch: dispatcher.dispatch, clis: hub, platform })`. In `apps/server/test/e2e/harness.ts`, `testApp({ …, github: githubApi, … })` gains `platform,` after `github: githubApi,`.

- [ ] **Step 13: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/chats/views.db.test.ts src/http/routes/chats.db.test.ts src/http/routes/inbox.db.test.ts`
Expected: PASS, 6, 10 and 14 tests.

- [ ] **Step 14: The explainer, and the spec**

Create `docs/why/chat-access-rules.md`:

```markdown
# Who can see a chat

**In one sentence:** anyone signed in to Nitpilot whose GitHub account can read the repo can read its chats; Nitpilot asks GitHub with that person's own token, keeps the answer 5 minutes, and answers "no such chat" and "you can't see it" the same way (spec §16).

## Why GitHub decides

A chat repeats code, file paths and review points from the repo. For a private repo that's private code, so the rule is GitHub's own: if GitHub shows you the repo, you may read its chats. Nitpilot doesn't keep its own list of who may see what. It asks GitHub `GET /repos/<owner>/<repo>` **with your token** (`auth/repo-access.ts`). GitHub answers 404 for a private repo you can't read, so a 404 (or a 403) means no.

Asking with the app's token instead would be wrong: the app can read every repo it's installed on, and that says nothing about you.

## Where it's checked

The same question, everywhere a chat is read:

- `GET /api/chats/:owner/:repo/:number`, `…/:id/messages` and `…/:id/files` (`http/routes/chats.ts`);
- each `chat.subscribe` on `/ws/web`, and again before sending once the answer is 5 minutes old (`ws/web-hub.ts`);
- each row of your inbox, once per repo (`http/routes/inbox.ts`).

`chats/access.ts` puts the lookup and the question together: `chatAccess` for a chat id, `chatAccessByPath` for the address in the browser.

## The answers

| Situation | REST | `/ws/web` |
|---|---|---|
| You can read the repo | the chat | its items |
| No such chat, or you can't see its repo | 404 `not_found` | `chat.error not_found` |
| Your GitHub sign-in expired | 401 `reauth` ("Sign in with GitHub again…") | `chat.error reauth` |
| GitHub didn't answer | 502 `github_unavailable` | `chat.error unavailable` |
| Not signed in to Nitpilot | 401 `unauthorized` | no socket (401) |

**Why one 404 for two cases.** If "no such chat" and "you can't see it" looked different, anyone could try addresses and learn which private repos use Nitpilot and how many PRs they have. So both are the same 404, with the same body.

**Why GitHub is asked first, for an address.** `chatAccessByPath` asks about the repo in the address before it looks for the chat. Otherwise someone whose sign-in expired would get "sign in again" for a chat that exists and a 404 for one that doesn't. Owner and repo names that aren't shaped like GitHub's (letters, digits, `-`, `_`, `.`) get the 404 before any call, since they go into a GitHub API path.

**Why 401 `reauth` and not 401 `unauthorized`.** Both are "who are you?", but they mean different things to the web app: `unauthorized` is "you're not signed in to Nitpilot" (show the landing page), `reauth` is "you are, but your GitHub sign-in expired" (show the Reconnect banner).

## What the 5 minutes cost

Asking GitHub on every read would make each chat open wait on GitHub, and spend the person's GitHub rate limit. So the answer is kept 5 minutes per person and repo (`lib/ttl-cache.ts`, at most 1,000 answers). The cost: someone removed from a repo can still read its chats for up to 5 minutes. An open socket asks again when its answer is that old, so it stops too.

## Who can *do* what

Reading is the only thing W3 allows. From W4 every change (a note, Resolve, Continue, Retry, Auto, drafts) also passes one pure function that knows the roles: notes for the author and the reviewers on Nitpilot, Resolve only for the reviewer who raised the point, and so on (spec §16 "Who can act in a chat"). Someone who can read the repo but isn't in the chat reads along, and can't act.

## The React analogy

It's a route guard, like a `<RequireAuth>` wrapper around a page, except the guard asks a second service (GitHub) and caches its answer like a query with a `staleTime` of 5 minutes.
```

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §10 "REST endpoints in Plan 2", the chat read becomes "`GET /api/chats/:owner/:repo/:number` (header, participants and presence, points, waiting drafts, team rules, what the viewer may do, `lastSeq`, and the newest 200 timeline items)", and `GET /api/chats/:id/files` becomes "(changed files from the platform, at most 300, kept in memory per head commit for 10 minutes)". After the "Personal:" line, add: "A chat read that isn't allowed answers like the inbox: the same 404 for a chat that doesn't exist and one you can't see, a 401 with code `reauth` when your GitHub sign-in expired, a 502 when GitHub doesn't answer. Every GitHub call gives up after 15 seconds."

- [ ] **Step 15: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e`
Expected: protocol 49, CLI 293 passed + 14 skipped, server 708, web 73; end to end 5; typecheck and lint clean.

- [ ] **Step 16: Commit**

```bash
git add packages/protocol/src apps/server/src apps/server/test/app.ts apps/server/test/e2e/harness.ts docs/why/chat-access-rules.md docs/superpowers/specs/2026-10-07-nitpilot-design.md docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(server): the chat, its older items and its files over REST; GitHub calls time out, token refreshes wait their turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Live publishing: commits, presence and progress reach the browser

**Files:**
- Create: `apps/server/src/ws/web-wire.ts`, `apps/server/src/ws/web-wire.db.test.ts`.
- Modify: `apps/server/src/chats/save.ts` (`SeqRange`; `appendTimeline` returns it), `apps/server/src/chats/apply-commands.ts` (`DispatchEffects.timeline`), `apps/server/src/chats/dispatch.ts`, `apps/server/src/chats/dispatch.db.test.ts`, `apps/server/src/ws/cli-hub.ts` (`onPresence`), `apps/server/src/ws/cli-hub.db.test.ts`, `apps/server/src/ws/web-hub.ts` (`connected`, `followedChats`), `apps/server/test/web-ws.ts` (`TestTab.log`), `apps/server/src/auth/users.ts` (`loadWebMe`), `apps/server/src/http/routes/me.ts`, `apps/server/src/main.ts`, `apps/server/test/e2e/harness.ts`, `apps/cli/src/daemon.ts` and `daemon.test.ts` (a stage change skips the throttle), `docs/superpowers/specs/2026-10-07-nitpilot-design.md` (§10: which chats a presence change sends again).

**Interfaces:**
- Consumes: `WebHub` (`publishItems`, `sendToChat`, `sendToChatViewer`, `sendToUser`, `subscribers`) and `loadItemsAfter` (Task 7); `loadChatView` (Task 8); `loadInboxRow(chatId, userId, clis)` (Task 5); `RepoAccess`; `KeyedLock`, `TtlCache`; `Dispatcher.onCommit`, `CliHub.onMessage`; test helpers `TestCli`, `listen`, `startWebHub`, `TestTab`, `makeCliToken`, `makeGithubSignIn`, `personOf`.
- Produces: `SeqRange = { fromSeq: number; toSeq: number }` and `appendTimeline(tx, chatId, items): Promise<SeqRange | null>` (`chats/save.ts`). `DispatchEffects.timeline: SeqRange | null`. `PresenceChange = { userId; tokenId; change: 'connected' | 'disconnected' }` and `CliHub.onPresence(listener: (e: PresenceChange) => void)` (not called when a device's newer connection replaces its older one). `WebHub.connected(userId): boolean` and `WebHub.followedChats(): string[]`. `loadWebMe(userId, clis: LiveClis): Promise<WebMe>` (`auth/users.ts`, for `GET /api/me` and `me.update`). `STATE_DEBOUNCE_MS = 100`; `WebWiring = { webHub; dispatcher; cliHub; access: RepoAccess; debounceMs? }`; `wireWebHub(wiring): { stop(): void }` (`ws/web-wire.ts`). `TestTab.log`: the type of every message received, in order.

**Behavior** (`wireWebHub`):
- After a commit that added items, the chat's followers get those items (one `chat.items`); then, debounced 100 ms per chat, each follower gets their own `chat.state` and each participant on Nitpilot with a tab open gets `inbox.upsert` with their rows, but only if `RepoAccess` says they can still read the repo (the carry-forward from Task 5: the socket must not show what `GET /api/inbox` hides). Everything for one chat goes out in order (a `KeyedLock` per chat); a failure is logged and never reaches the dispatcher.
- When a CLI comes or goes: `me.update` to its owner, then `chat.state` (and inbox rows) for the chats where that person's agent has a queued or running job, and for every chat someone has open in which that person takes part (the presence dot in the header and the details panel).
- `job.progress` from a CLI goes to that chat's followers only when the job is that CLI owner's own (a small cache from job id to chat, login and kind, filled from the database on a miss), as `{ chatId, who: login, action: 'reviewing' | 'fixing', stage, text }`.
- CLI: `progress(stage, text)` sends at once when `stage` differs from the last stage sent for that job; otherwise at most every 2 s, as before.

- [ ] **Step 1: Write the failing test for the seqs a commit adds**

In `apps/server/src/chats/dispatch.db.test.ts`, the first test's last line becomes `expect(effects[0]).toMatchObject({ jobsChanged: true, timeline: { fromSeq: 1, toSeq: 2 } });`, and a test follows it:

```ts
  it('tells listeners which timeline items each commit added, and none when it added nothing', async () => {
    const { chat, maya, person, dispatcher, effects } = await scene();
    await dispatcher.dispatch(chat.id, { type: 'human_note', author: person(maya), body: 'Please keep the old API' });
    await dispatcher.dispatch(chat.id, { type: 'timer', key: 'no-such-timer' });
    expect(effects.map((e) => e.timeline)).toEqual([{ fromSeq: 1, toSeq: 2 }, { fromSeq: 3, toSeq: 3 }, null]);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:db -w apps/server -- src/chats/dispatch.db.test.ts`
Expected: FAIL, 2 tests: the effects have no `timeline`.

- [ ] **Step 3: A commit says which items it added**

In `apps/server/src/chats/save.ts`, replace `appendTimeline`'s doc comment and first lines (`export async function appendTimeline(…): Promise<void> {` and `if (items.length === 0) return;`) so it ends up as:

```ts
/** The seqs a commit added to a chat's timeline, first to last. */
export type SeqRange = { fromSeq: number; toSeq: number };

/** Append timeline items with the next sequence numbers (the chat's resume cursor). Returns their seqs, or null for none. */
export async function appendTimeline(tx: Tx, chatId: string, items: NewItem[]): Promise<SeqRange | null> {
  if (items.length === 0) return null;
  const { lastSeq } = await tx.prChat.update({ where: { id: chatId }, data: { lastSeq: { increment: items.length } }, select: { lastSeq: true } });
  const first = lastSeq - items.length + 1;
  await tx.message.createMany({
    data: items.map((item, i) => ({
      chatId,
      seq: first + i,
      kind: item.kind,
      authorGithubId: item.author?.githubId ?? null,
      authorLogin: item.author?.login ?? null,
      pointNumber: item.pointNumber,
      jobId: item.jobId,
      body: item.body,
      data: (item.data ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
  return { fromSeq: first, toSeq: lastSeq };
}
```

In `apps/server/src/chats/apply-commands.ts`, import `type SeqRange` from `'./save'`, add to `DispatchEffects` after `cancelledJobs`:

```ts
  /** The timeline items this commit added, for the browsers following the chat (ws/web-wire.ts). Null when none. */
  timeline: SeqRange | null;
```

and start `applyCommands` with `const effects: DispatchEffects = { jobsChanged: false, tasksCreated: false, cancelledJobs: [], timeline: null };`.

In `apps/server/src/chats/dispatch.ts`, inside the transaction, `await appendTimeline(tx, chatId, out.timeline);` becomes `const timeline = await appendTimeline(tx, chatId, out.timeline);`, and `return applyCommands(tx, chatId, out.commands, now);` becomes `return { ...(await applyCommands(tx, chatId, out.commands, now)), timeline };`.

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:db -w apps/server -- src/chats/dispatch.db.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing test for presence**

In `apps/server/src/ws/cli-hub.db.test.ts`, import `type PresenceChange` beside `CliHub`, and add after the test "lets a newer connection with the same token take over, and tells the older one to stop":

```ts
  it('says when a device comes online and when it goes, but not when the same device reconnects over itself', async () => {
    const { hub, url } = await hubOnPort();
    const changes: PresenceChange[] = [];
    hub.onPresence((e) => changes.push(e));
    const { user, token } = await device();
    const first = await TestCli.online(url, token.raw);
    const second = await TestCli.online(url, token.raw);
    await first.closed;
    second.close();
    await vi.waitFor(() => expect(changes.map((c) => c.change)).toEqual(['connected', 'disconnected']));
    expect(changes[0]).toEqual({ userId: user.id, tokenId: token.id, change: 'connected' });

    // A CLI that went silent is dropped, and that's a disconnect too.
    await TestCli.online(url, token.raw);
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    hub.dropSilent(new Date(Date.now() + 1_000));
    expect(changes.map((c) => c.change)).toEqual(['connected', 'disconnected', 'connected', 'disconnected']);
  });
```

- [ ] **Step 6: Run it to see it fail**

Run: `npm run test:db -w apps/server -- src/ws/cli-hub.db.test.ts`
Expected: FAIL: `TypeError: hub.onPresence is not a function`.

- [ ] **Step 7: The CLI hub reports presence**

In `apps/server/src/ws/cli-hub.ts`, add after `MessageListener`:

```ts
/** A device came online (its hello was welcomed) or went away. The web app shows it (spec §10 `me.update`). */
export type PresenceChange = { userId: string; tokenId: string; change: 'connected' | 'disconnected' };
```

a field after `listeners`: `private readonly presenceListeners: ((e: PresenceChange) => void)[] = [];`, a method after `onMessage`:

```ts
  /** Called when a device comes online or goes away. Not when a newer connection of the same device replaces an older one. */
  onPresence(listener: (e: PresenceChange) => void): void {
    this.presenceListeners.push(listener);
  }
```

and one before `emit`:

```ts
  private presenceChanged(conn: CliConnection, change: PresenceChange['change']): void {
    for (const listener of this.presenceListeners) {
      try {
        listener({ userId: conn.userId, tokenId: conn.tokenId, change });
      } catch (err) {
        console.error('[cli-hub] presence listener failed:', err);
      }
    }
  }
```

Then call it where a device comes and goes:
1. In `dropSilent`, after `c.terminate();`: `this.presenceChanged(c, 'disconnected');`.
2. In the socket's `'close'` handler, the line that forgets the connection becomes:

```ts
      if (conn && this.byToken.get(conn.tokenId) === conn) {
        this.byToken.delete(conn.tokenId);
        this.presenceChanged(conn, 'disconnected');
      }
```

3. Where a welcomed hello registers the connection, replace `this.byToken.get(auth.tokenId)?.close(CLOSE_CODES.replaced, …);` through the `welcome` send with:

```ts
    const replaced = this.byToken.get(auth.tokenId);
    replaced?.close(CLOSE_CODES.replaced, `Another ${BRAND.cli} start on this device took over.`);
    this.byToken.set(auth.tokenId, conn);
    conn.send({ v: 1, t: 'welcome', d: { login: user.login, pingSec: PING_SEC, leaseSec: LEASE_SEC } });
    // The same device again (back from sleep) was online all along, as far as anyone watching can tell.
    if (!replaced) this.presenceChanged(conn, 'connected');
```

(The replaced connection's own `'close'` later finds a newer connection under its token and reports nothing.)

- [ ] **Step 8: Run it to see it pass**

Run: `npm run test:db -w apps/server -- src/ws/cli-hub.db.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 9: Write the failing wiring tests**

The tests check the order messages arrive in, so the test tab keeps a log. In `apps/server/test/web-ws.ts`, add a field to `TestTab` after `waiting`:

```ts
  /** The type of every message received, in order, whether or not a test took it out of the inbox. */
  readonly log: ServerToWeb['t'][] = [];
```

and in the constructor's `'message'` listener, parse once and log it:

```ts
      const msg = JSON.parse(String(event.data)) as ServerToWeb;
      this.inbox.push(msg);
      this.log.push(msg.t);
```

Create `apps/server/src/ws/web-wire.db.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeGithubSignIn, makeRepo, makeUser, personOf } from '../../test/db';
import { fakeFetch } from '../../test/fake-fetch';
import { sessionCookieFor } from '../../test/http';
import { startWebHub, TestTab } from '../../test/web-ws';
import { listen, sleep, TestCli } from '../../test/ws';
import { RepoAccess } from '../auth/repo-access';
import { Dispatcher } from '../chats/dispatch';
import { loadItemsAfter } from '../chats/timeline';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';
import { CliHub } from './cli-hub';
import { wireWebHub } from './web-wire';

const DEBOUNCE_MS = 30;
const stops: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

/** The server's live side, wired as main.ts wires it: a dispatcher, a CLI hub and a web hub. maya's PR, leo asked to review. */
async function setup() {
  const repo = await makeRepo();
  const access = new RepoAccess(new GithubClient(fakeFetch({ [`GET /repos/${repo.fullName}`]: () => ({ id: 1 }) })));
  const dispatcher = new Dispatcher();
  const cliHub = new CliHub();
  const cliServer = await listen(cliHub);
  const web = await startWebHub({ access, loadItems: loadItemsAfter });
  const live = wireWebHub({ webHub: web.hub, dispatcher, cliHub, access, debounceMs: DEBOUNCE_MS });
  stops.push(() => cliServer.close(), () => web.close(), () => live.stop());

  const [maya, leo, reader] = [await makeUser({ login: 'maya' }), await makeUser({ login: 'leo' }), await makeUser({ login: 'rae' })];
  for (const u of [maya, leo, reader]) await makeGithubSignIn(u.id);
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const tab = async (user: { id: string }, subscribe = true) => {
    const t = await TestTab.open(web.url, { cookie: await sessionCookieFor(user.id), origin: web.origin });
    if (subscribe) {
      t.subscribe(chat.id, 0);
      await t.next('chat.items');
    }
    return t;
  };
  const open = () => dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  return { repo, chat, maya, leo, reader, dispatcher, cliServer, tab, open };
}

describe('wireWebHub: after a commit (spec §10)', () => {
  it("sends followers the new items in one message and then their own view, and participants their inbox rows", async () => {
    const { chat, maya, leo, reader, tab, open } = await setup();
    const [mayaTab, readerTab, leoTab] = [await tab(maya), await tab(reader), await tab(leo, false)];
    await open();

    const items = await mayaTab.next('chat.items');
    expect(items.d.items.map((i) => i.seq)).toEqual([1, 2]);
    expect((await mayaTab.next('chat.state')).d.view).toMatchObject({ id: chat.id, viewer: { role: 'author' } });
    expect((await mayaTab.next('inbox.upsert')).d.rows.map((r) => r.role)).toEqual(['author']);
    expect(mayaTab.log).toEqual(['chat.items', 'chat.items', 'chat.state', 'inbox.upsert']);

    // Someone who reads along: the items and their view, but no inbox row.
    expect((await readerTab.next('chat.items')).d.items).toHaveLength(2);
    expect((await readerTab.next('chat.state')).d.view.viewer.role).toBeNull();
    await readerTab.nothing('inbox.upsert');

    // leo isn't looking at the chat: just his inbox row.
    expect((await leoTab.next('inbox.upsert')).d.rows).toMatchObject([{ chatId: chat.id, role: 'reviewer' }]);
    await leoTab.nothing('chat.items');
  });

  it('sends every item of a burst of commits, and one view for all of them', async () => {
    const { maya, tab, open, dispatcher, chat } = await setup();
    const mayaTab = await tab(maya);
    await open();
    await dispatcher.dispatch(chat.id, { type: 'human_note', author: personOf(maya), body: 'Keep the old endpoint' });
    await mayaTab.next('chat.state');
    await sleep(DEBOUNCE_MS * 3);
    expect(mayaTab.seqs(chat.id)).toEqual([1, 2, 3]);
    expect(mayaTab.log.filter((t) => t === 'chat.state')).toHaveLength(1);
  });
});

describe('wireWebHub: CLIs coming and going', () => {
  it("tells the person, and shows their waiting agent as working once its CLI is back", async () => {
    const { repo, maya, leo, tab, open, cliServer } = await setup();
    const [mayaTab, leoTab] = [await tab(maya), await tab(leo, false)];
    await open();
    expect((await mayaTab.next('chat.state')).d.view.activity).toMatchObject({ kind: 'agent_waiting', who: 'leo', why: 'offline' });

    const { raw } = await makeCliToken(leo.id);
    const cli = await TestCli.online(cliServer.url, raw, { repos: [repo.fullName] });
    expect((await leoTab.next('me.update')).d.me).toMatchObject({ login: 'leo', agentOnline: true });
    expect((await mayaTab.next('chat.state')).d.view.activity).toEqual({ kind: 'agent_working', who: 'leo', why: null, offlineSince: null });

    cli.close();
    expect((await leoTab.next('me.update')).d.me.agentOnline).toBe(false);
  });

  it("shows an agent coming and going in a chat someone has open, even with no work queued for it", async () => {
    const { repo, maya, tab, open, cliServer } = await setup();
    const mayaTab = await tab(maya);
    await open();
    const agentOf = (view: { participants: { login: string; agent: { online: boolean } | null }[] }) => view.participants.find((p) => p.login === 'maya')?.agent?.online;
    expect(agentOf((await mayaTab.next('chat.state')).d.view)).toBe(false);

    // maya wrote the PR: nothing waits for her agent until leo's review is in.
    const { raw } = await makeCliToken(maya.id);
    const cli = await TestCli.online(cliServer.url, raw, { repos: [repo.fullName] });
    expect(agentOf((await mayaTab.next('chat.state')).d.view)).toBe(true);

    cli.close();
    expect(agentOf((await mayaTab.next('chat.state')).d.view)).toBe(false);
  });
});

describe('wireWebHub: progress lines', () => {
  it("forwards a CLI's progress to the chat's followers, as whose agent and doing what", async () => {
    const { repo, chat, maya, leo, tab, open, cliServer } = await setup();
    const [mayaTab, leoTab] = [await tab(maya), await tab(leo, false)];
    await open();
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, userId: leo.id } });
    const cli = await TestCli.online(cliServer.url, (await makeCliToken(leo.id)).raw, { repos: [repo.fullName] });
    cli.send({ v: 1, t: 'job.progress', d: { jobId: job.id, attempt: 1, stage: 'running_agent', text: 'reading src/orders.ts' } });
    expect((await mayaTab.next('job.progress')).d).toEqual({ chatId: chat.id, who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading src/orders.ts' });
    await leoTab.nothing('job.progress');
  });

  it("drops progress a CLI sends for someone else's job", async () => {
    const { repo, chat, maya, leo, tab, open, cliServer } = await setup();
    const mayaTab = await tab(maya);
    await open();
    const leosJob = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, userId: leo.id } });
    const mayasCli = await TestCli.online(cliServer.url, (await makeCliToken(maya.id)).raw, { repos: [repo.fullName] });
    mayasCli.send({ v: 1, t: 'job.progress', d: { jobId: leosJob.id, attempt: 1, stage: 'running_agent', text: 'pretending to be leo' } });
    await mayaTab.nothing('job.progress');
  });
});
```

- [ ] **Step 10: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/ws/web-wire.db.test.ts`
Expected: FAIL: `./web-wire` doesn't exist.

- [ ] **Step 11: Wire the hubs together**

`me.update` sends what `GET /api/me` answers, so that answer moves where both can use it. In `apps/server/src/auth/users.ts`, import `type WebMe` from `@nitpilot/protocol` and `type LiveClis` from `'../chats/activity'`, and add at the end:

```ts
/**
 * Who you are, as the web app reads it (`GET /api/me`, and `me.update` on `/ws/web`): your GitHub account, whether
 * your GitHub sign-in still works, and whether one of your CLIs is connected right now.
 */
export async function loadWebMe(userId: string, clis: LiveClis): Promise<WebMe> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { githubAuth: true } });
  return {
    id: user.id,
    githubId: user.githubId,
    login: user.login,
    avatarUrl: user.avatarUrl,
    githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth',
    agentOnline: clis.connectionsFor(user.id).length > 0,
  };
}
```

Replace `apps/server/src/http/routes/me.ts` with:

```ts
import type { WebMe } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireUser, type UserVariables } from '../../auth/request-user';
import { loadWebMe } from '../../auth/users';
import type { LiveClis } from '../../chats/activity';

/**
 * `GET /api/me` (spec §10): who you are, whether your GitHub sign-in still works, and whether one of your CLIs
 * is connected. For the web app and the CLI alike.
 */
export function meRoutes(deps: { clis: LiveClis }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/me', requireUser, async (c) => {
    const body: WebMe = await loadWebMe(c.get('user').id, deps.clis);
    return c.json(body);
  });

  return app;
}
```

In `apps/server/src/ws/web-hub.ts`, add after `sendToUser`:

```ts
  /** Whether this person has a tab open right now. */
  connected(userId: string): boolean {
    return [...this.clients].some((c) => c.user.id === userId);
  }
```

and after `subscribers`:

```ts
  /** Every chat someone follows right now, once each. */
  followedChats(): string[] {
    const chats = new Set<string>();
    for (const client of this.clients) for (const chatId of client.subs.keys()) chats.add(chatId);
    return [...chats];
  }
```

Create `apps/server/src/ws/web-wire.ts`:

```ts
import type { InboxRow, JobType } from '@nitpilot/protocol';
import type { RepoAccess } from '../auth/repo-access';
import { loadWebMe } from '../auth/users';
import type { Dispatcher } from '../chats/dispatch';
import { loadInboxRow } from '../chats/inbox';
import type { SeqRange } from '../chats/save';
import { loadItemsAfter } from '../chats/timeline';
import { loadChatView } from '../chats/views';
import { KeyedLock } from '../lib/key-lock';
import { prisma } from '../lib/prisma';
import { TtlCache } from '../lib/ttl-cache';
import type { CliHub } from './cli-hub';
import type { WebHub } from './web-hub';

/** Commits close together make one `chat.state`: it goes this long after the first of them. Every item still goes. */
export const STATE_DEBOUNCE_MS = 100;

/** What a progress line needs to know about a job: its chat, whose it is, and what kind of work. */
type JobInfo = { chatId: string; userId: string; login: string; action: 'reviewing' | 'fixing' };

export type WebWiring = { webHub: WebHub; dispatcher: Dispatcher; cliHub: CliHub; access: RepoAccess; debounceMs?: number };

/**
 * Connect `/ws/web` to the rest of the server (spec §10 "Web ↔ server"). After each commit, the chat's followers get
 * its new items and their own view of it, and its participants their inbox rows. When a CLI comes or goes, its owner
 * gets `me.update`, and the chats where their agent has work or shows its presence are sent again. A CLI's progress
 * lines go to the chat's followers. main.ts and the tests call this, so the tests run what production runs.
 */
export function wireWebHub({ webHub, dispatcher, cliHub, access, debounceMs = STATE_DEBOUNCE_MS }: WebWiring): { stop(): void } {
  // Everything about one chat goes out in order: its items before the state that follows them.
  const perChat = new KeyedLock();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const jobs = new TtlCache<JobInfo>(60 * 60_000, 10_000);

  /** Run `work` for this chat after what's already queued for it. Never throws: publishing must not break a commit. */
  function inOrder(chatId: string, what: string, work: () => Promise<void>): void {
    perChat.run(chatId, work).catch((err) => console.error(`[web-wire] ${what} for chat ${chatId} failed:`, err));
  }

  /** Send the chat's state soon, once for all the commits in the next `debounceMs`. */
  function stateSoon(chatId: string): void {
    if (timers.has(chatId)) return;
    timers.set(
      chatId,
      setTimeout(() => {
        timers.delete(chatId);
        inOrder(chatId, 'state', () => publishState(chatId));
      }, debounceMs),
    );
  }

  async function publishItems(chatId: string, range: SeqRange): Promise<void> {
    if (webHub.subscribers(chatId).length === 0) return;
    const items = (await loadItemsAfter(chatId, range.fromSeq - 1)).filter((item) => item.seq <= range.toSeq);
    webHub.publishItems(chatId, items);
  }

  /** Each follower's own view (your role and attention are yours), then each participant's inbox rows. */
  async function publishState(chatId: string): Promise<void> {
    for (const viewer of webHub.subscribers(chatId)) {
      const view = await loadChatView(chatId, viewer, cliHub);
      webHub.sendToChatViewer(chatId, viewer.id, { v: 1, t: 'chat.state', d: { chatId, view } });
    }
    for (const userId of await participantsOnNitpilot(chatId)) {
      if (!webHub.connected(userId)) continue;
      const rows = await readableRows(userId, await loadInboxRow(chatId, userId, cliHub));
      if (rows) webHub.sendToUser(userId, { v: 1, t: 'inbox.upsert', d: { chatId, rows } });
    }
  }

  /**
   * A row shows the PR's title and newest message, so it goes only to someone who can still read the repo, the
   * same check the inbox makes (http/routes/inbox.ts). Null when GitHub didn't answer: nothing is sent this time.
   */
  async function readableRows(userId: string, rows: InboxRow[]): Promise<InboxRow[] | null> {
    if (rows.length === 0) return rows;
    try {
      return (await access.check(userId, rows[0]!.repo)) === 'read' ? rows : [];
    } catch (err) {
      console.error('[web-wire] could not check repo access for an inbox row:', err);
      return null;
    }
  }

  async function jobInfo(jobId: string): Promise<JobInfo | null> {
    const kept = jobs.get(jobId);
    if (kept) return kept;
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { chatId: true, userId: true, type: true, participant: { select: { login: true } } } });
    if (!job) return null;
    const info: JobInfo = { chatId: job.chatId, userId: job.userId, login: job.participant.login, action: (job.type as JobType) === 'address' ? 'fixing' : 'reviewing' };
    jobs.set(jobId, info);
    return info;
  }

  dispatcher.onCommit((chatId, effects) => {
    const range = effects.timeline;
    if (range) inOrder(chatId, 'items', () => publishItems(chatId, range));
    stateSoon(chatId);
  });

  cliHub.onPresence(({ userId }) => {
    void (async () => {
      webHub.sendToUser(userId, { v: 1, t: 'me.update', d: { me: await loadWebMe(userId, cliHub) } });
      for (const chatId of await chatsShowingAgentOf(userId, webHub.followedChats())) stateSoon(chatId);
    })().catch((err) => console.error('[web-wire] presence update failed:', err));
  });

  cliHub.onMessage(async (conn, msg) => {
    if (msg.t !== 'job.progress') return;
    const job = await jobInfo(msg.d.jobId);
    // Only for a job of this CLI's owner: nobody's CLI can put words in someone else's chat.
    if (!job || job.userId !== conn.userId) return;
    webHub.sendToChat(job.chatId, { v: 1, t: 'job.progress', d: { chatId: job.chatId, who: job.login, action: job.action, stage: msg.d.stage, text: msg.d.text } });
  });

  return {
    stop(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

/**
 * The chats whose view changes when this person's CLI comes or goes: where their agent has work ("waiting" ↔
 * "working", inbox rows too), and, among the chats someone has open, where they take part (the presence dot).
 */
async function chatsShowingAgentOf(userId: string, followed: string[]): Promise<string[]> {
  const active = await prisma.job.findMany({ where: { userId, status: { in: ['queued', 'running'] } }, select: { chatId: true }, distinct: ['chatId'] });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { githubId: true } });
  const taking = user && followed.length > 0 ? await prisma.participant.findMany({ where: { githubId: user.githubId, chatId: { in: followed } }, select: { chatId: true } }) : [];
  return [...new Set([...active, ...taking].map((row) => row.chatId))];
}

/** The Nitpilot users among the chat's people. */
async function participantsOnNitpilot(chatId: string): Promise<string[]> {
  const people = await prisma.participant.findMany({ where: { chatId, isBot: false }, select: { githubId: true } });
  const users = await prisma.user.findMany({ where: { githubId: { in: people.map((p) => p.githubId) } }, select: { id: true } });
  return users.map((u) => u.id);
}
```

- [ ] **Step 12: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/ws/web-wire.db.test.ts src/http/routes/me.db.test.ts`
Expected: PASS, 6 and 4 tests.

- [ ] **Step 13: Wire it in `main.ts` and the end-to-end harness**

In `apps/server/src/main.ts`: import `wireWebHub` from `'./ws/web-wire'`; the hub's line becomes

```ts
  const access = new RepoAccess(github);
  const webHub = new WebHub({ access, loadItems: loadItemsAfter });
```

after `const cliJobs = wireCliHub({ hub, dispatcher, platform });` add

```ts
  // Commits, CLI presence and progress → the browsers following along (ws/web-wire.ts).
  const live = wireWebHub({ webHub, dispatcher, cliHub: hub, access });
```

and in the shutdown handler, `live.stop();` after `cliJobs.stop();`.

In `apps/server/test/e2e/harness.ts`, the same: import `wireWebHub`; the hub's line becomes `const access = new RepoAccess(githubApi);`, `const webHub = new WebHub({ access, loadItems: loadItemsAfter });`, `const live = wireWebHub({ webHub, dispatcher, cliHub: hub, access });`; and `live.stop();` after `cliJobs.stop();` in `close()`.

- [ ] **Step 14: Write the failing CLI test for stage changes**

Plan 1b's deferred minor: the 2-second throttle dropped a stage change, so the line could say "running the agent" while it was pushing. In `apps/cli/src/daemon.test.ts`, add before the test "stops a job the server cancels, and sends nothing for it":

```ts
  it('sends a change of stage at once, and the same stage at most every 2 s (spec §10)', async () => {
    const finish = deferred<JobOutcome>();
    const { hub } = await setup({
      executor: async (_bundle, io) => {
        io.progress('preparing', 'Checking out the PR');
        io.progress('running_agent', 'Running fake');
        io.progress('running_agent', 'calling add_point');
        return finish.promise;
      },
    });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    expect((await conn.next('job.progress')).d).toMatchObject({ ...JOB, stage: 'preparing', text: 'Checking out the PR' });
    expect((await conn.next('job.progress')).d).toMatchObject({ stage: 'running_agent', text: 'Running fake' });
    await conn.nothing('job.progress');
    finish.resolve(done);
  });
```

Run: `npm test -w apps/cli -- src/daemon.test.ts`
Expected: FAIL: the second `job.progress` never arrives (the throttle drops it).

- [ ] **Step 15: A new stage goes at once**

In `apps/cli/src/daemon.ts`, `PROGRESS_EVERY_MS`'s comment becomes `/** Live status goes out at most this often, except that a new stage goes at once (spec §10). */`, and in `execute`, the start of `io` becomes:

```ts
    let lastProgress = 0;
    let lastStage: Stage | null = null;
    const io: JobIo = {
      progress(stage, text) {
        const now = Date.now();
        if (!welcomed) return;
        // A new stage ("pushing" after "running_agent") goes at once, so the status line never shows a stale one.
        if (stage === lastStage && now - lastProgress < PROGRESS_EVERY_MS) return;
        lastProgress = now;
        lastStage = stage;
        socket?.send({ v: 1, t: 'job.progress', d: { jobId: job.jobId, attempt: job.attempt, stage, text: text.slice(0, 200) } });
      },
```

Run: `npm test -w apps/cli -- src/daemon.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 16: The spec**

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §10 "Web ↔ server", the `me.update` item's second sentence ("The chats where that person's agent has active jobs are sent again too, so "working" and "waiting" stay true for everyone.") becomes: "The chats where that person's agent has active jobs, and every chat someone has open in which that person takes part, are sent again too, so "working", "waiting" and the presence dot stay true for everyone." In the `inbox.upsert` item, add: "Only to people who can still read the repo (the inbox's own check)."

- [ ] **Step 17: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e`
Expected: protocol 49, CLI 294 passed + 14 skipped, server 716, web 73; end to end 5; typecheck and lint clean.

- [ ] **Step 18: Commit**

```bash
git add apps/server/src apps/server/test/web-ws.ts apps/server/test/e2e/harness.ts apps/cli/src/daemon.ts apps/cli/src/daemon.test.ts docs/superpowers/specs/2026-10-07-nitpilot-design.md docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(server): commits, CLI presence and progress reach the browser over /ws/web

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: The chat screen (read-only), and the transcript page retired

**Files:**
- Create: `apps/web/src/test/chat.ts`, `apps/web/src/test/socket.ts`, `apps/web/src/lib/{timeline,banner,snippet,names,clipboard}.ts` (+ `timeline.test.ts`, `banner.test.ts`, `snippet.test.ts`), `apps/web/src/live/{socket.ts,apply.ts,progress.ts,LiveProvider.tsx}` (+ `socket.test.ts`, `apply.test.ts`), `apps/web/src/api/chat.ts`, `apps/web/src/routes/Chat/{Chat,ChatHeader,ChatBanner,Timeline,PointCard,DetailsPanel}.tsx` with a `.module.css` each, `apps/web/src/routes/Chat/PointCard.test.tsx`, `apps/web/src/routes/Chat/Chat.test.tsx`, `apps/web/e2e/chat-live.spec.ts`, `apps/cli/src/agents/fake/scenarios/paced.json`, `docs/why/chat-page.md`.
- Modify: `apps/web/src/lib/time.ts` and its test (`itemTime`, `useNow`), `apps/web/src/lib/keys.ts` and its test (↑/↓ inside `<main>`), `apps/web/src/lib/viewport.ts` (`useIsWide`), `apps/web/src/lib/inbox.ts` (a comment), `apps/web/src/components/Avatar/Avatar.tsx`, `apps/web/src/components/AgentBadge/AgentBadge.{tsx,module.css}`, `apps/web/src/routes/Inbox/{Inbox,InboxRow,InboxBanners}.tsx`, `apps/web/src/routes/Inbox/Inbox.test.tsx`, `apps/web/src/routes/Shell/Shell.tsx` and its test, `apps/web/src/test/render.tsx`, `apps/web/src/app.tsx`, `apps/web/vite.config.ts`, `apps/web/e2e/control.ts`, `apps/web/e2e/inbox.spec.ts`, `apps/server/test/e2e/github.ts`, `apps/server/test/e2e/web-server.ts`, `apps/server/src/http/app.ts`, `apps/server/src/chats/access.ts` and `apps/server/src/lib/urls.ts` (comments), `docs/why/content-security-policy.md`.
- Delete: `apps/web/src/routes/Chat/ChatPlaceholder.tsx`, `apps/server/src/http/routes/transcript.tsx`, `apps/server/src/http/pages/transcript.tsx`, `apps/server/src/http/routes/transcript.db.test.ts`, `docs/why/transcript-page.md` (its content moves to `chat-page.md`). The SPA serves `/c/:owner/:repo/:number`; the access cases the transcript tests covered are Task 8's `chats.db.test.ts`.

**Interfaces:**
- Consumes: `ChatResponse`, `ChatView`, `PointView`, `ParticipantView`, `TimelineItem`, `MessagesResponse`, `FilesResponse`, `ServerToWeb`, `WebToServer`, `WEB_WS_PATH` (protocol, Tasks 7–8); the chat routes (Task 8) and `/ws/web` (Tasks 7, 9); `api.get`, `api.send`, `ApiError` (`status`, `code`); the `['me']` and `['inbox']` caches (W2); `Avatar`, `AgentBadge`, `Ping`, `ErrorState`, `Pane`, `EmptyPane`, `useIsDesktop`, `useEscapeBack`; `fakeApi`, `renderApp`, `fakeViewport` (W2's `test/render.tsx`).
- Produces (live): `SocketLike`; `liveUrl(location?)` (`/ws/web` on the page's host, `wss:` for an `https:` page); `class LiveSocket { constructor(opts: { url; onMessage(msg: ServerToWeb); onSignedOut?(); open?: (url) => SocketLike; backoff?: { startMs; maxMs; random } }); start(); stop(); subscribe(chatId, afterSeq); unsubscribe(chatId) }`: reconnects after 1 s doubling to 30 s, each wait ±20%, reset once open; re-subscribes every open chat from the newest seq it has; 4401 stops it and calls `onSignedOut`; `chat.error` forgets the chat, except `unavailable`, which asks again after 5 s. `mergeItems(existing, incoming): TimelineItem[]` (each seq once, in order); `applyServerMessage(queryClient, msg)` writes into `['chat', …]` (found by the view's id), `progressKey(chatId)`, `['inbox']`, `['me']`. `Progress`, `progressKey(chatId)`, `useProgress(chatId): Progress | null`. `SocketFactory` (a context, so tests pass fake sockets), `LiveProvider`, `useLiveChat(chatId, afterSeq)`.
- Produces (data): `chatKey(owner, repo, number)`, `useChat(owner, repo, number)`, `fetchOlderItems(chatId, beforeSeq)`, `useFiles(chatId)`, `useMarkRead(chatId, seq, participant)` (`api/chat.ts`).
- Produces (lib): `Banner` and `chatBanner(view: ChatView, me: WebMe): Banner` (kinds `github_expired`, `escalated` (points, note), `failed_job`, `failed_post`, `cap`, `repo_not_linked`, `waiting` (offlineSince), `ready_reviewer`, `ready_author`, `none`, in that priority; none on a closed PR) and `escalationNote(points, maxRounds)` (`lib/banner.ts`). `Glyph`, `TimelineRow`, `timelineRows(items, points)` (a point's card sits where it was raised and holds its thread), `systemGlyph(body)`, `severityCounts(data)`, `withCommitHashes(text)` (`lib/timeline.ts`). `snippetLines(point): { n; text; highlighted }[]` and `syntaxTokens(line): { text; kind }[]` (`lib/snippet.ts`). `agentName(login, you)`, `personName(login, you)` (`lib/names.ts`). `useCopy(text): { copied; copy() }` (`lib/clipboard.ts`, shared with the inbox's offline banner). `itemTime(iso, now?)` and `useNow(everyMs = 60_000): Date` (`lib/time.ts`). `useIsWide()` (1180 px, `lib/viewport.ts`).
- Produces (screens): `Avatar` sizes `22 | 28 | 30 | 32 | 38`; `AgentBadge({ login, size?: 'large' | 'small' | 'tiny', decorative? })`. `Chat` (the route's element; reads `me` from `useOutletContext<WebMe>()`), `ChatHeader`, `ChatBanner`, `Timeline`, `PointCard({ point, thread, you, people, repoUrl })`, `DetailsPanel({ view })`. `Shell` wraps everything signed in in `LiveProvider` and passes `me` as the outlet's context.
- Produces (tests): `test/chat.ts` (`point`, `chatView`, `item`, `chatResponse`, `chatRoutes`), `test/socket.ts` (`FakeSocket`, `fakeSockets`); `renderApp` also returns `sockets`; `fakeViewport(width: boolean | number)`. Playwright: control `POST /reset`, `POST /cli { login, scenario }`, `DELETE /cli { login }`; `resetChats`, `startCli`, `stopCli` (`e2e/control.ts`); `localGithub().addPull(number)`.

**Behavior** (handoff §2, §3, §10, both themes):
- Header: title, role chip, "Open on GitHub ↗", the details toggle (only where the panel fits); row 2 with repo #n, branches, round pips (amber on the last round) and "Round 2 of 3", each agent's presence (online dot, "offline since 18:04" ring, ping while working). Phone: the back arrow (44×44) and the header collapsing to one line after 48 px of scroll. No Auto switch in W3: Task 18 adds it with its state.
- One banner from `chatBanner`, with its text, its links ("Approve on GitHub ↗", "Reconnect GitHub") and copyable commands, but no action buttons (Task 13 adds Resolve, Continue, Retry, Review). Escalation `role=alert`, the others `role=status`. A rules chip ("! `.nitpilot.yml` has an error, using defaults") under it.
- Timeline (max 780 px): system lines with glyphs, agent summaries with severity counts, people's messages, point cards (resolved ones collapsed, click to open), the progress line (`role=status`, `aria-live=polite`), "Load earlier" while there are older items. The untrusted card ("First-time contributor") when the PR is from outside and you're asked to review it.
- Details panel at ≥1180 px, open by default, toggled from the header: files (`/files`), participants, team rules, the summary comment link.
- A 404 shows "Nothing here"; a 401 `reauth` shows "Sign in with GitHub again" with Reconnect; `chat.error` makes the screen ask again over REST, which shows one of those.
- Opening a chat marks it read up to its newest item a second later, while the tab is visible, for someone in it (the inbox row's unread count goes to 0).
- The inbox's ↑/↓ leave the page beside it alone (the chat's feed scrolls; j/k still move the cursor), and the inbox's times move on every minute (`useNow`), both W2 carry-forwards.

- [ ] **Step 1: Write the failing tests for the feed's logic**

A fixture for every chat test. Create `apps/web/src/test/chat.ts`:

```ts
import type { ChatResponse, ChatView, PointView, TimelineItem } from '@nitpilot/protocol';
import type { Answer } from './render';

// A chat for component tests: maya's PR #142 on acme/shop-api, reviewed by leo. Pass only what a test cares about.

export function point(over: Partial<PointView> = {}): PointView {
  return {
    number: 1, raisedBy: { githubId: '1002', login: 'leo' }, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT',
    url: 'https://github.com/acme/shop-api/blob/abc1234/src/orders/list.ts#L48', severity: 'major', category: 'bug',
    title: 'parseCursor throws on an empty cursor', body: 'An empty cursor decodes to "", which is an Invalid Date.',
    snippet: { startLine: 47, lines: ['export function parseCursor(raw: string) {', '  const [ts, id] = raw.split(":");', '  return { ts: new Date(Number(ts)), id };'] },
    status: 'open', authorResolution: null, escalationReason: null, trusted: true, round: 1, ...over,
  };
}

export function chatView(over: Partial<ChatView> = {}): ChatView {
  return {
    id: 'chat_142', repo: 'acme/shop-api', number: 142, title: 'Add cursor pagination to /orders', url: 'https://github.com/acme/shop-api/pull/142',
    author: 'maya', headRef: 'feature/cursor-pagination', baseRef: 'main', phase: 'reviewing', round: 1, maxRounds: 3,
    merged: false, closed: false, trusted: true, isDraft: false,
    viewer: { role: 'author', attention: 'none', failure: null },
    participants: [
      { githubId: '1001', login: 'maya', avatarUrl: 'https://avatars.githubusercontent.com/u/1001', role: 'author', isBot: false, onNitpilot: true, requested: false, agent: { online: true, offlineSince: null, working: false } },
      { githubId: '1002', login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/1002', role: 'reviewer', isBot: false, onNitpilot: true, requested: true, agent: { online: true, offlineSince: null, working: false } },
    ],
    activity: { kind: 'none', who: null, why: null, offlineSince: null },
    points: [],
    rules: { maxRounds: 3, alwaysEscalate: ['security'], autoReview: true, autoAddress: true, error: null },
    summaryUrl: null, lastSeq: 0, ...over,
  };
}

let at = Date.parse('2026-10-16T14:00:00Z');

/** A timeline item; `seq` and `at` count up unless given. */
export function item(seq: number, over: Partial<TimelineItem> = {}): TimelineItem {
  at += 60_000;
  return { seq, kind: 'system', author: null, pointNumber: null, jobId: null, body: `item ${seq}`, data: null, at: new Date(at).toISOString(), ...over };
}

export function chatResponse(over: { view?: Partial<ChatView>; items?: TimelineItem[]; hasOlder?: boolean } = {}): ChatResponse {
  const items = over.items ?? [];
  return { view: chatView({ lastSeq: items.at(-1)?.seq ?? 0, ...over.view }), items, hasOlder: over.hasOlder ?? false };
}

/** fakeApi answers for opening these chats: each one maya's PR with that title. */
export function chatRoutes(chats: { repo: string; number: number; title: string }[]): Record<string, () => Answer> {
  return Object.fromEntries(
    chats.map((c) => [`GET /api/chats/${c.repo}/${c.number}`, (): Answer => [200, chatResponse({ view: { id: `chat_${c.number}`, repo: c.repo, number: c.number, title: c.title } })]]),
  );
}
```

Create `apps/web/src/lib/timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { item, point } from '../test/chat';
import { severityCounts, systemGlyph, timelineRows, withCommitHashes } from './timeline';

describe('timelineRows', () => {
  it("puts each point's card where it was raised, with its replies and decisions inside", () => {
    const items = [
      item(1, { body: "Round 1: leo's agent is reviewing" }),
      item(2, { kind: 'job_summary', body: 'Two points.' }),
      item(3, { kind: 'point_raised', pointNumber: 1 }),
      item(4, { kind: 'point_raised', pointNumber: 2 }),
      item(5, { kind: 'human', body: 'Keep the old endpoint' }),
      item(6, { kind: 'point_reply', pointNumber: 1, body: 'Now 25.' }),
      item(7, { kind: 'point_decision', pointNumber: 1, body: 'Fixed.' }),
    ];
    const rows = timelineRows(items, [point(), point({ number: 2 })]);
    expect(rows.map((r) => (r.kind === 'point' ? `P${r.point.number}` : r.kind))).toEqual(['system', 'summary', 'P1', 'P2', 'human']);
    const p1 = rows[2]!;
    expect(p1.kind === 'point' && p1.thread.map((t) => t.seq)).toEqual([6, 7]);
  });

  it('puts a card where its thread starts when the item that raised it is on an older page', () => {
    const rows = timelineRows([item(40, { kind: 'human', body: 'hi' }), item(41, { kind: 'point_reply', pointNumber: 3 })], [point({ number: 3 })]);
    expect(rows.map((r) => r.kind)).toEqual(['human', 'point']);
  });
});

describe('systemGlyph', () => {
  it('reads the glyph off what the engine says', () => {
    expect(systemGlyph('Ready for approval')).toBe('check');
    expect(systemGlyph('Merged')).toBe('check');
    expect(systemGlyph('leo approved on GitHub')).toBe('check');
    expect(systemGlyph('P1 needs a human decision: security points always go to a person')).toBe('diamond');
    expect(systemGlyph("leo's agent is waiting (daily cap) and will try again later")).toBe('ring');
    expect(systemGlyph('Pull request opened by maya')).toBe('dot');
  });
});

describe('severityCounts', () => {
  it('lists the counts from the worst severity down, and nothing for none', () => {
    expect(severityCounts({ counts: { nit: 1, major: 1, minor: 2 } })).toBe('1 major · 2 minor · 1 nit');
    expect(severityCounts({ counts: {} })).toBe('');
    expect(severityCounts(null)).toBe('');
  });
});

describe('withCommitHashes', () => {
  it('marks the commit hashes in a line', () => {
    expect(withCommitHashes("maya's agent pushed a1b2c3d")).toEqual([{ text: "maya's agent pushed ", hash: false }, { text: 'a1b2c3d', hash: true }]);
    expect(withCommitHashes('Ready for approval')).toEqual([{ text: 'Ready for approval', hash: false }]);
  });
});
```

Create `apps/web/src/lib/banner.test.ts`:

```ts
import type { ChatView, PointView, WebMe } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { chatView, point } from '../test/chat';
import { chatBanner, escalationNote } from './banner';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };
const view = (over: Partial<ChatView> = {}) => chatView(over);
const escalated = (over: Partial<PointView> = {}) => point({ status: 'escalated', escalationReason: 'category', category: 'security', ...over });

describe('chatBanner (handoff §2 "Banners")', () => {
  it('asks to reconnect GitHub before anything else', () => {
    expect(chatBanner(view({ points: [escalated()] }), { ...me, githubAuth: 'needs_reauth' }).kind).toBe('github_expired');
  });

  it('lists the escalated points, with why they went to a person', () => {
    const banner = chatBanner(view({ phase: 'escalated', points: [escalated(), point({ number: 2 })] }), me);
    expect(banner).toEqual({ kind: 'escalated', points: [escalated()], note: 'Security points always go to a person.' });
  });

  it('tells a failed job from a failed post in your name', () => {
    expect(chatBanner(view({ viewer: { role: 'author', attention: 'failed', failure: 'agent' } }), me).kind).toBe('failed_job');
    expect(chatBanner(view({ viewer: { role: 'author', attention: 'failed', failure: 'github_post' } }), me).kind).toBe('failed_post');
  });

  it("says why your agent can't start: the daily cap, a repo not linked, or offline", () => {
    const waiting = (why: 'offline' | 'repo_not_linked' | 'cap_reached', who = 'maya') => view({ activity: { kind: 'agent_waiting', who, why, offlineSince: why === 'offline' ? '2026-10-16T18:04:00.000Z' : null } });
    expect(chatBanner(waiting('cap_reached'), me)).toEqual({ kind: 'cap' });
    expect(chatBanner(waiting('repo_not_linked'), me)).toEqual({ kind: 'repo_not_linked', repo: 'acme/shop-api' });
    expect(chatBanner(waiting('offline'), me)).toEqual({ kind: 'waiting', offlineSince: '2026-10-16T18:04:00.000Z' });
    // Someone else's agent waiting is their banner, not yours.
    expect(chatBanner(waiting('offline', 'leo'), me)).toEqual({ kind: 'none' });
  });

  it('shows ready to the reviewer as theirs to approve, and to the author as waiting for the reviewer', () => {
    const ready = { phase: 'ready' as const, round: 2, points: [point({ status: 'resolved' }), point({ number: 2, status: 'resolved' })] };
    expect(chatBanner(view({ ...ready, viewer: { role: 'reviewer', attention: 'none', failure: null } }), me)).toEqual({ kind: 'ready_reviewer', rounds: 2, resolved: 2 });
    expect(chatBanner(view({ ...ready, viewer: { role: 'author', attention: 'none', failure: null } }), me)).toEqual({ kind: 'ready_author', reviewer: 'leo', rounds: 2, resolved: 2 });
    expect(chatBanner(view({ ...ready, viewer: { role: null, attention: 'none', failure: null } }), me)).toEqual({ kind: 'none' });
  });

  it('puts an escalation before a failure, a failure before waiting, waiting before ready, and shows nothing on a closed PR', () => {
    const everything = view({
      phase: 'ready',
      points: [escalated()],
      viewer: { role: 'author', attention: 'failed', failure: 'agent' },
      activity: { kind: 'agent_waiting', who: 'maya', why: 'offline', offlineSince: null },
    });
    expect(chatBanner(everything, me).kind).toBe('escalated');
    expect(chatBanner({ ...everything, points: [] }, me).kind).toBe('failed_job');
    expect(chatBanner({ ...everything, points: [], viewer: { role: 'author', attention: 'none', failure: null } }, me).kind).toBe('waiting');
    expect(chatBanner({ ...everything, closed: true }, me).kind).toBe('none');
  });
});

describe('escalationNote', () => {
  it('names the categories, a disagreement, or the round limit', () => {
    expect(escalationNote([escalated(), escalated({ number: 2, category: 'bug' })], 3)).toBe('Security and bug points always go to a person.');
    expect(escalationNote([escalated({ escalationReason: 'disagreement' })], 3)).toBe("The agents don't agree.");
    expect(escalationNote([escalated({ escalationReason: 'round_limit' })], 3)).toBe('The agents used all 3 rounds.');
    expect(escalationNote([escalated(), escalated({ number: 2, escalationReason: 'disagreement' })], 3)).toBe('These points need a person.');
  });
});
```

Create `apps/web/src/lib/snippet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { snippetLines, syntaxTokens } from './snippet';

describe('snippetLines', () => {
  it("numbers the lines from where the snippet starts, and highlights the point's line", () => {
    const lines = snippetLines({ line: 48, snippet: { startLine: 43, lines: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } });
    expect(lines.map((l) => l.n)).toEqual([43, 44, 45, 46, 47, 48, 49]);
    expect(lines.filter((l) => l.highlighted)).toEqual([{ n: 48, text: 'f', highlighted: true }]);
  });

  it('highlights nothing for a point about the whole file, and has no lines without a snippet', () => {
    expect(snippetLines({ line: null, snippet: { startLine: 1, lines: ['a'] } })).toEqual([{ n: 1, text: 'a', highlighted: false }]);
    expect(snippetLines({ line: 3, snippet: null })).toEqual([]);
  });
});

describe('syntaxTokens', () => {
  it('colours keywords, strings, numbers and comments, and leaves the rest plain', () => {
    expect(syntaxTokens('const n = "25"; // page size')).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: ' n = ', kind: 'plain' },
      { text: '"25"', kind: 'string' },
      { text: '; ', kind: 'plain' },
      { text: '// page size', kind: 'comment' },
    ]);
    expect(syntaxTokens('  return 25;')).toEqual([{ text: '  ', kind: 'plain' }, { text: 'return', kind: 'keyword' }, { text: ' ', kind: 'plain' }, { text: '25', kind: 'number' }, { text: ';', kind: 'plain' }]);
    expect(syntaxTokens('')).toEqual([]);
  });
});
```

Replace `apps/web/src/lib/time.test.ts` with (a timeline item's time, and the clock the inbox rows read):

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { itemTime, rowTime, useNow } from './time';

// Local times, so the test reads the same in every time zone.
const now = new Date(2026, 9, 15, 18, 30); // Thursday 15 October 2026, 18:30
const at = (day: number, hour: number, minute: number, second = 0) => new Date(2026, 9, day, hour, minute, second).toISOString();

describe('rowTime (the time on an inbox row)', () => {
  it('says "now" for the last minute', () => {
    expect(rowTime(at(15, 18, 29, 30), now)).toBe('now');
  });

  it('shows the clock time earlier today', () => {
    expect(rowTime(at(15, 9, 5), now)).toBe('09:05');
    expect(rowTime(at(15, 16, 40), now)).toBe('16:40');
  });

  it('says "Yesterday", then the weekday for the last week, then the date', () => {
    expect(rowTime(at(14, 23, 59), now)).toBe('Yesterday');
    expect(rowTime(at(12, 10, 0), now)).toBe('Mon');
    expect(rowTime(at(3, 10, 0), now)).toBe('Oct 3');
  });
});

describe('itemTime (the time beside a timeline item)', () => {
  it('shows the clock time today, and the day before it for older items', () => {
    expect(itemTime(at(15, 16, 20), now)).toBe('16:20');
    expect(itemTime(at(14, 11, 18), now)).toBe('Yesterday 11:18');
    expect(itemTime(at(12, 9, 2), now)).toBe('Mon 09:02');
    expect(itemTime(at(3, 9, 2), now)).toBe('Oct 3 09:02');
  });
});

describe('useNow (the clock the inbox rows read)', () => {
  it('moves on every minute, so a row that said "now" says its time a minute later', () => {
    vi.useFakeTimers({ now });
    try {
      const { result } = renderHook(() => useNow());
      expect(rowTime(now.toISOString(), result.current)).toBe('now');
      act(() => vi.advanceTimersByTime(60_000));
      expect(rowTime(now.toISOString(), result.current)).toBe('18:30');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w apps/web -- src/lib`
Expected: FAIL: `Failed to resolve import "./timeline"`, `"./banner"` and `"./snippet"`, and `itemTime`/`useNow` aren't functions yet.

- [ ] **Step 3: The feed, the banner, the snippet, and time**

Create `apps/web/src/lib/timeline.ts`:

```ts
import type { PointView, Severity, TimelineItem } from '@nitpilot/protocol';

/** What a system line starts with (handoff §2 "Timeline"): a dot, ✓ for ready or merged, a ring for waiting, the red diamond for an escalation. */
export type Glyph = 'dot' | 'check' | 'ring' | 'diamond';

/** One row of the chat's feed. A point's card collects its thread: the replies and decisions about it. */
export type TimelineRow =
  | { kind: 'system'; item: TimelineItem; glyph: Glyph }
  | { kind: 'summary'; item: TimelineItem }
  | { kind: 'human'; item: TimelineItem }
  | { kind: 'point'; point: PointView; thread: TimelineItem[] };

/**
 * The feed, in order (handoff §2): each point's card sits where it was raised, holding every later item about it
 * (agents' replies and decisions, people's replies in its GitHub thread). When the item that raised it is on an
 * older page that isn't loaded, the card sits where its thread starts.
 */
export function timelineRows(items: TimelineItem[], points: PointView[]): TimelineRow[] {
  const byNumber = new Map(points.map((p) => [p.number, p]));
  const threads = new Map<number, TimelineItem[]>();
  for (const item of items) {
    if (item.pointNumber === null || item.kind === 'point_raised' || !byNumber.has(item.pointNumber)) continue;
    threads.set(item.pointNumber, [...(threads.get(item.pointNumber) ?? []), item]);
  }
  const placed = new Set<number>();
  const rows: TimelineRow[] = [];
  for (const item of items) {
    const point = item.pointNumber === null ? undefined : byNumber.get(item.pointNumber);
    if (point) {
      if (!placed.has(point.number)) rows.push({ kind: 'point', point, thread: threads.get(point.number) ?? [] });
      placed.add(point.number);
    } else if (item.kind === 'system') {
      rows.push({ kind: 'system', item, glyph: systemGlyph(item.body) });
    } else if (item.kind === 'job_summary') {
      rows.push({ kind: 'summary', item });
    } else {
      rows.push({ kind: 'human', item });
    }
  }
  return rows;
}

/** The glyph for a system line, from what the engine says (apps/server/src/engine: "Ready for approval", "… a human decision", "… is waiting"). */
export function systemGlyph(body: string): Glyph {
  if (/a human decision/.test(body)) return 'diamond';
  if (/^(Ready for approval|Merged)$|approved on GitHub$|resolved on GitHub$/.test(body)) return 'check';
  if (/is waiting|^Waiting for|offline/.test(body)) return 'ring';
  return 'dot';
}

const SEVERITIES: Severity[] = ['blocker', 'major', 'minor', 'nit'];

/** A review summary's counts, "1 major · 1 minor · 1 nit", from its `data.counts`; empty when it raised nothing. */
export function severityCounts(data: TimelineItem['data']): string {
  const counts = (data?.counts ?? {}) as Partial<Record<Severity, number>>;
  return SEVERITIES.filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ');
}

/** Text cut where it names a commit (7 to 40 hex characters), so the hash can be set in mono (handoff §2). */
export function withCommitHashes(text: string): { text: string; hash: boolean }[] {
  return text
    .split(/\b([0-9a-f]{7,40})\b/)
    .map((part, i) => ({ text: part, hash: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}
```

Create `apps/web/src/lib/banner.ts`:

```ts
import type { ChatView, PointView, WebMe } from '@nitpilot/protocol';

/** The one banner under the chat's header (handoff §2 "Banners", §10 "Edge states"). */
export type Banner =
  | { kind: 'github_expired' }
  | { kind: 'escalated'; points: PointView[]; note: string }
  | { kind: 'failed_job' }
  | { kind: 'failed_post' }
  | { kind: 'cap' }
  | { kind: 'repo_not_linked'; repo: string }
  | { kind: 'waiting'; offlineSince: string | null }
  | { kind: 'ready_reviewer'; rounds: number; resolved: number }
  | { kind: 'ready_author'; reviewer: string | null; rounds: number; resolved: number }
  | { kind: 'none' };

/**
 * Which banner a chat shows the person reading it, most urgent first: a GitHub sign-in that expired (nothing can
 * be done as you until it's renewed), an escalation, your failed job or post, why your agent can't start, then
 * ready. A closed PR shows none.
 */
export function chatBanner(view: ChatView, me: WebMe): Banner {
  if (view.closed) return { kind: 'none' };
  if (me.githubAuth === 'needs_reauth') return { kind: 'github_expired' };
  const escalated = view.points.filter((p) => p.status === 'escalated');
  if (escalated.length > 0) return { kind: 'escalated', points: escalated, note: escalationNote(escalated, view.maxRounds) };
  if (view.viewer.attention === 'failed') return { kind: view.viewer.failure === 'github_post' ? 'failed_post' : 'failed_job' };
  const a = view.activity;
  if (a.kind === 'agent_waiting' && a.who === me.login) {
    if (a.why === 'cap_reached') return { kind: 'cap' };
    if (a.why === 'repo_not_linked') return { kind: 'repo_not_linked', repo: view.repo };
    return { kind: 'waiting', offlineSince: a.offlineSince };
  }
  if (view.phase === 'ready' && view.viewer.role !== null) {
    const rounds = view.round;
    const resolved = view.points.filter((p) => p.status === 'resolved').length;
    if (view.viewer.role === 'reviewer') return { kind: 'ready_reviewer', rounds, resolved };
    const reviewers = view.participants.filter((p) => p.role === 'reviewer');
    const reviewer = (reviewers.find((p) => p.requested) ?? reviewers[0])?.login ?? null;
    return { kind: 'ready_author', reviewer, rounds, resolved };
  }
  return { kind: 'none' };
}

/** Why the points went to a person, in one line: "Security points always go to a person." */
export function escalationNote(points: PointView[], maxRounds: number): string {
  const reasons = new Set(points.map((p) => p.escalationReason));
  if (reasons.size === 1 && reasons.has('category')) {
    const categories = [...new Set(points.map((p) => p.category))];
    const named = categories.map((c, i) => (i === 0 ? c[0]!.toUpperCase() + c.slice(1) : c)).join(' and ');
    return `${named} points always go to a person.`;
  }
  if (reasons.size === 1 && reasons.has('disagreement')) return "The agents don't agree.";
  if (reasons.size === 1 && reasons.has('round_limit')) return `The agents used all ${maxRounds} rounds.`;
  return 'These points need a person.';
}
```

Create `apps/web/src/lib/snippet.ts`:

```ts
import type { PointView } from '@nitpilot/protocol';

/** One line of a point's code snippet: its number, its text, and whether the point is about it. */
export type SnippetLine = { n: number; text: string; highlighted: boolean };

/** The lines of a point's snippet, numbered from where it starts, with the point's own line highlighted (handoff §3). */
export function snippetLines(point: Pick<PointView, 'snippet' | 'line'>): SnippetLine[] {
  const snippet = point.snippet;
  if (!snippet) return [];
  return snippet.lines.map((text, i) => {
    const n = snippet.startLine + i;
    return { n, text, highlighted: n === point.line };
  });
}

export type TokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number';
export type Token = { text: string; kind: TokenKind };

/** Comments, strings, a few common keywords, and numbers: enough for the light colouring the handoff asks for. */
const TOKENS = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(export|function|const|let|var|return|await|async|new|if|else|for|while|import|from|throw|null|undefined|true|false|class|def|fn|type|interface)\b|(\b\d+(?:\.\d+)?\b)/g;

/**
 * A line of code cut into coloured pieces (handoff §3 "Light syntax colors": keywords acc-text, strings ok-fg,
 * numbers warn-fg, comments fg3). Any language: it only knows what most of them share.
 */
export function syntaxTokens(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKENS)) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), kind: 'plain' });
    tokens.push({ text: m[0], kind: m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'keyword' : 'number' });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), kind: 'plain' });
  return tokens;
}
```

Create `apps/web/src/lib/names.ts`:

```ts
/** How the chat names a person's agent (handoff "Who did what"): "Your agent" for yours, "leo's agent" for theirs. */
export function agentName(login: string, yourLogin: string): string {
  return login === yourLogin ? 'Your agent' : `${login}'s agent`;
}

/** "You", or the person's GitHub login. */
export function personName(login: string, yourLogin: string): string {
  return login === yourLogin ? 'You' : login;
}
```

Replace `apps/web/src/lib/time.ts` with:

```ts
import { useEffect, useState } from 'react';

const DAY_MS = 86_400_000;

/**
 * When a row last changed, the way the handoff writes it: "now", "16:40" today, "Yesterday", "Mon" within the
 * last week, then "Oct 3". In the reader's own time zone.
 */
export function rowTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (now.getTime() - at.getTime() < 60_000) return 'now';
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString('en-US', { weekday: 'short' });
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * When a timeline item happened, the way the chat writes it: "16:20" today, "Yesterday 11:18", then
 * "Mon 09:02" within the last week, then "Oct 3 09:02". In the reader's own time zone.
 */
export function itemTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return clock;
  if (days === 1) return `Yesterday ${clock}`;
  if (days < 7) return `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`;
  return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`;
}

/** The time now, moving on every minute, so times like "now" and "16:40" stay true while the page is open. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -w apps/web -- src/lib`
Expected: PASS: timeline 5, banner 7, snippet 3, time 5, and W2's lib tests unchanged.

- [ ] **Step 5: Write the failing tests for the socket and the cache**

A pretend browser socket. Create `apps/web/src/test/socket.ts`:

```ts
import type { ServerToWeb, WebToServer } from '@nitpilot/protocol';
import type { SocketLike } from '../live/socket';

/** A pretend browser WebSocket: the test opens it, sends it server messages, and drops it. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: WebToServer[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as WebToServer);
  }

  close(): void {
    this.readyState = 3;
  }

  /** The server accepted the socket. */
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(msg: ServerToWeb): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(msg) }));
  }

  /** The connection went away (1006 is what a browser reports for a dropped one). */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code }));
  }
}

/** Every socket a page opened, newest last; pass `open` where a socket factory is wanted. */
export function fakeSockets() {
  const all: FakeSocket[] = [];
  return {
    all,
    open: (url: string): FakeSocket => {
      const socket = new FakeSocket(url);
      all.push(socket);
      return socket;
    },
    last: (): FakeSocket => {
      const socket = all.at(-1);
      if (!socket) throw new Error('no socket was opened');
      return socket;
    },
  };
}
```

Create `apps/web/src/live/socket.test.ts`:

```ts
import type { ServerToWeb } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { item } from '../test/chat';
import { fakeSockets } from '../test/socket';
import { LiveSocket, liveUrl } from './socket';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function start() {
  const sockets = fakeSockets();
  const received: ServerToWeb[] = [];
  const onSignedOut = vi.fn();
  // No jitter: random() 0.5 makes each wait exactly the backoff.
  const live = new LiveSocket({ url: 'ws://app/ws/web', onMessage: (m) => received.push(m), onSignedOut, open: sockets.open, backoff: { startMs: 1_000, maxMs: 30_000, random: () => 0.5 } });
  live.start();
  return { live, sockets, received, onSignedOut };
}

const items = (chatId: string, seqs: number[]): ServerToWeb => ({ v: 1, t: 'chat.items', d: { chatId, items: seqs.map((s) => item(s)), lastSeq: seqs.at(-1)! } });

describe('LiveSocket (spec §10 "Resuming without gaps")', () => {
  it('subscribes once open, and hands every message on', () => {
    const { live, sockets, received } = start();
    live.subscribe('chat_1', 4);
    sockets.last().open();
    expect(sockets.last().sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: 4 } }]);
    sockets.last().receive(items('chat_1', [5]));
    expect(received.map((m) => m.t)).toEqual(['chat.items']);
  });

  it('reconnects after a drop with a growing wait, and subscribes again from the newest item it has', () => {
    const { live, sockets } = start();
    sockets.last().open();
    live.subscribe('chat_1', 4);
    sockets.last().receive(items('chat_1', [5, 6]));
    sockets.last().drop();
    vi.advanceTimersByTime(999);
    expect(sockets.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets.all).toHaveLength(2);
    // That one never opens: the next wait is twice as long.
    sockets.last().drop();
    vi.advanceTimersByTime(2_000);
    expect(sockets.all).toHaveLength(3);
    sockets.last().open();
    expect(sockets.last().sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: 6 } }]);
    // Opening reset the wait to 1 s.
    sockets.last().drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets.all).toHaveLength(4);
  });

  it('stops for good when the session ended (4401), and when stopped', () => {
    const { live, sockets, onSignedOut } = start();
    sockets.last().open();
    sockets.last().drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(sockets.all).toHaveLength(1);
    live.stop();
  });

  it('forgets a chat the server refused, and asks again for one GitHub could not check', () => {
    const { live, sockets } = start();
    sockets.last().open();
    live.subscribe('gone', 0);
    live.subscribe('later', 0);
    sockets.last().receive({ v: 1, t: 'chat.error', d: { chatId: 'gone', code: 'not_found' } });
    sockets.last().receive({ v: 1, t: 'chat.error', d: { chatId: 'later', code: 'unavailable' } });
    sockets.last().sent.length = 0;
    vi.advanceTimersByTime(5_000);
    expect(sockets.last().sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'later', afterSeq: 0 } }]);
    sockets.last().drop();
    vi.advanceTimersByTime(1_000);
    sockets.last().open();
    expect(sockets.last().sent.map((m) => m.d.chatId)).toEqual(['later']);
  });

  it('unsubscribes', () => {
    const { live, sockets } = start();
    sockets.last().open();
    live.subscribe('chat_1', 0);
    live.unsubscribe('chat_1');
    expect(sockets.last().sent.at(-1)).toEqual({ v: 1, t: 'chat.unsubscribe', d: { chatId: 'chat_1' } });
  });
});

describe('liveUrl', () => {
  it('is /ws/web on the same address, over wss: for an https: page', () => {
    expect(liveUrl({ protocol: 'https:', host: 'nitpilot.dev' })).toBe('wss://nitpilot.dev/ws/web');
    expect(liveUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws/web');
  });
});
```

Create `apps/web/src/live/apply.test.ts` (Review Focus 1: an overlapping and an out-of-order batch merge to one ordered list):

```ts
import type { ChatResponse, InboxRow, WebMe } from '@nitpilot/protocol';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { chatResponse, chatView, item } from '../test/chat';
import { applyServerMessage, mergeItems } from './apply';
import { progressKey } from './progress';

describe('mergeItems (Review Focus 1)', () => {
  it('keeps each seq once, in order, whatever order the batches come in', () => {
    const merged = mergeItems([item(1), item(2), item(3)], [item(5), item(3), item(4)]);
    expect(merged.map((i) => i.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('applyServerMessage', () => {
  const key = ['chat', 'acme', 'shop-api', '142'];
  function cache() {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ChatResponse>(key, chatResponse({ items: [item(1), item(2)] }));
    return queryClient;
  }

  it("adds a chat's new items to the chat opened by its address", () => {
    const queryClient = cache();
    applyServerMessage(queryClient, { v: 1, t: 'chat.items', d: { chatId: 'chat_142', items: [item(2), item(3)], lastSeq: 3 } });
    applyServerMessage(queryClient, { v: 1, t: 'chat.items', d: { chatId: 'another_chat', items: [item(9)], lastSeq: 9 } });
    expect(queryClient.getQueryData<ChatResponse>(key)!.items.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it('replaces the view on chat.state, and clears the progress line once nobody is working', () => {
    const queryClient = cache();
    applyServerMessage(queryClient, { v: 1, t: 'job.progress', d: { chatId: 'chat_142', who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading' } });
    expect(queryClient.getQueryData(progressKey('chat_142'))).toMatchObject({ who: 'leo' });
    applyServerMessage(queryClient, { v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ phase: 'ready', lastSeq: 2 }) } });
    expect(queryClient.getQueryData<ChatResponse>(key)!.view.phase).toBe('ready');
    expect(queryClient.getQueryData(progressKey('chat_142'))).toBeNull();
  });

  it("replaces a chat's inbox rows, and who you are", () => {
    const queryClient = cache();
    const row = (chatId: string, title: string) => ({ chatId, title }) as InboxRow;
    queryClient.setQueryData<InboxRow[]>(['inbox'], [row('a', 'old'), row('b', 'other')]);
    applyServerMessage(queryClient, { v: 1, t: 'inbox.upsert', d: { chatId: 'a', rows: [row('a', 'new')] } });
    expect(queryClient.getQueryData<InboxRow[]>(['inbox'])!.map((r) => r.title)).toEqual(['other', 'new']);
    applyServerMessage(queryClient, { v: 1, t: 'inbox.upsert', d: { chatId: 'b', rows: [] } });
    expect(queryClient.getQueryData<InboxRow[]>(['inbox'])!.map((r) => r.title)).toEqual(['new']);
    const me = { login: 'maya', agentOnline: true } as WebMe;
    applyServerMessage(queryClient, { v: 1, t: 'me.update', d: { me } });
    expect(queryClient.getQueryData(['me'])).toBe(me);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npm test -w apps/web -- src/live`
Expected: FAIL: `Failed to resolve import "./socket"` and `"./apply"`.

- [ ] **Step 7: The tab's socket, and what it writes into the cache**

Create `apps/web/src/live/socket.ts`:

```ts
import { ServerToWeb, WEB_WS_PATH, type WebToServer } from '@nitpilot/protocol';

/** The part of a browser WebSocket this file uses; tests pass a fake. */
export type SocketLike = {
  /** 1 once open, as on a browser WebSocket. */
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
};

export type LiveSocketOptions = {
  url: string;
  onMessage(msg: ServerToWeb): void;
  /** The server closed with 4401: the session ended. */
  onSignedOut?(): void;
  open?: (url: string) => SocketLike;
  /** Reconnect waits: 1 s, doubling up to 30 s, each nudged up to 20% either way (docs/why/websockets.md). */
  backoff?: { startMs: number; maxMs: number; random: () => number };
};

/** How long to wait before asking again for a chat the server couldn't check (GitHub didn't answer). */
const RESUBSCRIBE_MS = 5_000;

/** Where this page's socket goes: `/ws/web` on the same address, `wss:` when the page is `https:`. */
export function liveUrl(location: { protocol: string; host: string } = window.location): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${WEB_WS_PATH}`;
}

/**
 * The tab's one `/ws/web` socket (spec §10). It remembers which chats are open and the newest item each one has,
 * and after any drop it reconnects with a growing wait and subscribes to them again from there.
 */
export class LiveSocket {
  private ws: SocketLike | null = null;
  /** Open chats → the newest seq this tab has. */
  private readonly chats = new Map<string, number>();
  private readonly backoff: { startMs: number; maxMs: number; random: () => number };
  private delayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly opts: LiveSocketOptions) {
    this.backoff = opts.backoff ?? { startMs: 1_000, maxMs: 30_000, random: Math.random };
    this.delayMs = this.backoff.startMs;
  }

  start(): void {
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  /** Follow a chat from `afterSeq` on. Calling it again for the same chat never goes back. */
  subscribe(chatId: string, afterSeq: number): void {
    this.chats.set(chatId, Math.max(afterSeq, this.chats.get(chatId) ?? 0));
    this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq: this.chats.get(chatId)! } });
  }

  unsubscribe(chatId: string): void {
    this.chats.delete(chatId);
    this.send({ v: 1, t: 'chat.unsubscribe', d: { chatId } });
  }

  private connect(): void {
    const ws = (this.opts.open ?? ((url) => new WebSocket(url)))(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      this.delayMs = this.backoff.startMs;
      for (const [chatId, afterSeq] of this.chats) this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq } });
    };
    ws.onmessage = (event) => this.receive(event.data);
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.running) return;
      if (event.code === 4401) return this.opts.onSignedOut?.();
      this.reconnectLater();
    };
  }

  private receive(data: unknown): void {
    let parsed: ReturnType<typeof ServerToWeb.safeParse>;
    try {
      parsed = ServerToWeb.safeParse(JSON.parse(String(data)));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const msg = parsed.data;
    if (msg.t === 'chat.items' && this.chats.has(msg.d.chatId)) this.chats.set(msg.d.chatId, Math.max(this.chats.get(msg.d.chatId)!, msg.d.lastSeq));
    if (msg.t === 'chat.error') this.dropped(msg.d.chatId, msg.d.code);
    this.opts.onMessage(msg);
  }

  /** The server dropped this subscription. A hiccup (GitHub didn't answer) is worth asking again for; a no isn't. */
  private dropped(chatId: string, code: 'not_found' | 'reauth' | 'unavailable'): void {
    if (code !== 'unavailable') {
      this.chats.delete(chatId);
      return;
    }
    setTimeout(() => {
      const afterSeq = this.chats.get(chatId);
      if (afterSeq !== undefined) this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq } });
    }, RESUBSCRIBE_MS);
  }

  private reconnectLater(): void {
    const jitter = 1 + (this.backoff.random() * 2 - 1) * 0.2;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.running) this.connect();
    }, this.delayMs * jitter);
    this.delayMs = Math.min(this.delayMs * 2, this.backoff.maxMs);
  }

  private send(msg: WebToServer): void {
    // Not open yet: onopen subscribes to every open chat, this one included.
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
```

Create `apps/web/src/live/progress.ts`:

```ts
import type { ServerToWeb } from '@nitpilot/protocol';
import { useQuery } from '@tanstack/react-query';

/** What an agent is doing right now, from its CLI's `job.progress` (spec §10). Never stored: gone once the work is. */
export type Progress = Extract<ServerToWeb, { t: 'job.progress' }>['d'];

/** Where a chat's progress line lives in the data cache. Only `/ws/web` writes it (live/apply.ts). */
export const progressKey = (chatId: string) => ['progress', chatId] as const;

/** The chat's live progress line, or null when no agent is at work. */
export function useProgress(chatId: string): Progress | null {
  const { data } = useQuery({ queryKey: progressKey(chatId), queryFn: () => null, enabled: false, staleTime: Infinity });
  return data ?? null;
}
```

Create `apps/web/src/live/apply.ts`:

```ts
import type { ChatResponse, InboxRow, ServerToWeb, TimelineItem } from '@nitpilot/protocol';
import type { QueryClient } from '@tanstack/react-query';
import { progressKey } from './progress';

/**
 * Two lists of timeline items as one, each `seq` once, in order (spec §10 "Resuming without gaps": after a
 * reconnect the server may send an item the tab already has).
 */
export function mergeItems(existing: TimelineItem[], incoming: TimelineItem[]): TimelineItem[] {
  const bySeq = new Map<number, TimelineItem>();
  for (const item of [...existing, ...incoming]) bySeq.set(item.seq, item);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Write a message from `/ws/web` into the data cache, where the screens read it: a chat's items and view, the
 * progress line, the inbox rows, who you are. Nothing else changes the cache but REST answers.
 */
export function applyServerMessage(queryClient: QueryClient, msg: ServerToWeb): void {
  switch (msg.t) {
    case 'chat.items':
      updateChat(queryClient, msg.d.chatId, (chat) => ({ ...chat, items: mergeItems(chat.items, msg.d.items) }));
      return;
    case 'chat.state':
      updateChat(queryClient, msg.d.chatId, (chat) => ({ ...chat, view: msg.d.view }));
      // Nobody's at work any more: the progress line goes.
      if (msg.d.view.activity.kind !== 'agent_working') queryClient.setQueryData(progressKey(msg.d.chatId), null);
      return;
    case 'chat.error':
      // Ask again over REST, which says what's wrong: a 404 ("Nothing here") or a 401 (sign in with GitHub again).
      void queryClient.invalidateQueries({ queryKey: ['chat'], predicate: (q) => (q.state.data as ChatResponse | undefined)?.view.id === msg.d.chatId });
      return;
    case 'job.progress':
      queryClient.setQueryData(progressKey(msg.d.chatId), msg.d);
      return;
    case 'inbox.upsert':
      queryClient.setQueryData<InboxRow[]>(['inbox'], (rows) => rows && [...rows.filter((r) => r.chatId !== msg.d.chatId), ...msg.d.rows]);
      return;
    case 'me.update':
      queryClient.setQueryData(['me'], msg.d.me);
      return;
  }
}

/** The cached chat whose view has this id, whatever address it was opened by. */
function updateChat(queryClient: QueryClient, chatId: string, update: (chat: ChatResponse) => ChatResponse): void {
  queryClient.setQueriesData<ChatResponse>({ queryKey: ['chat'] }, (chat) => (chat && chat.view.id === chatId ? update(chat) : chat));
}
```

- [ ] **Step 8: Run them to see them pass**

Run: `npm test -w apps/web -- src/live`
Expected: PASS, 6 and 4 tests.

- [ ] **Step 9: ↑/↓ belong to the page beside the inbox (W2 carry-forward)**

W2's inbox takes ↑/↓ on the whole window, which would stop the chat's feed from scrolling with the arrow keys. Replace `apps/web/src/lib/keys.test.tsx` with (the harness gains a `<main>` holding a focusable feed, and one test):

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useInboxKeys } from './keys';

const ROWS = [{ chatId: 'a' }, { chatId: 'b' }, { chatId: 'c' }];

/** A search box and the cursor, driven by the inbox keys. */
function Harness({ open = vi.fn(), escape = vi.fn() }: { open?: (id: string) => void; escape?: () => void }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useInboxKeys({ rows: ROWS, cursor, setCursor, open, focusSearch: () => search.current?.focus(), escape });
  return (
    <>
      <input ref={search} aria-label="Search pull requests" />
      <output aria-label="cursor">{cursor ?? 'none'}</output>
      <main>
        <div tabIndex={0} aria-label="feed" />
      </main>
    </>
  );
}

const cursor = () => screen.getByLabelText('cursor').textContent;

describe('useInboxKeys (handoff "Keyboard")', () => {
  it('moves the cursor with j/k and the arrow keys, and stops at the ends', async () => {
    render(<Harness />);
    await userEvent.keyboard('j');
    expect(cursor()).toBe('a');
    await userEvent.keyboard('j{ArrowDown}j');
    expect(cursor()).toBe('c');
    await userEvent.keyboard('k{ArrowUp}k');
    expect(cursor()).toBe('a');
  });

  it('opens the row under the cursor with Enter, and nothing without a cursor', async () => {
    const open = vi.fn();
    render(<Harness open={open} />);
    await userEvent.keyboard('{Enter}');
    expect(open).not.toHaveBeenCalled();
    await userEvent.keyboard('jj{Enter}');
    expect(open).toHaveBeenCalledWith('b');
  });

  it('focuses the search box with /, and ignores the keys while you type in it', async () => {
    render(<Harness />);
    await userEvent.keyboard('/');
    expect(screen.getByLabelText('Search pull requests')).toHaveFocus();
    await userEvent.keyboard('j');
    expect(cursor()).toBe('none');
    expect(screen.getByLabelText('Search pull requests')).toHaveValue('j');
  });

  it('leaves the search box on Esc, and calls escape when not typing', async () => {
    const escape = vi.fn();
    render(<Harness escape={escape} />);
    await userEvent.keyboard('/');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByLabelText('Search pull requests')).not.toHaveFocus();
    expect(escape).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(escape).toHaveBeenCalledOnce();
  });

  it('leaves ↑/↓ to the page beside the inbox, so its feed scrolls, while j/k still move the cursor', async () => {
    render(<Harness />);
    const feed = screen.getByLabelText('feed');
    feed.focus();
    // fireEvent answers false when the key's default action (scrolling) was cancelled.
    expect(fireEvent.keyDown(feed, { key: 'ArrowDown' })).toBe(true);
    expect(cursor()).toBe('none');
    await userEvent.keyboard('j');
    expect(cursor()).toBe('a');
  });

  it('leaves shortcuts with a modifier (⌘J, Ctrl+K) to the browser', async () => {
    render(<Harness />);
    await userEvent.keyboard('{Meta>}j{/Meta}{Control>}k{/Control}');
    expect(cursor()).toBe('none');
  });
});
```

Run: `npm test -w apps/web -- src/lib/keys.test.tsx`
Expected: FAIL, 1 test: `expected false to be true` (the arrow's scrolling was cancelled).

In `apps/web/src/lib/keys.ts`, in `useInboxKeys`'s handler, add before `const at = …`:

```ts
    // ↑/↓ inside the page beside the inbox scroll that page (the chat's feed); j/k still move the cursor.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target instanceof Element && e.target.closest('main')) return;
```

Run: `npm test -w apps/web -- src/lib/keys.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 10: Write the failing screen tests**

Create `apps/web/src/routes/Chat/PointCard.test.tsx`:

```tsx
import type { PointView, TimelineItem } from '@nitpilot/protocol';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { item, point } from '../../test/chat';
import { PointCard } from './PointCard';

const people = new Map([
  ['1001', { avatarUrl: 'https://avatars.githubusercontent.com/u/1001' }],
  ['1002', { avatarUrl: 'https://avatars.githubusercontent.com/u/1002' }],
]);
const maya = { githubId: '1001', login: 'maya' };
const leo = { githubId: '1002', login: 'leo' };

function card(p: PointView, thread: TimelineItem[] = []) {
  return render(<PointCard point={p} thread={thread} you="maya" people={people} repoUrl="https://github.com/acme/shop-api" />);
}

describe('PointCard (handoff §3)', () => {
  it('shows severity, category, where, what, and the snippet with its line highlighted', () => {
    card(point());
    const article = screen.getByRole('article', { name: 'P1, Major bug point, Open: parseCursor throws on an empty cursor' });
    expect(within(article).getByText('Major')).toBeInTheDocument();
    expect(within(article).getByText('bug')).toBeInTheDocument();
    expect(within(article).getByRole('link', { name: 'src/orders/list.ts:48' })).toHaveAttribute('href', 'https://github.com/acme/shop-api/blob/abc1234/src/orders/list.ts#L48');
    expect(within(article).getByRole('heading', { name: 'parseCursor throws on an empty cursor' })).toBeInTheDocument();
    expect(within(article).getByText('L47–49')).toBeInTheDocument();
    const highlighted = article.querySelectorAll('[data-highlighted]');
    expect([...highlighted].map((l) => l.textContent)).toEqual(['48  const [ts, id] = raw.split(":");']);
  });

  it('says every status in words, with a glyph', () => {
    for (const [status, word] of [['open', 'Open'], ['addressed', 'Addressed'], ['escalated', 'Escalated']] as const) {
      const { unmount } = card(point({ status }));
      expect(screen.getByRole('article', { name: new RegExp(`${word}:`) })).toHaveTextContent(word);
      unmount();
    }
  });

  it('starts collapsed when resolved, with how it ended, and opens and closes on click', async () => {
    const thread = [item(6, { kind: 'point_reply', author: maya, pointNumber: 1, body: 'Return null for empty cursors.', data: { resolution: 'fixed', commit: 'a1b2c3d4e5f6' } })];
    card(point({ status: 'resolved', authorResolution: 'fixed' }), thread);
    const line = screen.getByRole('button', { name: /P1, Major bug point, Resolved/ });
    expect(line).toHaveAttribute('aria-expanded', 'false');
    expect(line).toHaveTextContent('Fixed · a1b2c3d');
    await userEvent.click(line);
    expect(screen.getByRole('article')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse point' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows the thread: whose agent said what, the outcome, and the commit that fixed it', () => {
    const thread = [
      item(6, { kind: 'point_reply', author: maya, pointNumber: 1, body: 'Return null for empty cursors.', data: { resolution: 'fixed', commit: 'a1b2c3d4e5f6' } }),
      item(7, { kind: 'point_decision', author: leo, pointNumber: 1, body: 'Not yet: the test is missing.', data: { decision: 'keep_open' } }),
      item(8, { kind: 'human', author: leo, pointNumber: 1, body: 'Please add the test', data: { threadRootId: '900' } }),
    ];
    card(point(), thread);
    const replies = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(replies[0]).toHaveTextContent('Your agentFixed in a1b2c3d');
    expect(within(replies[0]!).getByRole('link', { name: 'a1b2c3d' })).toHaveAttribute('href', 'https://github.com/acme/shop-api/commit/a1b2c3d4e5f6');
    expect(replies[1]).toHaveTextContent("leo's agentKept open");
    expect(replies[2]).toHaveTextContent('leo');
    expect(replies[2]).toHaveTextContent('Please add the test');
  });

  it('has no snippet or file link for a point about the whole PR', () => {
    card(point({ path: null, line: null, url: null, snippet: null }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/^L\d/)).not.toBeInTheDocument();
  });
});
```

Create `apps/web/src/routes/Chat/Chat.test.tsx` (Review Focus 2: the reconnect state on a 401, "Nothing here" after the socket says access is gone):

```tsx
import type { ChatResponse, WebMe } from '@nitpilot/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatResponse, chatView, item, point } from '../../test/chat';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };
const maya = { githubId: '1001', login: 'maya' };
const leo = { githubId: '1002', login: 'leo' };
const PATH = '/c/acme/shop-api/142';

/** maya's PR in round 2: leo's agent reviewed it, raised two points, and one went to a person. */
const CHAT: ChatResponse = chatResponse({
  view: {
    phase: 'escalated',
    round: 2,
    points: [point({ status: 'escalated', escalationReason: 'category', category: 'security', severity: 'blocker', title: 'SQL built from input' }), point({ number: 2, severity: 'nit', title: 'Rename cursor' })],
    summaryUrl: 'https://github.com/acme/shop-api/pull/142#issuecomment-555',
  },
  items: [
    item(1, { body: 'Pull request opened by maya' }),
    item(2, { kind: 'job_summary', author: leo, body: 'Reviewed 6 files and raised 2 points.', data: { counts: { blocker: 1, nit: 1 } } }),
    item(3, { kind: 'point_raised', author: leo, pointNumber: 1 }),
    item(4, { kind: 'point_raised', author: leo, pointNumber: 2 }),
    item(5, { kind: 'human', author: maya, body: 'Keep the old endpoint working' }),
  ],
});

function serve(answer: () => Answer = () => [200, CHAT], extra: Record<string, () => Answer> = {}) {
  return fakeApi({
    'GET /api/me': (): Answer => [200, me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'GET /api/chats/acme/shop-api/142': answer,
    'GET /api/chats/chat_142/files': (): Answer => [200, { files: [{ path: 'src/orders/list.ts', oldPath: null, status: 'modified', adds: 12, dels: 3 }], adds: 12, dels: 3, truncated: false }],
    'POST /api/chats/chat_142/read': (): Answer => [204, null],
    ...extra,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Chat (handoff §2)', () => {
  it('shows the header, the banner, the feed and the details panel', async () => {
    fakeViewport(true);
    serve();
    renderApp(PATH);
    const chat = await screen.findByRole('region', { name: 'PR chat: Add cursor pagination to /orders' });
    expect(within(chat).getByRole('heading', { level: 1, name: 'Add cursor pagination to /orders' })).toBeInTheDocument();
    expect(chat).toHaveTextContent('Author');
    expect(chat).toHaveTextContent('acme/shop-api #142');
    expect(chat).toHaveTextContent('feature/cursor-pagination → main');
    expect(chat).toHaveTextContent('Round 2 of 3');
    expect(within(chat).getByRole('link', { name: /Open on GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/shop-api/pull/142');

    const alert = within(chat).getByRole('alert');
    expect(alert).toHaveTextContent('Needs a human decision');
    expect(alert).toHaveTextContent('Security points always go to a person.');
    expect(alert).toHaveTextContent('P1SQL built from input');

    expect(chat).toHaveTextContent('Pull request opened by maya');
    expect(chat).toHaveTextContent("leo's agent");
    expect(chat).toHaveTextContent('Reviewed 6 files and raised 2 points. 1 blocker · 1 nit');
    expect(within(chat).getByRole('article', { name: /P1, Blocker security point, Escalated/ })).toBeInTheDocument();
    expect(within(chat).getByRole('article', { name: /P2, Nit bug point, Open/ })).toBeInTheDocument();
    expect(chat).toHaveTextContent('Youto the agents');

    const details = screen.getByRole('complementary', { name: 'PR details' });
    expect(await within(details).findByText('src/orders/list.ts')).toBeInTheDocument();
    expect(details).toHaveTextContent('1 · +12 −3');
    expect(details).toHaveTextContent('leoReviewer');
    expect(details).toHaveTextContent('Always escalatesecurity');
    expect(within(details).getByRole('link', { name: /Summary comment on GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/shop-api/pull/142#issuecomment-555');
  });

  it('hides the details panel below 1180 px; above, the header toggles it', async () => {
    fakeViewport(1000);
    serve();
    const { unmount } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    expect(screen.queryByRole('complementary', { name: 'PR details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PR details' })).not.toBeInTheDocument();
    unmount();

    fakeViewport(1280);
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'PR details', pressed: true }));
    expect(screen.queryByRole('complementary', { name: 'PR details' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PR details', pressed: false }));
    expect(screen.getByRole('complementary', { name: 'PR details' })).toBeInTheDocument();
  });

  it('subscribes from its newest item and shows new items, state and progress as they arrive, without reloading', async () => {
    fakeViewport(true);
    serve();
    const { sockets } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    const socket = sockets.last();
    act(() => socket.open());
    expect(socket.sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_142', afterSeq: 5 } }]);

    act(() => socket.receive({ v: 1, t: 'job.progress', d: { chatId: 'chat_142', who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading src/orders/list.ts' } }));
    expect(await screen.findByText("leo's agent is reviewing…")).toBeInTheDocument();
    expect(screen.getByText('reading src/orders/list.ts')).toBeInTheDocument();

    act(() => socket.receive({ v: 1, t: 'chat.items', d: { chatId: 'chat_142', items: [item(6, { body: 'Round 2 started' })], lastSeq: 6 } }));
    expect(await screen.findByText('Round 2 started')).toBeInTheDocument();

    act(() => socket.receive({ v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ phase: 'ready', round: 2, lastSeq: 6 }) } }));
    expect(await screen.findByText("Waiting for leo's approval")).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText("leo's agent is reviewing…")).not.toBeInTheDocument();
  });

  it('says "Nothing here" for a chat that does not exist or you cannot see', async () => {
    serve(() => [404, { error: { code: 'not_found', message: 'No such chat.' } }]);
    renderApp(PATH);
    expect(await screen.findByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
  });

  it('asks you to reconnect GitHub when your sign-in expired (Review Focus 2)', async () => {
    serve(() => [401, { error: { code: 'reauth', message: 'Sign in with GitHub again to see this chat.' } }]);
    renderApp(PATH);
    expect(await screen.findByRole('heading', { name: 'Sign in with GitHub again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reconnect GitHub' })).toHaveAttribute('href', `/auth/github/login?next=${encodeURIComponent(PATH)}`);
  });

  it('asks the server again when the socket says you lost access, and shows "Nothing here"', async () => {
    let gone = false;
    serve(() => (gone ? [404, { error: { code: 'not_found', message: 'No such chat.' } }] : [200, CHAT]));
    const { sockets } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    gone = true;
    act(() => sockets.last().receive({ v: 1, t: 'chat.error', d: { chatId: 'chat_142', code: 'not_found' } }));
    expect(await screen.findByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
  });

  it('loads earlier items on request', async () => {
    serve(() => [200, chatResponse({ items: [item(201, { body: 'newer' })], hasOlder: true })], {
      'GET /api/chats/chat_142/messages': (): Answer => [200, { items: [item(200, { body: 'older' })], hasOlder: false }],
    });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier' }));
    expect(await screen.findByText('older')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load earlier' })).not.toBeInTheDocument();
  });

  it('marks the chat read up to its newest item, for someone in it', async () => {
    const fetch = serve();
    renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    await waitFor(() => expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith('/read') && init?.method === 'POST')).toBe(true), { timeout: 2_000 });
    const [, init] = fetch.mock.calls.find(([url]) => String(url).endsWith('/read'))!;
    expect(JSON.parse(String(init!.body))).toEqual({ seq: 5 });
  });

  it('has a way back to the inbox on a phone', async () => {
    fakeViewport(false);
    serve();
    renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    expect(screen.getByRole('link', { name: 'Back to inbox' })).toHaveAttribute('href', '/');
  });
});
```

Every screen test now runs with pretend sockets, and a test can pick any window width. Replace `apps/web/src/test/render.tsx` with:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppRoutes, makeQueryClient } from '../app';
import { SocketFactory } from '../live/LiveProvider';
import { fakeSockets } from './socket';

/** One answer: the status and the JSON body. */
export type Answer = [status: number, body: unknown];

/**
 * A pretend Nitpilot server for component tests: answers each request by its method and path ('GET /api/me').
 * A request it has no answer for gets the server's JSON 404. Returns the fetch mock, to check what was sent.
 */
export function fakeApi(routes: Record<string, () => Answer>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}`;
    const [status, body] = routes[key]?.() ?? [404, { error: { code: 'not_found', message: 'no such route' } }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/**
 * The app's routes at `path`, with a fresh data cache that doesn't wait between retries, and pretend sockets
 * for `/ws/web`. Also returns that cache and the sockets the page opened.
 */
export function renderApp(path = '/') {
  const queryClient = makeQueryClient({ retryDelay: 0 });
  const sockets = fakeSockets();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SocketFactory.Provider value={sockets.open}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </SocketFactory.Provider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, sockets };
}

/**
 * A stand-in for the browser's media queries, in the light theme: a window this many pixels wide, or `true` for
 * a wide desktop and `false` for a phone.
 */
export function fakeViewport(width: boolean | number) {
  const px = width === true ? 1440 : width === false ? 375 : width;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: px >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
```

Opening a chat now loads it, so the tests that open one answer for it. In `apps/web/src/routes/Inbox/Inbox.test.tsx`, import `chatRoutes` from `'../../test/chat'` and add `...chatRoutes(ROWS),` as the last entry of `serve`'s `fakeApi` routes. Replace `apps/web/src/routes/Shell/Shell.test.tsx` with:

```tsx
import type { WebMe } from '@nitpilot/protocol';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from '../../test/chat';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };

function serve() {
  fakeApi({
    'GET /api/me': (): Answer => [200, me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    ...chatRoutes([{ repo: 'acme/shop-api', number: 139, title: 'Fix race in session refresh' }]),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Shell (handoff "App shell and layout")', () => {
  it('shows the inbox beside the open page on a desktop', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick a pull request' })).toBeInTheDocument();
  });

  it('shows one pane on a phone: the inbox at /, the page elsewhere, and Esc goes back', async () => {
    fakeViewport(false);
    serve();
    renderApp('/c/acme/shop-api/139');
    expect(await screen.findByRole('heading', { name: 'Fix race in session refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Inbox' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fix race in session refresh' })).not.toBeInTheDocument();
  });

  it('keeps Sign out on the Settings page, reached from your avatar', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings · maya' }));
    expect(await screen.findByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run them to see them fail**

Run: `npm test -w apps/web -- src/routes`
Expected: FAIL: `test/render.tsx` imports `../live/LiveProvider`, which doesn't exist yet, so no screen test loads; `PointCard.test.tsx` can't resolve `./PointCard`.

- [ ] **Step 12: The shared parts: copy, viewport, avatars, the data, and the socket's provider**

The offline banner's copy button and the chat's command chips are the same, so it moves into a hook. Create `apps/web/src/lib/clipboard.ts`:

```ts
import { useEffect, useState } from 'react';

/** Copy `text` and say "Copied" for 1.6 s. The command is on screen too, so a clipboard that's missing or refused (an insecure origin) only loses the shortcut. */
export function useCopy(text: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return {
    copied,
    copy: () => {
      navigator.clipboard?.writeText(text).catch(() => {});
      setCopied(true);
    },
  };
}
```

In `apps/web/src/routes/Inbox/InboxBanners.tsx`, drop the `useEffect`/`useState` import, import `useCopy` from `'../../lib/clipboard'`, and replace the state, the effect and `copy()` in `OfflineBanner` with `const { copied, copy } = useCopy(START);`.

Replace `apps/web/src/lib/viewport.ts` with (one `useMediaQuery`, used at 760 px and 1180 px):

```ts
import { useSyncExternalStore } from 'react';

/** The handoff's breakpoints: the sidebar and the chat side by side from 760 px, one pane below. */
const DESKTOP = '(min-width: 760px)';
/** The chat's details panel has room from 1180 px. */
const WIDE = '(min-width: 1180px)';

/** True while the media query matches, following the window as it's resized. Without matchMedia (very old browsers), true. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia !== 'function' || window.matchMedia(query).matches,
  );
}

/** True at 760 px and wider. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP);
}

/** True at 1180 px and wider: room for the chat's details panel. */
export function useIsWide(): boolean {
  return useMediaQuery(WIDE);
}
```

The chat's avatars are smaller than the inbox's. Replace `apps/web/src/components/Avatar/Avatar.tsx` with:

```tsx
import { useState, type ReactNode } from 'react';
import styles from './Avatar.module.css';

/** The handoff's avatar sizes, and the size of the initials in each. */
const INITIALS_PX = { 22: 9.5, 28: 10.5, 30: 11, 32: 11, 38: 13 } as const;

/**
 * A person's GitHub picture in a circle, or their initials when there is none or it doesn't load.
 * `children` sits on top, bottom-right (the AgentBadge).
 */
export function Avatar({ login, src, size, children }: { login: string; src: string | null; size: keyof typeof INITIALS_PX; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={styles.avatar} style={{ width: size, height: size }}>
      {src && !broken ? (
        <img className={styles.image} src={src} alt={login} width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className={styles.initials} style={{ fontSize: INITIALS_PX[size] }} role="img" aria-label={login}>
          {initials(login)}
        </span>
      )}
      {children}
    </span>
  );
}

/** "maya" → "MA", "leo-park" → "LP". */
export function initials(login: string): string {
  const parts = login.split(/[-_.\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : login.slice(0, 2);
  return letters.toUpperCase();
}
```

Replace `apps/web/src/components/AgentBadge/AgentBadge.tsx` and `AgentBadge.module.css` with:

```tsx
import styles from './AgentBadge.module.css';

/**
 * The mark on a person's avatar for their agent (handoff: a dark rounded square holding a diamond): large on an
 * inbox row, small in the chat's feed, tiny in a point's thread. Beside an agent's name it only decorates, so it
 * says nothing to a screen reader; on its own it says the agent is at work.
 */
export function AgentBadge({ login, size = 'large', decorative = false }: { login: string; size?: 'large' | 'small' | 'tiny'; decorative?: boolean }) {
  return (
    <span className={`${styles.badge} ${styles[size]}`} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `${login}'s agent is active` })}>
      <span className={styles.diamond} />
    </span>
  );
}
```

```css
/* The ring around the badge is the colour of what's behind the avatar: --side in the sidebar, set to --bg in the chat. */
.badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  border-radius: 4px;
  background: var(--fg1);
  box-shadow: 0 0 0 2px var(--badge-ring, var(--side));
  display: flex;
  align-items: center;
  justify-content: center;
}

.large {
  width: 15px;
  height: 15px;
}

.small {
  width: 13px;
  height: 13px;
}

.tiny {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  box-shadow: 0 0 0 1.5px var(--badge-ring, var(--side));
}

.diamond {
  width: 5px;
  height: 5px;
  background: var(--badge-ring, var(--side));
  transform: rotate(45deg);
}

.small .diamond {
  width: 4px;
  height: 4px;
}

.tiny .diamond {
  width: 3.5px;
  height: 3.5px;
}
```

Create `apps/web/src/api/chat.ts`:

```ts
import { ChatResponse, FilesResponse, MessagesResponse, type InboxRow } from '@nitpilot/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './client';

/** Where a chat lives in the data cache: by its address, as the screen opens it. `/ws/web` finds it by its id (live/apply.ts). */
export const chatKey = (owner: string, repo: string, number: string) => ['chat', owner, repo, number] as const;

/** A chat and its newest items (spec §10 `GET /api/chats/:owner/:repo/:number`). Kept fresh by `/ws/web`, never polled. */
export function useChat(owner: string, repo: string, number: string) {
  return useQuery({
    queryKey: chatKey(owner, repo, number),
    queryFn: () => api.get(`/api/chats/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`, ChatResponse),
  });
}

/** The page of items before `beforeSeq`, for "Load earlier". */
export function fetchOlderItems(chatId: string, beforeSeq: number): Promise<MessagesResponse> {
  return api.get(`/api/chats/${chatId}/messages?before=${beforeSeq}`, MessagesResponse);
}

/** The PR's changed files (spec §10 `GET /api/chats/:id/files`). The server keeps them per head commit, so asking again is cheap. */
export function useFiles(chatId: string) {
  return useQuery({ queryKey: ['files', chatId], queryFn: () => api.get(`/api/chats/${chatId}/files`, FilesResponse), staleTime: 60_000 });
}

/**
 * You've read the chat up to `seq` (spec §10 `POST /api/chats/:id/read`): once a second at most, while the tab is
 * visible, and only for someone in the chat (for anyone else there's no cursor to move). The inbox row's unread
 * count goes to 0 at once.
 */
export function useMarkRead(chatId: string, seq: number, participant: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!participant || seq === 0) return;
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      api
        .send('POST', `/api/chats/${chatId}/read`, { seq })
        .then(() => queryClient.setQueryData<InboxRow[]>(['inbox'], (rows) => rows?.map((r) => (r.chatId === chatId ? { ...r, unread: 0 } : r))))
        .catch(() => {});
    }, 1_000);
    return () => clearTimeout(timer);
  }, [chatId, seq, participant, queryClient]);
}
```

Create `apps/web/src/live/LiveProvider.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { applyServerMessage } from './apply';
import { LiveSocket, liveUrl, type SocketLike } from './socket';

/** Where the socket comes from: the browser's WebSocket, or a test's pretend one (test/render.tsx). */
export const SocketFactory = createContext<(url: string) => SocketLike>((url) => new WebSocket(url));

const Live = createContext<LiveSocket | null>(null);

/**
 * The tab's one `/ws/web` socket, for everything signed in (routes/Shell/Shell.tsx). What it receives goes into the
 * data cache; a closed session sends the tab back to the landing page.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const open = useContext(SocketFactory);
  const [live] = useState(
    () =>
      new LiveSocket({
        url: liveUrl(),
        open,
        onMessage: (msg) => applyServerMessage(queryClient, msg),
        onSignedOut: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
      }),
  );
  useEffect(() => {
    live.start();
    return () => live.stop();
  }, [live]);
  return <Live.Provider value={live}>{children}</Live.Provider>;
}

/** Follow this chat's new items and changes while the screen shows it, starting after `afterSeq`. */
export function useLiveChat(chatId: string, afterSeq: number): void {
  const live = useContext(Live);
  // Only a new chat subscribes again: the socket keeps the newest seq itself from then on.
  const subscribe = useEffectEvent(() => live?.subscribe(chatId, afterSeq));
  useEffect(() => {
    if (!live) return;
    subscribe();
    return () => live.unsubscribe(chatId);
  }, [live, chatId]);
}
```

- [ ] **Step 13: The point card**

Create `apps/web/src/routes/Chat/PointCard.tsx`:

```tsx
import type { PointView, Severity, TimelineItem } from '@nitpilot/protocol';
import { useState } from 'react';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { agentName, personName } from '../../lib/names';
import { snippetLines, syntaxTokens } from '../../lib/snippet';
import { itemTime } from '../../lib/time';
import styles from './PointCard.module.css';

const SEVERITY: Record<Severity, { word: string; bars: number }> = {
  blocker: { word: 'Blocker', bars: 4 },
  major: { word: 'Major', bars: 3 },
  minor: { word: 'Minor', bars: 2 },
  nit: { word: 'Nit', bars: 1 },
};

const STATUS: Record<PointView['status'], string> = { open: 'Open', addressed: 'Addressed', resolved: 'Resolved', escalated: 'Escalated' };

/** What the chat knows about the people in it: their pictures, by GitHub id. */
export type People = ReadonlyMap<string, { avatarUrl: string }>;

/**
 * A review point (handoff §3, the key component): severity, category, where in the code, what's wrong, the code
 * around it, and the thread of replies and decisions. A resolved point starts collapsed to one line.
 */
export function PointCard({ point, thread, you, people, repoUrl }: { point: PointView; thread: TimelineItem[]; you: string; people: People; repoUrl: string }) {
  const [open, setOpen] = useState(point.status !== 'resolved');
  const severity = SEVERITY[point.severity];
  const label = `P${point.number}, ${severity.word} ${point.category} point, ${STATUS[point.status]}: ${point.title}`;

  if (!open) {
    return (
      <button type="button" className={styles.collapsed} onClick={() => setOpen(true)} aria-expanded="false" aria-label={label}>
        <span className={styles.checkSmall} aria-hidden="true">
          ✓
        </span>
        <span className={styles.id}>P{point.number}</span>
        <span className={styles.collapsedTitle}>{point.title}</span>
        <span className={styles.id}>{outcome(point, thread)}</span>
        <span className={styles.resolvedWord}>Resolved</span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
    );
  }

  const lines = snippetLines(point);
  return (
    <article className={`${styles.card} ${point.status === 'escalated' ? styles.escalatedCard : ''}`} aria-label={label}>
      <div className={styles.head}>
        <div className={styles.chips}>
          <span className={`${styles.severity} ${styles[point.severity]}`}>
            <span className={styles.bars} aria-hidden="true">
              {[1, 2, 3, 4].map((bar) => (
                <span key={bar} className={`${styles.bar} ${bar <= severity.bars ? styles.filled : ''}`} style={{ height: 2 + bar * 2 }} />
              ))}
            </span>
            {severity.word}
          </span>
          <span className={styles.category}>{point.category}</span>
          <span className={styles.id}>P{point.number}</span>
          <span className={styles.spacer} />
          <span className={`${styles.status} ${styles[point.status]}`}>
            <StatusGlyph status={point.status} />
            {STATUS[point.status]}
          </span>
          {point.status === 'resolved' && (
            <button type="button" className={styles.collapse} onClick={() => setOpen(false)} aria-expanded="true" aria-label="Collapse point">
              ▴
            </button>
          )}
        </div>
        {point.path && (
          <a className={styles.file} href={point.url ?? undefined} target="_blank" rel="noreferrer">
            {point.line ? `${point.path}:${point.line}` : point.path}
          </a>
        )}
        <h3 className={styles.title}>{point.title}</h3>
        <p className={styles.body}>{point.body}</p>
      </div>
      {lines.length > 0 && (
        <div className={styles.snippet}>
          <div className={styles.snippetHead}>
            <span className={styles.snippetPath}>{point.path}</span>
            <span>
              L{lines[0]!.n}–{lines.at(-1)!.n}
            </span>
          </div>
          <pre className={styles.code}>
            {lines.map((line) => (
              <div key={line.n} className={`${styles.line} ${line.highlighted ? styles.highlighted : ''}`} data-highlighted={line.highlighted || undefined}>
                <span className={styles.lineNumber}>
                  {line.highlighted && <span className={styles.gutterDiamond} aria-hidden="true" />}
                  {line.n}
                </span>
                <code className={styles.lineText}>
                  {syntaxTokens(line.text).map((token, i) => (
                    <span key={i} className={styles[token.kind]}>
                      {token.text}
                    </span>
                  ))}
                </code>
              </div>
            ))}
          </pre>
        </div>
      )}
      {thread.length > 0 && (
        <ol className={styles.thread}>
          {thread.map((reply) => (
            <Reply key={reply.seq} reply={reply} you={you} people={people} repoUrl={repoUrl} />
          ))}
        </ol>
      )}
    </article>
  );
}

function StatusGlyph({ status }: { status: PointView['status'] }) {
  if (status === 'resolved') {
    return (
      <span className={styles.checkSmall} aria-hidden="true">
        ✓
      </span>
    );
  }
  return <span className={styles[`${status}Glyph`]} aria-hidden="true" />;
}

/** One reply in a point's thread: an agent's answer or decision, or a person's comment on GitHub. */
function Reply({ reply, you, people, repoUrl }: { reply: TimelineItem; you: string; people: People; repoUrl: string }) {
  const login = reply.author?.login ?? '';
  const byAgent = reply.kind === 'point_reply' || reply.kind === 'point_decision';
  const tag = replyTag(reply);
  const commit = typeof reply.data?.commit === 'string' ? reply.data.commit : null;
  return (
    <li className={styles.reply}>
      <Avatar login={login} src={people.get(reply.author?.githubId ?? '')?.avatarUrl ?? null} size={22}>
        {byAgent && <AgentBadge login={login} size="tiny" decorative />}
      </Avatar>
      <div className={styles.replyMain}>
        <div className={styles.replyHead}>
          <span className={styles.replyName}>{byAgent ? agentName(login, you) : personName(login, you)}</span>
          {tag && (
            <span className={`${styles.tag} ${styles[tag.tone]}`}>
              {tag.word}
              {tag.word === 'Fixed in' && commit && (
                <>
                  {' '}
                  <a className={styles.commit} href={`${repoUrl}/commit/${commit}`} target="_blank" rel="noreferrer">
                    {commit.slice(0, 7)}
                  </a>
                </>
              )}
            </span>
          )}
          <span className={styles.replyTime}>{itemTime(reply.at)}</span>
        </div>
        {reply.body && <p className={styles.replyText}>{reply.body}</p>}
      </div>
    </li>
  );
}

/** The outcome tag of a reply (handoff §3 "Outcome tags"). */
function replyTag(reply: TimelineItem): { word: string; tone: 'ok' | 'plain' | 'warn' | 'accent' } | null {
  const resolution = reply.data?.resolution;
  if (resolution === 'fixed') return { word: 'Fixed in', tone: 'ok' };
  if (resolution === 'declined') return { word: 'Declined', tone: 'plain' };
  if (resolution === 'answered') return { word: 'Answered', tone: 'accent' };
  const decision = reply.data?.decision;
  if (decision === 'resolve') return { word: 'Resolved', tone: 'ok' };
  if (decision === 'keep_open') return { word: 'Kept open', tone: 'warn' };
  return null;
}

/** "Fixed · a1b2c3d", "Declined" or "Answered": how a resolved point ended, for its collapsed line. */
function outcome(point: PointView, thread: TimelineItem[]): string {
  if (point.authorResolution === 'fixed') {
    const commit = thread.findLast((r) => typeof r.data?.commit === 'string')?.data?.commit;
    return typeof commit === 'string' ? `Fixed · ${commit.slice(0, 7)}` : 'Fixed';
  }
  if (point.authorResolution === 'declined') return 'Declined';
  if (point.authorResolution === 'answered') return 'Answered';
  return '';
}
```

Create `apps/web/src/routes/Chat/PointCard.module.css` (a card without a snippet keeps the 14 px the snippet's margin would give below its text):

```css
/* handoff §3, PointCard.dc.html */
.card {
  border: 1px solid var(--b1);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  background: var(--surface);
  overflow: hidden;
}

.escalatedCard {
  border-color: var(--red-line);
}

.head {
  padding: 12px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* A point without a snippet (a GitHub comment on the whole PR) keeps the 14px the snippet's margin gives below its text. */
.head:last-child {
  padding-bottom: 14px;
}

.head + .thread {
  margin-top: 14px;
}

.chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.severity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px 0 7px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  background: var(--muted);
  color: var(--fg2);
}

.blocker {
  background: var(--red-tint);
  color: var(--red-fg);
  --bar: var(--red);
}

.major {
  background: var(--warn-tint);
  color: var(--warn-fg);
  --bar: var(--warn);
}

.minor {
  --bar: var(--fg2);
}

.nit {
  --bar: var(--fg3);
}

.bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 1.5px;
  height: 10px;
}

.bar {
  width: 2.5px;
  border-radius: 1px;
  background: var(--b1);
}

.filled {
  background: var(--bar);
}

.category {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 7px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--b1);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg2);
}

.id {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg3);
  padding: 0 2px;
}

.spacer {
  flex: 1;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.open {
  color: var(--fg2);
}

.addressed {
  color: var(--acc-text);
}

.resolved {
  color: var(--ok-fg);
}

.escalated {
  color: var(--red-fg);
}

.openGlyph {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--fg3);
}

.addressedGlyph {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--acc);
  background: linear-gradient(90deg, var(--acc) 50%, transparent 50%);
}

.escalatedGlyph {
  width: 8px;
  height: 8px;
  margin: 0 1px;
  background: var(--red);
  transform: rotate(45deg);
}

.checkSmall {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: var(--radius-pill);
  background: var(--ok);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
}

.collapse {
  border: 0;
  background: transparent;
  color: var(--fg3);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
}

.collapse:hover {
  color: var(--fg1);
}

.file {
  align-self: flex-start;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--acc-text);
  text-decoration: none;
}

.title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.005em;
}

.body {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--fg2);
  white-space: pre-wrap;
}

.snippet {
  margin: 12px 14px 14px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  overflow: hidden;
  background: var(--code);
}

.snippetHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--b1);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg3);
  background: var(--surface);
}

.snippetPath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code {
  margin: 0;
  overflow-x: auto;
  padding: 6px 0;
  font-size: 12px;
  line-height: 20px;
}

.line {
  display: flex;
  min-width: max-content;
}

.highlighted {
  background: var(--hl);
}

/* --fg4 is decoration only: these numbers repeat the L47–49 in the snippet's header. */
.lineNumber {
  flex: none;
  position: relative;
  width: 46px;
  padding-right: 12px;
  text-align: right;
  color: var(--fg4);
  user-select: none;
}

.highlighted .lineNumber {
  color: var(--acc-text);
}

.gutterDiamond {
  position: absolute;
  left: 9px;
  top: 7px;
  width: 6px;
  height: 6px;
  background: var(--acc);
  transform: rotate(45deg);
}

.lineText {
  white-space: pre;
  padding-right: 16px;
  font-family: inherit;
}

.plain {
  color: var(--fg1);
}

.keyword {
  color: var(--acc-text);
}

.string {
  color: var(--ok-fg);
}

.number {
  color: var(--warn-fg);
}

.comment {
  color: var(--fg3);
}

.thread {
  list-style: none;
  margin: 0;
  border-top: 1px solid var(--b2);
  background: var(--bg);
  padding: 4px 14px 6px;
  display: flex;
  flex-direction: column;
  --badge-ring: var(--bg);
}

.reply {
  display: flex;
  gap: 10px;
  padding: 8px 0;
}

.replyMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.replyHead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
}

.replyName {
  font-weight: 600;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
}

.ok {
  color: var(--ok-fg);
}

.plain.tag {
  color: var(--fg2);
}

.warn {
  color: var(--warn-fg);
}

.accent {
  color: var(--acc-text);
}

.commit {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--acc-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.replyTime {
  color: var(--fg3);
  font-size: 11.5px;
}

.replyText {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--fg2);
  white-space: pre-wrap;
}

.collapsed {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-card);
  background: var(--surface);
  cursor: pointer;
  font-size: 13px;
  line-height: 1.3;
  color: var(--fg2);
  text-align: left;
}

.collapsed:hover {
  background: var(--hover);
}

.collapsedTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg1);
}

.resolvedWord {
  flex: none;
  font-size: 12px;
  color: var(--ok-fg);
  font-weight: 500;
}

.caret {
  flex: none;
  color: var(--fg3);
  font-size: 12px;
}
```

- [ ] **Step 14: The chat screen**

Create `apps/web/src/routes/Chat/ChatHeader.tsx`:

```tsx
import type { ChatView } from '@nitpilot/protocol';
import { Link } from 'react-router';
import { Ping } from '../../components/Ping/Ping';
import { agentName } from '../../lib/names';
import { itemTime } from '../../lib/time';
import styles from './ChatHeader.module.css';

const ROLE = { author: 'Author', reviewer: 'Reviewer' } as const;

/**
 * The chat's header (handoff §2 "Header"). Desktop: the title, your role, "Open on GitHub" and the details toggle;
 * then the repo and number, the branches, the round and the other side's agent. Phone: a back arrow, and the
 * same facts stacked, shrinking to one line once the feed scrolls (`collapsed`).
 */
export function ChatHeader(props: { view: ChatView; you: string; desktop: boolean; collapsed: boolean; details: { available: boolean; open: boolean; toggle: () => void } }) {
  const { view, you } = props;
  const role = view.viewer.role;
  const ref = `${view.repo} #${view.number}`;
  if (!props.desktop) {
    return (
      <header className={styles.phone}>
        <div className={styles.phoneTop}>
          <Link to="/" className={styles.back} aria-label="Back to inbox">
            <span className={styles.chevron} aria-hidden="true" />
          </Link>
          {props.collapsed ? <h1 className={styles.phoneTitleLine}>{view.title}</h1> : <span className={styles.phoneRef}>{ref}</span>}
        </div>
        {!props.collapsed && (
          <div className={styles.phoneFull}>
            <h1 className={styles.phoneTitle}>{view.title}</h1>
            <div className={styles.branches}>
              {view.headRef} → {view.baseRef}
            </div>
            <div className={styles.facts}>
              {role && <span className={styles.roleChip}>{ROLE[role]}</span>}
              <Round view={view} />
              <Presence view={view} you={you} />
            </div>
          </div>
        )}
      </header>
    );
  }
  return (
    <header className={styles.desktop}>
      <div className={styles.topRow}>
        <h1 className={styles.title}>{view.title}</h1>
        {role && <span className={styles.roleChip}>{ROLE[role]}</span>}
        <a className={styles.button} href={view.url} target="_blank" rel="noreferrer">
          Open on GitHub <span className={styles.arrow}>↗</span>
        </a>
        {props.details.available && (
          <button type="button" className={`${styles.iconButton} ${props.details.open ? styles.pressed : ''}`} onClick={props.details.toggle} aria-pressed={props.details.open} aria-label="PR details" title="PR details">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
          </button>
        )}
      </div>
      <div className={styles.facts}>
        <span className={styles.ref}>{ref}</span>
        <span className={styles.branches}>
          {view.headRef} <span className={styles.to}>→</span> {view.baseRef}
        </span>
        <Round view={view} />
        <Presence view={view} you={you} />
      </div>
    </header>
  );
}

/** One pip per allowed round (accent when used, all amber on the last round), then "Round 2 of 3". */
function Round({ view }: { view: ChatView }) {
  const last = view.round >= view.maxRounds;
  return (
    <span className={styles.round}>
      <span className={styles.pips} aria-hidden="true">
        {Array.from({ length: view.maxRounds }, (_, i) => (
          <span key={i} className={`${styles.pip} ${i < view.round ? (last ? styles.lastPip : styles.usedPip) : ''}`} />
        ))}
      </span>
      Round {view.round} of {view.maxRounds}
    </span>
  );
}

/**
 * The agent that matters here: the one at work if any, else the other side's (your reviewer's, or the author's).
 * A ping while it works, a dot while it's online, a ring with when it was last seen when it's offline.
 */
function Presence({ view, you }: { view: ChatView; you: string }) {
  if (view.activity.kind === 'agent_working' && view.activity.who) {
    return (
      <span className={styles.presence}>
        <Ping />
        {agentName(view.activity.who, you)} · working
      </span>
    );
  }
  const others = view.participants.filter((p) => p.login !== you && p.agent && p.role !== view.viewer.role);
  const other = others.find((p) => p.requested) ?? others[0];
  if (!other?.agent) return null;
  const { online, offlineSince } = other.agent;
  return (
    <span className={styles.presence}>
      <span className={online ? styles.online : styles.offline} aria-hidden="true" />
      {agentName(other.login, you)} · {online ? 'online' : offlineSince ? `offline since ${itemTime(offlineSince)}` : 'offline'}
    </span>
  );
}
```

Create `apps/web/src/routes/Chat/ChatHeader.module.css`:

```css
/* handoff §2 "Header": surface, 1px bottom border, 12px 20px. */
.desktop {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--b1);
}

.topRow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.title {
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 17.6px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.roleChip {
  flex: none;
  height: 22px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  background: var(--muted);
  color: var(--fg2);
  font-size: 12px;
  font-weight: 500;
}

.button {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  color: var(--fg1);
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
}

.arrow {
  color: var(--fg3);
}

.iconButton {
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pressed {
  background: var(--muted);
}

.facts {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--fg3);
}

.ref {
  font-family: var(--font-mono);
  color: var(--fg2);
}

.branches {
  font-family: var(--font-mono);
}

.to {
  color: var(--fg3);
}

.round,
.presence {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.pips {
  display: inline-flex;
  gap: 2px;
}

.pip {
  width: 10px;
  height: 4px;
  border-radius: 2px;
  background: var(--b1);
}

.usedPip {
  background: var(--acc);
}

.lastPip {
  background: var(--warn);
}

.online {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--ok);
}

.offline {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--fg3);
}

/* Phone: 8px 12px 10px 4px, a 44×44 back arrow, the title wrapping at 20.9 px. */
.phone {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 10px 4px;
  background: var(--surface);
  border-bottom: 1px solid var(--b1);
}

.phoneTop {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.back {
  flex: none;
  width: 44px;
  height: 44px;
  padding-left: 4px;
  color: var(--acc-text);
  display: flex;
  align-items: center;
  justify-content: center;
}

.chevron {
  width: 10px;
  height: 10px;
  border-top: 2px solid currentColor;
  border-left: 2px solid currentColor;
  transform: rotate(-45deg);
}

.phoneRef {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phoneTitleLine {
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
}

.phoneFull {
  padding: 0 4px 0 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.phoneTitle {
  margin: 0;
  font-size: 20.9px;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.2;
}

.phoneFull .branches {
  font-size: 11.5px;
  color: var(--fg3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phoneFull .roleChip {
  height: 20px;
  padding: 0 7px;
}
```

Create `apps/web/src/routes/Chat/ChatBanner.tsx`:

```tsx
import { BRAND, type ChatView } from '@nitpilot/protocol';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { Banner } from '../../lib/banner';
import { useCopy } from '../../lib/clipboard';
import { itemTime } from '../../lib/time';
import styles from './ChatBanner.module.css';

/**
 * The banner under the header (handoff §2 "Banners", §10). Only text and links in W3: the buttons that change the
 * chat (Resolve, Continue, Retry) arrive with the other actions in Task 13. An escalation is an alert; the rest
 * are statuses.
 */
export function ChatBanner({ banner, view }: { banner: Banner; view: ChatView }) {
  const here = useLocation();
  const reconnect = `/auth/github/login?next=${encodeURIComponent(here.pathname)}`;
  const outcome = (rounds: number, resolved: number) => `${rounds} round${rounds === 1 ? '' : 's'} · ${resolved} point${resolved === 1 ? '' : 's'} resolved`;
  switch (banner.kind) {
    case 'none':
      return null;
    case 'github_expired':
      return (
        <Strip tone="warn" glyph="!" title="GitHub sign-in expired" body={`${BRAND.name} can't approve, post or push as you until you reconnect. Agents keep working in the meantime.`}>
          {/* A full page load: the sign-in starts on the server. */}
          <a className={styles.dark} href={reconnect}>
            Reconnect GitHub
          </a>
        </Strip>
      );
    case 'escalated':
      return (
        <div className={styles.escalated} role="alert">
          <div className={styles.escalatedHead}>
            <span className={styles.diamond} aria-hidden="true" />
            <span className={styles.title}>Needs a human decision</span>
            <span className={styles.body}>{banner.note}</span>
          </div>
          <ul className={styles.points}>
            {banner.points.map((p) => (
              <li key={p.number} className={styles.point}>
                <span className={styles.pointId}>P{p.number}</span>
                <span className={styles.pointTitle}>{p.title}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'failed_job':
      return (
        <Strip tone="warn" glyph="!" title="Your agent couldn't finish" body="The timeline says why. To run it again:">
          <CopyCommand command={`${BRAND.cli} retry ${view.url}`} />
        </Strip>
      );
    case 'failed_post':
      return (
        <Strip tone="warn" glyph="!" title="Couldn't post on GitHub as you" body={`Sign in with GitHub again, and ${BRAND.name} posts it.`}>
          <a className={styles.dark} href={reconnect}>
            Reconnect GitHub
          </a>
        </Strip>
      );
    case 'cap':
      return (
        <Strip tone="warn" glyph="!" title="Daily agent cap reached" body="Agents pick up again at midnight, or raise the cap in Settings.">
          <Link className={styles.dark} to="/settings">
            Raise cap
          </Link>
        </Strip>
      );
    case 'repo_not_linked':
      return (
        <Strip tone="muted" title={`${banner.repo} isn't linked on this computer`} body="Your agent can't review or fix this PR until the repo is linked. In your clone, run:">
          <CopyCommand command={`${BRAND.cli} repos add`} />
        </Strip>
      );
    case 'waiting':
      return (
        <Strip
          tone="muted"
          glyph="ring"
          title="Waiting for your agent"
          body={banner.offlineSince ? `Offline since ${itemTime(banner.offlineSince)}. Start it to pick the work up.` : "Your agent hasn't connected yet. Start it to pick the work up."}
        >
          <CopyCommand command={`${BRAND.cli} start`} />
        </Strip>
      );
    case 'ready_reviewer':
      return (
        <Strip tone="ok" glyph="check" title="Ready for your approval" body={outcome(banner.rounds, banner.resolved)}>
          {/* Approval always happens on GitHub (handoff §2). */}
          <a className={styles.primary} href={`${view.url}/files`} target="_blank" rel="noreferrer">
            Approve on GitHub <span aria-hidden="true">↗</span>
          </a>
        </Strip>
      );
    case 'ready_author':
      return (
        <Strip tone="ok" glyph="check" title={banner.reviewer ? `Waiting for ${banner.reviewer}'s approval` : 'Waiting for approval'} body={outcome(banner.rounds, banner.resolved)}>
          <a className={styles.secondary} href={view.url} target="_blank" rel="noreferrer">
            View on GitHub <span aria-hidden="true">↗</span>
          </a>
        </Strip>
      );
  }
}

/** One banner line: a glyph, a title and a line under it, then what you can do. */
function Strip(props: { tone: 'ok' | 'warn' | 'muted'; glyph?: '!' | 'ring' | 'check'; title: string; body: string; children: ReactNode }) {
  return (
    <div className={`${styles.strip} ${styles[props.tone]}`} role="status">
      {props.glyph === '!' && (
        <span className={styles.bang} aria-hidden="true">
          !
        </span>
      )}
      {props.glyph === 'check' && (
        <span className={styles.check} aria-hidden="true">
          ✓
        </span>
      )}
      {props.glyph === 'ring' && <span className={styles.ring} aria-hidden="true" />}
      <div className={styles.text}>
        <span className={styles.title}>{props.title}</span>
        <span className={styles.body}>{props.body}</span>
      </div>
      {props.children}
    </div>
  );
}

/** "$ nitpilot start  Copy": a command to run in a terminal, copied with one click. */
function CopyCommand({ command }: { command: string }) {
  const { copied, copy } = useCopy(command);
  return (
    <button type="button" className={styles.command} onClick={copy} aria-label={`Copy ${command}`}>
      <span className={styles.dollar} aria-hidden="true">
        $
      </span>
      {command}
      <span className={styles.copy}>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
```

Create `apps/web/src/routes/Chat/ChatBanner.module.css`:

```css
/* handoff §2 "Banners": pinned under the header, full width. */
.strip {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 20px;
  border-bottom: 1px solid var(--b1);
}

.ok {
  background: var(--ok-tint);
}

.warn {
  background: var(--warn-tint);
}

.muted {
  background: var(--muted);
}

.text {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.title {
  font-size: 13.5px;
  font-weight: 600;
}

.body {
  font-size: 12.5px;
  color: var(--fg2);
}

.bang {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--warn);
  color: #1a1205;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.check {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: var(--ok);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ring {
  flex: none;
  width: 12px;
  height: 12px;
  margin: 0 3px;
  border-radius: var(--radius-pill);
  border: 2px solid var(--fg3);
}

.primary,
.secondary,
.dark {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.primary {
  background: var(--acc);
  color: var(--on-acc);
}

.secondary {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--b1);
  background: var(--surface);
  color: var(--fg1);
  font-size: 12.5px;
  font-weight: 500;
}

.dark {
  height: 30px;
  padding: 0 12px;
  background: var(--fg1);
  color: var(--bg);
  font-size: 12.5px;
}

.command {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg1);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}

.dollar,
.copy {
  color: var(--fg3);
}

.copy {
  font-family: var(--font-sans);
  font-size: 11.5px;
}

/* The one red banner: red-tint with a red-line border. */
.escalated {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px;
  background: var(--red-tint);
  border-bottom: 1px solid var(--red-line);
}

.escalatedHead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.diamond {
  flex: none;
  width: 9px;
  height: 9px;
  margin: 0 4px;
  background: var(--red);
  transform: rotate(45deg);
}

.points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.point {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--red-line);
  border-radius: var(--radius-card);
  background: var(--surface);
}

.pointId {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--red-fg);
}

.pointTitle {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.35;
}
```

Create `apps/web/src/routes/Chat/Timeline.tsx`:

```tsx
import type { ChatView, TimelineItem } from '@nitpilot/protocol';
import { useFiles } from '../../api/chat';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { Ping } from '../../components/Ping/Ping';
import { useProgress } from '../../live/progress';
import { agentName, personName } from '../../lib/names';
import { itemTime } from '../../lib/time';
import { severityCounts, timelineRows, withCommitHashes, type Glyph } from '../../lib/timeline';
import { PointCard, type People } from './PointCard';
import styles from './Timeline.module.css';

/**
 * The chat's feed (handoff §2 "Timeline", the single-column layout): everyone left-aligned like an activity log,
 * point cards full width under the summary that raised them, and the live progress line at the end.
 */
export function Timeline(props: { view: ChatView; items: TimelineItem[]; hasOlder: boolean; you: string; loadingEarlier: boolean; onLoadEarlier: () => void }) {
  const { view, items, you } = props;
  const people: People = new Map(view.participants.map((p) => [p.githubId, { avatarUrl: p.avatarUrl }]));
  const repoUrl = view.url.replace(/\/pull\/\d+$/, '');
  const avatarOf = (item: TimelineItem) => people.get(item.author?.githubId ?? '')?.avatarUrl ?? null;
  return (
    <div className={styles.feed}>
      {props.hasOlder && (
        <button type="button" className={styles.earlier} onClick={props.onLoadEarlier} disabled={props.loadingEarlier}>
          {props.loadingEarlier ? 'Loading…' : 'Load earlier'}
        </button>
      )}
      <ol className={styles.list}>
        {timelineRows(items, view.points).map((row) => {
          if (row.kind === 'point') {
            return (
              <li key={`P${row.point.number}`} className={styles.pointRow}>
                <PointCard point={row.point} thread={row.thread} you={you} people={people} repoUrl={repoUrl} />
              </li>
            );
          }
          const { item } = row;
          return (
            <li key={item.seq}>
              {row.kind === 'system' ? (
                <SystemLine item={item} glyph={row.glyph} />
              ) : (
                <Message item={item} you={you} avatar={avatarOf(item)} agent={row.kind === 'summary'} />
              )}
            </li>
          );
        })}
      </ol>
      {!view.trusted && view.viewer.attention === 'manual_review' && <UntrustedCard view={view} />}
      <ProgressLine chatId={view.id} you={you} />
    </div>
  );
}

/** A system event: a glyph, the line in muted text, the time (handoff §2). */
function SystemLine({ item, glyph }: { item: TimelineItem; glyph: Glyph }) {
  return (
    <div className={styles.system}>
      <span className={styles.glyphColumn} aria-hidden="true">
        <span className={styles[glyph]}>{glyph === 'check' ? '✓' : null}</span>
      </span>
      <span className={styles.systemText}>
        {withCommitHashes(item.body).map((part, i) =>
          part.hash ? (
            <code key={i} className={styles.hash}>
              {part.text}
            </code>
          ) : (
            part.text
          ),
        )}
      </span>
      <time className={styles.time} dateTime={item.at}>
        {itemTime(item.at)}
      </time>
    </div>
  );
}

/** An agent's summary ("leo's agent", with severity counts) or a person's note (in a box; yours in your colour). */
function Message({ item, you, avatar, agent }: { item: TimelineItem; you: string; avatar: string | null; agent: boolean }) {
  const login = item.author?.login ?? '';
  const mine = login === you;
  const counts = agent ? severityCounts(item.data) : '';
  // A person's comment that came from GitHub carries the thread it was in; a note sent from Nitpilot doesn't.
  const fromGithub = item.data !== null && 'threadRootId' in item.data;
  return (
    <div className={styles.message}>
      <Avatar login={login} src={avatar} size={28}>
        {agent && <AgentBadge login={login} size="small" decorative />}
      </Avatar>
      <div className={styles.messageMain}>
        <div className={styles.messageHead}>
          <span className={styles.name}>{agent ? agentName(login, you) : personName(login, you)}</span>
          {!agent && <span className={styles.sub}>{fromGithub ? 'on GitHub' : 'to the agents'}</span>}
          <span className={styles.spacer} />
          <time className={styles.time} dateTime={item.at}>
            {itemTime(item.at)}
          </time>
        </div>
        {agent ? (
          <p className={styles.summary}>
            {item.body}
            {counts && <span className={styles.counts}> {counts}</span>}
          </p>
        ) : (
          <p className={`${styles.note} ${mine ? styles.mine : ''}`}>{item.body}</p>
        )}
      </div>
    </div>
  );
}

const STAGE: Record<string, string> = { preparing: 'getting the code', running_agent: '', pushing: 'pushing', finishing: 'finishing' };

/** What an agent is doing this second, from its CLI (handoff §2 "Live progress line"). */
function ProgressLine({ chatId, you }: { chatId: string; you: string }) {
  const progress = useProgress(chatId);
  return (
    <div className={styles.progress} role="status" aria-live="polite">
      {progress && (
        <>
          <span className={styles.glyphColumn}>
            <Ping />
          </span>
          <span className={styles.progressWho}>
            {agentName(progress.who, you)} is {progress.action}…{STAGE[progress.stage] ? ` ${STAGE[progress.stage]}` : ''}
          </span>
          <span className={styles.progressText}>{progress.text}</span>
        </>
      )}
    </div>
  );
}

/**
 * A PR from an outside contributor (handoff §2 "Untrusted PR card"): agents don't start on it by themselves, so the
 * requested reviewer skims the diff first. Its Review button arrives with the other actions (Task 13).
 */
function UntrustedCard({ view }: { view: ChatView }) {
  const files = useFiles(view.id).data;
  const biggest = files?.files.toSorted((a, b) => b.adds + b.dels - (a.adds + a.dels))[0];
  return (
    <section className={styles.untrusted} aria-label="First-time contributor">
      <div className={styles.eyebrow}>
        <span className={styles.ring} aria-hidden="true" />
        First-time contributor
      </div>
      <h3 className={styles.untrustedTitle}>Your agent hasn't started</h3>
      <p className={styles.untrustedBody}>Nitpilot doesn't run agents automatically on PRs from outside contributors. Skim the diff, then start the review yourself.</p>
      {files && (
        <p className={styles.fileLine}>
          {files.files.length} file{files.files.length === 1 ? '' : 's'} · <span className={styles.adds}>+{files.adds}</span> <span className={styles.dels}>−{files.dels}</span>
          {biggest ? ` · ${biggest.path}` : ''}
        </p>
      )}
      <div>
        <a className={styles.button} href={`${view.url}/files`} target="_blank" rel="noreferrer">
          View diff on GitHub <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
```

Create `apps/web/src/routes/Chat/Timeline.module.css`:

```css
/* handoff §2 "Timeline (feed)": max 780 px, 22px 24px padding with a 14px gap (16px 12px on a phone). */
.feed {
  max-width: 780px;
  margin: 0 auto;
  padding: 22px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  --badge-ring: var(--bg);
}

@media (max-width: 759px) {
  .feed {
    padding: 16px 12px 20px;
  }
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.earlier {
  align-self: center;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  background: var(--surface);
  font-size: 12.5px;
  cursor: pointer;
}

.system {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--fg3);
}

.glyphColumn {
  flex: none;
  width: 28px;
  display: flex;
  justify-content: center;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--fg4);
}

.check {
  color: var(--ok-fg);
  font-weight: 700;
  font-size: 11px;
}

.ring {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--fg3);
}

.diamond {
  width: 6px;
  height: 6px;
  background: var(--red);
  transform: rotate(45deg);
}

.systemText {
  flex: 1;
  min-width: 0;
}

.hash {
  font-family: var(--font-mono);
  color: var(--fg2);
}

.time {
  flex: none;
  font-size: 12px;
  color: var(--fg3);
  font-variant-numeric: tabular-nums;
}

.message {
  display: flex;
  gap: 10px;
}

.messageMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.messageHead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
}

.name {
  font-weight: 600;
}

.sub {
  color: var(--fg3);
}

.spacer {
  flex: 1;
}

.summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.counts {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg3);
}

.note {
  align-self: flex-start;
  margin: 2px 0 0;
  padding: 8px 12px;
  border-radius: var(--radius-card);
  background: var(--surface);
  border: 1px solid var(--b1);
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.mine {
  background: var(--bubble);
  border-color: var(--acc-line);
}

.pointRow {
  padding-left: 38px;
  margin-top: -6px;
}

@media (max-width: 759px) {
  .pointRow {
    padding-left: 0;
  }
}

.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--fg2);
}

.progress:empty {
  display: none;
}

.progressWho {
  white-space: nowrap;
}

.progressText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg1);
}

.untrusted {
  margin-left: 38px;
  padding: 16px 18px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-card);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg3);
}

.untrustedTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.untrustedBody {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--fg2);
}

.fileLine {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg3);
}

.adds {
  color: var(--ok-fg);
}

.dels {
  color: var(--red-fg);
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--b1);
  border-radius: var(--radius-control);
  color: var(--fg1);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
}
```

Create `apps/web/src/routes/Chat/DetailsPanel.tsx`:

```tsx
import { BRAND, type ChatView, type ParticipantView } from '@nitpilot/protocol';
import { useFiles } from '../../api/chat';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { itemTime } from '../../lib/time';
import styles from './DetailsPanel.module.css';

/** The PR beside the chat (handoff §2 "Details panel", desktop at 1180 px and wider): its files, its people, the team's rules. */
export function DetailsPanel({ view }: { view: ChatView }) {
  return (
    <aside className={styles.panel} aria-label="PR details">
      <Files chatId={view.id} />
      <section className={styles.section}>
        <h2 className={styles.heading}>Participants</h2>
        <ul className={styles.people}>
          {view.participants.map((p) => (
            <Person key={`${p.githubId} ${p.role}`} person={p} />
          ))}
        </ul>
      </section>
      <section className={styles.section}>
        <div className={styles.headingRow}>
          <h2 className={styles.heading}>Team rules</h2>
          <span className={styles.meta}>{BRAND.teamConfigFile}</span>
        </div>
        <dl className={styles.rules}>
          <dt>Max rounds</dt>
          <dd className={styles.mono}>{view.rules.maxRounds}</dd>
          <dt>Always escalate</dt>
          <dd className={styles.mono}>{view.rules.alwaysEscalate.join(', ') || 'nothing'}</dd>
          <dt>Auto modes</dt>
          <dd>{autoModes(view.rules)}</dd>
        </dl>
        {view.rules.error && (
          <p className={styles.rulesError}>
            {BRAND.teamConfigFile} has an error, so the defaults apply: <span className={styles.mono}>{view.rules.error}</span>
          </p>
        )}
      </section>
      {view.summaryUrl && (
        <a className={styles.summary} href={view.summaryUrl} target="_blank" rel="noreferrer">
          Summary comment on GitHub <span aria-hidden="true">↗</span>
        </a>
      )}
    </aside>
  );
}

/** "6 · +123 −15", then one line per file, its path cut from the left so the file name shows. */
function Files({ chatId }: { chatId: string }) {
  const files = useFiles(chatId);
  const data = files.data;
  return (
    <section className={styles.section}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Files changed</h2>
        {data && (
          <span className={styles.meta}>
            {data.files.length}
            {data.truncated ? '+' : ''} · +{data.adds} −{data.dels}
          </span>
        )}
      </div>
      {files.isPending && <p className={styles.note}>Loading…</p>}
      {files.isError && <p className={styles.note}>{files.error.message}</p>}
      {data && data.files.length > 0 && (
        <ul className={styles.files}>
          {data.files.map((f) => (
            <li key={f.path} className={styles.file}>
              <span className={styles.path} title={f.path}>
                <bdi>{f.path}</bdi>
              </span>
              <span className={styles.adds}>+{f.adds}</span>
              <span className={styles.dels}>−{f.dels}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Person({ person }: { person: ParticipantView }) {
  const agent = person.agent;
  return (
    <li className={styles.person}>
      <Avatar login={person.login} src={person.avatarUrl} size={30}>
        {agent?.working && <AgentBadge login={person.login} size="small" />}
      </Avatar>
      <div className={styles.personMain}>
        <div className={styles.personName}>
          <span>{person.login}</span>
          <span className={styles.meta}>{person.role === 'author' ? 'Author' : 'Reviewer'}</span>
        </div>
        <div className={styles.personStatus}>
          {agent && <span className={agent.online ? styles.online : styles.offline} aria-hidden="true" />}
          {agentStatus(person)}
        </div>
      </div>
    </li>
  );
}

function agentStatus(person: ParticipantView): string {
  if (person.isBot) return 'Bot';
  const agent = person.agent;
  if (!agent) return `Not on ${BRAND.name}`;
  if (agent.working) return 'Agent working';
  if (agent.online) return 'Agent online';
  return agent.offlineSince ? `Agent offline since ${itemTime(agent.offlineSince)}` : 'No agent connected yet';
}

function autoModes(rules: ChatView['rules']): string {
  if (rules.autoReview && rules.autoAddress) return 'Allowed';
  if (rules.autoReview) return 'Auto-review only';
  if (rules.autoAddress) return 'Auto-fix only';
  return 'Off';
}
```

Create `apps/web/src/routes/Chat/DetailsPanel.module.css`:

```css
/* handoff §2 "Details panel": 300 px of --side beside the chat, 18px 18px 24px, 22 px between sections. */
.panel {
  width: 300px;
  flex: none;
  min-height: 0;
  overflow: auto;
  background: var(--side);
  border-left: 1px solid var(--b1);
  padding: 18px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.headingRow {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.heading {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.meta {
  font-size: 12px;
  color: var(--fg3);
}

.headingRow .meta {
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.note {
  margin: 0;
  font-size: 12.5px;
  color: var(--fg3);
}

.files {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--b1);
  border-radius: var(--radius-card);
  background: var(--surface);
  overflow: hidden;
}

.file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.file + .file {
  border-top: 1px solid var(--b2);
}

/* rtl cuts the path from the left, so the file name stays; <bdi> keeps the path itself reading left to right. */
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: var(--fg2);
}

.adds {
  flex: none;
  color: var(--ok-fg);
}

.dels {
  flex: none;
  color: var(--red-fg);
}

.people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.person {
  display: flex;
  align-items: center;
  gap: 10px;
}

.personMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.personName {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.personStatus {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg3);
}

.online {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--ok);
}

.offline {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--fg3);
}

.rules {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 8px;
  font-size: 12.5px;
}

.rules dt {
  color: var(--fg3);
}

.rules dd {
  margin: 0;
  text-align: right;
}

.mono {
  font-family: var(--font-mono);
}

.rulesError {
  margin: 0;
  padding: 6px 8px;
  border-radius: var(--radius-control);
  background: var(--warn-tint);
  color: var(--warn-fg);
  font-size: 12px;
}

.summary {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--acc-text);
  text-decoration: none;
}
```

Create `apps/web/src/routes/Chat/Chat.tsx` (the feed's scroll area takes focus when clicked or tabbed to, so ↑/↓ scroll it):

```tsx
import { BRAND, type ChatResponse, type WebMe } from '@nitpilot/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useOutletContext, useParams } from 'react-router';
import { chatKey, fetchOlderItems, useChat, useMarkRead } from '../../api/chat';
import { ApiError } from '../../api/client';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { useLiveChat } from '../../live/LiveProvider';
import { mergeItems } from '../../live/apply';
import { chatBanner } from '../../lib/banner';
import { useIsDesktop, useIsWide } from '../../lib/viewport';
import { EmptyPane, Pane } from '../Shell/Pane';
import { ChatBanner } from './ChatBanner';
import { ChatHeader } from './ChatHeader';
import { DetailsPanel } from './DetailsPanel';
import { Timeline } from './Timeline';
import styles from './Chat.module.css';

/** `/c/:owner/:repo/:number`: one PR's chat (handoff §2), read-only in W3, kept live over `/ws/web`. */
export function Chat() {
  const me = useOutletContext<WebMe>();
  const { owner = '', repo = '', number = '' } = useParams();
  const chat = useChat(owner, repo, number);
  if (chat.isPending) {
    return (
      <Pane>
        <p className={styles.loading} role="status">
          Loading…
        </p>
      </Pane>
    );
  }
  if (chat.isError) return <ChatUnavailable error={chat.error} onRetry={() => void chat.refetch()} />;
  return <ChatScreen key={chat.data.view.id} me={me} data={chat.data} cacheKey={chatKey(owner, repo, number)} />;
}

/** "No such chat" and "you can't see it" alike (spec §16); a GitHub sign-in to renew; anything else, with a way to try again. */
function ChatUnavailable({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const here = useLocation();
  if (error instanceof ApiError && error.status === 404) {
    return <EmptyPane title="Nothing here" body="This chat doesn't exist, or your GitHub account can't see its repo." />;
  }
  if (error instanceof ApiError && error.code === 'reauth') {
    return (
      <Pane>
        <div className={styles.reauth} role="alert">
          <h1 className={styles.reauthTitle}>Sign in with GitHub again</h1>
          <p className={styles.reauthBody}>Your GitHub sign-in expired, so {BRAND.name} can't check that you can see this chat.</p>
          {/* A full page load: the sign-in starts on the server. */}
          <a className={styles.reauthButton} href={`/auth/github/login?next=${encodeURIComponent(here.pathname)}`}>
            Reconnect GitHub
          </a>
        </div>
      </Pane>
    );
  }
  return <ErrorState message={error.message} onRetry={onRetry} />;
}

function ChatScreen({ me, data, cacheKey }: { me: WebMe; data: ChatResponse; cacheKey: readonly unknown[] }) {
  const { view, items, hasOlder } = data;
  const queryClient = useQueryClient();
  const desktop = useIsDesktop();
  const wide = useIsWide();
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const newest = items.at(-1)?.seq ?? 0;
  useLiveChat(view.id, newest);
  useMarkRead(view.id, newest, view.viewer.role !== null);

  async function loadEarlier(): Promise<void> {
    const first = items[0];
    if (!first) return;
    setLoadingEarlier(true);
    try {
      const page = await fetchOlderItems(view.id, first.seq);
      queryClient.setQueryData<ChatResponse>(cacheKey, (chat) => chat && { ...chat, items: mergeItems(page.items, chat.items), hasOlder: page.hasOlder });
    } finally {
      setLoadingEarlier(false);
    }
  }

  return (
    <div className={styles.chat}>
      <section className={styles.column} aria-label={`PR chat: ${view.title}`}>
        <ChatHeader view={view} you={me.login} desktop={desktop} collapsed={!desktop && collapsed} details={{ available: wide, open: detailsOpen, toggle: () => setDetailsOpen((open) => !open) }} />
        <ChatBanner banner={chatBanner(view, me)} view={view} />
        {view.rules.error && (
          <div className={styles.rulesChip}>
            <span role="status">
              <span className={styles.bang} aria-hidden="true">
                !
              </span>{' '}
              <span className={styles.mono}>{BRAND.teamConfigFile}</span> has an error, using defaults
            </span>
          </div>
        )}
        {/* On a phone the header shrinks to one line once the feed has scrolled 48 px (handoff "App shell and layout").
            It takes focus when clicked or tabbed to, so ↑/↓ scroll it (lib/keys.ts leaves them alone inside <main>). */}
        <div className={styles.scroll} tabIndex={0} onScroll={(e) => setCollapsed(e.currentTarget.scrollTop > 48)}>
          <Timeline view={view} items={items} hasOlder={hasOlder} you={me.login} loadingEarlier={loadingEarlier} onLoadEarlier={() => void loadEarlier()} />
        </div>
      </section>
      {wide && detailsOpen && <DetailsPanel view={view} />}
    </div>
  );
}
```

Create `apps/web/src/routes/Chat/Chat.module.css`:

```css
/* The chat fills the page beside the inbox: a column (header, banner, the feed scrolling) and the details panel. */
.chat {
  height: 100%;
  display: flex;
  min-height: 0;
}

.column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.loading {
  margin: 40px auto;
  color: var(--fg3);
  font-size: 13px;
}

/* handoff §10 `rules`: a centred warn chip under the header. */
.rulesChip {
  flex: none;
  display: flex;
  justify-content: center;
  padding: 10px 16px 0;
}

.rulesChip > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: var(--warn-tint);
  color: var(--warn-fg);
  font-size: 12.5px;
  font-weight: 500;
}

.bang {
  font-weight: 700;
}

.mono {
  font-family: var(--font-mono);
}

.reauth {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding-top: 40px;
}

.reauthTitle {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.reauthBody {
  margin: 0;
  font-size: 13.5px;
  color: var(--fg2);
}

.reauthButton {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  background: var(--fg1);
  color: var(--bg);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
```

Delete `apps/web/src/routes/Chat/ChatPlaceholder.tsx`. In `apps/web/src/app.tsx`, import `Chat` from `'./routes/Chat/Chat'` instead of `ChatPlaceholder`, and the route becomes `<Route path="c/:owner/:repo/:number" element={<Chat />} />`.

Replace `apps/web/src/routes/Shell/Shell.tsx` with (one socket for everything signed in; the pages read `me` from the outlet):

```tsx
import type { WebMe } from '@nitpilot/protocol';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { LiveProvider } from '../../live/LiveProvider';
import { useEscapeBack } from '../../lib/keys';
import { useIsDesktop } from '../../lib/viewport';
import { Inbox } from '../Inbox/Inbox';
import styles from './Shell.module.css';

/**
 * The signed-in app (handoff "App shell and layout"). Desktop: the 360 px inbox sidebar beside the page that's
 * open. Phone: one pane, the inbox at `/` and the open page anywhere else, with Esc (or ‹) going back. One
 * `/ws/web` socket keeps it all live (live/LiveProvider.tsx); the pages read who you are from the outlet.
 */
export function Shell({ me }: { me: WebMe }) {
  return (
    <LiveProvider>
      <Layout me={me} />
    </LiveProvider>
  );
}

function Layout({ me }: { me: WebMe }) {
  const desktop = useIsDesktop();
  const atInbox = useMatch('/') !== null;
  const navigate = useNavigate();
  useEscapeBack(!desktop && !atInbox, () => void navigate('/'));

  if (!desktop) {
    return atInbox ? (
      <div className={styles.phone}>
        <Inbox me={me} />
      </div>
    ) : (
      <main className={styles.phone}>
        <Outlet context={me} />
      </main>
    );
  }
  return (
    <div className={styles.shell}>
      <div className={styles.sidebar}>
        <Inbox me={me} />
      </div>
      <main className={styles.main}>
        <Outlet context={me} />
      </main>
    </div>
  );
}
```

The inbox's times move on every minute (W2 carry-forward). In `apps/web/src/routes/Inbox/InboxRow.tsx`, `Props` gains

```ts
  /** The time now, moving on every minute (lib/time.ts `useNow`). */
  now: Date;
```

after `cursor`; destructure `now`, and the time becomes `{rowTime(row.updatedAt, now)}`. In `apps/web/src/routes/Inbox/Inbox.tsx`, import `useNow` from `'../../lib/time'`, add `const now = useNow();` after the `cursor` state, and pass `now={now}` to each `InboxRowItem`.

In `apps/web/src/lib/inbox.ts`, `chatPath`'s comment becomes `/** A chat's address in the app: the same URL the summary comment links to (spec §10). */`.

- [ ] **Step 15: Run the web tests to see them pass**

Run: `npm test -w apps/web && npm run typecheck && npm run lint`
Expected: PASS, 115 tests (PointCard 5, Chat 9; Inbox 14 and Shell 3 unchanged in number); typecheck and lint clean.

- [ ] **Step 16: Retire the server's transcript page**

The web app now answers `/c/:owner/:repo/:number` (the SPA fallback), so the server's page goes:
- Delete `apps/server/src/http/routes/transcript.tsx`, `apps/server/src/http/pages/transcript.tsx` and `apps/server/src/http/routes/transcript.db.test.ts`.
- In `apps/server/src/http/app.ts`, remove `import { transcriptRoutes } from './routes/transcript';` and `app.route('/', transcriptRoutes(deps));`.
- In `apps/web/vite.config.ts`, remove the `'/c/': SERVER,` proxy line, and its comment becomes `// Still rendered by the server: device approval, until Task 23.`
- In `apps/server/src/lib/urls.ts`, `transcriptUrl`'s comment becomes `/** A chat's page in the web app, which the summary comment and the notifications link to (spec §10). */`; in `apps/server/src/chats/access.ts`, `chatAccessByPath`'s comment drops ", as the transcript page did".
- Delete `docs/why/transcript-page.md`, and create `docs/why/chat-page.md` (what it said about derived activity and untrusted text, now about the web app's screen):

```markdown
# The chat page: what it's waiting on, and text from strangers

**In one sentence:** `/c/<owner>/<repo>/<number>` is the web app's chat screen (`apps/web/src/routes/Chat/`); it shows a line saying what the chat is waiting on right now, worked out when it's read and never stored, and it shows everything people and agents wrote as plain text.

Until W3 the server rendered a plain read-only page at this address. The web app took the address over: the summary comment on GitHub still links here, and who may see it is in [chat-access-rules.md](chat-access-rules.md).

## What it's waiting on (`apps/server/src/chats/activity.ts`)

"leo's agent is waiting: offline since 09:30" is never stored. It's **derived** each time the chat is read, from the chat's queued and running jobs and the CLIs connected right then. Storing it would mean updating it whenever a laptop goes to sleep, which no event tells us about. `deriveActivity` is a pure function (facts in, status out), so every case has a plain table test; `loadActivity` gathers the facts from the database and the CLI hub, and `chats/views.ts` puts it in the chat's view.

Because it isn't stored, nothing changes in the database when a CLI connects or disconnects, so nothing would tell an open chat. The CLI hub reports it instead (`CliHub.onPresence`), and `ws/web-wire.ts` sends again the chats where that person's agent has work and the open chats they take part in, so "waiting" turns into "working", and the presence dot changes, on everyone's screen.

## Text from strangers

Point titles, bodies and replies come from agents and PR authors, so they may contain HTML. React escapes text it renders, like JSX on the server did: `<script>` shows up as text and never runs. Nothing in the chat uses `dangerouslySetInnerHTML`.

## The React analogy

Activity is derived state, like a value you compute from props in render instead of copying it into `useState`: there's nothing to keep in sync, because it's worked out from the source of truth every time.
```

- In `docs/why/content-security-policy.md`, the `frame-ancestors` row's last cell (it pointed at `transcript-page.md`) becomes: "Clickjacking: another site could load one of our pages in an invisible frame and trick you into clicking a button on it, such as "Approve" on the CLI approval page."

Run: `npm test -w apps/server && npm run test:e2e`
Expected: server 700 (716 − the transcript's 16); end to end 5 (the summary comment's link is unchanged).

- [ ] **Step 17: A chat that updates in a real browser (Playwright)**

A review slow enough to see the progress line. Create `apps/cli/src/agents/fake/scenarios/paced.json`:

```json
{
  "review": [
    { "sleep": 1500 },
    { "add_point": { "path": "src/orders.ts", "line": 1, "severity": "major", "category": "bug", "title": "Page size is too big", "body": "Use 25, like the other endpoints." } },
    { "sleep": 500 },
    { "finish": "One point: the page size." }
  ]
}
```

The pretend GitHub only had `refs/pull/42/head`, and a CLI fetches `refs/pull/<number>/head`: every PR the control API opens needs its own. In `apps/server/test/e2e/github.ts`, add before `pushAsHuman`:

```ts
    /**
     * Another PR on the same repo, at the same head as #42: GitHub keeps refs/pull/<number>/head for every PR,
     * and that is what a CLI fetches (the Playwright tests open PRs with other numbers).
     */
    addPull(number: number): void {
      git(root, setup, '--git-dir', bare, 'update-ref', `refs/pull/${number}/head`, headSha);
    },
```

The Playwright tests share one server and database, so each test that opens PRs first forgets the earlier ones (`POST /reset`); and a test can start and stop someone's CLI. Replace `apps/server/test/e2e/web-server.ts` with:

```ts
/**
 * The server the Playwright tests in apps/web/e2e talk to: Plan 1's end-to-end harness (the real server with
 * FakePlatform, Postgres and fake-agent CLIs) on a fixed port, serving the built web app, plus a small
 * control API on a second port that only the tests use (sign someone in, and later: send webhooks, read
 * state). Playwright starts it (apps/web/playwright.config.ts); it is never imported by src/.
 *
 * Run by hand: E2E_WEB_PORT=4319 E2E_CONTROL_PORT=4320 npm run e2e:web-server -w apps/server
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import setupTestDatabase from '../global-setup';
import { testDatabaseUrl } from '../test-database';
import { TEST_ENV } from '../test-env';

const webPort = Number(process.env.E2E_WEB_PORT);
const controlPort = Number(process.env.E2E_CONTROL_PORT);
if (!webPort || !controlPort) throw new Error('Set E2E_WEB_PORT and E2E_CONTROL_PORT (apps/web/playwright.config.ts does).');

// The test database, created and migrated as Vitest's global setup does (it reads the dev DATABASE_URL).
await setupTestDatabase();
const devUrl = process.env.DATABASE_URL!;
// Then the environment the server reads. The page and its API are on this origin.
Object.assign(process.env, TEST_ENV, { PUBLIC_URL: `http://127.0.0.1:${webPort}`, DATABASE_URL: testDatabaseUrl(devUrl) });

// Only now load the server's modules: the database client reads DATABASE_URL when it's first imported.
const { startE2e } = await import('./harness');
const { sessionCookieFor } = await import('../http');
const { people, prEvent, pull } = await import('../fixtures/github');
const { fakeFetch } = await import('../fake-fetch');
const { encrypt } = await import('../../src/lib/crypto');
const { prisma } = await import('../../src/lib/prisma');
const { GithubClient } = await import('../../src/platform/github/client');

const e2e = await startE2e({
  port: webPort,
  webDistDir: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  github: new GithubClient(fakeFetch({ 'GET /repos/octo/sandbox': () => ({ id: 1 }) })),
});
// The inbox asks GitHub whether each person can read a repo, so the test users need a GitHub sign-in on file.
const later = new Date(Date.now() + 365 * 86_400_000);
for (const user of Object.values(e2e.users)) {
  await prisma.githubAuth.create({ data: { userId: user.id, accessTokenEnc: encrypt(`ghu_${user.id}`), accessExpiresAt: later, refreshTokenEnc: encrypt('ghr_x'), refreshExpiresAt: later, status: 'ok' } });
}

const control = new Hono();
/** Sign someone in: answers the session cookie for the browser to use. */
control.post('/signin', async (c) => {
  const { login } = (await c.req.json()) as { login: 'maya' | 'leo' };
  const user = e2e.users[login];
  if (!user) return c.json({ error: `no test user "${login}"` }, 400);
  const [name, value] = (await sessionCookieFor(user.id)).split('=') as [string, string];
  return c.json({ name, value });
});
/** Open a PR on octo/sandbox, as GitHub's webhook would: `author`'s PR, with `reviewer` requested. */
control.post('/pr', async (c) => {
  const { number, title, author, reviewer } = (await c.req.json()) as { number: number; title: string; author: 'maya' | 'leo'; reviewer: 'maya' | 'leo' };
  const base = pull();
  e2e.github.addPull(number);
  await e2e.deliver(
    'pull_request',
    prEvent('opened', {
      pull: {
        number,
        title,
        html_url: `https://github.com/${base.base.repo.full_name}/pull/${number}`,
        user: people[author],
        requested_reviewers: [people[reviewer]],
        head: { ...base.head, ref: `feature-${number}`, sha: e2e.github.headSha },
        base: { ...base.base, sha: e2e.github.baseSha },
      },
    }),
  );
  return c.body(null, 204);
});
/**
 * Forget every PR: the tests share this server and its database, so each test that opens PRs starts here.
 * People, their sign-ins and the installation stay.
 */
control.post('/reset', async (c) => {
  await prisma.$executeRawUnsafe('TRUNCATE "Task", "RawEvent", "SeenComment", "GithubWrite", "PrChat" CASCADE');
  return c.body(null, 204);
});
/** Each person's running CLI, started by a test. */
const clis = new Map<string, Awaited<ReturnType<typeof e2e.startCli>>>();
/** Start someone's `nitpilot start` on the fake agent, with a scenario from apps/cli/src/agents/fake/scenarios. */
control.post('/cli', async (c) => {
  const { login, scenario } = (await c.req.json()) as { login: 'maya' | 'leo'; scenario?: string };
  if (!clis.has(login)) clis.set(login, await e2e.startCli(login, scenario));
  return c.body(null, 204);
});
/** Stop it again, so the next test finds that person's agent offline. */
control.delete('/cli', async (c) => {
  const { login } = (await c.req.json()) as { login: 'maya' | 'leo' };
  await clis.get(login)?.stop();
  clis.delete(login);
  return c.body(null, 204);
});
serve({ fetch: control.fetch, port: controlPort, hostname: '127.0.0.1' });

console.log(`[web-e2e] app on ${e2e.url}, control API on http://127.0.0.1:${controlPort}`);

const stop = async () => {
  await e2e.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

Replace `apps/web/e2e/control.ts` with:

```ts
import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, CONTROL_URL } from './ports';

/** Sign a test user in: the browser gets the session cookie a real GitHub sign-in would have set. */
export async function signIn(context: BrowserContext, login: 'maya' | 'leo'): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/signin`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`signing in ${login} failed: ${res.status} ${await res.text()}`);
  const cookie = (await res.json()) as { name: string; value: string };
  await context.addCookies([{ ...cookie, url: BASE_URL }]);
}

/** Forget every PR the earlier tests opened (they share one server and database). People stay signed up. */
export async function resetChats(): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`resetting failed: ${res.status} ${await res.text()}`);
}

/** Open a pull request on the test repo (octo/sandbox), as GitHub's webhook would. */
export async function openPr(pr: { number: number; title: string; author: 'maya' | 'leo'; reviewer: 'maya' | 'leo' }): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/pr`, { method: 'POST', body: JSON.stringify(pr) });
  if (!res.ok) throw new Error(`opening PR #${pr.number} failed: ${res.status} ${await res.text()}`);
}

/** Start someone's CLI on the fake agent, running a scenario from apps/cli/src/agents/fake/scenarios. */
export async function startCli(login: 'maya' | 'leo', scenario: string): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/cli`, { method: 'POST', body: JSON.stringify({ login, scenario }) });
  if (!res.ok) throw new Error(`starting ${login}'s CLI failed: ${res.status} ${await res.text()}`);
}

export async function stopCli(login: 'maya' | 'leo'): Promise<void> {
  await fetch(`${CONTROL_URL}/cli`, { method: 'DELETE', body: JSON.stringify({ login }) });
}

/**
 * What went wrong on the page: a script error, or something the Content-Security-Policy blocked. (A request
 * that answers 401 is logged by the browser too, but signed out that's expected, so it isn't collected.)
 */
export function pageProblems(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
```

In `apps/web/e2e/inbox.spec.ts`, import `resetChats` beside the others and add `test.beforeEach(resetChats);` before the test.

Create `apps/web/e2e/chat-live.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { openPr, pageProblems, resetChats, signIn, startCli, stopCli } from './control';

test.beforeEach(resetChats);

test('a chat updates while an agent reviews: its progress line, then its summary and point, without a reload', async ({ page, context }) => {
  await openPr({ number: 52, title: 'Paginate invoices', author: 'maya', reviewer: 'leo' });
  const errors = pageProblems(page);
  await signIn(context, 'maya');
  await page.goto('/c/octo/sandbox/52');
  await expect(page.getByRole('heading', { level: 1, name: 'Paginate invoices' })).toBeVisible();
  // leo's CLI isn't connected yet: his review waits.
  await expect(page.getByText("leo's agent · offline")).toBeVisible();

  await startCli('leo', 'paced.json');
  try {
    await expect(page.getByText("leo's agent is reviewing…")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('One point: the page size.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('article', { name: /P1, Major bug point, Open: Page size is too big/ })).toBeVisible();
    await expect(page.getByText("leo's agent is reviewing…")).toBeHidden();
  } finally {
    await stopCli('leo');
  }
  expect(errors).toEqual([]);
});
```

Run: `npm run build && npm run test:e2e -w apps/web`
Expected: PASS, 5 tests. Run it twice more: the inbox test must pass after the chat test too.

- [ ] **Step 18: Look at it (controller, in the in-app browser)**

Start the Playwright server (launch config `nitpilot-e2e-web`), then seed three chats: maya's #52 reviewed by leo's agent with two points, leo's #53 for maya to review, and maya's #54 with a security blocker that escalates:

```bash
C=http://127.0.0.1:4320
curl -s -X POST $C/pr -d '{"number":52,"title":"Paginate invoices with a cursor","author":"maya","reviewer":"leo"}'
curl -s -X POST $C/pr -d '{"number":53,"title":"Retry webhooks with backoff","author":"leo","reviewer":"maya"}'
curl -s -X POST $C/cli -d '{"login":"leo","scenario":"happy.json"}'; sleep 6; curl -s -X DELETE $C/cli -d '{"login":"leo"}'
curl -s -X POST $C/pr -d '{"number":54,"title":"Sign export links","author":"maya","reviewer":"leo"}'
curl -s -X POST $C/cli -d '{"login":"leo","scenario":"security.json"}'; sleep 6; curl -s -X DELETE $C/cli -d '{"login":"leo"}'
```

Sign in with `curl -s -X POST $C/signin -d '{"login":"maya"}'` and set that cookie in the tab (`document.cookie`). Check at 1280 px and 375 px, light and dark: the header (role chip, Open on GitHub, round pips, "leo's agent · offline since …"), the waiting banner with its copy chip on #52 and the red escalation banner on #54, the summary with its counts, the cards (severity bars, category, `path:line`, the snippet with its highlighted line, a card without a snippet ending with room below its text), the details panel at 1280 px (files, people, rules, summary link); on the phone, the back arrow, the header shrinking to one line once the feed scrolls, and the inbox after ‹. Then, with #52 open, start leo's CLI (`curl -s -X POST $C/cli -d '{"login":"leo","scenario":"silent.json"}'`) and stop it: his presence turns online and back to offline without a reload. Click into the feed and press ↓: the feed scrolls and the inbox cursor stays put. Stop the server afterwards: it shares the test database with `npm test`. Screenshots in the task report.

- [ ] **Step 19: Run everything, then commit**

Run: `npm test && npm run typecheck && npm run lint && npm run test:e2e && npm run build && npm run test:e2e -w apps/web`
Expected: protocol 49, CLI 294 passed + 14 skipped, server 700, web 115; end to end 5; Playwright 5; typecheck and lint clean.

```bash
git add -A apps/web apps/server apps/cli/src/agents/fake/scenarios/paced.json docs/why docs/superpowers/plans/2026-10-15-plan-2-web-app.md
git commit -m "feat(web): the chat screen, live over /ws/web; the server's transcript page retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Milestone W4: Actions

W4 lets people drive a chat from the browser: notes to the agents, Resolve and Continue on escalated points (with the extra round), Retry, and Review on an outside contributor's PR.

**Files at the end of W4:**
```
apps/server/src/
  engine/{types,decide,points,advance,state}.ts   point_resolve, point_continue, extraRounds, roundLimit
  chats/{load,save}.ts                            extraRounds; save writes only changed point fields (M2)
  chats/permissions.ts                            write rules
  http/routes/chat-actions.ts                     notes, resolve, continue, review, retry (cookie)
  prisma: PrChat.extraRounds
apps/web/src/
  routes/Chat/{Composer,EscalatedBanner,FailedBanner,…}.tsx
  api/actions.ts                                  useNote, useResolve, useContinue, useReview, useRetry
  components/Toast/…                              useToast
```

### Task 11: Engine: Resolve, Continue and the extra round

**Files:**
- Create: `apps/server/src/engine/human.ts` and `human.test.ts`, a migration (`PrChat.extraRounds Int @default(0)`).
- Modify: `apps/server/src/engine/{types.ts,decide.ts,advance.ts,state.ts,summary.ts}`, `apps/server/src/engine/test-builders.ts`, `apps/server/src/chats/load.ts`, `apps/server/src/chats/save.ts` (**M2**), `apps/server/src/chats/{inbox.ts,views.ts}` (`maxRounds` now adds `extraRounds`) and their tests, `apps/server/prisma/schema.prisma`.

**Interfaces:**
- Produces: `DomainEvent` gains `{ type: 'point_resolve'; who: Person; point: number }` and `{ type: 'point_continue'; who: Person; point: number }`. `ChatState.extraRounds: number`. `roundLimit(ctx): number` = `ctx.rules.max_rounds + ctx.chat.extraRounds` (`engine/state.ts`), used by `advance` and wherever `max_rounds` was read for the limit.

**Behavior:**
- `point_resolve`: only an `escalated` point raised by `who` with origin `agent` changes: → `resolved`, escalation reason cleared, system line "maya resolved P1"; then `advance` (which can reach Ready, notifying reviewers as today). Anything else changes nothing (no line, no commands): the route turns "nothing changed" into a 409 (Task 12).
- `point_continue`: an `escalated` point, by the author or its raiser: → `open`, reason cleared, system line "maya let the agents continue on P1"; if `chat.addressPasses >= roundLimit` before the change, `extraRounds += 1` and the line says "· one more round"; then `advance` (which queues the address job, as auto or draft per the author's switch). A reopened `always_escalate` point stays open (the category check only runs when a point is raised).
- Attention: `refreshAttention` already clears `decision` when no escalated points remain.
- The summary comment shows the limit with extra rounds ("round 4 of 4").
- **M2:** `saveChatState` updates a point row only with the fields that changed between the loaded and the new state, so a field nothing touched (a thread link written by another path) is never overwritten with a stale value.

**Tests this task must include:**
- Resolve: by the raiser → resolved and Ready when nothing else is open; by the author, by another reviewer, on an open point, on a GitHub point → no change.
- Continue: below the limit → open, an address job queued, no extra round; at the limit (`addressPasses == max_rounds`) → `extraRounds` 1 and the address job queued instead of re-escalating at once; a security point continued is not re-escalated by the next address pass; the author's Auto off → the queued job is a draft.
- A disagreement continued and declined again escalates again (`disagreement`), and a second Continue grants another round only if the limit is reached again.
- `save.db.test.ts` (**M2**): a point whose `githubThreadRootId` was set by another write between load and save keeps it after an unrelated event.

### Task 12: Write routes and the access rules for actions

**Files:**
- Create: `apps/server/src/http/routes/chat-actions.ts` and `chat-actions.db.test.ts`.
- Modify: `apps/server/src/chats/permissions.ts` and `permissions.test.ts` (write rules), `apps/server/src/chats/people.ts` (people in the new events), `apps/server/src/http/routes/cli.ts` (the retry route moves to `chat-actions.ts` behind `requireUser`, keeping the CLI's answers), `apps/server/src/http/app.ts`, `packages/protocol/src/web-api.ts` (`NoteRequest`, `ActionResponse`), `apps/server/src/chats/views.ts` (`permissionsFor` fills `Permissions`).

**Interfaces:**
- Consumes: `requireUser`, `requireSameOrigin` (Task 3), `readAccess` (Task 7), `failureKind`, the engine events (Task 11).
- Produces: `type ChatAction = { kind: 'note' } | { kind: 'resolve'; point: number } | { kind: 'continue'; point: number } | { kind: 'review' } | { kind: 'retry' } | { kind: 'auto'; role: Role } | { kind: 'draft'; jobId: string }`. `can(viewer: { githubId: string; userId: string }, facts: PermissionFacts, action: ChatAction): boolean` where `PermissionFacts = { participants: { githubId; role; userId: string | null; requested: boolean; attention: Attention }[]; points: { number; raisedBy; origin; status }[]; drafts: { jobId; participantGithubId }[]; closed: boolean }`. `permissionsFor(viewer, facts): Permissions`. Routes (all `requireUser` + `requireSameOrigin` + `readAccess` + `can`, then `withPeople` and `dispatch`): `POST /api/chats/:id/notes { body }` (1–4 000 characters) → `human_note`; `POST /api/chats/:id/points/:n/resolve`; `POST /api/chats/:id/points/:n/continue`; `POST /api/chats/:id/review` → `manual_review`; `POST /api/chats/:id/retry` (cookie or CLI token). Each answers 200 `{ ok: true }`, 403 `{ code: 'forbidden', message }` when `can` says no, and 409 `{ code: 'conflict', message }` when the engine changed nothing (the message says why in plain words: "P1 isn't escalated any more.", "Someone already resolved P1.").

**Behavior:**
- `can` is the spec §16 list, nothing more; a closed chat allows nothing.
- Retry: a `github_post` failure → 409 with "Reconnect GitHub" wording (the CLI text stays as Plan 1b had it for the CLI); a retry while that person's job is already queued → 409 "Your agent is already on it." (the deferred concurrent-retries minor).
- `docs/why/chat-access-rules.md` gains the write table.

**Tests this task must include:**
- `permissions.test.ts`: the §16 table as rows (note by author / reviewer / reviewer not on Nitpilot / non-participant; resolve by raiser / author / other reviewer / on a GitHub point; continue by author / raiser / other; review by requested / unrequested reviewer; retry/auto/draft only your own; anything on a closed chat).
- `chat-actions.db.test.ts`: each route's happy path dispatches the right event and the item appears in the timeline; a non-participant with read access → 403; no read access → 404; another Origin → 403; **Review Focus 3:** two Resolve requests for the same point → one 200 and one 409; Continue on a point resolved meanwhile → 409; a note of 4 001 characters → 400.
- The CLI's `retry` tests keep passing against the moved route.

### Task 13: Composer, actions and toasts in the chat

**Files:**
- Create: `apps/web/src/routes/Chat/{Composer.tsx,EscalatedBanner.tsx,FailedBanner.tsx,ReadyBanner.tsx,WaitingBanner.tsx,EdgeBanners.tsx,*.module.css,*.test.tsx}`, `apps/web/src/api/actions.ts`, `apps/web/src/components/Toast/{Toast.tsx,useToast.ts}`, `apps/web/e2e/escalation.spec.ts`.
- Modify: `apps/web/src/routes/Chat/{Banners.tsx,UntrustedCard.tsx,Chat.tsx}`.

**Interfaces:**
- Consumes: `Permissions`, `ChatView`, `chatBanner` (Task 10), the routes (Task 12).
- Produces: `useNote(chatId)`, `useResolve(chatId)`, `useContinue(chatId)`, `useReview(chatId)`, `useRetry(chatId)`: TanStack mutations that resolve when the server answers; a 409/403 becomes an error toast with the server's message. `useToast() → { show(text, opts?: { action?: { label; onClick }; error?: boolean }) }`.

**Behavior** (handoff §2 banners and composer, toasts):
- Composer: placeholder "Message the agents…", Send muted when empty and accent with text, ↵ sends and ⇧↵ adds a line, the hint "Notes are included in the agents' next round", toast "Sent. Included in the agents' next round." Read-only (centered `--fg3` text) when `permissions.note` is false: merged/closed PR, not a participant, or GitHub expired ("Reconnect GitHub to send notes as yourself.").
- Escalated banner: one row per escalated point with **Resolve** (only if in `permissions.resolve`) and **Continue** (only if in `permissions.continue`); buttons show pending, then the chat updates through the socket.
- Failed banner: `viewer.failure === 'job'` → "Your agent couldn't finish" with the reason and **Retry**; `'github_post'` → "Posting to GitHub failed" with **Reconnect GitHub**, never Retry.
- Ready banners: author "Waiting for Leo's approval" with "View on GitHub ↗"; reviewer "Ready for your approval" with the primary "Approve on GitHub ↗" (links to the PR's files view). Waiting banner with the copyable `nitpilot start` chip; cap and repo-not-linked banners from the handoff's edge states.
- Untrusted card: **Review** when `permissions.review`; when the viewer's agent is offline it still queues (the system line plus a "Waiting" pill come back through the socket).
- No optimistic updates: what changes on screen comes from the server.

**Tests this task must include:**
- `Composer.test.tsx`: Enter sends, Shift+Enter makes a new line, empty can't send, read-only states show their text.
- `EscalatedBanner.test.tsx`: Resolve only for points in `permissions.resolve`; a 409 shows the server's message as an error toast (**Review Focus 3**).
- `FailedBanner.test.tsx`: Retry for a job failure, Reconnect for a GitHub post failure.
- Playwright `escalation.spec.ts`: the fake agent's security scenario escalates P1; Continue → a round starts; on the next escalation Resolve → the "Ready for your approval" banner.

---

## Milestone W5: Auto and drafts

W5 makes Auto real: settings move to the server (CLI protocol v2), people switch Auto per chat, and with Auto off the agent's work waits as a draft that can be sent (a reviewer's points, or an author's commit pushed by a publish job) or discarded.

**Files at the end of W5:**
```
packages/protocol/src/{enums,cli-messages,job-bundle,job-result,web-api}.ts   protocol v2
apps/server/src/
  engine/{types,jobs,advance,results,drafts,decide,state}.ts   auto_changed, draft_send, draft_discard, publish, byHand
  chats/{load,save,apply-commands,people,views,activity}.ts
  jobs/{assign,bundle}.ts                     publish jobs go to their device only
  ws/{cli-hub,handlers}.ts                    welcome.settings, settings, usedToday
  http/routes/{settings,chat-drafts}.ts       PUT /api/me/settings, PUT auto, drafts send/discard
  prisma: User.{autoReview,autoAddress,dailyJobCap}, Participant.byHand, Job.draftOfId
apps/cli/src/
  runner/{publish,draft}.ts                   publish a draft; describe a draft; prune old draft refs
  runner/{execute,push}.ts, daemon.ts, config/config.ts, commands/doctor.ts
apps/web/src/routes/Chat/{AutoSwitch,DraftCard,DiffView}.tsx
docs/why/drafts-and-publish-jobs.md
```

### Task 14: CLI protocol v2 and settings on the server

**Files:**
- Create: a migration (`User.autoReview Boolean @default(true)`, `User.autoAddress Boolean @default(true)`, `User.dailyJobCap Int @default(40)`), `apps/server/src/http/routes/settings.ts` and `settings.db.test.ts`.
- Modify: `packages/protocol/src/{envelope.ts (PROTOCOL_VERSION = 2), enums.ts (JobType adds 'publish'), cli-messages.ts (Hello without defaults; Welcome.settings; Ping.usedToday; new Settings message in ServerToCli), job-bundle.ts (a publish variant), job-result.ts (JobResult.draft), web-api.ts (Settings, WebMe.settings, WebMe.usedToday)}` and their tests; `apps/server/src/ws/cli-hub.ts` (welcome carries the user's settings; `CliConnection.usedToday`; `sendSettings(userId, settings)`), `apps/server/src/ws/handlers.ts` and `jobs/leases.ts` (read `usedToday` from ping), `apps/server/src/http/routes/me.ts`; `apps/cli/src/{daemon.ts,config/config.ts,state.ts,commands/doctor.ts}` and their tests; `apps/server/scripts/fake-cli.ts`; the e2e harness if it builds hellos.

**Interfaces:**
- Produces (protocol): `Settings = z.object({ autoReview: z.boolean(), autoAddress: z.boolean(), dailyJobCap: z.number().int().min(5).max(200) })`. `Welcome.d.settings: Settings`. `Ping.d.usedToday: number`. `SettingsMessage = message('settings', Settings)` in `ServerToCli`. `JobBundle` becomes `z.discriminatedUnion('type', [AgentJobBundle /* review | re_review | address, as today */, PublishBundle])` with `PublishBundle = { jobId, attempt, type: 'publish', pr: { repoFullName, number, headRef, url }, git: { baseCloneUrl, fetchRef, headRepoPath, headBranch }, draft: { jobId: string; sha: string; from: string } }`. `JobResult.draft: { sha: string; from: string; files: { path; adds; dels }[]; diff: string | null } | null` (optional for old rows: `.nullable().default(null)`). `MAX_DRAFT_DIFF_BYTES = 200 * 1024`.
- Produces (server): `PUT /api/me/settings { Settings }` → 200 `Settings`; it saves and calls `cliHub.sendSettings(userId, settings)`; `WebMe.settings`, `WebMe.usedToday` (sum of `usedToday` over the person's connected CLIs).
- Produces (CLI): the daemon keeps `settings` from `welcome` and each `settings` message, takes the daily cap from it (`counter.take(settings.dailyJobCap)`), and sends `usedToday` (the counter's value) in every ping. `PersonalConfigSchema` accepts `auto` and `dailyJobCap` as deprecated keys and drops them; `doctor` prints "auto and dailyJobCap in config.json are ignored: set them in the web app's Settings page." when they're present.

**Behavior:**
- A CLI speaking protocol 1 is closed with 4426 and the "upgrade" reason (existing check); the e2e harness and the stand-in CLI script speak 2.
- `JobType` gains `publish` here, but nothing queues one until Task 16: the assigner's `MODE_FOR` table maps it to `null` (no agent needed) and skips such jobs until Task 16 routes them, so the type change compiles everywhere without new behavior.
- `usedToday` resets at the CLI's own midnight (the existing `state.json` counter).
- Nothing in the engine changes in this task: Auto defaults reach the engine in Task 15.

**Tests this task must include:**
- Protocol round trips for every changed schema; a v1 hello is refused; a publish bundle and an agent bundle both parse; `JobResult` without `draft` still parses (old rows).
- `settings.db.test.ts`: PUT validates (cap 4 and 201 → 400), saves, and a connected CLI receives `settings`; another Origin → 403.
- `cli-hub.db.test.ts`: welcome carries the user's settings; a ping's `usedToday` shows up in `/api/me`.
- CLI: the cap comes from `welcome` (a cap of 5 turns the sixth job down), a `settings` message changes it while running, pings carry `usedToday`; an old `config.json` with `auto` and `dailyJobCap` loads, and `doctor` says where they moved.

### Task 15: Engine: Auto, drafts, publish and Discard

**Files:**
- Create: `apps/server/src/engine/drafts.ts` and `drafts.test.ts`, `apps/server/src/engine/auto.test.ts`, a migration (`Participant.byHand Boolean @default(false)`, `Job.draftOfId String?`).
- Modify: `apps/server/src/engine/{types.ts,decide.ts,jobs.ts,advance.ts,results.ts,state.ts,lifecycle.ts,external.ts,test-builders.ts}` and their tests; `apps/server/src/chats/people.ts` (fills `Person.autoDefaults` from `User`), `apps/server/prisma/schema.prisma`.

**Interfaces:**
- Produces: `DomainEvent` gains `{ type: 'auto_changed'; who: Person; role: Role; on: boolean }`, `{ type: 'draft_send'; who: Person; jobId: string }`, `{ type: 'draft_discard'; who: Person; jobId: string }`. `Person.autoDefaults?: { review: boolean; address: boolean }`. `Command` gains `{ type: 'set_apply_state'; jobId: string; applyState: 'pending' | 'draft' | 'discarded' }`, and `enqueue_job` gains `draftOfId: string | null` and `jobType: 'publish'`. `ChatState.drafts: DraftState[]` with `DraftState = { jobId; participantGithubId; role: Role; jobType: JobType; headSha: string; result: JobResult }`. `ParticipantState.byHand: boolean`. `JobView` gains `draftOfId: string | null`.

**Behavior** (spec §9 "Auto" and "Drafts"):
- New participants on Nitpilot get `auto` from `autoDefaults` (reviewer → `review`, author → `address`); without defaults (not on Nitpilot) `auto` stays true, as the column default.
- `auto_changed`: only for that person's own role; sets `auto`, a system line ("maya turned Auto-fix off"); their queued (not running) job gets `set_apply_state` to match `autoFor`; turning Auto **on** clears `byHand`, then `advance`.
- A person with a waiting draft gets no other job in that chat: `startReview` and the author's branch of `advance` both hold while `attention === 'drafts'` (the author case is the fix found in the code).
- `draft_send` (only the owner, only a waiting draft):
  - reviewer draft → `set_apply_state applied` and the stored result goes through the same path as `onJobCompleted`'s applied branch (points raised, decisions applied, `lastReviewedSha`, single-player `post_review`), attention cleared, `advance`;
  - author draft → `enqueue_job { jobType: 'publish', draftOfId }` for the author; attention stays `drafts` until the publish job ends; system line "maya is sending the drafted fixes".
- Publish job completed with `push` → the draft's stored address result is applied exactly like `applyAddress`, with the push's commit; the draft becomes `applied`; attention cleared.
- Publish job failed with `branch_moved` or `setup_failed` → not retried: the draft becomes `discarded`, system line "The drafted fixes are out of date: the branch moved" (or "…the draft commit is gone from that computer"), attention cleared, and the chat carries on (`advance`). Other publish failures follow the usual retry rules (`RUN_AGAIN_NOW` doesn't apply to publish jobs).
- `draft_discard` (only the owner, only a waiting draft; also allowed while its publish job is queued, which cancels that job): `set_apply_state discarded`, attention cleared; reviewer → `lastReviewedSha = draft.headSha`, nothing raised; author → `byHand = true`. `advance` doesn't queue an address job while the author is `byHand`; `byHand` clears on a new trusted GitHub comment, a push that isn't ours, `point_continue`, or Auto turned on.

**Tests this task must include** (table tests, one per row):
- Defaults: a reviewer whose `review` default is false gets a draft job on their first review.
- `auto_changed` flips a queued job's apply state; a running job is left alone; someone else's role can't be switched (no change).
- The author with a waiting draft gets no second address job when a new trusted comment arrives.
- Reviewer Send → points in the chat (agent-to-agent) / one `post_review` (single-player) and then the author's address job.
- Author Send → a publish job; its completion applies the replies with the pushed commit and starts the re-review; `branch_moved` → draft discarded, out-of-date line, `advance`.
- **Review Focus 3:** a second `draft_send` for the same draft, a `draft_send` after Discard, and a Discard after the publish job completed change nothing; Discard while the publish job is queued cancels it.
- Discard (reviewer) → counts as reviewed, Ready reachable without new points; Discard (author) → no new address job on the next unrelated event, but a new trusted comment, Continue, or Auto on starts one: **Auto off + Discard never loops.**

### Task 16: Server plumbing for drafts: publish jobs, routes and activity

**Files:**
- Create: `apps/server/src/http/routes/chat-drafts.ts` and `chat-drafts.db.test.ts`, `docs/why/drafts-and-publish-jobs.md`.
- Modify: `apps/server/src/chats/{load.ts,save.ts,apply-commands.ts,views.ts,activity.ts}`, `apps/server/src/jobs/{assign.ts,bundle.ts}`, `apps/server/src/ws/handlers.ts`, `apps/server/src/chats/permissions.ts` (`draft` and `auto` actions), their tests.

**Interfaces:**
- Consumes: the engine changes (Task 15), the publish bundle (Task 14).
- Produces: `loadChat` fills `ChatState.drafts` (jobs with `applyState: 'draft'` and `status: 'done'`, with their results) and `byHand`; `applyCommands` handles `set_apply_state` and `enqueue_job` with `draftOfId`. No new column pins the device: the assigner reads the draft job's `cliTokenId` through `draftOfId`. The assigner gives a `publish` job only to the connection whose `tokenId` equals the draft job's `cliTokenId`, with the repo linked, ignoring agent modes. `buildJobBundle` builds a `PublishBundle` for publish jobs. `deriveActivity` gets, per job, `onlyTokenId: string | null`: a publish job waits as "offline" when *that* device isn't connected, even if another of the person's devices is. Routes: `PUT /api/chats/:id/auto { role, on }` → `auto_changed`; `POST /api/chats/:id/drafts/:jobId/send` → `draft_send`; `POST /api/chats/:id/drafts/:jobId/discard` → `draft_discard` (same checks and answers as Task 12). `ChatView.drafts: DraftView[]` with `DraftView = { jobId; owner: string; role: Role; jobType: JobType; headSha; createdAt; result: JobResult; sending: boolean }`; `Permissions.auto` and `Permissions.drafts` filled.

**Behavior:**
- A job result arriving for a draft address job stores `result.draft` as sent by the CLI (the engine doesn't read it; the web app shows it).
- The drafts explainer: what a draft is, why the author's commit stays on the laptop (the server never touches code, §7), how a publish job reuses leases, fencing and acks, what "out of date" means, and why Discard doesn't loop; points to `engine/drafts.ts`, `jobs/assign.ts`, `apps/cli/src/runner/publish.ts`.

**Tests this task must include:**
- The assigner gives a publish job to the draft's device only; with only the person's *other* device online it stays queued; **Review Focus 4:** the activity says "waiting, offline since …" for that device even though another device is online.
- `chat-drafts.db.test.ts`: send and discard by the owner; by someone else → 403; **Review Focus 3:** Send twice → 200 then 409 "That draft is already being sent."; Send after Discard → 409; Auto switch for a role you don't have → 403; another Origin → 403.
- A publish job's `job.complete` with a push applies the stored replies (handlers + engine through the real dispatcher); `job.fail branch_moved` marks the draft out of date.
- `ChatView` lists waiting drafts with their results for the owner and for other viewers (others see them as "Leo's agent has drafts waiting" without the actions).

### Task 17: The CLI publishes drafts and describes them

**Files:**
- Create: `apps/cli/src/runner/publish.ts` and `publish.test.ts`, `apps/cli/src/runner/draft.ts` and `draft.test.ts`.
- Modify: `apps/cli/src/runner/{execute.ts,push.ts}`, `apps/cli/src/commands/start.ts` (prune old draft refs at start), `apps/cli/src/daemon.ts` (a publish bundle runs no agent and doesn't count toward the daily cap), their tests; `apps/server/test/e2e/scenarios.e2e.test.ts` (a draft scenario).

**Interfaces:**
- Consumes: `PublishBundle`, `JobResult.draft`, `MAX_DRAFT_DIFF_BYTES` (Task 14), `safeGit`, `pushTarget`, `JobFailure` (Plan 1b).
- Produces: `publishDraft(bundle: PublishBundle, ctx: { clonePath: string; hooksDir: string; pushing(from, to): Promise<'applied' | 'stale'>; signal: AbortSignal; env }): Promise<{ push: PushInfo }>`. `describeDraft(place: GitPlace, from: string, to: string): Promise<NonNullable<JobResult['draft']>>` (`git diff --numstat -z from to` for files, `git diff --no-ext-diff --no-textconv --no-color from to` for the patch, null when over the cap). `pruneOldDraftRefs(repoPaths: string[], hooksDir, now: Date): Promise<number>` (draft refs whose commit's committer date is older than 14 days).

**Behavior** (spec §11 draft mode and publish jobs):
- Draft address job: after the commit, `update-ref refs/nitpilot/drafts/<job>` as today, then `describeDraft(head, draftSha)`; the result carries `draft` and `push: null`.
- Publish job: no worktree and no agent. `rev-parse refs/nitpilot/drafts/<draft job>` in the linked clone must equal `draft.sha`, else `JobFailure('setup_failed', false, 'The drafted commit isn't on this computer any more…')`; `pushing(draft.from, draft.sha)` (`stale` → `stale_head`, retryable); `git push --porcelain --no-verify -- <remote> refs/nitpilot/drafts/<job>:refs/heads/<headBranch>`, never forced, non-fast-forward → `branch_moved`; then `update-ref -d` the draft ref; complete with `{ summary: '', points: [], decisions: [], replies: [], push: { from, to }, draft: null }`.
- At `nitpilot start`, after `cleanUpWorktrees`, `pruneOldDraftRefs` runs on every linked clone; failures are logged, never fatal.

**Tests this task must include** (real git in the sandbox fixtures):
- A draft address job's result names the commit, lists files with counts, and carries the patch; a commit with a 300 KB change has `diff: null` and the file list.
- Publish: pushes the draft to the branch (the bare repo's branch tip is the draft sha), deletes the ref, reports the push; **Review Focus 4:** a missing ref and a ref that moved → `setup_failed`, not retryable, nothing pushed; someone pushed meanwhile → `branch_moved`, nothing forced; a `stale` ack → nothing pushed.
- Pruning removes only draft refs older than 14 days and leaves other refs alone.
- e2e: Auto off for the author → the address result waits as a draft; Send (route) → the publish job runs on the author's CLI and the re-review follows.

### Task 18: Auto switch and draft cards in the chat

**Files:**
- Create: `apps/web/src/routes/Chat/{AutoSwitch.tsx,DraftCard.tsx,DiffView.tsx,*.module.css,*.test.tsx}`, `apps/web/src/api/drafts.ts`, `apps/web/e2e/drafts.spec.ts`.
- Modify: `apps/web/src/routes/Chat/{ChatHeader.tsx,Timeline.tsx}`.

**Interfaces:**
- Consumes: `ChatView.drafts`, `Permissions.auto`, `Permissions.drafts`, the routes (Task 16).
- Produces: `useAutoSwitch(chatId)`, `useSendDraft(chatId)`, `useDiscardDraft(chatId)`; `<AutoSwitch role on disabledReason={'outside_contributor' | 'team_review' | 'team_address' | null} onToggle />`; `<DraftCard draft={DraftView} canAct={boolean} />`; `<DiffView diff={string} files={...} />` (unified diff split by file, +/- lines colored with `--ok`/`--red`, each file collapsible, long files collapsed by default).

**Behavior:**
- Auto switch (handoff §2): "Auto-review" for reviewers, "Auto-fix" for the author, `role=switch` + `aria-checked`, 30 px pill with the 30×18 track. **§16 fix:** disabled with **one tooltip per reason**: "Off for PRs from outside contributors." when the PR isn't trusted (reviewer side), "Your team turned off auto-review in .nitpilot.yml." / "…auto-fix…" when the team forbids it. Toggling shows a toast ("Auto-fix is off. Your agent's work will wait as drafts.").
- Draft cards in the timeline where the draft's job finished: a reviewer draft shows its points as point cards marked **Draft**, with the summary; an author draft shows each reply (fixed / answered / declined with its comment) and the diff (or the file list and a copyable `git show <sha>` command when `diff` is null). **Send** (primary) and **Discard** (outlined) for the owner; "Sending…" while the publish job runs; others see the card without buttons.
- An out-of-date draft disappears with the system line from the server; nothing on the client decides that.

**Tests this task must include:**
- `AutoSwitch.test.tsx`: label per role, `aria-checked`, each disabled reason shows its own tooltip text (and never both).
- `DraftCard.test.tsx`: reviewer and author variants, a null diff shows the file list and the command, buttons only with `canAct`, "Sending…" state.
- `DiffView.test.tsx`: two files, additions and deletions marked, collapse toggles.
- Playwright `drafts.spec.ts`: turn Auto-fix off, a review comes in, the author's draft card appears with its diff, Send → the pushed commit's system line and the re-review start.

---

## Milestone W6: Web Push and PWA

W6 sends notifications as Web Push to every browser and device a person subscribed, with the CLI as fallback, and makes the web app installable.

**Files at the end of W6:**
```
apps/server/src/
  tasks/push-notifier.ts         PushNotifier (web-push), FallbackNotifier
  http/routes/push.ts            POST/DELETE /api/push/subscriptions
  lib/env.ts                     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
  scripts/vapid-keys.ts          npm run vapid:keys
  prisma: PushSubscription
apps/web/
  public/sw.js, public/manifest.webmanifest, public/icons/*
  scripts/render-icons.ts        Playwright renders the SVG icon to PNGs (run by hand, output committed)
  src/push/{register.ts,subscribe.ts}, src/components/{InstallCard,IosHomeScreenSheet}/…
docs/why/web-push.md, docs/why/service-workers-and-pwa.md
```

### Task 19: Web Push on the server, with the CLI as fallback

**Files:**
- Create: `apps/server/src/tasks/push-notifier.ts` and `push-notifier.db.test.ts`, `apps/server/src/http/routes/push.ts` and `push.db.test.ts`, `apps/server/scripts/vapid-keys.ts`, a migration (`PushSubscription`), `docs/why/web-push.md`.
- Modify: `apps/server/package.json` (`web-push`, `@types/web-push`, `vapid:keys` script), `apps/server/src/lib/env.ts` and `.env.example` (VAPID variables, optional: push is off without them), `apps/server/src/tasks/notifier.ts` (`Notifier.notify` returns who was reached), `apps/server/src/tasks/cli-notifier.ts`, `apps/server/src/main.ts`, `apps/server/src/http/routes/me.ts` (`WebMe.push`), `packages/protocol/src/web-api.ts` (`PushSubscriptionRequest`, `WebMe.push`).

**Interfaces:**
- Produces: model `PushSubscription { id, userId, endpoint String @unique, p256dh, auth, label, failCount Int @default(0), createdAt, updatedAt }`. `type PushSend = (sub: { endpoint; keys: { p256dh; auth } }, payload: string) => Promise<{ ok: true } | { ok: false; gone: boolean; error: string }>` (production: `web-push`'s `sendNotification` with the VAPID details, a 404/410 status → `gone`); `class PushNotifier implements Notifier { constructor(send: PushSend) }`; `class FallbackNotifier implements Notifier { constructor(primary: Notifier, fallback: Notifier) }` (the fallback gets only the user ids the primary didn't reach). `Notifier.notify(n): Promise<{ reached: string[] }>`. Payload: `{ title, body, url, tag: chatId }`, from the notify task's existing titles split into title and body per the handoff's §8 copy. `POST /api/push/subscriptions { endpoint, keys: { p256dh, auth }, label }` (upsert by endpoint; an endpoint owned by another user moves to this one), `DELETE /api/push/subscriptions { endpoint }`. `WebMe.push = { vapidPublicKey: string | null; subscribed: boolean }` (`subscribed`: this user has any subscription).

**Behavior:**
- Each subscription is sent separately; one success reaches the user. `gone` → the row is deleted; another error adds 1 to `failCount`, and a row at 5 failures in a row is deleted (a success resets it).
- A send error never fails the notify task for the others; the task fails (and retries) only if the database fails.
- No VAPID keys configured → `PushNotifier` reaches nobody, so every notification goes to the CLI as in Plan 1.
- `docs/why/web-push.md`: what a push service is, what VAPID keys prove, why the payload is encrypted, what 410 means, and the push-first-CLI-fallback rule; points to `tasks/push-notifier.ts`.

**Tests this task must include:**
- **Review Focus 5:** a user whose only subscription answers 410 → the row is deleted and the CLI gets that same notification; a user with one working and one gone subscription → push reaches them, the CLI gets nothing; a user with no subscription → CLI only; never both for one user.
- `failCount` grows on errors, resets on success, deletes at 5.
- Routes: subscribe, re-subscribe the same endpoint (no duplicate), move an endpoint to another user, unsubscribe; another Origin → 403; `WebMe.push.vapidPublicKey` is null without keys.

### Task 20: Service worker, manifest, icons, subscribing and installing

**Files:**
- Create: `apps/web/public/sw.js`, `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/{icon.svg,icon-192.png,icon-512.png,maskable-512.png,apple-touch-icon.png}`, `apps/web/scripts/render-icons.ts`, `apps/web/src/push/{register.ts,subscribe.ts}` (+ tests), `apps/web/src/sw.test.ts` (loads `public/sw.js` with a fake `self`), `apps/web/src/components/{InstallCard,IosHomeScreenSheet}/…`, `docs/why/service-workers-and-pwa.md`.
- Modify: `apps/web/index.html` (manifest link, `theme-color` #16707f, apple-touch-icon, `apple-mobile-web-app-capable`), `apps/web/src/main.tsx` (register the service worker), `apps/web/src/routes/Shell/…` (install card and iOS sheet).

**Interfaces:**
- Consumes: `WebMe.push.vapidPublicKey`, the push routes (Task 19).
- Produces: `registerServiceWorker(): Promise<ServiceWorkerRegistration | null>`; `pushState(): Promise<'unsupported' | 'needs_home_screen' | 'denied' | 'off' | 'on'>`; `turnPushOn(vapidKey): Promise<void>` (asks permission, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, posts it with a label from the user agent); `turnPushOff(): Promise<void>`. `sw.js` handles `push` (shows `title`/`body`, `tag` = chat id so a chat's notifications replace each other, `data.url`) and `notificationclick` (focuses a tab already on that URL, else opens it).

**Behavior** (handoff §8, §9):
- Manifest: name and short name from `BRAND`, `start_url: '/'`, `display: 'standalone'`, `theme_color` and `background_color` #16707f, icons (maskable with the safe zone; the diamond dropped below 32 px).
- Install card (Chromium's `beforeinstallprompt`): bottom-left 380 px card, "Install Nitpilot" copy, Install / Not now (remembered). iOS Safari not standalone: the "Add Nitpilot to your Home Screen" sheet with its three steps and "Got it", shown once after sign-in and from Settings.
- No offline cache: `sw.js` has no `fetch` handler.
- `docs/why/service-workers-and-pwa.md`: a service worker as a tiny program the browser keeps for your site, why it's the only thing that can receive a push with the tab closed, what makes an app installable, and the iOS Home Screen rule; points to `public/sw.js`, `src/push/`.
- **Live step (ask first):** in desktop Chrome on `localhost`, turn push on from a temporary button in the shell (Settings arrives in Task 21) and trigger a notification through the stand-in path; the phone check waits for the acceptance run (Task 25).

**Tests this task must include:**
- `sw.test.ts`: a push event shows a notification with the payload's title, body, tag and url; a click focuses an existing client on the URL or opens a new window.
- `subscribe.test.ts` (fake `Notification`, `navigator.serviceWorker`, `PushManager`): `pushState` for each case, including iOS not standalone → `needs_home_screen`; `turnPushOn` posts the subscription; denied permission doesn't post.
- `npm run build` copies `sw.js` and the manifest to the root of `dist`; the server serves them with `no-cache` (Task 2's rule).
- Browser check (by hand, no audit tool): Chrome offers "Install", and the installed window opens on the inbox.

---

## Milestone W7: Settings, onboarding and device approval

W7 finishes the screens: Settings, the onboarding checklist that ticks itself off, and CLI device approval in the web app. The last server-rendered pages are removed.

**Files at the end of W7:**
```
apps/server/src/
  http/routes/{devices,onboarding,cli-requests}.ts
  platform/github/reads.ts       userInstallations (with the user's token)
  (deleted) http/pages/*, http/routes/cli-approve.tsx, the JSX settings in tsconfig
apps/web/src/routes/{Settings,Setup,Approve}/…
```

### Task 21: Settings page

**Files:**
- Create: `apps/server/src/http/routes/devices.ts` and `devices.db.test.ts`, `apps/web/src/routes/Settings/{Settings.tsx,Devices.tsx,Agent.tsx,Notifications.tsx,Defaults.tsx,Account.tsx,*.module.css,*.test.tsx}`, `apps/web/src/api/settings.ts`.
- Modify: `packages/protocol/src/web-api.ts` (`DeviceView`, `DevicesResponse`, `WebMe.agents`), `apps/server/src/ws/cli-hub.ts` (`closeToken(tokenId, code)`), `apps/server/src/http/app.ts`, `apps/web/src/app.tsx`.

**Interfaces:**
- Consumes: `PUT /api/me/settings` (Task 14), `pushState`/`turnPushOn`/`turnPushOff` (Task 20), `POST /auth/logout`.
- Produces: `GET /api/devices` → `{ devices: DeviceView[] }` with `DeviceView = { id; name; prefix; lastSeenAt: string | null; online: boolean; agent: { id: AgentId; version: string | null } | null; repos: string[] }` (agent and repos from the live connection; revoked tokens left out). `DELETE /api/devices/:id` → 204: sets `revokedAt` and closes that CLI's socket with 4401 (log in again). `WebMe.agents: { id: AgentId; version: string | null; online: boolean }[]` (distinct agents across your CLIs).

**Behavior** (handoff §7):
- Desktop 180 px section nav (Devices, Agent, Notifications, Defaults, Account); phone: stacked cards; "‹ Inbox" top bar.
- Devices: name, "Last seen …" or "Online", **Revoke** (red text, outlined), then the toast "Revoked. That computer has to log in again." (no Undo: the token is gone). The handoff's "This device" chip is about the browser's own computer, which the server can't know: it is dropped, and online devices get an "Online" chip instead (recorded as a deviation in the step-level notes).
- Agent: each reported agent with its version and a `✓ Online` / "Not connected" chip; with none: "Install Claude Code, then run `nitpilot start`."
- Notifications: the Push switch (46×28) from `pushState`; the iOS tip when `needs_home_screen`; "Blocked in your browser's settings" when denied.
- Defaults: Auto-review and Auto-fix switches, the daily cap stepper (−/+ by 5, 5–200) with "Max 40 agent runs per day · 12 used today" and the usage bar; saved at once.
- Account: avatar, name/login, mono `github.com/<login>`, **Sign out** (POST `/auth/logout`, then the landing).

**Tests this task must include:**
- `devices.db.test.ts`: lists only your own unrevoked devices with live agent info; revoking another user's device → 404; revoking closes the socket with 4401; another Origin → 403.
- `Defaults.test.tsx`: the stepper stops at 5 and 200, steps by 5, saves; switches save.
- `Notifications.test.tsx`: each `pushState` shows its control or message.
- `Devices.test.tsx`: Revoke calls the route and the device disappears after refetch.

### Task 22: Onboarding that ticks itself off

**Files:**
- Create: `apps/server/src/http/routes/onboarding.ts` (or inside `me.ts`) and its db test, `apps/web/src/routes/Setup/{Setup.tsx,ChecklistRow.tsx,CommandBlock.tsx,*.module.css,*.test.tsx}`.
- Modify: `apps/server/src/platform/github/reads.ts` and `platform/types.ts` (`userInstallations`), `apps/server/src/http/routes/setup.ts` (`/github/setup` redirects to `/setup`), `apps/server/src/http/routes/auth.ts` (a first sign-in with onboarding incomplete goes to `/setup` unless `next` says otherwise), `apps/server/src/ws/web-wire.ts` (`me.update` carries onboarding), `packages/protocol/src/web-api.ts` (`Onboarding`, `WebMe.onboarding`).

**Interfaces:**
- Produces: `WebMe.appSlug: string` (for the install link) and `Onboarding = { signedIn: true; appInstalled: boolean; cliConnected: boolean; repoLinked: boolean; agentStarted: boolean; done: boolean }`. `appInstalled` = the user's own token sees at least one installation of this app (`GET /user/installations`, kept 5 minutes like `RepoAccess`); `cliConnected` = any unrevoked CLI token; `repoLinked` = a connected CLI reports at least one repo (or one did since the server started); `agentStarted` = a connected CLI reports an agent with at least one mode. `PlatformReads.userInstallations(userId): Promise<{ id: string; accountLogin: string }[]>`.

**Behavior** (handoff §5):
- Title, progress bar "N of 5", the five rows with done / waiting (spinner) / pending (number) icons and the command blocks with Copy: `npx nitpilot login` (from `BRAND`), `nitpilot repos add`, `nitpilot start` with the "detected automatically" agent chips (Claude Code; Gemini CLI shown as "coming later" while Task 20 is on hold). Install row links to the app's install page (`https://github.com/apps/<GITHUB_APP_SLUG>/installations/new`, slug from `WebMe`). The note "nitpilot.dev covers public repos only" only when the server runs with `PUBLIC_REPOS_ONLY`.
- **Ticks itself off:** `me.update` on `/ws/web` refreshes `me` when a CLI connects or reports repos; the app-installed step re-checks when the window regains focus (GitHub's install page is another tab).
- "Skip for now" goes to the inbox; the checklist stays reachable from Settings until `done`.

**Tests this task must include:**
- Onboarding facts: each flag from its source (a seeded installation answer from the fake GitHub fetch, a CLI token, a connected CLI with and without repos and modes); `/github/setup` redirects to `/setup`; a first sign-in lands on `/setup`.
- `Setup.test.tsx`: the rows reflect the facts, and a `me.update` that sets `cliConnected` advances the list without a reload.

### Task 23: Device approval in the web app; the server pages go

**Files:**
- Create: `apps/server/src/http/routes/cli-requests.ts` and `cli-requests.db.test.ts`, `apps/web/src/routes/Approve/{Approve.tsx,*.module.css,Approve.test.tsx}`.
- Modify: `packages/protocol/src/web-api.ts` (`CliRequestView`, `CliRequestDecision`), `apps/server/src/http/app.ts`, `apps/server/src/http/errors.ts` (no HTML), `apps/server/tsconfig.json` (no JSX left), `apps/cli` texts only if they name the page differently (they shouldn't: the URL stays `/cli/approve?code=`).
- Delete: `apps/server/src/http/routes/cli-approve.tsx`, `apps/server/src/http/pages/{approve,layout}.tsx` and their tests (the transcript and home pages went in Tasks 2 and 10).

**Interfaces:**
- Consumes: `findCliLogin`, `decideCliLogin` (`auth/cli-login.ts`).
- Produces: `GET /api/cli/requests/:userCode` → `CliRequestView = { userCode; deviceName; requestedAt: string; expiresAt: string; status: 'pending' | 'approved' | 'denied' | 'expired' }` (an unknown code → 404); `POST /api/cli/requests/:userCode { decision: 'approve' | 'deny' }` → the new `CliRequestView` (requireUser + requireSameOrigin). The SPA route `/cli/approve?code=` signs you in first (`/auth/github/login?next=…`) when `useMe()` is null.

**Behavior** (handoff §6): the centered 440 px card in four states: Pending (the code large in mono, device row, Approve / Deny, "The code expires in 9:41." counting down from `expiresAt`), Approved, Denied, Expired (with the `npx nitpilot login` command block). A countdown that reaches zero switches to Expired without a request.

**Tests this task must include:**
- `cli-requests.db.test.ts`: view a pending code; approve → the CLI's next poll gets a token (existing `pollCliLogin`); deny; an expired code can't be approved; another Origin → 403; not signed in → 401.
- `Approve.test.tsx`: the four states, the countdown flipping to Expired (fake timers).
- Nothing under `apps/server/src/http/pages/` remains, and `grep -r renderPage apps/server/src` is empty; every server answer that is HTML now comes from `spa.ts` with the CSP header.

---

## Milestone W8: Proof

W8 makes the browser suite part of CI, then proves Plan 2 live on the sandbox repo, on desktop and on the person's phone.

### Task 24: Playwright suite in CI

**Files:**
- Modify: `apps/web/e2e/*.spec.ts` (gathered from Tasks 3, 6, 10, 13 and 18), `apps/web/playwright.config.ts` (one worker, retries 0, trace on failure), `apps/server/test/e2e/web-server.ts`, `.github/workflows/ci.yml` (cache Playwright's Chromium, upload traces on failure).

**Behavior:**
- The suite covers the four flows of spec §19: the inbox opens; a chat updates live while agents work; Resolve on an escalation; Send on a draft. Each test seeds its own chat and user through the control API, so tests don't depend on each other's order.
- Flakes: no fixed sleeps; every wait is on something visible (`expect(locator).toBeVisible()`), or on the control API's `GET /state`.
- `npm run test:web-e2e` runs three times in a row green locally before the task is done.

**Tests this task must include:** the four flows above, plus the read-only view: a second seeded user with read access but no role sees the chat without the composer or action buttons.

### Task 25: Acceptance runbook, the live run and docs

**Files:**
- Create: `docs/acceptance/plan-2.md` (the runbook: numbered click-steps per account, spelled out), any helper SQL beside it.
- Modify: `README.md` (web app section), `docs/why/` index if one exists, the spec (§20 and §22 notes from the run), this plan's "Checked against the code (W8)".

**Behavior:**
- The runbook follows spec §20's Plan 2 acceptance test: setup (fresh database as in Plan 1, the web app built and served, both accounts signed in to the web app in their own browsers, A on Claude Code with the built CLI, B on the fake agent), then each criterion with what to click and what you should see, and the phone section: the tunnel's HTTPS URL as `PUBLIC_URL`, adding its `/auth/github/callback` to `nitpilot-dev` for the run, Add to Home Screen on iPhone, turning push on, and removing the callback URL afterwards.
- **Live steps (ask before each):** starting the tunnel and server, every GitHub write, and each Claude Code run. Results are recorded in a second commit, as in Plan 1b Task 24.

**Tests this task must include:** every criterion of spec §20's Plan 2 acceptance test checked off live, with the evidence (screenshots, the database checks, the CLI terminal lines) recorded in the runbook's results section.
