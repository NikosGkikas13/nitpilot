import type { MessageKind, TimelineItem } from '@nitpilot/protocol';
import type { Message } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

/** Timeline items go to the browser in pages of at most this many, over REST and over `/ws/web`. */
export const ITEMS_PER_PAGE = 200;

/** Which point each GitHub thread belongs to: a thread's root comment id → the point's number. */
export type ThreadPoints = ReadonlyMap<string, number>;

/** A stored timeline item, as the web app reads it. A person's reply in a point's GitHub thread is given that point's number. */
export function toTimelineItem(m: Message, threads: ThreadPoints): TimelineItem {
  const data = (m.data as Record<string, unknown> | null) ?? null;
  const threadRootId = typeof data?.threadRootId === 'string' ? data.threadRootId : null;
  return {
    seq: m.seq,
    kind: m.kind as MessageKind,
    author: m.authorGithubId && m.authorLogin ? { githubId: m.authorGithubId, login: m.authorLogin } : null,
    pointNumber: m.pointNumber ?? (threadRootId ? (threads.get(threadRootId) ?? null) : null),
    jobId: m.jobId,
    body: m.body,
    data,
    at: m.createdAt.toISOString(),
  };
}

/** The chat's points by their GitHub thread: by the thread's root comment, and by the point's own comment. */
export async function threadPointsOf(chatId: string): Promise<ThreadPoints> {
  const points = await prisma.point.findMany({ where: { chatId }, select: { number: true, githubCommentId: true, githubThreadRootId: true } });
  const threads = new Map<string, number>();
  for (const p of points) {
    if (p.githubCommentId) threads.set(p.githubCommentId, p.number);
    if (p.githubThreadRootId) threads.set(p.githubThreadRootId, p.number);
  }
  return threads;
}

/** Every item after `afterSeq`, oldest first: what a browser that reconnects missed (spec §10 "Resuming without gaps"). */
export async function loadItemsAfter(chatId: string, afterSeq: number): Promise<TimelineItem[]> {
  const [messages, threads] = await Promise.all([
    prisma.message.findMany({ where: { chatId, seq: { gt: afterSeq } }, orderBy: { seq: 'asc' } }),
    threadPointsOf(chatId),
  ]);
  return messages.map((m) => toTimelineItem(m, threads));
}
