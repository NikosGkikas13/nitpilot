import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  BRAND, CLOSE_CODES, CliToServer, LEASE_SEC, MAX_MESSAGE_BYTES, PING_SEC, PROTOCOL_VERSION, type ServerToCli,
} from '@nitpilot/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { authenticateCliToken, touchCliToken, type CliAuth } from '../auth/cli-token';
import { prisma } from '../lib/prisma';
import { SerialQueue } from '../lib/serial-queue';
import { refuse } from './upgrade-router';

/** A socket that hasn't said hello by then is closed. */
const HELLO_TIMEOUT_MS = 10_000;
/** WebSocket's "policy violation" close code: the CLI broke the rules of the conversation. */
const CLOSE_POLICY = 1008;
/** WebSocket's "internal error" close code: the server failed; the CLI reconnects and tries again. */
const CLOSE_SERVER_ERROR = 1011;

type Hello = Extract<CliToServer, { t: 'hello' }>;

/** One connected CLI, after its hello. There's at most one per CLI token, so one per device. */
export type CliConnection = {
  tokenId: string;
  userId: string;
  login: string;
  device: string;
  agent: Hello['d']['agent'];
  /** Repos linked on that machine, as `owner/name`. */
  repos: Set<string>;
  /** How many jobs it runs at once. */
  concurrency: number;
  /** When it last sent anything. A CLI pings every 25 s, so a long silence means the socket is dead. */
  lastMessageAt: Date;
  /** For each run bound to this CLI (keyed `jobId#attempt`), how many pings in a row left it out (jobs/leases.ts). */
  missedPings: Map<string, number>;
  send(msg: ServerToCli): boolean;
  close(code: number, reason: string): void;
  terminate(): void;
};

/** Called for every message a CLI sends, from its hello on: one message at a time per CLI, in order. */
export type MessageListener = (conn: CliConnection, msg: CliToServer) => Promise<void>;

/**
 * The server end of `nitpilot start` (spec §10). CLIs connect to /ws/cli with their token, say
 * hello, and then exchange job messages. This class only looks after the sockets; what a message
 * means is up to the listeners (ws/wire.ts connects them). See docs/why/websockets.md.
 */
