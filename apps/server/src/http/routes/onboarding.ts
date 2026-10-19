import { Hono } from 'hono';
import { OnboardingFacts } from '../../auth/onboarding';
import { requireUser, type UserVariables } from '../../auth/request-user';
import type { PlatformReads } from '../../platform/types';
import { HttpError } from '../errors';

/**
 * `GET /api/onboarding` (spec §10 "Reads"): the setup checklist's facts (auth/onboarding.ts), for the web app's `/setup`
 * page. A read of its own, not part of `/api/me`, because one fact asks GitHub and `/api/me` is the app's first
 * request. Only the web app's session cookie may ask (a CLI token is answered as if no one were signed in).
 */
export function onboardingRoutes(deps: { platform: PlatformReads }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();
  // One per server, so GitHub's "yes" is kept between reads.
  const facts = new OnboardingFacts(deps.platform);

  app.get('/api/onboarding', requireUser, async (c) => {
    if (c.get('via') !== 'session') throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    return c.json(await facts.read(c.get('user').id));
  });

  return app;
}
