import type { ChatState, NewItem, ParticipantState, PointState } from '../engine/types';
import type { Prisma } from '../generated/prisma/client';
import type { Tx } from '../lib/prisma';

// The engine returns a whole new ChatState; here we write only what changed.
// Participants are matched by (githubId, role) and points by number: the engine's natural keys.

const PARTICIPANT_FIELDS = ['login', 'userId', 'isBot', 'auto', 'requested', 'lastReviewedSha', 'attention'] as const;
const POINT_FIELDS = ['status', 'authorResolution', 'escalationReason', 'trusted', 'githubCommentId', 'githubThreadRootId'] as const;

function pick<T, K extends keyof T>(obj: T, fields: readonly K[]): Pick<T, K> {
  return Object.fromEntries(fields.map((f) => [f, obj[f]])) as Pick<T, K>;
}

/**
 * The fields whose value differs between what was loaded and what the engine returned. Only those are written: a
 * field the engine didn't touch keeps whatever another write saved meanwhile (the review task saves a point's
 * GitHub comment id without the chat's lock). docs/why/lost-updates.md.
 */
function changedFields<T, K extends keyof T>(before: T, after: T, fields: readonly K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(fields.filter((f) => before[f] !== after[f]).map((f) => [f, after[f]])) as Partial<Pick<T, K>>;
}

export async function saveChatState(tx: Tx, chatId: string, before: ChatState, after: ChatState, now: Date): Promise<void> {
  await tx.prChat.update({
    where: { id: chatId },
    data: {
      phase: after.phase,
      round: after.round,
      addressPasses: after.addressPasses,
      extraRounds: after.extraRounds,
      headSha: after.headSha,
      isDraft: after.isDraft,
      trusted: after.trusted,
      merged: after.merged,
      // Keep the original close time; clear it on reopen.
      closedAt: after.closed ? (before.closed ? undefined : now) : null,
      pointCount: after.points.length,
    },
  });

  for (const p of after.participants) {
    const old = before.participants.find((b) => b.githubId === p.githubId && b.role === p.role);
    if (!old) {
      await tx.participant.create({ data: { chatId, githubId: p.githubId, role: p.role, ...pick(p, PARTICIPANT_FIELDS) } });
    } else {
      const data = changedFields<ParticipantState, (typeof PARTICIPANT_FIELDS)[number]>(old, p, PARTICIPANT_FIELDS);
      if (Object.keys(data).length > 0) await tx.participant.update({ where: { chatId_githubId_role: { chatId, githubId: p.githubId, role: p.role } }, data });
    }
  }

  for (const pt of after.points) {
    const old = before.points.find((b) => b.number === pt.number);
    if (!old) {
      await tx.point.create({
        data: {
          chatId,
          number: pt.number,
          raisedByGithubId: pt.raisedBy,
          origin: pt.origin,
          jobId: pt.jobId,
          githubCommentId: pt.githubCommentId,
          githubThreadRootId: pt.githubThreadRootId,
          path: pt.path,
          line: pt.line,
          side: pt.side,
          commitSha: pt.commitSha,
          severity: pt.severity,
          category: pt.category,
          title: pt.title,
          body: pt.body,
          snippet: (pt.snippet ?? undefined) as Prisma.InputJsonValue | undefined,
          status: pt.status,
          authorResolution: pt.authorResolution,
          escalationReason: pt.escalationReason,
          trusted: pt.trusted,
          round: pt.round,
        },
      });
    } else {
      const data = changedFields<PointState, (typeof POINT_FIELDS)[number]>(old, pt, POINT_FIELDS);
      if (Object.keys(data).length > 0) await tx.point.update({ where: { chatId_number: { chatId, number: pt.number } }, data });
    }
  }
}

/** The seqs a commit added to a chat's timeline, first to last. */
export type SeqRange = { fromSeq: number; toSeq: number };

/** Append timeline items with the next sequence numbers (the chat's resume cursor). Returns their seqs, or null for none. */
export async function appendTimeline(tx: Tx, chatId: string, items: NewItem[]): Promise<SeqRange | null> {
  if (items.length === 0) return null;
  const { lastSeq } = await tx.prChat.update({ where: { id: chatId }, data: { lastSeq: { increment: items.length } }, select: { lastSeq: true } });
  const first = lastSeq - items.length + 1;
  await tx.message.createMany({
    data: items.map((item, i) => ({
      chatId,
      seq: first + i,
      kind: item.kind,
      authorGithubId: item.author?.githubId ?? null,
      authorLogin: item.author?.login ?? null,
      pointNumber: item.pointNumber,
      jobId: item.jobId,
      body: item.body,
      data: (item.data ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
  return { fromSeq: first, toSeq: lastSeq };
}
