# Plan 1b: CLI and Agents (M6–M13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: M6 and M7 at step level; M8–M13 at task level.** M6 (Tasks 1–4) has full TDD steps (test and implementation code, exact commands, expected output), written on 2026-10-09 against Plan 1a's merged code (`main` at `6417c39`). M7 (Tasks 5–8) was written the same way on 2026-10-10, against the branch after M6 (`f2dc50f`). "Checked against Plan 1a's code (M6)" and "Checked against the code (M7)" below list where each differs from the earlier task-level text. M8–M13 still fix only the tasks, files, interfaces and tests; their step-level code is written one milestone at a time, against the code that exists by then. Nobody executes a task that is still at task level.

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
- **Connection:** reconnect backoff starts at 1 s and doubles up to 30 s, with jitter, and resets after `welcome`. Close codes: `4401` means log in again, `4426` means upgrade the CLI, `4409` means another `nitpilot start` on this device took over (stop), `1012` means reconnect. One live connection per CLI token. Ping every 25 s; the lease is 90 s; a job missing from two pings in a row goes back to `queued`; a CLI silent for 60 s is disconnected (§9.4, §10).
- **Fencing:** every job message carries `(jobId, attempt)`. Messages from an old attempt are acked `stale` and ignored, and the engine repeats the check inside the chat's lock (§9.4).
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

## Carry-forwards from Plan 1a

Plan 1a's final review handed these to Plan 1b. Each has a home:

| Item | Where it lands |
|---|---|
| The assigner moves queued jobs to the latest head (this also ends `stale_head` loops on a job queued before a push, and on a job a retried webhook left on an old `headSha`) | Task 2 |
| See a summary comment post on real GitHub early: it has never been seen live | Task 4, Step 16 (a stand-in CLI script) |
| Check mention neutralizing (zero-width space after `@`) live on the sandbox | Task 4, Step 16 (the planted point's title) |
| The CLI refuses to push when `headRepoPath` is null (PR from a deleted fork) | Task 11 (the bundle carries the `null`: Task 2) |
| Force-push "full re-review" fallback (`sinceSha` no longer an ancestor) | Task 13 |
| `pull_request.edited` is ignored, so a base retarget never refreshes `baseRef`, `baseSha` or `trusted` | Task 22 |
| A CLI retry for permanently failed jobs (Plan 2 adds the Retry button) | Task 6 |
| Deferred minor M7: `home.tsx` and `layout.tsx` hard-code the CLI name instead of using `BRAND` | Task 23 (it touches the layout) |
| Deferred minor M8: the protocol package exports its test samples, which the CLI bundle would include | Task 5 |
| Deferred minor M9: `CliLoginRequest` rows are never purged, and `POST /api/cli/login` has no rate limit | Task 6 |
| Deferred minor M10: `/cli/approve` lacks `frame-ancestors` | Task 23 |
| Deferred minors M1–M4, M6, M11 and `reuseIfContains` (matches any author, only the first 100 items) | Not touched by Plan 1b; still deferred |
| Deferred minor M5: user-token refresh race | Still deferred: the task runner runs one task at a time, so Plan 1b adds no concurrent refreshes |

## Checked against Plan 1a's code (M6)

Where step-level M6 differs from the earlier task-level text, and why:

- **No `ws/connection.ts`.** `CliConnection` is a small type in `ws/cli-hub.ts`. Its planned `running` and `lastPings` fields became `missedPings` (a count per job): which jobs a CLI runs is read from the `Job` table, the source of truth.
- **One connection per CLI token, and a new close code `4409`.** Without it, a second `nitpilot start` with the same login would share the token's jobs and fight over pings. The newest connection wins; the old one is closed with `CLOSE_CODES.replaced` (spec §10 updated). Task 7 handles it in the CLI.
- **`ws/wire.ts` (`wireCliHub`)** connects the hub, assigner, leases, job messages and dispatcher, for main.ts and the tests alike.
- **`JobAssigner`** has `wake()`, `tick()` and `assignDue()` (the `TaskRunner` shape) instead of `assignNow()`. It also checks the agent's modes: an address job only goes to a CLI whose agent declares `editor` (spec §9.4 updated), so `unsupported_mode` rejections never burn attempts.
- **`buildJobBundle(jobId, platform)`** takes the platform for `gitSpec`. Plan 1a's adapter method is `gitSpec` (backed by `gitSpecFor`), and its input narrows to `GitSpecInput` (`ref`, `headRef`, `headRepoFullName`) so a saved chat can supply it without calling GitHub.
- **Fencing happens twice.** `job_completed` and `job_failed` now carry `attempt`, and the engine ignores a stale one inside the chat's lock (spec §9 updated). The hub's database check runs first (`currentAttempt`, which returns the chat id where the plan had an `isCurrentAttempt` boolean), but a sweep can hand the job out again between that check and the lock.
- **Leases** are a `Leases` class (`handle`, `sweep`, `renewAfterRestart`) instead of loose functions. A ping or hello that lists a stale attempt gets `job.cancel`; any job taken back sends its CLI `job.cancel`; CLIs silent for 60 s are dropped; running leases are renewed at boot, because after a restart it was the server that was away (spec §9.4 updated).
- **`handleCliMessage(conn, msg)` became `jobMessageHandler({ dispatch })`**, a hub listener. Acks report what the engine did: `applied` only when it answered with `complete_job`, `retry_job` or `fail_job` for that job.
- **`job.progress` isn't kept in memory.** Nothing shows it in Plan 1; Plan 2 forwards it to the web app.
- **Our own push moves the head.** When an address result reports its push and the chat's head is still `push.from`, the engine moves the head to `push.to` at once, so the re-review isn't assigned on the old head while GitHub's webhook is on its way (spec §9.4 updated).
- **A token check on every message** (`touchCliToken`) catches a token revoked while connected and keeps `CliToken.lastSeenAt` fresh for "offline since…" (Task 22). The hub looks up the login itself; `CliAuth` is unchanged.

## Checked against the code (M7)

M7 was written at step level on 2026-10-10, against branch `plan-1b-cli-and-agents` after M6 (`f2dc50f`). Where it differs from the earlier task-level text, and why:

- **`apps/cli` already exists as a stub** (`package.json`, `tsconfig.json`, `src/version.ts`); Task 5 fills it in. `@nitpilot/protocol` moves to `devDependencies`: it's private, and tsup bundles it (with zod) into `dist/index.js`, so the published package has no dependencies at all.
- **A command table instead of a `parseArgs` dispatcher.** `src/cli.ts` holds `COMMANDS` and `runCli(argv, out)`, which returns the exit code, so tests run commands without a process. Commands print through an `Out` and take their dependencies (environment, `fetch`, `sleep`, `open`) as optional parameters.
- **The samples' own entry is a package `exports` subpath,** `@nitpilot/protocol/test-samples`. The failing test lives in the protocol package (`samples` is gone from the main entry); the bundle check only confirms it, because esbuild would drop unused samples anyway.
- **CLI tests never need Postgres.** `login`, `status` and `retry` are tested against a stub server (`test/stub-server.ts`) that answers in the protocol's shapes. The real handshake is covered by the server's own `cli.db.test.ts`, and Task 18 runs the CLI against the real server end to end.
- **The retry endpoint needs the dispatcher,** so `AppDeps` gains `dispatch`. It retries only when the person's role is flagged `failed` *and* its newest job failed: the flag a failed GitHub write leaves (`write_failed`) is fixed by signing in again. The engine's `retry_requested` starts a reviewer's review as if by hand (so an outside contributor's PR doesn't block it) and lets `advance` queue the author's address pass.
- **The login rate limit counts by the socket's address.** Behind a reverse proxy (Plan 3) that's the proxy's; Plan 3 must read `X-Forwarded-For` from its own proxy.
- **`repos add` links every GitHub remote of a clone** (`origin` and `upstream`), so a fork clone also serves jobs for the base repo. Names are stored as the remote spells them, and the server compares them exactly with GitHub's spelling, so a remote typed in another letter case won't match (rare: clone URLs copied from GitHub use its spelling).
- **No agent adapter exists until Task 16.** `nitpilot start` declares `modes: []`, so the assigner gives it no jobs; it still connects, pings and shows notifications. Task 17 wires the real executor and the adapter's `detect()`. Likewise, `doctor`'s agent check only asks the binary for `--version` (`probeAgent`) until the adapters' `detect()` can check the login too.
- **The daemon notices a dead socket itself.** A laptop back from sleep can hold a socket that looks open; when nothing (not even a pong) arrives for about two ping intervals, the daemon drops it and reconnects. Task 3's ledger noted the server skips a pong when a database read fails; that costs at most one needless reconnect.
- **A refused upgrade looks like a network error** to a WebSocket client, so after a connection that never opened, the daemon asks `GET /api/me`; a 401 there stops it with "log in again" instead of retrying forever.
- **Daemon tests use real sockets with short, injected timings** (`pingEveryMs`, `silentMs`, a fast `Backoff`) instead of fake timers, which don't mix reliably with real sockets. The backoff sequence and its jitter bounds are unit-tested on `Backoff` itself.
- **Desktop notifications pass the text as an argument** (`osascript -e 'on run argv' …`, `notify-send`), never inside a script, so a PR title can't become AppleScript.
- **`jobTimeoutMinutes` isn't enforced by the daemon.** Task 16's `runAgent` kills the agent at the timeout; the daemon only runs the executor.

## How to work in this repo

- Plan 1a's "How to work in this repo" applies: Postgres in Docker on port 5433, `apps/server/.env`, the test commands.
- Docker must be running for the DB tests (`open -a Docker`; container `nitpilot-postgres-1`). They use their own database, `nitpilot_test`, which `apps/server/test/global-setup.ts` creates and migrates, so they never touch dev data.
- One task per turn, then stop for review. Strict TDD: watch each new test fail, then pass, then run the full suite with `npm test && npm run typecheck && npm run lint`.
- Live checks use the dev GitHub App `nitpilot-dev` (credentials in `apps/server/.env`; never print them) and the sandbox `NikosGkikas13/nitpilot-sandbox` (author `ngkdev93-jpg`, reviewer `NikosGkikas13`). Webhooks reach the laptop only while `npm run dev:tunnel` runs; start it before the server.
- Commit after every task, with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Milestone M6: The CLI hub (server)

M6 gives the server its end of `nitpilot start`: a WebSocket on `/ws/cli` (Task 1), a job assigner and the self-contained job bundle (Task 2), leases, pings, fencing and rebinding (Task 3), and the CLI's answers coming back in, plus cancels and notifications going out (Task 4). It ends with the first live check of a summary comment on real GitHub, driven by a small stand-in CLI script, because the real CLI only arrives in M7.

**Files at the end of M6:**
```
packages/protocol/src/close-codes.ts   + replaced: 4409
packages/protocol/src/envelope.ts      + CLI_WS_PATH
apps/server/src/
  ws/cli-hub.ts          sockets: token check before the upgrade, hello/welcome, one connection per device, listeners
  ws/wire.ts             wires hub ↔ assigner ↔ leases ↔ job messages ↔ dispatcher; used by main.ts and the tests
  ws/handlers.ts         job.pushing / job.complete / job.fail / job.reject → engine, with acks
  jobs/assign.ts         JobAssigner: compare-and-swap hand-out, capacity, agent modes, latest head
  jobs/bundle.ts         buildJobBundle
  jobs/leases.ts         Leases (hello, ping, sweep, restart grace), currentAttempt, cancelMessage
  tasks/cli-notifier.ts  CliNotifier
  auth/cli-token.ts      + touchCliToken
  engine/results.ts      job events fenced by attempt; our own push moves the head
apps/server/scripts/fake-cli.ts   a stand-in CLI for live checks before M7
apps/server/test/ws.ts            listen, TestCli, hello, ping, upgradeStatus, startCliServer
docs/why/websockets.md, docs/why/leases-and-fencing.md
```

### Task 1: `/ws/cli`: authenticated WebSocket, hello and welcome

**Files:**
- Modify: `packages/protocol/src/close-codes.ts`, `packages/protocol/src/envelope.ts`, `packages/protocol/src/messages.test.ts`
- Modify: `apps/server/package.json` (install `ws`, `@types/ws`)
- Modify: `apps/server/src/auth/cli-token.ts` (add `touchCliToken`)
- Modify: `apps/server/test/db.ts` (add `makeCliToken`)
- Create: `apps/server/test/ws.ts`, `apps/server/src/ws/cli-hub.ts`, `apps/server/src/ws/cli-hub.db.test.ts`, `docs/why/websockets.md`
- Modify: `apps/server/src/main.ts` (create the hub, attach it to the HTTP server, close CLIs with `1012` on shutdown)

**Interfaces:**
- Consumes (Plan 1a):
  - `authenticateCliToken(header) → Promise<CliAuth | null>`, `type CliAuth = { userId; tokenId }` (`auth/cli-token.ts`);
  - `CliToServer`, `ServerToCli`, `PROTOCOL_VERSION`, `PING_SEC`, `LEASE_SEC`, `CLOSE_CODES`, `BRAND` (`@nitpilot/protocol`);
  - `SerialQueue` (`lib/serial-queue.ts`), `prisma`, `generateToken()` (`lib/tokens.ts`).
- Produces:
  - protocol: `CLOSE_CODES.replaced = 4409` and `CLI_WS_PATH = '/ws/cli'`;
  - `touchCliToken(tokenId, now?) → Promise<boolean>` (false = revoked);
  - `class CliHub` (`ws/cli-hub.ts`): `constructor(opts?: { helloTimeoutMs?: number })`, `attach(server: http.Server)`, `onMessage(listener: MessageListener)`, `connections()`, `connectionsFor(userId)`, `connection(tokenId)`, `send(tokenId, msg: ServerToCli): boolean`, `closeAll(code, reason?)`, `idle(): Promise<void>`;
  - `type CliConnection = { tokenId; userId; login; device; agent: { id; version; modes }; repos: Set<string>; concurrency; send(msg): boolean; close(code, reason) }` (Task 3 adds `lastMessageAt`, `missedPings`, `terminate`);
  - `type MessageListener = (conn: CliConnection, msg: CliToServer) => Promise<void>`. Listeners get the `hello` (after `welcome` was sent) and every later message, one message at a time per connection, in order;
  - test helpers (`apps/server/test/ws.ts`): `listen(hub) → { port, url, close() }`, `TestCli` (`connect`, `online`, `send`, `sendRaw`, `next(t)`, `count(t)`, `nothing(t)`, `close()`, `closed`), `hello(over)`, `ping(running)`, `upgradeStatus(port, path, headers)`, `sleep(ms)`; and `makeCliToken(userId, { revoked? }) → { id, raw }` (`test/db.ts`).

**Behavior** (spec §10):
- The bearer token is checked **before** the upgrade: none, unknown or revoked → HTTP `401` and no socket. Any other path → `404`.
- The first message must be `hello`; anything else first, or nothing for 10 s, closes with `1008`. A wrong `protocol` closes with `4426`. Otherwise the server answers `welcome { login, pingSec: 25, leaseSec: 90 }`.
- One connection per CLI token (one per device). A newer connection with the same token takes over; the older one is closed with `4409`.
- A message that isn't valid JSON or doesn't match `CliToServer` is logged and dropped; the socket stays open.
- Every message re-checks the token (`touchCliToken`, which also keeps `lastSeenAt` fresh for "offline since…"). A token revoked while connected closes with `4401` on its next message.
- Server shutdown closes every socket with `1012`.

- [x] **Step 1: Write the failing protocol test**

In `packages/protocol/src/messages.test.ts`, change the import `import { encode } from './envelope';` to:
```ts
import { CLI_WS_PATH, encode } from './envelope';
```
and replace the test `it('uses the spec close codes', …)` with:
```ts
  it('uses the spec close codes and path', () => {
    expect(CLOSE_CODES).toEqual({ reauth: 4401, upgradeCli: 4426, replaced: 4409, serverRestart: 1012 });
    expect(CLI_WS_PATH).toBe('/ws/cli');
  });
```

- [x] **Step 2: Run it to see it fail**

Run: `npm test -w packages/protocol -- src/messages.test.ts`
Expected: FAIL in `uses the spec close codes and path` (`replaced` missing, `CLI_WS_PATH` undefined).

- [x] **Step 3: Add the close code and the path**

`packages/protocol/src/close-codes.ts`:
```ts
/** WebSocket close codes the server uses (spec §10). */
export const CLOSE_CODES = {
  /** The CLI token is invalid or revoked: run `nitpilot login` again. */
  reauth: 4401,
  /** The CLI speaks an old protocol: upgrade it. */
  upgradeCli: 4426,
  /** Another connection with the same CLI token took over (a second `nitpilot start` on this device): stop. */
  replaced: 4409,
  /** The server is restarting: reconnect. */
  serverRestart: 1012,
} as const;
```

In `packages/protocol/src/envelope.ts`, after `export const LEASE_SEC = 90;`, add:
```ts
/** Where CLIs open their WebSocket (spec §10). */
export const CLI_WS_PATH = '/ws/cli';
```

- [x] **Step 4: Run it to see it pass**

Run: `npm test -w packages/protocol`
Expected: PASS (40 tests).

- [x] **Step 5: Install `ws`**

Node has a built-in WebSocket *client* (the CLI will use it), but no server, so the server uses the `ws` package.

Run: `npm install ws -w apps/server && npm install -D @types/ws -w apps/server`
Expected: `apps/server/package.json` gains `"ws": "^8…"` in `dependencies` and `"@types/ws": "^8…"` in `devDependencies` (8.22 and 8.18 on 2026-10-09).

- [x] **Step 6: Add `touchCliToken`**

In `apps/server/src/auth/cli-token.ts`, after `authenticateCliToken`, add:
```ts
/**
 * A connected CLI sent a message: note that it's alive. Returns false when its token was revoked
 * in the meantime, so the hub can close the socket with 4401 (spec §10).
 */
export async function touchCliToken(tokenId: string, now = new Date()): Promise<boolean> {
  const { count } = await prisma.cliToken.updateMany({ where: { id: tokenId, revokedAt: null }, data: { lastSeenAt: now } });
  return count === 1;
}
```

- [x] **Step 7: Add the test helpers**

In `apps/server/test/db.ts`, add the import `import { generateToken } from '../src/lib/tokens';` and, after `makeUser`, add:
```ts
/** A CLI token for `userId`, as `nitpilot login` creates one. `raw` is what the CLI sends. */
export async function makeCliToken(userId: string, over: { revoked?: boolean } = {}) {
  const token = generateToken();
  const row = await prisma.cliToken.create({
    data: { userId, name: 'test laptop', tokenHash: token.hash, prefix: token.prefix, revokedAt: over.revoked ? new Date() : null },
  });
  return { id: row.id, raw: token.raw };
}
```

Create `apps/server/test/ws.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CLI_WS_PATH, PROTOCOL_VERSION, type CliToServer, type RunningJob, type ServerToCli } from '@nitpilot/protocol';
import type { CliHub } from '../src/ws/cli-hub';

// Helpers for testing the CLI hub over real WebSockets (spec §19 "CLI hub").

type Hello = Extract<CliToServer, { t: 'hello' }>;
type FromServer<T extends ServerToCli['t']> = Extract<ServerToCli, { t: T }>;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serve `hub` on a random local port, the way main.ts attaches it to the real server. */
export async function listen(hub: CliHub) {
  const server = createServer();
  hub.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: `ws://127.0.0.1:${port}${CLI_WS_PATH}`,
    async close(): Promise<void> {
      hub.closeAll(1001, 'test over');
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A complete hello; pass only what a test cares about. */
export function hello(over: Partial<Hello['d']> = {}): Hello {
  return {
    v: 1,
    t: 'hello',
    d: {
      protocol: PROTOCOL_VERSION,
      cliVersion: '0.1.0',
      device: 'test laptop',
      agent: { id: 'fake', version: null, modes: ['reviewer', 'editor'] },
      repos: [],
      concurrency: 1,
      running: [],
      defaults: { autoReview: true, autoAddress: true },
      ...over,
    },
  };
}

export function ping(running: RunningJob[]): Extract<CliToServer, { t: 'ping' }> {
  return { v: 1, t: 'ping', d: { running } };
}

/** The HTTP status a WebSocket upgrade request to `path` gets: 101 when the server accepts it. */
export function upgradeStatus(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64'), ...headers },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * A CLI for tests: Node's built-in WebSocket client (the one the real CLI will use) plus an inbox,
 * so a test can say "wait for the next job.assign".
 */
export class TestCli {
  private readonly inbox: ServerToCli[] = [];
  private readonly waiting = new Set<() => void>();
  /** Resolves when the socket closes, with the code the server gave. */
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.inbox.push(JSON.parse(String(event.data)) as ServerToCli);
      for (const wake of this.waiting) wake();
    });
    this.closed = new Promise((resolve) => ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })));
  }

  /** Open a socket with this token. Rejects when the server refuses the upgrade. */
  static connect(url: string, token: string): Promise<TestCli> {
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    const cli = new TestCli(ws);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(cli));
      ws.addEventListener('error', () => reject(new Error('the server refused the WebSocket')));
    });
  }

  /** Connect, say hello and wait for welcome. */
  static async online(url: string, token: string, over: Partial<Hello['d']> = {}): Promise<TestCli> {
    const cli = await TestCli.connect(url, token);
    cli.send(hello(over));
    await cli.next('welcome');
    return cli;
  }

  /** Send any object as JSON. Tests also send invalid messages on purpose. */
  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  close(): void {
    this.ws.close();
  }

  /** Take the next message of type `t` out of the inbox, waiting up to `ms` for it. Other messages stay. */
  async next<T extends ServerToCli['t']>(t: T, ms = 2_000): Promise<FromServer<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as FromServer<T>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms} ms; the inbox has: ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await this.anyMessage(left);
    }
  }

  /** How many messages of type `t` are in the inbox. */
  count(t: ServerToCli['t']): number {
    return this.inbox.filter((m) => m.t === t).length;
  }

  /** Fail if a message of type `t` is in the inbox after waiting `ms`. */
  async nothing(t: ServerToCli['t'], ms = 300): Promise<void> {
    await sleep(ms);
    const got = this.inbox.find((m) => m.t === t);
    if (got) throw new Error(`expected no ${t}, got ${JSON.stringify(got)}`);
  }

  private anyMessage(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiting.add(done);
    });
  }
}
```

- [x] **Step 8: Write the failing hub tests**

`apps/server/src/ws/cli-hub.db.test.ts`:
```ts
import { CLI_WS_PATH, CLOSE_CODES, LEASE_SEC, PING_SEC } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCliToken, makeUser } from '../../test/db';
import { hello, listen, ping, sleep, TestCli, upgradeStatus } from '../../test/ws';
import { prisma } from '../lib/prisma';
import { CliHub } from './cli-hub';

const running: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

/** A hub on a random local port. */
async function hubOnPort(hub = new CliHub()) {
  const server = await listen(hub);
  running.push(server);
  return { hub, ...server };
}

/** A user with one CLI token. */
async function device(login = 'maya') {
  const user = await makeUser({ login });
  return { user, token: await makeCliToken(user.id) };
}

describe('connecting to /ws/cli', () => {
  it('checks the token before upgrading: none, unknown or revoked get 401; other paths 404', async () => {
    const { port } = await hubOnPort();
    const { user, token } = await device();
    const revoked = await makeCliToken(user.id, { revoked: true });
    const bearer = (raw: string) => ({ authorization: `Bearer ${raw}` });
    expect(await upgradeStatus(port, CLI_WS_PATH)).toBe(401);
    expect(await upgradeStatus(port, CLI_WS_PATH, bearer('nit_not-a-real-token'))).toBe(401);
    expect(await upgradeStatus(port, CLI_WS_PATH, bearer(revoked.raw))).toBe(401);
    expect(await upgradeStatus(port, '/ws/web', bearer(token.raw))).toBe(404);
    expect(await upgradeStatus(port, CLI_WS_PATH, bearer(token.raw))).toBe(101);
  });

  it('answers hello with welcome and lists the connection', async () => {
    const { hub, url } = await hubOnPort();
    const { user, token } = await device('maya');
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello({ device: "Maya's MacBook Pro", repos: ['acme/shop-api'], concurrency: 2 }));
    expect((await cli.next('welcome')).d).toEqual({ login: 'maya', pingSec: PING_SEC, leaseSec: LEASE_SEC });
    expect(hub.connection(token.id)).toMatchObject({ userId: user.id, login: 'maya', device: "Maya's MacBook Pro", concurrency: 2, repos: new Set(['acme/shop-api']) });
    expect((await prisma.cliToken.findUniqueOrThrow({ where: { id: token.id } })).lastSeenAt).not.toBeNull();
  });

  it('closes with 4426 when the CLI speaks another protocol version', async () => {
    const { hub, url } = await hubOnPort();
    const { token } = await device();
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello({ protocol: 2 }));
    expect((await cli.closed).code).toBe(CLOSE_CODES.upgradeCli);
    expect(hub.connections()).toEqual([]);
  });

  it('closes a socket whose first message is not hello, or that says nothing at all', async () => {
    const { url } = await hubOnPort(new CliHub({ helloTimeoutMs: 100 }));
    const { token } = await device();
    const eager = await TestCli.connect(url, token.raw);
    eager.send(ping([]));
    expect((await eager.closed).code).toBe(1008);
    const silent = await TestCli.connect(url, token.raw);
    expect((await silent.closed).code).toBe(1008);
  });

  it('drops messages it cannot read and keeps the socket open', async () => {
    const { url } = await hubOnPort();
    const { token } = await device();
    const cli = await TestCli.connect(url, token.raw);
    cli.sendRaw('this is not JSON');
    cli.send({ v: 1, t: 'job.explode', d: {} });
    cli.send(hello());
    await cli.next('welcome');
  });

  it('closes with 4401 when the token is revoked while connected', async () => {
    const { url } = await hubOnPort();
    const { token } = await device();
    const cli = await TestCli.online(url, token.raw);
    await prisma.cliToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    cli.send(ping([]));
    expect((await cli.closed).code).toBe(CLOSE_CODES.reauth);
  });
});

describe('connections', () => {
  it("lists each of a user's devices and closes them all when the server stops", async () => {
    const { hub, url } = await hubOnPort();
    const { user, token } = await device();
    const laptop = await TestCli.online(url, token.raw, { device: 'laptop' });
    const desktop = await TestCli.online(url, (await makeCliToken(user.id)).raw, { device: 'desktop' });
    expect(hub.connectionsFor(user.id).map((c) => c.device).sort()).toEqual(['desktop', 'laptop']);
    hub.closeAll(CLOSE_CODES.serverRestart);
    expect((await laptop.closed).code).toBe(CLOSE_CODES.serverRestart);
    expect((await desktop.closed).code).toBe(CLOSE_CODES.serverRestart);
  });

  it('lets a newer connection with the same token take over, and tells the older one to stop', async () => {
    const { hub, url } = await hubOnPort();
    const { token } = await device();
    const first = await TestCli.online(url, token.raw, { device: 'first' });
    await TestCli.online(url, token.raw, { device: 'second' });
    expect((await first.closed).code).toBe(CLOSE_CODES.replaced);
    await sleep(50); // the server sees the old socket close; that must not unlist the new one
    expect(hub.connections().map((c) => c.device)).toEqual(['second']);
  });

  it('hands hello and every later message to the listeners, one at a time, in order', async () => {
    const hub = new CliHub();
    const seen: string[] = [];
    hub.onMessage(async (_conn, msg) => {
      if (msg.t === 'hello') await sleep(30); // a slow listener must not let later messages overtake it
      seen.push(msg.t);
    });
    const { url } = await hubOnPort(hub);
    const { token } = await device();
    const cli = await TestCli.online(url, token.raw);
    cli.send(ping([]));
    cli.send({ v: 1, t: 'job.progress', d: { jobId: 'job_1', attempt: 1, stage: 'preparing', text: 'fetching the PR' } });
    await vi.waitFor(() => expect(seen).toEqual(['hello', 'ping', 'job.progress']));
  });
});
```

- [x] **Step 9: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/ws`
Expected: FAIL, `Failed to resolve import "./cli-hub"`.

- [x] **Step 10: Write the hub**

`apps/server/src/ws/cli-hub.ts`:
```ts
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  BRAND, CLI_WS_PATH, CLOSE_CODES, CliToServer, LEASE_SEC, PING_SEC, PROTOCOL_VERSION, type ServerToCli,
} from '@nitpilot/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { authenticateCliToken, touchCliToken, type CliAuth } from '../auth/cli-token';
import { prisma } from '../lib/prisma';
import { SerialQueue } from '../lib/serial-queue';

/** The biggest message we accept. A job.complete with 20 points of 4,000 characters is far below it. */
const MAX_MESSAGE_BYTES = 1_000_000;
/** A socket that hasn't said hello by then is closed. */
const HELLO_TIMEOUT_MS = 10_000;
/** WebSocket's "policy violation" close code: the CLI broke the rules of the conversation. */
const CLOSE_POLICY = 1008;

type Hello = Extract<CliToServer, { t: 'hello' }>;

/** One connected CLI, after its hello. There's at most one per CLI token, so one per device. */
export type CliConnection = {
  tokenId: string;
  userId: string;
  login: string;
  device: string;
  agent: Hello['d']['agent'];
  /** Repos linked on that machine, as `owner/name`. */
  repos: Set<string>;
  /** How many jobs it runs at once. */
  concurrency: number;
  send(msg: ServerToCli): boolean;
  close(code: number, reason: string): void;
};

/** Called for every message a CLI sends, from its hello on: one message at a time per CLI, in order. */
export type MessageListener = (conn: CliConnection, msg: CliToServer) => Promise<void>;

/**
 * The server end of `nitpilot start` (spec §10). CLIs connect to /ws/cli with their token, say
 * hello, and then exchange job messages. This class only looks after the sockets; what a message
 * means is up to the listeners (ws/wire.ts connects them). See docs/why/websockets.md.
 */
export class CliHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly byToken = new Map<string, CliConnection>();
  private readonly queues = new Set<SerialQueue>();
  private readonly listeners: MessageListener[] = [];

  constructor(private readonly opts: { helloTimeoutMs?: number } = {}) {}

  /** Take over WebSocket upgrades on this HTTP server. */
  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => void this.upgrade(req, socket, head));
  }

  onMessage(listener: MessageListener): void {
    this.listeners.push(listener);
  }

  connections(): CliConnection[] {
    return [...this.byToken.values()];
  }

  connectionsFor(userId: string): CliConnection[] {
    return this.connections().filter((c) => c.userId === userId);
  }

  connection(tokenId: string): CliConnection | undefined {
    return this.byToken.get(tokenId);
  }

  /** Send to the CLI with this token. False when it isn't connected. */
  send(tokenId: string, msg: ServerToCli): boolean {
    return this.byToken.get(tokenId)?.send(msg) ?? false;
  }

  /** Close every socket. With 1012 on shutdown, the CLIs reconnect. */
  closeAll(code: number, reason = ''): void {
    for (const ws of this.wss.clients) ws.close(code, reason);
  }

  /** Resolves once every message received so far has been handled. Tests use it. */
  async idle(): Promise<void> {
    await Promise.all([...this.queues].map((q) => q.idle()));
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const onError = () => socket.destroy();
    socket.on('error', onError);
    try {
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== CLI_WS_PATH) return refuse(socket, 404);
      // The token is checked before the upgrade: without one there's no socket at all (spec §10).
      const auth = await authenticateCliToken(req.headers.authorization);
      if (!auth) return refuse(socket, 401);
      socket.removeListener('error', onError);
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, auth));
    } catch (err) {
      console.error('[cli-hub] upgrade failed:', err);
      refuse(socket, 500);
    }
  }

  /** A new socket. Its messages are handled one at a time, in order, and the first must be hello. */
  private accept(ws: WebSocket, auth: CliAuth): void {
    const queue = new SerialQueue();
    this.queues.add(queue);
    let conn: CliConnection | null = null;
    const helloTimer = setTimeout(() => ws.close(CLOSE_POLICY, 'say hello first'), this.opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) =>
      queue.push(async () => {
        const msg = readMessage(data, isBinary);
        if (!msg) return;
        // Checked on every message, so a revoked token is noticed at once. It also keeps lastSeenAt fresh.
        if (!(await touchCliToken(auth.tokenId))) {
          ws.close(CLOSE_CODES.reauth, `This device was signed out. Run \`${BRAND.cli} login\`.`);
          return;
        }
        if (!conn) {
          if (msg.t !== 'hello') {
            ws.close(CLOSE_POLICY, 'the first message must be hello');
            return;
          }
          clearTimeout(helloTimer);
          conn = await this.register(ws, auth, msg);
          if (!conn) return;
        } else if (msg.t === 'hello') {
          console.warn(`[cli-hub] ${conn.login}/${conn.device} said hello twice; ignored`);
          return;
        }
        await this.emit(conn, msg);
      }),
    );
    ws.on('close', () => {
      clearTimeout(helloTimer);
      // A newer connection with the same token may already have taken this one's place: leave it be.
      if (conn && this.byToken.get(conn.tokenId) === conn) this.byToken.delete(conn.tokenId);
      void queue.idle().then(() => this.queues.delete(queue));
    });
    ws.on('error', (err) => console.warn('[cli-hub] socket error:', err.message));
  }

  /** Check the hello, make this socket the device's connection, and answer welcome. */
  private async register(ws: WebSocket, auth: CliAuth, hello: Hello): Promise<CliConnection | null> {
    if (hello.d.protocol !== PROTOCOL_VERSION) {
      ws.close(CLOSE_CODES.upgradeCli, `This server speaks protocol ${PROTOCOL_VERSION}. Upgrade ${BRAND.cli}.`);
      return null;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { login: true } });
    const conn: CliConnection = {
      tokenId: auth.tokenId,
      userId: auth.userId,
      login: user.login,
      device: hello.d.device,
      agent: hello.d.agent,
      repos: new Set(hello.d.repos),
      concurrency: hello.d.concurrency,
      send: (msg) => {
        if (ws.readyState !== ws.OPEN) return false;
        ws.send(JSON.stringify(msg));
        return true;
      },
      close: (code, reason) => ws.close(code, reason),
    };
    // One connection per device. A second one with the same token is the same laptop back from
    // sleep, or a second `nitpilot start`: the newest wins, and the old one is told to stop.
    this.byToken.get(auth.tokenId)?.close(CLOSE_CODES.replaced, `Another ${BRAND.cli} start on this device took over.`);
    this.byToken.set(auth.tokenId, conn);
    conn.send({ v: 1, t: 'welcome', d: { login: user.login, pingSec: PING_SEC, leaseSec: LEASE_SEC } });
    return conn;
  }

  private async emit(conn: CliConnection, msg: CliToServer): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(conn, msg);
      } catch (err) {
        console.error(`[cli-hub] handling ${msg.t} from ${conn.login}/${conn.device} failed:`, err);
      }
    }
  }
}

