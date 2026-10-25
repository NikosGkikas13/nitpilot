import { describe, expect, it } from 'vitest';
import { buildManifest, manifestFormAction } from './manifest';

describe('buildManifest', () => {
  it("describes the app this server needs: its URLs, spec §15's events and permissions", () => {
    expect(buildManifest({ publicUrl: 'https://nitpilot.example.com', name: 'Nitpilot (example)', isPublic: false })).toEqual({
      name: 'Nitpilot (example)',
      url: 'https://nitpilot.example.com',
      description: "Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make.",
      hook_attributes: { url: 'https://nitpilot.example.com/webhooks/github', active: true },
      redirect_url: 'https://nitpilot.example.com/first-run/callback',
      callback_urls: ['https://nitpilot.example.com/auth/github/callback'],
      setup_url: 'https://nitpilot.example.com/github/setup',
      setup_on_update: true,
      public: false,
      request_oauth_on_install: false,
      default_events: ['issue_comment', 'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'repository'],
      default_permissions: { contents: 'read', issues: 'read', metadata: 'read', pull_requests: 'write' },
    });
  });

  it('lets anyone install it when asked (the hosted instance), and drops a trailing slash from PUBLIC_URL', () => {
    const manifest = buildManifest({ publicUrl: 'https://nitpilot.dev/', name: 'nitpilot', isPublic: true });
    expect(manifest.public).toBe(true);
    expect(manifest.url).toBe('https://nitpilot.dev');
    expect(manifest.hook_attributes.url).toBe('https://nitpilot.dev/webhooks/github');
    expect(manifest.redirect_url).toBe('https://nitpilot.dev/first-run/callback');
  });
});

describe('manifestFormAction', () => {
  it("posts to the person's own app settings, or an organization's", () => {
    expect(manifestFormAction({ webBase: 'https://github.com', owner: { kind: 'user' }, state: 'abc_-1' })).toBe(
      'https://github.com/settings/apps/new?state=abc_-1',
    );
    expect(manifestFormAction({ webBase: 'https://github.com', owner: { kind: 'org', login: 'acme-inc' }, state: 'abc_-1' })).toBe(
      'https://github.com/organizations/acme-inc/settings/apps/new?state=abc_-1',
    );
  });

  it('uses the web address it is given, so tests can stand in for github.com', () => {
    expect(manifestFormAction({ webBase: 'http://127.0.0.1:9999', owner: { kind: 'user' }, state: 's' })).toBe('http://127.0.0.1:9999/settings/apps/new?state=s');
  });
});
