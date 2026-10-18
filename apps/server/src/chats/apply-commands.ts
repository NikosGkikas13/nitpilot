import type { Command } from '../engine/types';
import type { Prisma } from '../generated/prisma/client';
import type { Tx } from '../lib/prisma';
import type { SeqRange } from './save';

/** Summary edits wait for 5 quiet seconds, so a burst of changes makes one GitHub request (spec §15). */
export const SUMMARY_DEBOUNCE_MS = 5_000;

export type DispatchEffects = {
  jobsChanged: boolean;
  tasksCreated: boolean;
  /** Jobs that were running on a CLI when cancelled; Plan 1b's hub sends them job.cancel. */
  cancelledJobs: { id: string; attempt: number; cliTokenId: string | null; reason: string }[];
  /** The timeline items this commit added, for the browsers following the chat (ws/web-wire.ts). Null when none. */
  timeline: SeqRange | null;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Turn the engine's commands into Job and Task rows, inside the dispatcher's transaction. */
export async function applyCommands(tx: Tx, chatId: string, commands: Command[], now: Date): Promise<DispatchEffects> {
  const effects: DispatchEffects = { jobsChanged: false, tasksCreated: false, cancelledJobs: [], timeline: null };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'enqueue_job': {
        const p = await tx.participant.findUniqueOrThrow({ where: { chatId_githubId_role: { chatId, githubId: cmd.participant.githubId, role: cmd.participant.role } } });
        // Look the account up fresh: the participant row may predate them joining Nitpilot.
        const user = await tx.user.findUnique({ where: { githubId: p.githubId } });
        if (!user) throw new Error(`cannot queue a job for ${p.login}: not on Nitpilot`);
        if (p.userId !== user.id) await tx.participant.update({ where: { id: p.id }, data: { userId: user.id } });
        const chat = await tx.prChat.findUniqueOrThrow({ where: { id: chatId }, select: { headSha: true } });
        await tx.job.create({
          data: { chatId, participantId: p.id, activeFor: p.id, userId: user.id, type: cmd.jobType, round: cmd.round, headSha: chat.headSha, sinceSha: cmd.sinceSha, applyState: cmd.applyState, draftOfId: cmd.draftOfId, runAfter: now },
        });
        effects.jobsChanged = true;
        break;
      }
      case 'cancel_jobs': {
        const jobs = await tx.job.findMany({ where: { id: { in: cmd.jobIds }, status: { in: ['queued', 'running'] } } });
        await tx.job.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { status: 'cancelled', cancelReason: cmd.reason, activeFor: null, leaseExpiresAt: null } });
        for (const j of jobs) if (j.status === 'running') effects.cancelledJobs.push({ id: j.id, attempt: j.attempt, cliTokenId: j.cliTokenId, reason: cmd.reason });
        effects.jobsChanged = true;
        break;
      }
      case 'complete_job':
        await tx.job.update({ where: { id: cmd.jobId }, data: { status: 'done', activeFor: null, leaseExpiresAt: null, result: json(cmd.result), applyState: cmd.applyState } });
        effects.jobsChanged = true;
        break;
      case 'retry_job':
        await tx.job.update({
          where: { id: cmd.jobId },
          // `failure` keeps why it waits (a daily cap, say) for the "waiting" status; fail_job overwrites it if it fails for good.
          data: { status: 'queued', runAfter: cmd.runAfter, cliTokenId: null, leaseExpiresAt: null, failure: cmd.reason, ...(cmd.refundAttempt ? { refundedAttempts: { increment: 1 } } : {}) },
        });
        effects.jobsChanged = true;
        break;
      case 'fail_job':
        await tx.job.update({ where: { id: cmd.jobId }, data: { status: 'failed', failure: cmd.reason, activeFor: null, leaseExpiresAt: null } });
        effects.jobsChanged = true;
        break;
      case 'set_apply_state':
        await tx.job.update({ where: { id: cmd.jobId }, data: { applyState: cmd.applyState } });
        effects.jobsChanged = true;
        break;
      case 'schedule':
        await upsertTask(tx, `timer:${chatId}:${cmd.key}`, { kind: 'timer', chatId, payload: json({ key: cmd.key }), runAt: cmd.at });
        effects.tasksCreated = true;
        break;
      case 'unschedule':
        await tx.task.deleteMany({ where: { dedupeKey: `timer:${chatId}:${cmd.key}`, status: 'pending' } });
        break;
      case 'upsert_summary':
        await upsertTask(tx, `summary:${chatId}`, { kind: 'summary', chatId, payload: json({}), runAt: new Date(now.getTime() + SUMMARY_DEBOUNCE_MS) });
        effects.tasksCreated = true;
        break;
      case 'post_review':
        await tx.task.create({ data: { kind: 'post_review', chatId, runAt: now, payload: json({ reviewerGithubId: cmd.reviewerGithubId, pointNumbers: cmd.pointNumbers }) } });
        effects.tasksCreated = true;
        break;
      case 'post_thread_replies':
        await tx.task.create({ data: { kind: 'thread_replies', chatId, runAt: now, payload: json({ asGithubId: cmd.asGithubId, replies: cmd.replies }) } });
        effects.tasksCreated = true;
        break;
      case 'notify':
        await tx.task.create({ data: { kind: 'notify', chatId, runAt: now, payload: json({ userIds: cmd.userIds, kind: cmd.kind, pointNumbers: cmd.pointNumbers }) } });
        effects.tasksCreated = true;
        break;
      default: {
        const unhandled: never = cmd;
        throw new Error(`Unhandled command: ${JSON.stringify(unhandled)}`);
      }
    }
  }
  return effects;
}

/** A debounce: one row per key; scheduling again moves it and makes it pending again. */
async function upsertTask(tx: Tx, dedupeKey: string, task: { kind: string; chatId: string; payload: Prisma.InputJsonValue; runAt: Date }): Promise<void> {
  await tx.task.upsert({
    where: { dedupeKey },
    create: { ...task, dedupeKey },
    update: { payload: task.payload, runAt: task.runAt, status: 'pending', attempts: 0, lastError: null },
  });
}
