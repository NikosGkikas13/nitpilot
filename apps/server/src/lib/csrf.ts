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
