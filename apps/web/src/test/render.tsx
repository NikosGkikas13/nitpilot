import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppRoutes, makeQueryClient } from '../app';

/** One answer: the status and the JSON body. */
export type Answer = [status: number, body: unknown];

/**
 * A pretend Nitpilot server for component tests: answers each request by its method and path ('GET /api/me').
 * A request it has no answer for gets the server's JSON 404. Returns the fetch mock, to check what was sent.
 */
export function fakeApi(routes: Record<string, () => Answer>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}`;
    const [status, body] = routes[key]?.() ?? [404, { error: { code: 'not_found', message: 'no such route' } }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** The app's routes at `path`, with a fresh data cache that doesn't wait between retries. */
export function renderApp(path = '/') {
  return render(
    <QueryClientProvider client={makeQueryClient({ retryDelay: 0 })}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A stand-in for the browser's media queries: a phone (below 760 px) or a desktop, in the light theme. */
export function fakeViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') ? desktop : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
