import { CLI_WS_PATH, CLOSE_CODES, LEASE_SEC, PING_SEC } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCliToken, makeUser } from '../../test/db';
import { hello, listen, ping, sleep, TestCli, upgradeStatus } from '../../test/ws';
import { prisma } from '../lib/prisma';
import { CliHub } from './cli-hub';

const running: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

/** A hub on a random local port. */
async function hubOnPort(hub = new CliHub()) {
  const server = await listen(hub);
  running.push(server);
  return { hub, ...server };
}

/** A user with one CLI token. */
async function device(login = 'maya') {
  const user = await makeUser({ login });
  return { user, token: await makeCliToken(user.id) };
}

describe('connecting to /ws/cli', () => {
  it('checks the token before upgrading: none, unknown or revoked get 401; other paths 404', async () => {
    const { port } = await hubOnPort();
    const { user, token } = await device();
    const revoked = await makeCliToken(user.id, { revoked: true });
    const bearer = (raw: string) => ({ authorization: `Bearer ${raw}` });
    expect(await upgradeStatus(port, CLI_WS_PATH)).toBe(401);
    expect(await upgradeStatus(port, CLI_WS_PATH, bearer('nit_not-a-real-token'))).toBe(401);
    expect(await upgradeStatus(port, CLI_WS_PATH, bearer(revoked.raw))).toBe(401);
    expect(await upgradeStatus(port, '/ws/web', bearer(token.raw))).toBe(404);
    expect(await upgradeStatus(port, CLI_WS_PATH, bearer(token.raw))).toBe(101);
  });

  it('answers hello with welcome and lists the connection', async () => {
    const { hub, url } = await hubOnPort();
    const { user, token } = await device('maya');
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello({ device: "Maya's MacBook Pro", repos: ['acme/shop-api'], concurrency: 2 }));
    expect((await cli.next('welcome')).d).toEqual({ login: 'maya', pingSec: PING_SEC, leaseSec: LEASE_SEC });
    expect(hub.connection(token.id)).toMatchObject({ userId: user.id, login: 'maya', device: "Maya's MacBook Pro", concurrency: 2, repos: new Set(['acme/shop-api']) });
    expect((await prisma.cliToken.findUniqueOrThrow({ where: { id: token.id } })).lastSeenAt).not.toBeNull();
  });

  it('closes with 4426 when the CLI speaks another protocol version', async () => {
    const { hub, url } = await hubOnPort();
    const { token } = await device();
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello({ protocol: 2 }));
    expect((await cli.closed).code).toBe(CLOSE_CODES.upgradeCli);
    expect(hub.connections()).toEqual([]);
  });

  it('closes a socket whose first message is not hello, or that says nothing at all', async () => {
    const { url } = await hubOnPort(new CliHub({ helloTimeoutMs: 100 }));
    const { token } = await device();
    const eager = await TestCli.connect(url, token.raw);
    eager.send(ping([]));
    expect((await eager.closed).code).toBe(1008);
    const silent = await TestCli.connect(url, token.raw);
    expect((await silent.closed).code).toBe(1008);
  });

  it('drops messages it cannot read and keeps the socket open', async () => {
    const { url } = await hubOnPort();
    const { token } = await device();
    const cli = await TestCli.connect(url, token.raw);
    cli.sendRaw('this is not JSON');
    cli.send({ v: 1, t: 'job.explode', d: {} });
    cli.send(hello());
    await cli.next('welcome');
  });

  it('closes with 4401 when the token is revoked while connected', async () => {
    const { url } = await hubOnPort();
    const { token } = await device();
    const cli = await TestCli.online(url, token.raw);
    await prisma.cliToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    cli.send(ping([]));
    expect((await cli.closed).code).toBe(CLOSE_CODES.reauth);
  });
});

describe('a hello that fails on the server', () => {
  afterEach(() => vi.restoreAllMocks());

  it('closes with 1011 when the server fails while handling hello, so the CLI tries again', async () => {
    const { hub, url } = await hubOnPort();
    const { token } = await device();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.user, 'findUniqueOrThrow').mockRejectedValueOnce(new Error('database unavailable'));
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello());
    const closed = await Promise.race([cli.closed, sleep(1_000).then(() => 'still open')]);
    expect(closed).toMatchObject({ code: 1011 });
    expect(hub.connections()).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });
});

describe('connections', () => {
  it("lists each of a user's devices and closes them all when the server stops", async () => {
    const { hub, url } = await hubOnPort();
    const { user, token } = await device();
    const laptop = await TestCli.online(url, token.raw, { device: 'laptop' });
    const desktop = await TestCli.online(url, (await makeCliToken(user.id)).raw, { device: 'desktop' });
    expect(hub.connectionsFor(user.id).map((c) => c.device).sort()).toEqual(['desktop', 'laptop']);
    hub.closeAll(CLOSE_CODES.serverRestart);
    expect((await laptop.closed).code).toBe(CLOSE_CODES.serverRestart);
    expect((await desktop.closed).code).toBe(CLOSE_CODES.serverRestart);
  });

  it('lets a newer connection with the same token take over, and tells the older one to stop', async () => {
    const { hub, url } = await hubOnPort();
    const { token } = await device();
    const first = await TestCli.online(url, token.raw, { device: 'first' });
    await TestCli.online(url, token.raw, { device: 'second' });
    expect((await first.closed).code).toBe(CLOSE_CODES.replaced);
    await sleep(50); // the server sees the old socket close; that must not unlist the new one
    expect(hub.connections().map((c) => c.device)).toEqual(['second']);
  });

  it('hands hello and every later message to the listeners, one at a time, in order', async () => {
    const hub = new CliHub();
    const seen: string[] = [];
    hub.onMessage(async (_conn, msg) => {
      if (msg.t === 'hello') await sleep(30); // a slow listener must not let later messages overtake it
      seen.push(msg.t);
    });
    const { url } = await hubOnPort(hub);
    const { token } = await device();
    const cli = await TestCli.online(url, token.raw);
    cli.send(ping([]));
    cli.send({ v: 1, t: 'job.progress', d: { jobId: 'job_1', attempt: 1, stage: 'preparing', text: 'fetching the PR' } });
    await vi.waitFor(() => expect(seen).toEqual(['hello', 'ping', 'job.progress']));
  });
});
