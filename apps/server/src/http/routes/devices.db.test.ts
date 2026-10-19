import { CLOSE_CODES, DevicesResponse } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { makeCliToken, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';
import { listen, TestCli } from '../../../test/ws';
import { prisma } from '../../lib/prisma';
import { CliHub, SIGNED_OUT_REASON } from '../../ws/cli-hub';

const ORIGIN = 'http://localhost:8787';

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/**
 * maya, signed in to the web app, with three CLI tokens: her laptop (online, on Claude Code), her desk (offline, it
 * remembers Gemini CLI from its last hello) and an old one she revoked. leo has a laptop of his own, online.
 */
async function scene() {
  const hub = new CliHub();
  const server = await listen(hub);
  servers.push(server);
  const [maya, leo] = [await makeUser({ login: 'maya' }), await makeUser({ login: 'leo' })];
  const laptop = await makeCliToken(maya.id);
  await prisma.cliToken.update({ where: { id: laptop.id }, data: { name: "Maya's MacBook Pro" } });
  const laptopCli = await TestCli.online(server.url, laptop.raw, { agent: { id: 'claude-code', version: '2.1.290', modes: ['reviewer', 'editor'] } });
  const desk = await makeCliToken(maya.id);
  const deskSeen = new Date('2026-10-15T09:30:00.000Z');
  await prisma.cliToken.update({ where: { id: desk.id }, data: { name: 'maya-linux-desk', lastSeenAt: deskSeen, agentId: 'gemini-cli', agentVersion: '0.9.0' } });
  await makeCliToken(maya.id, { revoked: true });
  const leosLaptop = await makeCliToken(leo.id);
  await TestCli.online(server.url, leosLaptop.raw);
  const sendMeUpdate = vi.fn(async () => {});
  const app = testApp({ clis: hub, meUpdates: { sendMeUpdate } });
  const cookie = await sessionCookieFor(maya.id);
  const list = async (headers: Record<string, string> = { cookie }) => app.request('/api/devices', { headers });
  const revoke = (id: string, headers: Record<string, string> = { cookie, origin: ORIGIN }) => app.request(`/api/devices/${id}`, { method: 'DELETE', headers });
  return { hub, maya, leo, laptop, laptopCli, desk, deskSeen, leosLaptop, app, cookie, list, revoke, sendMeUpdate };
}

const revokedAt = async (tokenId: string) => (await prisma.cliToken.findUniqueOrThrow({ where: { id: tokenId } })).revokedAt;

describe('GET /api/devices', () => {
  it('lists only your own devices that are not revoked: the online one with its live agent, the offline one with the agent it remembers', async () => {
    const { laptop, desk, deskSeen, list } = await scene();
    const res = await list();
    expect(res.status).toBe(200);
    const { devices } = DevicesResponse.parse(await res.json());
    expect(devices).toEqual([
      { id: laptop.id, name: "Maya's MacBook Pro", lastSeenAt: expect.any(String), online: true, agent: { id: 'claude-code', version: '2.1.290' } },
      { id: desk.id, name: 'maya-linux-desk', lastSeenAt: deskSeen.toISOString(), online: false, agent: { id: 'gemini-cli', version: '0.9.0' } },
    ]);
  });

  it('shows a device that never connected with no last-seen time and no agent', async () => {
    const { maya, list } = await scene();
    const fresh = await makeCliToken(maya.id);
    const { devices } = DevicesResponse.parse(await (await list()).json());
    expect(devices.find((d) => d.id === fresh.id)).toEqual({ id: fresh.id, name: 'test laptop', lastSeenAt: null, online: false, agent: null });
  });

  it("refuses a CLI's token like no sign-in at all, and no sign-in with a 401", async () => {
    const { laptop, list } = await scene();
    expect((await list({ authorization: `Bearer ${laptop.raw}` })).status).toBe(401);
    expect((await list({})).status).toBe(401);
  });
});

describe('DELETE /api/devices/:id', () => {
  it('revokes the device, closes its socket with 4401 so it has to log in again, and tells your open tabs', async () => {
    const { hub, maya, laptop, laptopCli, revoke, list, sendMeUpdate } = await scene();
    const res = await revoke(laptop.id);
    expect(res.status).toBe(204);
    expect(await revokedAt(laptop.id)).not.toBeNull();
    expect(await laptopCli.closed).toEqual({ code: CLOSE_CODES.reauth, reason: SIGNED_OUT_REASON });
    // The hub forgets it at once: nothing more goes to that socket, and /api/me says the agent is offline.
    expect(hub.connectionsFor(maya.id)).toEqual([]);
    expect(sendMeUpdate).toHaveBeenCalledWith(maya.id);
    const { devices } = DevicesResponse.parse(await (await list()).json());
    expect(devices.map((d) => d.id)).not.toContain(laptop.id);
  });

  it('revokes an offline device too: its token stops working', async () => {
    const { desk, revoke } = await scene();
    expect((await revoke(desk.id)).status).toBe(204);
    expect(await revokedAt(desk.id)).not.toBeNull();
  });

  it("answers 404 for another person's device, an unknown one and one already revoked, and changes nothing", async () => {
    const { hub, maya, leo, leosLaptop, revoke, sendMeUpdate } = await scene();
    const old = await makeCliToken(maya.id, { revoked: true });
    const before = await revokedAt(old.id);
    for (const id of [leosLaptop.id, 'no-such-device', old.id]) expect((await revoke(id)).status).toBe(404);
    expect(await revokedAt(leosLaptop.id)).toBeNull();
    expect(await revokedAt(old.id)).toEqual(before);
    expect(hub.connectionsFor(leo.id)).toHaveLength(1);
    expect(sendMeUpdate).not.toHaveBeenCalled();
  });

  it("refuses a request from another site's page with a 403, a CLI's token and no sign-in with a 401", async () => {
    const { laptop, cookie, revoke } = await scene();
    expect((await revoke(laptop.id, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await revoke(laptop.id, { authorization: `Bearer ${laptop.raw}`, origin: ORIGIN })).status).toBe(401);
    expect((await revoke(laptop.id, { origin: ORIGIN })).status).toBe(401);
    expect(await revokedAt(laptop.id)).toBeNull();
  });
});
