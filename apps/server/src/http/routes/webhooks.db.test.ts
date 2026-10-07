import { describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { uid } from '../../../test/db';
import { sendWebhook } from '../../../test/webhooks';
import { createIngest } from '../../ingest/process';
import { prisma } from '../../lib/prisma';

function setup() {
  const handle = vi.fn(async () => ({ status: 'processed' as const }));
  const ingest = createIngest(handle);
  return { app: testApp({ ingest }), ingest, handle };
}

describe('POST /webhooks/github', () => {
  it('stores a signed delivery, answers 202, then processes it', async () => {
    const { app, ingest, handle } = setup();
    const deliveryId = uid('delivery');
    const res = await sendWebhook(app, 'pull_request', { action: 'opened', repository: { id: 501 } }, { deliveryId });
    expect(res.status).toBe(202);

    await ingest.idle();
    expect(handle).toHaveBeenCalledWith({ deliveryId, event: 'pull_request', body: expect.stringContaining('"opened"') });
    expect(await prisma.rawEvent.findUniqueOrThrow({ where: { deliveryId } })).toMatchObject({ event: 'pull_request', action: 'opened', repoId: '501', status: 'processed' });
  });

  it('answers 200 to a redelivery and processes it only once', async () => {
    const { app, ingest, handle } = setup();
    const deliveryId = uid('delivery');
    await sendWebhook(app, 'pull_request', { action: 'opened' }, { deliveryId });
    const again = await sendWebhook(app, 'pull_request', { action: 'opened' }, { deliveryId });
    expect(again.status).toBe(200);
    await ingest.idle();
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('rejects a bad signature and stores nothing', async () => {
    const { app } = setup();
    const deliveryId = uid('delivery');
    const res = await sendWebhook(app, 'pull_request', { action: 'opened' }, { deliveryId, secret: 'wrong' });
    expect(res.status).toBe(401);
    expect(await prisma.rawEvent.findUnique({ where: { deliveryId } })).toBeNull();
  });

  it('rejects a delivery without GitHub headers', async () => {
    const { app } = setup();
    const res = await app.request('/webhooks/github', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('rejects bodies over 1 MB', async () => {
    const { app } = setup();
    const res = await sendWebhook(app, 'pull_request', { padding: 'x'.repeat(1024 * 1024) });
    expect(res.status).toBe(413);
  });
});
