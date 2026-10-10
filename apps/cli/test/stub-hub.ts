import type { IncomingMessage } from 'node:http';
import { CLI_WS_PATH, type CliToServer, type ServerToCli } from '@nitpilot/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { startStubServer, type StubRoutes } from './stub-server';

type FromCli<T extends CliToServer['t']> = Extract<CliToServer, { t: T }>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when something is added to `waiting`'s owner, or after `ms`. */
function wake(waiting: Set<() => void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiting.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    waiting.add(done);
  });
}

/** One CLI connection as the pretend server sees it, with an inbox, so a test can wait for "the next ping". */
export class StubConnection {
  private readonly inbox: CliToServer[] = [];
  private readonly waiting = new Set<() => void>();
  /** Like the real hub, every ping gets a pong. Set false to play a server that went quiet. */
  answerPings = true;

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as CliToServer;
      if (msg.t === 'ping' && this.answerPings) this.send({ v: 1, t: 'pong', d: {} });
      this.inbox.push(msg);
      for (const done of this.waiting) done();
    });
  }

  send(msg: ServerToCli): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(code: number, reason = ''): void {
    this.ws.close(code, reason);
  }

  /** Answer the hello the way the hub does. */
  welcome(login = 'maya'): void {
    this.send({ v: 1, t: 'welcome', d: { login, pingSec: 25, leaseSec: 90 } });
  }

  /** Take the next message of type `t` out of the inbox, waiting up to `ms`. Other messages stay. */
  async next<T extends CliToServer['t']>(t: T, ms = 2_000): Promise<FromCli<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as FromCli<T>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms} ms; the inbox has: ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await wake(this.waiting, left);
    }
  }

  /** The next message of type `t` that `matches`, skipping the ones that don't. */
  async nextMatching<T extends CliToServer['t']>(t: T, matches: (msg: FromCli<T>) => boolean, ms = 2_000): Promise<FromCli<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const msg = await this.next(t, Math.max(1, deadline - Date.now()));
      if (matches(msg)) return msg;
    }
  }

  /** Throw away the queued messages of type `t`, so the next wait only sees new ones. */
  forget(t: CliToServer['t']): void {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i]!.t === t) this.inbox.splice(i, 1);
  }

  /** Fail if a message of type `t` arrives within `ms`. */
  async nothing(t: CliToServer['t'], ms = 300): Promise<void> {
    await sleep(ms);
    const got = this.inbox.find((m) => m.t === t);
    if (got) throw new Error(`expected no ${t}, got ${JSON.stringify(got)}`);
  }
}

/**
 * A pretend Nitpilot server for daemon tests: the REST stub plus /ws/cli. Only `token` may connect;
 * any other token gets a plain 401 before the upgrade, like the real hub.
 */
export async function startStubHub(opts: { token: string; routes?: StubRoutes }) {
  const http = await startStubServer(opts.routes ?? {});
  const arrivals: StubConnection[] = [];
  const waiting = new Set<() => void>();
  const wss = new WebSocketServer({
    server: http.server,
    path: CLI_WS_PATH,
    verifyClient: (info: { req: IncomingMessage }, done: (ok: boolean, code?: number) => void) => done(info.req.headers.authorization === `Bearer ${opts.token}`, 401),
  });
  wss.on('connection', (ws) => {
    arrivals.push(new StubConnection(ws));
    for (const done of waiting) done();
  });

  return {
    url: http.url,
    requests: http.requests,
    /** The next CLI that connects, waiting up to `ms` for it. */
    async connection(ms = 2_000): Promise<StubConnection> {
      const deadline = Date.now() + ms;
      for (;;) {
        const conn = arrivals.shift();
        if (conn) return conn;
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no CLI connected within ${ms} ms`);
        await wake(waiting, left);
      }
    },
    /** Fail if a CLI connects within `ms`. */
    async noConnection(ms = 300): Promise<void> {
      await sleep(ms);
      if (arrivals.length > 0) throw new Error('a CLI connected');
    },
    async close(): Promise<void> {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await http.close();
    },
  };
}
