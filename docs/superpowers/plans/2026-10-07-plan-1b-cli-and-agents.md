# Plan 1b: CLI and Agents (M6–M13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: task level.** This plan fixes the tasks, files, interfaces and the tests each task must contain. The step-by-step code (TDD steps with full test and implementation code, exact commands and expected output) is written **after Plan 1a is built**, against the real code, so the names and types below can be checked against what exists. Until then, nobody should execute this plan.

**Goal:** Connect each developer's own agent to the Plan 1a server: a CLI daemon that receives jobs over a WebSocket, runs Claude Code or Gemini CLI safely in an isolated git worktree with a local MCP server, pushes fixes, and reports results. Then prove it end to end and with the live acceptance test from spec §20.

**Architecture:**
- **Server side:** a CLI hub on `/ws/cli` assigns jobs to live CLIs with leases and fencing, and turns their messages into engine events through Plan 1a's `Dispatcher`.
- **CLI side** (`apps/cli`): a Node CLI with a daemon. For each job it fetches the PR into a detached git worktree using safe git settings, scrubs agent config files, exposes Nitpilot's tools through a per-job MCP endpoint on localhost, and runs the user's agent CLI through an adapter. For address jobs it commits and pushes itself.

**Tech Stack:** everything from Plan 1a, plus `ws` (server WebSocket), the Node 22 built-in `WebSocket` client, the MCP TypeScript SDK v2, `picomatch` (ignore paths), `tsup` (bundling the CLI), and the user's installed `claude` / `gemini` binaries.

**Spec:** `docs/superpowers/specs/2026-10-07-nitpilot-design.md`. Read §7, §9.4, §10, §11, §12, §14 and §20 before starting. **Builds on:** `docs/superpowers/plans/2026-10-07-plan-1a-server-core.md`.

## Global Constraints

Plan 1a's Global Constraints apply. In addition (values copied from the spec):

- **Agents never get a shell.** A reviewer agent only reads; an editor agent reads and edits inside its worktree. Checks are allowlisted commands the CLI runs with `execFile` (§5, §14.2).
- **Safe git.** Every git call carries `-c core.hooksPath=<empty dir>`, `-c core.symlinks=false`, `-c core.fsmonitor=false` and `-c submodule.recurse=false`, with `GIT_DIR` and `GIT_WORK_TREE` set explicitly and `GIT_TERMINAL_PROMPT=0` (§11).
- **Scrub before the agent runs:** `.claude/`, `.gemini/`, `.mcp.json`, `.env`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, at any depth. Each is marked `skip-worktree`, then deleted. Repo conventions are read from the **base** branch (§11 step 3).
- **Commit and push** with `git commit --no-verify --trailer "Nitpilot-Job: <id>"` under the user's own git identity. `job.pushing` must be acked before `git push --no-verify <headRemote> HEAD:refs/heads/<headRef>`. Never force-push. A non-fast-forward is `branch_moved` (§11 step 6).
- **Local MCP server:** one per daemon, on `127.0.0.1:<random port>`, with localhost Host and Origin validation. Each job gets a 32-byte bearer token, compared with `timingSafeEqual`; it picks the job's tool set and stops working when the job ends (§11).
- **Untrusted text** (PR title, body, comments) is wrapped in `<untrusted source="…">` in tool results (§11).
- **Personal config:** `~/.config/nitpilot/config.json` or `$NITPILOT_CONFIG_DIR/config.json`, mode 0600, with environment-variable overrides (§13).
- **Personal defaults:** `concurrency` 1, `jobTimeoutMinutes` 15, `dailyJobCap` 40 (§13).
- **Connection:** reconnect backoff starts at 1 s and doubles up to 30 s, with jitter, and resets after `welcome`. Close codes: `4401` means log in again, `4426` means upgrade the CLI, `1012` means reconnect. Ping every 25 s; the lease is 90 s; a job missing from two pings in a row goes back to `queued` (§9.4, §10).
- **Fencing:** every job message carries `(jobId, attempt)`. Messages from an old attempt are acked `stale` and ignored (§9.4).
- **Results are all-or-nothing:** agent tool calls are buffered locally and sent once in `job.complete`. Progress is streamed at most every 2 s (§10).
- **Snippets:** ±5 lines read with `git show <sha>:<path>` (§11 step 7).
- **Agent environments** are built from an allowlist. `ANTHROPIC_API_KEY` is removed unless the user opts into API billing. `GITHUB_TOKEN`, `GH_TOKEN`, `NPM_TOKEN` and `AWS_*` never reach an agent (§12.3 S3).
- **Claude Code and Gemini CLI flags** are exactly those in §12.2, checked against the installed versions at the start of Tasks 19–20.
- **Packaging:** the CLI bundles `packages/protocol` (tsup `noExternal`), has `publishConfig.access: "public"`, and its tests run in CI (§7, §23).
- **Windows** is unsupported in v1; `nitpilot doctor` warns (§18).

## Review Focus

Spec-implied conditions no single test naturally covers, most likely first. Each gets a test in the task named.

