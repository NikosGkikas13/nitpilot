import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { upgradeStatus } from '../../test/ws';
import { refuse, routeUpgrades } from './upgrade-router';

describe('routeUpgrades', () => {
  let server: Server;
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  async function serve(routes: Parameters<typeof routeUpgrades>[1]): Promise<number> {
    server = createServer();
    routeUpgrades(server, routes);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  it('hands each path to its own hub, and a query string does not change the path', async () => {
    const seen: string[] = [];
    const port = await serve({
      '/ws/cli': (req, socket) => (seen.push(`cli ${req.url}`), refuse(socket, 401)),
      '/ws/web': (req, socket) => (seen.push(`web ${req.url}`), refuse(socket, 403)),
    });
    expect(await upgradeStatus(port, '/ws/cli')).toBe(401);
    expect(await upgradeStatus(port, '/ws/web?tab=2')).toBe(403);
    expect(seen).toEqual(['cli /ws/cli', 'web /ws/web?tab=2']);
  });

  it('refuses a path no hub owns with a 404', async () => {
    const port = await serve({ '/ws/cli': (_req, socket) => refuse(socket, 401) });
    expect(await upgradeStatus(port, '/ws/other')).toBe(404);
    expect(await upgradeStatus(port, '/')).toBe(404);
  });
});
