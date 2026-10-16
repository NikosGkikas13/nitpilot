import { BRAND } from '@nitpilot/protocol';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GithubError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
    /** How long GitHub asked us to wait before trying again (rate limits), if it said. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

/**
 * How long a rate-limited response asks us to wait: `retry-after` (seconds) for a secondary rate
 * limit, or until `x-ratelimit-reset` (a Unix time) once the hourly allowance is used up.
 */
export function retryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-remaining') === '0' && reset > 0) return Math.max(reset * 1000 - now, 0);
  return undefined;
}

/** How long one GitHub call may take before we give up on it: a request waiting on GitHub never waits forever. */
export const GITHUB_TIMEOUT_MS = 15_000;

export type GithubRequest = {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  accept?: string;
  /** Return the response body as text, without JSON.parse (e.g. to keep 64-bit ids exact). */
  raw?: boolean;
};
export type GithubResponse<T> = { status: number; data: T; headers: Headers };

/**
 * A small typed wrapper around fetch for GitHub. Tests pass a fake fetch (test/fake-fetch.ts).
 * Statuses below 400 (including 304 Not Modified) are returned; 400+ throw GithubError. A call that gets no
 * answer within `timeoutMs` is a GithubError with status 504, like any other GitHub outage.
 */
export class GithubClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    readonly apiBase = 'https://api.github.com',
    readonly webBase = 'https://github.com',
    private readonly timeoutMs = GITHUB_TIMEOUT_MS,
  ) {}

  async api<T = unknown>(method: string, path: string, opts: GithubRequest = {}): Promise<GithubResponse<T>> {
    const headers: Record<string, string> = {
      accept: opts.accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': BRAND.userAgent,
      ...opts.headers,
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const { res, data } = await this.timed(`${method} ${path}`, async (signal) => {
      const res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal,
      });
      return { res, data: opts.raw ? await res.text() : await readBody(res) };
    });
    if (res.status >= 400) throw new GithubError(res.status, data, `GitHub ${method} ${path} failed with ${res.status}`, retryAfterMs(res.headers));
    return { status: res.status, data: data as T, headers: res.headers };
  }

  /** POST to github.com/login/oauth/*. GitHub reports OAuth errors as 200 + `{ error }`. */
  async oauth<T>(path: string, params: Record<string, string>): Promise<T> {
    const { res, data } = await this.timed(`OAuth ${path}`, async (signal) => {
      const res = await this.fetchImpl(`${this.webBase}${path}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': BRAND.userAgent },
        body: JSON.stringify(params),
        signal,
      });
      return { res, data: (await readBody(res)) as (T & { error?: string }) | null };
    });
    if (res.status >= 400 || !data || data.error) {
      throw new GithubError(res.status, data, `GitHub OAuth ${path} failed: ${data?.error ?? res.status}`);
    }
    return data;
  }

  /** Run one call (the request and reading its answer), giving up after `timeoutMs`. */
  private async timed<T>(what: string, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await call(AbortSignal.timeout(this.timeoutMs));
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new GithubError(504, null, `GitHub didn't answer ${what} in ${this.timeoutMs / 1000} s`);
      }
      throw err;
    }
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  if ((res.headers.get('content-type') ?? '').includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
