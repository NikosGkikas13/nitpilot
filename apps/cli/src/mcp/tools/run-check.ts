import { spawn } from 'node:child_process';
import type { McpJobContext } from '../context';
import { ToolError } from '../tool';

/** How long one check may run. Tests and linters on a big repo can take minutes; one that hangs must not hold the job. */
export const CHECK_TIMEOUT_MS = 10 * 60_000;
/** How much of a check's output goes back to the agent: the end, where the failures are. */
export const OUTPUT_TAIL_BYTES = 4 * 1024;
/** How long to wait for the output to close after the check has ended. */
const DRAIN_GRACE_MS = 1000;

/** The only variables a check gets from your environment: enough to find programs and your tool settings, no tokens. */
const CHECK_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'];

export type CheckResult = { ok: boolean; exitCode: number | null; outputTail: string };

/**
 * `run_check`: run one of the repo's checks from your config (`repos[repo].checks`, spec §13) in the
 * job's worktree. Address jobs only. The agent picks a name, never a command.
 */
export async function runCheck(ctx: McpJobContext, args: { name: string }, opts: { timeoutMs?: number } = {}): Promise<CheckResult> {
  // Object.hasOwn: a name like "constructor" is not a check, whatever plain objects inherit.
  if (!Object.hasOwn(ctx.checks, args.name)) {
    const names = Object.keys(ctx.checks);
    throw new ToolError(names.length > 0 ? `There's no check called "${args.name}". You can run: ${names.join(', ')}.` : 'No checks are set up for this repo.');
  }
  return runInWorktree(ctx.checks[args.name]!, {
    cwd: ctx.worktree.dir,
    env: checkEnv(ctx.worktree.git.env ?? process.env),
    timeoutMs: opts.timeoutMs ?? CHECK_TIMEOUT_MS,
    signal: ctx.worktree.git.signal,
  });
}

/** The allowlist, plus `CI=true` so test runners run once and never wait for input, and `NO_COLOR` for plain output. */
function checkEnv(from: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of CHECK_ENV_ALLOWLIST) {
    const value = from[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, CI: 'true', NO_COLOR: '1' };
}

/**
 * Run a command in a folder with `spawn` and an argument list: no shell, so `;` or `$(…)` in an
 * argument is just text. It gets its own process group, so a timeout or a cancel stops everything it
 * started, and so does its own exit (a test runner's leftover server goes too). A program that left the
 * group on purpose (a daemon) isn't stopped, but we stop waiting for its output a second after the check ends.
 * See docs/why/child-processes.md.
 */
export function runInWorktree(argv: readonly string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number; signal?: AbortSignal }): Promise<CheckResult> {
  const [command, ...args] = argv;
  return new Promise((done) => {
    // addEventListener('abort') never fires for a signal that is already aborted, so look first.
    if (opts.signal?.aborted) {
      done({ ok: false, exitCode: null, outputTail: '[stopped: the job was cancelled]' });
      return;
    }
    let tail = Buffer.alloc(0);
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let exitCode: number | null = null;
    let drainTimer: NodeJS.Timeout | undefined;
    const child = spawn(command!, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // A negative pid means "the whole group": the command and everything it started.
    const stopAll = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // the group is gone already
      }
    };
    const keep = (chunk: Buffer) => {
      tail = Buffer.concat([tail, chunk]).subarray(-OUTPUT_TAIL_BYTES);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopAll();
    }, opts.timeoutMs);
    const cancel = () => {
      aborted = true;
      stopAll();
    };
    opts.signal?.addEventListener('abort', cancel, { once: true });
    const stoppedNote = () => (timedOut ? `\n[stopped after ${Math.round(opts.timeoutMs / 1000)} s]` : aborted ? '\n[stopped: the job was cancelled]' : '');
    // The tail is cut by bytes, so it can start in the middle of a character: drop the leftover bytes of that one.
    const tailText = () => {
      let start = 0;
      while (start < tail.length && (tail[start]! & 0xc0) === 0x80) start++;
      return tail.subarray(start).toString();
    };
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      opts.signal?.removeEventListener('abort', cancel);
      done(result);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('exit', (code) => {
      exitCode = code;
      stopAll();
      // The output only closes when every program holding it has ended. One that left the group keeps it
      // open, so after a short grace we let go of the pipes and answer anyway.
      drainTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish({ ok: exitCode === 0 && !timedOut && !aborted, exitCode, outputTail: `${tailText()}${stoppedNote()}\n[stopped waiting: a program the check started still holds its output]` });
      }, DRAIN_GRACE_MS);
    });
    child.on('error', (err) => finish({ ok: false, exitCode: null, outputTail: `Couldn't start ${command}: ${err.message}` }));
    child.on('close', (code) => {
      finish({ ok: code === 0 && !timedOut && !aborted, exitCode: code, outputTail: tailText() + stoppedNote() });
    });
  });
}
