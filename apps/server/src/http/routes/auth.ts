import { BRAND } from '@nitpilot/protocol';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { authorizeUrl, exchangeCode, fetchGithubUser, pkceChallenge } from '../../auth/github-oauth';
import { cookieOptions, endSession, startSession } from '../../auth/session';
import { saveGithubUser } from '../../auth/users';
import { resumeAfterSignIn } from '../../chats/failed-flags';
import { isAllowedOrigin } from '../../lib/csrf';
import { decrypt, encrypt } from '../../lib/crypto';
import { getEnv } from '../../lib/env';
import { randomSecret } from '../../lib/tokens';
import type { AppDeps } from '../app';
import { HttpError } from '../errors';

const OAuthCookie = z.object({ state: z.string(), verifier: z.string(), next: z.string() });

/**
 * Only same-site paths, so a crafted link can't send people to another site after sign-in.
 * Browsers read `\` as `/` and silently drop tabs and newlines, so `/<tab>/evil.example` would
 * turn into `//evil.example` (another site). Any path with a backslash or a control character is refused.
 */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (/[\p{Cc}\\]/u.test(next)) return '/';
  return next;
}

/**
 * True when a sign-in started on an address other than PUBLIC_URL: another host (www., the bare IP), or the right
 * host over plain http, as the proxy in front reports it with X-Forwarded-Proto. GitHub always sends the person back
 * to PUBLIC_URL, and a cookie set on another address (or a Secure one a browser refused over http) isn't there, so
 * the callback would only say the link expired. Without either header nothing is known, so nothing is redirected.
 */
function cameInElsewhere(c: Context, publicUrl: string): boolean {
  const target = new URL(publicUrl);
  const host = c.req.header('host');
  if (host && host !== target.host) return true;
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  return proto !== undefined && `${proto}:` !== target.protocol;
}

function readOAuthCookie(value: string | undefined): z.infer<typeof OAuthCookie> | null {
  if (!value) return null;
  try {
    return OAuthCookie.parse(JSON.parse(decrypt(value)));
  } catch {
    return null;
  }
}

export function authRoutes(deps: Pick<AppDeps, 'github' | 'dispatch' | 'webSockets'>): Hono {
  const app = new Hono();

  app.get('/auth/github/login', (c) => {
    const env = getEnv();
    const next = safeNext(c.req.query('next'));
    if (cameInElsewhere(c, env.PUBLIC_URL)) return c.redirect(`${env.PUBLIC_URL}/auth/github/login?next=${encodeURIComponent(next)}`);
    const state = randomSecret(16);
    const verifier = randomSecret(32);
    // The state and verifier travel in an encrypted, short-lived cookie: no table needed.
    setCookie(c, BRAND.oauthCookie, encrypt(JSON.stringify({ state, verifier, next })), cookieOptions(600));
    return c.redirect(
      authorizeUrl({
        webBase: deps.github.webBase,
        clientId: env.GITHUB_CLIENT_ID,
        redirectUri: `${env.PUBLIC_URL}/auth/github/callback`,
        state,
        codeChallenge: pkceChallenge(verifier),
      }),
    );
  });

  app.get('/auth/github/callback', async (c) => {
    const env = getEnv();
    const saved = readOAuthCookie(getCookie(c, BRAND.oauthCookie));
    deleteCookie(c, BRAND.oauthCookie, { path: '/' });
    const code = c.req.query('code');
    if (!saved || !code || c.req.query('state') !== saved.state) {
      throw new HttpError('validation_error', 'This sign-in link expired or was changed. Please sign in again.');
    }

    const tokens = await exchangeCode(deps.github, {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      code,
      redirectUri: `${env.PUBLIC_URL}/auth/github/callback`,
      codeVerifier: saved.verifier,
    });
    const ghUser = await fetchGithubUser(deps.github, tokens.accessToken);
    if (env.ALLOWED_LOGINS.length > 0 && !env.ALLOWED_LOGINS.includes(ghUser.login.toLowerCase())) {
      throw new HttpError('forbidden', 'This Nitpilot instance is invite-only for now.');
    }

    const user = await saveGithubUser(ghUser, tokens);
    // Writes in their name work again: chats that waited on one that failed carry on (spec §15).
    // That's a bonus: if it fails, signing in must still work.
    try {
      await resumeAfterSignIn(user, deps.dispatch);
    } catch (err) {
      console.error(`[sign-in] couldn't look for chats to resume for ${user.login}:`, err);
    }
    await startSession(c, user.id);
    // Someone who hasn't finished setting up starts at the checklist, unless the sign-in was for a page of its own
    // (an approval link, a chat).
    return c.redirect(saved.next === '/' && user.onboardedAt === null ? '/setup' : saved.next);
  });

  app.post('/auth/logout', async (c) => {
    if (!isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
    const endedSession = await endSession(c);
    // Sockets open on that session close now, rather than staying signed in until something is sent to them.
    if (endedSession) deps.webSockets?.closeSession(endedSession);
    return c.redirect('/');
  });

  return app;
}
