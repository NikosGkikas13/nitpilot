# Plan 1b: CLI and Agents (M6–M13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: M6 at step level; M7–M13 at task level.** M6 (Tasks 1–4) has full TDD steps (test and implementation code, exact commands, expected output), written on 2026-10-09 against Plan 1a's merged code (`main` at `6417c39`). "Checked against Plan 1a's code" below lists where it differs from the earlier task-level text. M7–M13 still fix only the tasks, files, interfaces and tests; their step-level code is written one milestone at a time, against the code that exists by then. Nobody executes a task that is still at task level.

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

- [ ] **Step 1: Write the failing protocol test**

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

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w packages/protocol -- src/messages.test.ts`
Expected: FAIL in `uses the spec close codes and path` (`replaced` missing, `CLI_WS_PATH` undefined).

- [ ] **Step 3: Add the close code and the path**

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

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -w packages/protocol`
Expected: PASS (40 tests).

- [ ] **Step 5: Install `ws`**

Node has a built-in WebSocket *client* (the CLI will use it), but no server, so the server uses the `ws` package.

Run: `npm install ws -w apps/server && npm install -D @types/ws -w apps/server`
Expected: `apps/server/package.json` gains `"ws": "^8…"` in `dependencies` and `"@types/ws": "^8…"` in `devDependencies` (8.22 and 8.18 on 2026-10-09).

- [ ] **Step 6: Add `touchCliToken`**

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

- [ ] **Step 7: Add the test helpers**

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

- [ ] **Step 8: Write the failing hub tests**

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

- [ ] **Step 9: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/ws`
Expected: FAIL, `Failed to resolve import "./cli-hub"`.

- [ ] **Step 10: Write the hub**

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

- [ ] **Step 11: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/ws && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (cli-hub 9).

- [ ] **Step 12: Attach the hub to the server**

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

- [ ] **Step 13: Write the explainer**

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

- [ ] **Step 14: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 15: Commit**

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

- [ ] **Step 1: Write the failing bundle tests**

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

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/jobs/bundle`
Expected: FAIL, `Failed to resolve import "./bundle"`.

- [ ] **Step 3: Let `gitSpec` work from a saved chat**

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

- [ ] **Step 4: Write the bundle builder**

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

- [ ] **Step 5: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/jobs/bundle && npm run typecheck -w apps/server`
Expected: PASS (bundle 5).

- [ ] **Step 6: Write the failing assigner tests**

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

- [ ] **Step 7: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/jobs/assign`
Expected: FAIL, `Failed to resolve import "../src/ws/wire"`.

- [ ] **Step 8: Write the assigner**

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

- [ ] **Step 9: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/jobs && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (assign 10, bundle 5).

- [ ] **Step 10: Run the assigner in the server**

In `apps/server/src/main.ts`:
- add the import `import { wireCliHub } from './ws/wire';`;
- after the `dispatcher.onCommit((_chatId, effects) => { … runner.wake(); });` block, add:
  ```ts
  // Jobs → CLIs: the assigner, and from Task 3 on, leases (ws/wire.ts).
  const cliJobs = wireCliHub({ hub, dispatcher, platform });
  ```
- after `runner.start();`, add `cliJobs.start();`;
- in `shutdown`, after `runner.stop();`, add `cliJobs.stop();`.

- [ ] **Step 11: Explain job hand-out**

In `docs/why/websockets.md`, before `## Leases, in one paragraph`, add:
```markdown
## Handing out a job (`jobs/assign.ts`)

The server doesn't ask CLIs "do you want this job?". From `hello` it already knows which repos each CLI has linked, which kinds of job its agent can do, and how many jobs it runs at once, so it picks one and sends `job.assign`.

Picking is a compare-and-swap (explained in [cli-login.md](cli-login.md)): the job moves from `queued` to `running` only if it is still `queued`, so two passes of the assigner can never hand out the same job twice. The same update adds 1 to `attempt`, starts a 90-second lease, and moves the job to the PR's newest commit, because a job that waited in the queue should review what's there now (spec §9.4).

The assigner runs when something changes (a job was queued or finished, a CLI said hello) and every 5 seconds for jobs waiting out a retry delay. Like the task runner, it never runs two passes at once.

The job travels as a self-contained **bundle** (`jobs/bundle.ts`): the PR, how to fetch its code, the points with their threads, human notes and the team rules. The CLI never has to call back for more.
```

