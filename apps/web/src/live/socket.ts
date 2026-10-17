import { ServerToWeb, WEB_WS_PATH, type WebToServer } from '@nitpilot/protocol';

/** The part of a browser WebSocket this file uses; tests pass a fake. */
export type SocketLike = {
  /** 1 once open, as on a browser WebSocket. */
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
};

export type LiveSocketOptions = {
  url: string;
  onMessage(msg: ServerToWeb): void;
  /** The server closed with 4401: the session ended. */
  onSignedOut?(): void;
  open?: (url: string) => SocketLike;
  /** Reconnect waits: 1 s, doubling up to 30 s, each nudged up to 20% either way (docs/why/websockets.md). */
  backoff?: { startMs: number; maxMs: number; random: () => number };
};

/** How long to wait before asking again for a chat the server couldn't check (GitHub didn't answer). */
const RESUBSCRIBE_MS = 5_000;

/** Where this page's socket goes: `/ws/web` on the same address, `wss:` when the page is `https:`. */
export function liveUrl(location: { protocol: string; host: string } = window.location): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${WEB_WS_PATH}`;
}

/**
 * The tab's one `/ws/web` socket (spec §10). It remembers which chats are open and the newest item each one has,
 * and after any drop it reconnects with a growing wait and subscribes to them again from there.
 */
export class LiveSocket {
  private ws: SocketLike | null = null;
  /** Open chats → the newest seq this tab has. */
  private readonly chats = new Map<string, number>();
  private readonly backoff: { startMs: number; maxMs: number; random: () => number };
  private delayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly opts: LiveSocketOptions) {
    this.backoff = opts.backoff ?? { startMs: 1_000, maxMs: 30_000, random: Math.random };
    this.delayMs = this.backoff.startMs;
  }

  start(): void {
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  /** Follow a chat from `afterSeq` on. Calling it again for the same chat never goes back. */
  subscribe(chatId: string, afterSeq: number): void {
    this.chats.set(chatId, Math.max(afterSeq, this.chats.get(chatId) ?? 0));
    this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq: this.chats.get(chatId)! } });
  }

  unsubscribe(chatId: string): void {
    this.chats.delete(chatId);
    this.send({ v: 1, t: 'chat.unsubscribe', d: { chatId } });
  }

  private connect(): void {
    const ws = (this.opts.open ?? ((url) => new WebSocket(url)))(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      this.delayMs = this.backoff.startMs;
      for (const [chatId, afterSeq] of this.chats) this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq } });
    };
    ws.onmessage = (event) => this.receive(event.data);
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.running) return;
      if (event.code === 4401) return this.opts.onSignedOut?.();
      this.reconnectLater();
    };
  }

  private receive(data: unknown): void {
    let parsed: ReturnType<typeof ServerToWeb.safeParse>;
    try {
      parsed = ServerToWeb.safeParse(JSON.parse(String(data)));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const msg = parsed.data;
    if (msg.t === 'chat.items' && this.chats.has(msg.d.chatId)) this.chats.set(msg.d.chatId, Math.max(this.chats.get(msg.d.chatId)!, msg.d.lastSeq));
    if (msg.t === 'chat.error') this.dropped(msg.d.chatId, msg.d.code);
    this.opts.onMessage(msg);
  }

  /** The server dropped this subscription. A hiccup (GitHub didn't answer) is worth asking again for; a no isn't. */
  private dropped(chatId: string, code: 'not_found' | 'reauth' | 'unavailable'): void {
    if (code !== 'unavailable') {
      this.chats.delete(chatId);
      return;
    }
    setTimeout(() => {
      const afterSeq = this.chats.get(chatId);
      if (afterSeq !== undefined) this.send({ v: 1, t: 'chat.subscribe', d: { chatId, afterSeq } });
    }, RESUBSCRIBE_MS);
  }

  private reconnectLater(): void {
    const jitter = 1 + (this.backoff.random() * 2 - 1) * 0.2;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.running) this.connect();
    }, this.delayMs * jitter);
    this.delayMs = Math.min(this.delayMs * 2, this.backoff.maxMs);
  }

  private send(msg: WebToServer): void {
    // Not open yet: onopen subscribes to every open chat, this one included.
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