/** Answer an upgrade request with a plain HTTP error and hang up. */
function refuse(socket: Duplex, status: 401 | 404 | 500): void {
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** One frame as a CLI message, or null (logged) when it isn't one. A bad message never closes the socket. */
function readMessage(data: RawData, isBinary: boolean): CliToServer | null {
  if (isBinary) {
    console.warn('[cli-hub] dropped a binary message');
    return null;
  }
  let json: unknown;
  try {
    // ws hands text frames over as a Buffer.
    json = JSON.parse(data.toString());
  } catch {
    console.warn('[cli-hub] dropped a message that is not JSON');
    return null;
  }
  const parsed = CliToServer.safeParse(json);
  if (!parsed.success) {
    console.warn(`[cli-hub] dropped an invalid message: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
    return null;
  }
  return parsed.data;
}
```

- [x] **Step 11: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/ws && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (cli-hub 9).

- [x] **Step 12: Attach the hub to the server**

Replace `apps/server/src/main.ts` with:
```ts
// Load apps/server/.env if there is one. Variables already set in the environment win.
import 'dotenv/config';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { CLOSE_CODES } from '@nitpilot/protocol';
import { getUserToken } from './auth/user-tokens';
import { Dispatcher } from './chats/dispatch';
import { createApp } from './http/app';
import { createDeliveryHandler } from './ingest/handle';
import { createIngest } from './ingest/process';
import { purgeOldRows } from './ingest/record';
import { recoverOnBoot } from './ingest/recovery';
import { acquireSingletonLock } from './lib/advisory-lock';
import { getEnv } from './lib/env';
import { AppAuth } from './platform/github/app-auth';
import { GithubClient } from './platform/github/client';
import { GithubPlatform } from './platform/github/platform';
import { reportFailedWrite } from './tasks/handlers/failed-writes';
import { createTaskHandlers } from './tasks/handlers/index';
import { LogNotifier } from './tasks/notifier';
import { TaskRunner } from './tasks/runner';
import { CliHub } from './ws/cli-hub';

async function main(): Promise<void> {
  const env = getEnv();

  // One server per database (spec §7, docs/why/one-process.md).
  const lock = await acquireSingletonLock(env.DATABASE_URL);
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  // The outside world.
  const github = new GithubClient();
  const appAuth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
  const notifier = new LogNotifier();
  // CLIs connect over a WebSocket and get their jobs through it (spec §10, docs/why/websockets.md).
  const hub = new CliHub();

  // The core loop: webhook → ingest → router → dispatcher (engine) → tasks → GitHub.
  const dispatcher = new Dispatcher();
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier, dispatch: dispatcher.dispatch }), {
    // A review or replies that never reached GitHub shows up in the chat and notifies its owner.
    onGiveUp: reportFailedWrite(dispatcher.dispatch),
  });
  dispatcher.onCommit((_chatId, effects) => {
    if (effects.tasksCreated) runner.wake();
  });
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));

  const app = createApp({ github, appAuth, ingest });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });
  // serve() makes a plain HTTP/1 server; WebSocket upgrades on it go to the hub.
  hub.attach(server as Server);

  const recovered = await recoverOnBoot({ ingest, platform });
  console.log(`[boot] re-ran ${recovered.tasks} tasks, replayed ${recovered.replayed} deliveries, asked GitHub to resend ${recovered.redelivered}`);
  runner.start();
  const purge = setInterval(() => void purgeOldRows().catch((err) => console.error('[purge]', err)), 60 * 60_000);
  // Deliveries that failed (a GitHub hiccup, say) get another try once their wait is over.
  const retries = setInterval(() => void ingest.retryDue().catch((err) => console.error('[ingest] retry sweep failed:', err)), 30_000);

  const shutdown = async () => {
    clearInterval(purge);
    clearInterval(retries);
    runner.stop();
    // 1012 tells every CLI the server is restarting, so they reconnect.
    hub.closeAll(CLOSE_CODES.serverRestart, 'server restarting');
    server.close();
    await lock.release();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [x] **Step 13: Write the explainer**

`docs/why/websockets.md`:
```markdown
# WebSockets: how a CLI stays connected

**In one sentence:** each `nitpilot start` opens one long-lived WebSocket to the server (`/ws/cli`), and the server pushes a job down it the moment the job exists, instead of the CLI asking "anything for me?" over and over.

## Why not polling

Polling means the CLI asks every N seconds. With N = 60 a review starts up to a minute late; with N = 2, every idle laptop knocks on the server all day. Spec §3's first goal is "a PR event reaches the right agent within seconds; no polling, and no tokens spent when nothing happens". A WebSocket is one connection that stays open, so the server can speak first: the job goes out as soon as the webhook is handled.

## The life of one connection (`ws/cli-hub.ts`)

1. **Upgrade.** A WebSocket starts as an ordinary HTTP request carrying `Upgrade: websocket`. Before agreeing, the hub checks the `Authorization: Bearer nit_…` header (`auth/cli-token.ts`). No valid token: a plain `401`, and no socket at all.
2. **hello / welcome.** The CLI's first message is `hello`: its protocol version, device name, linked repos, how many jobs it runs at once, which agent it has, and which jobs it's still running. The server answers `welcome` with the user's login and the ping and lease timings. A CLI on an old protocol is closed with `4426` ("upgrade").
3. **Messages.** Every message is JSON in one envelope, `{ v: 1, t: "<type>", id?, re?, d: {…} }`, checked with the zod schemas in `packages/protocol/src/cli-messages.ts`. A message that doesn't fit is logged and dropped; the socket stays open. One CLI's messages are handled one at a time, in order (`lib/serial-queue.ts`).
4. **Closing.** The close code tells the CLI what to do next: `4401` log in again (the token was revoked), `4426` upgrade, `4409` another `nitpilot start` on this device took over (stop), `1012` the server is restarting (reconnect).

## One connection per device

Each `nitpilot login` creates one token per device, and the hub keeps one connection per token. A second connection with the same token is either the same laptop back from sleep (its old socket is dead anyway) or a second `nitpilot start` in another terminal. Either way the newest wins and the old one is closed with `4409`, so two daemons never fight over the same jobs.

## What the hub doesn't know

It doesn't know what a job is. It hands each message to listeners: the job assigner, the leases and the job results (`ws/wire.ts` connects them). The socket plumbing stays in one file you can read without the job rules.

## Leases, in one paragraph

A laptop can vanish without saying goodbye: the lid closes, the Wi-Fi drops. So a job given to a CLI comes with a **lease**: 90 seconds, renewed by a ping every 25. When the pings stop, the lease runs out and the job goes back to the queue. [leases-and-fencing.md](leases-and-fencing.md) has the details.

## The React analogy

- Polling is `setInterval(() => fetch('/jobs'), 5000)`. A WebSocket is a subscription, like Firebase's `onSnapshot` or a GraphQL subscription: you register once and updates are pushed to you.
- `hello`/`welcome` is the handshake an app does on mount: say who you are, get your session back.
- Close codes are HTTP status codes for the end of a conversation.
```

- [x] **Step 14: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [x] **Step 15: Commit**

```bash
git add packages/protocol apps/server package-lock.json docs/why/websockets.md
git commit -m "feat(server): CLI hub on /ws/cli with a token check, hello/welcome and close codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Job assigner and bundle builder

**Files:**
- Modify: `apps/server/src/platform/types.ts`, `apps/server/src/platform/github/mapping.ts`, `apps/server/src/platform/github/reads.ts`, `apps/server/src/platform/fake/fake-platform.ts` (`gitSpec` takes only what a saved chat has)
- Create: `apps/server/src/jobs/bundle.ts`, `apps/server/src/jobs/bundle.db.test.ts`
- Create: `apps/server/src/jobs/assign.ts`, `apps/server/src/jobs/assign.db.test.ts`, `apps/server/src/ws/wire.ts`
- Modify: `apps/server/test/db.ts` (add `personOf`), `apps/server/test/ws.ts` (add `startCliServer`), `apps/server/src/main.ts`, `docs/why/websockets.md`

**Interfaces:**
- Consumes:
  - `CliHub`, `CliConnection` (Task 1);
  - `Job` columns `status`, `attempt`, `runAfter`, `cliTokenId`, `leaseExpiresAt`, `headSha`, `sinceSha`, `applyState`, `type`, `round`, `userId`; `PrChat`, `Repo`, `Participant`, `Point`, `Message`;
  - `rulesFromJson(json) → TeamRules` (`chats/rules.ts`), `prRefOf(chat) → PrRef` (`chats/refs.ts`), `Dispatcher` and `DispatchEffects.jobsChanged` (`chats/dispatch.ts`);
  - `JobBundle` (zod schema and type), `LEASE_SEC`, `JobType`, `AgentMode` (`@nitpilot/protocol`);
  - `PlatformReads.gitSpec`, `FakePlatform`.
- Produces:
  - `type GitSpecInput = Pick<PrSnapshot, 'ref' | 'headRef' | 'headRepoFullName'>`; `PlatformReads.gitSpec(pr: GitSpecInput)` and `gitSpecFor(pr: GitSpecInput)`;
  - `buildJobBundle(jobId, platform: Pick<PlatformReads, 'gitSpec'>) → Promise<JobBundle>`;
  - `leaseUntil(now) → Date`;
  - `class JobAssigner(hub, buildBundle, now?)`: `wake()`, `tick(): Promise<void>` (resolves when idle), `assignDue(): Promise<number>`;
  - `wireCliHub({ hub, dispatcher, platform, now? }) → { assigner, start(), stop() }` (`ws/wire.ts`; Tasks 3–4 extend it);
  - test helpers: `personOf(user) → Person` (`test/db.ts`); `startCliServer({ now? }) → CliServer` with `hub`, `dispatcher`, `assigner`, `url`, `settle()`, `close()` (`test/ws.ts`).

**Behavior** (spec §9.4 "Assigning a job", "Which commit a job uses"):
- One atomic compare-and-swap: `queued → running`, `attempt + 1`, `leaseExpiresAt = now + 90 s`, `cliTokenId`, and `headSha = chat.headSha`, so a queued job follows the latest head (Plan 1a carry-forward: this also ends `stale_head` loops on a job queued before a push).
- A job goes to a live connection of `job.userId` that has `chat.repo.fullName` linked, an agent with the right mode (`reviewer` for review and re_review, `editor` for address), and fewer running jobs than its `concurrency`. Running jobs are counted in the `Job` table.
- Only jobs whose `runAfter` has passed, oldest first, for users with a CLI online. No offer/accept round-trip.
- One pass at a time. The assigner wakes on `hello`, on every commit that changed jobs, and every 5 s (for `runAfter`).
- The bundle carries: the PR; how to fetch it (`git`, with `headRepoPath: null` for a deleted fork); `you { login, role }`; `round`, `maxRounds`, `sinceSha`; `apply: 'draft'` when `applyState` is `draft`, else `'auto'`; every point with its thread (the messages about it after it was raised); the human notes; and `rules { ignorePaths, alwaysEscalate, maxPoints }`.

- [x] **Step 1: Write the failing bundle tests**

In `apps/server/test/db.ts`, add the import `import type { Person } from '../src/engine/types';` and, after `makeCliToken`, add:
```ts
/** A Nitpilot user as the engine sees them in an event. */
export function personOf(u: { id: string; githubId: string; login: string }): Person {
  return { githubId: u.githubId, login: u.login, isBot: false, userId: u.id };
}
```

`apps/server/src/jobs/bundle.db.test.ts`:
```ts
import { samples } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser, personOf } from '../../test/db';
import { Dispatcher } from '../chats/dispatch';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { buildJobBundle } from './bundle';

const platform = new FakePlatform();

/** The chat's queued job of this type, moved to running the way the assigner does it. */
async function running(chatId: string, type: string) {
  const job = await prisma.job.findFirstOrThrow({ where: { chatId, type, status: 'queued' } });
  return prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });
}

/** maya opened a PR and asked leo for a review; leo's review job is running. */
async function scene(repoOver: { rulesJson?: Prisma.InputJsonValue } = {}) {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo(repoOver);
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const dispatcher = new Dispatcher();
  await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  return { maya, leo, repo, chat, dispatcher, review: await running(chat.id, 'review') };
}

describe('buildJobBundle', () => {
  it('describes a first review: the PR, who you are, how to fetch the code, and the team rules', async () => {
    const { repo, chat, review } = await scene({ rulesJson: { max_rounds: 2, ignore_paths: ['vendor/**'], max_points_per_review: 5 } });
    expect(await buildJobBundle(review.id, platform)).toEqual({
      jobId: review.id,
      attempt: 1,
      type: 'review',
      round: 1,
      maxRounds: 2,
      apply: 'auto',
      you: { login: 'leo', role: 'reviewer' },
      pr: {
        repoFullName: repo.fullName,
        number: chat.number,
        title: chat.title,
        body: '',
        url: chat.url,
        authorLogin: 'maya',
        baseRef: 'main',
        headRef: chat.headRef,
        baseSha: chat.baseSha,
        headSha: chat.headSha,
      },
      git: { baseCloneUrl: `https://github.com/${repo.fullName}.git`, fetchRef: `refs/pull/${chat.number}/head`, headRepoPath: repo.fullName, headBranch: chat.headRef },
      sinceSha: null,
      points: [],
      notes: [],
      rules: { ignorePaths: ['vendor/**'], alwaysEscalate: ['security'], maxPoints: 5 },
    });
  });

  it('gives a re-review the points with their threads, the human notes, and the commit to start from', async () => {
    const { maya, chat, dispatcher, review } = await scene();
    await dispatcher.dispatch(chat.id, { type: 'job_completed', jobId: review.id, result: samples.jobResult() });
    const address = await running(chat.id, 'address');
    await dispatcher.dispatch(chat.id, {
      type: 'job_completed',
      jobId: address.id,
      result: { summary: 'Fixed it.', points: [], decisions: [], replies: [{ point: 1, resolution: 'fixed', comment: 'Added the empty check.' }], push: { from: chat.headSha, to: 'c'.repeat(40) } },
    });
    await dispatcher.dispatch(chat.id, { type: 'human_note', author: personOf(maya), body: 'Please keep the public API stable.' });
    const reReview = await running(chat.id, 're_review');

    const bundle = await buildJobBundle(reReview.id, platform);
    expect(bundle).toMatchObject({ type: 're_review', round: 2, sinceSha: chat.headSha, you: { login: 'leo', role: 'reviewer' } });
    expect(bundle.points).toEqual([
      expect.objectContaining({
        number: 1,
        raisedBy: 'leo',
        status: 'addressed',
        authorResolution: 'fixed',
        title: '`parseOrder` crashes on empty input',
        thread: [expect.objectContaining({ author: 'maya', kind: 'point_reply', body: 'Added the empty check.' })],
      }),
    ]);
    expect(bundle.notes).toEqual([expect.objectContaining({ author: 'maya', body: 'Please keep the public API stable.' })]);
  });

  it('marks a job whose result must wait as drafts', async () => {
    const { review } = await scene();
    await prisma.job.update({ where: { id: review.id }, data: { applyState: 'draft' } });
    expect((await buildJobBundle(review.id, platform)).apply).toBe('draft');
  });

  it("fetches a fork's PR from the base repo and pushes to the fork", async () => {
    const { repo, chat, review } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { headRepoFullName: 'maya/shop-api-fork' } });
    expect((await buildJobBundle(review.id, platform)).git).toEqual({
      baseCloneUrl: `https://github.com/${repo.fullName}.git`,
      fetchRef: `refs/pull/${chat.number}/head`,
      headRepoPath: 'maya/shop-api-fork',
      headBranch: chat.headRef,
    });
  });

  it('says there is nowhere to push when the fork was deleted', async () => {
    const { chat, review } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { headRepoFullName: null } });
    expect((await buildJobBundle(review.id, platform)).git.headRepoPath).toBeNull();
  });
});
```

- [x] **Step 2: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/jobs/bundle`
Expected: FAIL, `Failed to resolve import "./bundle"`.

- [x] **Step 3: Let `gitSpec` work from a saved chat**

`gitSpec` only reads the PR's ref, head branch and head repo. A saved chat has those, so the bundle can call it without fetching the PR from GitHub.

In `apps/server/src/platform/types.ts`, after the `GitSpec` type, add:
```ts
/** What gitSpec needs to know about a PR. A PrSnapshot has it, and so does a saved chat. */
export type GitSpecInput = Pick<PrSnapshot, 'ref' | 'headRef' | 'headRepoFullName'>;
```
and in `PlatformReads` change `gitSpec(pr: PrSnapshot): GitSpec;` to `gitSpec(pr: GitSpecInput): GitSpec;`.

In `apps/server/src/platform/github/mapping.ts`, change the import to `import type { GitSpec, GitSpecInput, PrRef, PrSnapshot } from '../types';` and `export function gitSpecFor(pr: PrSnapshot): GitSpec {` to `export function gitSpecFor(pr: GitSpecInput): GitSpec {`.

In `apps/server/src/platform/github/reads.ts`, add `GitSpecInput` to the `import type { … } from '../types'` list and change `gitSpec(pr: PrSnapshot): GitSpec {` to `gitSpec(pr: GitSpecInput): GitSpec {`.

In `apps/server/src/platform/fake/fake-platform.ts`, add `GitSpecInput` to the `import type { … } from '../types'` list and change `gitSpec(pr: PrSnapshot): GitSpec {` to `gitSpec(pr: GitSpecInput): GitSpec {`.

- [x] **Step 4: Write the bundle builder**

`apps/server/src/jobs/bundle.ts`:
```ts
import { JobBundle } from '@nitpilot/protocol';
import { prRefOf } from '../chats/refs';
import { rulesFromJson } from '../chats/rules';
import { prisma } from '../lib/prisma';
import type { PlatformReads } from '../platform/types';

/**
 * Everything the CLI needs to run one job, in one message (spec §10 `job.assign`): the PR, how to
 * fetch its code, the points with their threads, the human notes and the team rules. It's built
 * right after the job was assigned, so `attempt` and `headSha` are the ones the CLI must use.
 */
export async function buildJobBundle(jobId: string, platform: Pick<PlatformReads, 'gitSpec'>): Promise<JobBundle> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      participant: true,
      chat: {
        include: {
          repo: true,
          participants: true,
          points: { orderBy: { number: 'asc' } },
          // Point threads and human notes. System messages are for people, not agents.
          messages: { where: { OR: [{ pointNumber: { not: null } }, { kind: 'human' }] }, orderBy: { seq: 'asc' } },
        },
      },
    },
  });
  const { chat } = job;
  const rules = rulesFromJson(chat.repo.rulesJson);

  // People are stored by GitHub id; agents read logins.
  const logins = new Map(chat.participants.map((p) => [p.githubId, p.login]));
  for (const m of chat.messages) if (m.authorGithubId && m.authorLogin) logins.set(m.authorGithubId, m.authorLogin);
  const loginOf = (githubId: string) => logins.get(githubId) ?? githubId;

  // parse() checks every enum the database stores as a plain string, so a bad row fails here, not in the CLI.
  return JobBundle.parse({
    jobId: job.id,
    attempt: job.attempt,
    type: job.type,
    round: job.round,
    maxRounds: rules.max_rounds,
    apply: job.applyState === 'draft' ? 'draft' : 'auto',
    you: { login: job.participant.login, role: job.participant.role },
    pr: {
      repoFullName: chat.repo.fullName,
      number: chat.number,
      title: chat.title,
      body: chat.body,
      url: chat.url,
      authorLogin: loginOf(chat.authorGithubId),
      baseRef: chat.baseRef,
      headRef: chat.headRef,
      baseSha: chat.baseSha,
      headSha: job.headSha,
    },
    git: platform.gitSpec({ ref: prRefOf(chat), headRef: chat.headRef, headRepoFullName: chat.headRepoFullName }),
    sinceSha: job.sinceSha,
    points: chat.points.map((p) => ({
      number: p.number,
      origin: p.origin,
      raisedBy: loginOf(p.raisedByGithubId),
      path: p.path,
      line: p.line,
      side: p.side,
      severity: p.severity,
      category: p.category,
      title: p.title,
      body: p.body,
      status: p.status,
      authorResolution: p.authorResolution,
      round: p.round,
      // The point itself is its first message; the thread is everything said about it after that.
      thread: chat.messages
        .filter((m) => m.pointNumber === p.number && m.kind !== 'point_raised')
        .map((m) => ({ author: m.authorLogin ?? 'system', kind: m.kind, body: m.body, at: m.createdAt.toISOString() })),
    })),
    notes: chat.messages
      .filter((m) => m.kind === 'human' && m.pointNumber === null)
      .map((m) => ({ author: m.authorLogin ?? 'unknown', body: m.body, at: m.createdAt.toISOString() })),
    rules: { ignorePaths: rules.ignore_paths, alwaysEscalate: rules.always_escalate, maxPoints: rules.max_points_per_review },
  });
}
```

- [x] **Step 5: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/jobs/bundle && npm run typecheck -w apps/server`
Expected: PASS (bundle 5).

- [x] **Step 6: Write the failing assigner tests**

In `apps/server/test/ws.ts`, replace the line `import type { CliHub } from '../src/ws/cli-hub';` with:
```ts
import { Dispatcher } from '../src/chats/dispatch';
import { FakePlatform } from '../src/platform/fake/fake-platform';
import { CliHub } from '../src/ws/cli-hub';
import { wireCliHub } from '../src/ws/wire';
```
and add at the end of the file:
```ts
/** The CLI side of the server, wired by ws/wire.ts exactly as main.ts does, on a random local port. */
export async function startCliServer(opts: { now?: () => Date } = {}) {
  const hub = new CliHub();
  const dispatcher = new Dispatcher(opts.now);
  const wired = wireCliHub({ hub, dispatcher, platform: new FakePlatform(), now: opts.now });
  const server = await listen(hub);
  /** Wait until every message received so far is handled and the assigner is idle. */
  const settle = async (): Promise<void> => {
    await hub.idle();
    await wired.assigner.tick();
  };
  return {
    ...wired,
    hub,
    dispatcher,
    url: server.url,
    settle,
    async close(): Promise<void> {
      await settle();
      await server.close();
    },
  };
}

export type CliServer = Awaited<ReturnType<typeof startCliServer>>;
```

`apps/server/src/jobs/assign.db.test.ts`:
```ts
import { LEASE_SEC } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeRepo, makeUser, personOf, resetDb } from '../../test/db';
import { sleep, startCliServer, TestCli, type CliServer } from '../../test/ws';
import { prisma } from '../lib/prisma';

// The assigner looks at every queued job, so each test starts from an empty database.
let s: CliServer;
let clock: Date;
beforeEach(async () => {
  await resetDb();
  clock = new Date();
  s = await startCliServer({ now: () => clock });
});
afterEach(() => s.close());

type User = Awaited<ReturnType<typeof makeUser>>;

/** A job written straight into the table, the way apply-commands.ts writes one, without the engine. */
async function queueJob(chatId: string, user: User, role: 'author' | 'reviewer', type: 'review' | 'address') {
  const p = await prisma.participant.upsert({
    where: { chatId_githubId_role: { chatId, githubId: user.githubId, role } },
    create: { chatId, githubId: user.githubId, login: user.login, role, userId: user.id, requested: role === 'reviewer' },
    update: {},
  });
  return prisma.job.create({ data: { chatId, participantId: p.id, activeFor: p.id, userId: user.id, type, round: 1, headSha: 'a'.repeat(40), runAfter: clock } });
}

/** leo, with a review job queued on a fresh repo. */
async function leoWithAJob() {
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id);
  return { leo, repo, chat, job: await queueJob(chat.id, leo, 'reviewer', 'review') };
}

async function online(user: User, over: Parameters<typeof TestCli.online>[2] = {}) {
  return TestCli.online(s.url, (await makeCliToken(user.id)).raw, over);
}

const statusOf = async (jobId: string) => (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status;

describe('JobAssigner', () => {
  it("gives a queued job to its owner's CLI when it connects: running, attempt 1, a 90-second lease", async () => {
    const { leo, repo, job } = await leoWithAJob();
    const cli = await online(leo, { repos: [repo.fullName] });
    expect((await cli.next('job.assign')).d.bundle).toMatchObject({ jobId: job.id, attempt: 1, type: 'review' });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'running',
      attempt: 1,
      cliTokenId: s.hub.connectionsFor(leo.id)[0]!.tokenId,
      leaseExpiresAt: new Date(clock.getTime() + LEASE_SEC * 1000),
    });
  });

  it('hands out a job the engine queues while the CLI is already online', async () => {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
    const cli = await online(leo, { repos: [repo.fullName] });
    await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
    expect((await cli.next('job.assign')).d.bundle).toMatchObject({ type: 'review', you: { login: 'leo', role: 'reviewer' } });
  });

  it("never gives a job to someone else's CLI", async () => {
    const { repo, job } = await leoWithAJob();
    const mayasCli = await online(await makeUser({ login: 'maya' }), { repos: [repo.fullName] });
    await s.settle();
    await mayasCli.nothing('job.assign');
    expect(await statusOf(job.id)).toBe('queued');
  });

  it("leaves the job queued while none of the owner's CLIs has the repo linked", async () => {
    const { leo, job } = await leoWithAJob();
    const cli = await online(leo, { repos: ['someone/else'] });
    await s.settle();
    await cli.nothing('job.assign');
    expect(await statusOf(job.id)).toBe('queued');
  });

  it("doesn't give an address job to a CLI whose agent can only review", async () => {
    const maya = await makeUser({ login: 'maya' });
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
    const job = await queueJob(chat.id, maya, 'author', 'address');
    const cli = await online(maya, { repos: [repo.fullName], agent: { id: 'fake', version: null, modes: ['reviewer'] } });
    await s.settle();
    await cli.nothing('job.assign');
    expect(await statusOf(job.id)).toBe('queued');
  });

  it('never gives a CLI more jobs than its concurrency, and sends the next one when a slot frees up', async () => {
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const first = await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    const second = await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    const cli = await online(leo, { repos: [repo.fullName], concurrency: 1 });
    expect((await cli.next('job.assign')).d.bundle.jobId).toBe(first.id);
    await s.settle();
    await cli.nothing('job.assign');
    await prisma.job.update({ where: { id: first.id }, data: { status: 'done', activeFor: null } });
    await s.assigner.tick();
    expect((await cli.next('job.assign')).d.bundle.jobId).toBe(second.id);
  });

  it("gives a job to exactly one of a user's CLIs, even when two passes race", async () => {
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const laptop = await online(leo, { device: 'laptop', repos: [repo.fullName] });
    const desktop = await online(leo, { device: 'desktop', repos: [repo.fullName] });
    await s.settle();
    const job = await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    expect((await Promise.all([s.assigner.assignDue(), s.assigner.assignDue()])).sort()).toEqual([0, 1]);
    await sleep(300);
    expect(laptop.count('job.assign') + desktop.count('job.assign')).toBe(1);
    expect(await statusOf(job.id)).toBe('running');
  });

  it('runs one pass at a time, so wake-ups that race never go over the concurrency', async () => {
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const cli = await online(leo, { repos: [repo.fullName], concurrency: 1 });
    await s.settle();
    await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    await Promise.all([s.assigner.tick(), s.assigner.tick()]);
    await sleep(300);
    expect(cli.count('job.assign')).toBe(1);
  });

  it('waits until runAfter', async () => {
    const { leo, repo, job } = await leoWithAJob();
    await prisma.job.update({ where: { id: job.id }, data: { runAfter: new Date(clock.getTime() + 60_000) } });
    const cli = await online(leo, { repos: [repo.fullName] });
    await s.settle();
    await cli.nothing('job.assign');
    clock = new Date(clock.getTime() + 60_000);
    await s.assigner.tick();
    expect((await cli.next('job.assign')).d.bundle.jobId).toBe(job.id);
  });

  it("moves a queued job to the PR's latest head when it hands it out", async () => {
    const { leo, repo, chat, job } = await leoWithAJob();
    // A push arrived while the job waited in the queue.
    await prisma.prChat.update({ where: { id: chat.id }, data: { headSha: 'c'.repeat(40) } });
    const cli = await online(leo, { repos: [repo.fullName] });
    expect((await cli.next('job.assign')).d.bundle.pr.headSha).toBe('c'.repeat(40));
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).headSha).toBe('c'.repeat(40));
  });
});
```

- [x] **Step 7: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/jobs/assign`
Expected: FAIL, `Failed to resolve import "../src/ws/wire"`.

- [x] **Step 8: Write the assigner**

`apps/server/src/jobs/assign.ts`:
```ts
import { LEASE_SEC, type AgentMode, type JobBundle, type JobType } from '@nitpilot/protocol';
import { prisma } from '../lib/prisma';
import type { CliConnection, CliHub } from '../ws/cli-hub';

/** The agent mode each job type needs (spec §12.2): reviews only read, address jobs edit files. */
const MODE_FOR: Record<JobType, AgentMode> = { review: 'reviewer', re_review: 'reviewer', address: 'editor' };

/** When a lease handed out now runs out (spec §9.4: 90 seconds, renewed by every ping). */
export function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + LEASE_SEC * 1000);
}

/**
 * Hands queued jobs to connected CLIs (spec §9.4 "Assigning a job"). There's no offer and accept:
 * each CLI's hello already said which repos it has, what its agent can do and how many jobs it
 * runs at once. Woken by ws/wire.ts. See docs/why/websockets.md.
 */
export class JobAssigner {
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly hub: CliHub,
    private readonly buildBundle: (jobId: string) => Promise<JobBundle>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Assign soon, without waiting for it. */
  wake(): void {
    void this.tick();
  }

  /**
   * Run passes until nothing new came in. Never two at once: a call during a pass asks for one more
   * pass, so a CLI can't be given two jobs by two passes that each saw it free. Resolves when idle.
   */
  tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runPasses();
    return this.running;
  }

  private async runPasses(): Promise<void> {
    try {
      do {
        this.again = false;
        await this.assignDue();
      } while (this.again);
    } catch (err) {
      console.error('[assign] pass failed:', err);
    } finally {
      this.running = null;
    }
  }

  /** One pass: give each due job to a CLI that can take it. Returns how many went out. */
  async assignDue(): Promise<number> {
    const clis = this.hub.connections();
    if (clis.length === 0) return 0;
    const now = this.now();
    const jobs = await prisma.job.findMany({
      where: { status: 'queued', runAfter: { lte: now }, userId: { in: [...new Set(clis.map((c) => c.userId))] } },
      orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      include: { chat: { select: { headSha: true, repo: { select: { fullName: true } } } } },
    });
    const load = await runningPerCli(clis);

    let assigned = 0;
    for (const job of jobs) {
      const mode = MODE_FOR[job.type as JobType];
      const cli = this.hub.connectionsFor(job.userId).find(
        (c) => c.repos.has(job.chat.repo.fullName) && c.agent.modes.includes(mode) && (load.get(c.tokenId) ?? 0) < c.concurrency,
      );
      // No CLI can take it now (offline, repo not linked there, agent can't, or busy): it waits.
      if (!cli) continue;
      // Compare-and-swap: only a job that is still queued can be taken, so it goes out once. A queued
      // job follows the PR's latest head; once running it stays on that commit (spec §9.4).
      const { count } = await prisma.job.updateMany({
        where: { id: job.id, status: 'queued' },
        data: { status: 'running', attempt: { increment: 1 }, cliTokenId: cli.tokenId, leaseExpiresAt: leaseUntil(now), headSha: job.chat.headSha },
      });
      if (count === 0) continue; // cancelled or taken meanwhile
      load.set(cli.tokenId, (load.get(cli.tokenId) ?? 0) + 1);
      assigned += 1;
      await this.send(cli, job.id);
    }
    return assigned;
  }

  /**
   * Send the job to its CLI. If that fails, the job stays `running` with nobody working on it until
   * its lease runs out, and then it goes back to the queue.
   */
  private async send(cli: CliConnection, jobId: string): Promise<void> {
    try {
      const bundle = await this.buildBundle(jobId);
      if (!cli.send({ v: 1, t: 'job.assign', d: { bundle } })) console.warn(`[assign] ${cli.login}/${cli.device} left before job ${jobId} reached it`);
    } catch (err) {
      console.error(`[assign] could not send job ${jobId}:`, err);
    }
  }
}

/** How many jobs each connected CLI is running, counted in the database (the source of truth). */
async function runningPerCli(clis: CliConnection[]): Promise<Map<string, number>> {
  const rows = await prisma.job.findMany({ where: { status: 'running', cliTokenId: { in: clis.map((c) => c.tokenId) } }, select: { cliTokenId: true } });
  const load = new Map<string, number>();
  for (const { cliTokenId } of rows) if (cliTokenId) load.set(cliTokenId, (load.get(cliTokenId) ?? 0) + 1);
  return load;
}
```

`apps/server/src/ws/wire.ts`:
```ts
import type { Dispatcher } from '../chats/dispatch';
import { JobAssigner } from '../jobs/assign';
import { buildJobBundle } from '../jobs/bundle';
import type { PlatformReads } from '../platform/types';
import type { CliHub } from './cli-hub';

/** How often the timers run: jobs whose retry delay ended. */
export const SWEEP_MS = 5_000;

export type CliHubDeps = {
  hub: CliHub;
  dispatcher: Dispatcher;
  platform: Pick<PlatformReads, 'gitSpec'>;
  now?: () => Date;
};

/**
 * Connect the CLI hub to the rest of the server: who gets which job, and when. main.ts and the
 * tests both call this, so the tests run exactly the wiring production runs.
 */
export function wireCliHub({ hub, dispatcher, platform, now = () => new Date() }: CliHubDeps) {
  const assigner = new JobAssigner(hub, (jobId) => buildJobBundle(jobId, platform), now);

  hub.onMessage(async (_conn, msg) => {
    // A CLI that just said hello may be able to take queued jobs.
    if (msg.t === 'hello') assigner.wake();
  });

  dispatcher.onCommit((_chatId, effects) => {
    // A job was queued, finished, failed or cancelled: maybe another one can go out now.
    if (effects.jobsChanged) assigner.wake();
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    assigner,
    start(): void {
      timer ??= setInterval(() => assigner.wake(), SWEEP_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
```

- [x] **Step 9: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/jobs && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (assign 10, bundle 5).

- [x] **Step 10: Run the assigner in the server**

In `apps/server/src/main.ts`:
- add the import `import { wireCliHub } from './ws/wire';`;
- after the `dispatcher.onCommit((_chatId, effects) => { … runner.wake(); });` block, add:
  ```ts
  // Jobs → CLIs: the assigner, and from Task 3 on, leases (ws/wire.ts).
  const cliJobs = wireCliHub({ hub, dispatcher, platform });
  ```
- after `runner.start();`, add `cliJobs.start();`;
- in `shutdown`, after `runner.stop();`, add `cliJobs.stop();`.

- [x] **Step 11: Explain job hand-out**

In `docs/why/websockets.md`, before `## Leases, in one paragraph`, add:
```markdown
## Handing out a job (`jobs/assign.ts`)

The server doesn't ask CLIs "do you want this job?". From `hello` it already knows which repos each CLI has linked, which kinds of job its agent can do, and how many jobs it runs at once, so it picks one and sends `job.assign`.

Picking is a compare-and-swap (explained in [cli-login.md](cli-login.md)): the job moves from `queued` to `running` only if it is still `queued`, so two passes of the assigner can never hand out the same job twice. The same update adds 1 to `attempt`, starts a 90-second lease, and moves the job to the PR's newest commit, because a job that waited in the queue should review what's there now (spec §9.4).

The assigner runs when something changes (a job was queued or finished, a CLI said hello) and every 5 seconds for jobs waiting out a retry delay. Like the task runner, it never runs two passes at once.

The job travels as a self-contained **bundle** (`jobs/bundle.ts`): the PR, how to fetch its code, the points with their threads, human notes and the team rules. The CLI never has to call back for more.
```

