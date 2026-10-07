import type { FetchLike } from '../src/platform/github/client';

export type FakeRequest = { method: string; url: URL; headers: Headers; body: unknown };
type Handler = (req: FakeRequest) => unknown;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = data === null || status === 204 || status === 304 ? null : JSON.stringify(data);
  return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * A fetch that answers from a route table like `{ 'GET /user': () => ({ id: 1 }) }`.
 * A handler may return plain data (sent as 200 JSON) or a Response. Unknown routes throw,
 * so a test notices any call it didn't expect. Every call is recorded in `.calls`.
 */
export function fakeFetch(routes: Record<string, Handler>): FetchLike & { calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  const fn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const raw = typeof init.body === 'string' ? init.body : null;
    const req: FakeRequest = { method, url, headers: new Headers(init.headers), body: raw ? JSON.parse(raw) : null };
    calls.push(req);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new Error(`fakeFetch: no route for ${method} ${url.pathname}`);
    const out = await handler(req);
    return out instanceof Response ? out : json(out);
  };
  return Object.assign(fn, { calls });
}
