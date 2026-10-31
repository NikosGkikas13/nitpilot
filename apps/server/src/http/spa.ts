import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from '@nitpilot/protocol';
import { Hono } from 'hono';
import type { ChatPath } from '../chats/access';
import type { ChatPreview } from '../chats/preview';

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
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
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

/** A chat's address: `/c/:owner/:repo/:number`. */
const CHAT_PAGE = /^\/c\/([^/]+)\/([^/]+)\/([^/]+)\/?$/;

/** Text made safe to put inside an HTML attribute: a PR title is anyone's text and could hold `"><script>`. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/**
 * index.html with `noindex` (chats stay out of search engines) and, for a chat anyone may read, the Open Graph
 * tags a link preview reads (docs/why/link-previews.md). Crawlers don't run JavaScript, so the tags must be in
 * the HTML itself.
 * shortcut: text only, no og:image; generate one per chat if shared links look bare.
 */
export function chatPageHtml(index: string, preview: ChatPreview | null, publicUrl: string): string {
  const tags = ['<meta name="robots" content="noindex">'];
  if (preview) {
    const meta = (attr: string, key: string, value: string) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;
    tags.push(
      meta('property', 'og:title', preview.title),
      meta('property', 'og:description', preview.description),
      meta('property', 'og:url', new URL(preview.path, publicUrl).href),
      meta('property', 'og:site_name', BRAND.name),
      meta('property', 'og:type', 'website'),
      meta('name', 'twitter:card', 'summary'),
    );
  }
  return index.replace('</head>', `${tags.join('\n    ')}\n  </head>`);
}

/**
 * Serves the built web app (spec §7): its files, and its index.html for every other GET that isn't one of
 * the server's own paths, so a link like /c/octo/sandbox/42 opens the app, which then shows that chat.
 * A chat's page (/c/...) also gets `noindex`, and `preview`'s card when that chat is public (chatPageHtml).
 * Mounted after every other route. See docs/why/serving-a-spa.md.
 */
export function spaRoutes(opts: { distDir: string; publicUrl: string; formActions?: string[]; preview?: (path: ChatPath) => Promise<ChatPreview | null> }): Hono {
  const app = new Hono();
  const root = path.resolve(opts.distDir);
  const csp = contentSecurityPolicy(opts.publicUrl, { formActions: opts.formActions });

  // A card is a nice-to-have: GitHub or the database failing must still serve the page, just without one.
  const previewFor = async (path: ChatPath) => {
    if (!opts.preview) return null;
    try {
      return await opts.preview(path);
    } catch (err) {
      console.error('[spa] no preview card:', err instanceof Error ? err.message : err);
      return null;
    }
  };

  app.get('*', async (c, next) => {
    if (isServerPath(c.req.path)) return next();
    c.header('Content-Security-Policy', csp);

    const file = await fileIn(root, c.req.path);
    if (file) {
      // Vite puts a content hash in every name under assets/, so those never change; the rest must be re-checked.
      const hashed = file.startsWith(path.join(root, 'assets') + path.sep);
      c.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      c.header('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      c.header('Accept-Ranges', 'bytes');
      const body = await readFile(file);
      const range = c.req.header('Range');
      if (!range) return c.body(body);
      // Safari asks for a video in pieces and won't play one served whole. One range only: `bytes=start-` or `bytes=start-end`.
      // Anything else (several ranges, a suffix range) gets the whole file, which HTTP allows.
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return c.body(body);
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      if (start > end) {
        c.header('Content-Range', `bytes */${body.length}`);
        return c.body(null, 416);
      }
      c.header('Content-Range', `bytes ${start}-${end}/${body.length}`);
      return c.body(body.subarray(start, end + 1), 206);
    }

    // A missing build file is not an app URL, and HTML under a .js name breaks in a confusing way: let it 404.
    if (c.req.path.startsWith('/assets/')) return next();

    const index = await readFile(path.join(root, 'index.html')).catch(() => null);
    if (!index) return c.text(BUILD_HINT, 503);
    c.header('Cache-Control', 'no-cache');
    const chat = CHAT_PAGE.exec(c.req.path);
    if (!chat) return c.html(index.toString('utf8'));
    c.header('X-Robots-Tag', 'noindex');
    const preview = await previewFor({ owner: chat[1]!, repo: chat[2]!, number: chat[3]! });
    return c.html(chatPageHtml(index.toString('utf8'), preview, opts.publicUrl));
  });

  return app;
}
