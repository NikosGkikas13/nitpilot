import { prisma } from '../lib/prisma';

export type DeliveryRow = { deliveryId: string; event: string; action: string | null; repoId: string | null; body: string };

/** Store a delivery. Returns false when we already have it (GitHub redelivered it). */
export async function recordDelivery(row: DeliveryRow): Promise<boolean> {
  const { count } = await prisma.rawEvent.createMany({ data: [row], skipDuplicates: true });
  return count === 1;
}

const KEEP_MS = 14 * 86_400_000;

/** Raw deliveries and seen comment ids are kept 14 days (spec §8). */
export async function purgeOldRows(now = new Date()): Promise<{ rawEvents: number; seenComments: number }> {
  const before = new Date(now.getTime() - KEEP_MS);
  const rawEvents = await prisma.rawEvent.deleteMany({ where: { createdAt: { lt: before } } });
  const seenComments = await prisma.seenComment.deleteMany({ where: { createdAt: { lt: before } } });
  return { rawEvents: rawEvents.count, seenComments: seenComments.count };
}
