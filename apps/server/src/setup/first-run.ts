import { randomBytes } from 'node:crypto';
import { FirstRunManifestRequest, type FirstRunManifestResponse, type FirstRunProblem, type FirstRunStatus } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { errorBody, HttpError } from '../http/errors';
import { clientAddress } from '../lib/client-address';
import { RateLimiter } from '../lib/rate-limit';
import { GithubError, type GithubClient } from '../platform/github/client';
import { githubApp, GithubAppExistsError, saveGithubApp, type GithubAppCredentials } from './credentials';
import { buildManifest, manifestFormAction } from './manifest';
import { setupCodeMatches } from './setup-code';

/** Tries at the setup code per client address per minute: enough for typos, far too few to guess 31⁸ codes. */
const CODE_TRIES_PER_MINUTE = 5;

/** How long a manifest's `state` is good for: GitHub's code in the callback lasts an hour too. */
const STATE_TTL_MS = 60 * 60_000;

/** How long the server waits after answering the callback before it exits, so the browser gets its redirect first. */
export const EXIT_DELAY_MS = 500;

/** The manifest request is a code, a login, a name of at most 34 characters and a boolean: far under 4 KB. */
const MAX_MANIFEST_REQUEST_BYTES = 4 * 1024;

export type FirstRunDeps = {
  github: GithubClient;
  publicUrl: string;
  /** The code printed in the server's log at boot (setup/boot.ts). */
  setupCode: string;
  /** Read the client's address from X-Forwarded-For, for the rate limit (docs/why/trusting-a-proxy.md). */
  trustProxy: boolean;
  /** Stops the server once the app is stored; Docker starts it again, in normal mode (setup/boot.ts). */
  exit: () => void;
  /** The clock, for tests. */
  now?: () => number;
};

/**
 * The `state` values handed out with a manifest, each good for one finished callback within the hour. (A callback that
 * fails on GitHub's side isn't finished: the state stays, with its original expiry, so the page's "Try again" can
 * retry.) In memory: a restart
 * forgets them, which only means starting again at /first-run. Like the `state` of "Sign in with GitHub"
 * (docs/why/oauth-pkce.md), it proves the browser coming back started here, through this server's own form.
 */
class PendingStates {
  private readonly expiresAt = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  issue(): string {
    this.forgetExpired();
    const state = randomBytes(32).toString('base64url');
    this.expiresAt.set(state, this.now() + STATE_TTL_MS);
    return state;
  }

