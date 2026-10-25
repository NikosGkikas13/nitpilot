import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fakeFetch } from '../../test/fake-fetch';
import { GithubClient } from '../platform/github/client';
import { createFirstRunApp } from './app';
import { HttpError, onError } from './errors';
import { testApp } from '../../test/app';

describe('createApp', () => {
  it('answers the health check', async () => {
    const res = await testApp({ github: new GithubClient(fakeFetch({})) }).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('createFirstRunApp', () => {
  // A pretend web app build, for the page itself.
  const dist = mkdtempSync(path.join(tmpdir(), 'nitpilot-first-run-'));
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  const app = createFirstRunApp({
    github: new GithubClient(fakeFetch({})),
    publicUrl: 'http://localhost:8787',
    setupCode: 'K7PX-3MQD',
    trustProxy: false,
    exit: vi.fn(),
    webDistDir: dist,
  });

  it('answers every other server path, whatever the method, with 503 "finish setup"', async () => {
    const requests: [string, string][] = [
      ['GET', '/api/me'],
      ['POST', '/webhooks/github'],
      ['GET', '/auth/github/login'],
      ['GET', '/github/setup?installation_id=1'],
      ['DELETE', '/api/cli/token'],
      ['GET', '/ws/cli'],
    ];
    for (const [method, url] of requests) {
      const res = await app.request(url, { method });
      expect(res.status, `${method} ${url}`).toBe(503);
      expect(await res.json()).toEqual({ error: { code: 'first_run', message: 'Finish setup at /first-run.' } });
    }
  });

  it('still answers the health check', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("serves the web app's pages, whose forms may post to GitHub", async () => {
    for (const page of ['/first-run', '/', '/inbox']) {
      const res = await app.request(page);
      expect(res.status, page).toBe(200);
      expect(await res.text()).toContain('<title>app</title>');
      expect(res.headers.get('content-security-policy')).toContain("form-action 'self' https://github.com;");
    }
  });

  it('keeps the normal server\'s forms to itself', async () => {
    const res = await testApp({ webDistDir: dist }).request('/inbox');
    expect(res.headers.get('content-security-policy')).toContain("form-action 'self';");
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
