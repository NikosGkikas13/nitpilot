import { describe, expect, it } from 'vitest';
import { ServerClient } from './http';
import { CLI_VERSION } from './version';

type Call = { url: URL; init: RequestInit };

/** A stand-in for fetch: records each call and answers with `reply`. */
function fakeFetch(reply: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return reply(url);
  };
  return Object.assign(fn as typeof fetch, { calls });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SERVER = 'http://nitpilot.test';

describe('ServerClient', () => {
  it("sends the device's token and returns the checked answer", async () => {
    const fetch = fakeFetch(() => json({ login: 'maya', avatarUrl: null, githubAuth: 'ok' }));
    expect(await new ServerClient(SERVER, 'nit_abc', fetch).me()).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'ok' });
    const { url, init } = fetch.calls[0]!;
    expect(url.href).toBe(`${SERVER}/api/me`);
    expect(init.headers).toMatchObject({ authorization: 'Bearer nit_abc', 'user-agent': `nitpilot/${CLI_VERSION}` });
  });

  it('posts JSON to start a login', async () => {
    const fetch = fakeFetch(() => json({ deviceCode: 'd', userCode: 'WDJB-MJHT', verifyUrl: `${SERVER}/cli/approve?code=WDJB-MJHT`, interval: 2, expiresIn: 600 }));
    await new ServerClient(SERVER, null, fetch).loginStart('laptop');
    const { init } = fetch.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ deviceName: 'laptop' });
  });

  it('says to log in again when the server rejects the token', async () => {
    const fetch = fakeFetch(() => json({ error: { code: 'unauthorized', message: 'Missing or invalid CLI token.' } }, 401));
    await expect(new ServerClient(SERVER, 'nit_old', fetch).me()).rejects.toThrow('Run `nitpilot login`');
  });

  it("passes on the server's own error message", async () => {
    const fetch = fakeFetch(() => json({ error: { code: 'conflict', message: 'Nothing of yours failed on this PR.' } }, 409));
    await expect(new ServerClient(SERVER, 'nit_abc', fetch).myChats()).rejects.toThrow('Nothing of yours failed on this PR. (HTTP 409)');
  });

  it("asks the server to queue a chat's failed job again", async () => {
    const fetch = fakeFetch(() => json({ status: 'queued' }));
    expect(await new ServerClient(SERVER, 'nit_abc', fetch).retry('chat_1')).toEqual({ status: 'queued' });
    expect(fetch.calls[0]!.url.pathname).toBe('/api/chats/chat_1/retry');
    expect(fetch.calls[0]!.init.method).toBe('POST');
  });

  it('needs a token for calls that need one, and then asks nothing of the server', async () => {
    const fetch = fakeFetch(() => json({}));
    await expect(new ServerClient(SERVER, null, fetch).me()).rejects.toThrow('Not logged in. Run `nitpilot login`.');
    expect(fetch.calls).toEqual([]);
  });

  it('says so when the server cannot be reached', async () => {
    const fetch = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(new ServerClient(SERVER, 'nit_abc', fetch).me()).rejects.toThrow(`Can't reach ${SERVER}: fetch failed`);
  });

  it("rejects an answer that doesn't fit the protocol", async () => {
    const fetch = fakeFetch(() => json({ hello: 'world' }));
    await expect(new ServerClient(SERVER, 'nit_abc', fetch).me()).rejects.toThrow('Unexpected answer from /api/me');
  });
});