- [x] **Step 12: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [x] **Step 13: Commit**

```bash
git add apps/server docs/why/websockets.md
git commit -m "feat(server): assign queued jobs to connected CLIs with self-contained bundles

Queued jobs follow the PR's latest head when handed out.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Leases, pings, fencing and rebinding

**Files:**
- Modify: `apps/server/src/engine/types.ts`, `apps/server/src/engine/results.ts`, `apps/server/src/engine/results.test.ts`, `apps/server/src/engine/failures.test.ts`
- Modify: every test that builds a `job_completed` or `job_failed` event (one `perl` command, Step 5)
- Modify: `apps/server/src/ws/cli-hub.ts` (`lastMessageAt`, `missedPings`, `terminate`, `dropSilent`)
- Create: `apps/server/src/jobs/leases.ts`, `apps/server/src/jobs/leases.db.test.ts`, `docs/why/leases-and-fencing.md`
- Modify: `apps/server/src/ws/wire.ts`, `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `CliHub`, `CliConnection` (Task 1); `JobAssigner`, `leaseUntil`, `wireCliHub`, `startCliServer` (Task 2); `Dispatch` (`chats/dispatch.ts`); `RunningJob`, `ServerToCli`, `PING_SEC`, `LEASE_SEC` (`@nitpilot/protocol`).
- Produces:
  - engine: `DomainEvent` `job_completed { jobId, attempt, result }` and `job_failed { jobId, attempt, reason, retryable }`; the engine ignores either when `attempt` isn't the job's current one;
  - `CliConnection.lastMessageAt`, `CliConnection.missedPings: Map<jobId, number>`, `CliConnection.terminate()`, `CliHub.dropSilent(cutoff: Date): number`;
  - `class Leases(hub, dispatch, now?)` (`jobs/leases.ts`): `handle: MessageListener` (hello and ping), `sweep(): Promise<void>`, `renewAfterRestart(): Promise<number>`;
  - `currentAttempt(tokenId, ref: RunningJob) → Promise<{ chatId } | null>` (the fencing check Task 4 uses);
  - `cancelMessage(ref: RunningJob, reason) → ServerToCli` (Task 4 uses it for engine cancels);
  - `SILENT_MS` = 60 s;
  - `wireCliHub` now also returns `leases`, registers `leases.handle` before the hello→assigner listener, and sweeps every 5 s.

