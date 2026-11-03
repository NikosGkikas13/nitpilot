# Plan 4 G8 acceptance run: reviews when your laptop is off (live, real GitHub)

The live check for [Plan 4](../superpowers/plans/2026-10-30-plan-4-growth.md) milestone G8: the GitHub Action (`.github/actions/review/`, nitpilot 0.8.0) reviews a PR on GitHub's runner with nobody's daemon running, and doesn't post a second review at the same commit. [why/live-acceptance.md](../why/live-acceptance.md) explains why this is a document and not a test.

**Cost:** none (a free Google AI Studio key).

## Setup

- [NikosGkikas13/nitpilot-sandbox](https://github.com/NikosGkikas13/nitpilot-sandbox) (public). `.github/workflows/nitpilot.yml` is the docs page's example workflow, switched to `agent: gemini-cli` with a `GEMINI_API_KEY` repo secret (set with `gh secret set`, the key pasted at its hidden prompt). The repo's `main` got it over SSH: the GitHub CLI's login has no `workflow` scope, so the API refused the file.
- No `nitpilot start` running on the laptop.

## 1. A review with the laptop off

- [x] As `ngkdev93-jpg`, [nitpilot-sandbox#24](https://github.com/NikosGkikas13/nitpilot-sandbox/pull/24), "Add averageScore": a new `src/average.js` with an `i <= scores.length` loop.
- [x] The first runs got as far as Gemini and stopped on Google's side: the free tier's 20 requests a day on the default model were used up (by G7's live suite that day), then a day later Google answered 503 ("high demand") until the retries used up the day's quota again. Each failed cleanly with Gemini's own message, as `quota` or `crash`.
- [x] The workflow then picked Gemini's lighter model, which has its own free quota, with no new release: a step writes `{ "model": "gemini-3.5-flash-lite" }` to `$RUNNER_TEMP/nitpilot/config.json` and the review step gets `NITPILOT_CONFIG_DIR` pointing there (`--ci` keeps the config's `model`).
- [x] A push to the PR started [run 41632571017](https://github.com/NikosGkikas13/nitpilot-sandbox/actions/runs/41632571017): `gemini-cli is reviewing NikosGkikas13/nitpilot-sandbox#24`, `Using add_point`, `1 point: major · bug src/average.js:4` (the off-by-one loop that returns `NaN`), then `Posted your review: …#pullrequestreview-5751853644`.
- [x] On GitHub: one review by `github-actions[bot]`, state `COMMENTED`, at `fda026e` (the PR's head).

## 2. No duplicate at the same commit

- [x] Re-running the same run printed `Nitpilot already reviewed NikosGkikas13/nitpilot-sandbox#24 at fda026e: nothing to do.` and exited 0 without starting Gemini. The PR still has one review.

## Deviations from the plan

- Gemini CLI on a free key instead of Claude Code with a paid API key (an Anthropic key needs credit).
- The no-duplicate check re-ran the Action instead of letting the laptop daemon review first. Both go through the same check (`reviewedAtHead` in `apps/cli/src/github/ci.ts`: a review with Nitpilot's marker at the head SHA), and the daemon's reviews carry the same marker.

Found on the way: the Action has no `model` input, so a free Gemini key needs the config-file step above. A `model` input would make that one line; it needs a release.

Run on 2026-11-03 at 0.8.0.
