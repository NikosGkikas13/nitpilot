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

/** Why this person is flagged in the chat: null when none of their roles is, 'agent' when any flagged role's newest job failed. */
export async function failureKind(chatId: string, githubId: string): Promise<FailureKind | null> {
  const flagged = await prisma.participant.findMany({ where: { chatId, githubId, attention: 'failed' }, select: { id: true } });
  if (flagged.length === 0) return null;
  for (const p of flagged) {
    if ((await kindOf(p.id)) === 'agent') return 'agent';
  }
  return 'github_post';
}

/**
 * Why the person's agent failed, for the banner: the `failure` of their newest failed job among the roles flagged
 * `failed`. A value this version doesn't know (a newer server wrote it) is null, not an error.
 */
export async function failureReasonOf(chatId: string, githubId: string): Promise<FailureReason | null> {
  const newest = await prisma.job.findFirst({
    where: { chatId, status: 'failed', participant: { githubId, attention: 'failed' } },
    orderBy: { createdAt: 'desc' },
    select: { failure: true },
  });
  const parsed = FailureReason.safeParse(newest?.failure);
  return parsed.success ? parsed.data : null;
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