**Behavior** (spec §9.4 "Leases", "Fencing"):
- `hello.running` and every `ping` list the `(jobId, attempt)` pairs the CLI is working on. For each: if it's still running on that attempt, bound to this CLI, the lease is renewed (now + 90 s). This is how a laptop that slept keeps its job. Otherwise the CLI gets `job.cancel { reason: 'stale' }`.
- A `ping` is answered with `pong`, after the checks.
- A running job bound to this CLI that **two pings in a row** leave out goes back to the engine as `job_failed { reason: 'timeout', retryable: true }`, and the CLI gets `job.cancel { reason: 'missed_pings' }`. One miss is forgiven: a ping can cross a `job.assign` on the wire.
- The sweep (every 5 s) does the same for leases that ran out (`reason: 'lease_expired'`), then disconnects CLIs silent for 60 s (two missed pings plus slack), so no new job goes to a dead socket.
- The engine decides what a timeout means: a retry after 30 s, 60 s, then a final failure (attempt 3) that flags the person and notifies them.
- Fencing happens twice: `currentAttempt` (the database, before dispatching) and the engine (inside the chat's lock), because the sweep can hand a job out again between the two.
- At boot, every running job gets a fresh lease. The server was the one away, so CLIs that reconnect keep their work.

- [x] **Step 1: Write the failing engine tests**

In `apps/server/src/engine/results.test.ts`, inside `describe('drafts and stale results', …)`, after the test `ignores a result for a job that was cancelled`, add:
```ts
  it('ignores a result from an earlier attempt: the job was handed out again since', () => {
    const chat = reviewing({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { attempt: 2 })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', attempt: 1, result: result({ points: [newPoint()] }) });
    expect(out.commands).toEqual([]);
    expect(out.timeline).toEqual([]);
  });
```

In `apps/server/src/engine/failures.test.ts`, after the test `ignores a failure from a job that is no longer running`, add:
```ts
  it('ignores a failure from an earlier attempt', () => {
    const chat = agentToAgent({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { attempt: 2 })] });
    const out = run(chat, { type: 'job_failed', jobId: 'job-r1', attempt: 1, reason: 'crash', retryable: true });
    expect(out.commands).toEqual([]);
  });
```

- [x] **Step 2: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/engine/results src/engine/failures`
Expected: FAIL in the two new tests (the engine still applies the old attempt's result and retries its failure).

- [x] **Step 3: Fence job events by attempt in the engine**

In `apps/server/src/engine/types.ts`, change the two job events to:
```ts
  | { type: 'job_completed'; jobId: string; attempt: number; result: JobResult }
  | { type: 'job_failed'; jobId: string; attempt: number; reason: FailureReason; retryable: boolean }
```

In `apps/server/src/engine/results.ts`, in `onJobCompleted`, replace:
```ts
  // A result for a job that was cancelled or already finished is stale: ignore it.
  if (!job || job.status !== 'running') return;
```
with:
```ts
  // A result for a job that was cancelled, already finished, or handed out again since (a newer
  // attempt) is stale: ignore it. The fencing check of spec §9.4, done inside the chat's lock.
  if (!job || job.status !== 'running' || job.attempt !== e.attempt) return;
```
and in `onJobFailed`, replace:
```ts
  if (!job || job.status !== 'running') return;
```
with:
```ts
  // Same fencing as onJobCompleted: only the current attempt can fail.
  if (!job || job.status !== 'running' || job.attempt !== e.attempt) return;
```

- [x] **Step 4: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/engine/results src/engine/failures`
Expected: PASS.

- [x] **Step 5: Give every existing job event its attempt**

Every test job so far runs attempt 1. Add `attempt: 1` after `jobId` in every `job_completed` and `job_failed` event that doesn't have one yet:
```bash
grep -rlE "type: 'job_(completed|failed)'," apps/server/src apps/server/test | xargs perl -0pi -e "s/(type: 'job_(?:completed|failed)',\s*jobId: [^,]+,)(?!\s*attempt)/\$1 attempt: 1,/g"
```
Then in `apps/server/src/engine/failures.test.ts`, the helper `failing(attempt, reason, retryable)` must pass its own attempt through. Change its line:
```ts
  return run(chat, { type: 'job_failed', jobId: 'job-r1', attempt: 1, reason, retryable });
```
to:
```ts
  return run(chat, { type: 'job_failed', jobId: 'job-r1', attempt, reason, retryable });
```

Run: `npm run typecheck -w apps/server && npm run test:unit -w apps/server && npm run test:db -w apps/server -- src/chats src/jobs test/integration`
Expected: typecheck clean; PASS. (`git diff --stat` shows the edit in `chats/dispatch.db.test.ts`, `engine/{ready-gate,external,results,failures}.test.ts`, `jobs/bundle.db.test.ts` and `test/integration/plan-1a.db.test.ts`.)

- [x] **Step 6: Write the failing lease tests**

`apps/server/src/jobs/leases.db.test.ts`:
```ts
import { LEASE_SEC } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeRepo, makeUser, personOf, resetDb } from '../../test/db';
import { ping, startCliServer, TestCli, type CliServer } from '../../test/ws';
import { prisma } from '../lib/prisma';
import { currentAttempt } from './leases';

// The sweep looks at every running job, so each test starts from an empty database.
// The leases run on `clock`, but the hub notes a CLI's last message in real time. So moving `clock`
// past 60 s also makes every CLI look silent to the sweep; a test that keeps talking to its CLI
// after a sweep runs out the lease in the database instead (`expireLease`).
let s: CliServer;
let clock: Date;
const later = (ms: number) => new Date(clock.getTime() + ms);
const expireLease = (jobId: string) => prisma.job.update({ where: { id: jobId }, data: { leaseExpiresAt: later(-1) } });

beforeEach(async () => {
  await resetDb();
  clock = new Date();
  s = await startCliServer({ now: () => clock });
});
afterEach(() => s.close());

/** leo's review job, handed to leo's laptop. */
async function assigned() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const laptopToken = await makeCliToken(leo.id);
  const laptop = await TestCli.online(s.url, laptopToken.raw, { device: 'laptop', repos: [repo.fullName] });
  await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  const { bundle } = (await laptop.next('job.assign')).d;
  const job = { jobId: bundle.jobId, attempt: bundle.attempt };
  const row = () => prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
  return { leo, repo, chat, laptopToken, laptop, job, row };
}

describe('pings', () => {
  it('renew the lease of each job the CLI lists', async () => {
    const { laptop, job, row } = await assigned();
    clock = later(60_000);
    laptop.send(ping([job]));
    await laptop.next('pong');
    expect((await row()).leaseExpiresAt).toEqual(later(LEASE_SEC * 1000));
  });

  it('put a job back in the queue when two pings in a row leave it out, and tell the CLI to stop', async () => {
    const { laptop, job, row } = await assigned();
    laptop.send(ping([]));
    await laptop.next('pong');
    expect((await row()).status).toBe('running'); // once is forgiven: the ping may have crossed job.assign
    laptop.send(ping([]));
    await laptop.next('pong');
    expect(await row()).toMatchObject({ status: 'queued', attempt: 1, cliTokenId: null, runAfter: later(30_000) });
    expect((await laptop.next('job.cancel')).d).toEqual({ ...job, reason: 'missed_pings' });
  });
});

describe('expired leases', () => {
  it('go back to the queue through the engine; the CLI is told to stop, and again if it still lists the job', async () => {
    const { laptop, job, row } = await assigned();
    await expireLease(job.jobId);
    await s.leases.sweep();
    expect(await row()).toMatchObject({ status: 'queued', cliTokenId: null });
    expect((await laptop.next('job.cancel')).d).toEqual({ ...job, reason: 'lease_expired' });
    // Say the laptop was asleep and missed that cancel: its next ping still lists the job.
    laptop.send(ping([job]));
    await laptop.next('pong');
    expect((await laptop.next('job.cancel')).d).toEqual({ ...job, reason: 'stale' });
    expect((await row()).status).toBe('queued');
  });

  it('count as attempts: the third one fails the job and tells its owner', async () => {
    const { chat, job, row } = await assigned();
    await prisma.job.update({ where: { id: job.jobId }, data: { attempt: 3 } });
    await expireLease(job.jobId);
    await s.leases.sweep();
    expect(await row()).toMatchObject({ status: 'failed', failure: 'timeout' });
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'reviewer' } })).toMatchObject({ attention: 'failed' });
    expect(await prisma.task.count({ where: { chatId: chat.id, kind: 'notify' } })).toBe(1);
  });

  it('are renewed when the server restarts: it was the server that was away', async () => {
    const { row } = await assigned();
    clock = later(10 * 60_000); // the server was down for ten minutes
    expect(await s.leases.renewAfterRestart()).toBe(1);
    await s.leases.sweep();
    expect(await row()).toMatchObject({ status: 'running', leaseExpiresAt: later(LEASE_SEC * 1000) });
  });
});

describe('reconnecting', () => {
  it('lets a laptop that slept keep its job while the lease is valid', async () => {
    const { repo, laptop, laptopToken, job, row } = await assigned();
    laptop.close();
    await laptop.closed;
    clock = later(60_000); // asleep for a minute: the 90-second lease still holds
    const woken = await TestCli.online(s.url, laptopToken.raw, { device: 'laptop', repos: [repo.fullName], running: [job] });
    await s.settle();
    await woken.nothing('job.cancel');
    expect(await row()).toMatchObject({ status: 'running', attempt: 1, cliTokenId: laptopToken.id, leaseExpiresAt: later(LEASE_SEC * 1000) });
  });

  it('tells a laptop that woke too late to stop: its job went to another CLI', async () => {
    const { leo, repo, laptop, laptopToken, job, row } = await assigned();
    laptop.close();
    await laptop.closed;
    clock = later(LEASE_SEC * 1000 + 1);
    await s.leases.sweep(); // the lease ran out: back to the queue
    await prisma.job.update({ where: { id: job.jobId }, data: { runAfter: clock } }); // skip the retry delay
    const desktopToken = await makeCliToken(leo.id);
    const desktop = await TestCli.online(s.url, desktopToken.raw, { device: 'desktop', repos: [repo.fullName] });
    expect((await desktop.next('job.assign')).d.bundle.attempt).toBe(2);

    const woken = await TestCli.online(s.url, laptopToken.raw, { device: 'laptop', repos: [repo.fullName], running: [job] });
    expect((await woken.next('job.cancel')).d).toEqual({ ...job, reason: 'stale' });
    await desktop.nothing('job.cancel');
    expect(await row()).toMatchObject({ status: 'running', attempt: 2, cliTokenId: desktopToken.id });
  });
});

describe('fencing and liveness', () => {
  it('currentAttempt knows which attempt is current, and on which CLI', async () => {
    const { leo, chat, laptopToken, job } = await assigned();
    const otherDevice = await makeCliToken(leo.id);
    expect(await currentAttempt(laptopToken.id, job)).toEqual({ chatId: chat.id });
    expect(await currentAttempt(laptopToken.id, { ...job, attempt: job.attempt + 1 })).toBeNull();
    expect(await currentAttempt(otherDevice.id, job)).toBeNull();
  });

  it('drops a CLI that went silent', async () => {
    const leo = await makeUser({ login: 'leo' });
    const cli = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw);
    expect(s.hub.dropSilent(new Date(Date.now() - 60_000))).toBe(0); // it just said hello
    expect(s.hub.dropSilent(new Date(Date.now() + 1_000))).toBe(1);
    expect((await cli.closed).code).toBe(1006);
    expect(s.hub.connections()).toEqual([]);
  });
});
```

- [x] **Step 7: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/jobs/leases`
Expected: FAIL, `Failed to resolve import "./leases"`.

- [x] **Step 8: Teach the hub about silence**

In `apps/server/src/ws/cli-hub.ts`:

1. In `type CliConnection`, after `concurrency: number;`, add:
   ```ts
     /** When it last sent anything. A CLI pings every 25 s, so a long silence means the socket is dead. */
     lastMessageAt: Date;
     /** For each job bound to this CLI, how many pings in a row left it out (jobs/leases.ts). */
     missedPings: Map<string, number>;
   ```
   and after `close(code: number, reason: string): void;`, add `terminate(): void;`.
2. In `register()`, after `concurrency: hello.d.concurrency,`, add:
   ```ts
         lastMessageAt: new Date(),
         missedPings: new Map(),
   ```
   and after `close: (code, reason) => ws.close(code, reason),`, add `terminate: () => ws.terminate(),`.
3. In `accept()`, replace the line `        await this.emit(conn, msg);` with:
   ```ts
           conn.lastMessageAt = new Date();
           await this.emit(conn, msg);
   ```
4. After the `idle()` method, add:
   ```ts
     /**
      * Drop CLIs that sent nothing since `cutoff`. Their socket is dead (a laptop that slept, a network
      * that vanished), so no job may go there. Returns how many were dropped.
      */
     dropSilent(cutoff: Date): number {
       const silent = this.connections().filter((c) => c.lastMessageAt < cutoff);
       for (const c of silent) {
         this.byToken.delete(c.tokenId);
         c.terminate();
       }
       return silent.length;
     }
   ```

- [x] **Step 9: Write the leases**

`apps/server/src/jobs/leases.ts`:
```ts
import { PING_SEC, type CliToServer, type RunningJob, type ServerToCli } from '@nitpilot/protocol';
import type { Dispatch } from '../chats/dispatch';
import { prisma } from '../lib/prisma';
import type { CliConnection, CliHub } from '../ws/cli-hub';
import { leaseUntil } from './assign';

/** A CLI that sent nothing for this long is gone: two missed pings and some slack. */
export const SILENT_MS = (2 * PING_SEC + 10) * 1000;

/** The columns needed to take a job back from a CLI. */
const BOUND = { id: true, chatId: true, attempt: true, cliTokenId: true } as const;
type BoundJob = { id: string; chatId: string; attempt: number; cliTokenId: string | null };

/**
 * Keeps track of which CLI is really working on which job (spec §9.4 "Leases" and "Fencing"). A job
 * handed to a CLI is lent to it for 90 s, and every ping renews the loan. See docs/why/leases-and-fencing.md.
 */
export class Leases {
  constructor(
    private readonly hub: CliHub,
    private readonly dispatch: Dispatch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The hub listener: hello and ping both say "these are the jobs I'm running". */
  handle = async (conn: CliConnection, msg: CliToServer): Promise<void> => {
    if (msg.t === 'hello') await this.renewOrCancel(conn, msg.d.running);
    if (msg.t === 'ping') await this.onPing(conn, msg.d.running);
  };

  /** Every few seconds: jobs whose lease ran out go back to the queue, and silent CLIs are dropped. */
  async sweep(): Promise<void> {
    const now = this.now();
    const expired = await prisma.job.findMany({ where: { status: 'running', leaseExpiresAt: { lt: now } }, select: BOUND });
    for (const job of expired) {
      try {
        await this.takeBack(job, 'lease_expired');
      } catch (err) {
        console.error(`[leases] could not take back job ${job.id}:`, err);
      }
    }
    this.hub.dropSilent(new Date(now.getTime() - SILENT_MS));
  }

  /**
   * At boot. Nobody could ping while the server was down, so every lease may have run out, but it
   * was the server that was away. Running jobs get a fresh lease: CLIs reconnect within seconds and
   * keep their work, and a job whose CLI doesn't come back is taken back when this lease ends.
   */
  async renewAfterRestart(): Promise<number> {
    const { count } = await prisma.job.updateMany({ where: { status: 'running' }, data: { leaseExpiresAt: leaseUntil(this.now()) } });
    return count;
  }

  /** A ping renews the CLI's leases, notices jobs we gave it that it doesn't mention, and gets a pong. */
  private async onPing(conn: CliConnection, running: RunningJob[]): Promise<void> {
    await this.renewOrCancel(conn, running);
    const listed = new Set(running.map(keyOf));
    const bound = await prisma.job.findMany({ where: { status: 'running', cliTokenId: conn.tokenId }, select: BOUND });
    for (const job of bound) {
      if (listed.has(keyOf({ jobId: job.id, attempt: job.attempt }))) {
        conn.missedPings.delete(job.id);
        continue;
      }
      // Once can happen: the ping crossed the job.assign on the wire. Twice means the CLI doesn't have it.
      const missed = (conn.missedPings.get(job.id) ?? 0) + 1;
      conn.missedPings.set(job.id, missed);
      if (missed >= 2) {
        conn.missedPings.delete(job.id);
        await this.takeBack(job, 'missed_pings');
      }
    }
    conn.send({ v: 1, t: 'pong', d: {} });
  }

  /**
   * For each job the CLI says it's running: if it's still this CLI's job on that attempt, renew the
   * lease (this is how a laptop that slept keeps its work). If not, tell the CLI to stop.
   */
  private async renewOrCancel(conn: CliConnection, running: RunningJob[]): Promise<void> {
    const until = leaseUntil(this.now());
    for (const r of running) {
      const { count } = await prisma.job.updateMany({
        where: { id: r.jobId, attempt: r.attempt, status: 'running', cliTokenId: conn.tokenId },
        data: { leaseExpiresAt: until },
      });
      if (count === 0) conn.send(cancelMessage(r, 'stale'));
    }
  }

  /**
   * The CLI no longer holds this job. Tell the engine (as a timeout, so its retry rules decide what
   * happens next), and tell the CLI to stop in case it's still busy: the job may go to another CLI now.
   */
  private async takeBack(job: BoundJob, reason: string): Promise<void> {
    await this.dispatch(job.chatId, { type: 'job_failed', jobId: job.id, attempt: job.attempt, reason: 'timeout', retryable: true });
    if (job.cliTokenId) this.hub.send(job.cliTokenId, cancelMessage({ jobId: job.id, attempt: job.attempt }, reason));
  }
}

/**
 * The fencing check (spec §9.4): is (jobId, attempt) the attempt running on this CLI right now?
 * Returns the job's chat if it is, null if a message about it is stale.
 */
export async function currentAttempt(tokenId: string, ref: RunningJob): Promise<{ chatId: string } | null> {
  return prisma.job.findFirst({ where: { id: ref.jobId, attempt: ref.attempt, status: 'running', cliTokenId: tokenId }, select: { chatId: true } });
}

export function cancelMessage(ref: RunningJob, reason: string): ServerToCli {
  return { v: 1, t: 'job.cancel', d: { jobId: ref.jobId, attempt: ref.attempt, reason } };
}

function keyOf(r: RunningJob): string {
  return `${r.jobId}#${r.attempt}`;
}
```

Replace `apps/server/src/ws/wire.ts` with:
```ts
import type { Dispatcher } from '../chats/dispatch';
import { JobAssigner } from '../jobs/assign';
import { buildJobBundle } from '../jobs/bundle';
import { Leases } from '../jobs/leases';
import type { PlatformReads } from '../platform/types';
import type { CliHub } from './cli-hub';

/** How often the timers run: jobs whose retry delay ended, and leases that ran out. */
export const SWEEP_MS = 5_000;

export type CliHubDeps = {
  hub: CliHub;
  dispatcher: Dispatcher;
  platform: Pick<PlatformReads, 'gitSpec'>;
  now?: () => Date;
};

/**
 * Connect the CLI hub to the rest of the server: who gets which job, and when. main.ts and the
 * tests both call this, so the tests run exactly the wiring production runs.
 */
export function wireCliHub({ hub, dispatcher, platform, now = () => new Date() }: CliHubDeps) {
  const assigner = new JobAssigner(hub, (jobId) => buildJobBundle(jobId, platform), now);
  const leases = new Leases(hub, dispatcher.dispatch, now);

  // Every message from a CLI goes through these listeners, in this order.
  hub.onMessage(leases.handle); // hello and ping: renew leases, cancel what's no longer theirs
  hub.onMessage(async (_conn, msg) => {
    // A CLI that just said hello may be able to take queued jobs.
    if (msg.t === 'hello') assigner.wake();
  });

  dispatcher.onCommit((_chatId, effects) => {
    // A job was queued, finished, failed or cancelled: maybe another one can go out now.
    if (effects.jobsChanged) assigner.wake();
  });

  assigner.onBundleFailed(async (job) => {
    // The job is ours but can't be sent. Let the engine's retry rules decide now, instead of
    // waiting for its lease to run out and calling it a timeout (spec §9.4).
    await dispatcher.dispatch(job.chatId, { type: 'job_failed', jobId: job.jobId, reason: 'setup_failed', retryable: true, attempt: job.attempt });
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    assigner,
    leases,
    start(): void {
      timer ??= setInterval(() => {
        assigner.wake();
        void leases.sweep().catch((err) => console.error('[leases] sweep failed:', err));
      }, SWEEP_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
```

- [x] **Step 10: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/jobs src/ws && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (leases 9, assign 10, bundle 5, cli-hub 9).

- [x] **Step 11: Renew leases at boot**

In `apps/server/src/main.ts`, before `cliJobs.start();`, add:
```ts
  // The server was away, not the CLIs: running jobs get a fresh lease, so CLIs that reconnect keep them.
  await cliJobs.leases.renewAfterRestart();
```

- [x] **Step 12: Write the explainer**

`docs/why/leases-and-fencing.md`:
```markdown
# Leases and fencing: who is really working on a job

**In one sentence:** a job handed to a CLI is only *lent* to it, 90 seconds at a time, and every message about the job carries an attempt number, so a laptop that vanished can never overwrite the work of the CLI that took over.

## The problem

The server gives leo's review job to leo's laptop. Then leo closes the lid. From the server's side the laptop just goes quiet: no error, no goodbye. Should the job wait forever? Should it go to leo's desktop? And if the laptop wakes up ten minutes later and sends its old result, what then?

## Leases: a library loan

A lease works like a library loan: you keep the book until the due date, you can renew as often as you like, and if you don't renew, the library lends it to someone else.

- When the assigner hands out a job, `Job.leaseExpiresAt` becomes now + 90 s (`jobs/assign.ts`).
- Every 25 s the CLI sends `ping` with the jobs it's running, and each one's lease is renewed (`jobs/leases.ts`).
- Every 5 s the server sweeps for leases that ran out. Such a job goes back to the queue **through the engine**, as a `timeout` failure, so the usual retry rules apply: wait 30 s, then 60 s, and give up after the third attempt.
- If two pings in a row leave out a job we gave that CLI, the CLI doesn't have it (the `job.assign` got lost), so the job goes back too. One miss is forgiven, because a ping can cross a `job.assign` on the wire.
- Whenever a job is taken back, its CLI gets `job.cancel`, in case it's still busy with it.
- A CLI that sends nothing for 60 s is disconnected, so no new job goes to a dead socket.
- After a server restart every running job gets a fresh lease: the server was the one away, and the CLIs reconnect within seconds.

## Fencing: the attempt number

Taking the job back isn't enough, because the old laptop may still send a result later. So every hand-out adds 1 to `Job.attempt`, and every message about a job carries `(jobId, attempt)`. The attempt number is a **fencing token**: only the current attempt's messages count.

- `currentAttempt()` in `jobs/leases.ts` checks a message against the database: the job must be `running`, on that attempt, on that CLI.
- The engine checks the attempt again inside the chat's lock (`engine/results.ts`), because between our check and the lock, the sweep could have handed the job out again.
- When the laptop reconnects, its `hello` lists what it's still running. A job that is still its own, on the same attempt, keeps going: the lease is renewed, and the laptop that slept loses nothing. Anything else gets `job.cancel`.

## Stale answers are acknowledged, then ignored

A stale result gets `ack { status: 'stale' }`, not silence. Silence would look like a network problem and the CLI would keep resending. "Stale" says: we heard you, it's not yours anymore, drop it. It matters most for `job.pushing`: the CLI only pushes after an `applied` ack, so an old attempt can never push.

## The React analogy

Fencing fixes the classic stale-fetch bug: you start loading user 1, switch to user 2, and user 1's slow response arrives last and overwrites the screen. The fix is a request id, and you ignore any response that isn't for the latest one. The attempt number is that id. A lease is a presence heartbeat, like the dot that turns grey when someone's tab stops checking in.
```

- [x] **Step 13: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [x] **Step 14: Commit**

```bash
git add apps/server docs/why/leases-and-fencing.md
git commit -m "feat(server): leases, pings, fencing and rebinding for CLI jobs

Job events now carry their attempt and the engine ignores stale ones.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Results in; cancels and notifications out; the first live summary

**Files:**
- Modify: `apps/server/src/engine/results.ts`, `apps/server/src/engine/results.test.ts` (our own push moves the head)
- Create: `apps/server/src/ws/handlers.ts`, `apps/server/src/ws/handlers.db.test.ts`
- Create: `apps/server/src/tasks/cli-notifier.ts`, `apps/server/src/tasks/cli-notifier.db.test.ts`
- Modify: `apps/server/src/ws/wire.ts`, `apps/server/src/main.ts` (replace `LogNotifier` with `CliNotifier`)
- Create: `apps/server/scripts/fake-cli.ts`; Modify: `apps/server/package.json` (`dev:fake-cli`)
- Modify: `docs/why/dispatcher.md`, `docs/why/outbox-and-restarts.md`

**Interfaces:**
- Consumes: `currentAttempt`, `cancelMessage`, `Leases` (Task 3); `MessageListener`, `CliConnection`, `CliHub` (Task 1); `wireCliHub`, `startCliServer` (Task 2); `Dispatch`, `DispatchEffects.cancelledJobs` (Plan 1a); `DecideOutput`, `DomainEvent` (`engine/types.ts`); `Notifier`, `Notification`, `LogNotifier` (`tasks/notifier.ts`).
- Produces:
  - `jobMessageHandler({ dispatch }) → MessageListener` (`ws/handlers.ts`);
  - `class CliNotifier(hub, offline?: Notifier) implements Notifier` (`tasks/cli-notifier.ts`);
  - `wireCliHub` also registers `jobMessageHandler` and sends `job.cancel` for every `effects.cancelledJobs` entry whose `cliTokenId` is set;
  - engine: an applied address result with `push` moves `chat.headSha` to `push.to` when the head is still `push.from`;
  - `npm run dev:fake-cli -w apps/server -- owner/repo`.

**Behavior** (spec §10):
- **`job.pushing`:** fenced by the same check as `currentAttempt`, done as one compare-and-swap that records `expectedPushSha = to`. Acked `applied` or `stale`. The CLI pushes only after `applied`, so Plan 1a's router recognizes the push webhook as ours.
- **`job.complete`:** fenced; dispatches `job_completed { jobId, attempt, result }`; acked `applied` only when the engine took it (it answered with `complete_job`, `retry_job` or `fail_job` for that job), else `stale`. A result sent twice is applied once.
- **`job.fail`:** fenced; dispatches `job_failed { jobId, attempt, reason, retryable }`; the `detail` goes to the server log.
- **`job.reject`:** fenced; dispatches `job_failed { …, retryable: true }`. The engine waits on `daily_cap` (1 h) and `repo_not_linked` (10 min) without counting an attempt.
- **`job.progress`:** not stored and not acked. Plan 2 forwards it to the web app's live status line.
- **Engine cancels** (PR closed, reviewer removed, a human push during an address job) reach the CLI running the job as `job.cancel { jobId, attempt, reason }`.
- **`CliNotifier`:** sends `notify { kind, chatId, title, url }` to every live connection of each user; users with no CLI online fall back to the log.
- **Our own push moves the head at once** when the result arrives, so the re-review it queues runs on the pushed commit instead of waiting for GitHub's push webhook (and hitting `stale_head` meanwhile). Only when nothing else moved the head.

- [x] **Step 1: Write the failing engine tests**

In `apps/server/src/engine/results.test.ts`, inside `describe('address results', …)`, after the first test, add:
```ts
  it('moves the head to the commit it pushed, so the re-review runs on it without waiting for the webhook', () => {
    const out = run(addressing(), {
      type: 'job_completed',
      jobId: 'job-a1',
      attempt: 1,
      result: result({ replies: [{ point: 1, resolution: 'fixed', comment: 'Done.' }], push: { from: 'head1', to: 'head2' } }),
    });
    expect(out.chat.headSha).toBe('head2');
    expect(out.chat.jobs.find((j) => j.jobType === 're_review')).toMatchObject({ headSha: 'head2' });
  });

  it('keeps a newer head that someone else pushed meanwhile', () => {
    const out = run(addressing({ headSha: 'head3' }), {
      type: 'job_completed',
      jobId: 'job-a1',
      attempt: 1,
      result: result({ replies: [{ point: 1, resolution: 'fixed', comment: 'Done.' }], push: { from: 'head1', to: 'head2' } }),
    });
    expect(out.chat.headSha).toBe('head3');
  });
```

- [x] **Step 2: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/engine/results`
Expected: FAIL in `moves the head to the commit it pushed` (`head1`, not `head2`). The second test already passes; it guards the condition.

- [x] **Step 3: Move the head on our own push**

In `apps/server/src/engine/results.ts`, in `applyAddress`, after `const commit = result.push?.to ?? null;`, add:
```ts
  // Our own push: move the head now, so the re-review queued below runs on the pushed commit instead
  // of waiting for GitHub's push webhook. Only when nothing else moved the head meanwhile.
  if (result.push && chat.headSha === result.push.from) chat.headSha = result.push.to;
```

- [x] **Step 4: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/engine`
Expected: PASS.

- [x] **Step 5: Write the failing hub-message tests**

`apps/server/src/ws/handlers.db.test.ts`:
```ts
import { samples, type JobResult, type RunningJob } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeRepo, makeUser, personOf, resetDb } from '../../test/db';
import { startCliServer, TestCli, type CliServer } from '../../test/ws';
import { prisma } from '../lib/prisma';

let s: CliServer;
let clock: Date;
const later = (ms: number) => new Date(clock.getTime() + ms);

beforeEach(async () => {
  await resetDb();
  clock = new Date();
  s = await startCliServer({ now: () => clock });
});
afterEach(() => s.close());

const complete = (job: RunningJob, result: JobResult, id = 'c1') => ({ v: 1, t: 'job.complete', id, d: { ...job, result } });
const pointsIn = (chatId: string) => prisma.point.count({ where: { chatId } });

/** maya's PR; both are online with the repo linked; leo's review job is running on leo's CLI. */
async function reviewing() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const mayaCli = await TestCli.online(s.url, (await makeCliToken(maya.id)).raw, { repos: [repo.fullName] });
  const leoCli = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw, { repos: [repo.fullName] });
  await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  const { bundle } = (await leoCli.next('job.assign')).d;
  const job: RunningJob = { jobId: bundle.jobId, attempt: bundle.attempt };
  return { chat, mayaCli, leoCli, job, row: () => prisma.job.findUniqueOrThrow({ where: { id: job.jobId } }) };
}

/** leo's review raised P1; maya's address job is running on maya's CLI. */
async function addressing() {
  const scene = await reviewing();
  scene.leoCli.send(complete(scene.job, samples.jobResult()));
  await scene.leoCli.next('ack');
  const { bundle } = (await scene.mayaCli.next('job.assign')).d;
  const address: RunningJob = { jobId: bundle.jobId, attempt: bundle.attempt };
  return { ...scene, address, addressRow: () => prisma.job.findUniqueOrThrow({ where: { id: address.jobId } }) };
}

describe('job.complete', () => {
  it("applies the result and starts the next step: leo's point goes to maya's agent", async () => {
    const { chat, mayaCli, leoCli, job, row } = await reviewing();
    leoCli.send(complete(job, samples.jobResult()));
    expect(await leoCli.next('ack')).toMatchObject({ re: 'c1', d: { status: 'applied' } });
    expect(await row()).toMatchObject({ status: 'done', applyState: 'applied' });
    expect(await pointsIn(chat.id)).toBe(1);
    expect((await mayaCli.next('job.assign')).d.bundle).toMatchObject({ type: 'address', points: [expect.objectContaining({ number: 1 })] });
  });

  it('acks a result from another attempt as stale and changes nothing', async () => {
    const { chat, leoCli, job, row } = await reviewing();
    leoCli.send(complete({ ...job, attempt: job.attempt + 1 }, samples.jobResult()));
    expect((await leoCli.next('ack')).d).toEqual({ status: 'stale' });
    expect((await row()).status).toBe('running');
    expect(await pointsIn(chat.id)).toBe(0);
  });

  it("acks a result for a job running on someone else's CLI as stale", async () => {
    const { chat, mayaCli, job, row } = await reviewing();
    mayaCli.send(complete(job, samples.jobResult()));
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'stale' });
    expect((await row()).status).toBe('running');
    expect(await pointsIn(chat.id)).toBe(0);
  });

  it('applies a result sent twice only once: the second gets stale', async () => {
    const { chat, leoCli, job } = await reviewing();
    leoCli.send(complete(job, samples.jobResult(), 'c1'));
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    leoCli.send(complete(job, samples.jobResult(), 'c2'));
    expect(await leoCli.next('ack')).toMatchObject({ re: 'c2', d: { status: 'stale' } });
    expect(await pointsIn(chat.id)).toBe(1);
  });
});

describe('job.pushing', () => {
  it('records the commit about to be pushed, so its webhook is recognized as ours, and acks', async () => {
    const { mayaCli, address, addressRow } = await addressing();
    mayaCli.send({ v: 1, t: 'job.pushing', id: 'p1', d: { ...address, from: 'a'.repeat(40), to: 'c'.repeat(40) } });
    expect(await mayaCli.next('ack')).toMatchObject({ re: 'p1', d: { status: 'applied' } });
    expect((await addressRow()).expectedPushSha).toBe('c'.repeat(40));
  });

  it('acks a push from another attempt as stale and records nothing: that CLI must not push', async () => {
    const { mayaCli, address, addressRow } = await addressing();
    mayaCli.send({ v: 1, t: 'job.pushing', id: 'p1', d: { ...address, attempt: address.attempt + 1, from: 'a'.repeat(40), to: 'c'.repeat(40) } });
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'stale' });
    expect((await addressRow()).expectedPushSha).toBeNull();
  });
});

describe('job.fail and job.reject', () => {
  it('put a retryable failure back in the queue after a delay', async () => {
    const { leoCli, job, row } = await reviewing();
    leoCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...job, reason: 'crash', retryable: true, detail: 'claude exited with code 1' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    expect(await row()).toMatchObject({ status: 'queued', attempt: 1, cliTokenId: null, runAfter: later(30_000) });
  });

  it('fail the job for good on a final failure, flag its owner and queue a notification', async () => {
    const { chat, leoCli, job, row } = await reviewing();
    leoCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...job, reason: 'auth', retryable: false, detail: 'claude is not logged in' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    expect(await row()).toMatchObject({ status: 'failed', failure: 'auth' });
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'reviewer' } })).toMatchObject({ attention: 'failed' });
    expect(await prisma.task.count({ where: { chatId: chat.id, kind: 'notify' } })).toBe(1);
  });

  it('wait an hour after a daily-cap rejection, without using up an attempt', async () => {
    const { leoCli, job, row } = await reviewing();
    leoCli.send({ v: 1, t: 'job.reject', id: 'r1', d: { ...job, reason: 'daily_cap' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    expect(await row()).toMatchObject({ status: 'queued', attempt: 1, refundedAttempts: 1, runAfter: later(60 * 60_000) });
  });
});

describe('cancels', () => {
  it('reach the CLI running a job the engine cancelled, and nobody else', async () => {
    const { chat, mayaCli, leoCli, job } = await reviewing();
    await s.dispatcher.dispatch(chat.id, { type: 'pr_closed', merged: false });
    expect((await leoCli.next('job.cancel')).d).toEqual({ ...job, reason: 'pr_closed' });
    await mayaCli.nothing('job.cancel');
  });

  it("stop maya's address job when a human pushes, and hand her the new pass on the new head", async () => {
    const { chat, mayaCli, address } = await addressing();
    await s.dispatcher.dispatch(chat.id, { type: 'head_updated', before: chat.headSha, after: 'd'.repeat(40), ours: false });
    expect((await mayaCli.next('job.cancel')).d).toEqual({ ...address, reason: 'branch_moved' });
    expect((await mayaCli.next('job.assign')).d.bundle).toMatchObject({ type: 'address', pr: { headSha: 'd'.repeat(40) } });
  });
});
```

`apps/server/src/tasks/cli-notifier.db.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCliToken, makeUser } from '../../test/db';
import { startCliServer, TestCli, type CliServer } from '../../test/ws';
import { CliNotifier } from './cli-notifier';
import type { Notification } from './notifier';

let s: CliServer;
beforeEach(async () => {
  s = await startCliServer();
});
afterEach(() => s.close());

const ready = (userIds: string[]): Notification => ({
  userIds,
  kind: 'ready',
  chatId: 'chat_1',
  title: 'Ready for your approval: acme/shop-api#142',
  url: 'http://localhost:8787/c/acme/shop-api/142',
});

describe('CliNotifier', () => {
  it("reaches every one of a user's CLIs", async () => {
    const leo = await makeUser({ login: 'leo' });
    const laptop = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw, { device: 'laptop' });
    const desktop = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw, { device: 'desktop' });
    const offline = { notify: vi.fn(async () => {}) };
    await new CliNotifier(s.hub, offline).notify(ready([leo.id]));
    const expected = { kind: 'ready', chatId: 'chat_1', title: 'Ready for your approval: acme/shop-api#142', url: 'http://localhost:8787/c/acme/shop-api/142' };
    expect((await laptop.next('notify')).d).toEqual(expected);
    expect((await desktop.next('notify')).d).toEqual(expected);
    expect(offline.notify).not.toHaveBeenCalled();
  });

  it('falls back to the server log for people with no CLI online', async () => {
    const leo = await makeUser({ login: 'leo' });
    const kim = await makeUser({ login: 'kim' });
    const laptop = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw);
    const offline = { notify: vi.fn(async () => {}) };
    await new CliNotifier(s.hub, offline).notify(ready([leo.id, kim.id]));
    await laptop.next('notify');
    expect(offline.notify).toHaveBeenCalledWith(ready([kim.id]));
  });
});
```

- [x] **Step 6: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/ws/handlers src/tasks/cli-notifier`
Expected: FAIL. `handlers.db.test.ts`: `no ack within 2000 ms` (nothing answers job messages yet), and the cancel tests time out waiting for `job.cancel`. `cli-notifier.db.test.ts`: `Failed to resolve import "./cli-notifier"`.

- [x] **Step 7: Handle the CLI's job messages**

`apps/server/src/ws/handlers.ts`:
```ts
import type { RunningJob } from '@nitpilot/protocol';
import type { Dispatch } from '../chats/dispatch';
import type { DecideOutput, DomainEvent } from '../engine/types';
import { currentAttempt } from '../jobs/leases';
import { prisma } from '../lib/prisma';
import type { CliConnection, MessageListener } from './cli-hub';

type AckStatus = 'applied' | 'stale';
type JobEvent = Extract<DomainEvent, { type: 'job_completed' | 'job_failed' }>;

/**
 * What a CLI reports about a job (spec §10): the push it's about to make, the result, a failure or
 * a refusal. Each is answered with an ack: `applied`, or `stale` when it's about an attempt that is
 * no longer current (see docs/why/leases-and-fencing.md).
 */
export function jobMessageHandler(deps: { dispatch: Dispatch }): MessageListener {
  return async (conn, msg) => {
    switch (msg.t) {
      case 'job.pushing':
        return ack(conn, msg.id, await recordPush(conn, msg.d));
      case 'job.complete': {
        const { jobId, attempt, result } = msg.d;
        return ack(conn, msg.id, await report(deps.dispatch, conn, { type: 'job_completed', jobId, attempt, result }));
      }
      case 'job.fail': {
        const { jobId, attempt, reason, retryable, detail } = msg.d;
        console.warn(`[cli] ${conn.login}/${conn.device}: job ${jobId} failed (${reason}): ${detail}`);
        return ack(conn, msg.id, await report(deps.dispatch, conn, { type: 'job_failed', jobId, attempt, reason, retryable }));
      }
      case 'job.reject': {
        // The CLI turned the job down (daily cap, repo not linked there, …). The engine decides how long to wait.
        const { jobId, attempt, reason } = msg.d;
        return ack(conn, msg.id, await report(deps.dispatch, conn, { type: 'job_failed', jobId, attempt, reason, retryable: true }));
      }
      default:
        // hello and ping belong to jobs/leases.ts. job.progress is for Plan 2's live status line;
        // nothing shows it in Plan 1.
        return;
    }
  };
}

/**
 * job.pushing: remember the commit before the CLI pushes it, so the router knows the push webhook
 * is ours (spec §15). One compare-and-swap does the fencing check and the write together.
 */
async function recordPush(conn: CliConnection, push: RunningJob & { to: string }): Promise<AckStatus> {
  const { count } = await prisma.job.updateMany({
    where: { id: push.jobId, attempt: push.attempt, status: 'running', cliTokenId: conn.tokenId },
    data: { expectedPushSha: push.to },
  });
  return count === 1 ? 'applied' : 'stale';
}

/** Hand a result or a failure to the engine, if it's about the attempt running on this CLI. */
async function report(dispatch: Dispatch, conn: CliConnection, event: JobEvent): Promise<AckStatus> {
  const job = await currentAttempt(conn.tokenId, { jobId: event.jobId, attempt: event.attempt });
  if (!job) return 'stale';
  const out = await dispatch(job.chatId, event);
  return engineTookIt(out, event.jobId) ? 'applied' : 'stale';
}

/**
 * The engine answers a job event it accepts with complete_job, retry_job or fail_job for that job.
 * Without one it ignored the event: the attempt changed between our check and the chat's lock.
 */
function engineTookIt(out: DecideOutput, jobId: string): boolean {
  return out.commands.some((c) => (c.type === 'complete_job' || c.type === 'retry_job' || c.type === 'fail_job') && c.jobId === jobId);
}

function ack(conn: CliConnection, re: string | undefined, status: AckStatus): void {
  conn.send({ v: 1, t: 'ack', re, d: { status } });
}
```

- [x] **Step 8: Send notifications to CLIs**

`apps/server/src/tasks/cli-notifier.ts`:
```ts
import type { CliHub } from '../ws/cli-hub';
import { LogNotifier, type Notification, type Notifier } from './notifier';

/**
 * Plan 1's notifications (spec §16): every CLI a person has connected prints them and shows an OS
 * notification. Someone with no CLI online only gets a line in the server log; Plan 2 adds Web Push.
 */
export class CliNotifier implements Notifier {
  constructor(
    private readonly hub: CliHub,
    private readonly offline: Notifier = new LogNotifier(),
  ) {}

  async notify(n: Notification): Promise<void> {
    const unreached: string[] = [];
    for (const userId of n.userIds) {
      const clis = this.hub.connectionsFor(userId);
      for (const cli of clis) cli.send({ v: 1, t: 'notify', d: { kind: n.kind, chatId: n.chatId, title: n.title, url: n.url } });
      if (clis.length === 0) unreached.push(userId);
    }
    if (unreached.length > 0) await this.offline.notify({ ...n, userIds: unreached });
  }
}
```

- [x] **Step 9: Wire job messages and cancels**

Replace `apps/server/src/ws/wire.ts` with:
```ts
import type { Dispatcher } from '../chats/dispatch';
import { JobAssigner } from '../jobs/assign';
import { buildJobBundle } from '../jobs/bundle';
import { cancelMessage, Leases } from '../jobs/leases';
import type { PlatformReads } from '../platform/types';
import type { CliHub } from './cli-hub';
import { jobMessageHandler } from './handlers';

/** How often the timers run: jobs whose retry delay ended, and leases that ran out. */
export const SWEEP_MS = 5_000;

export type CliHubDeps = {
  hub: CliHub;
  dispatcher: Dispatcher;
  platform: Pick<PlatformReads, 'gitSpec'>;
  now?: () => Date;
};

/**
 * Connect the CLI hub to the rest of the server: who gets which job, and what CLIs' messages do.
 * main.ts and the tests both call this, so the tests run exactly the wiring production runs.
 */
export function wireCliHub({ hub, dispatcher, platform, now = () => new Date() }: CliHubDeps) {
  const assigner = new JobAssigner(hub, (jobId) => buildJobBundle(jobId, platform), now);
  const leases = new Leases(hub, dispatcher.dispatch, now);

  // Every message from a CLI goes through these listeners, in this order.
  hub.onMessage(leases.handle); // hello and ping: renew leases, cancel what's no longer theirs
  hub.onMessage(jobMessageHandler({ dispatch: dispatcher.dispatch })); // pushes, results, failures, refusals
  hub.onMessage(async (_conn, msg) => {
    // A CLI that just said hello may be able to take queued jobs.
    if (msg.t === 'hello') assigner.wake();
  });

  dispatcher.onCommit((_chatId, effects) => {
    // A job was queued, finished, failed or cancelled: maybe another one can go out now.
    if (effects.jobsChanged) assigner.wake();
    // Jobs the engine cancelled while a CLI was running them (PR closed, reviewer removed, a human push).
    for (const job of effects.cancelledJobs) {
      if (job.cliTokenId) hub.send(job.cliTokenId, cancelMessage({ jobId: job.id, attempt: job.attempt }, job.reason));
    }
  });

  assigner.onBundleFailed(async (job) => {
    // The job is ours but can't be sent. Let the engine's retry rules decide now, instead of
    // waiting for its lease to run out and calling it a timeout (spec §9.4).
    await dispatcher.dispatch(job.chatId, { type: 'job_failed', jobId: job.jobId, reason: 'setup_failed', retryable: true, attempt: job.attempt });
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    assigner,
    leases,
    start(): void {
      timer ??= setInterval(() => {
        assigner.wake();
        void leases.sweep().catch((err) => console.error('[leases] sweep failed:', err));
      }, SWEEP_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
```

- [x] **Step 10: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/ws src/jobs src/tasks/cli-notifier && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (handlers 11, cli-notifier 2, cli-hub 9, assign 10, bundle 5, leases 9).

- [x] **Step 11: Notify through the CLIs in the server**

Replace `apps/server/src/main.ts` with:
```ts
// Load apps/server/.env if there is one. Variables already set in the environment win.
import 'dotenv/config';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { CLOSE_CODES } from '@nitpilot/protocol';
import { getUserToken } from './auth/user-tokens';
import { Dispatcher } from './chats/dispatch';
import { createApp } from './http/app';
import { createDeliveryHandler } from './ingest/handle';
import { createIngest } from './ingest/process';
import { purgeOldRows } from './ingest/record';
import { recoverOnBoot } from './ingest/recovery';
import { acquireSingletonLock } from './lib/advisory-lock';
import { getEnv } from './lib/env';
import { AppAuth } from './platform/github/app-auth';
import { GithubClient } from './platform/github/client';
import { GithubPlatform } from './platform/github/platform';
import { CliNotifier } from './tasks/cli-notifier';
import { reportFailedWrite } from './tasks/handlers/failed-writes';
import { createTaskHandlers } from './tasks/handlers/index';
import { TaskRunner } from './tasks/runner';
import { CliHub } from './ws/cli-hub';
import { wireCliHub } from './ws/wire';

async function main(): Promise<void> {
  const env = getEnv();

  // One server per database (spec §7, docs/why/one-process.md).
  const lock = await acquireSingletonLock(env.DATABASE_URL);
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  // The outside world.
  const github = new GithubClient();
  const appAuth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
  // CLIs connect over a WebSocket and get their jobs and notifications through it (spec §10, docs/why/websockets.md).
  const hub = new CliHub();
  const notifier = new CliNotifier(hub);

  // The core loop: webhook → ingest → router → dispatcher (engine) → tasks → GitHub, and jobs → CLIs.
  const dispatcher = new Dispatcher();
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier, dispatch: dispatcher.dispatch }), {
    // A review or replies that never reached GitHub shows up in the chat and notifies its owner.
    onGiveUp: reportFailedWrite(dispatcher.dispatch),
  });
  dispatcher.onCommit((_chatId, effects) => {
    if (effects.tasksCreated) runner.wake();
  });
  // Jobs → CLIs: the assigner, leases, and what CLIs report back (ws/wire.ts).
  const cliJobs = wireCliHub({ hub, dispatcher, platform });
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));

  const app = createApp({ github, appAuth, ingest });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });
  // serve() makes a plain HTTP/1 server; WebSocket upgrades on it go to the hub.
  hub.attach(server as Server);

  const recovered = await recoverOnBoot({ ingest, platform });
  console.log(`[boot] re-ran ${recovered.tasks} tasks, replayed ${recovered.replayed} deliveries, asked GitHub to resend ${recovered.redelivered}`);
  runner.start();
  // The server was away, not the CLIs: running jobs get a fresh lease, so CLIs that reconnect keep them.
  await cliJobs.leases.renewAfterRestart();
  cliJobs.start();
  const purge = setInterval(() => void purgeOldRows().catch((err) => console.error('[purge]', err)), 60 * 60_000);
  // Deliveries that failed (a GitHub hiccup, say) get another try once their wait is over.
  const retries = setInterval(() => void ingest.retryDue().catch((err) => console.error('[ingest] retry sweep failed:', err)), 30_000);

  const shutdown = async () => {
    clearInterval(purge);
    clearInterval(retries);
    runner.stop();
    cliJobs.stop();
    // 1012 tells every CLI the server is restarting, so they reconnect.
    hub.closeAll(CLOSE_CODES.serverRestart, 'server restarting');
    server.close();
    await lock.release();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [x] **Step 12: Update the explainers**

In `docs/why/dispatcher.md`, replace:
```markdown
   5. after the commit, tell listeners: the task runner wakes up when new tasks were written (`main.ts`); Plan 1b adds the CLI hub.
```
with:
```markdown
   5. after the commit, tell listeners: the task runner wakes up when new tasks were written (`main.ts`), and the CLI hub's wiring (`ws/wire.ts`) wakes the job assigner and sends `job.cancel` for running jobs the engine cancelled.
```

In `docs/why/outbox-and-restarts.md`, replace:
```markdown
| `notify` | tell people they're needed (Plan 1a logs it; Plan 1b sends it to their CLI) | — |
```
with:
```markdown
| `notify` | tell people they're needed: sent to each of their connected CLIs (`tasks/cli-notifier.ts`), or logged when none is online | — |
```

- [x] **Step 13: Write the stand-in CLI for the live check**

The real CLI arrives in M7, but whether a summary comment really posts on GitHub has never been seen. This script plays a reviewer's CLI: it logs in like `nitpilot login`, connects to `/ws/cli`, and answers each review job with one planted point.

`apps/server/scripts/fake-cli.ts`:
```ts
import {
  CLI_WS_PATH, CliLoginPollResponse, CliLoginStartResponse, PROTOCOL_VERSION, ServerToCli,
  type CliToServer, type JobBundle, type JobResult,
} from '@nitpilot/protocol';

// A stand-in for the real CLI (Plan 1b, M7), for live checks before it exists. It logs in like
// `nitpilot login`, connects to /ws/cli, and answers every review job with one planted point, so a
// summary comment shows up on GitHub. Its "agent" only reviews, so it never gets address jobs.
//   npm run dev:fake-cli -w apps/server -- owner/repo
// NITPILOT_SERVER points it at another server than http://localhost:8787.

const repo = process.argv[2] ?? '';
if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  console.error('Usage: npm run dev:fake-cli -w apps/server -- owner/repo');
  process.exit(1);
}
const server = process.env.NITPILOT_SERVER ?? 'http://localhost:8787';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (text: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);

/** The planted point. Its title mentions someone outside the PR, which the summary must neutralize. */
const RESULT: JobResult = {
  summary: 'fake-cli planted one point to check the summary comment.',
  points: [
    {
      path: null,
      line: null,
      side: null,
      severity: 'minor',
      category: 'docs',
      title: 'Mention check: @nitpilot-mention-check must show as code, not as a mention',
      body: 'Planted by apps/server/scripts/fake-cli.ts.',
      snippet: null,
    },
  ],
  decisions: [],
  replies: [],
  push: null,
};

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${server}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

/** `nitpilot login`, in short: get a code, wait for approval in the browser, receive a token. */
async function login(): Promise<string> {
  const start = CliLoginStartResponse.parse(await postJson('/api/cli/login', { deviceName: 'fake-cli (dev script)' }));
  log(`Approve this device: open ${start.verifyUrl} (code ${start.userCode}), signed in as the reviewer.`);
  for (;;) {
    await sleep(start.interval * 1000);
    const poll = CliLoginPollResponse.parse(await postJson('/api/cli/login/poll', { deviceCode: start.deviceCode }));
    if (poll.status === 'approved') return poll.token;
    if (poll.status !== 'pending') throw new Error(`login ${poll.status}`);
  }
}

async function main(): Promise<void> {
  const token = await login();
  const ws = new WebSocket(`${server.replace(/^http/, 'ws')}${CLI_WS_PATH}`, { headers: { authorization: `Bearer ${token}` } });
  const running = new Map<string, number>(); // jobId → attempt
  const send = (msg: CliToServer) => ws.send(JSON.stringify(msg));

  async function answer(bundle: JobBundle): Promise<void> {
    running.set(bundle.jobId, bundle.attempt);
    log(`job.assign: ${bundle.type} of ${bundle.pr.repoFullName}#${bundle.pr.number} at ${bundle.pr.headSha.slice(0, 7)} (attempt ${bundle.attempt})`);
    await sleep(2000);
    if (running.get(bundle.jobId) !== bundle.attempt) return; // cancelled meanwhile
    send({ v: 1, t: 'job.complete', id: `complete-${bundle.jobId}`, d: { jobId: bundle.jobId, attempt: bundle.attempt, result: RESULT } });
    running.delete(bundle.jobId);
  }

  ws.addEventListener('open', () => {
    send({
      v: 1,
      t: 'hello',
      d: {
        protocol: PROTOCOL_VERSION,
        cliVersion: '0.0.0-dev',
        device: 'fake-cli',
        agent: { id: 'fake', version: null, modes: ['reviewer'] },
        repos: [repo],
        concurrency: 1,
        running: [],
        defaults: { autoReview: true, autoAddress: true },
      },
    });
  });
  ws.addEventListener('message', (event) => {
    const msg = ServerToCli.parse(JSON.parse(String(event.data)));
    if (msg.t === 'welcome') {
      log(`connected as ${msg.d.login}; waiting for review jobs on ${repo} (Ctrl-C stops)`);
      setInterval(() => send({ v: 1, t: 'ping', d: { running: [...running].map(([jobId, attempt]) => ({ jobId, attempt })) } }), msg.d.pingSec * 1000);
    } else if (msg.t === 'job.assign') {
      void answer(msg.d.bundle);
    } else if (msg.t === 'job.cancel') {
      running.delete(msg.d.jobId);
      log(`job.cancel: ${msg.d.jobId} (${msg.d.reason})`);
    } else if (msg.t !== 'pong') {
      log(`${msg.t}: ${JSON.stringify(msg.d)}`);
    }
  });
  ws.addEventListener('close', (event) => {
    log(`disconnected (${event.code} ${event.reason})`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

In `apps/server/package.json`, replace the scripts line `"dev:tunnel": "tsx scripts/dev-tunnel.ts"` with:
```json
    "dev:tunnel": "tsx scripts/dev-tunnel.ts",
    "dev:fake-cli": "tsx scripts/fake-cli.ts"
```

- [x] **Step 14: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [x] **Step 15: Commit**

```bash
git add apps/server docs/why/dispatcher.md docs/why/outbox-and-restarts.md
git commit -m "feat(server): CLI results, push acks, cancels and notifications over the hub

An address job's own push moves the chat head at once. Adds scripts/fake-cli.ts
for live checks before the real CLI exists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [x] **Step 16: Live checkpoint: a summary comment on real GitHub**

A summary comment from `nitpilot-dev[bot]` has never been seen on GitHub, and neither has mention neutralizing. This run checks both. It needs three terminals; `apps/server/.env` holds the app's credentials (never print them).

1. Docker is running (`open -a Docker` if not; container `nitpilot-postgres-1`). In terminal 1: `npm run dev:tunnel`, and wait for `✓ nitpilot-dev now sends webhooks to …`. In terminal 2: `npm run dev -w apps/server`, and wait for `Nitpilot server listening`.
2. The author must be on Nitpilot, or the chat is single-player and no summary comment is written. Sign in once at the server's home page as **NikosGkikas13**, and in a private window as **ngkdev93-jpg** (skip whoever already has). Check both exist:
   ```bash
   docker exec nitpilot-postgres-1 psql -U nitpilot -d nitpilot -c 'select login from "User"'
   ```
   Expected: both logins listed.
3. In terminal 3: `npm run dev:fake-cli -w apps/server -- NikosGkikas13/nitpilot-sandbox`. Open the printed URL while signed in as NikosGkikas13 and approve.
   Expected: `connected as NikosGkikas13; waiting for review jobs on NikosGkikas13/nitpilot-sandbox`. If a review job for NikosGkikas13 is still queued from Plan 1a's testing (on PR #1, say), it is handed out at once and answered the same way; that's fine, and it is already a first sign the hand-out works.
4. Start a review with a clean chat: as **ngkdev93-jpg**, push a branch with a one-line change to the sandbox and open a PR that requests **NikosGkikas13**'s review. (Re-requesting on PR #1 also works, but only if its chat has no address job queued from earlier tests: the engine starts no review while an address pass is pending.)
   Expected in terminal 3, within about 5 s of opening the PR: `job.assign: review of NikosGkikas13/nitpilot-sandbox#<n> …`, then about 2 s later `ack: {"status":"applied"}`.
5. Open the PR on GitHub. Expected within about 10 s (the summary waits 5 s for quiet):
   - exactly one comment from `nitpilot-dev[bot]`, starting `🤖 **Nitpilot**`, with the review log listing P1 and an "Open the conversation →" link;
   - in P1's title, `@nitpilot-mention-check` shows as inline code, not as a mention (neutralized);
   - its raw body (`…` → Edit) starts with the hidden `<!-- nitpilot:v1 chat=… -->` marker;
   - terminal 2 shows no `[tasks]` or `[cli-hub]` errors.
6. Close the PR on GitHub (this cancels the author's queued address job), then stop the fake CLI, the server and the tunnel with Ctrl-C.

If any expectation fails, stop and debug it (superpowers:systematic-debugging) before Task 5; a fix gets its own failing test and commit.

- [x] **Step 17: Record the result**

Add a `Task 4 live check:` line to the ledger with the PR number, the comment's URL, the seconds from opening the PR to `job.assign`, and whether the mention showed as code. If anything needed a fix, list the fix commit.

---

## Milestone M7: CLI commands

M7 turns `apps/cli` from a stub into the `nitpilot` command: the personal config file and a typed client for the server's REST API (Task 5); `login`, `status`, `repos add` and `retry`, plus the server endpoints they still lack (Task 6); `start`, the daemon that keeps one WebSocket open and runs jobs (Task 7); and `doctor` (Task 8). Agents don't exist yet (M10–M11), so `nitpilot start` declares no agent modes: the server hands it no jobs, but it connects, pings and shows notifications. Task 17 plugs the real executor in.

**Files at the end of M7:**
```
packages/protocol/package.json         + "./test-samples" export (samples leave the main entry)
packages/protocol/src/api.ts           + RetryResponse, HealthResponse
apps/cli/
  package.json, tsconfig.json, vitest.config.ts, tsup.config.ts
  src/index.ts           the `nitpilot` binary (calls runCli)
  src/cli.ts             runCli, COMMANDS, usage
  src/errors.ts          CliError
  src/out.ts             Out (where commands print)
  src/config/config.ts   PersonalConfigSchema, configDir, loadConfig, loadConfigFile, saveConfig
  src/http.ts            ServerClient, ServerError
  src/git/remotes.ts     parseGithubRemote, gitTopLevel, githubReposIn
  src/commands/          login.ts, status.ts, repos.ts, retry.ts, start.ts, doctor.ts
  src/connection/        backoff.ts (Backoff), ws-client.ts (openSocket)
  src/daemon.ts          startDaemon, JobExecutor, JobOutcome, JobIo
  src/state.ts           DailyJobCounter
  src/notify-os.ts       notifyOs
  test/                  out.ts, temp.ts, stub-server.ts, stub-hub.ts, build.test.ts
apps/server/src/
  lib/rate-limit.ts      RateLimiter
  http/routes/cli.ts     + POST /api/chats/:id/retry, login starts rate-limited
  ingest/record.ts       purgeOldRows also deletes old CLI login requests
  engine/results.ts      + onRetryRequested
docs/why/cli-config.md (new); docs/why/cli-login.md, docs/why/websockets.md (new sections)
```

### Task 5: CLI skeleton, personal config, server client and build

**Files:**
- Create: `packages/protocol/src/index.test.ts`
- Modify: `packages/protocol/package.json`, `packages/protocol/src/index.ts` (the test samples get their own entry, Plan 1a deferred minor M8)
- Modify: `apps/server/src/chats/dispatch.db.test.ts`, `apps/server/src/jobs/bundle.db.test.ts`, `apps/server/src/ws/handlers.db.test.ts` (import the samples from the new entry)
- Modify: `apps/cli/package.json`, `apps/cli/tsconfig.json`
- Create: `apps/cli/vitest.config.ts`, `apps/cli/tsup.config.ts`
- Create: `apps/cli/src/index.ts`, `apps/cli/src/cli.ts`, `apps/cli/src/errors.ts`, `apps/cli/src/out.ts`, `apps/cli/src/config/config.ts`, `apps/cli/src/http.ts`
- Create: `apps/cli/src/cli.test.ts`, `apps/cli/src/config/config.test.ts`, `apps/cli/src/http.test.ts`, `apps/cli/test/build.test.ts`, `apps/cli/test/out.ts`, `apps/cli/test/temp.ts`
- Create: `docs/why/cli-config.md`
- Modify: `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §13 (the personal config gains `apiBilling`)
- Port: `~/Desktop/PracticeProjects/hooksmith/cli/src/config.ts` (XDG path, env overrides, 0600)

**Interfaces:**
- Consumes: `BRAND`, `AgentId`, `CliLoginStartResponse`, `CliLoginPollResponse`, `MeResponse`, `MyChatsResponse` (`packages/protocol`).
- Produces:
  - `runCli(argv: string[], out: Out, commands?: Record<string, Command>) → Promise<number>` (the exit code) and `COMMANDS: Record<string, Command>`, where `Command = { usage: string; summary: string; run(args: string[], out: Out): Promise<number | void> }` (`src/cli.ts`). Later tasks add their commands to `COMMANDS`;
  - `class CliError(message)` (`src/errors.ts`): a problem shown as a plain message, exit code 1;
  - `type Out = { log(text): void; error(text): void }` and `terminal: Out` (`src/out.ts`);
  - `PersonalConfigSchema`, `type PersonalConfig`, `DEFAULT_SERVER`, `configDir(env?)`, `configPath(dir)`, `loadConfig({ env?, dir? })`, `loadConfigFile(dir)`, `saveConfig(cfg, dir)` (`src/config/config.ts`);
  - `class ServerClient(server: string, token: string | null, fetchImpl?)` with `loginStart(deviceName)`, `loginPoll(deviceCode)`, `me()`, `myChats()`, `revoke()`; `class ServerError extends CliError { status }` (`src/http.ts`);
  - `@nitpilot/protocol/test-samples` (`jobResult()`, `jobBundle()`), no longer exported as `samples` from the main entry;
  - test helpers `recordOut()` (`test/out.ts`) and `tempDir()` (`test/temp.ts`).

**Behavior** (spec §7, §13):
- The config lives in `$NITPILOT_CONFIG_DIR/config.json`, else `$XDG_CONFIG_HOME/nitpilot/config.json`, else `~/.config/nitpilot/config.json`. Every field has a default, so a missing file means "all defaults".
- `NITPILOT_SERVER` and `NITPILOT_TOKEN` win over the file, one field at a time. `loadConfigFile` reads the file alone: commands that change the config load it that way and save it, so an environment override never ends up in the file.
- `saveConfig` writes `config.json.tmp` with mode 0600 and renames it over `config.json`, so the file is 0600 even when an older one had looser permissions, and a crash halfway never leaves a half-written file.
- A broken file is a `CliError` naming the file: not JSON, or the setting that's wrong.
- `ServerClient` checks every answer against the protocol's zod schemas. A 401 says to run `nitpilot login`; other errors carry the server's own message; an unreachable server says so.
- The published package bundles `@nitpilot/protocol` and zod into one file with tsup, so `npx nitpilot` needs nothing else, and the private protocol package is a dev dependency only.

- [x] **Step 1: Write the failing protocol test**

`packages/protocol/src/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as protocol from './index';

describe('the package entry', () => {
  it("doesn't export the test samples: they have their own entry, @nitpilot/protocol/test-samples", () => {
    expect(Object.keys(protocol)).not.toContain('samples');
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `npm test -w packages/protocol -- src/index.test.ts`
Expected: FAIL: `expected [ …, 'samples', … ] not to include 'samples'`.

- [x] **Step 3: Give the samples their own entry**

In `packages/protocol/package.json`, replace:
```json
  "exports": {
    ".": "./src/index.ts"
  },
```
with:
```json
  "exports": {
    ".": "./src/index.ts",
    "./test-samples": "./src/test-samples.ts"
  },
```

In `packages/protocol/src/index.ts`, delete the line `export * as samples from './test-samples';`.

In `apps/server/src/chats/dispatch.db.test.ts` and `apps/server/src/jobs/bundle.db.test.ts`, replace `import { samples } from '@nitpilot/protocol';` with:
```ts
import * as samples from '@nitpilot/protocol/test-samples';
```

In `apps/server/src/ws/handlers.db.test.ts`, replace `import { samples, type JobResult, type RunningJob } from '@nitpilot/protocol';` with:
```ts
import type { JobResult, RunningJob } from '@nitpilot/protocol';
import * as samples from '@nitpilot/protocol/test-samples';
```

- [x] **Step 4: Run it to see it pass**

Run: `npm test -w packages/protocol && npm run typecheck -w apps/server`
Expected: PASS (protocol 41); the server typechecks with the new import path.

- [x] **Step 5: Set up the CLI package**

Replace `apps/cli/package.json` with:
```json
{
  "name": "nitpilot",
  "version": "0.1.0",
  "description": "Your own AI agent reviews your teammates' pull requests, and theirs reviews yours.",
  "type": "module",
  "bin": {
    "nitpilot": "dist/index.js"
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=22"
  },
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "@nitpilot/protocol": "*",
    "tsup": "^8.5.1",
    "zod": "^4.6.5"
  }
}
```
`@nitpilot/protocol` moves to `devDependencies`: it is private and never published, and tsup bundles it (and zod) into `dist/index.js`. With no `dependencies` at all, `npx nitpilot` installs one package and nothing else.

Replace `apps/cli/tsconfig.json` with:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "tsup.config.ts", "vitest.config.ts"] }
```

`apps/cli/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] } });
```

`apps/cli/tsup.config.ts`:
```ts
import { defineConfig, type Options } from 'tsup';

/** One ESM file, dist/index.js, with everything it imports inside (spec §7). test/build.test.ts reuses these options. */
export const buildOptions = {
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // Our own protocol package isn't on npm, so it goes inside the bundle (zod with it).
  noExternal: ['@nitpilot/protocol'],
} satisfies Options;

export default defineConfig(buildOptions);
```

Run: `npm install`
Expected: tsup is installed and `package-lock.json` updated; `@nitpilot/protocol` is still linked into `node_modules`.

- [x] **Step 6: Write the failing CLI tests**

`apps/cli/test/out.ts`:
```ts
import type { Out } from '../src/out';

/** An Out that remembers everything printed, for assertions. */
export function recordOut(): Out & { lines: string[]; text(): string } {
  const lines: string[] = [];
  return {
    lines,
    log: (text) => void lines.push(text),
    error: (text) => void lines.push(text),
    text: () => lines.join('\n'),
  };
}
```

`apps/cli/test/temp.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/** A fresh empty folder outside the repo, deleted when the test ends. Call it inside a test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nitpilot-test-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
```

`apps/cli/src/cli.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordOut } from '../test/out';
import { runCli, type Command } from './cli';
import { CliError } from './errors';
import { CLI_VERSION } from './version';

const hello: Command = {
  usage: 'nitpilot hello <name>',
  summary: 'Say hello',
  async run([name], out) {
    if (!name) throw new CliError('Who should I greet?');
    out.log(`hello ${name}`);
  },
};

describe('runCli', () => {
  it('lists the commands for --help, and when no command is given', async () => {
    for (const argv of [['--help'], []]) {
      const out = recordOut();
      expect(await runCli(argv, out, { hello })).toBe(0);
      expect(out.text()).toContain('Usage: nitpilot <command>');
      expect(out.text()).toContain('nitpilot hello <name>  Say hello');
    }
  });

  it('prints the version, which matches package.json', async () => {
    const out = recordOut();
    expect(await runCli(['--version'], out)).toBe(0);
    expect(out.lines).toEqual([CLI_VERSION]);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it('runs a command with the arguments after its name', async () => {
    const out = recordOut();
    expect(await runCli(['hello', 'maya'], out, { hello })).toBe(0);
    expect(out.lines).toEqual(['hello maya']);
  });

  it('shows a CliError as a plain message and exits with 1', async () => {
    const out = recordOut();
    expect(await runCli(['hello'], out, { hello })).toBe(1);
    expect(out.lines).toEqual(['Who should I greet?']);
  });

  it('rejects an unknown command with exit code 2', async () => {
    const out = recordOut();
    expect(await runCli(['nope'], out, { hello })).toBe(2);
    expect(out.text()).toContain('Unknown command: nope');
  });
});
```

`apps/cli/src/config/config.test.ts`:
```ts
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../test/temp';
import { configDir, configPath, DEFAULT_SERVER, loadConfig, loadConfigFile, saveConfig } from './config';

afterEach(() => vi.unstubAllEnvs());

const writeConfig = (dir: string, content: string) => writeFileSync(configPath(dir), content);
const modeOf = (path: string) => statSync(path).mode & 0o777;

describe('configDir', () => {
  it('uses NITPILOT_CONFIG_DIR first, then XDG_CONFIG_HOME, then ~/.config', () => {
    expect(configDir({ NITPILOT_CONFIG_DIR: '/tmp/a', XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/a');
    expect(configDir({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe(join('/tmp/xdg', 'nitpilot'));
    expect(configDir({})).toBe(join(homedir(), '.config', 'nitpilot'));
  });
});

describe('loadConfig', () => {
  it('has the spec §13 defaults when there is no file', () => {
    expect(loadConfig({ env: {}, dir: tempDir() })).toEqual({
      server: DEFAULT_SERVER,
      token: null,
      agent: 'claude-code',
      auto: { review: true, address: true },
      concurrency: 1,
      jobTimeoutMinutes: 15,
      dailyJobCap: 40,
      apiBilling: false,
      repos: {},
    });
  });

  it('lets NITPILOT_SERVER and NITPILOT_TOKEN win over the file, one field at a time', () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ server: 'https://file.example', token: 'nit_fromfile', concurrency: 2 }));
    expect(loadConfig({ env: { NITPILOT_TOKEN: 'nit_fromenv' }, dir })).toMatchObject({ server: 'https://file.example', token: 'nit_fromenv', concurrency: 2 });
    expect(loadConfig({ env: { NITPILOT_SERVER: 'http://localhost:8787' }, dir })).toMatchObject({ server: 'http://localhost:8787', token: 'nit_fromfile' });
  });

  it('names the file when it is not valid JSON', () => {
    const dir = tempDir();
    writeConfig(dir, '{ "server": ');
    expect(() => loadConfig({ env: {}, dir })).toThrow(`${configPath(dir)} is not valid JSON`);
  });

  it('names the setting that is wrong', () => {
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ concurrency: 9 }));
    expect(() => loadConfig({ env: {}, dir })).toThrow(/Invalid setting "concurrency" in .*config\.json/);
  });
});

describe('loadConfigFile', () => {
  it('reads the file alone, so saving what it returns never writes an environment override', () => {
    vi.stubEnv('NITPILOT_TOKEN', 'nit_fromenv');
    const dir = tempDir();
    writeConfig(dir, JSON.stringify({ token: 'nit_fromfile' }));
    expect(loadConfigFile(dir).token).toBe('nit_fromfile');
  });
});

describe('saveConfig', () => {
  it('writes a file only you can read, even over one with looser permissions', () => {
    const dir = tempDir();
    writeConfig(dir, '{}');
    chmodSync(configPath(dir), 0o644);
    const cfg = { ...loadConfigFile(dir), token: 'nit_saved' };
    saveConfig(cfg, dir);
    expect(modeOf(configPath(dir))).toBe(0o600);
    expect(loadConfigFile(dir)).toEqual(cfg);
  });

  it('creates the folder when it does not exist yet', () => {
    const dir = join(tempDir(), 'nested', 'nitpilot');
    saveConfig(loadConfigFile(dir), dir);
    expect(modeOf(configPath(dir))).toBe(0o600);
    expect(JSON.parse(readFileSync(configPath(dir), 'utf8'))).toMatchObject({ server: DEFAULT_SERVER });
  });
});
```

`apps/cli/src/http.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ServerClient } from './http';
import { CLI_VERSION } from './version';

type Call = { url: URL; init: RequestInit };

/** A stand-in for fetch: records each call and answers with `reply`. */
function fakeFetch(reply: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return reply(url);
  };
  return Object.assign(fn as typeof fetch, { calls });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SERVER = 'http://nitpilot.test';

describe('ServerClient', () => {
  it("sends the device's token and returns the checked answer", async () => {
    const fetch = fakeFetch(() => json({ login: 'maya', avatarUrl: null, githubAuth: 'ok' }));
    expect(await new ServerClient(SERVER, 'nit_abc', fetch).me()).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'ok' });
    const { url, init } = fetch.calls[0]!;
    expect(url.href).toBe(`${SERVER}/api/me`);
    expect(init.headers).toMatchObject({ authorization: 'Bearer nit_abc', 'user-agent': `nitpilot/${CLI_VERSION}` });
  });

  it('posts JSON to start a login', async () => {
    const fetch = fakeFetch(() => json({ deviceCode: 'd', userCode: 'WDJB-MJHT', verifyUrl: `${SERVER}/cli/approve?code=WDJB-MJHT`, interval: 2, expiresIn: 600 }));
    await new ServerClient(SERVER, null, fetch).loginStart('laptop');
    const { init } = fetch.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ deviceName: 'laptop' });
  });

  it('says to log in again when the server rejects the token', async () => {
    const fetch = fakeFetch(() => json({ error: { code: 'unauthorized', message: 'Missing or invalid CLI token.' } }, 401));
    await expect(new ServerClient(SERVER, 'nit_old', fetch).me()).rejects.toThrow('Run `nitpilot login`');
  });

  it("passes on the server's own error message", async () => {
    const fetch = fakeFetch(() => json({ error: { code: 'conflict', message: 'Nothing of yours failed on this PR.' } }, 409));
    await expect(new ServerClient(SERVER, 'nit_abc', fetch).myChats()).rejects.toThrow('Nothing of yours failed on this PR. (HTTP 409)');
  });

  it('needs a token for calls that need one, and then asks nothing of the server', async () => {
    const fetch = fakeFetch(() => json({}));
    await expect(new ServerClient(SERVER, null, fetch).me()).rejects.toThrow('Not logged in. Run `nitpilot login`.');
    expect(fetch.calls).toEqual([]);
  });

  it('says so when the server cannot be reached', async () => {
    const fetch = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(new ServerClient(SERVER, 'nit_abc', fetch).me()).rejects.toThrow(`Can't reach ${SERVER}: fetch failed`);
  });

  it("rejects an answer that doesn't fit the protocol", async () => {
    const fetch = fakeFetch(() => json({ hello: 'world' }));
    await expect(new ServerClient(SERVER, 'nit_abc', fetch).me()).rejects.toThrow('Unexpected answer from /api/me');
  });
});
```

`apps/cli/test/build.test.ts`:
```ts
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'tsup';
import { describe, expect, it } from 'vitest';
import { buildOptions } from '../tsup.config';
import { tempDir } from './temp';

const run = promisify(execFile);
const cliDir = fileURLToPath(new URL('..', import.meta.url));

describe('the published bundle', () => {
  it('is one file that runs on its own, without the workspace packages', async () => {
    // Built into a folder outside the repo: from there Node can't find node_modules/@nitpilot/protocol.
    const outDir = tempDir();
    await build({ ...buildOptions, entry: [join(cliDir, 'src/index.ts')], outDir, config: false, silent: true });
    const { stdout } = await run(process.execPath, [join(outDir, 'index.js'), '--help'], { cwd: outDir });
    expect(stdout).toContain('Usage: nitpilot <command>');
    // Test data isn't part of the product (Plan 1a deferred minor M8).
    expect(readFileSync(join(outDir, 'index.js'), 'utf8')).not.toContain('Found a crash on empty input');
  }, 60_000);
});
```

- [x] **Step 7: Run them to see them fail**

Run: `npm test -w apps/cli`
Expected: FAIL: `Failed to resolve import "./cli"` (and `./config`, `./http`, `../src/out`), since none of those files exist yet.

- [x] **Step 8: Write the entry point and the command runner**

`apps/cli/src/errors.ts`:
```ts
/** A problem to show the person as a plain message (no stack trace). The CLI then exits with 1. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
```

`apps/cli/src/out.ts`:
```ts
/** Where commands print. The real one is the terminal; tests pass one that records the lines. */
export type Out = { log(text: string): void; error(text: string): void };

export const terminal: Out = {
  log: (text) => console.log(text),
  error: (text) => console.error(text),
};
```

`apps/cli/src/cli.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import { CliError } from './errors';
import type { Out } from './out';
import { CLI_VERSION } from './version';

/** One `nitpilot <name>` command. `run` gets the arguments after the name and may return an exit code. */
export type Command = { usage: string; summary: string; run(args: string[], out: Out): Promise<number | void> };

/** Every command, in the order `--help` lists them. Each lives in src/commands/ and is added by the task that builds it. */
export const COMMANDS: Record<string, Command> = {};

/** Run the CLI with these arguments and return the exit code. src/index.ts calls it with process.argv. */
export async function runCli(argv: string[], out: Out, commands: Record<string, Command> = COMMANDS): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    out.log(usage(commands));
    return 0;
  }
  if (name === '--version' || name === '-v') {
    out.log(CLI_VERSION);
    return 0;
  }
  const command = commands[name];
  if (!command) {
    out.error(`Unknown command: ${name}\n`);
    out.error(usage(commands));
    return 2;
  }
  try {
    return (await command.run(args, out)) ?? 0;
  } catch (err) {
    // A CliError is a message for the person; anything else is a bug, so show where it happened.
    out.error(err instanceof CliError ? err.message : `Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return 1;
  }
}

export function usage(commands: Record<string, Command>): string {
  const width = Math.max(0, ...Object.values(commands).map((c) => c.usage.length));
  return [
    `${BRAND.name}: your own AI agent reviews your teammates' pull requests, and theirs reviews yours.`,
    '',
    `Usage: ${BRAND.cli} <command>`,
    '',
    ...Object.values(commands).map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`),
    '',
    `  ${BRAND.cli} --version`,
  ].join('\n');
}
```

`apps/cli/src/index.ts`:
```ts
#!/usr/bin/env node
import { runCli } from './cli';
import { terminal } from './out';

// The `nitpilot` binary. Everything lives in cli.ts, so tests can run the CLI without starting a process.
process.exitCode = await runCli(process.argv.slice(2), terminal);
```

- [x] **Step 9: Write the personal config**

`apps/cli/src/config/config.ts`:
```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentId, BRAND } from '@nitpilot/protocol';
import { z } from 'zod';
import { CliError } from '../errors';

/** The hosted instance (Plan 3). For another server, set NITPILOT_SERVER or "server" in the file. */
export const DEFAULT_SERVER = 'https://nitpilot.dev';

const ENV = {
  configDir: `${BRAND.envPrefix}CONFIG_DIR`,
  server: `${BRAND.envPrefix}SERVER`,
  token: `${BRAND.envPrefix}TOKEN`,
} as const;

type Env = Record<string, string | undefined>;

/** One linked clone (spec §13): where it is, how to prepare a fresh checkout, and which checks the agent may run. */
const RepoConfig = z.object({
  path: z.string().min(1),
  setup: z.array(z.string()).min(1).optional(),
  checks: z.record(z.string(), z.array(z.string()).min(1)).optional(),
});

/** config.json (spec §13). Every field has a default, so a missing or empty file is valid. */
export const PersonalConfigSchema = z.object({
  server: z.url({ protocol: /^https?$/ }).default(DEFAULT_SERVER),
  token: z.string().startsWith(BRAND.tokenPrefix).nullable().default(null),
  agent: AgentId.default('claude-code'),
  /** Defaults for new chats. Ignored in Plan 1, where Auto is always on. */
  auto: z.object({ review: z.boolean(), address: z.boolean() }).default({ review: true, address: true }),
  concurrency: z.number().int().min(1).max(4).default(1),
  jobTimeoutMinutes: z.number().int().min(1).max(120).default(15),
  dailyJobCap: z.number().int().min(1).default(40),
  /** Let Claude Code bill your API key. Off: ANTHROPIC_API_KEY never reaches the agent (spec §12.2). */
  apiBilling: z.boolean().default(false),
  /** Linked clones, keyed `owner/name`. */
  repos: z.record(z.string(), RepoConfig).default({}),
});
export type PersonalConfig = z.infer<typeof PersonalConfigSchema>;

/** Where the config lives: $NITPILOT_CONFIG_DIR, else $XDG_CONFIG_HOME/nitpilot, else ~/.config/nitpilot. */
export function configDir(env: Env = process.env): string {
  const own = env[ENV.configDir];
  if (own) return own;
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), BRAND.configDirName);
}

export function configPath(dir: string): string {
  return join(dir, 'config.json');
}

/** The settings in effect: the file, with NITPILOT_SERVER and NITPILOT_TOKEN winning one field at a time. */
export function loadConfig(opts: { env?: Env; dir?: string } = {}): PersonalConfig {
  const env = opts.env ?? process.env;
  const dir = opts.dir ?? configDir(env);
  const raw = readRaw(configPath(dir));
  const server = env[ENV.server];
  const token = env[ENV.token];
  if (server) raw.server = server;
  if (token) raw.token = token;
  return parse(raw, `${configPath(dir)} (or ${ENV.server} / ${ENV.token})`);
}

/** The file alone, without the environment. Change what this returns and save it: no override ends up in the file. */
export function loadConfigFile(dir: string): PersonalConfig {
  return parse(readRaw(configPath(dir)), configPath(dir));
}

/** Save the config readable by you only (0600), even when the old file had looser permissions. */
export function saveConfig(cfg: PersonalConfig, dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configPath(dir);
  const tmp = `${path}.tmp`;
  // Write a new file, then swap it in: a crash halfway never leaves a half-written config behind.
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600); // mode only applies to new files; a leftover .tmp could have another one
  renameSync(tmp, path);
}

function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CliError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new CliError(`${path} must hold a JSON object.`);
  return json as Record<string, unknown>;
}

function parse(raw: Record<string, unknown>, where: string): PersonalConfig {
  const parsed = PersonalConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  throw new CliError(`Invalid setting "${issue.path.join('.') || '(the whole file)'}" in ${where}: ${issue.message}`);
}
```

- [x] **Step 10: Write the server client**

`apps/cli/src/http.ts`:
```ts
import { BRAND, CliLoginPollResponse, CliLoginStartResponse, MeResponse, MyChatsResponse } from '@nitpilot/protocol';
import type { z } from 'zod';
import { CliError } from './errors';
import { CLI_VERSION } from './version';

/** The server answered with an error, or couldn't be reached (status 0). */
export class ServerError extends CliError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

type CallOptions = { body?: unknown; auth?: boolean };

/** The Nitpilot server's REST API (spec §10). Every answer is checked against the protocol's schemas. */
export class ServerClient {
  constructor(
    readonly server: string,
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** `nitpilot login`, step 1: a code for the person and a secret for this device. */
  loginStart(deviceName: string) {
    return this.call('POST', '/api/cli/login', CliLoginStartResponse, { body: { deviceName } });
  }

  /** `nitpilot login`, step 3: pending, approved (with the token), denied or expired. */
  loginPoll(deviceCode: string) {
    return this.call('POST', '/api/cli/login/poll', CliLoginPollResponse, { body: { deviceCode } });
  }

  me() {
    return this.call('GET', '/api/me', MeResponse, { auth: true });
  }

  myChats() {
    return this.call('GET', '/api/me/chats', MyChatsResponse, { auth: true });
  }

  /** Sign this device out: the server revokes the token that sent the request. */
  async revoke(): Promise<void> {
    await this.send('DELETE', '/api/cli/token', { auth: true });
  }

  private async call<S extends z.ZodType>(method: string, path: string, schema: S, opts: CallOptions = {}): Promise<z.infer<S>> {
    const res = await this.send(method, path, opts);
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ServerError(res.status, `Unexpected answer from ${path}. Is ${this.server} a ${BRAND.name} server of the same version?`);
    return parsed.data;
  }

  private async send(method: string, path: string, opts: CallOptions): Promise<Response> {
    const headers: Record<string, string> = { 'user-agent': `${BRAND.userAgent}/${CLI_VERSION}` };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.auth) {
      if (!this.token) throw new CliError(`Not logged in. Run \`${BRAND.cli} login\`.`);
      headers.authorization = `Bearer ${this.token}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.server), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (err) {
      throw new ServerError(0, `Can't reach ${this.server}: ${(err as Error).message}`);
    }
    if (res.ok) return res;
    if (res.status === 401) throw new ServerError(401, `The server didn't accept this device's token. Run \`${BRAND.cli} login\`.`);
    throw new ServerError(res.status, `${await errorMessage(res)} (HTTP ${res.status})`);
  }
}

/** The message in the server's `{ error: { message } }` body, or the status text. */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? res.statusText;
}
```

- [x] **Step 11: Run them to see them pass**

Run: `npm test -w apps/cli && npm run typecheck -w apps/cli && npm run lint`
Expected: PASS (cli 5, config 8, http 7, build 1).

- [x] **Step 12: Explain the config file**

`docs/why/cli-config.md`:
```markdown
# Where the CLI keeps your settings (and your token)

