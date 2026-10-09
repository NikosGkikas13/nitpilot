import { BRAND } from '@nitpilot/protocol';
import { createMiddleware } from 'hono/factory';
import { prisma } from '../lib/prisma';
import { hashToken, parseBearer } from '../lib/tokens';
import { HttpError } from '../http/errors';

export type CliAuth = { userId: string; tokenId: string };

/** Resolve `Authorization: Bearer nit_…` to its owner, or null (Odyhook's authenticateApiToken). */
export async function authenticateCliToken(header: string | null | undefined, now = new Date()): Promise<CliAuth | null> {
  const raw = parseBearer(header);
  if (!raw || !raw.startsWith(BRAND.tokenPrefix)) return null;
  const token = await prisma.cliToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!token || token.revokedAt) return null;
  // lastSeenAt drives "offline since…" (spec §8).
  await prisma.cliToken.update({ where: { id: token.id }, data: { lastSeenAt: now } });
  return { userId: token.userId, tokenId: token.id };
}

/**
 * A connected CLI sent a message: note that it's alive. Returns false when its token was revoked
 * in the meantime, so the hub can close the socket with 4401 (spec §10).
 */
export async function touchCliToken(tokenId: string, now = new Date()): Promise<boolean> {
  const { count } = await prisma.cliToken.updateMany({ where: { id: tokenId, revokedAt: null }, data: { lastSeenAt: now } });
  return count === 1;
}

export const requireCliToken = createMiddleware<{ Variables: { cli: CliAuth } }>(async (c, next) => {
  const auth = await authenticateCliToken(c.req.header('authorization'));
  if (!auth) throw new HttpError('unauthorized', `Missing or invalid CLI token. Run \`${BRAND.cli} login\`.`);
  c.set('cli', auth);
  await next();
});
