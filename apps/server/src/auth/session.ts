import { BRAND } from '@nitpilot/protocol';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { parse } from 'hono/utils/cookie';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { hashToken, randomSecret } from '../lib/tokens';

const SESSION_DAYS = 30;

export type SessionUser = { id: string; githubId: string; login: string; avatarUrl: string | null };

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: getEnv().PUBLIC_URL.startsWith('https://'),
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Sign the browser in: a random token in a cookie, its hash in WebSession. */
export async function startSession(c: Context, userId: string, now = new Date()): Promise<void> {
  const raw = randomSecret();
  await prisma.webSession.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000) } });
  setCookie(c, BRAND.sessionCookie, raw, cookieOptions(SESSION_DAYS * 86_400));
}

export async function currentUser(c: Context, now = new Date()): Promise<SessionUser | null> {
  return sessionUser(getCookie(c, BRAND.sessionCookie), now);
}

/**
 * The same, for a request Hono doesn't handle: a WebSocket upgrade arrives as Node's raw request, with only
 * its `cookie` header (ws/web-hub.ts). The hub also calls it again later, to notice a sign-out.
 */
export async function sessionUserFromCookieHeader(header: string | undefined, now = new Date()): Promise<SessionUser | null> {
  return sessionUser(header ? parse(header, BRAND.sessionCookie)[BRAND.sessionCookie] : undefined, now);
}

async function sessionUser(raw: string | undefined, now: Date): Promise<SessionUser | null> {
  if (!raw) return null;
  const session = await prisma.webSession.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
  if (!session || session.expiresAt <= now) return null;
  const { id, githubId, login, avatarUrl } = session.user;
  return { id, githubId, login, avatarUrl };
}

export async function endSession(c: Context): Promise<void> {
  const raw = getCookie(c, BRAND.sessionCookie);
  if (raw) await prisma.webSession.deleteMany({ where: { tokenHash: hashToken(raw) } });
  deleteCookie(c, BRAND.sessionCookie, { path: '/' });
}
