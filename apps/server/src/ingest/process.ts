import { prisma } from '../lib/prisma';
import { SerialQueue } from '../lib/serial-queue';

export type DeliveryOutcome = { status: 'processed' | 'ignored'; note?: string };
export type DeliveryHandler = (d: { deliveryId: string; event: string; body: string }) => Promise<DeliveryOutcome>;

/** A delivery that keeps failing is tried this many times in all, over about an hour. */
export const MAX_DELIVERY_ATTEMPTS = 7;

/** The wait after failed attempt n: 1, 2, 4, 8, 16, 32 minutes. */
export function deliveryRetryDelayMs(attempts: number): number {
  return 60_000 * 2 ** (attempts - 1);
}

/**
 * Process one stored delivery and record what happened. Never throws. When the handler fails
 * (GitHub had a hiccup, say), the delivery is tried again later: GitHub already got our 202, so
 * it won't send it again (docs/why/webhooks.md).
 */
export async function processDelivery(deliveryId: string, handle: DeliveryHandler, now = new Date()): Promise<void> {
  const row = await prisma.rawEvent.findUnique({ where: { deliveryId } });
  if (!row || row.status !== 'received') return;
  try {
    const outcome = await handle({ deliveryId, event: row.event, body: row.body });
    await prisma.rawEvent.update({ where: { deliveryId }, data: { status: outcome.status, note: outcome.note ?? null, retryAt: null } });
  } catch (err) {
    const note = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    const attempts = row.attempts + 1;
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      console.error(`[ingest] delivery ${deliveryId} (${row.event}) failed ${attempts} times; giving up:`, err);
      await prisma.rawEvent.update({ where: { deliveryId }, data: { status: 'failed', attempts, note, retryAt: null } });
      return;
    }
    const retryAt = new Date(now.getTime() + deliveryRetryDelayMs(attempts));
    console.warn(`[ingest] delivery ${deliveryId} (${row.event}) failed (attempt ${attempts}); trying again at ${retryAt.toISOString()}:`, err);
    await prisma.rawEvent.update({ where: { deliveryId }, data: { status: 'retrying', attempts, note, retryAt } });
  }
}

export type Ingest = {
  /** Process a stored delivery soon, after any earlier ones. */
  enqueue(deliveryId: string): void;
  /** Resolves when everything enqueued so far is done (tests use this). */
  idle(): Promise<void>;
  /** After a crash: enqueue every delivery still marked `received`. Returns how many. */
  replayReceived(): Promise<number>;
  /** Enqueue every `retrying` delivery whose wait is over. Returns how many. The server calls this every 30 s. */
  retryDue(now?: Date): Promise<number>;
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
    async retryDue(now = new Date()) {
      const rows = await prisma.rawEvent.findMany({ where: { status: 'retrying', retryAt: { lte: now } }, orderBy: { createdAt: 'asc' }, select: { deliveryId: true } });
      for (const r of rows) {
        // Back to `received` before it's queued, so the next sweep doesn't queue it a second time.
        // If the server stops first, boot replays it like any other `received` delivery.
        await prisma.rawEvent.update({ where: { deliveryId: r.deliveryId }, data: { status: 'received' } });
        enqueue(r.deliveryId);
      }
      return rows.length;
    },
  };
}
