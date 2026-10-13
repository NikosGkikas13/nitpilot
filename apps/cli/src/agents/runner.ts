import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { AgentAdapter, AgentEvent, AgentInvocation, AgentOutcome } from './types';

/** After SIGTERM, how long an agent gets to stop before SIGKILL (spec §12.3 L5: the tree is gone within timeout + 5 s). */
export const KILL_GRACE_MS = 5_000;
/** How much of the agent's stderr is kept, for the job's failure detail. */
const STDERR_TAIL_BYTES = 4 * 1024;
/** How long to wait for the output to close after the agent has ended (a program it left behind may hold it). */
const DRAIN_GRACE_MS = 1_000;

/** The only variables an agent gets from your environment: enough to find programs and its own settings. No tokens (spec §12.3 S3). */
const AGENT_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM'];

export function agentBaseEnv(from: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of AGENT_ENV_ALLOWLIST) {
    const value = from[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export type RunOptions = {
  /** The job's worktree. */
  cwd: string;
  timeoutMs: number;
  /** Aborted when the job is cancelled. */
  signal?: AbortSignal;
  /** Each line the adapter understood, as it comes. */
  onEvent?: (event: AgentEvent) => void;
};

/** How a run ended, and the end of what the agent printed on stderr (for the failure's detail). */
export type AgentRun = { outcome: AgentOutcome; stderrTail: string };

const TIMED_OUT: AgentOutcome = { ok: false, reason: 'timeout', retryable: true };
const CANCELLED: AgentOutcome = { ok: false, reason: 'crash', retryable: true };

/**
 * Run an agent (spec §12.2 "AgentRunner"): write its files (0600), start it in its own process group,
 * hand each stdout line to the adapter, and keep the end of stderr. A timeout or a cancel sends SIGTERM
 * to the whole group, then SIGKILL after KILL_GRACE_MS; when the agent exits, whatever it left running
 * in its group is killed too. See docs/why/child-processes.md.
 */
export function runAgent(adapter: Pick<AgentAdapter, 'parseLine' | 'outcome'>, invocation: AgentInvocation, opts: RunOptions): Promise<AgentRun> {
  // `wx`: never write through a file (or a link) that is already there.
  for (const file of invocation.files) writeFileSync(file.path, file.content, { mode: 0o600, flag: 'wx' });
  return new Promise((done) => {
    if (opts.signal?.aborted) {
      done({ outcome: CANCELLED, stderrTail: '[stopped: the job was cancelled]' });
      return;
    }
    let pending = ''; // stdout after the last line break
    let stderr = Buffer.alloc(0);
    let last: AgentEvent | undefined;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let exit: { code: number | null; signal: string | null } = { code: null, signal: null };
    let killTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;

    const child = spawn(invocation.command, invocation.args, { cwd: opts.cwd, env: invocation.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // A negative pid means "the whole group": the agent and everything it started.
    const signalAll = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // the group is gone already
      }
    };
    const stop = () => {
      signalAll('SIGTERM');
      killTimer ??= setTimeout(() => signalAll('SIGKILL'), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    const cancel = () => {
      cancelled = true;
      stop();
    };
    opts.signal?.addEventListener('abort', cancel, { once: true });

    const read = (line: string) => {
      const event = adapter.parseLine(line);
      if (!event) return;
      last = event;
      opts.onEvent?.(event);
    };
    const finish = (spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
      opts.signal?.removeEventListener('abort', cancel);
      if (pending) read(pending);
      let stderrTail = stderr.toString();
      if (timedOut) stderrTail += `\n[stopped after ${Math.round(opts.timeoutMs / 1000)} s]`;
      if (cancelled) stderrTail += '\n[stopped: the job was cancelled]';
      if (spawnError) done({ outcome: { ok: false, reason: 'crash', retryable: false }, stderrTail: `Couldn't start ${invocation.command}: ${spawnError.message}` });
      else if (timedOut) done({ outcome: TIMED_OUT, stderrTail });
      else if (cancelled) done({ outcome: CANCELLED, stderrTail });
      else done({ outcome: adapter.outcome({ ...exit, last, stderrTail }), stderrTail });
    };

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop()!;
      for (const line of lines) read(line);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]).subarray(-STDERR_TAIL_BYTES);
    });
    child.on('error', (err) => finish(err));
    child.on('exit', (code, signal) => {
      exit = { code, signal };
      signalAll('SIGKILL'); // anything the agent left running in its group
      // The output only closes once every program holding it has ended; one that left the group keeps it open.
      drainTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, DRAIN_GRACE_MS);
    });
    child.on('close', () => finish());
  });
}
