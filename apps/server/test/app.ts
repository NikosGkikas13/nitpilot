import { RepoAccess } from '../src/auth/repo-access';
import { Dispatcher } from '../src/chats/dispatch';
import { createApp, type AppDeps } from '../src/http/app';
import { createIngest } from '../src/ingest/process';
import { AppAuth } from '../src/platform/github/app-auth';
import { FakePlatform } from '../src/platform/fake/fake-platform';
import { GithubClient } from '../src/platform/github/client';
import { fakeFetch } from './fake-fetch';

/** Everything createApp needs, as harmless fakes. Pass only what a test cares about. */
export function testDeps(over: Partial<AppDeps> = {}): AppDeps {
  const github = over.github ?? new GithubClient(fakeFetch({}));
  return {
    github,
    appAuth: new AppAuth(github, '12345', 'tests-that-need-a-key-pass-their-own'),
    ingest: createIngest(async () => ({ status: 'ignored', note: 'test' })),
    dispatch: new Dispatcher().dispatch,
    // No CLI is connected.
    clis: { connectionsFor: () => [], sendSettings: () => 0 },
    access: over.access ?? new RepoAccess(github),
    platform: new FakePlatform(),
    // No VAPID keys: push is off, as on a server that hasn't set them.
    vapidPublicKey: null,
    // No web app build, whatever is in apps/web/dist: a test that serves the app passes its own folder.
    webDistDir: '/nonexistent/nitpilot-web-dist',
    ...over,
  };
}

export function testApp(over: Partial<AppDeps> = {}) {
  return createApp(testDeps(over));
}
