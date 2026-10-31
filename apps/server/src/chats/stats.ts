import type { StatsDays, StatsResponse } from '@nitpilot/protocol';
import { READY_LINE } from '../engine/advance';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

const DAY_MS = 86_400_000;

/**
 * Your stats for the last `days` days (`GET /api/me/stats`, spec §10). Read from what's already stored: points, the
 * chats' review jobs, and the "Ready for approval" timeline line. Each point counts by where it is now.
 */
export async function loadStats(user: { githubId: string }, days: StatsDays, now = new Date()): Promise<StatsResponse> {
  const since = new Date(now.getTime() - days * DAY_MS);
  // Points your agent raised in the window. A point you wrote on GitHub yourself has origin `github`.
  const yourAgents = { raisedByGithubId: user.githubId, origin: 'agent', createdAt: { gte: since } } satisfies Prisma.PointWhereInput;
  const notEscalated = { ...yourAgents, status: { not: 'escalated' } } satisfies Prisma.PointWhereInput;
  const [raised, fixed, declined, escalated, medianMsToReady] = await Promise.all([
    prisma.point.count({ where: yourAgents }),
    prisma.point.count({ where: { ...notEscalated, authorResolution: 'fixed' } }),
    prisma.point.count({ where: { ...notEscalated, authorResolution: 'declined' } }),
    prisma.point.count({ where: { ...yourAgents, status: 'escalated' } }),
    medianTimeToReady(user.githubId, since),
  ]);
  return { days, raised, fixed, declined, escalated, medianMsToReady };
}

/**
 * In the chats you're in (as author or reviewer) that first became ready in the window: the median time from the
 * chat's first review job being queued to its first "Ready for approval". Null when there is no such chat.
 */
async function medianTimeToReady(githubId: string, since: Date): Promise<number | null> {
  const inYourChats = { chat: { participants: { some: { githubId } } } } satisfies Prisma.MessageWhereInput;
  const firstReady = await prisma.message.groupBy({
    by: ['chatId'],
    where: { ...inYourChats, kind: 'system', body: READY_LINE },
    _min: { createdAt: true },
    having: { createdAt: { _min: { gte: since } } },
  });
  if (firstReady.length === 0) return null;
  const firstReview = await prisma.job.groupBy({
    by: ['chatId'],
    where: { chatId: { in: firstReady.map((r) => r.chatId) }, type: 'review' },
    _min: { createdAt: true },
  });
  const reviewStart = new Map(firstReview.map((j) => [j.chatId, j._min.createdAt]));
  const times = firstReady.flatMap((r) => {
    const start = reviewStart.get(r.chatId);
    const ready = r._min.createdAt;
    // A chat that was ready before any agent reviewed it (human reviewers only) has nothing to time.
    if (!start || !ready || start > ready) return [];
    return [ready.getTime() - start.getTime()];
  });
  return median(times);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
