# Nitpilot review (GitHub Action)

Reviews a pull request with your team's own AI agent when nobody's laptop is running the Nitpilot daemon. The Action runs on GitHub's runner: it installs Node 22 and the agent's CLI, then runs `npx nitpilot review --ci`, which reads the PR from the event, has the agent review it, and posts the review as `github-actions[bot]`.

## Example workflow

Save as `.github/workflows/nitpilot.yml` in your repo, and add your API key as a repo secret (**Settings → Secrets and variables → Actions → New repository secret**, named `ANTHROPIC_API_KEY`).

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

For Gemini, add `with: { agent: gemini-cli }` and pass `GEMINI_API_KEY` instead.

## Inputs

| Input | Default | What it is |
|---|---|---|
| `agent` | `claude-code` | `claude-code` or `gemini-cli`. Only these two run from an API key alone. |
| `version` | the release this Action ships in | The `nitpilot` npm version to run. |
| `github-token` | `${{ github.token }}` | Reads the PR and posts the review. |

## Permissions

The job needs `contents: read` (fetch the PR's code) and `pull-requests: write` (post the review).

## Secrets

The API key is set as an env var on the step (`ANTHROPIC_API_KEY` or `GEMINI_API_KEY`), not passed as an input. GitHub hides secret values in logs either way; keeping the key in env means it never appears in the step's inputs. Nitpilot passes it to the agent and never prints it.

## Cost

Every run calls the agent with **your** API key, so every reviewed push is billed to your Anthropic or Google account. The `concurrency` block keeps quick pushes from stacking runs, and drafts are skipped.

## What to know

- **Public repos only for now:** the review fetches the PR's code without credentials, so on a private repo the fetch fails.
- **Fork PRs:** GitHub gives no secrets to PRs from forks, so the run fails with a line saying the API key is not set. That is on purpose; review fork PRs from a laptop.
- **The laptop daemon got there first:** if the PR already has a Nitpilot review at its latest commit, the Action exits without running the agent, so there's no duplicate.
- **Not a PR, or a closed one:** the run exits successfully and does nothing.
- **A review with nothing to say** posts nothing, so re-running on the same commit runs the agent again.
