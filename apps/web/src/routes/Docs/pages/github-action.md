# Reviews when your laptop is off

Nitpilot's reviews normally run on a developer's computer, through `nitpilot start`. When nobody's is on, a GitHub Action can do the review instead: it runs on GitHub's own machine, with your team's API key, and posts the review on the PR as `github-actions[bot]`.

Use it when not everyone on the team runs the daemon, or when PRs open while laptops are closed. It needs no Nitpilot account and no server: only the workflow file below and one repo secret. It needs nitpilot 0.8.0 or later.

## The workflow

Save this as `.github/workflows/nitpilot.yml` in your repo:

```yaml
name: Nitpilot review

# `pull_request`, not `pull_request_target`: with `pull_request`, PRs from forks get no secrets, so a stranger's PR
# can't spend your API key or run with a write token. `pull_request_target` would hand both to fork PRs.
on:
  pull_request:
    types: [opened, synchronize, ready_for_review, review_requested]

# Read the code, write the review. Nothing else.
permissions:
  contents: read
  pull-requests: write

# One run per PR: a new push cancels the review of the old commit.
concurrency:
  group: nitpilot-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: NikosGkikas13/nitpilot/.github/actions/review@v0.8.0
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

That reviews with Claude Code. For Gemini CLI, change the last step to:

```yaml
      - uses: NikosGkikas13/nitpilot/.github/actions/review@v0.8.0
        with:
          agent: gemini-cli
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Add your API key

The key is a repo secret: GitHub stores it encrypted and hands it only to your workflows.

1. Get a key: an Anthropic API key from console.anthropic.com, or a Gemini API key from aistudio.google.com.
2. On GitHub, open your repo and click **Settings** (the tab at the top; you need to be an admin of the repo).
3. In the left sidebar, click **Secrets and variables**, then **Actions**.
4. Click the green **New repository secret** button.
5. In **Name**, type `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`). In **Secret**, paste the key.
6. Click **Add secret**.

Open a PR, or push to one, and the review shows up on the PR a few minutes later. You can watch the run in the repo's **Actions** tab.

## Inputs

| Input | Default | What it is |
|---|---|---|
| `agent` | `claude-code` | `claude-code` or `gemini-cli`. Only these two run from an API key alone; Copilot CLI and Codex sign in with a person's login. |
| `version` | the release this Action ships in | The `nitpilot` npm version to run. |
| `github-token` | `${{ github.token }}` | Reads the PR and posts the review. |

The API key goes in `env` on the step, not in `with`, so it never shows up among the step's inputs. Nitpilot passes it to the agent and never prints it.

## Permissions

The job needs two, and the workflow above asks for only these:

- `contents: read` to fetch the PR's code.
- `pull-requests: write` to post the review.

The review is a comment review: it never approves or requests changes.

## Cost

Every run calls the agent with **your** API key, so every reviewed push is billed to your Anthropic or Google account. The `concurrency` block cancels the review of an old commit when a new push lands, and drafts are skipped. The GitHub runner itself is free for public repos and uses your Actions minutes on private ones.

## With the laptop daemon

The Action and `nitpilot start` can both be on. Before the agent runs, the Action looks at the PR's reviews: if Nitpilot already reviewed its latest commit (from someone's laptop, or an earlier run), it prints one line and stops, so there's no duplicate review and no cost. A new push is a new commit, so whichever gets there first reviews it.

## Private repos

They work. The workflow's own token (with `contents: read`) fetches the PR's code. It goes to that one `git fetch` only, as a header in git's environment: never on a command line, never in a file, and never to the agent.

## PRs from forks

GitHub gives no secrets to workflows run for a PR from a fork, so the run fails with a line saying the API key is not set. That is on purpose: otherwise anyone could open a PR and spend your key. Review fork PRs from a laptop with [`nitpilot review`](/docs/cli#nitpilot-review).

## Why `pull_request` and not `pull_request_target`

Both run when a PR opens. The difference is whose rules apply:

- `pull_request` treats a fork's PR as untrusted: no secrets and a read-only token.
- `pull_request_target` runs with your repo's secrets and a write token, even for a fork's PR. A workflow that then reads that PR's code would give a stranger your API key and write access to your repo.

Nitpilot can't tell which one your workflow uses, so the choice is yours: use `pull_request`, as in the workflow above.

## Other runs

- **Not a PR, or a closed one:** the run exits successfully and does nothing, so the same workflow file can also run on other events.
- **A review with nothing to say** posts nothing, so re-running on the same commit runs the agent again.
- The review follows the repo's `.nitpilot.yml` (ignored paths, the most points, guidelines), like every other Nitpilot review.
