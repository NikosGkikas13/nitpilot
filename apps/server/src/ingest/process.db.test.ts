import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, uid } from '../../test/db';
import { prisma } from '../lib/prisma';
import { createIngest, MAX_DELIVERY_ATTEMPTS, processDelivery } from './process';
import { purgeOldRows, recordDelivery } from './record';

beforeEach(resetDb);

const row = (deliveryId = uid('delivery')) => ({ deliveryId, event: 'pull_request', action: 'opened', repoId: '501', body: '{"action":"opened"}' });

const T0 = new Date('2026-10-09T12:00:00.000Z');
const failing = async (): Promise<never> => { throw new Error('GitHub said no'); };
const stored = (deliveryId: string) => prisma.rawEvent.findUniqueOrThrow({ where: { deliveryId } });

describe('processDelivery', () => {
  it('records a handler failure on the row instead of throwing, and plans another attempt', async () => {
    const r = row();
    await recordDelivery(r);
    await processDelivery(r.deliveryId, failing, T0);
    expect(await stored(r.deliveryId)).toMatchObject({ status: 'retrying', attempts: 1, retryAt: new Date(T0.getTime() + 60_000), note: 'GitHub said no' });
  });

  it('waits twice as long after each failed attempt', async () => {
    const r = row();
    await recordDelivery(r);
    await prisma.rawEvent.update({ where: { deliveryId: r.deliveryId }, data: { attempts: 2 } });
    await processDelivery(r.deliveryId, failing, T0);
    expect(await stored(r.deliveryId)).toMatchObject({ status: 'retrying', attempts: 3, retryAt: new Date(T0.getTime() + 4 * 60_000) });
  });

  it(`gives up after ${MAX_DELIVERY_ATTEMPTS} attempts`, async () => {
    const r = row();
    await recordDelivery(r);
    await prisma.rawEvent.update({ where: { deliveryId: r.deliveryId }, data: { attempts: MAX_DELIVERY_ATTEMPTS - 1 } });
    await processDelivery(r.deliveryId, failing, T0);
    expect(await stored(r.deliveryId)).toMatchObject({ status: 'failed', attempts: MAX_DELIVERY_ATTEMPTS, retryAt: null, note: 'GitHub said no' });
  });

  it('marks ignored deliveries with the reason', async () => {
    const r = row();
    await recordDelivery(r);
    await processDelivery(r.deliveryId, async () => ({ status: 'ignored', note: 'nothing to do' }));
    expect(await prisma.rawEvent.findUniqueOrThrow({ where: { deliveryId: r.deliveryId } })).toMatchObject({ status: 'ignored', note: 'nothing to do' });
  });
});

describe('replayReceived', () => {
  it('processes deliveries left as received by a crash, oldest first', async () => {
    const first = row();
    const second = row();
    await recordDelivery(first);
    await recordDelivery(second);
    const seen: string[] = [];
    const ingest = createIngest(async (d) => { seen.push(d.deliveryId); return { status: 'processed' }; });

    expect(await ingest.replayReceived()).toBe(2);
    await ingest.idle();
    expect(seen).toEqual([first.deliveryId, second.deliveryId]);
  });
});

describe('retryDue', () => {
  it('processes a failed delivery again once its wait is over, and only then', async () => {
    const r = row();
    await recordDelivery(r);
    await processDelivery(r.deliveryId, failing, T0);
    const handled: string[] = [];
    const ingest = createIngest(async (d) => { handled.push(d.deliveryId); return { status: 'processed' }; });

    expect(await ingest.retryDue(new Date(T0.getTime() + 59_000))).toBe(0);
    expect(await ingest.retryDue(new Date(T0.getTime() + 60_000))).toBe(1);
    await ingest.idle();
    expect(handled).toEqual([r.deliveryId]);
    expect(await stored(r.deliveryId)).toMatchObject({ status: 'processed' });
  });

  it('leaves a delivery it gave up on alone', async () => {
    const r = row();
    await recordDelivery(r);
    await prisma.rawEvent.update({ where: { deliveryId: r.deliveryId }, data: { attempts: MAX_DELIVERY_ATTEMPTS - 1 } });
    await processDelivery(r.deliveryId, failing, T0);
    const ingest = createIngest(async () => ({ status: 'processed' }));
    expect(await ingest.retryDue(new Date(T0.getTime() + 86_400_000))).toBe(0);
  });
});

describe('purgeOldRows', () => {
  it('deletes deliveries and seen comments older than 14 days', async () => {
    const old = row();
    await recordDelivery(old);
    await prisma.rawEvent.update({ where: { deliveryId: old.deliveryId }, data: { createdAt: new Date(Date.now() - 15 * 86_400_000) } });
    const fresh = row();
    await recordDelivery(fresh);

    expect(await purgeOldRows()).toEqual({ rawEvents: 1, seenComments: 0 });
    expect(await prisma.rawEvent.count()).toBe(1);
  });
});

describe('createIngest', () => {
  it('runs deliveries one at a time', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const a = row();
    const b = row();
    await recordDelivery(a);
    await recordDelivery(b);
    const ingest = createIngest(async (d) => {
      order.push(`start ${d.deliveryId === a.deliveryId ? 'a' : 'b'}`);
      if (d.deliveryId === a.deliveryId) await gate;
      order.push(`end ${d.deliveryId === a.deliveryId ? 'a' : 'b'}`);
      return { status: 'processed' };
    });
    ingest.enqueue(a.deliveryId);
    ingest.enqueue(b.deliveryId);
    await vi.waitFor(() => expect(order).toEqual(['start a']));
    release();
    await ingest.idle();
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
