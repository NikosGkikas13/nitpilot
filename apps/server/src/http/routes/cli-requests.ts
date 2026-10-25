import { CliRequestDecision, type CliRequestView } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { decideCliLogin, findCliLogin } from '../../auth/cli-login';
import { requireSameOrigin, requireSession, requireUser, type UserVariables } from '../../auth/request-user';
import type { CliLoginRequest } from '../../generated/prisma/client';
import { HttpError } from '../errors';

/**
 * The web app's approve page (`/cli/approve?code=…`, handoff §6, docs/why/cli-login.md). `nitpilot login` printed a
 * short code and opened that page; it reads the login with `GET /api/cli/requests/:userCode` and sends Approve or Deny
 * with `POST`. Only the web app's session cookie may do either: a CLI token is answered as if no one were signed in
 * (a CLI approving logins would defeat the point of asking a person). The POST also checks the Origin, so another site
 * can't press Approve for you. A code that was already decided answers what happened instead of an error, so a double
 * click or a tab left open just shows the result.
 */
export function cliRequestRoutes(): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/cli/requests/:userCode', requireUser, requireSession, async (c) => {
    const request = await findCliLogin(c.req.param('userCode'));
    if (!request) throw new HttpError('not_found', 'No such code.');
    return c.json(viewOf(request, new Date()));
  });

  app.post('/api/cli/requests/:userCode', requireUser, requireSession, requireSameOrigin, async (c) => {
    const { decision } = CliRequestDecision.parse(await c.req.json());
    const userCode = c.req.param('userCode');
    // decideCliLogin changes only a pending, unexpired login; anything else stays as it was.
    const outcome = await decideCliLogin(userCode, c.get('user').id, decision);
    if (outcome === 'not_found') throw new HttpError('not_found', 'No such code.');
    // Read it again: whatever happened (this decision, an earlier one, the clock), the page shows the row as it is now.
    const request = await findCliLogin(userCode);
    if (!request) throw new HttpError('not_found', 'No such code.');
    return c.json(viewOf(request, new Date()));
  });

  return app;
}

/**
 * A login row as the page sees it. The page has no word for `consumed` (approved, and the CLI has collected its
 * token): that's still approved. A pending row whose 10 minutes ran out is expired, even before a poll marks it so.
 */
function viewOf(request: CliLoginRequest, now: Date): CliRequestView {
  return {
    userCode: request.userCode,
    deviceName: request.deviceName,
    requestedAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    status: statusOf(request, now),
  };
}

function statusOf(request: CliLoginRequest, now: Date): CliRequestView['status'] {
  switch (request.status) {
    case 'pending':
      return request.expiresAt <= now ? 'expired' : 'pending';
    case 'approved':
    case 'consumed':
      return 'approved';
    case 'denied':
      return 'denied';
    default:
      return 'expired';
  }
}
