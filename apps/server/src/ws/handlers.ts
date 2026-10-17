import type { RunningJob } from '@nitpilot/protocol';
import type { Dispatch } from '../chats/dispatch';
import { refreshHead } from '../chats/refresh-head';
import type { DecideOutput, DomainEvent } from '../engine/types';
import { currentAttempt } from '../jobs/leases';
import { prisma } from '../lib/prisma';
import type { PlatformReads } from '../platform/types';
import type { CliConnection, MessageListener } from './cli-hub';

type AckStatus = 'applied' | 'stale';
type JobEvent = Extract<DomainEvent, { type: 'job_completed' | 'job_failed' }>;

/**
 * What a CLI reports about a job (spec §10): the push it's about to make, the result, a failure or
 * a refusal. Each is answered with an ack: `applied`, or `stale` when it's about an attempt that is
 * no longer current (see docs/why/leases-and-fencing.md).
 */
export function jobMessageHandler(deps: { dispatch: Dispatch; platform: PlatformReads }): MessageListener {
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
        const status = await report(deps.dispatch, conn, { type: 'job_failed', jobId, attempt, reason, retryable });
        // Logged after the fencing check, so the line says whether the server took it. The detail comes
        // from the CLI and may span lines; JSON.stringify keeps it on one log line.
        console.warn(`[cli] ${conn.login}/${conn.device}: job ${jobId} attempt ${attempt} failed (${reason}, ack ${status}): ${JSON.stringify(detail)}`);
        ack(conn, msg.id, status);
        // The PR is somewhere else than the job thought: make sure the chat knows where, or every retry fails alike.
        if (reason === 'stale_head' && status === 'applied') await refreshHeadOf(jobId, deps);
        return;
      }
      case 'job.reject': {
        // The CLI turned the job down (daily cap, repo not linked there, …). The engine decides how long to wait.
        const { jobId, attempt, reason } = msg.d;
        return ack(conn, msg.id, await report(deps.dispatch, conn, { type: 'job_failed', jobId, attempt, reason, retryable: true }));
      }
      default:
        // hello and ping (with its usedToday) belong to jobs/leases.ts; job.progress to ws/web-wire.ts.
        return;
    }
  };
}

async function refreshHeadOf(jobId: string, deps: { dispatch: Dispatch; platform: PlatformReads }): Promise<void> {
  try {
    const { chatId } = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { chatId: true } });
    await refreshHead(chatId, deps);
  } catch (err) {
    // The retry still happens; it just may find the same old head once more.
    console.error(`[stale_head] couldn't check job ${jobId}'s PR head on GitHub:`, err);
  }
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