**In one sentence:** `nitpilot` keeps one small JSON file per account, readable by you only, and environment variables can override two of its settings without touching it.

## The file (`apps/cli/src/config/config.ts`)

`~/.config/nitpilot/config.json` holds the server's address, this device's token from `nitpilot login`, which agent you use, your limits (`concurrency`, `jobTimeoutMinutes`, `dailyJobCap`) and your linked clones (`repos`). Every setting has a default (spec §13), so a missing file just means "all defaults". The file is checked with a zod schema when it's read; a typo gives an error that names the file and the setting.

## One folder per account

`NITPILOT_CONFIG_DIR` points the CLI at another folder. That's how one laptop runs two CLIs as two different GitHub accounts, which the live acceptance test needs (spec §17): `NITPILOT_CONFIG_DIR=~/.nitpilot-a nitpilot start` in one terminal, `~/.nitpilot-b` in another.

## 0600: readable by you only

The token is a password for your account, so the file gets Unix mode `0600`: the owner can read and write it, nobody else can even read it. (The three digits are owner / group / everyone; 6 means read + write, 0 means nothing.) Saving writes a new file and renames it over the old one: the rename is all-or-nothing, so a crash halfway never leaves half a config, and the new file is 0600 even if the old one wasn't.

## Environment overrides

`NITPILOT_SERVER` and `NITPILOT_TOKEN` win over the file, one setting at a time, like `.env.local` winning over `.env`. Commands that change the file read it *without* the overrides before saving, so an override never gets written into it by accident.

## One file to install

The published package is one bundled file, `dist/index.js` (`apps/cli/tsup.config.ts`). Our `@nitpilot/protocol` package isn't on npm, so tsup copies it (and zod) into the bundle, the way Vite bundles your app's imports into one script. `npx nitpilot` then downloads exactly one package.

## The React analogy

- The config file is `localStorage` for a terminal program, except we validate it on every read, like parsing an API response with zod before using it.
- Write-then-rename is the immutable update: build the new state completely, then swap it in, instead of editing the old one in place.
```

In `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §13, in the personal config example, replace:
```jsonc
  "dailyJobCap": 40,
```
with:
```jsonc
  "dailyJobCap": 40,
  "apiBilling": false,                        // true lets Claude Code use ANTHROPIC_API_KEY (§12.2)
```

- [x] **Step 13: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green: protocol 41, server unchanged, CLI 21.

- [x] **Step 14: Commit**

```bash
git add packages/protocol apps/server/src/chats/dispatch.db.test.ts apps/server/src/jobs/bundle.db.test.ts apps/server/src/ws/handlers.db.test.ts apps/cli package-lock.json docs/why/cli-config.md docs/superpowers/specs/2026-10-07-nitpilot-design.md docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents.md
git commit -m "feat(cli): command runner, personal config, server client and one-file build

The protocol's test samples move to their own entry, so the bundle never ships
them (Plan 1a deferred minor M8).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: `login`, `status`, `repos add`, `retry`

**Files:**
- Modify (server, Plan 1a carry-forwards):
  - `apps/server/src/engine/types.ts`, `apps/server/src/engine/decide.ts`, `apps/server/src/engine/results.ts`, `apps/server/src/engine/failures.test.ts` (the `retry_requested` event);
  - `apps/server/src/lib/rate-limit.ts`, `apps/server/src/lib/rate-limit.test.ts` (new);
  - `apps/server/src/http/errors.ts` (`rate_limited` → 429), `apps/server/src/http/routes/cli.ts` (retry route, rate-limited login starts), `apps/server/src/http/routes/cli.db.test.ts`;
  - `apps/server/src/http/app.ts`, `apps/server/test/app.ts`, `apps/server/src/main.ts` (the app gets `dispatch`);
  - `apps/server/src/ingest/record.ts`, `apps/server/src/ingest/process.db.test.ts` (purge old CLI login requests);
  - `packages/protocol/src/api.ts` (`RetryResponse`).
- Create (CLI): `apps/cli/src/git/remotes.ts`, `apps/cli/src/commands/login.ts`, `apps/cli/src/commands/status.ts`, `apps/cli/src/commands/repos.ts`, `apps/cli/src/commands/retry.ts`, a test for each, and `apps/cli/test/stub-server.ts`.
- Modify (CLI): `apps/cli/src/http.ts`, `apps/cli/src/http.test.ts` (`retry`), `apps/cli/src/cli.ts` (the four commands).
- Modify: `docs/why/cli-login.md` (limits and cleanup).

**Interfaces:**
- Consumes: `ServerClient`, `loadConfig`, `loadConfigFile`, `saveConfig`, `configDir`, `configPath`, `CliError`, `Out`, `recordOut`, `tempDir` (Task 5); `MyChat`, `Attention` (protocol); `Dispatch`, `DecideOutput` (Plan 1a); `startReview`, `advance` (engine).
- Produces:
  - engine event `{ type: 'retry_requested'; who: Person }` and `onRetryRequested(ctx, e)` (`engine/results.ts`);
  - `class RateLimiter(limit, windowMs, now?)` with `allow(key): boolean` (`lib/rate-limit.ts`);
  - `POST /api/chats/:id/retry` → `200 RetryResponse` (`{ status: 'queued' }`) or `409`; `AppDeps.dispatch: Dispatch`; `LOGIN_STARTS_PER_MINUTE = 10`;
  - `purgeOldRows()` → `{ rawEvents, seenComments, cliLoginRequests }`;
  - CLI: `login(deps)`, `status(deps)`, `reposAdd(path, deps)`, `retry(ref, deps)`, `parsePrRef(ref)`, `prUrl(chat)`, `openInBrowser(url)`; `parseGithubRemote(url) → 'owner/name' | null`, `gitTopLevel(path)`, `githubReposIn(clone)`, `githubReposInRemoteList(text)` (the parsing half, for Task 8's `doctor`); `ServerClient.retry(chatId)`;
  - test helpers `startStubServer(routes)` and `inTurn(...replies)` (`test/stub-server.ts`).

**Behavior:**
- **login** prints `To connect this device, enter WDJB-MJHT at https://…/cli/approve?code=WDJB-MJHT`, opens the browser (`open` / `xdg-open` through `execFile`; a failure is fine), waits `interval` seconds before each poll until approved, denied or expired, then saves the server and the token (0600) and prints the login it belongs to.
- **status** prints the login, a warning when GitHub access needs a new sign-in, and a table of open chats. For a chat whose attention is `failed` it prints `nitpilot retry https://github.com/<repo>/pull/<n>`.
- **repos add [path]** finds the clone's top folder (`git rev-parse --show-toplevel`) and links every GitHub repo its remotes point at (`origin`, `upstream`, …) to that folder, keeping any `setup` and `checks`. A fork clone links both the fork and the base repo; jobs come for the base repo.
- **retry <pr-url>** finds the chat among your open chats and asks the server to queue your failed job again. It also takes `owner/name#12`.
- **Server, retry:** allowed only when one of your roles in the chat is flagged `failed` *and* its newest job failed (a failed GitHub write is fixed by signing in again, not by re-running the agent). The engine clears the flag, starts a reviewer's review again (counting as "started by hand", so an outside contributor's PR doesn't stop it), or lets `advance` queue the author's address pass. `200 { status: 'queued' }` when a job was queued, else `409`.
- **Server, login starts:** at most 10 per minute per client address, counted in memory (one process, spec §7); the 11th gets `429 rate_limited`. Behind a reverse proxy (Plan 3) every request has the proxy's address; Plan 3 reads `X-Forwarded-For` from its own proxy.
- **Server, purge:** the hourly `purgeOldRows` also deletes CLI login requests older than a day (they expire after 10 minutes).

- [x] **Step 1: Write the failing engine tests**

In `apps/server/src/engine/failures.test.ts`, change the builders import to include `pointOf`:
```ts
import { T0, agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, pointOf, run, sam } from './test-builders';
```
add `import type { ChatState } from './types';` below the imports, and at the end of the file add:
```ts
describe('retry_requested', () => {
  /** leo's review failed for good. */
  const reviewFailed = (over: Partial<ChatState> = {}) =>
    agentToAgent({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { attention: 'failed' })], ...over });

  it("queues the reviewer's review again and clears the flag", () => {
    const out = run(reviewFailed(), { type: 'retry_requested', who: leo });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 'review', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('none');
    expect(out.chat.phase).toBe('reviewing');
  });

  it("queues the author's address pass again", () => {
    const chat = agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author', { attention: 'failed' }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo)],
    });
    const out = run(chat, { type: 'retry_requested', who: maya });
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address' })]);
  });

  it("starts the review on an outside contributor's PR too: asking again counts as starting it by hand", () => {
    const out = run(reviewFailed({ trusted: false }), { type: 'retry_requested', who: leo });
    expect(commandsOf(out, 'enqueue_job')).toHaveLength(1);
    expect(commandsOf(out, 'notify')).toEqual([]);
  });

  it('does nothing for someone with nothing failed, or on a closed PR', () => {
    expect(run(reviewFailed(), { type: 'retry_requested', who: maya }).commands).toEqual([]);
    expect(run(reviewFailed({ phase: 'closed', closed: true }), { type: 'retry_requested', who: leo }).commands).toEqual([]);
  });
});
```

- [x] **Step 2: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/engine/failures`
Expected: FAIL: `Unhandled event: {"type":"retry_requested",…}` from `decide()`'s exhaustive switch (typecheck would also reject the unknown event type).

- [x] **Step 3: Handle `retry_requested` in the engine**

In `apps/server/src/engine/types.ts`, in `DomainEvent`, after the `job_failed` line, add:
```ts
  | { type: 'retry_requested'; who: Person }
```

In `apps/server/src/engine/decide.ts`, change the results import to:
```ts
import { onJobCompleted, onJobFailed, onRetryRequested } from './results';
```
and after `case 'job_failed': onJobFailed(ctx, event); break;` add:
```ts
    case 'retry_requested': onRetryRequested(ctx, event); break;
```

In `apps/server/src/engine/results.ts`, after the `onJobFailed` function, add:
```ts
/**
 * A person asks to run their failed job again (`nitpilot retry`; Plan 2's Retry button). Only someone
 * flagged `failed` can. The job starts over as a new job, with a fresh count of attempts.
 */
export function onRetryRequested(ctx: Ctx, e: Ev<'retry_requested'>): void {
  const chat = ctx.chat;
  if (chat.phase === 'closed') return;
  const failed = chat.participants.filter((p) => p.githubId === e.who.githubId && p.attention === 'failed');
  if (failed.length === 0) return;
  system(ctx, `${e.who.login} asked their agent to try again`);
  for (const p of failed) {
    p.attention = 'none';
    // The person asked for it, so on an outside contributor's PR this counts as starting the review by hand.
    if (p.role === 'reviewer') startReview(ctx, p, { manual: true });
  }
  // The author's address pass (or anything else now due) is queued the usual way.
  advance(ctx);
}
```

- [x] **Step 4: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/engine && npm run typecheck -w apps/server`
Expected: PASS.

- [x] **Step 5: Write the failing server tests**

`apps/server/src/lib/rate-limit.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('allows `limit` requests in the window and refuses the next one', () => {
    const limiter = new RateLimiter(10, 60_000, () => 0);
    for (let i = 0; i < 10; i++) expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
  });

  it('counts each key on its own', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('5.6.7.8')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
  });

  it('allows again once the oldest request is out of the window', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    now = 59_999;
    expect(limiter.allow('1.2.3.4')).toBe(false);
    now = 60_001;
    expect(limiter.allow('1.2.3.4')).toBe(true);
  });
});
```

In `apps/server/src/http/routes/cli.db.test.ts`:
- change the `test/db` import to `import { makeChat, makeCliToken, makeRepo, makeUser, personOf } from '../../../test/db';`
- add `import { Dispatcher } from '../../chats/dispatch';`
- inside `describe('nitpilot login', …)`, after the last test, add:
```ts
  it('lets one address start 10 logins a minute, then answers 429', async () => {
    const server = app(); // one app: the count lives in the running server
    const start = () => server.request('/api/cli/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceName: 'laptop' }) });
    for (let i = 0; i < 10; i++) expect((await start()).status).toBe(200);
    const res = await start();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });
```
- at the end of the file, add:
```ts
describe('POST /api/chats/:id/retry', () => {
  /** leo's review of maya's PR failed for good. */
  async function failedReview() {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
    const review = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } });
    await prisma.job.update({ where: { id: review.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: review.id, attempt: 1, reason: 'auth', retryable: false });
    const server = testApp({ github: new GithubClient(fakeFetch({})), dispatch: dispatcher.dispatch });
    const retry = (token: string) => server.request(`/api/chats/${chat.id}/retry`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    return { chat, leo, retry, leoToken: (await makeCliToken(leo.id)).raw, mayaToken: (await makeCliToken(maya.id)).raw };
  }

  it("queues leo's failed review again and clears his failed flag", async () => {
    const { chat, leo, retry, leoToken } = await failedReview();
    const res = await retry(leoToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'queued' });
    const jobs = await prisma.job.findMany({ where: { chatId: chat.id }, orderBy: { createdAt: 'asc' } });
    expect(jobs.map((j) => [j.type, j.status])).toEqual([
      ['review', 'failed'],
      ['review', 'queued'],
    ]);
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, githubId: leo.githubId } })).toMatchObject({ attention: 'none' });
  });

  it('refuses when nothing of yours failed there: the author, or leo once his job is queued again', async () => {
    const { retry, leoToken, mayaToken } = await failedReview();
    const asMaya = await retry(mayaToken);
    expect(asMaya.status).toBe(409);
    expect(await asMaya.json()).toMatchObject({ error: { code: 'conflict', message: 'Nothing of yours failed on this PR.' } });
    expect((await retry(leoToken)).status).toBe(200);
    expect((await retry(leoToken)).status).toBe(409);
  });

  it('needs a CLI token', async () => {
    const { chat } = await failedReview();
    expect((await app().request(`/api/chats/${chat.id}/retry`, { method: 'POST' })).status).toBe(401);
  });
});
```

In `apps/server/src/ingest/process.db.test.ts`:
- add `import { startCliLogin } from '../auth/cli-login';`
- in `describe('purgeOldRows', …)`, change `expect(await purgeOldRows()).toEqual({ rawEvents: 1, seenComments: 0 });` to:
```ts
    expect(await purgeOldRows()).toEqual({ rawEvents: 1, seenComments: 0, cliLoginRequests: 0 });
```
- and add, after that test:
```ts
  it('deletes CLI login requests older than a day', async () => {
    const old = await startCliLogin('old laptop');
    await prisma.cliLoginRequest.update({ where: { userCode: old.userCode }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    await startCliLogin('new laptop');
    expect(await purgeOldRows()).toMatchObject({ cliLoginRequests: 1 });
    expect(await prisma.cliLoginRequest.count()).toBe(1);
  });
```

