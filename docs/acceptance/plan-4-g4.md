# Plan 4 G4 acceptance run: the public playground (live, nitpilot.dev)

The live check for [Plan 4](../superpowers/plans/2026-10-30-plan-4-growth.md) milestone G4: a visitor clicks **Run a demo** on nitpilot.dev and two bots go through the agent-to-agent loop on a real PR, and a stranger's own PR to the playground gets a review on its own. [why/live-acceptance.md](../why/live-acceptance.md) explains why this is a document and not a test.

**Time:** about 5 minutes once set up. **Cost:** none (the fake agent is a script).

## Setup

- nitpilot.dev on 0.6.0 (upgraded from 0.3.1), with `DEMO_REPO=NikosGkikas13/nitpilot-playground` and `DEMO_AUTHOR_TOKEN` set: `/healthz` says `"demo":true`.
- [NikosGkikas13/nitpilot-playground](https://github.com/NikosGkikas13/nitpilot-playground) seeded with `docs/playground/seed.sh` (main and `demo/discount`, `demo/receipt`, `demo/shipping`), the Nitpilot app installed on it, and both bots Write collaborators.
- The two bots in `/opt/nitpilot-bots` on the box ([hosting.md, "Playground bots"](../hosting.md#playground-bots-plan-4-g4)), from a `v0.6.0` source checkout: `doctor` passed for each (logged in, `Agent: fake 0.6.0`, playground linked). Their daily job cap raised to 200; Auto-review and Auto-fix were already on. Logs on start: `Connected as nitpilot-demo-author. Linked: NikosGkikas13/nitpilot-playground.` and the same for the reviewer.

## 1. Run a demo

- [x] Signed out, on https://nitpilot.dev, clicked **Run a demo**. The page waited ("Starting the demo…"), then opened the public chat page [/c/NikosGkikas13/nitpilot-playground/1](https://nitpilot.dev/c/NikosGkikas13/nitpilot-playground/1).
- [x] On GitHub: [nitpilot-playground#1](https://github.com/NikosGkikas13/nitpilot-playground/pull/1), "Demo: discount", by `nitpilot-demo-author`, from `demo-run/discount-1793457654092` into `main`. `CODEOWNERS` requested `nitpilot-demo-reviewer`.
- [x] Bot logs, in order: `review … #1: done` (reviewer), `address … #1: done` (author), `re-review … #1: failed (stale head)`, then `re-review … #1 (attempt 2): done` (reviewer). The first re-review started before the author's push had landed on the server; the retry is the designed behaviour.
- [x] The reviewer raised 4 points. The author pushed one commit, `Address review feedback (round 1)`, as `nitpilot-demo-author`, and declined the `tests` point ("discountedTotal has no test"). The reviewer kept it open, so the chat showed it **Escalated**: the scripted story of the `playground` scenario.
- [x] The chat page updated by itself while it ran (the 5 s poll). The whole loop took about 2 minutes.

## 2. A stranger's PR

- [x] As `ngkdev93-jpg` (not a collaborator), forked the playground and opened [nitpilot-playground#2](https://github.com/NikosGkikas13/nitpilot-playground/pull/2), "Add a greet helper" (a new `src/greet.js` with a leftover `console.log`).
- [x] With nobody clicking anything, the reviewer bot took it (`review … #2: done`) and posted a review, state `COMMENTED`, headed `🤖 Review by nitpilot-demo-reviewer's agent · Nitpilot`.
- [x] The chat then waits in `addressing`: the stranger has no agent, so nothing runs on their side.

## Deviations from the plan

- The bot accounts were first created as `yy11-afk` and `yy12-afk` and renamed to `nitpilot-demo-author` and `nitpilot-demo-reviewer`, which `CODEOWNERS` and the docs use.
- G4 and G5 shipped together as 0.6.0, not one minor version each.
- Seeding the repo, the collaborator invites, the server upgrade and the bot setup on the box were run by the coordinating Claude session (ssh and the GitHub CLI); creating the accounts, the token and the sign-in approvals were done by the owner.

Not run live: the hourly cleanup closing an old demo PR (unit tests cover `closeOldDemos`; PR #1 should be closed by it an hour after it opened), the rate limit, and two visitors clicking at once.

Run on 2026-10-31 at 0.6.0.
