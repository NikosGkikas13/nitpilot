# Plan 4: growth features, in small chunks

## Context

Nitpilot works (Plans 1–3 shipped, 0.2.2 on npm, nitpilot.dev live). The feature most people need, the two-agent loop, only shows up once a teammate has signed up too, and trying it at all takes five setup steps. This plan adds the nine ideas from the brainstorm, in an order where each milestone ships on its own and later ones build on earlier ones. Each **task** is one turn of work: build it, run its test, stop for review, then commit and push to main (the usual workflow). Each **milestone** ends with a release.

Decisions already made:
- Playground agents run on the Hetzner box with the **fake agent** (scripted, no real AI, no cost).
- Offline reviews use a **GitHub Action with the user's own API key**. The server doesn't change.

Rules carried over from CLAUDE.md: update the spec section in the same change, add a `docs/why/<topic>.md` the first time a new backend idea shows up, keep workflow rules in `apps/server/src/engine/`, no new infrastructure.

## Order at a glance

| # | Milestone | Size | Depends on |
|---|-----------|------|------------|
| G1 | `nitpilot review <pr-url>` (try it with no account) | 5 tasks | — |
| G2 | Public chat pages + invite footer | 4 tasks | — |
| G3 | Decide from the notification | 2 tasks | — |
| G4 | Public playground (fake bots) | 4 tasks | G2 |
| G5 | Team guidelines + `nitpilot rules suggest` | 3 tasks | G1 (GitHub reads in the CLI) |
| G6 | Stats | 2 tasks | — |
| G7 | More agents: Codex, Gemini by API key | 2 tasks | — |
| G8 | GitHub Action for offline reviews | 3 tasks | G1 |

G1 and G2 are where people try it and share it, so they come first. Releases (the CLI is already 0.3.1): G1 → 0.4.0, G2+G3 → 0.5.0, then one minor version per milestone.

---

## G1: `nitpilot review <pr-url>`

A one-off review of any PR, run by your own agent, with no account, no GitHub App and no daemon. It prints the points, and `--post` posts them as your GitHub review.

What already does the work: `createExecutor` in `apps/cli/src/runner/execute.ts` takes an `AgentJobBundle` (`packages/protocol/src/job-bundle.ts`) and returns a `JobResult` with `points`. The server builds that bundle today; the CLI just has to build it itself.

**Task 1: build a bundle from GitHub.** New `apps/cli/src/github/pr-bundle.ts`: read the PR (`GET /repos/:o/:r/pulls/:n`) and the signed-in user (`GET /user`) with a token from `GITHUB_TOKEN` or `gh auth token`, and fill an `AgentJobBundle` (`type: 'review'`, `apply: 'draft'`, round 1, `jobId: local-<random>`, `points: []`, `notes: []`). Rules: read `.nitpilot.yml` from the default branch and parse it. `parseTeamRules` lives in `apps/server/src/engine/rules.ts`; moved to `packages/protocol/src/rules-file.ts`, imported as `@nitpilot/protocol/rules-file` so `yaml` stays out of the web bundle. **Done 2026-10-31.** Test: a fixture PR JSON gives the right bundle, compared with `jobBundle()` in `test-samples.ts`.

**Task 2: where the code comes from.** If the repo is linked (`config.repos`), use that clone. Otherwise an empty `git init` repo in the config dir (`<config dir>/cache/<owner>/<name>`): `prepareWorktree` already fetches the PR head and base into it, so nothing is cloned up front. `reviewRepoPath` in `apps/cli/src/runner/repo-cache.ts`. **Done 2026-10-31.** Test: a local bare repo from the `worktree.test.ts` helpers.

