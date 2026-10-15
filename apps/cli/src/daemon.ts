import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  BRAND, CLOSE_CODES, MAX_MESSAGE_BYTES, PROTOCOL_VERSION,
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

/** How long to wait for GET /api/me when checking whether the token still works, so a dead server can't stall the daemon. */
const TOKEN_CHECK_TIMEOUT_MS = 10_000;

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

/** An answer the server hasn't acked yet. `sentAt` is when it last went out (0: never sent, or the last send failed). */
type Unacked = { msg: AckedMessage; done(status: AckStatus): void; sentAt: number };

/**
 * The engine of `nitpilot start` (spec §10, §11): keep one WebSocket to the server, say hello, ping,
 * run the jobs it hands out, and send each answer until the server acks it. Reconnects on its own with
 * backoff; stops for good on 4401, 4426 and 4409. See docs/why/websockets.md.
 */
export function startDaemon(opts: DaemonOptions): Daemon {
  const { config, executor } = opts;
  if (!config.token) throw new CliError(`Not logged in. Run \`${BRAND.cli} login\` first.`);
  const token = config.token; // a string for sure, even inside the functions below
  const out = opts.out ?? terminal;
  const notify = opts.notify ?? ((message: string) => notifyOs(message));
  const backoff = opts.backoff ?? new Backoff();
  const counter = opts.counter ?? new DailyJobCounter(opts.configDir);
  const device = (opts.device ?? hostname().replace(/\.local$/, '')).slice(0, 100) || 'unknown device';
  const client = new ServerClient(config.server, token, opts.fetch);

  /** Jobs this device holds, by jobId. */
  const running = new Map<string, RunningEntry>();
  /** Answers waiting for their ack, by message id, with when each last went out. They go again after every welcome. */
  const unacked = new Map<string, Unacked>();
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
      if (stopping.signal.aborted) break; // told to stop while asking: no retry to announce
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
          // The server may have failed while handling an answer, and then it sends no ack and the socket stays
          // open. So an answer with no ack after two pings goes again. The server applies each answer at most
          // once, so a second copy is acked as stale.
          for (const entry of unacked.values()) if (Date.now() - entry.sentAt >= 2 * pingMs) transmit(entry);
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
    for (const entry of unacked.values()) transmit(entry);
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
    try {
      if (counter.take(config.dailyJobCap)) {
        out.log(`→ ${name} (attempt ${bundle.attempt})`);
        outcome = await execute(bundle, job);
      } else {
        out.log(`✗ Turned down the ${name}: today's ${config.dailyJobCap} jobs are done (dailyJobCap).`);
        outcome = { kind: 'reject', reason: 'daily_cap' };
      }
    } catch (err) {
      // Something broke before there was an answer, e.g. the day's count couldn't be saved. The job doesn't run,
      // and the server is told, so the job isn't left listed in every ping with nobody working on it.
      outcome = crashed(err);
    }
    if (job.controller.signal.aborted) return; // cancelled or replaced meanwhile: the server has moved on

    outcome = fitForServer(job, outcome);
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
      return crashed(err);
    }
  }

  function cancelJob(ref: RunningJob & { reason: string }): void {
    const job = running.get(ref.jobId);
    if (!job || job.attempt !== ref.attempt) return; // not ours (anymore): nothing to stop
    running.delete(ref.jobId);
    job.controller.abort(ref.reason);
    out.log(`■ Stopped ${ref.jobId}: ${ref.reason.replaceAll('_', ' ')}.`);
  }

  /** Send an answer the server acks, and keep it until it does: it goes again after every reconnect, and when no ack comes. */
  function sendAcked(msg: AckedMessage): Promise<AckStatus> {
    return new Promise((resolve) => {
      const entry: Unacked = { msg, done: resolve, sentAt: 0 };
      unacked.set(msg.id, entry);
      if (welcomed) transmit(entry);
    });
  }

  /** Put an unacked answer on the socket and note when, so the ping timer knows when it's been waiting too long. */
  function transmit(entry: Unacked): void {
    if (socket?.send(entry.msg)) entry.sentAt = Date.now();
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
      await client.me({ signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(TOKEN_CHECK_TIMEOUT_MS)]) });
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

/** A job that blew up inside the daemon or its executor, as a retryable crash. */
function crashed(err: unknown): JobOutcome {
  return { kind: 'fail', reason: 'crash', retryable: true, detail: String((err as Error)?.stack ?? err) };
}

/**
 * A result the server would refuse for its size, as a retryable crash. Sent as it is, the server would close the
 * socket, and the daemon would send it again after every reconnect while the job sat "working" forever.
 */
function fitForServer(job: RunningJob, outcome: JobOutcome): JobOutcome {
  if (outcome.kind !== 'complete') return outcome;
  const bytes = Buffer.byteLength(JSON.stringify(answerFor(job, outcome)));
  if (bytes <= MAX_MESSAGE_BYTES) return outcome;
  return { kind: 'fail', reason: 'crash', retryable: true, detail: `The result is ${bytes} bytes, over the 1 MB a message may be, so it wasn't sent.` };
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
    if (signal.aborted) return resolve();
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
