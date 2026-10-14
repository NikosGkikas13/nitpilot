# The live acceptance run: the manual test that uses the real thing

**In one sentence:** after every automated test passes, a person runs the whole product once against real GitHub and a real agent, following a checklist, and writes down what happened (spec §20, `docs/acceptance/plan-1.md`).

## Why it can't be automated

The end-to-end test ([end-to-end-test.md](end-to-end-test.md)) pretends to be GitHub. That makes it fast and repeatable, but it can only find mistakes we already imagined. Some things only exist for real:

- GitHub decides which webhooks to send, and in what order. (We had no idea whether re-requesting a review fires `review_requested` again until we tried.)
- GitHub's rendering of a comment, its permission rules, its rate limits.
- A real agent's behavior: Claude Code reading real files and calling our tools.
- Two real people's accounts, and a laptop's SSH setup.

A **runbook** is a checklist for a person to follow, with the exact commands and clicks, what to expect after each, and boxes to tick. It's the manual twin of an automated test: same job (prove it works), but a human is the test runner. It is a document in the repo because the steps matter as much as the code: the next person to run it, or to make a demo video, follows the same page.

## What's real and what's scripted

- **Real:** GitHub (the sandbox repo `NikosGkikas13/nitpilot-sandbox`, two accounts), the dev GitHub App and its webhooks through a tunnel, the server, Postgres, both CLIs, git over SSH, and Claude Code as account A's agent.
- **Scripted:** account B's reviewer is the fake agent, which follows a scenario file and always raises the same three planted problems. The spec asked for a second real agent (Gemini CLI) here; Google refuses personal sign-ins for it, so the fake stands in. What the run proves about B is the plumbing: a review request becomes a job within seconds, the CLI fetches the PR and its tools work, and its points reach the chat and GitHub. How good a reviewer's judgment is, it doesn't test.

## Why a fresh database

Two reasons. A leftover job from earlier experiments would be handed to your real agent the moment its CLI connects. And the "single-player" runs need an account that has *never* joined Nitpilot, so the run starts from an empty database and lets each account join when it's their turn.

## Why timestamps, and where each comes from

One pass criterion is "the review job starts within 5 seconds of the request". Nothing in the database records when a job started, so the runbook pipes each CLI's output through `docs/acceptance/stamp.pl`, which puts the time (UTC, to the millisecond) in front of each line as it arrives. `docs/acceptance/check.sql` prints the time each webhook reached the server in the same clock, so the two are compared by eye.

## The React analogy

It's the pre-release click-through before you ship a frontend: automated tests are green, and you still open the real app, in a real browser, signed in as real users, and go through the main journeys with a checklist. You do it once per release, and it's where you find the things nobody thought to test.
