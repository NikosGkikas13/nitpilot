import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CLI_WS_PATH, PROTOCOL_VERSION, type CliToServer, type RunningJob, type ServerToCli } from '@nitpilot/protocol';
import { Dispatcher } from '../src/chats/dispatch';
import { FakePlatform } from '../src/platform/fake/fake-platform';
import { CliHub } from '../src/ws/cli-hub';
import { wireCliHub } from '../src/ws/wire';

// Helpers for testing the CLI hub over real WebSockets (spec §19 "CLI hub").

type Hello = Extract<CliToServer, { t: 'hello' }>;
type FromServer<T extends ServerToCli['t']> = Extract<ServerToCli, { t: T }>;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serve `hub` on a random local port, the way main.ts attaches it to the real server. */
export async function listen(hub: CliHub) {
  const server = createServer();
  hub.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: `ws://127.0.0.1:${port}${CLI_WS_PATH}`,
    async close(): Promise<void> {
      hub.closeAll(1001, 'test over');
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A complete hello; pass only what a test cares about. */
export function hello(over: Partial<Hello['d']> = {}): Hello {
  return {
    v: 1,
    t: 'hello',
    d: {
      protocol: PROTOCOL_VERSION,
      cliVersion: '0.1.0',
      device: 'test laptop',
      agent: { id: 'fake', version: null, modes: ['reviewer', 'editor'] },
      repos: [],
      concurrency: 1,
      running: [],
      defaults: { autoReview: true, autoAddress: true },
      ...over,
    },
  };
}

export function ping(running: RunningJob[]): Extract<CliToServer, { t: 'ping' }> {
  return { v: 1, t: 'ping', d: { running } };
}

/** The HTTP status a WebSocket upgrade request to `path` gets: 101 when the server accepts it. */
export function upgradeStatus(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64'), ...headers },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * A CLI for tests: Node's built-in WebSocket client (the one the real CLI will use) plus an inbox,
 * so a test can say "wait for the next job.assign".
 */
export class TestCli {
  private readonly inbox: ServerToCli[] = [];
  private readonly waiting = new Set<() => void>();
  /** Resolves when the socket closes, with the code the server gave. */
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.inbox.push(JSON.parse(String(event.data)) as ServerToCli);
      for (const wake of this.waiting) wake();
    });
    this.closed = new Promise((resolve) => ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })));
  }

  /** Open a socket with this token. Rejects when the server refuses the upgrade. */
  static connect(url: string, token: string): Promise<TestCli> {
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    const cli = new TestCli(ws);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(cli));
      ws.addEventListener('error', () => reject(new Error('the server refused the WebSocket')));
    });
  }

  /** Connect, say hello and wait for welcome. */
  static async online(url: string, token: string, over: Partial<Hello['d']> = {}): Promise<TestCli> {
    const cli = await TestCli.connect(url, token);
    cli.send(hello(over));
    await cli.next('welcome');
    return cli;
  }

  /** Send any object as JSON. Tests also send invalid messages on purpose. */
  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  close(): void {
    this.ws.close();
  }

  /** Take the next message of type `t` out of the inbox, waiting up to `ms` for it. Other messages stay. */
  async next<T extends ServerToCli['t']>(t: T, ms = 2_000): Promise<FromServer<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as FromServer<T>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms} ms; the inbox has: ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await this.anyMessage(left);
    }
  }

  /** How many messages of type `t` are in the inbox. */
  count(t: ServerToCli['t']): number {
    return this.inbox.filter((m) => m.t === t).length;
  }

  /** Fail if a message of type `t` is in the inbox after waiting `ms`. */
  async nothing(t: ServerToCli['t'], ms = 300): Promise<void> {
    await sleep(ms);
    const got = this.inbox.find((m) => m.t === t);
    if (got) throw new Error(`expected no ${t}, got ${JSON.stringify(got)}`);
  }

  private anyMessage(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiting.add(done);
    });
  }
}

/** The CLI side of the server, wired by ws/wire.ts exactly as main.ts does, on a random local port. */
export async function startCliServer(opts: { now?: () => Date } = {}) {
  const hub = new CliHub();
  const dispatcher = new Dispatcher(opts.now);
  const wired = wireCliHub({ hub, dispatcher, platform: new FakePlatform(), now: opts.now });
  const server = await listen(hub);
  /** Wait until every message received so far is handled and the assigner is idle. */
  const settle = async (): Promise<void> => {
    await hub.idle();
    await wired.assigner.tick();
  };
  return {
    ...wired,
    hub,
    dispatcher,
    url: server.url,
    settle,
    async close(): Promise<void> {
      await settle();
      await server.close();
    },
  };
}

export type CliServer = Awaited<ReturnType<typeof startCliServer>>;
