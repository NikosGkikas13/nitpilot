import { BRAND } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { authorizeUrl, exchangeCode, fetchGithubUser, pkceChallenge } from '../../auth/github-oauth';
import { cookieOptions, endSession, startSession } from '../../auth/session';
import { saveGithubUser } from '../../auth/users';
import { isAllowedOrigin } from '../../lib/csrf';
import { decrypt, encrypt } from '../../lib/crypto';
import { getEnv } from '../../lib/env';
import { randomSecret } from '../../lib/tokens';
import type { GithubClient } from '../../platform/github/client';
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

function readOAuthCookie(value: string | undefined): z.infer<typeof OAuthCookie> | null {
  if (!value) return null;
  try {
    return OAuthCookie.parse(JSON.parse(decrypt(value)));
  } catch {
    return null;
  }
}

export function authRoutes(deps: { github: GithubClient }): Hono {
  const app = new Hono();

  app.get('/auth/github/login', (c) => {
    const env = getEnv();
    const state = randomSecret(16);
    const verifier = randomSecret(32);
    // The state and verifier travel in an encrypted, short-lived cookie: no table needed.
    setCookie(c, BRAND.oauthCookie, encrypt(JSON.stringify({ state, verifier, next: safeNext(c.req.query('next')) })), cookieOptions(600));
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
    await startSession(c, user.id);
    return c.redirect(saved.next);
  });

  app.post('/auth/logout', async (c) => {
    if (!isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
    await endSession(c);
    return c.redirect('/');
  });

  return app;
}