export class CliHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly byToken = new Map<string, CliConnection>();
  private readonly queues = new Set<SerialQueue>();
  private readonly listeners: MessageListener[] = [];

  constructor(private readonly opts: { helloTimeoutMs?: number } = {}) {}

  /** An upgrade request for /ws/cli, handed over by the upgrade router (ws/upgrade-router.ts). */
  handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void this.upgrade(req, socket, head);
  };

  onMessage(listener: MessageListener): void {
    this.listeners.push(listener);
  }

  connections(): CliConnection[] {
    return [...this.byToken.values()];
  }

  connectionsFor(userId: string): CliConnection[] {
    return this.connections().filter((c) => c.userId === userId);
  }

  connection(tokenId: string): CliConnection | undefined {
    return this.byToken.get(tokenId);
  }

  /** Send to the CLI with this token. False when it isn't connected. */
  send(tokenId: string, msg: ServerToCli): boolean {
    return this.byToken.get(tokenId)?.send(msg) ?? false;
  }

  /** Close every socket. With 1012 on shutdown, the CLIs reconnect. */
  closeAll(code: number, reason = ''): void {
    for (const ws of this.wss.clients) ws.close(code, reason);
  }

  /** Resolves once every message received so far has been handled. Tests use it. */
  async idle(): Promise<void> {
    await Promise.all([...this.queues].map((q) => q.idle()));
  }

  /**
   * Drop CLIs that sent nothing since `cutoff`. Their socket is dead (a laptop that slept, a network
   * that vanished), so no job may go there. Returns how many were dropped.
   */
  dropSilent(cutoff: Date): number {
    const silent = this.connections().filter((c) => c.lastMessageAt < cutoff);
    for (const c of silent) {
      this.byToken.delete(c.tokenId);
      c.terminate();
    }
    return silent.length;
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const onError = () => socket.destroy();
    socket.on('error', onError);
    try {
      // The token is checked before the upgrade: without one there's no socket at all (spec §10).
      const auth = await authenticateCliToken(req.headers.authorization);
      if (!auth) return refuse(socket, 401);
      socket.removeListener('error', onError);
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, auth));
    } catch (err) {
      console.error('[cli-hub] upgrade failed:', err);
      refuse(socket, 500);
    }
  }

  /** A new socket. Its messages are handled one at a time, in order, and the first must be hello. */
  private accept(ws: WebSocket, auth: CliAuth): void {
    const queue = new SerialQueue();
    this.queues.add(queue);
    let conn: CliConnection | null = null;
    const helloTimer = setTimeout(() => ws.close(CLOSE_POLICY, 'say hello first'), this.opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) =>
      queue.push(async () => {
        const msg = readMessage(data, isBinary);
        if (!msg) return;
        // Checked on every message, so a revoked token is noticed at once. It also keeps lastSeenAt fresh.
        if (!(await touchCliToken(auth.tokenId))) {
          ws.close(CLOSE_CODES.reauth, `This device was signed out. Run \`${BRAND.cli} login\`.`);
          return;
        }
        if (!conn) {
          if (msg.t !== 'hello') {
            ws.close(CLOSE_POLICY, 'the first message must be hello');
            return;
          }
          clearTimeout(helloTimer);
          try {
            conn = await this.register(ws, auth, msg);
          } catch (err) {
            // The hello was fine but we failed (a database hiccup, say). Without this the socket would stay
            // open and silent for good, with no timer left to close it: hang up so the CLI tries again.
            console.error('[cli-hub] could not finish the handshake:', err);
            ws.close(CLOSE_SERVER_ERROR, 'server error, try again');
            return;
          }
          if (!conn) return;
        } else if (msg.t === 'hello') {
          console.warn(`[cli-hub] ${conn.login}/${conn.device} said hello twice; ignored`);
          return;
        }
        conn.lastMessageAt = new Date();
        await this.emit(conn, msg);
      }),
    );
    ws.on('close', () => {
      clearTimeout(helloTimer);
      // A newer connection with the same token may already have taken this one's place: leave it be.
      if (conn && this.byToken.get(conn.tokenId) === conn) this.byToken.delete(conn.tokenId);
      void queue.idle().then(() => this.queues.delete(queue));
    });
    ws.on('error', (err) => console.warn('[cli-hub] socket error:', err.message));
  }

  /** Check the hello, make this socket the device's connection, and answer welcome. */
  private async register(ws: WebSocket, auth: CliAuth, hello: Hello): Promise<CliConnection | null> {
    if (hello.d.protocol !== PROTOCOL_VERSION) {
      ws.close(CLOSE_CODES.upgradeCli, `This server speaks protocol ${PROTOCOL_VERSION}. Upgrade ${BRAND.cli}.`);
      return null;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { login: true } });
    const conn: CliConnection = {
      tokenId: auth.tokenId,
      userId: auth.userId,
      login: user.login,
      device: hello.d.device,
      agent: hello.d.agent,
      repos: new Set(hello.d.repos),
      concurrency: hello.d.concurrency,
      lastMessageAt: new Date(),
      missedPings: new Map(),
      send: (msg) => {
        if (ws.readyState !== ws.OPEN) return false;
        ws.send(JSON.stringify(msg));
        return true;
      },
      close: (code, reason) => ws.close(code, reason),
      terminate: () => ws.terminate(),
    };
    // One connection per device. A second one with the same token is the same laptop back from
    // sleep, or a second `nitpilot start`: the newest wins, and the old one is told to stop.
    this.byToken.get(auth.tokenId)?.close(CLOSE_CODES.replaced, `Another ${BRAND.cli} start on this device took over.`);
    this.byToken.set(auth.tokenId, conn);
    conn.send({ v: 1, t: 'welcome', d: { login: user.login, pingSec: PING_SEC, leaseSec: LEASE_SEC } });
    return conn;
  }

  private async emit(conn: CliConnection, msg: CliToServer): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(conn, msg);
      } catch (err) {
        console.error(`[cli-hub] handling ${msg.t} from ${conn.login}/${conn.device} failed:`, err);
      }
    }
  }
}

/** One frame as a CLI message, or null (logged) when it isn't one. A bad message never closes the socket. */
function readMessage(data: RawData, isBinary: boolean): CliToServer | null {
  if (isBinary) {
    console.warn('[cli-hub] dropped a binary message');
    return null;
  }
  let json: unknown;
  try {
    // ws hands text frames over as a Buffer.
    json = JSON.parse(data.toString());
  } catch {
    console.warn('[cli-hub] dropped a message that is not JSON');
    return null;
  }
  const parsed = CliToServer.safeParse(json);
  if (!parsed.success) {
    console.warn(`[cli-hub] dropped an invalid message: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
    return null;
  }
  return parsed.data;
}
