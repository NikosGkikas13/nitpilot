import type { Hono } from 'hono';
import { signGithubBody } from '../src/lib/hmac';
import { githubApp } from '../src/setup/credentials';

let n = 0;

/** POST a payload to /webhooks/github exactly as GitHub would: signed, with event and delivery headers. */
export async function sendWebhook(app: Hono, event: string, payload: unknown, opts: { deliveryId?: string; secret?: string } = {}): Promise<Response> {
  const body = JSON.stringify(payload);
  n += 1;
  return app.request('/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': opts.deliveryId ?? `delivery-${Date.now()}-${n}`,
      'x-hub-signature-256': signGithubBody(body, opts.secret ?? githubApp().webhookSecret),
    },
    body,
  });
}
