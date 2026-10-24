import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError, retryUnlessClientError } from './client';

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  const Thing = z.object({ name: z.string() });

  it('returns a body that matches the schema', async () => {
    vi.stubGlobal('fetch', answer(200, { name: 'maya' }));
    await expect(api.get('/api/thing', Thing)).resolves.toEqual({ name: 'maya' });
  });

  it("turns the server's error body into an ApiError", async () => {
    vi.stubGlobal('fetch', answer(409, { error: { code: 'conflict', message: 'Someone already resolved P1.' } }));
    const err = await api.send('POST', '/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', message: 'Someone already resolved P1.' });
  });

  it("keeps the error's details, such as which fields a 400 refused", async () => {
    const issues = [{ path: ['owner', 'login'], message: "isn't a GitHub login" }];
    vi.stubGlobal('fetch', answer(400, { error: { code: 'validation_error', message: 'request validation failed', details: { issues } } }));
    await expect(api.send('POST', '/api/x', {})).rejects.toMatchObject({ status: 400, code: 'validation_error', details: { issues } });
  });

  it('refuses a body with the wrong shape instead of passing it on', async () => {
    vi.stubGlobal('fetch', answer(200, { nom: 'maya' }));
    await expect(api.get('/api/thing', Thing)).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api.get('/api/thing', Thing)).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('sends JSON with the cookie', async () => {
    const fetch = answer(200, {});
    vi.stubGlobal('fetch', fetch);
    await api.send('POST', '/api/chats/c1/notes', { body: 'hi' });
    expect(fetch).toHaveBeenCalledWith('/api/chats/c1/notes', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"body":"hi"}' }));
  });
});

describe('retryUnlessClientError', () => {
  it('retries network failures and 5xx a little, and 4xx never', () => {
    expect(retryUnlessClientError(0, new ApiError(0, 'network', ''))).toBe(true);
    expect(retryUnlessClientError(0, new ApiError(503, 'server_error', ''))).toBe(true);
    expect(retryUnlessClientError(2, new ApiError(503, 'server_error', ''))).toBe(false);
    expect(retryUnlessClientError(0, new ApiError(404, 'not_found', ''))).toBe(false);
  });

  it("doesn't retry a server in first-run mode: its 503 lasts until someone sets it up", () => {
    expect(retryUnlessClientError(0, new ApiError(503, 'first_run', 'Finish setup at /first-run.'))).toBe(false);
  });
});
