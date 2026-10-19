import { Onboarding } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeCliToken, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';
import { FakePlatform } from '../../platform/fake/fake-platform';

describe('GET /api/onboarding', () => {
  it("answers the signed-in person's setup checklist", async () => {
    const user = await makeUser();
    const platform = new FakePlatform();
    platform.userInstalls.set(user.id, [{ id: '77', accountLogin: 'octo' }]);
    await makeCliToken(user.id);
    const res = await testApp({ platform }).request('/api/onboarding', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(res.status).toBe(200);
    expect(Onboarding.parse(await res.json())).toEqual({
      steps: { appInstalled: true, cliConnected: true, repoLinked: false, agentStarted: false },
      done: false,
      deviceName: 'test laptop',
      appSlug: 'nitpilot-dev',
      publicReposOnly: false,
    });
  });

  it("refuses a CLI's token like no sign-in at all, and no sign-in with a 401", async () => {
    const user = await makeUser();
    const token = await makeCliToken(user.id);
    const app = testApp();
    expect((await app.request('/api/onboarding', { headers: { authorization: `Bearer ${token.raw}` } })).status).toBe(401);
    expect((await app.request('/api/onboarding')).status).toBe(401);
  });
});
