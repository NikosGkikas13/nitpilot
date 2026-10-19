import { CLI_WS_PATH, CLOSE_CODES, LEASE_SEC, PING_SEC, WebMe } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../test/app';
import { makeCliToken, makeUser } from '../../test/db';
import { sessionCookieFor } from '../../test/http';
import { hello, listen, ping, sleep, startCliServer, TestCli, upgradeStatus } from '../../test/ws';
import { prisma } from '../lib/prisma';
import { CliHub, SIGNED_OUT_REASON, type PresenceChange } from './cli-hub';

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
    expect(await upgradeStatus(port, '/ws/other', bearer(token.raw))).toBe(404);
    expect(await upgradeStatus(port, CLI_WS_PATH, bearer(token.raw))).toBe(101);
  });

  it('answers hello with welcome and lists the connection', async () => {
    const { hub, url } = await hubOnPort();
    const { user, token } = await device('maya');
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello({ device: "Maya's MacBook Pro", repos: ['acme/shop-api'], concurrency: 2 }));
    expect((await cli.next('welcome')).d).toEqual({
      login: 'maya',
      pingSec: PING_SEC,
      leaseSec: LEASE_SEC,
      settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 },
    });
    expect(hub.connection(token.id)).toMatchObject({ userId: user.id, login: 'maya', device: "Maya's MacBook Pro", concurrency: 2, repos: new Set(['acme/shop-api']) });
    expect((await prisma.cliToken.findUniqueOrThrow({ where: { id: token.id } })).lastSeenAt).not.toBeNull();
  });

  it("welcomes the CLI with its owner's settings", async () => {
    const { url } = await hubOnPort();
    const { user, token } = await device('maya');
    await prisma.user.update({ where: { id: user.id }, data: { autoReview: false, dailyJobCap: 15 } });
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello());
    expect((await cli.next('welcome')).d.settings).toEqual({ autoReview: false, autoAddress: true, dailyJobCap: 15 });
  });

  it('sends a settings change that landed while the welcome was being prepared, right after the welcome', async () => {
    const { url } = await hubOnPort();
    const { user, token } = await device('maya');
    // The first read of the user (the hub's, for the welcome) returns the old settings; then, before the hub goes on,
    // the settings change in the database, as a PUT /api/me/settings would. Its sendSettings reaches nobody: this CLI
    // isn't registered yet.
    const realRead = prisma.user.findUniqueOrThrow.bind(prisma.user);
    const spy = vi.spyOn(prisma.user, 'findUniqueOrThrow') as unknown as { mockImplementationOnce(fn: (args: unknown) => Promise<unknown>): void };
    spy.mockImplementationOnce(async (args) => {
      const old = await realRead(args as never);
      await prisma.user.update({ where: { id: user.id }, data: { dailyJobCap: 90 } });
      return old;
    });
    try {
      const cli = await TestCli.connect(url, token.raw);
      cli.send(hello());
      expect((await cli.next('welcome')).d.settings.dailyJobCap).toBe(40);
      expect((await cli.next('settings')).d).toEqual({ autoReview: true, autoAddress: true, dailyJobCap: 90 });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('sends no settings after the welcome when nothing changed meanwhile', async () => {
    const { url } = await hubOnPort();
    const { token } = await device('maya');
    const cli = await TestCli.connect(url, token.raw);
    cli.send(hello());
    await cli.next('welcome');
    await cli.nothing('settings', 150);
  });

  /** Make the hub's second read of the user (the re-check after the welcome) run `second` instead. The first read is the real one. */
  function onSecondUserRead(second: () => Promise<unknown>) {
    const realRead = prisma.user.findUniqueOrThrow.bind(prisma.user);
    let calls = 0;
    const spy = vi.spyOn(prisma.user, 'findUniqueOrThrow') as unknown as { mockImplementation(fn: (args: unknown) => Promise<unknown>): void };
    spy.mockImplementation((args) => (++calls === 2 ? second() : realRead(args as never)));
  }

  it('leaves no connection behind when the CLI hangs up while its settings are re-checked', async () => {
    const { hub, url } = await hubOnPort();
    const changes: string[] = [];
    hub.onPresence((e) => changes.push(e.change));
    const { token } = await device('maya');
    const cli = await TestCli.connect(url, token.raw);
    onSecondUserRead(async () => {
      cli.close();
      await cli.closed;
      await sleep(100); // the hub's own close handler runs about now
      return { autoReview: true, autoAddress: true, dailyJobCap: 40 };
    });
    try {
      cli.send(hello());
      await vi.waitFor(() => expect(changes).toEqual(['connected', 'disconnected']));
      expect(hub.connections()).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('hangs up with a server error, and keeps no connection, when the settings re-check fails', async () => {
    const { hub, url } = await hubOnPort();
    const changes: string[] = [];
    hub.onPresence((e) => changes.push(e.change));
    const { token } = await device('maya');
    const cli = await TestCli.connect(url, token.raw);
    onSecondUserRead(async () => {
      throw new Error('database hiccup');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      cli.send(hello());
      expect((await cli.closed).code).toBe(1011); // CLOSE_SERVER_ERROR: the CLI reconnects and gets a fresh welcome
      await vi.waitFor(() => expect(changes).toEqual(['connected', 'disconnected']));
      expect(hub.connections()).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
    expect(logged).toHaveBeenCalled();
  });

  it('closes with 4426 when the CLI speaks another protocol version: a Plan 1 CLI, with its old hello, is told to upgrade', async () => {
    const { hub, url } = await hubOnPort();
    const { token } = await device();
    const cli = await TestCli.connect(url, token.raw);
    cli.send({ ...hello({ protocol: 1 }), d: { ...hello({ protocol: 1 }).d, defaults: { autoReview: true, autoAddress: true } } });
    const closed = await cli.closed;
    expect(closed.code).toBe(CLOSE_CODES.upgradeCli);
    expect(closed.reason).toContain('protocol 2');
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

  it('says when a device comes online and when it goes, but not when the same device reconnects over itself', async () => {
    const { hub, url } = await hubOnPort();
    const changes: PresenceChange[] = [];
    hub.onPresence((e) => changes.push(e));
    const { user, token } = await device();
    const first = await TestCli.online(url, token.raw);
    const second = await TestCli.online(url, token.raw);
    await first.closed;
    second.close();
    await vi.waitFor(() => expect(changes.map((c) => c.change)).toEqual(['connected', 'disconnected']));
    expect(changes[0]).toEqual({ userId: user.id, tokenId: token.id, change: 'connected' });

    // A CLI that went silent is dropped, and that's a disconnect too.
    await TestCli.online(url, token.raw);
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    hub.dropSilent(new Date(Date.now() + 1_000));
    expect(changes.map((c) => c.change)).toEqual(['connected', 'disconnected', 'connected', 'disconnected']);
  });

  it("sends new settings to each of the person's connected CLIs, and says how many got them", async () => {
    const { hub, url } = await hubOnPort();
    const { user, token } = await device('maya');
    const laptop = await TestCli.online(url, token.raw, { device: 'laptop' });
    const desktop = await TestCli.online(url, (await makeCliToken(user.id)).raw, { device: 'desktop' });
    const leos = await TestCli.online(url, (await device('leo')).token.raw);
    const settings = { autoReview: true, autoAddress: false, dailyJobCap: 60 };
    expect(hub.sendSettings(user.id, settings)).toBe(2);
    expect((await laptop.next('settings')).d).toEqual(settings);
    expect((await desktop.next('settings')).d).toEqual(settings);
    await leos.nothing('settings');
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

describe("a device's usage today", () => {
  it("starts at 0, follows each ping's usedToday, and /api/me adds up the person's connected CLIs", async () => {
    const server = await startCliServer();
    running.push(server);
    const { user, token } = await device('maya');
    const laptop = await TestCli.online(server.url, token.raw, { device: 'laptop' });
    const desktop = await TestCli.online(server.url, (await makeCliToken(user.id)).raw, { device: 'desktop' });
    expect(server.hub.connection(token.id)?.usedToday).toBe(0);
    laptop.send(ping([], 3));
    desktop.send(ping([], 4));
    await laptop.next('pong');
    await desktop.next('pong');
    expect(server.hub.connection(token.id)?.usedToday).toBe(3);
    const me = async () => WebMe.parse(await (await testApp({ clis: server.hub }).request('/api/me', { headers: { cookie: await sessionCookieFor(user.id) } })).json());
    expect((await me()).usedToday).toBe(7);
    // A device that goes offline stops counting: the Settings page shows what the connected ones did.
    desktop.close();
    await vi.waitFor(() => expect(server.hub.connectionsFor(user.id)).toHaveLength(1));
    expect((await me()).usedToday).toBe(3);
  });
});

describe('what a device remembers from its last hello (the Settings page, spec §8 `CliToken`)', () => {
  const remembered = (tokenId: string) =>
    prisma.cliToken.findUniqueOrThrow({ where: { id: tokenId }, select: { agentId: true, agentVersion: true, repos: true } });

  it('saves the agent and the linked repos before anyone hears the device came online', async () => {
    const hub = new CliHub();
    const { token } = await device();
    // What a presence listener (the web app's me.update) reads when the device comes online.
    const seenAtPresence: unknown[] = [];
    hub.onPresence((e) => void remembered(e.tokenId).then((row) => seenAtPresence.push(row)));
    const { url } = await hubOnPort(hub);
    await TestCli.online(url, token.raw, { agent: { id: 'claude-code', version: '2.1.290', modes: ['reviewer', 'editor'] }, repos: ['acme/shop-api', 'acme/web'] });
    const saved = { agentId: 'claude-code', agentVersion: '2.1.290', repos: ['acme/shop-api', 'acme/web'] };
    expect(await remembered(token.id)).toEqual(saved);
    await vi.waitFor(() => expect(seenAtPresence).toEqual([saved]));
  });

  it('remembers no agent when the hello says it can do nothing (no modes), and replaces what an earlier hello said', async () => {
    const { url } = await hubOnPort();
    const { token } = await device();
    const first = await TestCli.online(url, token.raw, { agent: { id: 'gemini-cli', version: '0.9.0', modes: ['reviewer'] }, repos: ['acme/shop-api'] });
    first.close();
    await first.closed;
    await TestCli.online(url, token.raw, { agent: { id: 'claude-code', version: null, modes: [] }, repos: [] });
    expect(await remembered(token.id)).toEqual({ agentId: null, agentVersion: null, repos: [] });
  });
});

describe('closeToken (a device revoked on the Settings page)', () => {
  it("closes that device's socket with the code and reason given, forgets it at once, and says it went away", async () => {
    const { hub, url } = await hubOnPort();
    const changes: PresenceChange[] = [];
    hub.onPresence((e) => changes.push(e));
    const { user, token } = await device();
    const laptop = await TestCli.online(url, token.raw);
    const desktop = await TestCli.online(url, (await makeCliToken(user.id)).raw, { device: 'desktop' });
    expect(hub.closeToken(token.id, CLOSE_CODES.reauth, SIGNED_OUT_REASON)).toBe(true);
    expect(hub.connection(token.id)).toBeUndefined();
    expect(changes.at(-1)).toEqual({ userId: user.id, tokenId: token.id, change: 'disconnected' });
    expect(await laptop.closed).toEqual({ code: CLOSE_CODES.reauth, reason: SIGNED_OUT_REASON });
    // The other device stays, and the old socket's close event doesn't report the device gone a second time.
    await sleep(50);
    expect(hub.connectionsFor(user.id).map((c) => c.device)).toEqual(['desktop']);
    expect(changes.filter((c) => c.change === 'disconnected')).toHaveLength(1);
    desktop.close();
  });

  it('returns false for a device that is not connected', async () => {
    const { hub } = await hubOnPort();
    const { token } = await device();
    expect(hub.closeToken(token.id, CLOSE_CODES.reauth, 'signed out')).toBe(false);
  });
});
