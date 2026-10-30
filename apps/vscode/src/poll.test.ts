import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MyChat } from '@nitpilot/protocol';
import { describe, expect, it, vi } from 'vitest';
import { poll, singleFlight } from './poll';

const SERVER = 'https://np.test';

const chat = (over: Partial<MyChat> = {}): MyChat => ({
  id: 'chat_1',
  repo: 'acme/shop-api',
  number: 142,
  title: 'Cursor pagination for orders',
  role: 'reviewer',
  phase: 'reviewing',
  round: 1,
  attention: 'none',
  url: 'https://np.test/c/acme/shop-api/142',
  updatedAt: '2026-10-10T08:00:00.000Z',
  ...over,
});

type Answer = { status?: number; body?: unknown } | 'network' | 'hang';

/** A config dir holding `config` (or this exact text), as NITPILOT_CONFIG_DIR. */
function configEnv(config: object | string = { server: SERVER, token: 'nit_abc' }) {
  const dir = mkdtempSync(join(tmpdir(), 'nitpilot-vscode-'));
  writeFileSync(join(dir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return { dir, env: { NITPILOT_CONFIG_DIR: dir } };
}

/** A fetch that answers `/api/me` and `/api/me/chats` as told, and records each request. */
function fakeFetch(me: Answer, chats: Answer) {
  const calls: { path: string; signal: AbortSignal | undefined }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, signal: init?.signal ?? undefined });
    const answer = path === '/api/me' ? me : chats;
    if (answer === 'network') throw new TypeError('fetch failed');
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    return new Response(JSON.stringify(answer.body ?? null), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const meOk = { body: { login: 'maya', avatarUrl: null, githubAuth: 'ok' } };
const meReauth = { body: { login: 'maya', avatarUrl: null, githubAuth: 'needs_reauth' } };
const chatsReauth = { status: 401, body: { error: { code: 'reauth', message: 'Your GitHub sign-in expired.' } } };

describe('poll', () => {
  it('returns the chats when everything answers', async () => {
    const chats = [chat(), chat({ id: 'chat_2', number: 7, attention: 'failed' })];
    const { fetch } = fakeFetch(meOk, { body: { chats } });
    expect(await poll({ env: configEnv().env, fetch })).toEqual({ state: 'ok', server: SERVER, chats });
  });

  it('is logged out without asking the server when there is no token', async () => {
    const { fetch } = fakeFetch(meOk, { body: { chats: [] } });
    expect(await poll({ env: configEnv({ server: SERVER }).env, fetch })).toEqual({ state: 'logged_out', server: SERVER });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is logged out when the server refuses the token (a revoked device)', async () => {
    const { fetch } = fakeFetch({ status: 401, body: { error: { code: 'unauthorized', message: 'no' } } }, { status: 401 });
    expect(await poll({ env: configEnv().env, fetch })).toEqual({ state: 'logged_out', server: SERVER });
  });

  it('says sign in again, with no list, when GitHub sign-in expired and the chats call fails', async () => {
    const { fetch } = fakeFetch(meReauth, chatsReauth);
    expect(await poll({ env: configEnv().env, fetch })).toEqual({ state: 'needs_reauth', server: SERVER, chats: null });
  });

  it('keeps the chats when GitHub sign-in expired but the chats still came back', async () => {
    const chats = [chat()];
    const { fetch } = fakeFetch(meReauth, { body: { chats } });
    expect(await poll({ env: configEnv().env, fetch })).toEqual({ state: 'needs_reauth', server: SERVER, chats });
  });

  it("is unreachable when the network fails, with ServerClient's message", async () => {
    const { fetch } = fakeFetch('network', 'network');
    const result = await poll({ env: configEnv().env, fetch });
    expect(result.state).toBe('unreachable');
    expect(result).toMatchObject({ server: SERVER, message: expect.stringContaining(`Can't reach ${SERVER}`) });
  });

  it.each([
    ['a 503', { status: 503, body: { error: { message: 'down' } } }],
    ['GitHub not answering (502)', { status: 502, body: { error: { code: 'github_unavailable', message: "GitHub didn't answer. Try again in a minute." } } }],
  ])('is unreachable on %s', async (_name, chats) => {
    const { fetch } = fakeFetch(meOk, chats);
    expect(await poll({ env: configEnv().env, fetch })).toMatchObject({ state: 'unreachable', server: SERVER });
  });

  it('is an error asking to update when an answer does not match the protocol', async () => {
    const { fetch } = fakeFetch(meOk, { body: { chats: [{ ...chat(), attention: 'brand_new' }] } });
    const result = await poll({ env: configEnv().env, fetch });
    expect(result).toMatchObject({ state: 'error', server: SERVER });
    expect(result.state === 'error' && result.message).toMatch(/Update the Nitpilot extension, or check the server's version\.$/);
  });

  it("is an error naming the file when config.json is broken", async () => {
    const { dir, env } = configEnv('{');
    const result = await poll({ env, fetch: fakeFetch(meOk, meOk).fetch });
    expect(result).toMatchObject({ state: 'error', server: null });
    expect(result.state === 'error' && result.message).toContain(join(dir, 'config.json'));
  });

  it('reads the config again on every poll, so logging in shows up without a reload', async () => {
    const { dir, env } = configEnv({ server: SERVER });
    const { fetch } = fakeFetch(meOk, { body: { chats: [] } });
    expect((await poll({ env, fetch })).state).toBe('logged_out');
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ server: SERVER, token: 'nit_abc' }));
    expect((await poll({ env, fetch })).state).toBe('ok');
  });

  it('gives up on a server that never answers', async () => {
    const { fetch, calls } = fakeFetch('hang', 'hang');
    expect(await poll({ env: configEnv().env, fetch, timeoutMs: 20 })).toMatchObject({ state: 'unreachable', server: SERVER });
    expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
  });
});

describe('singleFlight', () => {
  it('shares one run between callers that overlap, and runs again once it settles', async () => {
    let finish!: (value: number) => void;
    const fn = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    const run = singleFlight(fn);
    const a = run();
    const b = run();
    expect(b).toBe(a);
    expect(fn).toHaveBeenCalledTimes(1);
    finish(1);
    expect(await a).toBe(1);
    void run();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs again after a failure', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(2);
    const run = singleFlight(fn as () => Promise<number>);
    await expect(run()).rejects.toThrow('boom');
    expect(await run()).toBe(2);
  });
});
