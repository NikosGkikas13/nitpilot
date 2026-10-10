import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { BRAND } from '@nitpilot/protocol';
import { configDir, configPath, loadConfig, loadConfigFile, saveConfig } from '../config/config';
import { CliError } from '../errors';
import { ServerClient } from '../http';
import { terminal, type Out } from '../out';

export type LoginDeps = {
  env?: Record<string, string | undefined>;
  out?: Out;
  /** Opens the approval page. The default asks the OS; the URL is printed either way. */
  open?: (url: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
};

/**
 * `nitpilot login` (spec §10 "CLI login"): get a code, let the person approve it in the browser, keep
 * the token. See docs/why/cli-login.md.
 */
export async function login(deps: LoginDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? terminal;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const dir = configDir(env);
  const { server } = loadConfig({ env, dir });
  const client = new ServerClient(server, null, deps.fetch);

  const start = await client.loginStart(deviceName());
  out.log(`To connect this device, enter ${start.userCode} at ${start.verifyUrl}`);
  await (deps.open ?? openInBrowser)(start.verifyUrl);
  out.log('Waiting for you to approve it in the browser… (Ctrl-C cancels)');

  for (;;) {
    await sleep(start.interval * 1000);
    const poll = await client.loginPoll(start.deviceCode);
    if (poll.status === 'pending') continue;
    if (poll.status === 'denied') throw new CliError('The login was denied in the browser.');
    if (poll.status === 'expired') throw new CliError(`The code expired. Run \`${BRAND.cli} login\` again.`);
    // Keep the rest of the file as it is, and remember which server this token belongs to.
    saveConfig({ ...loadConfigFile(dir), server, token: poll.token }, dir);
    const me = await new ServerClient(server, poll.token, deps.fetch).me();
    out.log(`Logged in as ${me.login}. The token is in ${configPath(dir)}, readable by you only.`);
    return;
  }
}

/** This machine's name, as the server lists it among your devices. */
function deviceName(): string {
  return hostname().replace(/\.local$/, '').slice(0, 100) || 'unknown device';
}

/** Open a URL in the default browser (macOS `open`, Linux `xdg-open`). Never fails: the URL is printed anyway. */
export async function openInBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (!command) return;
  await new Promise<void>((resolve) => execFile(command, [url], () => resolve()));
}