- [x] **Step 6: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/lib/rate-limit && npm run test:db -w apps/server -- src/http/routes/cli src/ingest/process`
Expected: FAIL. `rate-limit.test.ts`: `Failed to resolve import "./rate-limit"`. `cli.db.test.ts`: the 11th login start gets 200, not 429, and the retry route answers 404. `process.db.test.ts`: `cliLoginRequests` is missing from the result.

- [x] **Step 7: Rate-limit login starts, add the retry route, purge old login requests**

`apps/server/src/lib/rate-limit.ts`:
```ts
/**
 * Counts requests per key (a client address, say) and says no once `limit` of them came in during the
 * last `windowMs`. In memory, which is enough for one server process (spec §7). See docs/why/cli-login.md.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Count one request for `key`. False means too many: refuse it. */
  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.forgetIdle(now);
    return true;
  }

  /** Forget keys with nothing recent, so addresses seen once don't pile up forever. */
  private forgetIdle(now: number): void {
    if (this.hits.size < 1_000) return;
    for (const [key, times] of this.hits) {
      if (times.every((at) => at <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}
```

In `apps/server/src/http/errors.ts`, add `| 'rate_limited'` to `ErrorCode` (after `'payload_too_large'`) and `rate_limited: 429,` to `STATUS` (after `payload_too_large: 413,`).

In `packages/protocol/src/api.ts`, at the end, add:
```ts
// `nitpilot retry`
export const RetryResponse = z.object({ status: z.literal('queued') });
export type RetryResponse = z.infer<typeof RetryResponse>;
```

Replace `apps/server/src/http/routes/cli.ts` with:
```ts
import type { IncomingMessage } from 'node:http';
import {
  CliLoginPollRequest, CliLoginStartRequest,
  type Attention, type MeResponse, type MyChat, type MyChatsResponse, type Phase, type RetryResponse, type Role,
} from '@nitpilot/protocol';
import { Hono, type Context } from 'hono';
import { LOGIN_TTL_MS, POLL_INTERVAL_SEC, pollCliLogin, startCliLogin } from '../../auth/cli-login';
import { requireCliToken, type CliAuth } from '../../auth/cli-token';
import type { Dispatch } from '../../chats/dispatch';
import type { Person } from '../../engine/types';
import { getEnv } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { RateLimiter } from '../../lib/rate-limit';
import { transcriptUrl } from '../../lib/urls';
import { HttpError } from '../errors';

/** Each login start writes a row, so one address may start at most this many a minute (spec §14). */
export const LOGIN_STARTS_PER_MINUTE = 10;

export function cliRoutes(deps: { dispatch: Dispatch }): Hono<{ Variables: { cli: CliAuth } }> {
  const app = new Hono<{ Variables: { cli: CliAuth } }>();
  const loginStarts = new RateLimiter(LOGIN_STARTS_PER_MINUTE, 60_000);

  app.post('/api/cli/login', async (c) => {
    if (!loginStarts.allow(clientAddress(c))) throw new HttpError('rate_limited', 'Too many logins started from here. Wait a minute and try again.');
    const { deviceName } = CliLoginStartRequest.parse(await c.req.json());
    const login = await startCliLogin(deviceName);
    return c.json({
      deviceCode: login.deviceCode,
      userCode: login.userCode,
      verifyUrl: `${getEnv().PUBLIC_URL}/cli/approve?code=${login.userCode}`,
      interval: POLL_INTERVAL_SEC,
      expiresIn: LOGIN_TTL_MS / 1000,
    });
  });

  app.post('/api/cli/login/poll', async (c) => {
    const { deviceCode } = CliLoginPollRequest.parse(await c.req.json());
    return c.json(await pollCliLogin(deviceCode));
  });

  app.get('/api/me', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId }, include: { githubAuth: true } });
    const body: MeResponse = { login: user.login, avatarUrl: user.avatarUrl, githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth' };
    return c.json(body);
  });

  app.get('/api/me/chats', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId } });
    const rows = await prisma.participant.findMany({
      where: { githubId: user.githubId, chat: { closedAt: null } },
      include: { chat: { include: { repo: true } } },
      orderBy: { chat: { updatedAt: 'desc' } },
      take: 100,
    });
    const chats: MyChat[] = rows.map((p) => ({
      id: p.chat.id,
      repo: p.chat.repo.fullName,
      number: p.chat.number,
      title: p.chat.title,
      role: p.role as Role,
      phase: p.chat.phase as Phase,
      round: p.chat.round,
      attention: p.attention as Attention,
      url: transcriptUrl(p.chat.repo.fullName, p.chat.number),
      updatedAt: p.chat.updatedAt.toISOString(),
    }));
    const body: MyChatsResponse = { chats };
    return c.json(body);
  });

  app.delete('/api/cli/token', requireCliToken, async (c) => {
    await prisma.cliToken.update({ where: { id: c.get('cli').tokenId }, data: { revokedAt: new Date() } });
    return c.body(null, 204);
  });

  // `nitpilot retry` (spec §10): run my failed job on this PR again. Plan 2's Retry button uses it too.
  app.post('/api/chats/:id/retry', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId } });
    const chatId = c.req.param('id');
    if (!(await newestJobFailed(chatId, user.githubId))) throw new HttpError('conflict', 'Nothing of yours failed on this PR.');
    const who: Person = { githubId: user.githubId, login: user.login, isBot: false, userId: user.id };
    const out = await deps.dispatch(chatId, { type: 'retry_requested', who });
    const queued = out.commands.some((cmd) => cmd.type === 'enqueue_job' && cmd.participant.githubId === user.githubId);
    if (!queued) throw new HttpError('conflict', 'Nothing was queued: the PR may be closed, or your agent runs once the current step finishes.');
    const body: RetryResponse = { status: 'queued' };
    return c.json(body);
  });

  return app;
}

/**
 * True when one of this person's roles in the chat is flagged `failed` because its newest job failed.
 * A flag from a GitHub write that failed (spec §15) is fixed by signing in again, not by re-running the agent.
 */
async function newestJobFailed(chatId: string, githubId: string): Promise<boolean> {
  const flagged = await prisma.participant.findMany({ where: { chatId, githubId, attention: 'failed' }, select: { id: true } });
  for (const p of flagged) {
    const newest = await prisma.job.findFirst({ where: { participantId: p.id }, orderBy: { createdAt: 'desc' }, select: { status: true } });
    if (newest?.status === 'failed') return true;
  }
  return false;
}

/**
 * The address a request came from: Hono's Node adapter puts the raw request in `c.env.incoming`.
 * Tests call the app without a socket ('unknown'). Behind a reverse proxy (Plan 3) this is the
 * proxy's address, until we read X-Forwarded-For from it.
 */
function clientAddress(c: Context): string {
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return incoming?.socket.remoteAddress ?? 'unknown';
}
```

In `apps/server/src/http/app.ts`:
- add `import type { Dispatch } from '../chats/dispatch';`
- replace `export type AppDeps = { github: GithubClient; appAuth: AppAuth; ingest: Ingest };` with:
```ts
export type AppDeps = { github: GithubClient; appAuth: AppAuth; ingest: Ingest; dispatch: Dispatch };
```
- replace `app.route('/', cliRoutes());` with `app.route('/', cliRoutes(deps));`

In `apps/server/test/app.ts`:
- add `import { Dispatcher } from '../src/chats/dispatch';`
- in `testDeps`, after the `ingest:` line, add:
```ts
    dispatch: new Dispatcher().dispatch,
```

In `apps/server/src/main.ts`, replace `const app = createApp({ github, appAuth, ingest });` with:
```ts
  const app = createApp({ github, appAuth, ingest, dispatch: dispatcher.dispatch });
```

In `apps/server/src/ingest/record.ts`, replace:
```ts
const KEEP_MS = 14 * 86_400_000;

/** Raw deliveries and seen comment ids are kept 14 days (spec §8). */
export async function purgeOldRows(now = new Date()): Promise<{ rawEvents: number; seenComments: number }> {
  const before = new Date(now.getTime() - KEEP_MS);
  const rawEvents = await prisma.rawEvent.deleteMany({ where: { createdAt: { lt: before } } });
  const seenComments = await prisma.seenComment.deleteMany({ where: { createdAt: { lt: before } } });
  return { rawEvents: rawEvents.count, seenComments: seenComments.count };
}
```
with:
```ts
const KEEP_MS = 14 * 86_400_000;
const LOGIN_KEEP_MS = 86_400_000;

/**
 * Raw deliveries and seen comment ids are kept 14 days (spec §8). CLI login requests are kept a day:
 * each one expires after 10 minutes anyway (spec §14).
 */
export async function purgeOldRows(now = new Date()): Promise<{ rawEvents: number; seenComments: number; cliLoginRequests: number }> {
  const before = new Date(now.getTime() - KEEP_MS);
  const rawEvents = await prisma.rawEvent.deleteMany({ where: { createdAt: { lt: before } } });
  const seenComments = await prisma.seenComment.deleteMany({ where: { createdAt: { lt: before } } });
  const cliLoginRequests = await prisma.cliLoginRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - LOGIN_KEEP_MS) } } });
  return { rawEvents: rawEvents.count, seenComments: seenComments.count, cliLoginRequests: cliLoginRequests.count };
}
```

- [x] **Step 8: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/lib/rate-limit src/engine && npm run test:db -w apps/server -- src/http src/ingest && npm run typecheck -w apps/server`
Expected: PASS (rate-limit 3; cli.db adds 4; process.db adds 1).

- [x] **Step 9: Write the failing CLI tests**

`apps/cli/test/stub-server.ts`:
```ts
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export type StubReply = { status?: number; body?: unknown };
export type StubRequest = { method: string; path: string; authorization: string | undefined; body: unknown };
/** What a route answers: always the same reply, or a function of the request. */
export type StubRoute = StubReply | ((req: StubRequest) => StubReply);
/** Keyed `METHOD /path`, e.g. `'POST /api/cli/login'`. */
export type StubRoutes = Record<string, StubRoute>;

/**
 * A pretend Nitpilot server on a random local port, for CLI tests: each test says what every route
 * answers, and `requests` records what the CLI sent. Unknown routes answer 404.
 */
export async function startStubServer(routes: StubRoutes) {
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    void readBody(req).then((text) => {
      const request: StubRequest = {
        method: req.method ?? 'GET',
        path: new URL(req.url ?? '/', 'http://stub').pathname,
        authorization: req.headers.authorization,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(request);
      const route = routes[`${request.method} ${request.path}`] ?? { status: 404, body: { error: { code: 'not_found', message: 'no such route' } } };
      const reply = typeof route === 'function' ? route(request) : route;
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
      res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    requests,
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A route that gives each reply in turn, then keeps repeating the last: pending, pending, approved. */
export function inTurn(...replies: StubReply[]): StubRoute {
  let next = 0;
  return () => replies[Math.min(next++, replies.length - 1)]!;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => resolve(text));
  });
}
```

`apps/cli/src/git/remotes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseGithubRemote } from './remotes';

describe('parseGithubRemote', () => {
  it.each([
    ['https://github.com/octo/sandbox.git', 'octo/sandbox'],
    ['https://github.com/octo/sandbox', 'octo/sandbox'],
    ['https://github.com/octo/sandbox/', 'octo/sandbox'],
    ['https://maya:secret@github.com/octo/sandbox.git', 'octo/sandbox'],
    ['git@github.com:octo/sandbox.git', 'octo/sandbox'],
    ['git@github.com:octo-org/my.repo.git', 'octo-org/my.repo'],
    ['ssh://git@github.com/octo/sandbox.git', 'octo/sandbox'],
    ['ssh://git@github.com:22/octo/sandbox.git', 'octo/sandbox'],
    // An SSH host alias from ~/.ssh/config, used to run two GitHub accounts on one machine (spec §17).
    ['git@github-a:octo/sandbox.git', 'octo/sandbox'],
    ['git@gitlab.com:octo/sandbox.git', null],
    ['https://gitlab.com/octo/sandbox.git', null],
    ['https://localhost/octo/sandbox', null],
    ['/srv/git/sandbox.git', null],
    ['https://github.com/octo', null],
  ])('%s → %s', (url, expected) => {
    expect(parseGithubRemote(url)).toBe(expected);
  });
});
```

`apps/cli/src/commands/login.test.ts`:
```ts
import { statSync } from 'node:fs';
import { describe, expect, it, onTestFinished } from 'vitest';
import { recordOut } from '../../test/out';
import { inTurn, startStubServer, type StubReply } from '../../test/stub-server';
import { tempDir } from '../../test/temp';
import { configPath, loadConfigFile, saveConfig } from '../config/config';
import { login } from './login';

const START = { deviceCode: 'device-secret', userCode: 'WDJB-MJHT', verifyUrl: 'http://nitpilot.test/cli/approve?code=WDJB-MJHT', interval: 2, expiresIn: 600 };
const pending: StubReply = { body: { status: 'pending' } };
const approved: StubReply = { body: { status: 'approved', token: 'nit_newtoken' } };
const noBrowser = async () => {};
const noWait = async () => {};

/** A server whose polls answer `polls` in turn, and an empty config folder. */
async function setup(...polls: StubReply[]) {
  const stub = await startStubServer({
    'POST /api/cli/login': { body: START },
    'POST /api/cli/login/poll': inTurn(...polls),
    'GET /api/me': { body: { login: 'maya', avatarUrl: null, githubAuth: 'ok' } },
  });
  onTestFinished(() => stub.close());
  const dir = tempDir();
  return { stub, dir, env: { NITPILOT_CONFIG_DIR: dir, NITPILOT_SERVER: stub.url } };
}

describe('nitpilot login', () => {
  it('shows the code, opens the browser, waits for approval and saves the token', async () => {
    const { stub, dir, env } = await setup(pending, approved);
    const out = recordOut();
    const opened: string[] = [];
    const waits: number[] = [];
    await login({ env, out, open: async (url) => void opened.push(url), sleep: async (ms) => void waits.push(ms) });

    expect(out.lines[0]).toBe('To connect this device, enter WDJB-MJHT at http://nitpilot.test/cli/approve?code=WDJB-MJHT');
    expect(opened).toEqual([START.verifyUrl]);
    expect(waits).toEqual([2_000, 2_000]); // `interval` seconds before each poll
    expect(loadConfigFile(dir)).toMatchObject({ server: stub.url, token: 'nit_newtoken' });
    expect(statSync(configPath(dir)).mode & 0o777).toBe(0o600);
    expect(stub.requests.find((r) => r.path === '/api/me')?.authorization).toBe('Bearer nit_newtoken');
    expect(out.text()).toContain('Logged in as maya.');
  });

  it('keeps the rest of the config file when it saves the token', async () => {
    const { dir, env } = await setup(approved);
    saveConfig({ ...loadConfigFile(dir), repos: { 'acme/shop-api': { path: '/code/shop-api' } } }, dir);
    await login({ env, out: recordOut(), open: noBrowser, sleep: noWait });
    expect(loadConfigFile(dir).repos).toEqual({ 'acme/shop-api': { path: '/code/shop-api' } });
  });

  it('stops with a clear message when the login is denied, and saves nothing', async () => {
    const { dir, env } = await setup(pending, { body: { status: 'denied' } });
    await expect(login({ env, out: recordOut(), open: noBrowser, sleep: noWait })).rejects.toThrow('The login was denied in the browser.');
    expect(loadConfigFile(dir).token).toBeNull();
  });

  it('says to start over when the code expired', async () => {
    const { env } = await setup({ body: { status: 'expired' } });
    await expect(login({ env, out: recordOut(), open: noBrowser, sleep: noWait })).rejects.toThrow('The code expired. Run `nitpilot login` again.');
  });
});
```

`apps/cli/src/commands/status.test.ts`:
```ts
import type { MyChat } from '@nitpilot/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { recordOut } from '../../test/out';
import { startStubServer } from '../../test/stub-server';
import { tempDir } from '../../test/temp';
import { status } from './status';

const chat = (over: Partial<MyChat> = {}): MyChat => ({
  id: 'chat_1',
  repo: 'acme/shop-api',
  number: 142,
  title: 'Cursor pagination for orders',
  role: 'reviewer',
  phase: 'reviewing',
  round: 1,
  attention: 'none',
  url: 'http://nitpilot.test/c/acme/shop-api/142',
  updatedAt: '2026-10-10T08:00:00.000Z',
  ...over,
});

/** Run `nitpilot status` against a server that answers with this account and these chats. */
async function run(githubAuth: 'ok' | 'needs_reauth', chats: MyChat[], token: string | null = 'nit_abc') {
  const stub = await startStubServer({
    'GET /api/me': { body: { login: 'maya', avatarUrl: null, githubAuth } },
    'GET /api/me/chats': { body: { chats } },
  });
  onTestFinished(() => stub.close());
  const out = recordOut();
  const env = { NITPILOT_CONFIG_DIR: tempDir(), NITPILOT_SERVER: stub.url, ...(token ? { NITPILOT_TOKEN: token } : {}) };
  await status({ env, out });
  return { out, stub };
}

describe('nitpilot status', () => {
  it('shows who you are and one line per open PR', async () => {
    const { out, stub } = await run('ok', [chat(), chat({ id: 'chat_2', number: 7, role: 'author', phase: 'addressing', round: 2 })]);
    expect(out.lines[0]).toBe(`Logged in as maya on ${stub.url}`);
    expect(out.text()).toMatch(/PR\s+ROLE\s+PHASE\s+ROUND\s+NEEDS YOU\s+TITLE/);
    expect(out.text()).toMatch(/acme\/shop-api#142\s+reviewer\s+reviewing\s+1\s+Cursor pagination for orders/);
    expect(out.text()).toMatch(/acme\/shop-api#7\s+author\s+addressing\s+2/);
  });

  it('warns when GitHub access needs a new sign-in', async () => {
    const { out, stub } = await run('needs_reauth', []);
    expect(out.text()).toContain(`! GitHub access expired. Sign in again at ${stub.url}/`);
  });

  it('suggests `nitpilot retry` for a PR where your agent failed', async () => {
    const { out } = await run('ok', [chat({ attention: 'failed' })]);
    expect(out.text()).toContain('agent failed');
    expect(out.text()).toContain('To run it again: nitpilot retry https://github.com/acme/shop-api/pull/142');
  });

  it('says so when there are no PRs yet', async () => {
    const { out } = await run('ok', []);
    expect(out.text()).toContain('No open PRs with Nitpilot yet.');
  });

  it('asks you to log in first', async () => {
    await expect(run('ok', [], null)).rejects.toThrow('Not logged in');
  });
});
```

`apps/cli/src/commands/repos.test.ts`:
```ts
import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { recordOut } from '../../test/out';
import { tempDir } from '../../test/temp';
import { loadConfigFile, saveConfig } from '../config/config';
import { reposAdd } from './repos';

const run = promisify(execFile);

/** A new git clone with these remotes. realpath: macOS's temp folder is a symlink, and git reports the real path. */
async function cloneWith(remotes: Record<string, string>): Promise<string> {
  const dir = realpathSync(tempDir());
  await run('git', ['-C', dir, 'init', '-q']);
  for (const [name, url] of Object.entries(remotes)) await run('git', ['-C', dir, 'remote', 'add', name, url]);
  return dir;
}

describe('nitpilot repos add', () => {
  it('links the clone to every GitHub repo its remotes point at', async () => {
    const clone = await cloneWith({ origin: 'git@github.com:maya/shop-api.git', upstream: 'https://github.com/acme/shop-api.git' });
    const dir = tempDir();
    const out = recordOut();
    await reposAdd(clone, { env: { NITPILOT_CONFIG_DIR: dir }, out });
    expect(loadConfigFile(dir).repos).toEqual({ 'maya/shop-api': { path: clone }, 'acme/shop-api': { path: clone } });
    expect(out.lines).toContain(`Linked acme/shop-api → ${clone}`);
  });

  it("works from a folder inside the clone, and keeps the repo's setup and checks", async () => {
    const clone = await cloneWith({ origin: 'https://github.com/acme/shop-api.git' });
    mkdirSync(join(clone, 'src'));
    const dir = tempDir();
    saveConfig({ ...loadConfigFile(dir), repos: { 'acme/shop-api': { path: '/old/place', setup: ['npm', 'ci'] } } }, dir);
    await reposAdd(join(clone, 'src'), { env: { NITPILOT_CONFIG_DIR: dir }, out: recordOut() });
    expect(loadConfigFile(dir).repos['acme/shop-api']).toEqual({ path: clone, setup: ['npm', 'ci'] });
  });

  it('explains when the folder is not a git clone', async () => {
    await expect(reposAdd(tempDir(), { env: { NITPILOT_CONFIG_DIR: tempDir() }, out: recordOut() })).rejects.toThrow('is not inside a git clone');
  });

  it('explains when no remote is on GitHub', async () => {
    const clone = await cloneWith({ origin: 'git@gitlab.com:acme/shop-api.git' });
    await expect(reposAdd(clone, { env: { NITPILOT_CONFIG_DIR: tempDir() }, out: recordOut() })).rejects.toThrow('has no GitHub remote');
  });
});
```

`apps/cli/src/commands/retry.test.ts`:
```ts
import type { MyChat } from '@nitpilot/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { recordOut } from '../../test/out';
import { startStubServer, type StubReply } from '../../test/stub-server';
import { tempDir } from '../../test/temp';
import { parsePrRef, retry } from './retry';

const failedChat: MyChat = {
  id: 'chat_1',
  repo: 'acme/shop-api',
  number: 142,
  title: 'Cursor pagination for orders',
  role: 'reviewer',
  phase: 'reviewing',
  round: 1,
  attention: 'failed',
  url: 'http://nitpilot.test/c/acme/shop-api/142',
  updatedAt: '2026-10-10T08:00:00.000Z',
};

async function setup(retryReply: StubReply = { body: { status: 'queued' } }) {
  const stub = await startStubServer({
    'GET /api/me/chats': { body: { chats: [failedChat] } },
    'POST /api/chats/chat_1/retry': retryReply,
  });
  onTestFinished(() => stub.close());
  return { stub, env: { NITPILOT_CONFIG_DIR: tempDir(), NITPILOT_SERVER: stub.url, NITPILOT_TOKEN: 'nit_abc' } };
}

describe('nitpilot retry', () => {
  it("finds the PR's chat and asks the server to queue your job again", async () => {
    const { stub, env } = await setup();
    const out = recordOut();
    await retry('https://github.com/acme/shop-api/pull/142', { env, out });
    expect(stub.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/chats/chat_1/retry', authorization: 'Bearer nit_abc' });
    expect(out.lines[0]).toContain('Queued your agent again on acme/shop-api#142.');
  });

  it("passes on the server's answer when there is nothing to retry", async () => {
    const { env } = await setup({ status: 409, body: { error: { code: 'conflict', message: 'Nothing of yours failed on this PR.' } } });
    await expect(retry('acme/shop-api#142', { env, out: recordOut() })).rejects.toThrow('Nothing of yours failed on this PR.');
  });

  it("refuses a PR you're not part of", async () => {
    const { env } = await setup();
    await expect(retry('acme/shop-api#999', { env, out: recordOut() })).rejects.toThrow("You're not part of an open Nitpilot chat on acme/shop-api#999.");
  });

  it('explains the usage when it cannot read the PR', async () => {
    const { env } = await setup();
    await expect(retry('shop-api 142', { env, out: recordOut() })).rejects.toThrow('Usage: nitpilot retry <pr-url>');
  });

  it('reads PR links and the short owner/name#number form', () => {
    expect(parsePrRef('https://github.com/acme/shop-api/pull/142')).toEqual({ repo: 'acme/shop-api', number: 142 });
    expect(parsePrRef('https://github.com/acme/shop-api/pull/142/files')).toEqual({ repo: 'acme/shop-api', number: 142 });
    expect(parsePrRef('acme/shop-api#142')).toEqual({ repo: 'acme/shop-api', number: 142 });
    expect(parsePrRef('https://gitlab.com/acme/shop-api/pull/142')).toBeNull();
  });
});
```

In `apps/cli/src/http.test.ts`, inside `describe('ServerClient', …)`, add:
```ts
  it("asks the server to queue a chat's failed job again", async () => {
    const fetch = fakeFetch(() => json({ status: 'queued' }));
    expect(await new ServerClient(SERVER, 'nit_abc', fetch).retry('chat_1')).toEqual({ status: 'queued' });
    expect(fetch.calls[0]!.url.pathname).toBe('/api/chats/chat_1/retry');
    expect(fetch.calls[0]!.init.method).toBe('POST');
  });
```

- [x] **Step 10: Run them to see them fail**

Run: `npm test -w apps/cli`
Expected: FAIL: `Failed to resolve import "./remotes"` (and `./login`, `./status`, `./repos`, `./retry`); in `http.test.ts`, `retry is not a function`.

- [x] **Step 11: Write the git helpers and the four commands**

`apps/cli/src/git/remotes.ts`:
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliError } from '../errors';

const run = promisify(execFile);

/**
 * `owner/name` for a GitHub remote URL, or null for anything else. Understands https, ssh:// and the
 * short `git@host:owner/name.git` form. Over SSH the host may also be an alias without a dot, like the
 * `github-a` and `github-b` aliases used to run two GitHub accounts on one machine (spec §17).
 */
export function parseGithubRemote(url: string): string | null {
  const path = githubPath(url.trim());
  const m = path ? /^\/?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(path) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The path part of a remote URL (`owner/name.git`) when its host is GitHub, else null. */
function githubPath(url: string): string | null {
  const short = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(url); // git@github.com:owner/name.git
  if (short) return isGithubHost(short[1]!, { sshAlias: true }) ? short[2]! : null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // a local path, for example
  }
  if (parsed.protocol === 'ssh:') return isGithubHost(parsed.hostname, { sshAlias: true }) ? parsed.pathname : null;
  if (['https:', 'http:', 'git:'].includes(parsed.protocol)) return isGithubHost(parsed.hostname, { sshAlias: false }) ? parsed.pathname : null;
  return null;
}

function isGithubHost(host: string, opts: { sshAlias: boolean }): boolean {
  return host === 'github.com' || (opts.sshAlias && !host.includes('.'));
}

/** The top folder of the git clone that contains `path`. */
export async function gitTopLevel(path: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', path, 'rev-parse', '--show-toplevel']);
    return stdout.trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new CliError('git is not installed (or not on your PATH).');
    throw new CliError(`${path} is not inside a git clone. Run this in a clone, or pass the clone's path.`);
  }
}

/** The GitHub repos a clone's remotes point at (origin, upstream, …), each listed once. */
export async function githubReposIn(clone: string): Promise<string[]> {
  const { stdout } = await run('git', ['-C', clone, 'remote', '-v']);
  return githubReposInRemoteList(stdout);
}

/** The GitHub repos in `git remote -v` output, each listed once. */
export function githubReposInRemoteList(text: string): string[] {
  // Each line looks like: origin<TAB>git@github.com:octo/sandbox.git (fetch)
  const names = text
    .split('\n')
    .map((line) => line.split(/\s+/)[1])
    .filter((url): url is string => Boolean(url))
    .map((url) => parseGithubRemote(url))
    .filter((name): name is string => name !== null);
  return [...new Set(names)];
}
```
These run git in the person's own clone for two read-only questions (`rev-parse`, `remote -v`), which run no hooks. Every git call on a PR's code goes through `safeGit` (Task 9).

`apps/cli/src/commands/login.ts`:
```ts
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { BRAND } from '@nitpilot/protocol';
import { configDir, configPath, loadConfig, loadConfigFile, saveConfig } from '../config/config';
import { CliError } from '../errors';
import { ServerClient } from '../http';
import { terminal, type Out } from '../out';

export type LoginDeps = {
  env?: Record<string, string | undefined>;
  out?: Out;
  /** Opens the approval page. The default asks the OS; the URL is printed either way. */
  open?: (url: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
};

/**
 * `nitpilot login` (spec §10 "CLI login"): get a code, let the person approve it in the browser, keep
 * the token. See docs/why/cli-login.md.
 */
export async function login(deps: LoginDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? terminal;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const dir = configDir(env);
  const { server } = loadConfig({ env, dir });
  const client = new ServerClient(server, null, deps.fetch);

  const start = await client.loginStart(deviceName());
  out.log(`To connect this device, enter ${start.userCode} at ${start.verifyUrl}`);
  await (deps.open ?? openInBrowser)(start.verifyUrl);
  out.log('Waiting for you to approve it in the browser… (Ctrl-C cancels)');

  for (;;) {
    await sleep(start.interval * 1000);
    const poll = await client.loginPoll(start.deviceCode);
    if (poll.status === 'pending') continue;
    if (poll.status === 'denied') throw new CliError('The login was denied in the browser.');
    if (poll.status === 'expired') throw new CliError(`The code expired. Run \`${BRAND.cli} login\` again.`);
    // Keep the rest of the file as it is, and remember which server this token belongs to.
    saveConfig({ ...loadConfigFile(dir), server, token: poll.token }, dir);
    const me = await new ServerClient(server, poll.token, deps.fetch).me();
    out.log(`Logged in as ${me.login}. The token is in ${configPath(dir)}, readable by you only.`);
    return;
  }
}

/** This machine's name, as the server lists it among your devices. */
function deviceName(): string {
  return hostname().replace(/\.local$/, '').slice(0, 100) || 'unknown device';
}

/** Open a URL in the default browser (macOS `open`, Linux `xdg-open`). Never fails: the URL is printed anyway. */
export async function openInBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (!command) return;
  await new Promise<void>((resolve) => execFile(command, [url], () => resolve()));
}
```

`apps/cli/src/commands/status.ts`:
```ts
import { BRAND, type Attention, type MyChat } from '@nitpilot/protocol';
import { loadConfig } from '../config/config';
import { ServerClient } from '../http';
import { terminal, type Out } from '../out';

export type StatusDeps = { env?: Record<string, string | undefined>; out?: Out; fetch?: typeof fetch };

/** What the NEEDS YOU column says for each attention flag. */
const NEEDS: Record<Attention, string> = {
  none: '',
  decision: 'a decision',
  manual_review: 'start review',
  failed: 'agent failed',
  drafts: 'drafts',
};

/** `nitpilot status` (spec §11): who you are on the server, and your open PRs with Nitpilot. */
export async function status(deps: StatusDeps = {}): Promise<void> {
  const out = deps.out ?? terminal;
  const cfg = loadConfig({ env: deps.env });
  const client = new ServerClient(cfg.server, cfg.token, deps.fetch);
  const [me, { chats }] = await Promise.all([client.me(), client.myChats()]);

  out.log(`Logged in as ${me.login} on ${cfg.server}`);
  if (me.githubAuth === 'needs_reauth') {
    out.log(`! GitHub access expired. Sign in again at ${new URL('/', cfg.server).href} so ${BRAND.name} can post in your name.`);
  }
  if (chats.length === 0) {
    out.log(`No open PRs with ${BRAND.name} yet.`);
    return;
  }
  out.log('');
  out.log(table([['PR', 'ROLE', 'PHASE', 'ROUND', 'NEEDS YOU', 'TITLE'], ...chats.map(row)]));
  for (const chat of chats.filter((c) => c.attention === 'failed')) {
    out.log('');
    out.log(`Your agent couldn't finish on ${chat.repo}#${chat.number}. To run it again: ${BRAND.cli} retry ${prUrl(chat)}`);
  }
}

function row(c: MyChat): string[] {
  const title = c.title.length > 50 ? `${c.title.slice(0, 49)}…` : c.title;
  return [`${c.repo}#${c.number}`, c.role, c.phase, String(c.round), NEEDS[c.attention], title];
}

/** Columns padded to their widest cell. */
function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd()).join('\n');
}

/** The PR on GitHub: the link `nitpilot retry` takes. */
export function prUrl(chat: Pick<MyChat, 'repo' | 'number'>): string {
  return `https://github.com/${chat.repo}/pull/${chat.number}`;
}
```

`apps/cli/src/commands/repos.ts`:
```ts
import { resolve } from 'node:path';
import { BRAND } from '@nitpilot/protocol';
import { configDir, loadConfigFile, saveConfig } from '../config/config';
import { CliError } from '../errors';
import { gitTopLevel, githubReposIn } from '../git/remotes';
import { terminal, type Out } from '../out';

export type ReposDeps = { env?: Record<string, string | undefined>; out?: Out };

/**
 * `nitpilot repos add [path]` (spec §11): link a local clone to the GitHub repos its remotes point at,
 * so jobs for them can come to this device. Keeps any `setup` and `checks` already configured.
 */
export async function reposAdd(path: string | undefined, deps: ReposDeps = {}): Promise<void> {
  const out = deps.out ?? terminal;
  const dir = configDir(deps.env ?? process.env);
  const clone = await gitTopLevel(resolve(path ?? '.'));
  const names = await githubReposIn(clone);
  if (names.length === 0) throw new CliError(`${clone} has no GitHub remote. Add one (git remote add origin <url>) and try again.`);

  const cfg = loadConfigFile(dir);
  for (const name of names) {
    cfg.repos[name] = { ...cfg.repos[name], path: clone };
    out.log(`Linked ${name} → ${clone}`);
  }
  saveConfig(cfg, dir);
  out.log(`A running \`${BRAND.cli} start\` picks this up when you restart it.`);
}
```

`apps/cli/src/commands/retry.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import { loadConfig } from '../config/config';
import { CliError } from '../errors';
import { ServerClient } from '../http';
import { terminal, type Out } from '../out';

export type RetryDeps = { env?: Record<string, string | undefined>; out?: Out; fetch?: typeof fetch };

/** `nitpilot retry <pr-url>` (spec §11): queue your failed job on that PR again. */
export async function retry(ref: string | undefined, deps: RetryDeps = {}): Promise<void> {
  const out = deps.out ?? terminal;
  const pr = ref ? parsePrRef(ref) : null;
  if (!pr) throw new CliError(`Usage: ${BRAND.cli} retry <pr-url>, for example ${BRAND.cli} retry https://github.com/octo/sandbox/pull/12`);
  const cfg = loadConfig({ env: deps.env });
  const client = new ServerClient(cfg.server, cfg.token, deps.fetch);
  const { chats } = await client.myChats();
  const chat = chats.find((c) => c.repo.toLowerCase() === pr.repo.toLowerCase() && c.number === pr.number);
  if (!chat) throw new CliError(`You're not part of an open ${BRAND.name} chat on ${pr.repo}#${pr.number}.`);
  await client.retry(chat.id);
  out.log(`Queued your agent again on ${chat.repo}#${chat.number}. It runs on a device where \`${BRAND.cli} start\` is running.`);
}

/** `https://github.com/owner/name/pull/12` (anything after the number is ignored) or `owner/name#12`, else null. */
export function parsePrRef(ref: string): { repo: string; number: number } | null {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(ref) ?? /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref);
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}
```

In `apps/cli/src/http.ts`:
- add `RetryResponse` to the protocol import;
- after `myChats()`, add:
```ts
  /** `nitpilot retry`: queue my failed job on this chat again. */
  retry(chatId: string) {
    return this.call('POST', `/api/chats/${encodeURIComponent(chatId)}/retry`, RetryResponse, { auth: true });
  }
```

In `apps/cli/src/cli.ts`, add these imports:
```ts
import { login } from './commands/login';
import { reposAdd } from './commands/repos';
import { retry } from './commands/retry';
import { status } from './commands/status';
```
and replace `export const COMMANDS: Record<string, Command> = {};` with:
```ts
export const COMMANDS: Record<string, Command> = {
  login: { usage: `${BRAND.cli} login`, summary: 'Connect this device to your account', run: (_args, out) => login({ out }) },
  status: { usage: `${BRAND.cli} status`, summary: 'Your open PRs and what they need from you', run: (_args, out) => status({ out }) },
  repos: {
    usage: `${BRAND.cli} repos add [path]`,
    summary: 'Link a local clone, so its jobs can come here',
    run: async ([sub, path], out) => {
      if (sub !== 'add') throw new CliError(`Usage: ${BRAND.cli} repos add [path]`);
      await reposAdd(path, { out });
    },
  },
  retry: { usage: `${BRAND.cli} retry <pr-url>`, summary: 'Run your failed job on that PR again', run: ([ref], out) => retry(ref, { out }) },
};
```

- [x] **Step 12: Run them to see them pass**

Run: `npm test -w apps/cli && npm run typecheck -w apps/cli && npm run lint`
Expected: PASS (remotes 14, login 4, status 5, repos 4, retry 5, http 8, plus Task 5's files).

- [x] **Step 13: Explain the limits on logging in**

In `docs/why/cli-login.md`, before `## The React analogy`, add:
```markdown
## Limits and cleanup

- **A rate limit.** Each `POST /api/cli/login` writes a row, so anyone could fill the table by calling it in a loop. One client address may start 10 logins a minute (`lib/rate-limit.ts`); the 11th gets `429 Too Many Requests`. The count lives in memory, which is fine because there is one server process (spec §7). It works like a "sliding window": we remember when each recent request came in and count the ones from the last 60 seconds.
- **Cleanup.** A login request is useless 10 minutes after it was made, so the hourly purge (`ingest/record.ts`) deletes the ones older than a day.
```

- [x] **Step 14: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [x] **Step 15: Commit**

