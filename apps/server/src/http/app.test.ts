import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app';
import { HttpError, onError } from './errors';

describe('createApp', () => {
  it('answers the health check', async () => {
    const res = await createApp().request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('onError', () => {
  const app = new Hono();
  app.onError(onError);
  app.get('/missing', () => { throw new HttpError('not_found', 'no such chat'); });
  app.get('/invalid', () => { z.object({ a: z.string() }).parse({}); return new Response(); });
  app.get('/boom', () => { throw new Error('secret detail'); });

  it('maps HttpError to its status and a JSON body', async () => {
    const res = await app.request('/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'no such chat' } });
  });

  it('maps zod errors to 400', async () => {
    const res = await app.request('/invalid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});
