import { prisma } from '../lib/prisma';
import { SerialQueue } from '../lib/serial-queue';

export type DeliveryOutcome = { status: 'processed' | 'ignored'; note?: string };
export type DeliveryHandler = (d: { deliveryId: string; event: string; body: string }) => Promise<DeliveryOutcome>;

/** Process one stored delivery and record what happened. Never throws. */
export async function processDelivery(deliveryId: string, handle: DeliveryHandler): Promise<void> {
  const row = await prisma.rawEvent.findUnique({ where: { deliveryId } });
  if (!row || row.status !== 'received') return;
  try {
    const outcome = await handle({ deliveryId, event: row.event, body: row.body });
    await prisma.rawEvent.update({ where: { deliveryId }, data: { status: outcome.status, note: outcome.note ?? null } });
  } catch (err) {
    const note = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    console.error(`[ingest] delivery ${deliveryId} (${row.event}) failed:`, err);
    await prisma.rawEvent.update({ where: { deliveryId }, data: { status: 'failed', note } });
  }
}

export type Ingest = {
  /** Process a stored delivery soon, after any earlier ones. */
  enqueue(deliveryId: string): void;
  /** Resolves when everything enqueued so far is done (tests use this). */
  idle(): Promise<void>;
  /** After a crash: enqueue every delivery still marked `received`. Returns how many. */
  replayReceived(): Promise<number>;
};

export function createIngest(handle: DeliveryHandler): Ingest {
  const queue = new SerialQueue();
  const enqueue = (deliveryId: string) => queue.push(() => processDelivery(deliveryId, handle));
  return {
    enqueue,
    idle: () => queue.idle(),
    async replayReceived() {
      const rows = await prisma.rawEvent.findMany({ where: { status: 'received' }, orderBy: { createdAt: 'asc' }, select: { deliveryId: true } });
      for (const r of rows) enqueue(r.deliveryId);
      return rows.length;
    },
  };
}
