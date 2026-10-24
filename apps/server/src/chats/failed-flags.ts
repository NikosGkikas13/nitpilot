import { FailureReason, type Role } from '@nitpilot/protocol';
import type { Person } from '../engine/types';
import { prisma } from '../lib/prisma';
import type { Dispatch } from './dispatch';

/**
 * Two things flag a person `failed` in a chat:
 * - 'agent': their agent's job failed for good (spec §9.4). Running it again can help: `nitpilot retry`.
 * - 'github_post': a review or replies in their name never reached GitHub (spec §15, `write_failed`).
 *   Running the agent again won't fix that; signing in again does.
 * The flag doesn't say which, so look at their newest job in that role: if it failed, the agent did.
 */
export type FailureKind = 'agent' | 'github_post';

async function kindOf(participantId: string): Promise<FailureKind> {
  const newest = await prisma.job.findFirst({ where: { participantId }, orderBy: { createdAt: 'desc' }, select: { status: true } });
  return newest?.status === 'failed' ? 'agent' : 'github_post';
}

/**
 * Why this person is flagged in the chat, and for an agent failure, the reason it gave (`Job.failure`). One query:
 * each role they hold that is flagged `failed`, with that role's newest job. The first role whose newest job failed
 * is the agent's failure, and the reason comes from that same job. A reason this version doesn't know (a newer
 * server wrote it) is null, not an error. Null when none of their roles is flagged.
 */
export async function failureOf(chatId: string, githubId: string): Promise<{ kind: FailureKind; reason: FailureReason | null } | null> {
  const flagged = await prisma.participant.findMany({
    where: { chatId, githubId, attention: 'failed' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, failure: true } } },
  });
  if (flagged.length === 0) return null;
  const failedJob = flagged.map((p) => p.jobs[0]).find((job) => job?.status === 'failed');
  if (!failedJob) return { kind: 'github_post', reason: null };
  const reason = FailureReason.safeParse(failedJob.failure);
  return { kind: 'agent', reason: reason.success ? reason.data : null };
}

/** Why this person is flagged in the chat: null when none of their roles is, 'agent' when any flagged role's newest job failed. */
export async function failureKind(chatId: string, githubId: string): Promise<FailureKind | null> {
  return (await failureOf(chatId, githubId))?.kind ?? null;
}

/**
 * Someone signed in again, so writes in their name work again. In each chat where a failed GitHub write
 * flagged them, clear those flags and let the chat carry on: one `signed_in_again` event per chat.
 * Returns how many chats that was.
 */
export async function resumeAfterSignIn(user: { id: string; githubId: string; login: string }, dispatch: Dispatch): Promise<number> {
  const flagged = await prisma.participant.findMany({ where: { githubId: user.githubId, attention: 'failed' }, select: { id: true, chatId: true, role: true } });
  const rolesByChat = new Map<string, Role[]>();
  for (const p of flagged) {
    if ((await kindOf(p.id)) !== 'github_post') continue;
    rolesByChat.set(p.chatId, [...(rolesByChat.get(p.chatId) ?? []), p.role as Role]);
  }
  const who: Person = { githubId: user.githubId, login: user.login, isBot: false, userId: user.id };
  for (const [chatId, roles] of rolesByChat) {
    try {
      await dispatch(chatId, { type: 'signed_in_again', who, roles });
    } catch (err) {
      // One chat that can't be updated doesn't stop the sign-in, or the other chats.
      console.error(`[sign-in] couldn't resume chat ${chatId} for ${user.login}:`, err);
    }
  }
  return rolesByChat.size;
}
