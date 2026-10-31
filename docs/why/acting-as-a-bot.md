# Acting as a bot (the Run a demo button)

**In one sentence:** when a visitor clicks **Run a demo**, the server opens a pull request on GitHub as a bot account, with that bot's own token, so the visitor sees two bots review each other without signing in to anything.

## The problem

Everywhere else, the server acts on GitHub either as the Nitpilot GitHub App (posting reviews) or as you, with your own sign-in token (checking which repos you can read). A demo has neither: the visitor isn't signed in, and the GitHub App doesn't author PRs.

The playground needs a PR author, so it has one: a GitHub account called `nitpilot-demo-author`, with a second one, `nitpilot-demo-reviewer`, to review. Each runs a Nitpilot CLI with the fake agent (Plan 4 G4 Task 4).

## The idea

A token is like a logged-in session you can hand to a program. The author bot's token sits in the server's environment (`DEMO_AUTHOR_TOKEN`), and the demo route sends it with its GitHub calls, so GitHub sees the author bot doing them:

1. Copy one of the repo's `demo/*` template branches to a fresh `demo-run/...` branch (a branch is just a name pointing at a commit, so the copy is one API call).
2. Open a PR from that branch.

React comparison: it's like a server action that calls a third-party API with an API key kept on the server. The browser only says "please run a demo"; it never sees the key.

From there nothing is special: the repo's `CODEOWNERS` file asks the reviewer bot for a review, GitHub sends Nitpilot its usual webhooks, and the two bots' CLIs take it from there, live on the public chat page.

## Keeping it safe and tidy

- **Off unless set up.** Without `DEMO_REPO` and `DEMO_AUTHOR_TOKEN` the route doesn't exist. A self-hosted server never has it.
- **The token is a secret.** It never reaches the browser and is never logged (error lines name the GitHub call and its status only). Give the bot access to the playground repo only.
- **No piles of PRs.** One demo runs at a time: while a demo PR younger than an hour is open, everyone who clicks gets that one. Each address may ask 10 times an hour ([rate limits](trusting-a-proxy.md)).
- **No table of our own.** GitHub already knows which demo PRs are open and when they opened, so the server asks it instead of keeping a list that could drift.
- **Cleanup.** Every 5 minutes the server's ticker closes demo PRs older than an hour and deletes their branches.

## Where

- `apps/server/src/http/routes/demo.ts`: the route and `closeOldDemos`.
- `apps/server/src/main.ts`: the cleanup timer.
- `apps/server/src/lib/env.ts`: `DEMO_REPO`, `DEMO_AUTHOR_TOKEN`.
- `apps/web/src/routes/Landing/Landing.tsx` and `apps/web/src/api/demo.ts`: the button.
- `docs/playground/`: the repo's files and setup steps.
