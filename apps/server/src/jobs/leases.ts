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