- [ ] **Step 12: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 13: Commit**

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

- [ ] **Step 1: Write the failing engine tests**

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

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/engine/results src/engine/failures`
Expected: FAIL in the two new tests (the engine still applies the old attempt's result and retries its failure).

- [ ] **Step 3: Fence job events by attempt in the engine**

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

- [ ] **Step 4: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/engine/results src/engine/failures`
Expected: PASS.

- [ ] **Step 5: Give every existing job event its attempt**

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

- [ ] **Step 6: Write the failing lease tests**

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

- [ ] **Step 7: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/jobs/leases`
Expected: FAIL, `Failed to resolve import "./leases"`.

- [ ] **Step 8: Teach the hub about silence**

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

- [ ] **Step 9: Write the leases**

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

- [ ] **Step 10: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/jobs src/ws && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (leases 9, assign 10, bundle 5, cli-hub 9).

- [ ] **Step 11: Renew leases at boot**

In `apps/server/src/main.ts`, before `cliJobs.start();`, add:
```ts
  // The server was away, not the CLIs: running jobs get a fresh lease, so CLIs that reconnect keep them.
  await cliJobs.leases.renewAfterRestart();
```

- [ ] **Step 12: Write the explainer**

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

- [ ] **Step 13: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 14: Commit**

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

- [ ] **Step 1: Write the failing engine tests**

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

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit -w apps/server -- src/engine/results`
Expected: FAIL in `moves the head to the commit it pushed` (`head1`, not `head2`). The second test already passes; it guards the condition.

- [ ] **Step 3: Move the head on our own push**

In `apps/server/src/engine/results.ts`, in `applyAddress`, after `const commit = result.push?.to ?? null;`, add:
```ts
  // Our own push: move the head now, so the re-review queued below runs on the pushed commit instead
  // of waiting for GitHub's push webhook. Only when nothing else moved the head meanwhile.
  if (result.push && chat.headSha === result.push.from) chat.headSha = result.push.to;
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm run test:unit -w apps/server -- src/engine`
Expected: PASS.

- [ ] **Step 5: Write the failing hub-message tests**

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
    expect(await row()).toMatchObject({ status: 'queued', attempt: 0, runAfter: later(60 * 60_000) });
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

- [ ] **Step 6: Run them to see them fail**

Run: `npm run test:db -w apps/server -- src/ws/handlers src/tasks/cli-notifier`
Expected: FAIL. `handlers.db.test.ts`: `no ack within 2000 ms` (nothing answers job messages yet), and the cancel tests time out waiting for `job.cancel`. `cli-notifier.db.test.ts`: `Failed to resolve import "./cli-notifier"`.

- [ ] **Step 7: Handle the CLI's job messages**

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

- [ ] **Step 8: Send notifications to CLIs**

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

- [ ] **Step 9: Wire job messages and cancels**

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

- [ ] **Step 10: Run them to see them pass**

Run: `npm run test:db -w apps/server -- src/ws src/jobs src/tasks/cli-notifier && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (handlers 11, cli-notifier 2, cli-hub 9, assign 10, bundle 5, leases 9).

- [ ] **Step 11: Notify through the CLIs in the server**

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

- [ ] **Step 12: Update the explainers**

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

- [ ] **Step 13: Write the stand-in CLI for the live check**

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

- [ ] **Step 14: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 15: Commit**

```bash
git add apps/server docs/why/dispatcher.md docs/why/outbox-and-restarts.md
git commit -m "feat(server): CLI results, push acks, cancels and notifications over the hub

An address job's own push moves the chat head at once. Adds scripts/fake-cli.ts
for live checks before the real CLI exists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 16: Live checkpoint: a summary comment on real GitHub**

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

- [ ] **Step 17: Record the result**