```bash
git add apps/server apps/cli packages/protocol/src/api.ts docs/why/cli-login.md docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents.md
git commit -m "feat(cli): login, status, repos add and retry

The server gets the retry endpoint (a retry_requested engine event), a rate limit
on starting CLI logins, and purges old login requests (Plan 1a deferred minor M9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: `start`: the daemon

**Files:**
- Create: `apps/cli/src/connection/backoff.ts`, `apps/cli/src/connection/backoff.test.ts`
- Create: `apps/cli/src/connection/ws-client.ts`
- Create: `apps/cli/src/state.ts`, `apps/cli/src/state.test.ts`
- Create: `apps/cli/src/notify-os.ts`, `apps/cli/src/notify-os.test.ts`
- Create: `apps/cli/src/daemon.ts`, `apps/cli/src/daemon.test.ts`
- Create: `apps/cli/src/commands/start.ts`, `apps/cli/src/commands/start.test.ts`
- Create: `apps/cli/test/stub-hub.ts`
- Modify: `apps/cli/src/cli.ts` (`start`), `apps/cli/package.json` (`ws` and `@types/ws` for the stub server)
- Modify: `docs/why/websockets.md` (the CLI's end)
- Port: the reconnect loop of `~/Desktop/PracticeProjects/hooksmith/cli/src/commands/listen.ts` (backoff doubling to 30 s, reset after a good connection)

**Interfaces:**
- Consumes: `PersonalConfig`, `PersonalConfigSchema`, `configDir`, `loadConfig`, `ServerClient`, `ServerError`, `CliError`, `Out`, `recordOut`, `tempDir`, `startStubServer` (Tasks 5–6); `ServerToCli`, `CliToServer`, `CLOSE_CODES`, `CLI_WS_PATH`, `PROTOCOL_VERSION`, `RunningJob`, `JobBundle`, `JobResult`, `FailureReason`, `AgentId`, `AgentMode` (protocol); `jobBundle()`, `jobResult()` (`@nitpilot/protocol/test-samples`).
- Produces:
  - `startDaemon(opts: DaemonOptions) → { stopped: Promise<StopReason>; stop(): void }`, with `StopReason = 'stopped' | 'reauth' | 'upgrade' | 'replaced'`;
  - `type JobExecutor = (bundle: JobBundle, io: JobIo) => Promise<JobOutcome>`;
  - `type JobIo = { progress(stage, text): void; pushing(from, to): Promise<'applied' | 'stale'>; signal: AbortSignal }`;
  - `type JobOutcome = { kind: 'complete'; result } | { kind: 'fail'; reason; retryable; detail } | { kind: 'reject'; reason }`;
  - `class Backoff({ startMs?, maxMs?, random? })` with `next(): number` and `reset()`;
  - `openSocket(handlers) → ServerSocket` (`send`, `close`, `abandon`, `closed: Promise<{ code, reason, opened }>`);
  - `class DailyJobCounter(dir, now?)` with `take(cap): boolean`, and `localDay(date)`;
  - `notifyOs(message, { platform?, exec? })`;
  - `start(deps) → Promise<number>` (`nitpilot start`);
  - test helpers `startStubHub({ token, routes? })` and `StubConnection` (`test/stub-hub.ts`).

**Behavior** (spec §9.4, §10):
- **hello** reports the protocol, CLI version, device name, agent `{ id, version, modes }`, the linked repos (`Object.keys(config.repos)`), `concurrency`, the running jobs and `defaults` (from `config.auto`). Then it pings every `pingSec` from `welcome` with the running jobs.
- **Running** means from the moment a `job.assign` arrives until the server acks its result. It's what `hello.running` and every `ping` list, so the lease stays alive while an answer waits for a reconnect, and a laptop back from sleep gets its job bound again (Review Focus #1).
- The server never assigns more than `concurrency` jobs, so the daemon runs what it gets. The same `(jobId, attempt)` handed out twice runs once; a newer attempt of a job aborts the older run.
- **Daily cap:** `dailyJobCap` jobs per local day, counted in `<config dir>/state.json`. A job over the cap gets `job.reject { reason: 'daily_cap' }` without running.
- **Acks:** `job.complete`, `job.fail`, `job.reject` and `job.pushing` each wait for their `ack`. One not acked before a disconnect is sent again, with the same id, after the next `welcome`. `stale` means "not yours anymore": drop it. The server applies a result at most once (Task 4).
- **Executors:** a thrown error becomes `job.fail { reason: 'crash', retryable: true }`, so the engine's retry rules decide. `progress` goes out at most every 2 s and only while welcomed; it is never resent.
- **job.cancel** for a running `(jobId, attempt)` aborts its executor's signal, stops listing it, and sends nothing for it. A cancel for a job the daemon doesn't know (or another attempt) is ignored.
- **notify** prints `🔔 <title>  <url>` and shows a desktop notification (macOS `osascript`, Linux `notify-send`, both through `execFile` with the text as an argument; elsewhere print only).
- **Closing:** `4401` → stop, "run `nitpilot login`". `4426` → stop, "upgrade". `4409` → stop, "another `nitpilot start` on this device took over". Anything else → reconnect after `Backoff.next()`: 1 s doubling to 30 s, ±20% jitter, back to 1 s after `welcome`.
- **A connection that never opened** may be a token refused before the upgrade (a plain 401 the WebSocket client can't see), so the daemon asks `GET /api/me`: a 401 stops it with "run `nitpilot login`"; anything else means try again.
- **A socket that went quiet:** when nothing (not even a pong) arrives for `silentMs` (default two ping intervals plus 10 s), the daemon abandons the socket and reconnects, without waiting for TCP to notice.
- **`nitpilot start`** needs a token, declares `modes: []` until agents exist (Task 17 replaces this), stops cleanly on the first Ctrl-C, and exits with 1 when the server sent it away.

- [ ] **Step 1: Install the WebSocket server the tests use**

Run: `npm install -D -w apps/cli ws@^8.22.0 @types/ws@^8.18.2`
Expected: both land in `apps/cli/package.json` `devDependencies` (the CLI itself uses Node's built-in `WebSocket` client; `ws` only plays the server in tests).

- [ ] **Step 2: Write the failing tests for the small parts**

`apps/cli/src/connection/backoff.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Backoff } from './backoff';

const waits = (backoff: Backoff, n: number) => Array.from({ length: n }, () => backoff.next());

describe('Backoff', () => {
  it('waits 1 s, then doubles each time up to 30 s', () => {
    expect(waits(new Backoff({ random: () => 0.5 }), 7)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('spreads each wait by up to 20% either way, so CLIs reconnecting together drift apart', () => {
    expect(new Backoff({ random: () => 0 }).next()).toBe(800);
    expect(new Backoff({ random: () => 1 }).next()).toBe(1_200);
  });

  it('starts over from 1 s after a good connection', () => {
    const backoff = new Backoff({ random: () => 0.5 });
    waits(backoff, 4);
    backoff.reset();
    expect(backoff.next()).toBe(1_000);
  });
});
```

`apps/cli/src/state.test.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/temp';
import { DailyJobCounter, localDay } from './state';

describe('DailyJobCounter', () => {
  it('counts jobs and says no once the cap is reached', () => {
    const counter = new DailyJobCounter(tempDir(), () => new Date(2026, 9, 10, 9, 0));
    expect([counter.take(2), counter.take(2), counter.take(2)]).toEqual([true, true, false]);
  });

  it('starts again on the next local day', () => {
    let now = new Date(2026, 9, 10, 23, 59);
    const counter = new DailyJobCounter(tempDir(), () => now);
    expect(counter.take(1)).toBe(true);
    expect(counter.take(1)).toBe(false);
    now = new Date(2026, 9, 11, 0, 1);
    expect(counter.take(1)).toBe(true);
  });

  it('treats a missing or unreadable file as no jobs yet', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'state.json'), 'not json');
    expect(new DailyJobCounter(dir).take(1)).toBe(true);
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
```

`apps/cli/src/notify-os.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { notifyOs } from './notify-os';

function recordExec() {
  const calls: [string, string[]][] = [];
  return { calls, exec: async (file: string, args: string[]) => void calls.push([file, args]) };
}

/** A title that would break out of an AppleScript string if it were pasted into the script. */
const tricky = 'Ready: "acme/shop-api#142" & do shell script "rm -rf ~"';

describe('notifyOs', () => {
  it('on macOS, hands the text to osascript as an argument, never inside the script', async () => {
    const { calls, exec } = recordExec();
    await notifyOs(tricky, { platform: 'darwin', exec });
    expect(calls).toHaveLength(1);
    const [file, args] = calls[0]!;
    expect(file).toBe('osascript');
    expect(args.at(-1)).toBe(tricky);
    expect(args.slice(0, -2).some((arg) => arg.includes('acme'))).toBe(false);
  });

  it('on Linux, uses notify-send', async () => {
    const { calls, exec } = recordExec();
    await notifyOs('Ready', { platform: 'linux', exec });
    expect(calls).toEqual([['notify-send', ['Nitpilot', 'Ready']]]);
  });

  it('elsewhere, does nothing (the line in the terminal is enough)', async () => {
    const { calls, exec } = recordExec();
    await notifyOs('Ready', { platform: 'win32', exec });
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm test -w apps/cli -- src/connection src/state src/notify-os`
Expected: FAIL: `Failed to resolve import "./backoff"` (and `./state`, `./notify-os`).

- [ ] **Step 4: Write backoff, the daily counter and desktop notifications**

`apps/cli/src/connection/backoff.ts`:
```ts
/** Reconnect waits (spec §10): 1 s, doubling up to 30 s. */
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** Each wait is nudged up to 20% either way, so CLIs that lost the server together don't all return at once. */
const JITTER = 0.2;

export class Backoff {
  private readonly startMs: number;
  private readonly maxMs: number;
  private readonly random: () => number;
  private base: number;

  constructor(opts: { startMs?: number; maxMs?: number; random?: () => number } = {}) {
    this.startMs = opts.startMs ?? BACKOFF_START_MS;
    this.maxMs = opts.maxMs ?? BACKOFF_MAX_MS;
    this.random = opts.random ?? Math.random;
    this.base = this.startMs;
  }

  /** How long to wait before the next try. Each call doubles the wait, up to the maximum. */
  next(): number {
    const wait = Math.round(this.base * (1 - JITTER + 2 * JITTER * this.random()));
    this.base = Math.min(this.base * 2, this.maxMs);
    return wait;
  }

  /** After a good connection (`welcome`), start again from the shortest wait. */
  reset(): void {
    this.base = this.startMs;
  }
}
```

`apps/cli/src/state.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const State = z.object({ day: z.string(), jobs: z.number().int().min(0) });

/**
 * Counts the jobs this CLI ran today, so `dailyJobCap` limits how much of your agent quota others can
 * spend by requesting your review (spec §14, budget protection). Kept in <config dir>/state.json.
 */
export class DailyJobCounter {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Count one more job, unless `cap` jobs already ran today. False means: over the cap, turn it down. */
  take(cap: number): boolean {
    const today = localDay(this.now());
    const saved = this.read();
    const ran = saved?.day === today ? saved.jobs : 0;
    if (ran >= cap) return false;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.file(), `${JSON.stringify({ day: today, jobs: ran + 1 })}\n`, { mode: 0o600 });
    return true;
  }

  private file(): string {
    return join(this.dir, 'state.json');
  }

  /** What was saved, or null when there's no file yet or it can't be read (then the count starts at zero). */
  private read(): z.infer<typeof State> | null {
    try {
      return State.parse(JSON.parse(readFileSync(this.file(), 'utf8')));
    } catch {
      return null;
    }
  }
}

/** YYYY-MM-DD in this machine's time zone: the cap resets at your midnight, not UTC's. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

`apps/cli/src/notify-os.ts`:
```ts
import { execFile } from 'node:child_process';
import { BRAND } from '@nitpilot/protocol';

type Exec = (file: string, args: string[]) => Promise<void>;

/**
 * Show a desktop notification (spec §16, Plan 1). macOS uses osascript, Linux notify-send; elsewhere
 * the line in the terminal is all. The text goes in as an argument, never pasted into a script, so a PR
 * title with quotes in it can't turn into AppleScript.
 */
export async function notifyOs(message: string, deps: { platform?: NodeJS.Platform; exec?: Exec } = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const exec = deps.exec ?? execQuietly;
  if (platform === 'darwin') {
    await exec('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', BRAND.name, message]);
  } else if (platform === 'linux') {
    await exec('notify-send', [BRAND.name, message]);
  }
}

/** Run a program and ignore how it went: a missing notify-send must never stop the daemon. */
function execQuietly(file: string, args: string[]): Promise<void> {
  return new Promise((resolve) => execFile(file, args, () => resolve()));
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `npm test -w apps/cli -- src/connection src/state src/notify-os`
Expected: PASS (backoff 3, state 3, notify-os 3).

- [ ] **Step 6: Write the failing daemon tests**

`apps/cli/test/stub-hub.ts`:
```ts
import type { IncomingMessage } from 'node:http';
import { CLI_WS_PATH, type CliToServer, type ServerToCli } from '@nitpilot/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { startStubServer, type StubRoutes } from './stub-server';

type FromCli<T extends CliToServer['t']> = Extract<CliToServer, { t: T }>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when something is added to `waiting`'s owner, or after `ms`. */
function wake(waiting: Set<() => void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiting.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    waiting.add(done);
  });
}

/** One CLI connection as the pretend server sees it, with an inbox, so a test can wait for "the next ping". */
export class StubConnection {
  private readonly inbox: CliToServer[] = [];
  private readonly waiting = new Set<() => void>();
  /** Like the real hub, every ping gets a pong. Set false to play a server that went quiet. */
  answerPings = true;

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as CliToServer;
      if (msg.t === 'ping' && this.answerPings) this.send({ v: 1, t: 'pong', d: {} });
      this.inbox.push(msg);
      for (const done of this.waiting) done();
    });
  }

  send(msg: ServerToCli): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(code: number, reason = ''): void {
    this.ws.close(code, reason);
  }

  /** Answer the hello the way the hub does. */
  welcome(login = 'maya'): void {
    this.send({ v: 1, t: 'welcome', d: { login, pingSec: 25, leaseSec: 90 } });
  }

  /** Take the next message of type `t` out of the inbox, waiting up to `ms`. Other messages stay. */
  async next<T extends CliToServer['t']>(t: T, ms = 2_000): Promise<FromCli<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as FromCli<T>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms} ms; the inbox has: ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await wake(this.waiting, left);
    }
  }

  /** The next message of type `t` that `matches`, skipping the ones that don't. */
  async nextMatching<T extends CliToServer['t']>(t: T, matches: (msg: FromCli<T>) => boolean, ms = 2_000): Promise<FromCli<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const msg = await this.next(t, Math.max(1, deadline - Date.now()));
      if (matches(msg)) return msg;
    }
  }

  /** Throw away the queued messages of type `t`, so the next wait only sees new ones. */
  forget(t: CliToServer['t']): void {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i]!.t === t) this.inbox.splice(i, 1);
  }

  /** Fail if a message of type `t` arrives within `ms`. */
  async nothing(t: CliToServer['t'], ms = 300): Promise<void> {
    await sleep(ms);
    const got = this.inbox.find((m) => m.t === t);
    if (got) throw new Error(`expected no ${t}, got ${JSON.stringify(got)}`);
  }
}

/**
 * A pretend Nitpilot server for daemon tests: the REST stub plus /ws/cli. Only `token` may connect;
 * any other token gets a plain 401 before the upgrade, like the real hub.
 */
export async function startStubHub(opts: { token: string; routes?: StubRoutes }) {
  const http = await startStubServer(opts.routes ?? {});
  const arrivals: StubConnection[] = [];
  const waiting = new Set<() => void>();
  const wss = new WebSocketServer({
    server: http.server,
    path: CLI_WS_PATH,
    verifyClient: (info: { req: IncomingMessage }, done: (ok: boolean, code?: number) => void) => done(info.req.headers.authorization === `Bearer ${opts.token}`, 401),
  });
  wss.on('connection', (ws) => {
    arrivals.push(new StubConnection(ws));
    for (const done of waiting) done();
  });

  return {
    url: http.url,
    requests: http.requests,
    /** The next CLI that connects, waiting up to `ms` for it. */
    async connection(ms = 2_000): Promise<StubConnection> {
      const deadline = Date.now() + ms;
      for (;;) {
        const conn = arrivals.shift();
        if (conn) return conn;
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no CLI connected within ${ms} ms`);
        await wake(waiting, left);
      }
    },
    /** Fail if a CLI connects within `ms`. */
    async noConnection(ms = 300): Promise<void> {
      await sleep(ms);
      if (arrivals.length > 0) throw new Error('a CLI connected');
    },
    async close(): Promise<void> {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await http.close();
    },
  };
}
```

`apps/cli/src/daemon.test.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobBundle, RunningJob, ServerToCli } from '@nitpilot/protocol';
import { jobBundle, jobResult } from '@nitpilot/protocol/test-samples';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { recordOut } from '../test/out';
import { startStubHub, type StubConnection } from '../test/stub-hub';
import type { StubRoutes } from '../test/stub-server';
import { tempDir } from '../test/temp';
import { PersonalConfigSchema } from './config/config';
import { Backoff } from './connection/backoff';
import { startDaemon, type DaemonOptions, type JobExecutor, type JobOutcome } from './daemon';
import { localDay } from './state';
import { CLI_VERSION } from './version';

const TOKEN = 'nit_test';
const JOB: RunningJob = { jobId: 'job_1', attempt: 1 }; // the sample bundle's
const done: JobOutcome = { kind: 'complete', result: jobResult() };
const assign = (bundle: JobBundle = jobBundle()): ServerToCli => ({ v: 1, t: 'job.assign', d: { bundle } });

/** A promise the test settles by hand, e.g. an executor that finishes when told to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A stub server, and a daemon talking to it with fast timings. Both stop when the test ends. */
async function setup(over: Partial<DaemonOptions> = {}, opts: { daemonToken?: string; routes?: StubRoutes } = {}) {
  const hub = await startStubHub({ token: TOKEN, routes: opts.routes });
  const out = recordOut();
  const notified: string[] = [];
  const daemon = startDaemon({
    config: PersonalConfigSchema.parse({ server: hub.url, token: opts.daemonToken ?? TOKEN, repos: { 'acme/shop-api': { path: '/code/shop-api' } } }),
    configDir: tempDir(),
    agent: { id: 'fake', version: null, modes: ['reviewer', 'editor'] },
    executor: async () => done,
    out,
    notify: async (message) => void notified.push(message),
    device: 'test laptop',
    backoff: new Backoff({ startMs: 20, maxMs: 100 }),
    pingEveryMs: 50,
    silentMs: 10_000,
    ...over,
  });
  onTestFinished(async () => {
    daemon.stop();
    await daemon.stopped;
    await hub.close();
  });
  return { hub, daemon, out, notified };
}

/** The daemon's next connection: wait for its hello and answer welcome. */
async function welcomed(hub: Awaited<ReturnType<typeof startStubHub>>) {
  const conn = await hub.connection();
  const hello = await conn.next('hello');
  conn.welcome();
  return { conn, hello };
}

/** Wait for a ping (one every 50 ms) whose running list is exactly `expected`. */
function pingListing(conn: StubConnection, expected: RunningJob[]) {
  return conn.nextMatching('ping', (ping) => JSON.stringify(ping.d.running) === JSON.stringify(expected));
}

describe('startDaemon', () => {
  it('says hello with what this device can do', async () => {
    const { hub } = await setup();
    const { hello } = await welcomed(hub);
    expect(hello.d).toEqual({
      protocol: 1,
      cliVersion: CLI_VERSION,
      device: 'test laptop',
      agent: { id: 'fake', version: null, modes: ['reviewer', 'editor'] },
      repos: ['acme/shop-api'],
      concurrency: 1,
      running: [],
      defaults: { autoReview: true, autoAddress: true },
    });
  });

  it('pings on a timer once welcomed', async () => {
    const { hub } = await setup();
    const { conn } = await welcomed(hub);
    expect((await conn.next('ping')).d.running).toEqual([]);
    expect((await conn.next('ping')).d.running).toEqual([]);
  });

  it('runs a job and sends its result; the job counts as running until the server acks it', async () => {
    const finish = deferred<JobOutcome>();
    const executor = vi.fn<JobExecutor>(() => finish.promise);
    const { hub } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    expect(executor).toHaveBeenCalledWith(jobBundle(), expect.objectContaining({ signal: expect.any(AbortSignal) }));

    finish.resolve(done);
    const complete = await conn.next('job.complete');
    expect(complete.d).toEqual({ ...JOB, result: jobResult() });
    conn.forget('ping');
    await pingListing(conn, [JOB]); // sent, but not acked yet
    conn.send({ v: 1, t: 'ack', re: complete.id, d: { status: 'applied' } });
    await pingListing(conn, []);
  });

  it("turns down the day's 41st job without running it", async () => {
    const configDir = tempDir();
    writeFileSync(join(configDir, 'state.json'), JSON.stringify({ day: localDay(new Date()), jobs: 40 }));
    const executor = vi.fn<JobExecutor>(async () => done);
    const { hub } = await setup({ executor, configDir });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    expect((await conn.next('job.reject')).d).toEqual({ ...JOB, reason: 'daily_cap' });
    expect(executor).not.toHaveBeenCalled();
  });

  it('stops a job the server cancels, and sends nothing for it', async () => {
    let signal: AbortSignal | undefined;
    const executor: JobExecutor = (_bundle, io) =>
      new Promise((resolve) => {
        signal = io.signal;
        io.signal.addEventListener('abort', () => resolve({ kind: 'fail', reason: 'crash', retryable: true, detail: 'stopped' }));
      });
    const { hub } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    conn.send({ v: 1, t: 'job.cancel', d: { ...JOB, reason: 'pr_closed' } });
    conn.forget('ping');
    await pingListing(conn, []);
    expect(signal?.aborted).toBe(true);
    await conn.nothing('job.fail');
  });

  it("ignores a cancel for a job it doesn't know", async () => {
    const { hub, out } = await setup();
    const { conn } = await welcomed(hub);
    conn.send({ v: 1, t: 'job.cancel', d: { jobId: 'job_unknown', attempt: 3, reason: 'stale' } });
    conn.forget('ping');
    await pingListing(conn, []);
    expect(out.text()).not.toContain('job_unknown');
  });

  it.each([
    [4401, 'reauth', 'Run `nitpilot login`'],
    [4426, 'upgrade', 'npm install -g nitpilot@latest'],
    [4409, 'replaced', 'Another `nitpilot start` on this device took over'],
  ] as const)('stops for good on %i (%s), saying what to do', async (code, reason, advice) => {
    const { hub, daemon, out } = await setup();
    const { conn } = await welcomed(hub);
    conn.close(code, 'bye');
    expect(await daemon.stopped).toBe(reason);
    expect(out.text()).toContain(advice);
    await hub.noConnection();
  });

  it('reconnects after any other close, and says hello again', async () => {
    const { hub } = await setup();
    const { conn } = await welcomed(hub);
    conn.close(1012, 'server restarting');
    const again = await hub.connection();
    expect((await again.next('hello')).d.device).toBe('test laptop');
  });

  it('lists a job still in progress in its hello after a reconnect (Review Focus #1)', async () => {
    const { hub } = await setup({ executor: () => new Promise<JobOutcome>(() => {}) }); // never finishes
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    conn.close(1012, 'server restarting');
    const again = await hub.connection();
    expect((await again.next('hello')).d.running).toEqual([JOB]);
  });

  it('sends a result again after reconnecting when it was never acked, and drops it on a stale ack', async () => {
    const { hub, out } = await setup();
    const { conn } = await welcomed(hub);
    conn.send(assign());
    const first = await conn.next('job.complete');
    conn.close(1012, 'server restarting');

    const { conn: again, hello } = await welcomed(hub);
    expect(hello.d.running).toEqual([JOB]); // still running: its result wasn't acked
    const resent = await again.next('job.complete');
    expect(resent).toEqual(first); // the same id, so it's recognizably the same answer
    again.send({ v: 1, t: 'ack', re: resent.id, d: { status: 'stale' } });
    again.forget('ping');
    await pingListing(again, []);
    expect(out.text()).toContain('stale');
  });

  it('drops a socket that went quiet and connects again, like a laptop back from sleep', async () => {
    const { hub, out } = await setup({ silentMs: 200 });
    const { conn } = await welcomed(hub);
    conn.answerPings = false; // the socket looks open, but nothing comes back
    const again = await hub.connection(3_000);
    await again.next('hello');
    expect(out.text()).toContain('The server went quiet.');
  });

  it("asks whether its token still works when it can't connect, and stops if not", async () => {
    const routes: StubRoutes = { 'GET /api/me': { status: 401, body: { error: { code: 'unauthorized', message: 'Missing or invalid CLI token.' } } } };
    const { daemon, out } = await setup({}, { daemonToken: 'nit_revoked', routes });
    expect(await daemon.stopped).toBe('reauth');
    expect(out.text()).toContain('Run `nitpilot login`');
  });

  it('shows notifications in the terminal and on the desktop', async () => {
    const { hub, out, notified } = await setup();
    const { conn } = await welcomed(hub);
    conn.send({ v: 1, t: 'notify', d: { kind: 'ready', chatId: 'chat_1', title: 'Ready for your approval: acme/shop-api#142', url: 'http://nitpilot.test/c/acme/shop-api/142' } });
    await vi.waitFor(() => expect(notified).toEqual(['Ready for your approval: acme/shop-api#142']));
    expect(out.text()).toContain('Ready for your approval: acme/shop-api#142  http://nitpilot.test/c/acme/shop-api/142');
  });

  it("asks before pushing, and gives the executor the server's answer", async () => {
    const answer = deferred<'applied' | 'stale'>();
    const executor: JobExecutor = async (_bundle, io) => {
      answer.resolve(await io.pushing('a'.repeat(40), 'c'.repeat(40)));
      return done;
    };
    const { hub } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    const pushing = await conn.next('job.pushing');
    expect(pushing.d).toEqual({ ...JOB, from: 'a'.repeat(40), to: 'c'.repeat(40) });
    conn.send({ v: 1, t: 'ack', re: pushing.id, d: { status: 'applied' } });
    expect(await answer.promise).toBe('applied');
  });

  it('reports an executor that throws as a crash, so the server can retry it', async () => {
    const { hub } = await setup({
      executor: async () => {
        throw new Error('boom');
      },
    });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    expect((await conn.next('job.fail')).d).toMatchObject({ ...JOB, reason: 'crash', retryable: true, detail: expect.stringContaining('boom') });
  });
});
```

`apps/cli/src/commands/start.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { recordOut } from '../../test/out';
import { tempDir } from '../../test/temp';
import { start } from './start';

describe('nitpilot start', () => {
  it('asks you to log in first', async () => {
    await expect(start({ env: { NITPILOT_CONFIG_DIR: tempDir() }, out: recordOut() })).rejects.toThrow('Not logged in. Run `nitpilot login` first.');
  });
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `npm test -w apps/cli -- src/daemon src/commands/start`
Expected: FAIL: `Failed to resolve import "./daemon"` and `"./start"`.

- [ ] **Step 8: Write the socket wrapper**

`apps/cli/src/connection/ws-client.ts`:
```ts
import { CLI_WS_PATH, ServerToCli, type CliToServer } from '@nitpilot/protocol';

/** How a socket ended. `opened` is false when it never connected (refused, unreachable). */
export type Closed = { code: number; reason: string; opened: boolean };

export type ServerSocket = {
  send(msg: CliToServer): boolean;
  close(code: number, reason: string): void;
  /** Give up on a socket that looks open but is dead: `closed` resolves now instead of when TCP notices. */
  abandon(): void;
  /** Resolves exactly once. */
  closed: Promise<Closed>;
};

export type SocketHandlers = {
  server: string;
  token: string;
  onOpen(): void;
  onMessage(msg: ServerToCli): void;
  warn(text: string): void;
};

/**
 * One WebSocket to the server's /ws/cli, carrying this device's token (Node's built-in client, spec §10).
 * Messages that don't fit the protocol are reported and dropped.
 */
export function openSocket(h: SocketHandlers): ServerSocket {
  const ws = new WebSocket(`${h.server.replace(/^http/, 'ws')}${CLI_WS_PATH}`, { headers: { authorization: `Bearer ${h.token}` } });
  let opened = false;
  let ended = false;
  let settle!: (closed: Closed) => void;
  const closed = new Promise<Closed>((resolve) => (settle = resolve));
  const end = (how: Closed) => {
    if (ended) return;
    ended = true;
    settle(how);
  };

  ws.addEventListener('open', () => {
    opened = true;
    h.onOpen();
  });
  ws.addEventListener('message', (event) => {
    if (ended) return; // abandoned: ignore whatever still trickles in
    let json: unknown;
    try {
      json = JSON.parse(String(event.data));
    } catch {
      h.warn('dropped a message that is not JSON');
      return;
    }
    const parsed = ServerToCli.safeParse(json);
    if (!parsed.success) {
      h.warn(`dropped a message the protocol doesn't know: ${String(event.data).slice(0, 200)}`);
      return;
    }
    h.onMessage(parsed.data);
  });
  // An 'error' is always followed by 'close', which says what we need to know.
  ws.addEventListener('close', (event) => end({ code: event.code, reason: event.reason, opened }));

  return {
    send(msg) {
      if (ended || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close(code, reason) {
      ws.close(code, reason);
    },
    abandon() {
      end({ code: 4000, reason: 'the server went quiet', opened });
      ws.close(4000, 'the server went quiet');
    },
    closed,
  };
}
```

- [ ] **Step 9: Write the daemon**

`apps/cli/src/daemon.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  BRAND, CLOSE_CODES, PROTOCOL_VERSION,
  type AgentId, type AgentMode, type CliToServer, type FailureReason, type JobBundle, type JobResult, type RunningJob, type ServerToCli,
} from '@nitpilot/protocol';
import type { PersonalConfig } from './config/config';
import { Backoff } from './connection/backoff';
import { openSocket, type Closed, type ServerSocket } from './connection/ws-client';
import { CliError } from './errors';
import { ServerClient, ServerError } from './http';
import { notifyOs } from './notify-os';
import { terminal, type Out } from './out';
import { DailyJobCounter } from './state';
import { CLI_VERSION } from './version';

type Stage = Extract<CliToServer, { t: 'job.progress' }>['d']['stage'];
type Welcome = Extract<ServerToCli, { t: 'welcome' }>['d'];
/** The messages the server answers with an ack (spec §10). */
type AckedMessage = Extract<CliToServer, { t: 'job.pushing' | 'job.complete' | 'job.fail' | 'job.reject' }> & { id: string };
type AckStatus = 'applied' | 'stale';

/** How a job ended, as the executor tells it. The daemon turns it into job.complete, job.fail or job.reject. */
export type JobOutcome =
  | { kind: 'complete'; result: JobResult }
  | { kind: 'fail'; reason: FailureReason; retryable: boolean; detail: string }
  | { kind: 'reject'; reason: FailureReason };

/** What an executor may do while its job runs. */
export type JobIo = {
  /** Live status for Plan 2's status line. Sent at most every 2 s, and dropped while disconnected. */
  progress(stage: Stage, text: string): void;
  /** Ask before `git push` (spec §11 step 6). Push only on 'applied'. */
  pushing(from: string, to: string): Promise<AckStatus>;
  /** Aborted when the server cancels the job, a newer attempt arrives, or the daemon stops. */
  signal: AbortSignal;
};

/** Runs one job. Task 17 builds the real one: worktree, MCP server, agent, push. */
export type JobExecutor = (bundle: JobBundle, io: JobIo) => Promise<JobOutcome>;

/** Why the daemon stopped for good. Every other end of a connection is a reason to reconnect. */
export type StopReason = 'stopped' | 'reauth' | 'upgrade' | 'replaced';

export type DaemonOptions = {
  config: PersonalConfig;
  /** Where state.json (the daily job count) lives. */
  configDir: string;
  agent: { id: AgentId; version: string | null; modes: AgentMode[] };
  executor: JobExecutor;
  out?: Out;
  notify?: (message: string) => Promise<void>;
  device?: string;
  backoff?: Backoff;
  counter?: DailyJobCounter;
  /** Tests ping faster than welcome's pingSec. */
  pingEveryMs?: number;
  /** Silence after which the socket counts as dead. Default: two ping intervals plus 10 s. */
  silentMs?: number;
  fetch?: typeof fetch;
};

export type Daemon = { stopped: Promise<StopReason>; stop(): void };

/** Live status goes out at most this often (spec §10). */
const PROGRESS_EVERY_MS = 2_000;

const STOP_CODES: Partial<Record<number, Exclude<StopReason, 'stopped'>>> = {
  [CLOSE_CODES.reauth]: 'reauth',
  [CLOSE_CODES.upgradeCli]: 'upgrade',
  [CLOSE_CODES.replaced]: 'replaced',
};

const STOP_MESSAGES: Record<Exclude<StopReason, 'stopped'>, string> = {
  reauth: `This device was signed out. Run \`${BRAND.cli} login\`.`,
  upgrade: `This ${BRAND.cli} is too old for the server. Upgrade it: npm install -g ${BRAND.npmPackage}@latest`,
  replaced: `Another \`${BRAND.cli} start\` on this device took over, so this one stops.`,
};

/** A job from its job.assign until the server acks its result. */
type RunningEntry = RunningJob & { controller: AbortController };

/**
 * The engine of `nitpilot start` (spec §10, §11): keep one WebSocket to the server, say hello, ping,
 * run the jobs it hands out, and send each answer until the server acks it. Reconnects on its own with
 * backoff; stops for good on 4401, 4426 and 4409. See docs/why/websockets.md.
 */
