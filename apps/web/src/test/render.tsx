import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppRoutes, makeQueryClient } from '../app';
import { SocketFactory } from '../live/LiveProvider';
import { fakeSockets } from './socket';

/** One answer: the status and the JSON body. */
export type Answer = [status: number, body: unknown];

/**
 * A pretend Nitpilot server for component tests: answers each request by its method and path ('GET /api/me').
 * An answer can be a promise, to keep a request waiting. A request it has no answer for gets the server's JSON 404.
 * Returns the fetch mock, to check what was sent.
 */
export function fakeApi(routes: Record<string, () => Answer | Promise<Answer>>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}`;
    const [status, body] = (await routes[key]?.()) ?? [404, { error: { code: 'not_found', message: 'no such route' } }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/**
 * The app's routes at `path`, with a fresh data cache that doesn't wait between retries, and pretend sockets
 * for `/ws/web`. Also returns that cache and the sockets the page opened.
 */
export function renderApp(path = '/') {
  const queryClient = makeQueryClient({ retryDelay: 0 });
  const sockets = fakeSockets();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SocketFactory.Provider value={sockets.open}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </SocketFactory.Provider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, sockets };
}

/**
 * A stand-in for the browser's media queries, in the light theme: a window this many pixels wide, or `true` for
 * a wide desktop and `false` for a phone.
 */
export function fakeViewport(width: boolean | number) {
  const px = width === true ? 1440 : width === false ? 375 : width;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: px >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
