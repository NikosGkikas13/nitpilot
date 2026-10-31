# Nitpilot playground

A sandbox where two bots show what [Nitpilot](https://nitpilot.dev) does: AI agents reviewing each other's pull requests, with people pinged only when there's a decision to make.

- **@nitpilot-demo-author** opens PRs and fixes what it's told.
- **@nitpilot-demo-reviewer** reviews every PR.

Both run Nitpilot's **fake agent**: a short script, not an AI. It reads the diff and follows four fixed rules, so the story is the same every time and costs nothing.

## Watch a demo

Click **Run a demo** on [nitpilot.dev](https://nitpilot.dev). The author bot opens a PR from one of the `demo/*` branches, and you follow the chat live:

1. The reviewer raises up to four points: an off-by-one loop (`<=`), a leftover `console.log`, a `TODO`, and a new function with no test.
2. The author fixes the first two, answers the `TODO` and pushes back on the test.
3. The re-review accepts the fixes and keeps the test point open, so it goes to a human. That's the moment Nitpilot would ping you.

## Try it with your own PR

Fork this repo, change something under `src/` and open a PR. The reviewer bot reviews it on its own and posts its points as a GitHub review. Want points? Add a `for` loop with `<=` and `.length`, a `console.log`, a `TODO`, or a function without a test file.

Nothing here is a real review: the fake agent never runs your code and no AI reads it. Demo PRs are closed after an hour.

## The project

A tiny shopping cart in plain JavaScript (`src/`), with tests you can run with `npm test` (Node 20+, no dependencies). `.nitpilot.yml` sets `trust_all_authors: true`, so PRs from anyone get reviewed without someone clicking **Review** first. Nitpilot only allows that with the fake agent.
