import { AgentId, CLOSE_CODES, type AgentMode, type DeviceView, type DevicesResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import { prisma } from '../../lib/prisma';
import { SIGNED_OUT_REASON, usableAgent } from '../../ws/cli-hub';
import type { MeUpdates } from '../../ws/web-wire';
import { HttpError } from '../errors';

/** What the devices routes need from the CLI hub (ws/cli-hub.ts): who is connected now, and a way to hang up on one. */
export type DeviceClis = {
  connectionsFor(userId: string): readonly { tokenId: string; agent: { id: AgentId; version: string | null; modes: readonly AgentMode[] } }[];
  closeToken(tokenId: string, code: number, reason: string): boolean;
};

/**
 * The Settings page's Devices section (spec §10 "Reads" and "Personal", docs/why/revoking-devices.md). A device is a
 * CLI token that `nitpilot login` made. `GET /api/devices` lists yours that aren't revoked; `DELETE /api/devices/:id`
 * revokes one: its token stops working at once, and if its `nitpilot start` is connected, the socket is closed with
 * 4401, so the CLI stops and says to log in again. Only the web app's session cookie may do either (a CLI token is
 * answered as if no one were signed in, like `PUT /api/me/settings`).
 */
export function deviceRoutes(deps: { clis: DeviceClis; meUpdates?: MeUpdates }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/devices', requireUser, async (c) => {
    if (c.get('via') !== 'session') throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    const userId = c.get('user').id;
    const tokens = await prisma.cliToken.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'asc' } });
    const live = new Map(deps.clis.connectionsFor(userId).map((conn) => [conn.tokenId, conn]));
    const devices: DeviceView[] = tokens.map((token) => {
      const conn = live.get(token.id);
      return {
        id: token.id,
        name: token.name,
        lastSeenAt: token.lastSeenAt?.toISOString() ?? null,
        online: conn !== undefined,
        // Online: what it says now. Offline: what it said in its last hello.
        agent: conn ? usableAgent(conn.agent) : rememberedAgent(token.agentId, token.agentVersion),
      };
    });
    const body: DevicesResponse = { devices };
    return c.json(body);
  });

  app.delete('/api/devices/:id', requireUser, requireSameOrigin, async (c) => {
    if (c.get('via') !== 'session') throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    const userId = c.get('user').id;
    const tokenId = c.req.param('id');
    // Only your own, and only once: someone else's device, an unknown id and one already revoked are all the same 404,
    // so this never says whose a device is.
    const { count } = await prisma.cliToken.updateMany({ where: { id: tokenId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw new HttpError('not_found', 'No such device.');
    // A connected CLI would notice on its next message anyway (it pings every 25 s); this tells it now.
    const wasOnline = deps.clis.closeToken(tokenId, CLOSE_CODES.reauth, SIGNED_OUT_REASON);
    // Closing a connected device announces it went away, and that already sends your tabs a me.update (web-wire's
    // presence listener). Only an offline device needs this one, so your tabs get exactly one.
    if (!wasOnline) await deps.meUpdates?.sendMeUpdate(userId);
    return c.body(null, 204);
  });

  return app;
}

/** A remembered agent from the token's row, or null. A value this server no longer knows counts as none. */
function rememberedAgent(agentId: string | null, version: string | null): DeviceView['agent'] {
  const id = AgentId.safeParse(agentId);
  return id.success ? { id: id.data, version } : null;
}
