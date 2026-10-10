import { statSync } from 'node:fs';
import { describe, expect, it, onTestFinished } from 'vitest';
import { recordOut } from '../../test/out';
import { inTurn, startStubServer, type StubReply } from '../../test/stub-server';
import { tempDir } from '../../test/temp';
import { configPath, loadConfigFile, saveConfig } from '../config/config';
import { login } from './login';

const START = { deviceCode: 'device-secret', userCode: 'WDJB-MJHT', verifyUrl: 'http://nitpilot.test/cli/approve?code=WDJB-MJHT', interval: 2, expiresIn: 600 };
const pending: StubReply = { body: { status: 'pending' } };
const approved: StubReply = { body: { status: 'approved', token: 'nit_newtoken' } };
const noBrowser = async () => {};
const noWait = async () => {};

/** A server whose polls answer `polls` in turn, and an empty config folder. */
async function setup(...polls: StubReply[]) {
  const stub = await startStubServer({
    'POST /api/cli/login': { body: START },
    'POST /api/cli/login/poll': inTurn(...polls),
    'GET /api/me': { body: { login: 'maya', avatarUrl: null, githubAuth: 'ok' } },
  });
  onTestFinished(() => stub.close());
  const dir = tempDir();
  return { stub, dir, env: { NITPILOT_CONFIG_DIR: dir, NITPILOT_SERVER: stub.url } };
}

describe('nitpilot login', () => {
  it('shows the code, opens the browser, waits for approval and saves the token', async () => {
    const { stub, dir, env } = await setup(pending, approved);
    const out = recordOut();
    const opened: string[] = [];
    const waits: number[] = [];
    await login({ env, out, open: async (url) => void opened.push(url), sleep: async (ms) => void waits.push(ms) });

    expect(out.lines[0]).toBe('To connect this device, enter WDJB-MJHT at http://nitpilot.test/cli/approve?code=WDJB-MJHT');
    expect(opened).toEqual([START.verifyUrl]);
    expect(waits).toEqual([2_000, 2_000]); // `interval` seconds before each poll
    expect(loadConfigFile(dir)).toMatchObject({ server: stub.url, token: 'nit_newtoken' });
    expect(statSync(configPath(dir)).mode & 0o777).toBe(0o600);
    expect(stub.requests.find((r) => r.path === '/api/me')?.authorization).toBe('Bearer nit_newtoken');
    expect(out.text()).toContain('Logged in as maya.');
  });

  it('keeps the rest of the config file when it saves the token', async () => {
    const { dir, env } = await setup(approved);
    saveConfig({ ...loadConfigFile(dir), repos: { 'acme/shop-api': { path: '/code/shop-api' } } }, dir);
    await login({ env, out: recordOut(), open: noBrowser, sleep: noWait });
    expect(loadConfigFile(dir).repos).toEqual({ 'acme/shop-api': { path: '/code/shop-api' } });
  });

  it('stops with a clear message when the login is denied, and saves nothing', async () => {
    const { dir, env } = await setup(pending, { body: { status: 'denied' } });
    await expect(login({ env, out: recordOut(), open: noBrowser, sleep: noWait })).rejects.toThrow('The login was denied in the browser.');
    expect(loadConfigFile(dir).token).toBeNull();
  });

  it('says to start over when the code expired', async () => {
    const { env } = await setup({ body: { status: 'expired' } });
    await expect(login({ env, out: recordOut(), open: noBrowser, sleep: noWait })).rejects.toThrow('The code expired. Run `nitpilot login` again.');
  });
});
