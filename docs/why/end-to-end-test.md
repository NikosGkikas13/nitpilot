# The end-to-end test: everything at once, without GitHub

**In one sentence:** `npm run test:e2e` starts the real server and two real `nitpilot start` daemons on your machine, pretends to be GitHub with a few local git folders, and checks that a PR goes from "opened" to "ready" between two people's agents (spec §19).

## What's real and what's pretend

- **Real:** the server's whole loop (webhooks, the engine, Postgres, the task runner, the CLI hub), both CLIs (the daemon, the executor, safe git, worktrees, the MCP server), and the git commits and pushes.
- **Pretend:**
  - GitHub's API is `FakePlatform`, which records the comments the server would post.
  - GitHub's git side is a bare repo in a temp folder. A hook keeps `refs/pull/42/head` on the PR branch's tip, as GitHub does.
  - The agents are the fake agent (`apps/cli/src/agents/fake/agent.ts`), which follows a scenario file over real MCP: "raise two points; fix one, answer the other; resolve both".

## Reaching "GitHub" without a network

The CLI only pushes to a remote that looks like GitHub (`git@github-test:octo/sandbox.git`), the same way your clone points at github.com. So each clone gets that address, and `GIT_SSH_COMMAND` names a tiny script that git runs in place of `ssh`: it serves the bare repo on disk. Git can't tell the difference (`apps/server/test/e2e/github.ts`).

## Why it runs on its own

It takes a few seconds and starts many programs, so `npm test` leaves it out. CI runs it as its own step, and you can run it with `npm run test:e2e` (Docker must be running, like for the database tests).

## The browser suite in CI

Plan 2 adds a second end-to-end suite: Playwright drives a real Chromium against the same setup (`apps/server/test/e2e/web-server.ts` serves the built web app, plus a small control API the tests use to sign people in, open PRs and start CLIs). Its specs (`apps/web/e2e/*.spec.ts`) cover the four flows of spec §19 (the inbox opens, a chat updates live while agents work, Resolve on an escalation, Send on a draft), plus the read-only view and the not-found page for someone who can't see the repo, and the landing, PWA, Settings, Setup and device-approval pages. Each test resets the chats and opens its own PR, so any one spec file passes on its own.

One spec talks to a second server: `first-run.spec.ts` needs a server with no GitHub App yet (first-run mode, docs/why/first-run-and-app-manifests.md), which the shared one can never be. `apps/server/test/e2e/first-run-server.ts` starts one beside it, on port 4321 with its own database, and its control port (4322, on 127.0.0.1 only) also plays github.com: the page's manifest form is posted there, and it sends the browser straight back to the callback. Instead of exiting after the callback, it answers 502 like a proxy whose server is restarting, until the test calls `/restart`.

- **One worker.** All tests share one server and one database, so they run one at a time; two at once would reset each other's chats.
- **No sleeps.** A test never waits a fixed time ("wait 2 seconds"): it waits for something it can see (`await expect(page.getByText('Ready for your approval')).toBeVisible()`), which Playwright keeps retrying until it shows or times out. A fixed wait is either too short on a slow CI machine (a flaky failure) or wasted time on a fast one.
- **No retries.** A test that fails is a finding: it gets fixed at its cause, not run again until it passes. A stray `test.only` fails CI (`forbidOnly`).
- **The browser cache.** CI keeps Playwright's Chromium in `~/.cache/ms-playwright` between runs, keyed on the Playwright version, so most runs skip the ~150 MB download and only install the system libraries Chromium needs.
- **The trace upload.** A failed test keeps a trace (every action, network request, console line and a DOM snapshot at each step). CI uploads `apps/web/test-results/` as the `playwright-traces` artifact; open one with `npx playwright show-trace trace.zip` to watch what the browser saw, like Redux DevTools' time travel, for a whole test.

Locally: `npm run test:web-e2e` (it builds the web app first). If a server from an earlier run is still on port 4319 (or 4321), Playwright reuses it, except on CI.

## The React analogy

It's a Playwright test for the backend: unit tests check each component with props you choose, and this one mounts the whole app and clicks through a real user journey.
