import { Settings, WebMe } from '@nitpilot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeCliToken, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';
import { listen, TestCli } from '../../../test/ws';
import { prisma } from '../../lib/prisma';
import { CliHub } from '../../ws/cli-hub';

const ORIGIN = 'http://localhost:8787';

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** maya, signed in to the web app with her laptop's CLI connected, and leo's CLI connected too. */
async function scene() {
  const hub = new CliHub();
  const server = await listen(hub);
  servers.push(server);
  const [maya, leo] = [await makeUser({ login: 'maya' }), await makeUser({ login: 'leo' })];
  const laptop = await TestCli.online(server.url, (await makeCliToken(maya.id)).raw);
  const leosCli = await TestCli.online(server.url, (await makeCliToken(leo.id)).raw);
  const app = testApp({ clis: hub });
  const cookie = await sessionCookieFor(maya.id);
  const put = (body: unknown, origin = ORIGIN) =>
    app.request('/api/me/settings', { method: 'PUT', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { maya, laptop, leosCli, app, cookie, put };
}

const savedSettings = async (userId: string) =>
  prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { autoReview: true, autoAddress: true, dailyJobCap: true } });

describe('PUT /api/me/settings', () => {
  it("saves your settings, answers them, and sends them to each of your connected CLIs (not anyone else's)", async () => {
    const { maya, laptop, leosCli, app, cookie, put } = await scene();
    const settings = { autoReview: false, autoAddress: true, dailyJobCap: 25 };
    const res = await put(settings);
    expect(res.status).toBe(200);
    expect(Settings.parse(await res.json())).toEqual(settings);
    expect(await savedSettings(maya.id)).toEqual(settings);
    expect((await laptop.next('settings')).d).toEqual(settings);
    await leosCli.nothing('settings');
    // The web app reads them back from /api/me.
    const me = WebMe.parse(await (await app.request('/api/me', { headers: { cookie } })).json());
    expect(me.settings).toEqual(settings);
  });

  it('takes a daily cap from 5 to 200 and refuses anything else with a 400, saving and sending nothing', async () => {
    const { maya, laptop, put } = await scene();
    for (const dailyJobCap of [4, 201, 12.5]) {
      const res = await put({ autoReview: true, autoAddress: true, dailyJobCap });
      expect(res.status).toBe(400);
    }
    expect((await put({ autoReview: true, dailyJobCap: 40 })).status).toBe(400);
    expect(await savedSettings(maya.id)).toEqual({ autoReview: true, autoAddress: true, dailyJobCap: 40 });
    await laptop.nothing('settings');
    // The refused ones left nothing behind: valid ones after them are saved and sent.
    expect((await put({ autoReview: true, autoAddress: true, dailyJobCap: 5 })).status).toBe(200);
    expect((await laptop.next('settings')).d).toEqual({ autoReview: true, autoAddress: true, dailyJobCap: 5 });
    expect((await put({ autoReview: true, autoAddress: true, dailyJobCap: 200 })).status).toBe(200);
    expect((await laptop.next('settings')).d).toEqual({ autoReview: true, autoAddress: true, dailyJobCap: 200 });
  });

  it('refuses a body that is not JSON with a 400, saving and sending nothing', async () => {
    const { maya, laptop, app, cookie } = await scene();
    const res = await app.request('/api/me/settings', { method: 'PUT', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: '{ not json' });
    expect(res.status).toBe(400);
    expect(await savedSettings(maya.id)).toEqual({ autoReview: true, autoAddress: true, dailyJobCap: 40 });
    await laptop.nothing('settings');
  });

  it("refuses a request from another site's page with a 403, and one without a session with a 401", async () => {
    const { maya, laptop, app, put } = await scene();
    const res = await put({ autoReview: false, autoAddress: false, dailyJobCap: 10 }, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(await savedSettings(maya.id)).toEqual({ autoReview: true, autoAddress: true, dailyJobCap: 40 });
    await laptop.nothing('settings');
    const anonymous = await app.request('/api/me/settings', {
      method: 'PUT',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ autoReview: true, autoAddress: true, dailyJobCap: 40 }),
    });
    expect(anonymous.status).toBe(401);
  });

  it("refuses a CLI's token like no sign-in at all: settings are changed in the web app (spec §10)", async () => {
    const { maya, laptop, app } = await scene();
    const res = await app.request('/api/me/settings', {
      method: 'PUT',
      headers: { authorization: `Bearer ${(await makeCliToken(maya.id)).raw}`, 'content-type': 'application/json' },
      body: JSON.stringify({ autoReview: false, autoAddress: false, dailyJobCap: 10 }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Sign in with GitHub first.');
    expect(await savedSettings(maya.id)).toEqual({ autoReview: true, autoAddress: true, dailyJobCap: 40 });
    await laptop.nothing('settings');
  });
});
