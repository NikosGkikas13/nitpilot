import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientAddress } from './client-address';

/** What `clientAddress` says for a request with these headers and this socket (Hono's Node adapter puts the socket in `env.incoming`). */
async function addressOf(trustProxy: boolean, opts: { xff?: string; socket?: string }): Promise<string> {
  const app = new Hono();
  app.get('/', (c) => c.text(clientAddress(c, trustProxy)));
  const env = opts.socket ? { incoming: { socket: { remoteAddress: opts.socket } } } : undefined;
  const res = await app.request('/', { headers: opts.xff ? { 'x-forwarded-for': opts.xff } : {} }, env);
  return res.text();
}

describe('clientAddress', () => {
  it('trusts the last X-Forwarded-For entry behind our proxy', async () => {
    expect(await addressOf(true, { xff: '6.6.6.6, 203.0.113.9', socket: '172.18.0.5' })).toBe('203.0.113.9');
  });

  it('ignores X-Forwarded-For when not behind a proxy', async () => {
    expect(await addressOf(false, { xff: '6.6.6.6', socket: '198.51.100.2' })).toBe('198.51.100.2');
  });

  it('falls back to the socket when the proxy sent no header', async () => {
    expect(await addressOf(true, { socket: '172.18.0.5' })).toBe('172.18.0.5');
  });

  it("is 'unknown' with neither a header nor a socket", async () => {
    expect(await addressOf(true, {})).toBe('unknown');
    expect(await addressOf(false, {})).toBe('unknown');
  });
});
