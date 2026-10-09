import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, uid } from '../../test/db';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { createIngest } from './process';
import { recordDelivery } from './record';
import { recoverOnBoot } from './recovery';

beforeEach(resetDb);

describe('recoverOnBoot', () => {
  it('re-runs interrupted tasks, replays stored deliveries and asks GitHub for failed ones', async () => {
    await prisma.task.create({ data: { kind: 'notify', payload: {}, status: 'running', attempts: 1 } });
    await recordDelivery({ deliveryId: uid('d'), event: 'ping', action: null, repoId: null, body: '{}' });
    const handled: string[] = [];
    const ingest = createIngest(async (d) => { handled.push(d.event); return { status: 'ignored' }; });
    const platform = new FakePlatform();
    platform.redeliverFailed = async () => 2;

    expect(await recoverOnBoot({ ingest, platform })).toEqual({ tasks: 1, replayed: 1, redelivered: 2 });
    await ingest.idle();
    expect(handled).toEqual(['ping']);
  });

  it('still boots when GitHub cannot be reached', async () => {
    const platform = new FakePlatform();
    platform.redeliverFailed = async () => { throw new Error('offline'); };
    expect(await recoverOnBoot({ ingest: createIngest(async () => ({ status: 'ignored' })), platform })).toMatchObject({ redelivered: 0 });
  });
});
