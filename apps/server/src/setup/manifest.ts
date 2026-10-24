/**
 * A GitHub App manifest: the description of an app that GitHub creates for us in one click (first-run mode, spec §17
 * "Self-hosting"). The first-run page posts it to GitHub as a form; GitHub shows the person a "Create GitHub App" page
 * filled in from it. Pure: no database, no network. See docs/why/first-run-and-app-manifests.md.
 *
 * GitHub's field names are snake_case, so these are too.
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */
export type AppManifest = {
  name: string;
  url: string;
  description: string;
  hook_attributes: { url: string; active: boolean };
  /** Where GitHub sends the browser back, with `?code=…&state=…`, once the app exists. */
  redirect_url: string;
  /** Where GitHub sends people back after "Sign in with GitHub" (auth/github-oauth.ts). */
  callback_urls: string[];
  /** Where GitHub sends people after they install the app (http/routes/setup.ts). */
  setup_url: string;
  setup_on_update: boolean;
  public: boolean;
  request_oauth_on_install: boolean;
  default_events: string[];
  default_permissions: Record<string, 'read' | 'write'>;
};

/** Spec §1's pitch, which GitHub shows on the app's page. */
const DESCRIPTION = "Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make.";

/**
 * The webhooks the server subscribes to (spec §15), the same list as the dev app `nitpilot-dev`. `installation` and
 * `installation_repositories` aren't listed: GitHub sends those to every app on its own.
 */
const EVENTS = ['issue_comment', 'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'repository'];

/** What the app may do on an installed repo (spec §15): write only pull requests (the summary comment, reviews). */
const PERMISSIONS = { contents: 'read', issues: 'read', metadata: 'read', pull_requests: 'write' } as const;

/**
 * The manifest for this server's app. Every URL in it is built from PUBLIC_URL, so the app GitHub creates sends its
 * webhooks, sign-ins and installs to this server. `isPublic`: false lets only the account or organization that owns
 * the app install it (a team's own server); true lets anyone (the hosted instance).
 */
export function buildManifest(opts: { publicUrl: string; name: string; isPublic: boolean }): AppManifest {
  const base = opts.publicUrl.replace(/\/+$/, '');
  return {
    name: opts.name,
    url: base,
    description: DESCRIPTION,
    hook_attributes: { url: `${base}/webhooks/github`, active: true },
    redirect_url: `${base}/first-run/callback`,
    callback_urls: [`${base}/auth/github/callback`],
    setup_url: `${base}/github/setup`,
    // Also send people to setup_url when they change which repos the app can see, so the repo list updates at once.
    setup_on_update: true,
    public: opts.isPublic,
    // Signing in is its own step (the web app's "Sign in"); installing shouldn't also ask for it.
    request_oauth_on_install: false,
    default_events: [...EVENTS],
    default_permissions: { ...PERMISSIONS },
  };
}

/** Whose app it becomes: the person's own account, or an organization they administer. */
export type ManifestOwner = { kind: 'user' } | { kind: 'org'; login: string };

/**
 * Where the first-run page posts the manifest. `state` comes back unchanged on the redirect, which is how the callback
 * knows the round trip started here (setup/first-run.ts). `webBase` is `GithubClient.webBase`, so tests can point it
 * at a stand-in for github.com.
 */
export function manifestFormAction(opts: { webBase: string; owner: ManifestOwner; state: string }): string {
  const path = opts.owner.kind === 'org' ? `/organizations/${encodeURIComponent(opts.owner.login)}/settings/apps/new` : '/settings/apps/new';
  return `${opts.webBase}${path}?state=${encodeURIComponent(opts.state)}`;
}
