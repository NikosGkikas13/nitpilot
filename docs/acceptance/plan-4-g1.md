# Plan 4 G1 acceptance run: `nitpilot review` (live, real GitHub)

The live check for [Plan 4](../superpowers/plans/2026-10-30-plan-4-growth.md) milestone G1: a one-off review with no Nitpilot account, no server and no GitHub App, run with Claude Code on the public sandbox. [why/live-acceptance.md](../why/live-acceptance.md) explains why this is a document and not a test.

**Time:** about 10 minutes. **Cost:** two short Claude Code runs on the Claude plan (about 15 seconds each).

## Setup

- The built CLI, the file npm ships: `npm run build -w apps/cli`, then `node apps/cli/dist/index.js`.
- An empty config folder, so the CLI acts like a computer that never ran `nitpilot login`: `NITPILOT_CONFIG_DIR=<an empty folder>`.
- The GitHub token comes from the GitHub CLI, signed in as `NikosGkikas13` (no `GITHUB_TOKEN` set).
- Claude Code signed in (`claude auth status`).

## 1. A PR with nothing to raise

- [x] `nitpilot review https://github.com/NikosGkikas13/nitpilot-sandbox/pull/1 --post --yes` (by `ngkdev93-jpg`, one line added to README.md).
- [x] It printed `claude-code is reviewing NikosGkikas13/nitpilot-sandbox#1: Update README.md`, the agent's progress, its summary, then `No points: your agent found nothing to raise.` Exit 0, in 14 s.
- [x] With no points there was nothing to post: no review appeared on the PR.
- [x] The config folder got `cache/NikosGkikas13/nitpilot-sandbox` (the empty repo the PR was fetched into) and an empty `worktrees/` (the job's checkout was removed). No `config.json` was written.

## 2. A PR with bugs, posted

- [x] As `NikosGkikas13`, a test PR adding `src/cart.js` with an off-by-one loop and an ambiguous `percent` parameter: [nitpilot-sandbox#23](https://github.com/NikosGkikas13/nitpilot-sandbox/pull/23).
- [x] `nitpilot review https://github.com/NikosGkikas13/nitpilot-sandbox/pull/23 --post --yes` printed 2 points: `blocker · bug  src/cart.js:5` (the loop) and `major · bug  src/cart.js:12` (the discount), then `Posted your review: …#pullrequestreview-5721977218`. Exit 0.
- [x] On GitHub: one review, state `COMMENTED`, by `NikosGkikas13`. Its body is the header `🤖 Review by NikosGkikas13's agent · Nitpilot` and the footer linking to nitpilot.dev. Each point is an inline comment on its line (`src/cart.js:5` and `:12`, side `RIGHT`), starting `**P1 · blocker · bug:**` and `**P2 · major · bug:**`.
- [x] The test PR was closed and its branch deleted.

Not run live: the `[y/N]` question in a real terminal (it needs a person at the keyboard; unit tests cover it), the 422 fallback (GitHub only answers 422 for a line outside the diff), and Copilot CLI as the agent.

Run on 2026-10-31 at 0.3.1+main (the commit before the 0.4.0 version bump).
