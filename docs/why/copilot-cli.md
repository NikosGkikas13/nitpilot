# GitHub Copilot CLI: the second agent

**In one sentence:** the Copilot adapter turns "review this PR" into a `copilot -p` command that can only read the code and call Nitpilot's tools, and turns Copilot's JSON events back into progress and an outcome (spec §12.2, `apps/cli/src/agents/copilot/adapter.ts`).

Read [agent-adapters.md](agent-adapters.md) first: it explains adapters with Claude Code. This page is what's different about Copilot.

## Why a second agent

Many teams pay for GitHub Copilot, not Claude. Copilot's plan also serves Claude and GPT models, so a Copilot user can still get a Claude review, through their own Copilot subscription. The adapter is what makes `"agent": "copilot"` in the config work.

## A whitelist, not a deny list

Copilot ships with many tools: a shell (`bash`), web fetching, sub-agents, a SQL scratchpad, skills. Instead of listing what to block, the adapter lists what to show:

- `--available-tools view grep rg glob nitpilot` is everything a reviewer can see. A tool that isn't on the list doesn't exist for the model, like a component that never receives a prop.
- An editor adds `edit create apply_patch`. Tool names depend on the model (GPT models get `rg` and `apply_patch`, others `grep`, `edit` and `create`), so each list names every variant.
- `--allow-tool nitpilot` (plus `write` for an editor) is what runs without asking. In `-p` mode anything else is refused, never prompted, so a run can't hang waiting for a click.
- `--deny-tool 'write(.git)'`: the live suite caught an editor rewriting the worktree's `.git` file, since `write` covers every file in the folder. Deny rules always win.

## Keeping the PR's own config out

A PR can add files that Copilot would load by itself: `.github/copilot-instructions.md`, `.github/instructions/`, hooks in `.github/hooks/`, an `.mcp.json` that starts a program. Two locks keep them out:

1. **The flags.** `--no-custom-instructions` skips instruction files. Not passing `--trust-folder` means Copilot never trusts the checkout, so its hooks and MCP servers don't start. We tested this: with the folder trusted, a planted hook and `.mcp.json` fired; without trust, nothing did.
2. **The scrub.** Before the agent starts, the CLI deletes those files from the checkout anyway (`apps/cli/src/runner/scrub.ts`). Scrub entries can be short paths like `.github/hooks/`, matched at any depth.

## Your login

Copilot signs in with `copilot login` (stored in your system keychain). It would also take a token from `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`, but Nitpilot never passes those to an agent (conformance S3). So only your stored login is used.

Copilot has no "am I logged in?" command, so `detect()` (and `nitpilot doctor`) only checks that `copilot --version` runs. A missing login shows up as the first job failing with `auth`.

## Reading the output

`--output-format json` prints one event per line. The adapter reads three:

| Event | Becomes |
|---|---|
| `assistant.message` with `toolRequests` | progress: "Using get_job" |
| `assistant.message` with text | progress: its first line |
| `result` (the last line) | the result, with `exitCode` |

One surprise from recording real runs: when Nitpilot stops a run with SIGTERM, Copilot still writes `{"type":"result","exitCode":0}` on its way out. So `outcome` trusts only the process's real exit code, never that line. Killing just `copilot` also leaves a child process running the job to the end, which is why `runAgent` kills the whole process group.

## Picking a model

`"model": "claude-sonnet-5.5"` in the config becomes `--model claude-sonnet-5.5`. Without it Copilot's "auto" picks one. Which ids work depends on your plan: one that isn't included fails the job at once with `Error: Model "…" from --model flag is not available.`
