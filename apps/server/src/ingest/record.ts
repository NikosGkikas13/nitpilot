import { prisma } from '../lib/prisma';

export type DeliveryRow = { deliveryId: string; event: string; action: string | null; repoId: string | null; body: string };

/** Store a delivery. Returns false when we already have it (GitHub redelivered it). */
export async function recordDelivery(row: DeliveryRow): Promise<boolean> {
  const { count } = await prisma.rawEvent.createMany({ data: [row], skipDuplicates: true });
  return count === 1;
}

const KEEP_MS = 14 * 86_400_000;
const LOGIN_KEEP_MS = 86_400_000;

/**
 * Raw deliveries and seen comment ids are kept 14 days (spec §8). CLI login requests are kept a day:
 * each one expires after 10 minutes anyway (spec §14).
 */
export async function purgeOldRows(now = new Date()): Promise<{ rawEvents: number; seenComments: number; cliLoginRequests: number }> {
  const before = new Date(now.getTime() - KEEP_MS);
  const rawEvents = await prisma.rawEvent.deleteMany({ where: { createdAt: { lt: before } } });
  const seenComments = await prisma.seenComment.deleteMany({ where: { createdAt: { lt: before } } });
  const cliLoginRequests = await prisma.cliLoginRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - LOGIN_KEEP_MS) } } });
  return { rawEvents: rawEvents.count, seenComments: seenComments.count, cliLoginRequests: cliLoginRequests.count };
}

/**
 * Delete chats that were closed more than `retentionDays` ago, with their messages, jobs and tasks (they cascade).
 * Only used on the hosted instance (CLOSED_CHAT_RETENTION_DAYS); a self-hosted one keeps its history. Returns how many chats went.
 */
export async function purgeClosedChats(now: Date, retentionDays: number): Promise<number> {
  const before = new Date(now.getTime() - retentionDays * 86_400_000);
  const { count } = await prisma.prChat.deleteMany({ where: { closedAt: { lt: before } } });
  return count;
}
