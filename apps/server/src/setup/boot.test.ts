import { describe, expect, it, vi } from 'vitest';
import { fakeFetch } from '../../test/fake-fetch';
import { getEnv } from '../lib/env';
import { GithubClient } from '../platform/github/client';
import { startFirstRun } from './boot';

function start() {
  const lines: string[] = [];
  const exit = vi.fn();
  const { app } = startFirstRun({ env: getEnv(), github: new GithubClient(fakeFetch({})), exit, log: (line) => lines.push(line) });
  return { app, lines, exit };
}

describe('startFirstRun', () => {
  it('prints where to go and a fresh setup code in the log', () => {
    const { lines } = start();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[first-run\] Open http:\/\/localhost:8787\/first-run and enter the setup code: [A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(start().lines[0]).not.toBe(lines[0]);
  });

  it('serves the first-run app, which takes the code it printed', async () => {
    const { app, lines } = start();
    const code = lines[0]!.split(': ')[1];
    const res = await app.request('/api/first-run/manifest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, owner: { kind: 'user' }, name: 'Nitpilot', isPublic: false }),
    });
    expect(res.status).toBe(200);
    expect((await app.request('/api/me')).status).toBe(503);
  });
});
