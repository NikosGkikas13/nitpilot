/** @jsxImportSource hono/jsx */
import { BRAND } from '@nitpilot/protocol';
import type { Context } from 'hono';
import type { PropsWithChildren } from 'hono/jsx';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Plan 1 pages are deliberately plain. The real design arrives with the web app in Plan 2;
// these colors are the "Soft signal" tokens from the design handoff.
const css = `
:root { --bg:#eef2ee; --surface:#fff; --fg1:#16201b; --fg3:#5f6c65; --b1:#dfe6df; --acc:#16707f; --on-acc:#fff; --code:#f7f9f6; --red:#d6453a; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1412; --surface:#18201c; --fg1:#e8efea; --fg3:#93a198; --b1:#2b3630; --acc:#5cc3d1; --on-acc:#06191c; --code:#121815; --red:#ef5e52; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg1); font:16px/1.5 system-ui, sans-serif; padding:16px; }
.card { width:100%; max-width:440px; background:var(--surface); border:1px solid var(--b1); border-radius:24px; padding:28px; }
h1 { font-size:24px; margin:0 0 8px; letter-spacing:-0.02em; }
.muted { color:var(--fg3); font-size:14px; }
.code { font-family:ui-monospace, monospace; font-size:32px; letter-spacing:0.14em; text-align:center; background:var(--code); border-radius:12px; padding:14px; margin:16px 0; }
.row { display:flex; gap:8px; margin-top:16px; }
button, .button { flex:1; height:44px; border-radius:12px; border:1px solid var(--b1); background:var(--surface); color:var(--fg1); font:inherit; cursor:pointer; text-decoration:none; display:inline-grid; place-items:center; }
.primary { background:var(--acc); border-color:var(--acc); color:var(--on-acc); }
code { font-family:ui-monospace, monospace; background:var(--code); border-radius:6px; padding:1px 6px; }
.wide { max-width:760px; }
.warn { color:var(--red); }
.activity { font-weight:600; }
.timeline, .thread { list-style:none; padding:0; display:grid; gap:12px; }
.point { border:1px solid var(--b1); border-radius:16px; padding:16px; }
.point h2 { font-size:18px; margin:4px 0; }
.status { font-weight:600; margin:4px 0; }
.text { white-space:pre-wrap; }
pre { font-family:ui-monospace, monospace; font-size:13px; background:var(--code); border-radius:12px; padding:12px; overflow-x:auto; }
`;

export function Layout(props: PropsWithChildren<{ title: string; wide?: boolean }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · ${BRAND.name}`}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main class={props.wide ? 'card wide' : 'card'}>{props.children}</main>
      </body>
    </html>
  );
}

/**
 * Send a server-rendered page with a doctype. No other site may show it in a frame, where a page could
 * trick someone into clicking Approve (clickjacking).
 */
export function renderPage(c: Context, page: { toString(): string }, status: ContentfulStatusCode = 200): Response {
  c.header('Content-Security-Policy', "frame-ancestors 'none'");
  return c.html(`<!doctype html>${page.toString()}`, status);
}