**Task 3: the command.** `apps/cli/src/commands/review.ts`, registered in `cli.ts` as `review <pr-url> [--post]`. Start the local MCP server the way `start.ts` does, run the executor, print the points with `out.ts` (path:line, severity, title, body). Works with no `nitpilot login`: build a minimal `PersonalConfig` when none exists. Exit codes: 0 when the review finished (points or not), 1 when it failed, like every other command. Test: run it with the fake adapter. **Done 2026-10-31.** Also fixed: tsup now gives the bundle a `require` (createRequire banner), since bundled yaml is CommonJS.

**Task 4: `--post`.** Post one GitHub review (`POST /pulls/:n/reviews`, `event: COMMENT`) with the points as inline comments, using the user's token. Ask "Post 3 comments to acme/api#12 as @you? [y/N]" first (skip the question with `--yes`). Copy the point → comment format from the server's GitHub adapter (`apps/server/src/platform/`), don't import it. Add a footer line (see G2 Task 4). Test: the request body for `jobResult()`'s points. **Done 2026-10-31.** `sanitizeForGithub` moved to `packages/protocol/src/sanitize.ts` so the CLI cleans agent text exactly as the server does; `--post` without a terminal needs `--yes`.

**Task 5: docs and release.** README "Try it in 30 seconds" (`npx nitpilot review <url>`), a docs-site CLI page entry, spec §11 new subsection "One-off reviews", changelog. Release 0.4.0. **Done 2026-10-31** (live run: `docs/acceptance/plan-4-g1.md`).

Verify: on the sandbox repo, `npx nitpilot review <sandbox PR>` with Claude Code prints points; `--post` puts a review on GitHub with inline comments; it works on a machine that never ran `nitpilot login`.

---

## G2: Public chat pages + invite footer

Anyone can open a chat for a **public** repo without signing in. It's read-only and only shows what's already public on GitHub, and it has a preview card for social sharing.

**Task 1: server read access for public repos.** Store whether a repo is private (from the installation and repository webhooks; check whether `Repo` has it already, and add a migration if not). In `apps/server/src/chats/access.ts`, `chatAccessByPath` gives signed-out visitors `read-public` for public repos. The public view leaves out human notes, drafts and failure details. Write down exactly what it shows in spec §16 "Who can see a chat". Test: `access.db.test.ts` cases for public/private and signed-in/signed-out. **Done 2026-10-31**, as a separate route, `GET /api/public/chats/:owner/:repo/:number`. The user chose "trimmed, opt-out": on by default, `public_chats: false` in `.nitpilot.yml` turns it off. The repo is checked public both as stored and as GitHub says now (`PlatformReads.isRepoPublic`, kept 5 min). Hidden: all human messages, drafts, failure/waiting lines, `offlineSince`. No `before=` paging or live updates for visitors. Task 2 adds the docs-site line (security page) once the page exists.

**Task 2: read-only chat in the web app.** The chat route renders without a session when the server says `read-public`: no composer, no actions, plus a banner "This is <author>'s and <reviewer>'s agents reviewing a PR · Get your own" linking to the landing page. Reuse the chat components; hide the actions behind one `readOnly` prop. **Done 2026-10-31.** Signed out, `Home` opens `/c/...` as `PublicChat` (`routes/Chat/Chat.tsx`) from `GET /api/public/chats/...`; a 404 shows the landing page. Instead of a separate `readOnly` prop, `ChatScreen` takes `me: null` for a visitor: no composer, no banner (so no Resolve/Continue/Retry), no file list (that route needs a session); the server's empty `permissions` already hide the Auto switch and Review. Banner: "maya's and leo's agents reviewing this PR" (`visitorTitle` in `lib/banner.ts`), **Get your own** and **Sign in**. No socket (none outside the signed-in app). Docs: security page.

**Task 3: preview cards.** Crawlers don't run JavaScript, so the server fills `<meta property="og:*">` (PR title, "3 points · 2 rounds · ready to approve") into `index.html` when it serves `/c/:owner/:repo/:number` for a public chat. Text only, no generated image (`shortcut:` comment: add an OG image if shares look bare). Test: the HTML for a public chat has the tags, and a private one doesn't.

