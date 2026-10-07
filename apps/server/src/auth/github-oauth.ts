import { createHash } from 'node:crypto';
import type { GithubClient } from '../platform/github/client';

export type OAuthTokens = { accessToken: string; accessExpiresAt: Date; refreshToken: string; refreshExpiresAt: Date };
type TokenResponse = { access_token: string; expires_in: number; refresh_token: string; refresh_token_expires_in: number };

/** PKCE S256: the challenge sent to GitHub is base64url(sha256(verifier)). See docs/why/oauth-pkce.md. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function authorizeUrl(opts: { webBase: string; clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL('/login/oauth/authorize', opts.webBase);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCode(
  gh: GithubClient,
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string },
  now = new Date(),
): Promise<OAuthTokens> {
  const t = await gh.oauth<TokenResponse>('/login/oauth/access_token', {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  return toTokens(t, now);
}

/** Refresh tokens are single-use: after this call the old one no longer works. */
export async function refreshTokens(
  gh: GithubClient,
  opts: { clientId: string; clientSecret: string; refreshToken: string },
  now = new Date(),
): Promise<OAuthTokens> {
  const t = await gh.oauth<TokenResponse>('/login/oauth/access_token', {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
  });
  return toTokens(t, now);
}

export async function fetchGithubUser(gh: GithubClient, accessToken: string): Promise<{ githubId: string; login: string; avatarUrl: string | null }> {
  const { data } = await gh.api<{ id: number; login: string; avatar_url: string | null }>('GET', '/user', { token: accessToken });
  return { githubId: String(data.id), login: data.login, avatarUrl: data.avatar_url };
}

function toTokens(t: TokenResponse, now: Date): OAuthTokens {
  return {
    accessToken: t.access_token,
    accessExpiresAt: new Date(now.getTime() + t.expires_in * 1000),
    refreshToken: t.refresh_token,
    refreshExpiresAt: new Date(now.getTime() + t.refresh_token_expires_in * 1000),
  };
}