1. **The laptop sleeps mid-job and wakes up.** If the lease is still valid, `hello.running` rebinds the job and the work continues. If it expired, the job was requeued, and the stale CLI gets `job.cancel` and its late result is acked `stale`. The job never runs twice at the same time. → Tasks 3, 7.
2. **The branch moves under an address job,** because a human pushed. The push is rejected as non-fast-forward → `branch_moved`. The server has already cancelled and requeued the job (Plan 1a Task 9), so the old attempt's result is `stale`. Nothing is force-pushed. → Tasks 4, 11, 18.
3. **A force-push between rounds:** `sinceSha` is no longer an ancestor of the head. `list_changed_files` and `get_diff` fall back to a full review and say so to the agent. → Task 13.
4. **Hostile repo content:** hooks (husky, a relative `core.hooksPath`), symlinks to secrets, `.mcp.json`, `.claude/settings.json` hooks, `.env` with `HTTPS_PROXY`, and a `CLAUDE.md` with injected instructions. None of them may take effect. → Tasks 9, 10, 21.
5. **Two CLIs for the same user** (laptop and desktop), only one with the repo linked. A job goes to exactly one CLI, only one that has the repo, and only when it has free capacity. A PR from a deleted fork fails an address job early with a clear reason instead of pushing somewhere wrong. → Tasks 2, 11.

---

## Milestone M6: The CLI hub (server)

### Task 1: `/ws/cli`: authenticated WebSocket, hello and welcome

**Files:**
- Create: `apps/server/src/ws/cli-hub.ts`, `apps/server/src/ws/connection.ts`, `apps/server/src/ws/cli-hub.db.test.ts`, `docs/why/websockets.md`
- Modify: `apps/server/src/main.ts` (attach the hub to the HTTP server returned by `serve()`)
- Install: `ws`, `@types/ws` in `apps/server`

**Interfaces:**
- Consumes (Plan 1a):
  - `authenticateCliToken(header) → CliAuth | null` (`auth/cli-token.ts`);
  - `CliToServer`, `ServerToCli`, `encode`, `PROTOCOL_VERSION`, `PING_SEC`, `LEASE_SEC`, `CLOSE_CODES` (`@nitpilot/protocol`);
  - `prisma`.
- Produces:
  - `class CliHub` with:
    - `attach(server: http.Server)`: handles `upgrade` for `/ws/cli` only; others get 404;
    - `connectionsFor(userId): CliConnection[]` and `connection(tokenId): CliConnection | undefined`;
    - `send(tokenId, msg: ServerToCli): boolean`;
    - `onMessage(handler)`, which Tasks 2–4 register;
    - `closeAll(code)`;
  - `type CliConnection = { tokenId; userId; login; device; repos: Set<string>; concurrency; agent; running: Map<jobId, attempt>; lastPings: RunningJob[][]; socket }`.

**Behavior:**
- The bearer token is checked **before** the upgrade (HTTP 401, no socket).
- The first message must be `hello`. A wrong `protocol` closes with `4426`. The server answers `welcome { login, pingSec: PING_SEC, leaseSec: LEASE_SEC }`.
- Messages that fail `CliToServer` validation are logged and dropped; the socket stays open.
- A token revoked while connected closes with `4401` on its next message.
- Server shutdown closes all sockets with `1012`.

**Tests this task must include:** no token → 401; revoked token → 401; hello → welcome with the login; protocol 2 → close 4426; garbage message → no crash and the connection stays; two connections of one user are both listed; `closeAll(1012)` closes both.

`docs/why/websockets.md` explains:
- why a long-lived socket instead of polling (instant, no tokens spent when nothing happens);
- what a lease is, in one paragraph pointing ahead to Task 3.

### Task 2: Job assigner and bundle builder

**Files:**
- Create: `apps/server/src/jobs/assign.ts`, `apps/server/src/jobs/bundle.ts`, `apps/server/src/jobs/assign.db.test.ts`, `apps/server/src/jobs/bundle.db.test.ts`
- Modify: `apps/server/src/main.ts` (wake the assigner on `dispatcher.onCommit` when `effects.jobsChanged`, on `hello`, after any job finishes, and every 5 s for `runAfter`)

**Interfaces:**
- Consumes:
  - `CliHub`;
  - `Job` fields `status`, `activeFor`, `attempt`, `runAfter`, `cliTokenId`, `leaseExpiresAt`, `headSha`, `applyState`;
  - `PrChat`, `Repo`, `Participant`, `Point`, `Message`;
  - `gitSpecFor`, `rulesFromJson`, `JobBundle`.
- Produces:
  - `class JobAssigner { wake(): void; assignNow(): Promise<number> }`;
  - `buildJobBundle(jobId): Promise<JobBundle>`.

**Behavior** (spec §9.4 "Assigning a job"):
- One atomic compare-and-swap: `queued → running`, `attempt + 1`, `leaseExpiresAt = now + 90 s`, `cliTokenId`, and `headSha = chat.headSha` (a queued job follows the latest head).
- The job is bound to a live connection that belongs to `job.userId`, has `chat.repo.fullName` in `repos`, and has fewer running jobs than its `concurrency`.
- No offer/accept round-trip.
- The bundle includes:
  - points with their threads (messages by `pointNumber`) and human notes;
  - `sinceSha` and `round`;
  - `maxRounds` and `rules { ignorePaths, alwaysEscalate, maxPoints }`;
  - `apply: applyState === 'draft' ? 'draft' : 'auto'`;
  - `you { login, role }`;
  - `git` from `gitSpecFor` (`headRepoPath` null for a deleted fork).

