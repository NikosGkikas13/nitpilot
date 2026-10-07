import { Hono } from 'hono';
import { SERVER_VERSION } from '../version';
import { onError } from './errors';

/** The HTTP app. Later tasks mount their route groups here. */
export function createApp(): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', (c) => c.json({ ok: true, version: SERVER_VERSION }));
  return app;
}
