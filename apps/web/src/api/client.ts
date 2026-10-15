import { z } from 'zod';

/** Every failed request, in one shape: the HTTP status (0 = no answer), the server's error code, and a message to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** How the server answers an error (apps/server/src/http/errors.ts). */
const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

async function request<T>(method: string, path: string, schema: z.ZodType<T> | null, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      // The session cookie goes along; it's the same origin (docs/why/serving-a-spa.md).
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach Nitpilot. Check your connection and try again.");
  }

  if (!res.ok) {
    const error = ErrorBody.safeParse(await res.json().catch(() => null));
    if (error.success) throw new ApiError(res.status, error.data.error.code, error.data.error.message);
    throw new ApiError(res.status, 'server_error', `Nitpilot answered ${res.status}. Try again in a moment.`);
  }
  if (schema === null || res.status === 204) return undefined as T;

  // Never trust an answer's shape: a body that doesn't match the schema is an error, not data.
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new ApiError(res.status, 'bad_response', `Unexpected answer from ${path}.`);
  return parsed.data;
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>) => request('GET', path, schema),
  send: <T = void>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, schema: z.ZodType<T> | null = null) => request<T>(method, path, schema, body),
};

/** A 4xx won't change by asking again; a network failure or a 5xx might. Used as TanStack Query's `retry`. */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}
