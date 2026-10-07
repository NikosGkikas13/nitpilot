import { BRAND } from '@nitpilot/protocol';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GithubError extends Error {
  constructor(readonly status: number, readonly body: unknown, message: string) {
    super(message);
    this.name = 'GithubError';
  }
}

export type GithubRequest = { token?: string; body?: unknown; headers?: Record<string, string>; accept?: string };
export type GithubResponse<T> = { status: number; data: T; headers: Headers };

/**
 * A small typed wrapper around fetch for GitHub. Tests pass a fake fetch (test/fake-fetch.ts).
 * Statuses below 400 (including 304 Not Modified) are returned; 400+ throw GithubError.
 */
export class GithubClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    readonly apiBase = 'https://api.github.com',
    readonly webBase = 'https://github.com',
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
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const data = await readBody(res);
    if (res.status >= 400) throw new GithubError(res.status, data, `GitHub ${method} ${path} failed with ${res.status}`);
    return { status: res.status, data: data as T, headers: res.headers };
  }

  /** POST to github.com/login/oauth/*. GitHub reports OAuth errors as 200 + `{ error }`. */
  async oauth<T>(path: string, params: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(`${this.webBase}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': BRAND.userAgent },
      body: JSON.stringify(params),
    });
    const data = (await readBody(res)) as (T & { error?: string }) | null;
    if (res.status >= 400 || !data || data.error) {
      throw new GithubError(res.status, data, `GitHub OAuth ${path} failed: ${data?.error ?? res.status}`);
    }
    return data;
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
