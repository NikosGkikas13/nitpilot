# GitHub Actions: reviews when every laptop is off

**In one sentence:** a GitHub Action lets GitHub's own machine run `nitpilot review --ci` when a PR opens, so a team gets Nitpilot reviews even when nobody is running `nitpilot start`.

## Why Nitpilot needs it

Normally the review runs on a developer's computer, with their agent and their login (`nitpilot start`). If that laptop is closed, the job waits. Some teams have one person who runs the daemon and three who don't, or open PRs at night. For them, the review can run on GitHub instead, paid for by a team API key. Same review code, different computer.

## The pieces, in React terms

- **A workflow** is a YAML file in `.github/workflows/`. Think of it as a `useEffect` for the repo: `on:` is the dependency list (run when a PR opens or gets a push), and `jobs:` is the effect body. GitHub reads it from the repo; there's nothing to deploy.
- **A runner** is the computer the job runs on: a fresh Ubuntu VM GitHub starts for that one run and throws away after. Nothing on it survives, so each run installs Node, the agent's CLI and `nitpilot` again.
- **An action** is a reusable step, like a component a workflow "renders" with `uses:`. A **composite action** is one made of other steps, written in YAML (`action.yml`) instead of JavaScript: our `.github/actions/review/action.yml` is "set up Node 22, install the agent's CLI, run `npx nitpilot review --ci`". `with:` is its props.
- **`GITHUB_TOKEN`** is a token GitHub creates for each run and revokes when it ends. The workflow's `permissions:` block decides what it can do; ours asks for `contents: read` (fetch the code) and `pull-requests: write` (post the review). Whatever posts with it shows up as `github-actions[bot]`.
- **Repo secrets** are encrypted values stored on the repo (Settings → Secrets and variables → Actions), like an `.env` file that only workflows can read. The API key lives there, and `${{ secrets.ANTHROPIC_API_KEY }}` puts it in the step's environment. GitHub blanks out secret values if they show up in the logs.

## Forks get no secrets, and that's the point

Anyone can fork a public repo and open a PR from it. That PR's code is a stranger's. If the workflow ran with your secrets, a stranger could change the code the run reads and walk away with your API key. So on a `pull_request` event from a fork, GitHub gives the run **no secrets** and a **read-only** `GITHUB_TOKEN`. Nitpilot then stops with one line: the API key is not set. Fork PRs get reviewed from a laptop instead.

## Why `pull_request_target` is dangerous

`pull_request_target` is a second event that also fires on PRs, but it runs with the base repo's rights: secrets included, and a write token, even for a fork's PR. It exists for things like labelling PRs, which never look at the PR's code. A workflow that reads the PR's code under `pull_request_target` hands a stranger's code your secrets: a well-known way repos get their tokens stolen. Our README and docs page say to use `pull_request` only, and the example workflow does.

## How it fits with the laptop daemon

Both can be on. Before the agent runs (the part that costs money), `--ci` reads the PR's reviews. If Nitpilot already reviewed the PR's latest commit, from a laptop or an earlier run, it prints one line and exits. So there's never a second review of the same commit.

## Private repos: the token goes to one git call only

On a private repo, `git fetch` needs the token too. The CLI's git runs with an allowlisted environment (docs/why/safe-git.md), so the token doesn't leak in by accident. `githubAuthEnv` adds it on purpose, to that one fetch: an `Authorization` header set through `GIT_CONFIG_*` environment variables, the same way `actions/checkout` does it. Like passing a header to one `fetch()` call instead of setting a global default. It's never on a command line, never in a file, and the agent never sees it.

## Files

- `.github/actions/review/action.yml`: the composite action. `README.md` next to it has the example workflow.
- `apps/cli/src/github/ci.ts`: reads the PR from GitHub's event file, picks the agent from `NITPILOT_AGENT`, and checks whether Nitpilot already reviewed this commit.
- `apps/cli/src/runner/safe-git.ts` (`githubAuthEnv`): the token for the private-repo fetch.
- Docs page: `apps/web/src/routes/Docs/pages/github-action.md` ("Reviews when your laptop is off").
