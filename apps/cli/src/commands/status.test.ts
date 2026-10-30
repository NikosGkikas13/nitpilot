import type { MyChat } from '@nitpilot/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { recordOut } from '../../test/out';
import { startStubServer } from '../../test/stub-server';
import { tempDir } from '../../test/temp';
import { LINE_CACHE_MS, status, statusOptions } from './status';

const chat = (over: Partial<MyChat> = {}): MyChat => ({
  id: 'chat_1',
  repo: 'acme/shop-api',
  number: 142,
  title: 'Cursor pagination for orders',
  role: 'reviewer',
  phase: 'reviewing',
  round: 1,
  attention: 'none',
  url: 'http://nitpilot.test/c/acme/shop-api/142',
  updatedAt: '2026-10-10T08:00:00.000Z',
  ...over,
});

/** Run `nitpilot status` against a server that answers with this account and these chats. */
async function run(githubAuth: 'ok' | 'needs_reauth', chats: MyChat[], token: string | null = 'nit_abc', prefix = '', format?: 'json' | 'line') {
  const stub = await startStubServer({
    [`GET ${prefix}/api/me`]: { body: { login: 'maya', avatarUrl: null, githubAuth } },
    [`GET ${prefix}/api/me/chats`]: { body: { chats } },
  });
  onTestFinished(() => stub.close());
  const out = recordOut();
  const env = { NITPILOT_CONFIG_DIR: tempDir(), NITPILOT_SERVER: stub.url + prefix, ...(token ? { NITPILOT_TOKEN: token } : {}) };
  await status({ env, out, format });
  return { out, stub, env };
}

describe('nitpilot status', () => {
  it('shows who you are and one line per open PR', async () => {
    const { out, stub } = await run('ok', [chat(), chat({ id: 'chat_2', number: 7, role: 'author', phase: 'addressing', round: 2 })]);
    expect(out.lines[0]).toBe(`Logged in as maya on ${stub.url}`);
    expect(out.text()).toMatch(/PR\s+ROLE\s+PHASE\s+ROUND\s+NEEDS YOU\s+TITLE/);
    expect(out.text()).toMatch(/acme\/shop-api#142\s+reviewer\s+reviewing\s+1\s+Cursor pagination for orders/);
    expect(out.text()).toMatch(/acme\/shop-api#7\s+author\s+addressing\s+2/);
  });

  it('warns when GitHub access needs a new sign-in', async () => {
    const { out, stub } = await run('needs_reauth', []);
    expect(out.text()).toContain(`! GitHub access expired. Sign in again at ${stub.url}/`);
  });

  it('keeps the path prefix of the server in the sign-in link', async () => {
    const { out, stub } = await run('needs_reauth', [], 'nit_abc', '/nitpilot');
    expect(out.text()).toContain(`Sign in again at ${stub.url}/nitpilot/`);
  });

  it('suggests `nitpilot retry` for a PR where your agent failed', async () => {
    const { out } = await run('ok', [chat({ attention: 'failed' })]);
    expect(out.text()).toContain('agent failed');
    expect(out.text()).toContain('To run it again: nitpilot retry https://github.com/acme/shop-api/pull/142');
  });

  it('says so when there are no PRs yet', async () => {
    const { out } = await run('ok', []);
    expect(out.text()).toContain('No open PRs with Nitpilot yet.');
  });

  it('asks you to log in first', async () => {
    await expect(run('ok', [], null)).rejects.toThrow('Not logged in');
  });
});

describe('nitpilot status --json', () => {
  it('prints who you are and the chats as JSON', async () => {
    const { out, stub } = await run('ok', [chat()], 'nit_abc', '', 'json');
    expect(JSON.parse(out.text())).toEqual({ login: 'maya', server: stub.url, githubAuth: 'ok', chats: [chat()] });
  });
});

describe('nitpilot status --line', () => {
  it('counts the PRs that need you', async () => {
    const { out } = await run('ok', [chat({ attention: 'drafts' }), chat({ id: 'chat_2' })], 'nit_abc', '', 'line');
    expect(out.lines).toEqual(['Nitpilot: 1 needs you · 2 open']);
  });

  it('says when nothing needs you, and when there is nothing open', async () => {
    expect((await run('ok', [chat()], 'nit_abc', '', 'line')).out.lines).toEqual(['Nitpilot: 1 open, nothing needs you']);
    expect((await run('ok', [], 'nit_abc', '', 'line')).out.lines).toEqual(['Nitpilot: no open PRs']);
  });

  it('never fails: not logged in, or a server that is down, is a line too', async () => {
    expect((await run('ok', [], null, '', 'line')).out.lines).toEqual(['Nitpilot: not logged in']);
    const out = recordOut();
    await status({ env: { NITPILOT_CONFIG_DIR: tempDir(), NITPILOT_SERVER: 'http://127.0.0.1:9', NITPILOT_TOKEN: 'nit_abc' }, out, format: 'line' });
    expect(out.lines).toEqual(["Nitpilot: can't reach the server"]);
  });

  it('notices a login at once: "not logged in" is never cached', async () => {
    const { env } = await run('ok', [chat()], null, '', 'line');
    const out = recordOut();
    await status({ env: { ...env, NITPILOT_TOKEN: 'nit_abc' }, out, format: 'line' });
    expect(out.lines).toEqual(['Nitpilot: 1 open, nothing needs you']);
  });

  it('reuses its last answer for a while instead of asking the server on every redraw', async () => {
    const { env, stub } = await run('ok', [chat({ attention: 'decision' })], 'nit_abc', '', 'line');
    await stub.close();
    const again = (now: number) => {
      const out = recordOut();
      return status({ env, out, format: 'line', now: () => now }).then(() => out.lines);
    };
    expect(await again(Date.now() + 1_000)).toEqual(['Nitpilot: 1 needs you · 1 open']);
    expect(await again(Date.now() + LINE_CACHE_MS + 1_000)).toEqual(["Nitpilot: can't reach the server"]);
  });
});

describe('statusOptions', () => {
  it('takes at most one of --json and --line', () => {
    expect(statusOptions([])).toEqual({ format: 'table' });
    expect(statusOptions(['--line'])).toEqual({ format: 'line' });
    expect(() => statusOptions(['--json', '--line'])).toThrow('Usage: nitpilot status [--json|--line]');
  });
});
