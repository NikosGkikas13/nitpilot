import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { CLOSE_CODES, MAX_WEB_MESSAGE_BYTES, WebToServer, type ServerToWeb, type TimelineItem } from '@nitpilot/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { ACCESS_TTL_MS, type RepoAccess } from '../auth/repo-access';
import { sessionUserFromCookieHeader, type SessionUser } from '../auth/session';
import { chatAccess } from '../chats/access';
import { ITEMS_PER_PAGE } from '../chats/timeline';
import { isAllowedUpgradeOrigin } from '../lib/csrf';
import { getEnv } from '../lib/env';
import { SerialQueue } from '../lib/serial-queue';
import { refuse } from './upgrade-router';

/** WebSocket's "policy violation" close code: the browser sent something it never should. */
const CLOSE_POLICY = 1008;
/** A ping every 30 s; a socket that didn't answer the previous one is dead. So a dead socket goes within 60 s. */
const HEARTBEAT_MS = 30_000;

/** One chat a socket follows. */
type Subscription = {
  chatId: string;
  repoFullName: string;
  /** When read access was last confirmed. */
  checkedAt: number;
  /** The newest item this socket has been sent. */
  sentUpTo: number;
  /** While the catch-up is read from the database, live items wait here; null once it was sent. */
  buffer: TimelineItem[] | null;
};

/** One browser tab's socket. */
type Client = {
  ws: WebSocket;
  user: SessionUser;
  /** The cookie it connected with, to notice a sign-out later. */
  cookie: string | undefined;
  subs: Map<string, Subscription>;
  /** Everything for this socket happens in order: subscribes, catch-ups, sends. */
  queue: SerialQueue;
  /** Answered the last ping. */
  alive: boolean;
};

export type WebHubDeps = {
  access: RepoAccess;
  /** Every item of a chat after `afterSeq`, oldest first (chats/timeline.ts). Tests pass their own. */
  loadItems: (chatId: string, afterSeq: number) => Promise<TimelineItem[]>;
  now?: () => number;
  heartbeatMs?: number;
};

/**
 * The browser end of `/ws/web` (spec §10 "Web ↔ server"). A tab opens one socket, signed in by its cookie, and
 * subscribes to the chats it shows; the server pushes their new items, and whatever else changed for that person.
 * Changes never come in this way: they're REST calls. See docs/why/web-socket-and-origin.md.
 */