  /** Is this a state we handed out that hasn't expired? Doesn't use it up: that is `forget`. */
  isUsable(state: string): boolean {
    const expiresAt = this.expiresAt.get(state);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  /** Use the state up: it can't start another callback. */
  forget(state: string): void {
    this.expiresAt.delete(state);
  }

  private forgetExpired(): void {
    const now = this.now();
    for (const [state, expiresAt] of this.expiresAt) if (expiresAt <= now) this.expiresAt.delete(state);
  }
}

/**
 * GitHub's answer to `POST /app-manifests/{code}/conversions`: the new app and its secrets. Every field we store must
 * be there; GitHub leaving one out is a failed setup, never an app stored with a blank secret.
 */
const Conversion = z.object({
  id: z.number(),
  slug: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().min(1),
  pem: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

type ConversionResult = { ok: true; creds: GithubAppCredentials; ownerLogin: string } | { ok: false; problem: FirstRunProblem };

/**
 * Trade the code GitHub sent back for the app it just created. No token: the code is the proof, it works once, and only
 * for an hour. GitHub refusing the code (expired, used) is `expired`; GitHub not answering, or answering without every
 * secret, is `github`.
 */
async function convertManifest(github: GithubClient, code: string): Promise<ConversionResult> {
  let data: unknown;
  try {
    ({ data } = await github.api('POST', `/app-manifests/${encodeURIComponent(code)}/conversions`));
  } catch (err) {
    if (err instanceof GithubError && err.status >= 400 && err.status < 500) return { ok: false, problem: 'expired' };
    console.error('[first-run] GitHub manifest conversion failed:', err);
    return { ok: false, problem: 'github' };
  }
  const parsed = Conversion.safeParse(data);
  if (!parsed.success) {
    console.error('[first-run] GitHub answered the manifest conversion without', parsed.error.issues.map((i) => i.path.join('.')).join(', '));
    return { ok: false, problem: 'github' };
  }
  const app = parsed.data;
  return {
    ok: true,
    creds: { appId: String(app.id), slug: app.slug, privateKey: app.pem, clientId: app.client_id, clientSecret: app.client_secret, webhookSecret: app.webhook_secret },
    ownerLogin: app.owner.login,
  };
}

/**
 * The callback is a browser navigation (GitHub sends the person here), so a failure goes back to the page, which says
 * what happened and offers to start again, rather than a JSON error in an empty tab. `extra` adds query parameters:
 * for `github` the page gets the `code` and `state` back, so its "Try again" can open the callback once more.
 */
const backToThePage = (problem: FirstRunProblem, extra: Record<string, string> = {}) => `/first-run?${new URLSearchParams({ error: problem, ...extra })}`;

/**
 * First-run mode's routes (spec §17 "Self-hosting", docs/why/first-run-and-app-manifests.md):
 * 1. `GET /api/first-run`: the page asks which mode the server is in.
 * 2. `POST /api/first-run/manifest`: with the setup code, the page gets a manifest and where to post it.
 * 3. The browser posts it to GitHub; GitHub creates the app and sends the browser to `GET /first-run/callback`.
 * 4. The callback trades GitHub's code for the app's credentials, stores them encrypted, and the server restarts.
 *    If anything goes wrong there, nothing is stored and the browser goes back to /first-run?error=….
 */
export function firstRunRoutes(deps: FirstRunDeps): Hono {
  const now = deps.now ?? (() => Date.now());
  const codeTries = new RateLimiter(CODE_TRIES_PER_MINUTE, 60_000, now);
  const states = new PendingStates(now);
  let exiting = false;
  const app = new Hono();

  app.get('/api/first-run', (c) => {
    const body: FirstRunStatus = { mode: 'first_run', publicUrl: deps.publicUrl };
    return c.json(body);
  });

  app.post(
    '/api/first-run/manifest',
    // Before the handler: anyone can reach this route, and the handler reads the whole body before it checks the code.
    // A refused body never reaches the rate limiter, so it doesn't count as a try at the code.
    bodyLimit({ maxSize: MAX_MANIFEST_REQUEST_BYTES, onError: (c) => c.json(errorBody('payload_too_large', 'request body over 4 KB'), 413) }),
    async (c) => {
      // Counted before the code is looked at, so a wrong guess and a right one cost the same try.
      if (!codeTries.allow(clientAddress(c, deps.trustProxy))) throw new HttpError('rate_limited', 'Too many tries from here. Wait a minute and try again.');
      // The code first, before anything about the body is checked: without it, nothing here answers more than "no".
      const body: unknown = await c.req.json().catch(() => null);
      const code = (body as { code?: unknown } | null)?.code;
      if (typeof code !== 'string' || !setupCodeMatches(code, deps.setupCode)) {
        throw new HttpError('setup_code', "That code doesn't match the one in the server's log.");
      }

      const request = FirstRunManifestRequest.parse(body);
      const answer: FirstRunManifestResponse = {
        action: manifestFormAction({ webBase: deps.github.webBase, owner: request.owner, state: states.issue() }),
        manifest: buildManifest({ publicUrl: deps.publicUrl, name: request.name, isPublic: request.isPublic }),
      };
      return c.json(answer);
    },
  );

  app.get('/first-run/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state || !states.isUsable(state)) return c.redirect(backToThePage('expired'));

    const conversion = await convertManifest(deps.github, code);
    if (!conversion.ok) {
      // GitHub failing on its side (no answer, a 5xx, a half answer) may have created the app already. Keep the state
      // and hand the page the code and state back, so its "Try again" retries instead of making the owner create a
      // second app. Any other outcome ends the link.
      if (conversion.problem === 'github') return c.redirect(backToThePage('github', { code, state }));
      states.forget(state);
      return c.redirect(backToThePage(conversion.problem));
    }
    states.forget(state);
    const { creds, ownerLogin } = conversion;
    try {
      await saveGithubApp(creds, ownerLogin);
    } catch (err) {
      // Two tabs, one finished first: its app stays, and the page asks the person to delete the one GitHub just made.
      if (err instanceof GithubAppExistsError) return c.redirect(backToThePage('exists'));
      throw err;
    }

    console.log(`[first-run] created the GitHub App ${creds.slug} for ${ownerLogin}; restarting in normal mode`);
    // Only one app can be stored, so this runs once; the flag keeps it so even if that rule ever changed.
    if (!exiting) {
      exiting = true;
      setTimeout(deps.exit, EXIT_DELAY_MS);
    }
    return c.redirect('/first-run?done=1');
  });

  return app;
}

/**
 * The same three routes once the server has its app (http/app.ts createApp). The page, polling while the server
 * restarts, learns it's ready and where to install the app. Asking for a manifest is a JSON 404 rather than the web
 * app's page: there is nothing left to set up, and a server with an app never makes a second one. A browser GitHub
 * sends back now (a second tab, finished after the restart) goes to the page, which says the new app is extra.
 */
export function readyRoutes(deps: { github: GithubClient }): Hono {
  const app = new Hono();

  app.get('/api/first-run', (c) => {
    const body: FirstRunStatus = { mode: 'ready', installUrl: `${deps.github.webBase}/apps/${githubApp().slug}/installations/new` };
    return c.json(body);
  });

  const alreadySetUp = errorBody('not_found', 'This server already has its GitHub App.');
  app.post('/api/first-run/manifest', (c) => c.json(alreadySetUp, 404));
  app.get('/first-run/callback', (c) => c.redirect(backToThePage('exists')));

  return app;
}
