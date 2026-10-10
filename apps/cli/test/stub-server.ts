import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export type StubReply = { status?: number; body?: unknown };
export type StubRequest = { method: string; path: string; authorization: string | undefined; body: unknown };
/** What a route answers: always the same reply, or a function of the request. */
export type StubRoute = StubReply | ((req: StubRequest) => StubReply);
/** Keyed `METHOD /path`, e.g. `'POST /api/cli/login'`. */
export type StubRoutes = Record<string, StubRoute>;

/**
 * A pretend Nitpilot server on a random local port, for CLI tests: each test says what every route
 * answers, and `requests` records what the CLI sent. Unknown routes answer 404.
 */
export async function startStubServer(routes: StubRoutes) {
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    void readBody(req).then((text) => {
      const request: StubRequest = {
        method: req.method ?? 'GET',
        path: new URL(req.url ?? '/', 'http://stub').pathname,
        authorization: req.headers.authorization,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(request);
      const route = routes[`${request.method} ${request.path}`] ?? { status: 404, body: { error: { code: 'not_found', message: 'no such route' } } };
      const reply = typeof route === 'function' ? route(request) : route;
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
      res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    requests,
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A route that gives each reply in turn, then keeps repeating the last: pending, pending, approved. */
export function inTurn(...replies: StubReply[]): StubRoute {
  let next = 0;
  return () => replies[Math.min(next++, replies.length - 1)]!;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => resolve(text));
  });
}
