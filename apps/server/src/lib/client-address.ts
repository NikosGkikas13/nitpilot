import type { IncomingMessage } from 'node:http';
import type { Context } from 'hono';

/**
 * The address a request came from, for things like rate limits (docs/why/trusting-a-proxy.md).
 *
 * Hono's Node adapter puts the raw request in `c.env.incoming`; its socket is whoever connected to us. Behind our
 * reverse proxy that is always the proxy, so with `trustProxy` we read the real client from `X-Forwarded-For` instead.
 * Each proxy appends the address it saw to the END of that header, so the last entry is the one our own proxy wrote;
 * earlier entries are whatever the client claimed, and are ignored. Without a proxy the header is ignored entirely.
 * Tests call the app without a socket, which gives 'unknown'.
 */
export function clientAddress(c: Context, trustProxy: boolean): string {
  const socket = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket.remoteAddress;
  if (trustProxy) {
    const last = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (last) return last;
  }
  return socket ?? 'unknown';
}
