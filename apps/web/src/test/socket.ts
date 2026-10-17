import type { ServerToWeb, WebToServer } from '@nitpilot/protocol';
import type { SocketLike } from '../live/socket';

/** A pretend browser WebSocket: the test opens it, sends it server messages, and drops it. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: WebToServer[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as WebToServer);
  }

  close(): void {
    this.readyState = 3;
  }

  /** The server accepted the socket. */
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(msg: ServerToWeb): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(msg) }));
  }

  /** The connection went away (1006 is what a browser reports for a dropped one). */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code }));
  }
}

/** Every socket a page opened, newest last; pass `open` where a socket factory is wanted. */
export function fakeSockets() {
  const all: FakeSocket[] = [];
  return {
    all,
    open: (url: string): FakeSocket => {
      const socket = new FakeSocket(url);
      all.push(socket);
      return socket;
    },
    last: (): FakeSocket => {
      const socket = all.at(-1);
      if (!socket) throw new Error('no socket was opened');
      return socket;
    },
  };
}