**Task 4: invite footer.** In `renderSummary` (`apps/server/src/engine/summary.ts`), one last line: `Reviewed by @leo's agent · [get your own](https://nitpilot.dev)`. In `.nitpilot.yml`, `footer: false` (new field in `TeamRulesSchema`) turns it off. Update the summary snapshot tests. Same line in G1's `--post`.

Verify: open a public sandbox chat in a private window, check that it's read-only and has no notes; paste the link into a card validator (or curl it and look for the og tags); a private repo's chat still asks you to sign in.

---

## G3: Decide from the notification

When the agents disagree on one point, the push has **Resolve** and **Keep open** buttons, and tapping one does what the chat's buttons do (`point_resolve` / `point_continue` in `apps/server/src/http/routes/chat-actions.ts`).

**Task 1: payload.** In `notificationText` / the notify handler (`apps/server/src/tasks/handlers/notify.ts`), when exactly one point is escalated, add `{ chatId, pointId, actions: ['resolve', 'continue'] }` to the push data. Test: the notify handler's tests.

**Task 2: service worker.** In `apps/web/public/sw.js`, `showNotification` gets `actions`; `notificationclick` with `event.action` POSTs to the chat-actions route (same origin, cookies), then shows "Done" or opens the chat if the POST fails. Check that `isAllowedOrigin` accepts the service worker's request. iPhone shows no action buttons, so tapping just opens the chat as it does now. Test: `sw.test.ts`.

Verify: on desktop Chrome, a sandbox PR with an escalated point → tap Resolve on the notification → the chat shows it resolved.

---

## G4: Public playground (fake bots)

A visitor clicks **Run a demo** on nitpilot.dev and watches two bots go through the full agent-to-agent loop on a real PR, live, on the public chat page (G2). Strangers' own PRs to the playground also get a single-player review.

**Task 1: a playground scenario for the fake agent.** In `apps/cli/src/agents/fake/`, add a `playground` scenario to `FAKE_SCENARIOS`: the reviewer raises points from simple diff rules (a leftover `console.log`, a `TODO`, a function with no test), and the author fixes some, declines one, and leaves one for a human. It's deterministic, so it always tells the same good story. Test: conformance-style test on a seeded diff.

**Task 2: the playground repo.** `nitpilot/playground` with a few seeded buggy branches, a README, and a `.nitpilot.yml`. Jobs only start on their own for trusted authors (spec §14), and strangers aren't trusted. Add a rule `trust_all_authors: true` that is **only honored for the fake agent** (the CLI rejects real-agent jobs from it). Spec §14 says why that's safe: review jobs run no setup, git hooks are emptied, and the fake agent runs nothing.

**Task 3: Run a demo.** A server route `POST /api/demo` (rate limited with `RateLimiter`, one demo at a time) uses the author bot's token to open a PR from a random seeded branch and request the reviewer bot. It returns the chat URL; the landing page links there. This is the server's only demo-specific code. Keep it in `apps/server/src/http/routes/demo.ts`, off unless `DEMO_*` env vars are set. Close demo PRs after an hour (a ticker timer, like the existing ones).

**Task 4: bots on Hetzner.** Two GitHub accounts (`nitpilot-demo-author`, `nitpilot-demo-reviewer`), each with a CLI running `nitpilot start` with the fake agent as a compose service next to the server. Docs in `docs/hosting.md`. Live setup steps in the usual click-by-click format.

Verify: click Run a demo on nitpilot.dev, watch the chat go through review → fix → re-review → ready in a few minutes; open a PR from a third account and get a single-player review.

---

## G5: Team guidelines + `nitpilot rules suggest`

**Task 1: `guidelines` in `.nitpilot.yml`.** `guidelines: string[]` (at most 20, each ≤ 300 characters) in `TeamRulesSchema`, passed in the bundle's `rules`, and put into `jobPrompt` (`apps/cli/src/agents/prompt.ts`) as the team's own review notes. Spec §13. Tests: schema limits, prompt snapshot.

