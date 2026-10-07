import { BRAND } from '@nitpilot/protocol';
import { prisma } from '../src/lib/prisma';
import { hashToken, randomSecret } from '../src/lib/tokens';

/** The cookies a response set, as a `cookie` request header. */
export function cookieHeader(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

/** A signed-in browser for `userId`: a real WebSession row and its cookie. */
export async function sessionCookieFor(userId: string): Promise<string> {
  const raw = randomSecret();
  await prisma.webSession.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) } });
  return `${BRAND.sessionCookie}=${raw}`;
}
