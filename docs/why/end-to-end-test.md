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

## The React analogy

It's a Playwright test for the backend: unit tests check each component with props you choose, and this one mounts the whole app and clicks through a real user journey.