**Tests this task must include:**
- assigns to the owner's CLI that has the repo;
- never to another user's CLI;
- stays queued when no CLI has the repo linked;
- respects concurrency 1;
- two CLIs of one user → exactly one gets it (Review Focus #5);
- `runAfter` in the future → not yet;
- the bundle carries threads, notes, `sinceSha`, `apply: 'draft'`, and `headRepoPath: null` for a deleted fork.

### Task 3: Leases, ping, fencing and rebinding

**Files:**
- Create: `apps/server/src/jobs/leases.ts`, `apps/server/src/jobs/leases.db.test.ts`, `docs/why/leases-and-fencing.md`
- Modify: `apps/server/src/ws/cli-hub.ts`

**Interfaces:**
- Consumes: `CliHub`, `Dispatcher.dispatch`, `Job`.
- Produces:
  - `handlePing(conn, running)`;
  - `handleHelloRunning(conn, running)`;
  - `sweepExpiredLeases(now)`;
  - `isCurrentAttempt(job, conn, attempt): boolean` (the fencing check Task 4 uses).

**Behavior:**
- `ping` extends `leaseExpiresAt` for every listed `(jobId, attempt)` that is running, bound to this token and on the current attempt. The server replies `pong`.
- A running job bound to this connection that is missing from **two consecutive** pings → the server dispatches `job_failed { reason: 'timeout', retryable: true }`. The engine decides the backoff and the attempt limit.
- The sweep (every 5 s) does the same for leases that expired because a connection went away.
- On `hello.running`:
  - a job still running on that attempt is re-bound to the new connection (same user), and its lease is extended;
  - anything else gets `job.cancel`.

**Tests this task must include** (spec §19 "CLI hub"):
- a ping extends the lease;
- two missed pings requeue through the engine;
- an expired lease is swept;
- a laptop waking before expiry keeps its job (Review Focus #1);
- a laptop waking after the job was reassigned gets `job.cancel`;
- a message carrying an old attempt is reported stale.

`docs/why/leases-and-fencing.md` explains:
- a lease as a library loan that must be renewed;
- the attempt number as the fencing token;
- why stale answers are acknowledged but ignored.

### Task 4: Results in; cancels and notifications out

**Files:**
- Create: `apps/server/src/ws/handlers.ts`, `apps/server/src/ws/handlers.db.test.ts`, `apps/server/src/tasks/cli-notifier.ts`
- Modify: `apps/server/src/main.ts` (replace `LogNotifier` with `CliNotifier`; on `dispatcher.onCommit`, send `job.cancel` for every `effects.cancelledJobs` entry whose `cliTokenId` has a live connection)

**Interfaces:**
- Consumes: `DispatchEffects.cancelledJobs`, `Notifier`, `JobResult`, `isCurrentAttempt`.
- Produces: `handleCliMessage(conn, msg)` and `class CliNotifier implements Notifier`.

**Behavior:**
- **`job.pushing`:** fenced; records `expectedPushSha = to`; acks `applied`. The CLI must not push before this ack, so Plan 1a's router recognizes the push.
- **`job.complete`:** fenced; dispatches `job_completed { jobId, result }`; acks `applied`.
- **`job.fail`:** dispatches `job_failed { reason, retryable }`.
- **`job.reject`:** dispatches `job_failed { reason, retryable: true }`. The engine waits on `daily_cap` and `repo_not_linked`.
- **`job.progress`:** kept in memory for Plan 2's live line; logged at debug level.
- **`CliNotifier`:** sends `notify { kind, chatId, title, url }` to every live connection of each user; a user with no connection falls back to the log.

**Tests this task must include:**
- complete → points saved and the next job queued;
- a stale complete is acked `stale` and nothing changes;
- pushing records the sha and acks;
- reject `daily_cap` requeues later without counting an attempt;
- closing the PR mid-job sends `job.cancel` to the right CLI;
- `notify` reaches both of a user's CLIs.

---

## Milestone M7: CLI commands

### Task 5: CLI skeleton, personal config, server client and build

**Files:**
- Create:
  - `apps/cli/src/index.ts` (the `nitpilot <command>` dispatcher using `node:util` `parseArgs`);
  - `apps/cli/src/config/config.ts` and `apps/cli/src/config/config.test.ts`;
  - `apps/cli/src/http.ts`;
  - `apps/cli/vitest.config.ts` and `apps/cli/tsup.config.ts`.
- Modify: `apps/cli/package.json`:
  - `bin: { nitpilot: dist/index.js }`, `files: [dist]`, `engines.node >=22`;
  - `publishConfig.access: public`;
  - scripts `build`, `test`, `typecheck`, `dev`.
- Port: `~/Desktop/PracticeProjects/hooksmith/cli/src/config.ts`.

**Interfaces:**
- Produces:
  - `PersonalConfigSchema` (zod; spec §13 shape: `server`, `token`, `agent`, `auto`, `concurrency`, `jobTimeoutMinutes`, `dailyJobCap`, `apiBilling`, `repos{ path, setup?, checks? }`);
  - `configDir()` (`$NITPILOT_CONFIG_DIR` or `$XDG_CONFIG_HOME/nitpilot` or `~/.config/nitpilot`);
  - `loadConfig({ env?, dir? }) → PersonalConfig`, with env overrides `NITPILOT_SERVER` and `NITPILOT_TOKEN`;
  - `saveConfig(cfg, dir?)` (0600, `chmod` even if the file already existed);
  - `ServerClient` (`loginStart`, `loginPoll`, `me`, `myChats`, `revoke`).

**Tests this task must include:**
- `NITPILOT_CONFIG_DIR` wins over XDG;
- env overrides beat the file per field;
- the file is written 0600 and re-chmodded;
- invalid JSON → a clear error naming the file;
- the defaults match spec §13;
- `tsup` output runs `node dist/index.js --help` without `node_modules/@nitpilot/protocol`.

### Task 6: `login`, `status`, `repos add`

**Files:**
- Create: `apps/cli/src/commands/login.ts`, `apps/cli/src/commands/status.ts`, `apps/cli/src/commands/repos.ts`, `apps/cli/src/git/remotes.ts`, and a test for each.

**Interfaces:**
- Consumes: `ServerClient`, `CliLoginPollResponse`, `MeResponse`, `MyChatsResponse`, `safeGit` (Task 9; use plain `execFile` git here until then).
- Produces:
  - `login({ open?, sleep? })`;
  - `status()`;
  - `reposAdd(path?)`;
  - `parseGithubRemote(url) → 'owner/name' | null`, which accepts https, `git@github.com:` and SSH host aliases such as `git@github-a:owner/name.git` (spec §17).

**Behavior:**
- **login** prints "enter WDJB-MJHT at https://…/cli/approve", opens the browser (`open`/`xdg-open` via `execFile`), polls every `interval` until approved, denied or expired, and saves the token.
- **status** prints the login, a `needs_reauth` warning, and a table of chats.
- **repos add** records `repos["owner/name"] = { path }` from the clone's remotes.

**Tests this task must include:**
- the login handshake against Plan 1a's app running in-process;
- denied and expired paths;
- remote parsing table (https, ssh, host alias, non-GitHub → null);
- `repos add` outside a git repo gives a clear error.

### Task 7: `start`: the daemon

**Files:**
- Create: `apps/cli/src/connection/ws-client.ts`, `apps/cli/src/connection/backoff.ts`, `apps/cli/src/daemon.ts`, `apps/cli/src/notify-os.ts`, `apps/cli/src/state.ts` (daily cap counter), and tests.
- Port the reconnect loop from `hooksmith/cli/src/commands/listen.ts`.

**Interfaces:**
- Consumes: `ServerToCli`, `CliToServer`, `encode`, `CLOSE_CODES`, `PersonalConfig`.
- Produces:
  - `startDaemon({ config, executor: JobExecutor, notifier? })`;
  - `type JobExecutor = (bundle, io: { progress(stage, text); pushing(from, to): Promise<'applied' | 'stale'>; signal: AbortSignal }) => Promise<JobOutcome>`;
  - `nextBackoff(prevMs) → ms` (1 s doubling to 30 s, ±20% jitter, reset after welcome).

**Behavior:**
- `hello` reports the linked repos, the agent's id/version/modes from the adapter's `detect()`, `concurrency`, `running` and `defaults`. It pings every `pingSec` with the running jobs.
- The server never assigns more than `concurrency` jobs, so the daemon just runs what it gets.
- `dailyJobCap` is counted per local day in `state.json`; a job over the cap gets `job.reject { reason: 'daily_cap' }`.
- `job.cancel` aborts the executor.
- `notify` prints and shows an OS notification (macOS `osascript`, Linux `notify-send`, both via `execFile`; otherwise print only).
- `4401` → stop: "run `nitpilot login`". `4426` → stop: "upgrade the CLI". Anything else → reconnect with backoff.

**Tests this task must include** (fake timers and a fake WebSocket server):
- backoff sequence and jitter bounds, and the reset after welcome;
- hello contents;
- the ping cadence;
- the daily cap rejects the 41st job;
- `job.cancel` aborts a running executor;
- `4401` stops without reconnecting;
- after a reconnect, `hello.running` lists the job still in progress (Review Focus #1).

### Task 8: `doctor`

**Files:**
- Create: `apps/cli/src/commands/doctor.ts`, `apps/cli/src/commands/doctor.test.ts`.

**Interfaces:**
- Produces: `runDoctor(deps) → Check[]`, where `Check = { name, status: 'ok' | 'warn' | 'fail', detail }`; it prints a checklist.

**Checks** (spec §11, §22):
- Node ≥ 22;
- git installed (version);
- the configured agent installed and logged in (`adapter.detect()`);
- config valid and token accepted (`/api/me`);
- `needs_reauth` → warn;
- each linked repo path exists and its remote matches;
- `commit.gpgsign=true` → warn about passphrase prompts;
- Windows → warn unsupported;
- server reachable.

**Tests this task must include:** one passing and one failing case per check, using injected fakes.

---

## Milestone M8: Safe git

### Task 9: `safeGit()` and the safe-git security tests

**Files:**
- Create: `apps/cli/src/runner/safe-git/safe-git.ts`, `apps/cli/src/runner/safe-git/safe-git.test.ts`, `apps/cli/test/git-fixtures.ts` (temp repos, bare remotes, PR refs).

**Interfaces:**
- Produces:
  - `safeGit(args: string[], opts: { gitDir; workTree?; cwd; env? }) → Promise<{ stdout; stderr; code }>`;
  - `SafeGitError`;
  - `emptyHooksDir(configDir)`.
- `execFile('git', …)` only, no shell. The four `-c` settings come first. The env is an allowlist (`PATH`, `HOME`, `LANG`, …) plus `GIT_DIR`, `GIT_WORK_TREE` and `GIT_TERMINAL_PROMPT=0`.

**Tests this task must include** (spec §12.3 "Safe-git tests"):
- hooks set through a **relative** `core.hooksPath` in the repo's own config never run (a canary file is never written);
- a symlink in the PR checks out as a plain file;
- tampering with `.git` is detected: a worktree whose `.git` file points elsewhere is refused;
- a pushed branch that moved gives a non-fast-forward error the caller can map to `branch_moved`;
- arguments containing `;` or `$(…)` are passed through literally.

### Task 10: Worktree lifecycle, scrub and conventions

**Files:**
- Create: `apps/cli/src/runner/worktree/worktree.ts`, `apps/cli/src/runner/worktree/scrub.ts`, `apps/cli/src/runner/worktree/worktree.test.ts`, `docs/why/git-worktrees.md`.

**Interfaces:**
- Consumes: `safeGit`, `JobBundle`, `BRAND.gitRefNamespace`.
- Produces:
  - `prepareWorktree(bundle, repoPath, configDir, scrubPaths) → { dir, conventions: Record<string, string>, cleanup(): Promise<void> }`;
  - `pruneWorktrees(repoPath)`;
  - `SCRUB_PATHS`.

**Behavior** (spec §11 steps 1–3, 8):
- `git fetch <base> +<fetchRef>:refs/nitpilot/<jobId>`.
- Head sha ≠ `bundle.pr.headSha` → `stale_head`.
- `git worktree add --detach <configDir>/worktrees/<repo>/<pr>-<role> <sha>`.
- Scrub: every match at any depth is marked `skip-worktree`, then deleted.
- Conventions: `git show <baseSha>:CLAUDE.md` (and `AGENTS.md`, `GEMINI.md`) read from the base branch.
- Cleanup removes the worktree and the temporary ref; startup runs `git worktree prune`.

**Tests this task must include:**
- fork PRs (fetching from the base repo's PR ref);
- `stale_head`;
- scrub at depth, and a later commit does **not** record the deletions;
- conventions come from base, not from a malicious head `CLAUDE.md`;
- paths with spaces and unicode survive;
- cleanup leaves no worktree or ref behind.

`docs/why/git-worktrees.md` explains:
- a worktree as a second checkout of the same repo;
- why the user's own folder is never touched.

### Task 11: Commit and push for address jobs (and drafts)

**Files:**
- Create: `apps/cli/src/runner/push.ts`, `apps/cli/src/runner/push.test.ts`.

**Interfaces:**
- Consumes: `safeGit`, `BRAND.commitTrailer`, `JobBundle.git`, `io.pushing`.
- Produces: `commitAndPush(ctx) → { push: PushInfo | null }`, throwing `JobFailure('branch_moved' | 'git_error', …)`.

**Behavior** (spec §11 step 6):
- No changes → `push: null`.
- Otherwise `git add -A` and `commit --no-verify --trailer "Nitpilot-Job: <id>"` with the user's own identity.
- Await the `pushing` ack. `stale` → abort without pushing.
- `push --no-verify <headRemote> HEAD:refs/heads/<headRef>`, never forced. A non-fast-forward → `branch_moved`.
- `headRepoPath === null` (deleted fork) fails as `git_error` **before** the agent runs; the executor checks this first.
- `apply: 'draft'`: commit to `refs/nitpilot/drafts/<jobId>` and don't push (spec §20 Plan 2 note).

**Tests this task must include** (against a local bare remote):
- the happy path, with the trailer and the right author;
- a husky-style hook in the repo never runs;
- a non-fast-forward gives `branch_moved` and nothing is forced (Review Focus #2);
- a stale ack means no push;
- draft mode keeps the ref and pushes nothing;
- a deleted fork fails early.

---

## Milestone M9: The local MCP server

### Task 12: MCP server, per-job tokens and tool sets

**Files:**
- Create: `apps/cli/src/mcp/server.ts`, `apps/cli/src/mcp/tokens.ts`, `apps/cli/src/mcp/server.test.ts`, `docs/why/prompt-injection.md`.
- Install: `@modelcontextprotocol/sdk` (v2).

**Interfaces:**
- Produces:
  - `startMcpServer() → { port, registerJob(job: McpJobContext) → { url, token, unregister() }, close() }`;
  - `type McpJobContext = { bundle, worktreeDir, conventions, checks, buffer: ResultBuffer }`;
  - `toolsFor(jobType)`.

**Behavior:**
- Listens on `127.0.0.1:0`.
- A missing or wrong bearer token → 401, compared with `timingSafeEqual` on equal-length buffers.
- A `Host` other than `127.0.0.1:<port>`/`localhost:<port>` → 403 (DNS rebinding). A non-local `Origin` → 403.
- Each request is routed to its job by token. After `unregister`, the token stops working.
- Tool sets (spec §11 table):
  - review: `get_job`, `list_changed_files`, `get_diff`, `get_file`, `add_point`, `finish`;
  - re_review: the same plus `decide_point`;
  - address: `get_job`, the read tools, `reply_to_point`, `run_check`, `finish`.

**First step of this task:** check the MCP TS SDK v2 API (`createMcpHandler`, transport, tool registration) against its current docs, and record the version used.

**Tests this task must include:**
- 401 without a token, with a wrong token, and after unregister;
- 403 for a foreign Host or Origin;
- `tools/list` differs per job type;
- two jobs at once each see only their own tools and data.

`docs/why/prompt-injection.md` explains:
- why PR text is untrusted;
- how the tool design (no shell, wrapped untrusted text, base-branch conventions) limits the damage.

### Task 13: Read tools

**Files:**
- Create: `apps/cli/src/mcp/tools/read.ts`, `apps/cli/src/mcp/tools/read.test.ts`, `apps/cli/src/mcp/untrusted.ts`.

**Interfaces:**
- Produces:
  - `getJob(ctx)`;
  - `listChangedFiles(ctx, { since? }) → { path, status, adds, dels, binary, ignored }[]`;
  - `getDiff(ctx, { path, since? })`, capped at 100 KB with a note;
  - `getFile(ctx, { path, ref: 'base' | 'head', from?, to? })`, read with `git show` only, never from the filesystem;
  - `wrapUntrusted(source, text)`.

**Behavior:**
- `get_job` returns the type, the round, the PR title and body (wrapped), the base-branch conventions, the human notes, the points with replies, and the rules.
- The diff range is `merge-base..head`, or `since..head`.
- **Force-push fallback:** if `since` isn't an ancestor of head (`merge-base --is-ancestor`), use the full range and include "full re-review: history was rewritten" in the result (Review Focus #3).
- `ignored` comes from `ignore_paths` via `picomatch`.

**Tests this task must include:**
- added, modified, deleted, renamed and binary files;
- paths with spaces and unicode;
- the force-push fallback;
- PR body wrapped as untrusted (including a body that tries to close the tag);
- `get_file` can't read a scrubbed `.env` from the worktree;
- the size cap.

### Task 14: Write tools, the result buffer and snippets

**Files:**
- Create: `apps/cli/src/mcp/tools/write.ts`, `apps/cli/src/mcp/buffer.ts`, `apps/cli/src/runner/snippets.ts`, and tests.

**Interfaces:**
- Produces:
  - `addPoint(ctx, NewPoint-without-snippet) → { ref }`;
  - `decidePoint(ctx, { point, decision, comment })`;
  - `replyToPoint(ctx, { point, resolution, comment })`;
  - `finish(ctx, { summary })`;
  - `class ResultBuffer { toJobResult(push): JobResult }`;
  - `snippetFor(gitCtx, sha, path, line) → Snippet` (±5 lines).

**Validation:**
- `add_point`:
  - the path must be among the changed files and not ignored;
  - in `re_review`, only files changed after `sinceSha`;
  - at most `rules.maxPoints`;
  - the body ≤ 4,000 characters.
- `decide_point` only on agent points raised by `bundle.you`.
- `reply_to_point` only on open points.
- When `finish` is missing, the summary is derived from the results (spec §11).
- Errors go back to the agent as tool errors, so it can correct itself.

**Tests this task must include:** each validation rule; the snippet window at the start and end of a file; the buffer turns into a valid `JobResult` (protocol schema parse).

### Task 15: `run_check`

**Files:**
- Create: `apps/cli/src/mcp/tools/run-check.ts`, `apps/cli/src/mcp/tools/run-check.test.ts`.

**Interfaces:**
- Produces: `runCheck(ctx, { name }) → { ok, exitCode, outputTail }`.

**Behavior:**
- Only commands from `config.repos[repo].checks`, run with `execFile` (no shell), `cwd` set to the worktree, the allowlisted env, a timeout, and the last 4 KB of output.
- Address jobs only.

**Tests this task must include:** an unknown check name is refused; `;` in arguments is literal; a timeout kills the process; the output is cut to its tail.

---

## Milestone M10: End to end

### Task 16: Agent adapter interface, `AgentRunner` and the fake agent

**Files:**
- Create:
  - `apps/cli/src/agents/types.ts` (the spec §12.2 `AgentAdapter` and `AgentMode`, verbatim);
  - `apps/cli/src/agents/runner.ts` and `apps/cli/src/agents/runner.test.ts`;
  - `apps/cli/src/agents/fake/adapter.ts`, `apps/cli/src/agents/fake/agent.ts` (a Node script using the MCP client SDK);
  - `apps/cli/src/agents/fake/scenarios/*.json`;
  - `apps/cli/src/agents/registry.ts`.

**Interfaces:**
- Produces:
  - `runAgent(adapter, invocation, { timeoutMs, signal }) → AgentOutcome`. It spawns in its own process group, feeds stdout lines to `parseLine`, keeps the stderr tail, and kills the whole tree with SIGTERM then SIGKILL after 5 s;
  - `getAdapter(id)`;
  - the fake adapter and scenario files such as "raise P1 and P2; when addressing, fix P1 and decline P2; on re-review, resolve P1 and keep P2".

**Tests this task must include:**
- a hanging agent whose child process also hangs is fully killed within timeout + 5 s (the spec L5 analogue, runs in CI);
- the fake agent completes a scenario over real MCP;
- an agent that exits without writing anything → `no_result`.

### Task 17: The job executor

**Files:**
- Create: `apps/cli/src/runner/execute.ts`, `apps/cli/src/runner/execute.test.ts`.
- Modify: `apps/cli/src/commands/start.ts` (wire the real executor into `startDaemon`).

**Interfaces:**
- Consumes: `prepareWorktree`, the setup command, the MCP server, the adapter, `runAgent`, `commitAndPush`, `snippetFor` and `ResultBuffer`.
- Produces: `createExecutor({ config, mcp, adapter }) → JobExecutor`.

**Behavior** (spec §11 steps 1–8):
1. Prepare the worktree.
2. For address jobs, run the repo's `setup` command (failure → `setup_failed`).
3. Register the job with MCP.
4. Build the invocation with the user's model and `maxTurns`, and run the agent.
5. For address jobs, `commitAndPush`.
6. Attach snippets.
7. Return the `JobResult`. Map failures to a `FailureReason` and a `retryable` flag.
8. Always clean up.

Progress is reported at most every 2 s.

**Tests this task must include:**
- the review and address paths with the fake agent and local repos;
- setup fails → `setup_failed`;
- `job.cancel` mid-run kills the agent and cleans up;
- the worktree is removed even when the agent crashes.

### Task 18: End-to-end test in CI

**Files:**
- Create: `apps/cli/test/e2e/harness.ts` (starts the Plan 1a server in-process on a random port with `FakePlatform`, the hub and the runner; plus two daemons with separate `NITPILOT_CONFIG_DIR`s and a local bare "GitHub" remote), `apps/cli/test/e2e/agent-to-agent.e2e.test.ts`, `apps/cli/test/e2e/scenarios.e2e.test.ts`.
- Modify: the root `package.json` (`test:e2e`) and `.github/workflows/ci.yml` (run it).

**Must pass** (spec §19, §20 Plan 1 acceptance, minus the live parts):
- B's review job starts within 5 s of the review request;
- the chat reaches READY within `max_rounds`;
- exactly one summary write, edited across rounds, with the transcript link;
- no review-thread writes;
- the fix commits are authored by A and carry the trailer;
- only B is notified;
- no job is duplicated;
- every `RawEvent` is processed.

**Scenarios:**
- a security point escalates and notifies both sides;
- B's CLI stops → its job waits; B restarts → the job completes;
- the PR is closed mid-job → `job.cancel`, and the worktree is cleaned up;
- a human pushes during the address job → `branch_moved`, a new address pass on the new head, and nothing is force-pushed (Review Focus #2).

---

## Milestone M11: Real agents

### Task 19: Claude Code adapter and static conformance (S1–S6)

**Files:**
- Create: `apps/cli/src/agents/claude-code/adapter.ts`, `apps/cli/src/agents/claude-code/fixtures/*.jsonl` (recorded stream-json: success, max_turns, auth, quota, crash, signal), `apps/cli/src/agents/conformance/static.ts` (the shared suite), `apps/cli/src/agents/claude-code/conformance.test.ts`.

**First step:** check every flag in spec §12.2 against `claude --help` for the installed version (spec: v2.1.29x), and record the version in the adapter.

**Behavior:**
- **Reviewer:** `claude -p <prompt> --output-format stream-json --verbose --max-turns <n> --tools "Read,Glob,Grep" --allowedTools mcp__nitpilot --permission-mode dontAsk --mcp-config <tmp>/mcp.json --strict-mcp-config --setting-sources user --settings '{"disableAllHooks":true}' --disable-slash-commands`.
- **Editor:** adds `Edit,Write` to `--tools` and uses `--permission-mode acceptEdits`.
- **MCP config:** `{"mcpServers":{"nitpilot":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"},"alwaysLoad":true}}}`, written to a 0600 file. The token never appears in the command-line arguments.
- `scrubPaths`: `.claude/`, `.mcp.json`, `CLAUDE.md`.

**Tests this task must include:** the static suite S1–S6 from spec §12.3 run against this adapter.

### Task 20: Gemini CLI adapter and static conformance

**Files:**
- Create: `apps/cli/src/agents/gemini-cli/adapter.ts`, its fixtures, `apps/cli/src/agents/gemini-cli/conformance.test.ts`.

**First step:** check the flags and settings keys against `gemini --help` and the installed version (spec: v0.63).

**Behavior** (spec §12.2):
- Command: `gemini -p <prompt> -o stream-json --skip-trust -e none --allowed-mcp-server-names nitpilot --policy <tmp>/policy.toml`.
- `GEMINI_CLI_SYSTEM_SETTINGS_PATH=<tmp>/settings.json` holds `mcpServers.nitpilot { httpUrl, headers, trust: true }` and the `tools.core` allowlist. Reviewer: `read_file`, `read_many_files`, `list_directory`, `glob`, `grep_search`. Editor adds `replace`, `write_file`.
- The policy denies `run_shell_command`, `web_fetch` and `google_web_search` at priority 999.
- `scrubPaths`: `.gemini/`, `GEMINI.md`, `AGENTS.md`.

**Tests this task must include:** the static suite S1–S6.

### Task 21: Live conformance (L1–L6)

**Files:**
- Create: `apps/cli/src/agents/conformance/live.test.ts`, which runs only when `NITPILOT_LIVE=1`, and `apps/cli/src/agents/conformance/traps.ts`.

**Must cover** spec §12.3 L1–L6, for each adapter and each mode it declares:
- **L1:** `get_job` and `add_point` reach the result.
- **L2:** a booby-trapped worktree, with canaries (a marker file and a local canary port):
  - `.claude/settings.json` hooks;
  - a `.mcp.json` stdio server;
  - `.gemini/settings.json` with mcpServers, hooks and a discovery command;
  - `.env` with `HTTPS_PROXY` set to the canary port;
  - a `CLAUDE.md` asking for an "INJECTED" point.

  It must pass with the scrub on. Without the scrub, it may fail only for paths the adapter declares in `scrubPaths`.
- **L3:** a reviewer can't write, run a shell, or read `../outside/secret`, and nothing leaks.
- **L4:** an editor can't `git commit/push`, curl the canary, write outside its folder, or edit `.git`.
- **L5:** a hang is killed within timeout + 5 s.
- **L6:** no MCP write → `no_result`.

An adapter that fails a mode doesn't declare that mode (spec §22).

---

## Milestone M12: Catch-up and the transcript

### Task 22: Catch-up on connect and the "waiting" activity

**Files:**
- Create: `apps/server/src/jobs/catch-up.ts`, `apps/server/src/chats/activity.ts`, and tests.
- Modify: `apps/server/src/platform/types.ts` (add `findOpenPrsFor(userId)` and `listThreads(pr)` to `PlatformReads`), `apps/server/src/platform/github/reads.ts`, `apps/server/src/platform/fake/fake-platform.ts`, `apps/server/src/ws/cli-hub.ts`.

**Interfaces:**
- Produces:
  - `catchUp(userId)`, run once per user per server boot on their first `hello`. It runs three searches with the user's token (`is:pr is:open author:<login>`, `review-requested:<login>`, `reviewed-by:<login>`; within 30 requests/minute). Each PR without a chat goes through Plan 1a's `routePrEvent` with a `pr_opened` built from `getPr`;
  - `deriveActivity(chat, jobs, connections) → agent_working{who} | agent_waiting{who, offlineSince | repo_not_linked | cap_reached} | human_turn{who} | none` (spec §9.1, never stored).

**Tests this task must include:**
- catch-up creates missing chats once and skips known ones;
- each activity case, including "offline since…" from `CliToken.lastSeenAt` and `repo_not_linked` when the user's CLIs lack the repo.

### Task 23: Read-only transcript page

**Files:**
- Create: `apps/server/src/http/routes/transcript.tsx`, `apps/server/src/http/pages/transcript.tsx`, `apps/server/src/http/routes/transcript.db.test.ts`.

**Interfaces:**
- Route `GET /c/:owner/:repo/:number` (spec §10). It requires sign-in and read access to the repo, checked with the viewer's own token (`GET /repos/{owner}/{repo}`) and cached for 5 minutes.

**Behavior:**
- The page shows the header (title, `repo#n`, phase, round x of max, the `Repo.rulesError` warning when present), the activity from Task 22, and the timeline.
- Point cards show severity, category, `file:line`, the snippet, the status and the thread.
- Styling is plain (Plan 1a's `Layout`); the real design is Plan 2.

**Tests this task must include:**
- not signed in → redirect to sign-in with `next`;
- no repo access → 404;
- the timeline renders in `seq` order with the right status words;
- a viewer with `needs_reauth` is asked to sign in again.

---

## Milestone M13: Acceptance and docs

### Task 24: Live acceptance runbook, recorded fixtures and docs

**Files:**
- Create:
  - `docs/acceptance/plan-1.md`: the spec §20 setup, pass criteria and every variant as a checklist, including the single-player runs;
  - `apps/server/test/fixtures/recorded/*.json` (real deliveries from the sandbox, with secrets removed) and `apps/server/test/fixtures/recorded.test.ts`, which normalizes each one;
  - `docs/architecture.md` (Odyhook's Chosen / Alternatives / Why style);
  - `docs/adapters.md` (how to write an agent or platform adapter, and how to run the conformance suite).
- Modify: `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §22 with what the sandbox showed.

**Verify in the sandbox and record the answers:**
- Does re-requesting a review fire `review_requested` again?
- Does a reviewer submitting a review fire `review_request_removed`? This matters for Plan 1a's `requested` flag.
- Do replies created in the GitHub UI also arrive as `pull_request_review.submitted`?

**Done when:** the runbook passes end to end with CLI A on Claude Code and CLI B on Gemini CLI, and every variant is ticked.