export function startDaemon(opts: DaemonOptions): Daemon {
  const { config, executor } = opts;
  const token = config.token;
  if (!token) throw new CliError(`Not logged in. Run \`${BRAND.cli} login\` first.`);
  const out = opts.out ?? terminal;
  const notify = opts.notify ?? ((message: string) => notifyOs(message));
  const backoff = opts.backoff ?? new Backoff();
  const counter = opts.counter ?? new DailyJobCounter(opts.configDir);
  const device = (opts.device ?? hostname().replace(/\.local$/, '')).slice(0, 100) || 'unknown device';
  const client = new ServerClient(config.server, token, opts.fetch);

  /** Jobs this device holds, by jobId. */
  const running = new Map<string, RunningEntry>();
  /** Answers waiting for their ack, by message id. They go again after every welcome. */
  const unacked = new Map<string, { msg: AckedMessage; done(status: AckStatus): void }>();
  const stopping = new AbortController();
  let socket: ServerSocket | null = null;
  let welcomed = false;

  async function loop(): Promise<StopReason> {
    out.log(`Connecting to ${config.server}…`);
    while (!stopping.signal.aborted) {
      const closed = await connectOnce();
      if (stopping.signal.aborted) break;
      const stop = STOP_CODES[closed.code];
      if (stop) {
        out.error(STOP_MESSAGES[stop]);
        return stop;
      }
      // A token refused before the upgrade looks like a network error from here, so ask the server directly.
      if (!closed.opened && (await tokenRejected())) {
        out.error(STOP_MESSAGES.reauth);
        return 'reauth';
      }
      const wait = backoff.next();
      const why = closed.code ? ` (${closed.code}${closed.reason ? ` ${closed.reason}` : ''})` : '';
      out.log(`Disconnected${why}. Trying again in ${(wait / 1000).toFixed(1)} s…`);
      await sleep(wait, stopping.signal);
    }
    return 'stopped';
  }

  /** One connection, from opening to closing. */
  function connectOnce(): Promise<Closed> {
    let lastHeard = Date.now();
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    const s = openSocket({
      server: config.server,
      token,
      warn: (text) => out.error(`[connection] ${text}`),
      onOpen: () => s.send(helloMessage()),
      onMessage: (msg) => {
        lastHeard = Date.now();
        if (msg.t !== 'welcome') return onMessage(msg);
        onWelcome(msg.d);
        const pingMs = opts.pingEveryMs ?? msg.d.pingSec * 1000;
        const silentMs = opts.silentMs ?? 2 * pingMs + 10_000;
        pingTimer = setInterval(() => {
          // Nothing back for a while, not even a pong: the socket is dead even if it looks open,
          // which is what a laptop gets back from sleep. Drop it and connect again.
          if (Date.now() - lastHeard > silentMs) {
            out.log('The server went quiet.');
            s.abandon();
            return;
          }
          s.send({ v: 1, t: 'ping', d: { running: runningList() } });
        }, pingMs);
      },
    });
    socket = s;
    return s.closed.finally(() => {
      clearInterval(pingTimer);
      welcomed = false;
      socket = null;
    });
  }

  function onWelcome(d: Welcome): void {
    welcomed = true;
    backoff.reset();
    const repos = Object.keys(config.repos);
    const linked = repos.length > 0 ? `Linked: ${repos.join(', ')}.` : `No repos linked yet: run \`${BRAND.cli} repos add\` in a clone.`;
    out.log(`Connected as ${d.login}. ${linked}`);
    // Answers that weren't acked before the last disconnect go again; the server applies each at most once.
    for (const { msg } of unacked.values()) socket?.send(msg);
  }

  function onMessage(msg: ServerToCli): void {
    switch (msg.t) {
      case 'job.assign': {
        const { bundle } = msg.d;
        runJob(bundle).catch((err) => out.error(`[job] ${bundle.jobId}: ${(err as Error).message}`));
        return;
      }
      case 'job.cancel':
        cancelJob(msg.d);
        return;
      case 'ack': {
        const waiting = msg.re ? unacked.get(msg.re) : undefined;
        if (!waiting) return; // an answer to something we no longer wait for
        unacked.delete(msg.re!);
        waiting.done(msg.d.status);
        return;
      }
      case 'notify':
        out.log(`🔔 ${msg.d.title}  ${msg.d.url}`);
        notify(msg.d.title).catch(() => {});
        return;
      case 'welcome': // handled by connectOnce
      case 'pong': // only shows the server is alive, which connectOnce already noted
        return;
    }
  }

  async function runJob(bundle: JobBundle): Promise<void> {
    const previous = running.get(bundle.jobId);
    if (previous?.attempt === bundle.attempt) return; // the same hand-out twice: already on it
    previous?.controller.abort('a newer attempt of this job arrived');
    const job: RunningEntry = { jobId: bundle.jobId, attempt: bundle.attempt, controller: new AbortController() };
    running.set(job.jobId, job);
    const name = `${bundle.type.replace('_', '-')} of ${bundle.pr.repoFullName}#${bundle.pr.number}`;

    let outcome: JobOutcome;
    if (counter.take(config.dailyJobCap)) {
      out.log(`→ ${name} (attempt ${bundle.attempt})`);
      outcome = await execute(bundle, job);
    } else {
      out.log(`✗ Turned down the ${name}: today's ${config.dailyJobCap} jobs are done (dailyJobCap).`);
      outcome = { kind: 'reject', reason: 'daily_cap' };
    }
    if (job.controller.signal.aborted) return; // cancelled or replaced meanwhile: the server has moved on

    const status = await sendAcked(answerFor(job, outcome));
    if (running.get(job.jobId) === job) running.delete(job.jobId);
    out.log(status === 'applied' ? `✓ ${name}: ${describeOutcome(outcome)}` : `· ${name}: the server had moved on (stale), so this answer was dropped.`);
  }

  async function execute(bundle: JobBundle, job: RunningEntry): Promise<JobOutcome> {
    let lastProgress = 0;
    const io: JobIo = {
      progress(stage, text) {
        const now = Date.now();
        if (!welcomed || now - lastProgress < PROGRESS_EVERY_MS) return;
        lastProgress = now;
        socket?.send({ v: 1, t: 'job.progress', d: { jobId: job.jobId, attempt: job.attempt, stage, text: text.slice(0, 200) } });
      },
      pushing: (from, to) => sendAcked({ v: 1, t: 'job.pushing', id: randomUUID(), d: { jobId: job.jobId, attempt: job.attempt, from, to } }),
      signal: job.controller.signal,
    };
    try {
      return await executor(bundle, io);
    } catch (err) {
      // A bug in the executor. Report it, so the engine's retry rules decide what happens next.
      return { kind: 'fail', reason: 'crash', retryable: true, detail: String((err as Error)?.stack ?? err) };
    }
  }

  function cancelJob(ref: RunningJob & { reason: string }): void {
    const job = running.get(ref.jobId);
    if (!job || job.attempt !== ref.attempt) return; // not ours (anymore): nothing to stop
    running.delete(ref.jobId);
    job.controller.abort(ref.reason);
    out.log(`■ Stopped ${ref.jobId}: ${ref.reason.replaceAll('_', ' ')}.`);
  }

  /** Send an answer the server acks, and keep it until it does: it goes again after every reconnect. */
  function sendAcked(msg: AckedMessage): Promise<AckStatus> {
    return new Promise((resolve) => {
      unacked.set(msg.id, { msg, done: resolve });
      if (welcomed) socket?.send(msg);
    });
  }

  function helloMessage(): CliToServer {
    return {
      v: 1,
      t: 'hello',
      d: {
        protocol: PROTOCOL_VERSION,
        cliVersion: CLI_VERSION,
        device,
        agent: opts.agent,
        repos: Object.keys(config.repos),
        concurrency: config.concurrency,
        // Jobs still in progress from before a disconnect: the server binds them to this device again (spec §9.4).
        running: runningList(),
        defaults: { autoReview: config.auto.review, autoAddress: config.auto.address },
      },
    };
  }

  function runningList(): RunningJob[] {
    return [...running.values()].map(({ jobId, attempt }) => ({ jobId, attempt }));
  }

  async function tokenRejected(): Promise<boolean> {
    try {
      await client.me();
      return false;
    } catch (err) {
      return err instanceof ServerError && err.status === 401;
    }
  }

  const stopped = loop().finally(() => {
    // Whatever ended it, no job keeps running for a daemon that's gone.
    for (const job of running.values()) job.controller.abort('the daemon stopped');
  });
  return {
    stopped,
    stop() {
      stopping.abort();
      socket?.close(1000, 'stopped');
    },
  };
}

function answerFor(job: RunningJob, outcome: JobOutcome): AckedMessage {
  const ref = { jobId: job.jobId, attempt: job.attempt };
  const id = randomUUID();
  switch (outcome.kind) {
    case 'complete':
      return { v: 1, t: 'job.complete', id, d: { ...ref, result: outcome.result } };
    case 'fail':
      return { v: 1, t: 'job.fail', id, d: { ...ref, reason: outcome.reason, retryable: outcome.retryable, detail: outcome.detail.slice(0, 2_000) } };
    case 'reject':
      return { v: 1, t: 'job.reject', id, d: { ...ref, reason: outcome.reason } };
  }
}

function describeOutcome(outcome: JobOutcome): string {
  if (outcome.kind === 'complete') return 'done';
  if (outcome.kind === 'fail') return `failed (${outcome.reason.replaceAll('_', ' ')})`;
  return `turned down (${outcome.reason.replaceAll('_', ' ')})`;
}

/** Wait `ms`, or less if `signal` fires first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
```

- [ ] **Step 10: Write `nitpilot start`**

`apps/cli/src/commands/start.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import { configDir, loadConfig } from '../config/config';
import { startDaemon, type JobExecutor } from '../daemon';
import { CliError } from '../errors';
import { terminal, type Out } from '../out';

export type StartDeps = { env?: Record<string, string | undefined>; out?: Out };

/**
 * No agent adapter exists until Plan 1b Task 16, so the daemon declares no agent modes and the server
 * hands it no jobs. One that arrives anyway is turned down. Task 17 replaces this with the real executor.
 */
const noAgentYet: JobExecutor = async () => ({ kind: 'reject', reason: 'unsupported_mode' });

/** `nitpilot start` (spec §11): stay connected and run jobs until Ctrl-C. Exits with 1 when the server sends it away. */
export async function start(deps: StartDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? terminal;
  const dir = configDir(env);
  const config = loadConfig({ env, dir });
  if (!config.token) throw new CliError(`Not logged in. Run \`${BRAND.cli} login\` first.`);
  out.log('Agents are not wired in yet: this device shows notifications, but takes no jobs.');

  const daemon = startDaemon({ config, configDir: dir, out, agent: { id: config.agent, version: null, modes: [] }, executor: noAgentYet });
  // The first Ctrl-C stops cleanly. The listener is gone after it, so a second one quits at once.
  const stop = () => daemon.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const reason = await daemon.stopped;
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  return reason === 'stopped' ? 0 : 1;
}
```

In `apps/cli/src/cli.ts`, add `import { start } from './commands/start';` and, in `COMMANDS`, right after the `login` entry, add:
```ts
  start: { usage: `${BRAND.cli} start`, summary: 'Stay connected and run jobs (Ctrl-C stops)', run: (_args, out) => start({ out }) },
```

- [ ] **Step 11: Run them to see them pass**

Run: `npm test -w apps/cli && npm run typecheck -w apps/cli && npm run lint`
Expected: PASS (daemon 17, start 1, plus everything before).

- [ ] **Step 12: Explain the CLI's end of the socket**

In `docs/why/websockets.md`, before `## The React analogy`, add:
```markdown
## The CLI's end (`apps/cli/src/daemon.ts`)

`nitpilot start` holds the other end of the socket, and has to cope with everything a laptop does:

- **Reconnecting.** When the socket closes for an ordinary reason (the server restarted, the Wi-Fi dropped), the daemon waits and tries again: 1 s, then 2, 4, 8… up to 30 s (`connection/backoff.ts`). Each wait is nudged up to 20% either way at random ("jitter"): after a server restart, a hundred CLIs that all waited exactly 1 s would knock at the same instant. The wait goes back to 1 s once a `welcome` arrives.
- **Stopping.** `4401`, `4426` and `4409` mean "don't come back" (log in again, upgrade, another `nitpilot start` took over), so the daemon stops and says what to do. A rejected token is refused before the upgrade, which a WebSocket client can't tell from a network error, so after a connection that never opened the daemon asks `GET /api/me`: a 401 there means "log in again".
- **A socket that only looks alive.** After a laptop sleeps, its socket can look open while nothing gets through, and TCP may take many minutes to notice. The server answers every ping with a pong; when nothing at all has come back for about two pings, the daemon drops the socket and connects again.
- **Answers wait for an ack.** `job.complete`, `job.fail`, `job.reject` and `job.pushing` stay in an "unacked" list until the server acks them, and go again (same id) after every new `welcome`. Sending twice is safe because the server applies a result at most once and acks a second copy as `stale`. Together that gives "exactly once" where it matters: in the database.
- **"Running" until acked.** A job is listed in `hello` and in every `ping` from its `job.assign` until its answer is acked. Its lease stays alive while the answer waits for a reconnect, and after a reconnect the server binds it to this device again.

In React terms, the unacked list is an offline-first mutation queue: pending changes are kept and replayed when the app is back online, and the server's confirmation (the ack) is what removes them.
```

- [ ] **Step 13: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 14: Commit**

```bash
git add apps/cli package-lock.json docs/why/websockets.md docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents.md
git commit -m "feat(cli): nitpilot start keeps one socket open, pings, and resends answers until acked

Reconnects with backoff and jitter, stops on 4401/4426/4409, notices a dead
socket after sleep, enforces the daily job cap, and shows notifications.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: `doctor`

**Files:**
- Create: `apps/cli/src/commands/doctor.ts`, `apps/cli/src/commands/doctor.test.ts`
- Modify: `packages/protocol/src/api.ts` (`HealthResponse`), `apps/server/src/http/app.ts` (`/healthz` typed with it)
- Modify: `apps/cli/src/http.ts`, `apps/cli/src/http.test.ts` (`health()`), `apps/cli/src/cli.ts` (`doctor`)

**Interfaces:**
- Consumes: `PersonalConfig`, `PersonalConfigSchema`, `loadConfig`, `ServerClient`, `ServerError`, `CliError`, `Out`, `recordOut` (Task 5); `githubReposInRemoteList` (Task 6).
- Produces:
  - `runDoctor(deps: DoctorDeps) → Promise<Check[]>`, where `Check = { name: string; status: 'ok' | 'warn' | 'fail'; detail: string }`;
  - `type DoctorDeps = { nodeVersion; platform; run(file, args) → Promise<RunResult>; loadConfig(); client(config) → Pick<ServerClient, 'health' | 'me'>; detectAgent(id) → Promise<AgentCheck>; exists(path) }`;
  - `printChecks(checks, out) → number` (exit code: 1 when something failed);
  - `probeAgent(id, run) → Promise<AgentCheck>`, the stand-in for the adapters' `detect()` until Tasks 16, 19, 20;
  - `doctor(deps) → Promise<number>` (`nitpilot doctor`);
  - `ServerClient.health() → HealthResponse` (`GET /healthz`, no token).

**Checks** (spec §11, §18, §22), in this order, one line each:
- **Node:** major version 22 or newer, else fail.
- **Platform:** Windows → warn (unsupported in v1).
- **git:** `git --version` answers, else fail.
- **Config:** loads and is valid, else fail with the config's own message; nothing after this runs without a config.
- **Server:** `GET /healthz` answers, else fail; the account checks are skipped then.
- **Account:** no token → fail "run `nitpilot login`"; `GET /api/me` rejected → fail. **GitHub access:** `needs_reauth` → warn.
- **Agent:** the configured agent's binary answers `--version` (`claude`, `gemini`; the fake agent is built in), else fail. Whether it's logged in waits for the adapters' `detect()`.
- **Repo `<owner/name>`,** one per linked clone: the folder exists, else fail; one of its remotes points at that repo, else fail; `commit.gpgsign` is `true` → warn (a passphrase prompt would stall an address job until it times out).

- [ ] **Step 1: Write the failing tests**

`apps/cli/src/commands/doctor.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { recordOut } from '../../test/out';
import { PersonalConfigSchema } from '../config/config';
import { CliError } from '../errors';
import { ServerError } from '../http';
import { printChecks, probeAgent, runDoctor, type Check, type DoctorDeps, type RunResult } from './doctor';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
const missing: RunResult = { code: null, stdout: '', stderr: 'spawn ENOENT' };

/** A pretend `run`, answering by command line ('git --version'). Anything else exits with 1. */
function fakeRun(answers: Record<string, RunResult>): DoctorDeps['run'] {
  return async (file, args) => answers[[file, ...args].join(' ')] ?? { code: 1, stdout: '', stderr: '' };
}

const GIT: Record<string, RunResult> = {
  'git --version': ok('git version 2.47.0\n'),
  'git -C /code/shop-api remote -v': ok('origin\tgit@github.com:acme/shop-api.git (fetch)\norigin\tgit@github.com:acme/shop-api.git (push)\n'),
};

const server = {
  health: async () => ({ ok: true, version: '0.1.0' }),
  me: async () => ({ login: 'maya', avatarUrl: null, githubAuth: 'ok' as const }),
};

/** A machine where everything is fine. Each test breaks one thing. */
function healthy(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    nodeVersion: 'v22.12.0',
    platform: 'darwin',
    run: fakeRun(GIT),
    loadConfig: () => PersonalConfigSchema.parse({ server: 'https://nitpilot.test', token: 'nit_abc', repos: { 'acme/shop-api': { path: '/code/shop-api' } } }),
    client: () => server,
    detectAgent: async () => ({ ok: true, version: '2.1.29 (Claude Code)' }),
    exists: () => true,
    ...over,
  };
}

const find = (checks: Check[], name: string) => checks.find((c) => c.name === name);

describe('runDoctor', () => {
  it('passes every check on a healthy machine', async () => {
    const checks = await runDoctor(healthy());
    expect(checks.map((c) => [c.name, c.status])).toEqual([
      ['Node', 'ok'],
      ['Platform', 'ok'],
      ['git', 'ok'],
      ['Config', 'ok'],
      ['Server', 'ok'],
      ['Account', 'ok'],
      ['GitHub access', 'ok'],
      ['Agent', 'ok'],
      ['Repo acme/shop-api', 'ok'],
    ]);
  });

  it('fails on a Node older than 22', async () => {
    expect(find(await runDoctor(healthy({ nodeVersion: 'v20.18.0' })), 'Node')).toMatchObject({ status: 'fail', detail: expect.stringContaining('needs Node 22') });
  });

  it('warns on Windows', async () => {
    expect(find(await runDoctor(healthy({ platform: 'win32' })), 'Platform')).toMatchObject({ status: 'warn' });
  });

  it('fails without git', async () => {
    expect(find(await runDoctor(healthy({ run: fakeRun({ ...GIT, 'git --version': missing }) })), 'git')).toMatchObject({ status: 'fail' });
  });

  it('stops at a broken config, showing its message', async () => {
    const loadConfig = () => {
      throw new CliError('Invalid setting "concurrency" in config.json');
    };
    const checks = await runDoctor(healthy({ loadConfig }));
    expect(find(checks, 'Config')).toEqual({ name: 'Config', status: 'fail', detail: 'Invalid setting "concurrency" in config.json' });
    expect(find(checks, 'Server')).toBeUndefined();
  });

  it("fails when the server can't be reached, and skips the account checks", async () => {
    const unreachable = {
      ...server,
      health: async (): Promise<never> => {
        throw new ServerError(0, "Can't reach https://nitpilot.test: fetch failed");
      },
    };
    const checks = await runDoctor(healthy({ client: () => unreachable }));
    expect(find(checks, 'Server')).toMatchObject({ status: 'fail', detail: expect.stringContaining("Can't reach") });
    expect(find(checks, 'Account')).toBeUndefined();
  });

  it('fails when not logged in', async () => {
    const config = PersonalConfigSchema.parse({ server: 'https://nitpilot.test' });
    expect(find(await runDoctor(healthy({ loadConfig: () => config })), 'Account')).toMatchObject({ status: 'fail', detail: 'Not logged in. Run `nitpilot login`.' });
  });

  it('fails when the server rejects the token', async () => {
    const rejected = {
      ...server,
      me: async (): Promise<never> => {
        throw new ServerError(401, "The server didn't accept this device's token. Run `nitpilot login`.");
      },
    };
    expect(find(await runDoctor(healthy({ client: () => rejected })), 'Account')).toMatchObject({ status: 'fail', detail: expect.stringContaining('nitpilot login') });
  });

  it('warns when GitHub access needs a new sign-in', async () => {
    const expired = { ...server, me: async () => ({ login: 'maya', avatarUrl: null, githubAuth: 'needs_reauth' as const }) };
    expect(find(await runDoctor(healthy({ client: () => expired })), 'GitHub access')).toMatchObject({ status: 'warn' });
  });

  it('fails when the agent is not installed', async () => {
    const checks = await runDoctor(healthy({ detectAgent: async () => ({ ok: false, problem: '`claude` is not installed (or not on your PATH)' }) }));
    expect(find(checks, 'Agent')).toEqual({ name: 'Agent', status: 'fail', detail: 'claude-code: `claude` is not installed (or not on your PATH)' });
  });

  it("fails when a linked clone's folder is gone", async () => {
    expect(find(await runDoctor(healthy({ exists: () => false })), 'Repo acme/shop-api')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining("/code/shop-api doesn't exist"),
    });
  });

  it("fails when a linked clone's remotes point elsewhere", async () => {
    const run = fakeRun({ ...GIT, 'git -C /code/shop-api remote -v': ok('origin\tgit@github.com:maya/other.git (fetch)\n') });
    expect(find(await runDoctor(healthy({ run })), 'Repo acme/shop-api')).toMatchObject({ status: 'fail', detail: 'no remote in /code/shop-api points at acme/shop-api' });
  });

  it('warns when commit signing could stall a job on a passphrase prompt', async () => {
    const run = fakeRun({ ...GIT, 'git -C /code/shop-api config --get commit.gpgsign': ok('true\n') });
    expect(find(await runDoctor(healthy({ run })), 'Repo acme/shop-api')).toMatchObject({ status: 'warn', detail: expect.stringContaining('commit.gpgsign') });
  });
});

describe('probeAgent', () => {
  it("asks the agent's binary for its version", async () => {
    expect(await probeAgent('claude-code', fakeRun({ 'claude --version': ok('2.1.29 (Claude Code)\n') }))).toEqual({ ok: true, version: '2.1.29 (Claude Code)' });
    expect(await probeAgent('gemini-cli', fakeRun({ 'gemini --version': missing }))).toEqual({ ok: false, problem: '`gemini` is not installed (or not on your PATH)' });
    expect(await probeAgent('fake', fakeRun({}))).toEqual({ ok: true, version: '(built in)' });
  });
});

describe('printChecks', () => {
  it('prints one line per check, and exits with 1 only when something failed', () => {
    const out = recordOut();
    const checks: Check[] = [
      { name: 'Node', status: 'ok', detail: 'v22.12.0' },
      { name: 'Platform', status: 'warn', detail: 'Windows' },
    ];
    expect(printChecks(checks, out)).toBe(0);
    expect(out.lines).toEqual(['✓ Node: v22.12.0', '! Platform: Windows', '', 'Ready, with warnings above.']);
    expect(printChecks([{ name: 'git', status: 'fail', detail: 'missing' }], recordOut())).toBe(1);
  });
});
```

In `apps/cli/src/http.test.ts`, inside `describe('ServerClient', …)`, add:
```ts
  it('checks the server is up, without a token', async () => {
    const fetch = fakeFetch(() => json({ ok: true, version: '0.1.0' }));
    expect(await new ServerClient(SERVER, null, fetch).health()).toEqual({ ok: true, version: '0.1.0' });
    expect(fetch.calls[0]!.url.pathname).toBe('/healthz');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w apps/cli -- src/commands/doctor src/http`
Expected: FAIL: `Failed to resolve import "./doctor"`; in `http.test.ts`, `health is not a function`.

- [ ] **Step 3: Write the health check and the doctor**

In `packages/protocol/src/api.ts`, at the end, add:
```ts
// `GET /healthz` (`nitpilot doctor`)
export const HealthResponse = z.object({ ok: z.boolean(), version: z.string() });
export type HealthResponse = z.infer<typeof HealthResponse>;
```

In `apps/server/src/http/app.ts`, add `import type { HealthResponse } from '@nitpilot/protocol';` and replace `app.get('/healthz', (c) => c.json({ ok: true, version: SERVER_VERSION }));` with:
```ts
  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true, version: SERVER_VERSION };
    return c.json(body);
  });
```

In `apps/cli/src/http.ts`, add `HealthResponse` to the protocol import, and before `loginStart`, add:
```ts
  /** Is the server up, and which version? No token needed. */
  health() {
    return this.call('GET', '/healthz', HealthResponse);
  }
```

`apps/cli/src/commands/doctor.ts`:
```ts
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { BRAND, type AgentId } from '@nitpilot/protocol';
import { loadConfig, type PersonalConfig } from '../config/config';
import { githubReposInRemoteList } from '../git/remotes';
import { ServerClient } from '../http';
import { terminal, type Out } from '../out';

export type Check = { name: string; status: 'ok' | 'warn' | 'fail'; detail: string };
export type RunResult = { code: number | null; stdout: string; stderr: string };
export type AgentCheck = { ok: boolean; version?: string; problem?: string };

/** Everything doctor looks at, so tests can hand it a pretend machine. */
export type DoctorDeps = {
  nodeVersion: string;
  platform: NodeJS.Platform;
  /** Runs a program without a shell, and never throws: a missing program gives code null. */
  run(file: string, args: string[]): Promise<RunResult>;
  loadConfig(): PersonalConfig;
  client(config: PersonalConfig): Pick<ServerClient, 'health' | 'me'>;
  detectAgent(id: AgentId): Promise<AgentCheck>;
  exists(path: string): boolean;
};

const MIN_NODE = 22;

/** `nitpilot doctor` (spec §11, §22): can this machine run jobs? One check per line, in a fixed order. */
export async function runDoctor(deps: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [checkNode(deps.nodeVersion), checkPlatform(deps.platform), await checkGit(deps)];
  let config: PersonalConfig;
  try {
    config = deps.loadConfig();
  } catch (err) {
    // Without a config there's nothing more to check.
    return [...checks, { name: 'Config', status: 'fail', detail: (err as Error).message }];
  }
  checks.push({ name: 'Config', status: 'ok', detail: 'valid' });

  const client = deps.client(config);
  const server = await checkServer(client, config.server);
  checks.push(server);
  if (server.status === 'ok') checks.push(...(await checkAccount(client, config)));
  checks.push(await checkAgent(deps, config.agent));
  for (const [name, repo] of Object.entries(config.repos)) checks.push(await checkRepo(deps, name, repo.path));
  return checks;
}

function checkNode(version: string): Check {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  if (major >= MIN_NODE) return { name: 'Node', status: 'ok', detail: version };
  return { name: 'Node', status: 'fail', detail: `${version}: ${BRAND.cli} needs Node ${MIN_NODE} or newer` };
}

function checkPlatform(platform: NodeJS.Platform): Check {
  if (platform === 'win32') return { name: 'Platform', status: 'warn', detail: 'Windows is not supported in v1; use macOS, Linux or WSL' };
  return { name: 'Platform', status: 'ok', detail: platform === 'darwin' ? 'macOS' : platform };
}

async function checkGit(deps: DoctorDeps): Promise<Check> {
  const r = await deps.run('git', ['--version']);
  if (r.code === 0) return { name: 'git', status: 'ok', detail: r.stdout.trim() };
  return { name: 'git', status: 'fail', detail: 'git is not installed (or not on your PATH)' };
}

async function checkServer(client: Pick<ServerClient, 'health'>, server: string): Promise<Check> {
  try {
    const health = await client.health();
    return { name: 'Server', status: 'ok', detail: `${server} (version ${health.version})` };
  } catch (err) {
    return { name: 'Server', status: 'fail', detail: (err as Error).message };
  }
}

async function checkAccount(client: Pick<ServerClient, 'me'>, config: PersonalConfig): Promise<Check[]> {
  if (!config.token) return [{ name: 'Account', status: 'fail', detail: `Not logged in. Run \`${BRAND.cli} login\`.` }];
  try {
    const me = await client.me();
    const access: Check =
      me.githubAuth === 'ok'
        ? { name: 'GitHub access', status: 'ok', detail: `${BRAND.name} can post in your name` }
        : { name: 'GitHub access', status: 'warn', detail: `expired: sign in again at ${new URL('/', config.server).href} so ${BRAND.name} can post in your name` };
    return [{ name: 'Account', status: 'ok', detail: `logged in as ${me.login}` }, access];
  } catch (err) {
    return [{ name: 'Account', status: 'fail', detail: (err as Error).message }];
  }
}

async function checkAgent(deps: DoctorDeps, id: AgentId): Promise<Check> {
  const r = await deps.detectAgent(id);
  if (r.ok) return { name: 'Agent', status: 'ok', detail: `${id} ${r.version ?? ''}`.trim() };
  return { name: 'Agent', status: 'fail', detail: `${id}: ${r.problem ?? 'not usable'}` };
}

async function checkRepo(deps: DoctorDeps, name: string, path: string): Promise<Check> {
  const result = (status: Check['status'], detail: string): Check => ({ name: `Repo ${name}`, status, detail });
  if (!deps.exists(path)) return result('fail', `${path} doesn't exist. Link the clone again: ${BRAND.cli} repos add <path>`);
  const remotes = await deps.run('git', ['-C', path, 'remote', '-v']);
  if (!githubReposInRemoteList(remotes.stdout).includes(name)) return result('fail', `no remote in ${path} points at ${name}`);
  const signing = await deps.run('git', ['-C', path, 'config', '--get', 'commit.gpgsign']);
  if (signing.stdout.trim() === 'true') {
    return result('warn', 'commit.gpgsign is on: a passphrase prompt would stall address jobs until they time out');
  }
  return result('ok', path);
}

const MARK: Record<Check['status'], string> = { ok: '✓', warn: '!', fail: '✗' };

/** Print the checklist. The exit code is 1 when something must be fixed. */
export function printChecks(checks: Check[], out: Out): number {
  for (const c of checks) out.log(`${MARK[c.status]} ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  out.log('');
  if (failed > 0) {
    out.log(`${failed} problem${failed === 1 ? '' : 's'} to fix.`);
    return 1;
  }
  out.log(warned > 0 ? 'Ready, with warnings above.' : 'All good.');
  return 0;
}

/** Each agent's binary. The fake agent (Task 16) ships inside the CLI. */
const AGENT_BINARIES: Record<AgentId, string | null> = { 'claude-code': 'claude', 'gemini-cli': 'gemini', fake: null };

/**
 * Is the agent installed? Until the adapters' detect() exists (Tasks 16, 19, 20) this only asks the
 * binary for its version; whether it's logged in comes with the adapter.
 */
export async function probeAgent(id: AgentId, run: DoctorDeps['run']): Promise<AgentCheck> {
  const binary = AGENT_BINARIES[id];
  if (!binary) return { ok: true, version: '(built in)' };
  const r = await run(binary, ['--version']);
  if (r.code === 0) return { ok: true, version: r.stdout.trim() };
  return { ok: false, problem: `\`${binary}\` is not installed (or not on your PATH)` };
}

/** Run a program without a shell. Never throws: a missing program, or one past the 10 s timeout, gives code null. */
function runProgram(file: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) =>
    execFile(file, args, { timeout: 10_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout, stderr: stderr || (err?.message ?? '') }),
    ),
  );
}

/** `nitpilot doctor`, on this machine. */
export async function doctor(deps: { env?: Record<string, string | undefined>; out?: Out } = {}): Promise<number> {
  const out = deps.out ?? terminal;
  const env = deps.env ?? process.env;
  const checks = await runDoctor({
    nodeVersion: process.version,
    platform: process.platform,
    run: runProgram,
    loadConfig: () => loadConfig({ env }),
    client: (config) => new ServerClient(config.server, config.token),
    detectAgent: (id) => probeAgent(id, runProgram),
    exists: existsSync,
  });
  return printChecks(checks, out);
}
```

In `apps/cli/src/cli.ts`, add `import { doctor } from './commands/doctor';` and, in `COMMANDS`, right after the `status` entry, add:
```ts
  doctor: { usage: `${BRAND.cli} doctor`, summary: 'Check this machine is ready to run jobs', run: (_args, out) => doctor({ out }) },
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -w apps/cli && npm run typecheck -w apps/cli -w apps/server && npm run lint`
Expected: PASS (doctor 15, http 9, plus everything before).

- [ ] **Step 5: Try the CLI by hand**

Run: `npm run build -w apps/cli && node apps/cli/dist/index.js --help && NITPILOT_CONFIG_DIR="$(mktemp -d)" NITPILOT_SERVER=http://127.0.0.1:9 node apps/cli/dist/index.js doctor`
Expected: `--help` lists `login`, `start`, `status`, `doctor`, `repos add [path]` and `retry <pr-url>` in that order. `doctor` prints ✓ for Node, Platform, git and Config, ✗ for Server (`Can't reach http://127.0.0.1:9…`: nothing listens on port 9), no Account lines, ✓ or ✗ for Agent depending on whether `claude` is installed, and ends with `… to fix.` (exit code 1). The temporary config folder keeps your real `~/.config/nitpilot` out of it, and port 9 keeps the check off the network.

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/cli apps/server/src/http/app.ts packages/protocol/src/api.ts docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents.md
git commit -m "feat(cli): nitpilot doctor checks Node, git, config, server, account, agent and linked repos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

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
- Create: `apps/cli/test/e2e/harness.ts` (starts the Plan 1a server in-process on a random port with `FakePlatform`, the hub wired by `wireCliHub` (M6) and the task runner; plus two daemons with separate `NITPILOT_CONFIG_DIR`s and a local bare "GitHub" remote), `apps/cli/test/e2e/agent-to-agent.e2e.test.ts`, `apps/cli/test/e2e/scenarios.e2e.test.ts`.
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
- Modify: `apps/server/src/platform/types.ts` (add `findOpenPrsFor(userId)` and `listThreads(pr)` to `PlatformReads`), `apps/server/src/platform/github/reads.ts`, `apps/server/src/platform/fake/fake-platform.ts`, `apps/server/src/ws/wire.ts` (catch-up runs from a hub listener on `hello`).
- Modify (Plan 1a carry-forward): `apps/server/src/platform/github/normalize/pull-request.ts` and `apps/server/src/chats/route-event.ts`: `pull_request.edited` with `changes.base` (a base retarget) refreshes the chat's `baseRef`, `baseSha` and `trusted`.

**Interfaces:**
- Produces:
  - `catchUp(userId)`, run once per user per server boot on their first `hello`. It runs three searches with the user's token (`is:pr is:open author:<login>`, `review-requested:<login>`, `reviewed-by:<login>`; within 30 requests/minute). Each PR without a chat goes through Plan 1a's `routePrEvent` with a `pr_opened` built from `getPr`;
  - `deriveActivity(chat, jobs, connections) → agent_working{who} | agent_waiting{who, offlineSince | repo_not_linked | cap_reached} | human_turn{who} | none` (spec §9.1, never stored).

**Tests this task must include:**
- catch-up creates missing chats once and skips known ones;
- each activity case, including "offline since…" from `CliToken.lastSeenAt` and `repo_not_linked` when the user's CLIs lack the repo;
- a base retarget refreshes `baseRef` and `baseSha`, and an edit that only changes the title doesn't.

### Task 23: Read-only transcript page

**Files:**
- Create: `apps/server/src/http/routes/transcript.tsx`, `apps/server/src/http/pages/transcript.tsx`, `apps/server/src/http/routes/transcript.db.test.ts`.

**Interfaces:**
- Route `GET /c/:owner/:repo/:number` (spec §10). It requires sign-in and read access to the repo, checked with the viewer's own token (`GET /repos/{owner}/{repo}`) and cached for 5 minutes.

**Behavior:**
- The page shows the header (title, `repo#n`, phase, round x of max, the `Repo.rulesError` warning when present), the activity from Task 22, and the timeline.
- Point cards show severity, category, `file:line`, the snippet, the status and the thread.
- Styling is plain (Plan 1a's `Layout`); the real design is Plan 2.
- Plan 1a carry-forwards: `home.tsx` and `layout.tsx` take the CLI name from `BRAND`, and server pages (`/cli/approve`, the transcript) send `Content-Security-Policy: frame-ancestors 'none'`.

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
