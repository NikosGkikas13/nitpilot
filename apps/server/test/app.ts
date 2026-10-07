import { createApp, type AppDeps } from '../src/http/app';
import { createIngest } from '../src/ingest/process';
import { GithubClient } from '../src/platform/github/client';
import { fakeFetch } from './fake-fetch';

/** Everything createApp needs, as harmless fakes. Pass only what a test cares about. */
export function testDeps(over: Partial<AppDeps> = {}): AppDeps {
  return {
    github: new GithubClient(fakeFetch({})),
    ingest: createIngest(async () => ({ status: 'ignored', note: 'test' })),
    ...over,
  };
}

export function testApp(over: Partial<AppDeps> = {}) {
  return createApp(testDeps(over));
}
