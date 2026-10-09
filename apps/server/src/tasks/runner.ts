import type { Task } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { GithubError } from '../platform/github/client';

export type TaskHandler = (task: Task) => Promise<void>;
export type TaskHandlers = Partial<Record<string, TaskHandler>>;

/** Throw this from a handler when trying again cannot help. Pass the original error as `cause`. */
export class PermanentTaskError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentTaskError';
  }
}

/** Attempts before giving up: the waits between them add up to about an hour (see backoffMs). */
export const MAX_TASK_ATTEMPTS = 13;

/** 5 s, 10 s, 20 s, 40 s, … capped at 10 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** (attempt - 1), 10 * 60_000);
}

/** Called once a task has failed for good, so the people it was for can be told. */
export type GiveUpHandler = (task: Task, error: unknown) => Promise<void>;

/**
 * Runs due Task rows: GitHub writes, notifications and timers (spec §7). Every second, and right
 * away when woken. See docs/why/outbox-and-restarts.md.
 */
export class TaskRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private again = false;

  constructor(
    private readonly handlers: TaskHandlers,
    private readonly opts: { tickMs?: number; now?: () => Date; onGiveUp?: GiveUpHandler } = {},
  ) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run due tasks now instead of waiting for the next tick. */
  wake(): void {
    void this.tick();
  }

  /** One pass over due tasks. Never overlaps itself: a call during a pass asks for one more pass. */
  async tick(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.again = false;
        await this.runDue();
      } while (this.again);
    } catch (err) {
      console.error('[tasks] pass failed:', err);
    } finally {
      this.busy = false;
    }
  }

  /** Run every due task, oldest first. Returns how many ran. */
  async runDue(limit = 50): Promise<number> {
    const due = await prisma.task.findMany({
      where: { status: 'pending', runAt: { lte: this.now() } },
      orderBy: { runAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let ran = 0;
    for (const { id } of due) {
      if (await this.claim(id)) {
        await this.runOne(id);
        ran += 1;
      }
    }
    return ran;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Compare-and-swap pending → running, so a task never runs twice at once. */
  private async claim(id: string): Promise<boolean> {
    const { count } = await prisma.task.updateMany({ where: { id, status: 'pending' }, data: { status: 'running', attempts: { increment: 1 } } });
    return count === 1;
  }

  private async runOne(id: string): Promise<void> {
    const task = await prisma.task.findUniqueOrThrow({ where: { id } });
    try {
      const handler = this.handlers[task.kind];
      if (!handler) throw new PermanentTaskError(`no handler for task kind "${task.kind}"`);
      await handler(task);
      // Only if still running: a task rescheduled meanwhile (a debounce) stays pending.
      await prisma.task.updateMany({ where: { id, status: 'running' }, data: { status: 'done', lastError: null } });
    } catch (err) {
      const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      const final = err instanceof PermanentTaskError || task.attempts >= MAX_TASK_ATTEMPTS;
      console.error(`[tasks] ${task.kind} ${id} failed (attempt ${task.attempts}${final ? ', giving up' : ''}): ${lastError}`);
      if (!final) {
        // When GitHub rate-limits us it says how long to wait; asking sooner only fails again.
        const hinted = err instanceof GithubError ? (err.retryAfterMs ?? 0) : 0;
        const runAt = new Date(this.now().getTime() + Math.max(backoffMs(task.attempts), hinted));
        await prisma.task.updateMany({ where: { id, status: 'running' }, data: { status: 'pending', lastError, runAt } });
        return;
      }
      const { count } = await prisma.task.updateMany({ where: { id, status: 'running' }, data: { status: 'failed', lastError } });
      if (count === 1) await this.giveUp(task, err);
    }
  }

  private async giveUp(task: Task, err: unknown): Promise<void> {
    try {
      await this.opts.onGiveUp?.(task, err);
    } catch (reportErr) {
      console.error(`[tasks] could not report that ${task.kind} ${task.id} failed:`, reportErr);
    }
  }
}

/** At boot: a task left `running` belonged to a process that died. Run it again; handlers are idempotent. */
export async function recoverRunningTasks(): Promise<number> {
  const { count } = await prisma.task.updateMany({ where: { status: 'running' }, data: { status: 'pending' } });
  return count;
}
