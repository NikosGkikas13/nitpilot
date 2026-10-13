# Agent adapters: driving Claude Code without a terminal

**In one sentence:** an adapter turns "review this PR" into the exact `claude` command to run, and turns what `claude` prints back into "still working", "done" or "failed because…" (spec §12.2, `apps/cli/src/agents/claude-code/adapter.ts`).

## Headless mode

`claude -p "<prompt>"` runs one task and exits, with no chat window. With `--output-format stream-json` it prints one JSON object per line as it works: a `system`/`init` line (which tools it has), `assistant` lines (its words and tool calls), `user` lines (tool answers), and a final `result` line (`subtype: "success"` or an error such as `error_max_turns`). The adapter reads each line with `parseLine`: tool calls and short sentences become progress ("Using get_job"), and the `result` line decides the outcome.

## Only the tools a job needs

- `--tools "Read,Glob,Grep"` is the whole list of built-in tools for a reviewer. An editor gets `Edit,Write` too. There's no `Bash` and no web tool, so "run this command" or "fetch this URL" isn't something the agent *can* do, whatever a PR says.
- `--allowedTools mcp__nitpilot` lets it call Nitpilot's own tools (over MCP) without asking.
- `--permission-mode dontAsk` (reviewer) refuses anything not allowed, instead of asking a person who isn't there. `acceptEdits` (editor) lets edits inside the worktree through; a write outside it is still refused.
- `--strict-mcp-config`, `--setting-sources user`, `--settings '{"disableAllHooks":true}'` and `--disable-slash-commands` keep a PR's own `.mcp.json`, `.claude/settings.json` hooks and commands from loading. The worktree scrub removes those files too: two locks on the same door.

## How a run ends

| What `claude` printed | Outcome | Try again at once? |
|---|---|---|
| `result` with `subtype: "success"`, no error | ok | — |
| `error_max_turns` | `max_turns` | no: the same job would run out again |
| "Failed to authenticate", a 401 | `auth` | no: you need to log in |
| "You've hit your limit", a 429 | `quota` | no: it resets in hours |
| no `result` line (a crash, a signal) | `crash` | yes |

The fixtures in `claude-code/fixtures/` are real runs, recorded once (the quota one is written by hand: a limit can't be hit on purpose). The static conformance suite feeds them through the adapter on every `npm test`, so a change in Claude Code's output shows up as a failing test, not as a confused daemon.

## Your login, not a key

Claude Code uses your own login (`claude auth login`), which `detect()` checks with `claude auth status`. Nitpilot never passes `ANTHROPIC_API_KEY` to it unless you set `"apiBilling": true`, because a key would bill your API account instead of your plan.

## The React analogy

An adapter is like a small API client hook: `buildInvocation` is the request it sends, `parseLine` is the response parser, and the component (the executor) only ever sees `{ ok }` or a typed error, never the raw response.