Add a `Task 4 live check:` line to the ledger with the PR number, the comment's URL, the seconds from opening the PR to `job.assign`, and whether the mention showed as code. If anything needed a fix, list the fix commit.

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
- Modify: `packages/protocol/src/index.ts` and `packages/protocol/package.json`: the test samples move to a separate `@nitpilot/protocol/test-samples` export, so the CLI bundle doesn't ship them (Plan 1a deferred minor M8). Update the server tests that import `samples`.
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

### Task 6: `login`, `status`, `repos add`, `retry`

**Files:**
- Create: `apps/cli/src/commands/login.ts`, `apps/cli/src/commands/status.ts`, `apps/cli/src/commands/repos.ts`, `apps/cli/src/commands/retry.ts`, `apps/cli/src/git/remotes.ts`, and a test for each.
- Modify (server, Plan 1a carry-forwards): `apps/server/src/http/routes/cli.ts` (`POST /api/chats/:id/retry`, and at most 10 `POST /api/cli/login` per minute per client address, counted in memory); `apps/server/src/ingest/record.ts` (`purgeOldRows` also deletes `CliLoginRequest` rows older than a day); the engine gets a `retry_requested { who }` event that queues that participant's job again, with table tests.

**Interfaces:**
- Consumes: `ServerClient`, `CliLoginPollResponse`, `MeResponse`, `MyChatsResponse`, `safeGit` (Task 9; use plain `execFile` git here until then).
- Produces:
  - `login({ open?, sleep? })`;
  - `status()`;
  - `reposAdd(path?)`;
  - `parseGithubRemote(url) → 'owner/name' | null`, which accepts https, `git@github.com:` and SSH host aliases such as `git@github-a:owner/name.git` (spec §17).

**Behavior:**
- **login** prints "enter WDJB-MJHT at https://…/cli/approve", opens the browser (`open`/`xdg-open` via `execFile`), polls every `interval` until approved, denied or expired, and saves the token.
- **status** prints the login, a `needs_reauth` warning, and a table of chats; a chat whose attention is `failed` suggests `nitpilot retry <pr-url>`.
- **repos add** records `repos["owner/name"] = { path }` from the clone's remotes.
- **retry** asks the server to queue your failed job on that PR again (Plan 2 adds the Retry button).

**Tests this task must include:**
- the login handshake against Plan 1a's app running in-process;
- denied and expired paths;
- remote parsing table (https, ssh, host alias, non-GitHub → null);
- `repos add` outside a git repo gives a clear error;
- retry re-queues a failed job and clears `attention: failed`; it refuses a chat where you have nothing failed;
- the 11th login start in a minute gets 429; old login requests are purged.

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
- A job counts as running (in `hello` and every `ping`) from the moment its `job.assign` arrives until its result is acked. The server takes back a job that two pings in a row leave out (M6, Task 3).
- The server never assigns more than `concurrency` jobs, so the daemon just runs what it gets.
- `dailyJobCap` is counted per local day in `state.json`; a job over the cap gets `job.reject { reason: 'daily_cap' }`.
- `job.complete`, `job.fail` and `job.reject` each wait for their `ack`; one not acked before a disconnect is sent again after the next `welcome`. `stale` means "not yours anymore": drop it. The server applies a result at most once (M6, Task 4).
- `job.cancel` aborts the executor; a cancel for a job the daemon doesn't know is ignored.
- `notify` prints and shows an OS notification (macOS `osascript`, Linux `notify-send`, both via `execFile`; otherwise print only).
- `4401` → stop: "run `nitpilot login`". `4426` → stop: "upgrade the CLI". `4409` → stop: "another `nitpilot start` on this device took over". Anything else → reconnect with backoff.

**Tests this task must include** (fake timers and a fake WebSocket server):
- backoff sequence and jitter bounds, and the reset after welcome;
- hello contents;
- the ping cadence;
- the daily cap rejects the 41st job;
- `job.cancel` aborts a running executor;
- `4401` and `4409` stop without reconnecting;
- a `job.complete` sent just before a disconnect is sent again after reconnecting, and a `stale` ack drops it;
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
