// Origin check for cookie-authenticated, state-changing requests (Odyhook's src/lib/csrf.ts).
// Browsers send Origin on POSTs; if it isn't ours, the request came from another site.

function refererOrigin(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** True if the request comes from our own pages. */
export function isAllowedOrigin(req: Request, publicUrl: string): boolean {
  const candidate = req.headers.get('origin') ?? refererOrigin(req.headers.get('referer'));
  if (!candidate) return false;
  const allowed = new Set([new URL(publicUrl).origin, new URL(req.url).origin]);
  return allowed.has(candidate);
}

/**
 * The same check for a WebSocket upgrade (spec §10): browsers send the cookie on a socket to any site, and
 * SameSite doesn't stop it, so the Origin header is what tells our pages from another site's
 * (docs/why/web-socket-and-origin.md). Browsers always send Origin on a WebSocket, so none is a no.
 */
export function isAllowedUpgradeOrigin(headers: { origin?: string; host?: string }, publicUrl: string): boolean {
  if (!headers.origin) return false;
  const allowed = new Set([new URL(publicUrl).origin]);
  if (headers.host) allowed.add(`http://${headers.host}`).add(`https://${headers.host}`);
  return allowed.has(headers.origin);
}
