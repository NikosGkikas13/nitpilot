/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { decideCliLogin, findCliLogin } from '../../auth/cli-login';
import { currentUser } from '../../auth/session';
import { isAllowedOrigin } from '../../lib/csrf';
import { getEnv } from '../../lib/env';
import { HttpError } from '../errors';
import { ApprovePending, ApproveResult } from '../pages/approve';
import { renderPage } from '../pages/layout';

export function cliApproveRoutes(): Hono {
  const app = new Hono();

  app.get('/cli/approve', async (c) => {
    const user = await currentUser(c);
    if (!user) {
      const here = new URL(c.req.url);
      return c.redirect(`/auth/github/login?next=${encodeURIComponent(here.pathname + here.search)}`);
    }
    const req = await findCliLogin(c.req.query('code') ?? '');
    if (!req) return renderPage(c, <ApproveResult outcome="not_found" />, 404);
    const msLeft = req.expiresAt.getTime() - Date.now();
    if (req.status !== 'pending' || msLeft <= 0) return renderPage(c, <ApproveResult outcome="expired" />);
    return renderPage(c, <ApprovePending userCode={req.userCode} deviceName={req.deviceName} minutesLeft={Math.ceil(msLeft / 60_000)} />);
  });

  app.post('/cli/approve', async (c) => {
    if (!isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
    const user = await currentUser(c);
    if (!user) throw new HttpError('unauthorized', 'Sign in first.');
    const form = await c.req.parseBody();
    const decision = form['decision'] === 'approve' ? 'approve' : 'deny';
    const outcome = await decideCliLogin(String(form['code'] ?? ''), user.id, decision);
    return renderPage(c, <ApproveResult outcome={outcome} />);
  });

  return app;
}
