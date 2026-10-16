import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WEB_WS_PATH, type ServerToWeb, type WebToServer } from '@nitpilot/protocol';
import { routeUpgrades } from '../src/ws/upgrade-router';
import { WebHub, type WebHubDeps } from '../src/ws/web-hub';
import { sleep } from './ws';

// Helpers for testing /ws/web over real WebSockets: a hub on a random port, and a pretend browser tab.

type FromServer<T extends ServerToWeb['t']> = Extract<ServerToWeb, { t: T }>;

/** A WebHub behind the upgrade router, as main.ts serves it, on a random local port. */
export async function startWebHub(deps: WebHubDeps) {
  const hub = new WebHub(deps);
  const server = createServer();
  routeUpgrades(server, { [WEB_WS_PATH]: hub.handleUpgrade });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    hub,
    port,
    url: `ws://127.0.0.1:${port}${WEB_WS_PATH}`,
    /** The Origin our own pages would send: the address the socket is opened on. */
    origin: `http://127.0.0.1:${port}`,
    async close(): Promise<void> {
      hub.close(1001, 'test over');
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A browser tab's socket: Node's built-in WebSocket with the headers a browser sends, plus an inbox. */
export class TestTab {
  private readonly inbox: ServerToWeb[] = [];
  private readonly waiting = new Set<() => void>();
  /** The type of every message received, in order, whether or not a test took it out of the inbox. */
  readonly log: ServerToWeb['t'][] = [];
  /** Resolves when the socket closes, with the code the server gave. */
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as ServerToWeb;
      this.inbox.push(msg);
      this.log.push(msg.t);
      for (const wake of this.waiting) wake();
    });
    this.closed = new Promise((resolve) => ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })));
  }

  /** Open a socket with this cookie and Origin. Rejects when the server refuses the upgrade. */
  static open(url: string, headers: { cookie: string; origin: string }): Promise<TestTab> {
    const ws = new WebSocket(url, { headers });
    const tab = new TestTab(ws);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(tab));
      ws.addEventListener('error', () => reject(new Error('the server refused the WebSocket')));
    });
  }

  send(msg: WebToServer): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  subscribe(chatId: string, afterSeq = 0): void {
    this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq } });
  }

  close(): void {
    this.ws.close();
  }

  /** Take the next message of type `t` out of the inbox, waiting up to `ms` for it. Other messages stay. */
  async next<T extends ServerToWeb['t']>(t: T, ms = 2_000): Promise<FromServer<T>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as FromServer<T>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms} ms; the inbox has: ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await this.anyMessage(left);
    }
  }

  /** Every item seq received so far in chat.items, in arrival order (the messages stay in the inbox). */
  seqs(chatId: string): number[] {
    return this.inbox.flatMap((m) => (m.t === 'chat.items' && m.d.chatId === chatId ? m.d.items.map((i) => i.seq) : []));
  }

  /** Fail if a message of type `t` is in the inbox after waiting `ms`. */
  async nothing(t: ServerToWeb['t'], ms = 300): Promise<void> {
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
