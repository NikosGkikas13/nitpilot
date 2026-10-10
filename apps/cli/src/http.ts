import { BRAND, CliLoginPollResponse, CliLoginStartResponse, HealthResponse, MeResponse, MyChatsResponse, RetryResponse } from '@nitpilot/protocol';
import type { z } from 'zod';
import { CliError } from './errors';
import { CLI_VERSION } from './version';

/** The server answered with an error, or couldn't be reached (status 0). */
export class ServerError extends CliError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

type CallOptions = { body?: unknown; auth?: boolean; signal?: AbortSignal };

/** The Nitpilot server's REST API (spec §10). Every answer is checked against the protocol's schemas. */
export class ServerClient {
  constructor(
    readonly server: string,
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Is the server up, and which version? No token needed. `signal` lets the caller give up on a slow answer. */
  health(opts: { signal?: AbortSignal } = {}) {
    return this.call('GET', '/healthz', HealthResponse, { signal: opts.signal });
  }

  /** `nitpilot login`, step 1: a code for the person and a secret for this device. */
  loginStart(deviceName: string) {
    return this.call('POST', '/api/cli/login', CliLoginStartResponse, { body: { deviceName } });
  }

  /** `nitpilot login`, step 3: pending, approved (with the token), denied or expired. */
  loginPoll(deviceCode: string) {
    return this.call('POST', '/api/cli/login/poll', CliLoginPollResponse, { body: { deviceCode } });
  }

  /** Who this token belongs to. `signal` lets the caller give up on a slow answer. */
  me(opts: { signal?: AbortSignal } = {}) {
    return this.call('GET', '/api/me', MeResponse, { auth: true, signal: opts.signal });
  }

  myChats() {
    return this.call('GET', '/api/me/chats', MyChatsResponse, { auth: true });
  }

  /** `nitpilot retry`: queue my failed job on this chat again. */
  retry(chatId: string) {
    return this.call('POST', `/api/chats/${encodeURIComponent(chatId)}/retry`, RetryResponse, { auth: true });
  }

  /** Sign this device out: the server revokes the token that sent the request. */
  async revoke(): Promise<void> {
    await this.send('DELETE', '/api/cli/token', { auth: true });
  }

  private async call<S extends z.ZodType>(method: string, path: string, schema: S, opts: CallOptions = {}): Promise<z.infer<S>> {
    const res = await this.send(method, path, opts);
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ServerError(res.status, `Unexpected answer from ${path}. Is ${this.server} a ${BRAND.name} server of the same version?`);
    return parsed.data;
  }

  private async send(method: string, path: string, opts: CallOptions): Promise<Response> {
    const headers: Record<string, string> = { 'user-agent': `${BRAND.userAgent}/${CLI_VERSION}` };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.auth) {
      if (!this.token) throw new CliError(`Not logged in. Run \`${BRAND.cli} login\`.`);
      headers.authorization = `Bearer ${this.token}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.server), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch (err) {
      throw new ServerError(0, `Can't reach ${this.server}: ${(err as Error).message}`);
    }
    if (res.ok) return res;
    if (res.status === 401) throw new ServerError(401, `The server didn't accept this device's token. Run \`${BRAND.cli} login\`.`);
    throw new ServerError(res.status, `${await errorMessage(res)} (HTTP ${res.status})`);
  }
}

/** The message in the server's `{ error: { message } }` body, or the status text. */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? res.statusText;
}
