import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/app';
import { BUILD_HINT } from './spa';

// A pretend build: dist/ with an index, a hashed asset and a service worker, and a secret next to it.
let outer: string;
let dist: string;

beforeAll(() => {
  outer = mkdtempSync(path.join(tmpdir(), 'nitpilot-spa-'));
  dist = path.join(outer, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("push", () => {})');
  writeFileSync(path.join(outer, 'secret.txt'), 'TOP-SECRET');
});

afterAll(() => rmSync(outer, { recursive: true, force: true }));

describe('serving the web app', () => {
  it('answers an app route with index.html, the CSP and no-cache', async () => {
    const res = await testApp({ webDistDir: dist }).request('/inbox/whatever');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>app</title>');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers / with the app', async () => {
    const res = await testApp({ webDistDir: dist }).request('/');
    expect(await res.text()).toContain('<title>app</title>');
  });

  it('serves a hashed asset with a long cache, and other files with no-cache', async () => {
    const app = testApp({ webDistDir: dist });
    const asset = await app.request('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const sw = await app.request('/sw.js');
    expect(await sw.text()).toContain('push');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers a missing build file with a 404, not the app', async () => {
    const res = await testApp({ webDistDir: dist }).request('/assets/index-gone123.js');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'no such route' } });
  });

  it('keeps unknown server paths as JSON 404s', async () => {
    const app = testApp({ webDistDir: dist });
    for (const url of ['/api/nope', '/auth/nope', '/webhooks/nope']) {
      const res = await app.request(url);
      expect(res.status, url).toBe(404);
      expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'no such route' } });
    }
  });

  it('answers only GETs with the app', async () => {
    const res = await testApp({ webDistDir: dist }).request('/inbox', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('leaves the health check alone', async () => {
    const res = await testApp({ webDistDir: dist }).request('/healthz');
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('never serves a file outside dist, however the path is spelled', async () => {
    const app = testApp({ webDistDir: dist });
    for (const url of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/%252e%252e/%252e%252e/secret.txt']) {
      const res = await app.request(url);
      expect(await res.text(), url).not.toContain('TOP-SECRET');
    }
  });

  it('says how to build the app when there is no build', async () => {
    const res = await testApp({ webDistDir: path.join(outer, 'missing') }).request('/inbox');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(BUILD_HINT);
  });
});
