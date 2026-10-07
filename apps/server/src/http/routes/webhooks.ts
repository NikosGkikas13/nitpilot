import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getEnv } from '../../lib/env';
import { verifyGithubSignature } from '../../lib/hmac';
import type { Ingest } from '../../ingest/process';
import { recordDelivery } from '../../ingest/record';
import { errorBody, HttpError } from '../errors';

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * GitHub's webhook endpoint (spec §15): check the signature on the raw body, store the
 * delivery once, answer 202 at once, and process it afterwards. See docs/why/webhooks.md.
 */
export function webhookRoutes(deps: { ingest: Ingest }): Hono {
  const app = new Hono();

  app.post(
    '/webhooks/github',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(errorBody('payload_too_large', 'webhook body over 1 MB'), 413) }),
    async (c) => {
      const raw = await c.req.text();
      if (!verifyGithubSignature(raw, c.req.header('x-hub-signature-256'), getEnv().GITHUB_WEBHOOK_SECRET)) {
        throw new HttpError('unauthorized', 'bad webhook signature');
      }
      const deliveryId = c.req.header('x-github-delivery');
      const event = c.req.header('x-github-event');
      if (!deliveryId || !event) throw new HttpError('validation_error', 'missing X-GitHub-Delivery or X-GitHub-Event');

      let payload: { action?: string; repository?: { id?: number } };
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new HttpError('validation_error', 'webhook body is not JSON');
      }

      const isNew = await recordDelivery({
        deliveryId,
        event,
        action: payload.action ?? null,
        repoId: payload.repository?.id != null ? String(payload.repository.id) : null,
        body: raw,
      });
      if (!isNew) return c.text('duplicate delivery', 200);
      deps.ingest.enqueue(deliveryId);
      return c.text('accepted', 202);
    },
  );

  return app;
}
