import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

/** apps/web/dist, next to this package. WEB_DIST_DIR overrides it (the Playwright server, a container). */
export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

/** Paths the server answers itself. A miss under them is a JSON 404, never the web app's page. */
const SERVER_PREFIXES = ['/api/', '/auth/', '/github/', '/webhooks/', '/ws/'];
const SERVER_PATHS = new Set(['/api', '/auth', '/github', '/webhooks', '/ws', '/healthz']);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

export const BUILD_HINT = "The web app isn't built. Run `npm run build -w apps/web`, then reload this page.";

/**
 * What the browser may load, for every page and file the web app is served with. `frame-ancestors 'none'`
 * keeps other sites from framing it (spec §10). `'unsafe-inline'` in style-src allows `style="…"` attributes
 * written in HTML or set as an attribute, and <style> elements. React's `style={{…}}` goes through the DOM's
 * style object, which the policy doesn't restrict; it's kept so a library that writes style attributes or
 * <style> tags still works. Scripts stay strict: a script can do far more harm than a style.
 * `formActions`: other origins a form on the page may post to. Only first-run mode passes one, GitHub's, because its
 * page posts the app manifest there as a form (setup/first-run.ts); everywhere else forms post only to this server.
 * See docs/why/content-security-policy.md.
 */
export function contentSecurityPolicy(publicUrl: string, opts: { formActions?: string[] } = {}): string {
  const url = new URL(publicUrl);
  const socket = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
  return [
    "default-src 'self'",
    `connect-src 'self' ${socket}`,
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "base-uri 'self'",
    ["form-action 'self'", ...(opts.formActions ?? [])].join(' '),
    "frame-ancestors 'none'",
  ].join('; ');
}

export function isServerPath(pathname: string): boolean {
  return SERVER_PATHS.has(pathname) || SERVER_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** The file a URL path names inside `root`, or null when there's none (or the path tries to leave `root`). */
async function fileIn(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  if (relative === '') return null;
  const full = path.resolve(root, relative);
  // `..` in any spelling ends up outside root after resolve(): refuse it.
  if (!full.startsWith(root + path.sep)) return null;
  const info = await stat(full).catch(() => null);
  return info?.isFile() ? full : null;
}

/**
 * Serves the built web app (spec §7): its files, and its index.html for every other GET that isn't one of
 * the server's own paths, so a link like /c/octo/sandbox/42 opens the app, which then shows that chat.
 * Mounted after every other route. See docs/why/serving-a-spa.md.
 */
export function spaRoutes(opts: { distDir: string; publicUrl: string; formActions?: string[] }): Hono {
  const app = new Hono();
  const root = path.resolve(opts.distDir);
  const csp = contentSecurityPolicy(opts.publicUrl, { formActions: opts.formActions });

  app.get('*', async (c, next) => {
    if (isServerPath(c.req.path)) return next();
    c.header('Content-Security-Policy', csp);

    const file = await fileIn(root, c.req.path);
    if (file) {
      // Vite puts a content hash in every name under assets/, so those never change; the rest must be re-checked.
      const hashed = file.startsWith(path.join(root, 'assets') + path.sep);
      c.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      c.header('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      return c.body(await readFile(file));
    }

    // A missing build file is not an app URL, and HTML under a .js name breaks in a confusing way: let it 404.
    if (c.req.path.startsWith('/assets/')) return next();

    const index = await readFile(path.join(root, 'index.html')).catch(() => null);
    if (!index) return c.text(BUILD_HINT, 503);
    c.header('Cache-Control', 'no-cache');
    return c.html(index.toString('utf8'));
  });

  return app;
}
