/** @jsxImportSource hono/jsx */
import { BRAND } from '@nitpilot/protocol';
import type { SessionUser } from '../../auth/session';
import { Layout } from './layout';

/** Plan 1's only "app" page: who you are and the next onboarding steps (spec §16). */
export function HomePage(props: { user: SessionUser | null; appSlug: string }) {
  if (!props.user) {
    return (
      <Layout title="Sign in">
        <h1>{BRAND.name}</h1>
        <p class="muted">Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make.</p>
        <div class="row"><a class="button primary" href="/auth/github/login">Sign in with GitHub →</a></div>
      </Layout>
    );
  }
  return (
    <Layout title="Home">
      <h1>Signed in as @{props.user.login}</h1>
      <ol>
        <li><a href={`https://github.com/apps/${props.appSlug}/installations/new`}>Install the GitHub App</a> on your repos.</li>
        <li>Run <code>npx {BRAND.npmPackage} login</code>.</li>
        <li>In your clone, run <code>{BRAND.cli} repos add</code>.</li>
        <li>Run <code>{BRAND.cli} start</code>.</li>
      </ol>
      <form method="post" action="/auth/logout" class="row"><button type="submit">Sign out</button></form>
    </Layout>
  );
}