export class WebHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WEB_MESSAGE_BYTES });
  private readonly clients = new Set<Client>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly deps: WebHubDeps) {
    this.now = deps.now ?? Date.now;
    this.heartbeat = setInterval(() => this.checkAlive(), deps.heartbeatMs ?? HEARTBEAT_MS);
    // The timer alone never keeps the process running.
    this.heartbeat.unref();
  }

  /** An upgrade request for /ws/web, handed over by the upgrade router (ws/upgrade-router.ts). */
  handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void this.upgrade(req, socket, head);
  };

  /**
   * New items of a chat, after the dispatcher saved them. A socket still catching up keeps them until its
   * catch-up is sent; any it already has are skipped.
   */
  publishItems(chatId: string, items: TimelineItem[]): void {
    for (const client of this.clients) {
      const sub = client.subs.get(chatId);
      if (!sub) continue;
      if (sub.buffer) {
        sub.buffer.push(...items);
        continue;
      }
      client.queue.push(async () => {
        if (await this.stillAllowed(client, sub)) this.sendItems(client, sub, items);
      });
    }
  }

  /** A message for everyone following this chat (the live progress line, say). */
  sendToChat(chatId: string, msg: ServerToWeb): void {
    for (const client of this.clients) this.sendIfSubscribed(client, chatId, msg);
  }

  /** A message for one person's sockets that follow this chat (their own view of it). */
  sendToChatViewer(chatId: string, userId: string, msg: ServerToWeb): void {
    for (const client of this.clients) if (client.user.id === userId) this.sendIfSubscribed(client, chatId, msg);
  }

  /** A message for every socket of one person, whatever they follow (their inbox, their CLIs). */
  sendToUser(userId: string, msg: ServerToWeb): void {
    for (const client of this.clients) {
      if (client.user.id === userId) client.queue.push(async () => send(client.ws, msg));
    }
  }

  /** Who follows this chat right now, once each. */
  subscribers(chatId: string): SessionUser[] {
    const users = new Map<string, SessionUser>();
    for (const client of this.clients) if (client.subs.has(chatId)) users.set(client.user.id, client.user);
    return [...users.values()];
  }

  /** Resolves once everything queued so far for every socket has run. Tests use it. */
  async idle(): Promise<void> {
    await Promise.all([...this.clients].map((c) => c.queue.idle()));
  }

  /** Close every socket and stop the heartbeat. With 1012 on shutdown, the tabs reconnect. */
  close(code: number, reason = ''): void {
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.close(code, reason);
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const onError = () => socket.destroy();
    socket.on('error', onError);
    try {
      // Both are checked before the upgrade, so another site's page never gets a socket (spec §10).
      if (!isAllowedUpgradeOrigin(req.headers, getEnv().PUBLIC_URL)) return refuse(socket, 403);
      const user = await sessionUserFromCookieHeader(req.headers.cookie);
      if (!user) return refuse(socket, 401);
      socket.removeListener('error', onError);
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, user, req.headers.cookie));
    } catch (err) {
      console.error('[web-hub] upgrade failed:', err);
      refuse(socket, 500);
    }
  }

  private accept(ws: WebSocket, user: SessionUser, cookie: string | undefined): void {
    const client: Client = { ws, user, cookie, subs: new Map(), queue: new SerialQueue(), alive: true };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data, isBinary) => {
      const msg = readMessage(data, isBinary);
      if (!msg) return ws.close(CLOSE_POLICY, 'not a message this server understands');
      if (msg.t === 'chat.subscribe') client.queue.push(() => this.subscribe(client, msg.d.chatId, msg.d.afterSeq));
      else client.queue.push(async () => void client.subs.delete(msg.d.chatId));
    });
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', (err) => console.warn('[web-hub] socket error:', err.message));
  }

  /**
   * Resuming without gaps (spec §10): register the subscription first, so items saved from now on wait in its
   * buffer; then send everything after `afterSeq` from the database; then the buffer, skipping what the
   * database already had. An item saved during the read is in both, and goes once.
   */
  private async subscribe(client: Client, chatId: string, afterSeq: number): Promise<void> {
    if (!(await this.sessionStillValid(client))) return;
    let allowed: Awaited<ReturnType<typeof chatAccess>>;
    try {
      allowed = await chatAccess(client.user, chatId, this.deps.access);
    } catch (err) {
      console.error(`[web-hub] could not check access to chat ${chatId}:`, err);
      return send(client.ws, chatError(chatId, 'unavailable'));
    }
    if (allowed.kind !== 'read') return send(client.ws, chatError(chatId, allowed.kind === 'reauth' ? 'reauth' : 'not_found'));

    const sub: Subscription = { chatId, repoFullName: allowed.chat.repoFullName, checkedAt: this.now(), sentUpTo: afterSeq, buffer: [] };
    client.subs.set(chatId, sub);
    const missed = await this.deps.loadItems(chatId, afterSeq);
    // Even with nothing missed, one chat.items says "you're caught up".
    if (missed.length === 0) send(client.ws, { v: 1, t: 'chat.items', d: { chatId, items: [], lastSeq: afterSeq } });
    for (let i = 0; i < missed.length; i += ITEMS_PER_PAGE) this.sendItems(client, sub, missed.slice(i, i + ITEMS_PER_PAGE));
    const live = sub.buffer ?? [];
    sub.buffer = null;
    this.sendItems(client, sub, live);
  }

  /** Send the items this socket doesn't have yet, oldest first. */
  private sendItems(client: Client, sub: Subscription, items: TimelineItem[]): void {
    const fresh = items.filter((item) => item.seq > sub.sentUpTo).sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;
    sub.sentUpTo = fresh[fresh.length - 1]!.seq;
    send(client.ws, { v: 1, t: 'chat.items', d: { chatId: sub.chatId, items: fresh, lastSeq: sub.sentUpTo } });
  }

  private sendIfSubscribed(client: Client, chatId: string, msg: ServerToWeb): void {
    if (!client.subs.has(chatId)) return;
    client.queue.push(async () => {
      const sub = client.subs.get(chatId);
      if (sub && (await this.stillAllowed(client, sub))) send(client.ws, msg);
    });
  }

  /**
   * Access is kept 5 minutes, like everywhere else (spec §16). Past that, the next thing sent for this chat
   * asks again: a person removed from the repo gets `chat.error` and nothing more. If GitHub doesn't answer,
   * the subscription stays and is asked about again next time: a GitHub hiccup isn't a reason to cut people off.
   */
  private async stillAllowed(client: Client, sub: Subscription): Promise<boolean> {
    if (this.now() - sub.checkedAt < ACCESS_TTL_MS) return true;
    if (!(await this.sessionStillValid(client))) return false;
    let answer: Awaited<ReturnType<RepoAccess['check']>>;
    try {
      answer = await this.deps.access.check(client.user.id, sub.repoFullName);
    } catch (err) {
      console.error(`[web-hub] could not check access to ${sub.repoFullName} again:`, err);
      return true;
    }
    if (answer === 'read') {
      sub.checkedAt = this.now();
      return true;
    }
    client.subs.delete(sub.chatId);
    send(client.ws, chatError(sub.chatId, answer === 'reauth' ? 'reauth' : 'not_found'));
    return false;
  }

  /** A socket whose session ended (signed out, expired) is closed with 4401: the tab shows the landing page. */
  private async sessionStillValid(client: Client): Promise<boolean> {
    if (await sessionUserFromCookieHeader(client.cookie)) return true;
    client.ws.close(CLOSE_CODES.reauth, 'signed out');
    return false;
  }

  /** Terminate sockets that didn't answer the last ping, and ping the rest. */
  private checkAlive(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }
}

function chatError(chatId: string, code: 'not_found' | 'reauth' | 'unavailable'): ServerToWeb {
  return { v: 1, t: 'chat.error', d: { chatId, code } };
}

function send(ws: WebSocket, msg: ServerToWeb): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** One frame as a browser message, or null when it isn't one. */
function readMessage(data: RawData, isBinary: boolean): WebToServer | null {
  if (isBinary) return null;
  try {
    const parsed = WebToServer.safeParse(JSON.parse(data.toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