**Task 2: gather past reviews.** In the CLI (reusing G1's GitHub reader), fetch the repo's last ~100 human review comments (`GET /repos/:o/:r/pulls/comments`, skipping bots and Nitpilot's own).

**Task 3: `nitpilot rules suggest`.** Run the agent in reviewer mode on the default branch with the comments passed as untrusted input (`apps/cli/src/mcp/untrusted.ts`) and one new tool, `propose_guideline` (in `tool-sets.ts`, only for this command). Print a ready-to-paste `guidelines:` YAML block. Nothing is committed. A `docs/why/` note on why the comments are treated as untrusted (prompt injection).

Verify: run it on a real repo with review history; paste the output into `.nitpilot.yml`; the next review's prompt includes it.

---

## G6: Stats

**Task 1: query and route.** `GET /api/me/stats?days=7|30`: points your agent raised, how many the author's agent fixed, declined, escalated, and the median time from first review to "ready". Read from the existing point and job tables in `apps/server/src/chats/`, no new tables. Test: a `.db.test.ts` with seeded chats.

**Task 2: web card.** A small stats row on the Inbox (four numbers, no chart) using the existing tokens from the design handoff. Also `nitpilot status --stats` in the CLI.

Verify: sandbox account with a few finished PRs shows the right counts.

---

## G7: More agents

**Task 1: Codex CLI adapter.** `apps/cli/src/agents/codex/`, following `docs/adapters.md` and the claude-code/copilot adapters: `detect`, `buildInvocation` with the local MCP server, `parseLine`, `outcome`, the version check in `doctor`. It only declares the modes that pass the conformance suite (`apps/cli/src/agents/conformance`). Needs Codex installed and signed in on this Mac for the live suite.

**Task 2: Gemini by API key.** Unblock the on-hold Gemini adapter (spec §22): an opt-in config key that lets `GEMINI_API_KEY` through `agentBaseEnv`, documented as billing your API account. Live suite with an AI Studio key.

Verify: the conformance suite passes live for each, then one real review on the sandbox.

---

## G8: GitHub Action for offline reviews

Reuses G1 completely: on GitHub's runner, the Action runs `nitpilot review` for the PR.

**Task 1: `nitpilot review --ci`.** Reads the PR from `GITHUB_EVENT_PATH`, the token from `GITHUB_TOKEN`, posts without asking, and lets `ANTHROPIC_API_KEY` reach the agent only in this mode (an `agentBaseEnv` option, off everywhere else). It skips if the PR already has a review from Nitpilot at this head SHA (look for the footer line or `BRAND.commentMarker` with the GitHub API), so it doesn't duplicate the daemon's review. Test: event fixture → bundle; the skip check.

**Task 2: the Action.** A composite action in `.github/actions/review/` (or a `nitpilot/review-action` repo): setup-node, `npx nitpilot@<version> review --ci`. Example workflow in the docs, triggered by `pull_request` and `review_requested`.

**Task 3: docs.** A docs-site page "Reviews when your laptop is off", README "What to know" updated, spec §18 moves "cloud fallback" from out-of-scope to done (as the Action), and a `docs/why/github-actions.md` explainer.

Verify: in the sandbox repo, add the workflow with an API key secret, open a PR with the laptop's daemon stopped, and see the review posted from the Action; start the daemon, push, and see no duplicate.

---

## How each task is checked

- `npm test` in the touched workspace (Vitest), plus `npm run typecheck` and lint at the repo root.
- Each milestone ends with a live run on the sandbox repo (the dev GitHub App and `npm run dev:tunnel`), written up in `docs/acceptance/plan-4-<milestone>.md` like the earlier plans.
- Web changes: check in the browser pane at phone and desktop width.
