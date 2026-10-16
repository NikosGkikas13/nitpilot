import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

/** What handles a WebSocket upgrade for one path: a hub's `handleUpgrade`. */
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * Send each WebSocket upgrade on this HTTP server to the hub for its path (`/ws/cli`, `/ws/web`). Node gives a
 * server one 'upgrade' event for every path, so one listener has to pick; two hubs listening would both answer.
 * A path no hub owns gets a 404.
 */
export function routeUpgrades(server: Server, routes: Record<string, UpgradeHandler>): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const handler = routes[path];
    if (!handler) return refuse(socket, 404);
    handler(req, socket, head);
  });
}

/** Answer an upgrade request with a plain HTTP error and hang up. */
export function refuse(socket: Duplex, status: 401 | 403 | 404 | 500): void {
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
