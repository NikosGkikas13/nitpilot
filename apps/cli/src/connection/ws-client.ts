import { CLI_WS_PATH, ServerToCli, type CliToServer } from '@nitpilot/protocol';

/** How a socket ended. `opened` is false when it never connected (refused, unreachable). */
export type Closed = { code: number; reason: string; opened: boolean };

export type ServerSocket = {
  send(msg: CliToServer): boolean;
  close(code: number, reason: string): void;
  /** Give up on a socket that looks open but is dead: `closed` resolves now instead of when TCP notices. */
  abandon(): void;
  /** Resolves exactly once. */
  closed: Promise<Closed>;
};

export type SocketHandlers = {
  server: string;
  token: string;
  onOpen(): void;
  onMessage(msg: ServerToCli): void;
  warn(text: string): void;
};

/**
 * One WebSocket to the server's /ws/cli, carrying this device's token (Node's built-in client, spec §10).
 * Messages that don't fit the protocol are reported and dropped.
 */
export function openSocket(h: SocketHandlers): ServerSocket {
  const ws = new WebSocket(`${h.server.replace(/^http/, 'ws')}${CLI_WS_PATH}`, { headers: { authorization: `Bearer ${h.token}` } });
  let opened = false;
  let ended = false;
  let settle!: (closed: Closed) => void;
  const closed = new Promise<Closed>((resolve) => (settle = resolve));
  const end = (how: Closed) => {
    if (ended) return;
    ended = true;
    settle(how);
  };

  ws.addEventListener('open', () => {
    opened = true;
    h.onOpen();
  });
  ws.addEventListener('message', (event) => {
    if (ended) return; // abandoned: ignore whatever still trickles in
    let json: unknown;
    try {
      json = JSON.parse(String(event.data));
    } catch {
      h.warn('dropped a message that is not JSON');
      return;
    }
    const parsed = ServerToCli.safeParse(json);
    if (!parsed.success) {
      h.warn(`dropped a message the protocol doesn't know: ${String(event.data).slice(0, 200)}`);
      return;
    }
    h.onMessage(parsed.data);
  });
  // An 'error' is always followed by 'close', which says what we need to know.
  ws.addEventListener('close', (event) => end({ code: event.code, reason: event.reason, opened }));

  return {
    send(msg) {
      if (ended || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close(code, reason) {
      ws.close(code, reason);
    },
    abandon() {
      end({ code: 4000, reason: 'the server went quiet', opened });
      ws.close(4000, 'the server went quiet');
    },
    closed,
  };
}
