# Writing an adapter

Nitpilot talks to two kinds of outside thing through two small interfaces, so neither the engine nor the rest of the server knows which one it is using:

- an **agent adapter** (in the CLI) knows how to drive one agent program: Claude Code, GitHub Copilot CLI, OpenAI Codex CLI, Gemini CLI, or the scripted fake agent;
- a **platform adapter** (in the server) knows one code host: GitHub today.

Both are held to the same rule: **an adapter may only declare what it has proven.** An agent adapter lists only the modes that pass the conformance suite; a platform adapter's parsing is tested against recorded real payloads.

## An agent adapter

Everything is in `apps/cli/src/agents/`. The interface is `AgentAdapter` in `types.ts`:

| Member | What it does |
|---|---|
| `id` | One of the ids in `AgentId` (`packages/protocol/src/enums.ts`) |
| `modes` | `'reviewer'` and/or `'editor'`. Only modes that pass the suite |
| `scrubPaths` | Project files this agent loads by itself (`CLAUDE.md`, `.claude/`, …). They are deleted from the PR's checkout before it runs |
| `detect()` | Is it installed and logged in? `nitpilot doctor` and `nitpilot start` use it |
| `buildInvocation(input)` | The command, arguments, environment and files (the MCP config with the job's token) for one run. Throws for a mode it doesn't support |
| `parseLine(line)` | One line of the agent's output → `{ type: 'progress' }`, `{ type: 'result' }`, or `null`. Never throws |
| `outcome({ code, signal, last, stderrTail })` | How the run ended: ok, or a failure reason (`auth`, `quota`, `max_turns`, `crash`, `timeout`, `no_result`) and whether retrying can help |

An adapter only *builds a command and reads output*. Spawning, timeouts and killing the whole process tree are done once, by `runAgent` (`runner.ts`), so an adapter can be tested without running anything.

### Steps

1. **Read the agent's own documentation and check its flags against the installed version.** Write the version in the adapter (`CLAUDE_CODE_CHECKED_VERSION`). Flags change fast; this is what the suite will catch later.
2. **Pick the tools per mode.** A reviewer gets read tools only. An editor adds edit tools. No shell, no web, for either. Everything else the agent needs goes through Nitpilot's MCP tools.
3. **Keep the agent away from the repository's own configuration.** Turn off project settings, hooks, slash commands and any MCP server except ours (for Claude Code: `--strict-mcp-config`, `--setting-sources user`, `--settings '{"disableAllHooks":true}'`, `--disable-slash-commands`; for Copilot CLI: `--no-custom-instructions`, `--disable-builtin-mcps`, a tool whitelist in `--available-tools`, and never `--trust-folder`; for Codex CLI: `--ignore-user-config`, `--ignore-rules`, `--disable hooks`, and `-c project_doc_max_bytes=0`).
4. **Put the MCP token in a file, never on the command line.** Return it in `files`; `runAgent` writes it with mode 0600 inside the run's private folder and the executor deletes the folder afterwards. If the agent only reads MCP settings from its own config folder, look for a setting that runs a command or names a file: Codex takes the server with `-c` and its headers from `http_headers_helper`, a command (`/bin/cat <tmp>/mcp-headers.json`) whose JSON output it sends as headers.
5. **Build the environment from `input.baseEnv`.** It is an allowlist. Add only what your agent needs. `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` only when the user opted into API billing (the static suite's `optIn` checks both states); `GITHUB_TOKEN`, `GH_TOKEN`, `NPM_TOKEN` and `AWS_*` never.
6. **Record real runs** of every way the agent can end (success, out of turns, logged out, rate limit, crash, killed by a signal) into `fixtures/*.jsonl`, with paths and ids replaced. Write what `outcome` must make of each. Read the agent's *error output*, never its own words: a model can say "I hit my limit" about anything.
7. **Run the static suite** from a test file next to the adapter (`claude-code/conformance.test.ts` is the example):

   ```ts
   staticConformance({
     adapter: myAdapter(),
     toolsOf: (invocation) => /* the tools this invocation turns on, in the agent's own names */,
     readTools: ['Read', 'Glob', 'Grep'],
     editTools: ['Edit', 'Write'],
     isolation: { reviewer: [/* argument sequences that must be present */], editor: [/* … */] },
     fixtures: { dir: FIXTURES, cases: [/* { file, code, signal, stderr?, outcome } */] },
   });
   ```

   It checks, without running the agent (S1 to S6): no shell, write or web tool in reviewer mode; the token only in a 0600 file; no secrets in the environment; the isolation flags are present; every recorded fixture gives the right outcome and junk lines never crash the parser; an unsupported mode throws. Each check was run against a deliberately broken adapter to be sure it can fail.
8. **Register it** in `registry.ts` (`getAdapter`), and give `detect()` a real check so `nitpilot doctor` can say what is wrong.
9. **Run the live suite** by hand: add the adapter to `ADAPTERS` in `conformance/live.test.ts`, make sure the agent is logged in, then `npm run test:live -w apps/cli`. It runs the real agent against booby-trapped checkouts (L1 to L6) and uses a little of the user's plan, about five minutes and 14 runs for Claude Code. [agent conformance](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/agent-conformance.md) explains the canaries.
10. **Declare only the modes that passed.** If the editor mode fails a live check, `modes` is `['reviewer']` until it is fixed.

### Codex CLI's quirks

`agents/codex/` drives `codex exec --json`. Its flags were read from Codex's source at `rust-v0.166.0` and passed the live suite with 0.166.0 (2026-11-01).

- **No tool allowlist.** The shell is switched off (`--disable shell_tool`, also `view_image`, `multi_agent`, `apps`, `hooks`, and `web_search="disabled"`). That leaves `apply_patch`, which no setting removes, so the **sandbox** decides: `--sandbox read-only` refuses every write for a reviewer (with `approval_policy="never"` it can't ask), `workspace-write` lets an editor write in the worktree only, with `/tmp` and `$TMPDIR` excluded and no network. With no shell, the agent reads code through Nitpilot's `get_file` and `get_diff`.
- **Your config.toml is not loaded** (`--ignore-user-config`): your own MCP servers, hooks and trusted projects never reach a job, and neither does a model you set there. Your login still comes from `CODEX_HOME` (default `~/.codex`), which is the one extra variable in the agent's environment. `OPENAI_API_KEY` and `CODEX_API_KEY` never reach it.
- **Endings:** exit 0 and a `turn.completed` line is success. A `turn.failed` or `error` line carries Codex's message: "hit your usage limit", "quota exceeded" or a 429 is `quota`; a 401, "Not logged in" or a failed token refresh is `auth`. No max-turns setting: the job timeout covers it.
- **detect():** `codex --version`, then `codex login status`, which exits 0 only when signed in.

### Gemini CLI's quirks

`agents/gemini-cli/` drives `gemini -p … -o stream-json`. Its flags and settings were read from Gemini CLI 0.63.0's own docs and source, and it passed the live suite with 0.66.0 on a free-tier key (`gemini-3.5-flash-lite`, 2026-11-01).

- **It bills your API key.** Google no longer lets a personal Google login drive Gemini CLI from a tool like this, so it needs `GEMINI_API_KEY` (a Google AI Studio key) and `"apiBilling": true`. That key is the only one let through; `GOOGLE_API_KEY` never is. On the free tier, pick a model with room in its daily allowance: `gemini-3.8-flash` (the default pick) allows only 20 requests a day, which one review uses up, after which Gemini CLI retries in silence until the job times out. `"model": "gemini-3.5-flash-lite"` passed the live suite for free.
- **Its own home.** `GEMINI_CLI_HOME` is the run's private folder, so your `~/.gemini` (settings, MCP servers, extensions, GEMINI.md) and `~/.env` are never read. Nitpilot writes `.gemini/settings.json` there with the MCP server and token, a `tools.core` allowlist, hooks and subagents off, and `advanced.ignoreLocalEnv`.
- **A policy file as the lock** (`--policy`): every tool refused, then the mode's own tools and the `nitpilot` MCP server allowed, and the shell and web refused above all. Gemini CLI only warns about a policy file it can't read, so `tools.core` stays as a second lock.
- **`--skip-trust`:** headless, an untrusted folder exits or connects no MCP server. The scrub (`.gemini/`, `.agents/`, `GEMINI.md`, `.env`) keeps the PR's own settings out.
- **Endings:** exit 0 and a `result` line with `status: "success"`. A failed `result` carries Gemini CLI's error: `FatalTurnLimitedError` (exit 53) is `max_turns`; `RESOURCE_EXHAUSTED` or a 429 is `quota`; an invalid or missing key is `auth`. Progress comes from tool calls only, since its own words stream in small pieces.
- **detect():** `gemini --version`, then whether `apiBilling` is on and the key is set. It can't check the key without calling the API.

### The fake agent

`agents/fake/` is the smallest adapter and the best template. It runs `agent.ts`, a script that follows a JSON scenario file over real MCP ("raise two points; fix one; resolve both"), so tests exercise the whole loop with no model. `NITPILOT_FAKE_SCENARIO=<file>` points it at another scenario; the live acceptance run uses that for its second account. It only runs from a source checkout.

## A platform adapter

Everything is in `apps/server/src/platform/`. `types.ts` defines `PlatformAdapter = PlatformReads & PlatformWrites`.

**Reading**

- `parseWebhook(headers, raw)` → `NormalizedEvent[]`. Turn the platform's payload into the engine's events (`pr_opened`, `review_requested`, `head_updated`, `external_comment`, …). `[]` means "nothing for us". It may call the platform's API, for example to fetch a submitted review's comments instead of trusting the order webhooks arrive in.
- `getPr(pr)` → `PrSnapshot`, the PR as it is right now.
- `readDefaultBranchFile(repo, path, etag?)`: the team's rules file, from the default branch only, so a PR can't change its own rules. Uses the ETag so an unchanged file costs nothing.
- `gitSpec(pr)`: where the CLI fetches the code (`refs/pull/N/head` on GitHub) and where it may push (`null` for a PR from a deleted fork).
- `findOpenPrsFor(user)`: the person's open PRs, found with their own token, for catching up.

**Writing** (all three accept `{ reuseIfContains }`, so a retry after a timeout finds the earlier write instead of posting twice)

- `upsertSummary`: the one summary comment, as the app bot, edited in place.
- `postReview`: one review, as the person, with its inline comments.
- `replyToThread`: a reply in a comment thread, as the person.

Two conventions the adapter must keep: it never alters the body it is given (the hidden `<!-- nitpilot:v1 … -->` marker inside is how Nitpilot recognizes its own writes coming back as webhooks), and ids are strings.

The webhook signature check is still GitHub-specific and lives in the HTTP route (`http/routes/webhooks.ts`, `lib/hmac.ts`). A second platform would move it behind the adapter; `verifyWebhook` is where it belongs.

### How a platform adapter is tested

1. **Normalizers, with hand-built payloads** (`platform/github/normalize/*.test.ts`) for every action and edge case: fast, and they pin down each rule.
2. **Recorded fixtures** (`test/fixtures/recorded/`): real deliveries from a sandbox repo, replayed through `parseGithubWebhook`, with hand-written expected events. This is what proves the adapter reads what the platform really sends. Record with `npm run record:fixtures -w apps/server`; see [recorded fixtures](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/recorded-fixtures.md).
3. **`FakePlatform`** (`platform/fake/`): the whole interface in memory. It parses payloads with the same code and records every write, so the engine, dispatcher and end-to-end tests run without a network. A new platform's own fake is a copy of it with the new payloads.
4. **The live acceptance run**, with the new platform's sandbox (a manual checklist for GitHub).
