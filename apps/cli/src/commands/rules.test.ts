import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { TeamRulesSchema } from '@nitpilot/protocol';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { recordOut } from '../../test/out';
import { tempDir } from '../../test/temp';
import { FAKE_SCENARIOS, fakeAdapter } from '../agents/fake/adapter';
import { runCli } from '../cli';
import { guidelinesYaml, rulesSuggest } from './rules';

/** A fake GitHub with these review comments on acme/shop-api. `asked` collects the URLs it was asked for. */
function github(bodies: string[]) {
  const asked: string[] = [];
  const comments = bodies.map((body, i) => ({
    user: { login: 'maya', type: 'User' },
    path: 'src/orders.ts',
    body,
    html_url: `https://github.com/acme/shop-api/pull/${i}#discussion_r${i}`,
    created_at: '2026-10-01T00:00:00Z',
  }));
  const fetch = (async (url: string) => {
    asked.push(url);
    if (url.startsWith('https://api.github.com/repos/acme/shop-api/pulls/comments?')) return new Response(JSON.stringify(comments));
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const env = () => ({ NITPILOT_CONFIG_DIR: tempDir(), GITHUB_TOKEN: 'tok', PATH: process.env.PATH });
const habits = ['Please add a test for this fix.', 'Can we get a test that covers the empty case?'];

describe('nitpilot rules suggest', () => {
  it("runs your agent on the repo's review comments and prints a guidelines block that parses back", async () => {
    const { fetch } = github(habits);
    const out = recordOut();
    expect(await rulesSuggest('acme/shop-api', { env: env(), fetch, out, adapter: fakeAdapter() })).toBe(0);
    expect(out.text()).toContain('Read 2 review comments from acme/shop-api.');
    const yamlBlock = out.text().slice(out.text().indexOf('guidelines:'));
    expect(yamlBlock).toBe(
      ['guidelines:', '  - Ask for a test with every bug fix.', '  - "Page sizes: use 25, like the other endpoints."', '  - Name the "why" in a comment when code looks odd.'].join('\n'),
    );
    // What you paste is valid .nitpilot.yml.
    expect(TeamRulesSchema.parse(parse(yamlBlock)).guidelines).toHaveLength(3);
  });

  it('uses the GitHub remote of the clone you are in', async () => {
    const clone = tempDir();
    execFileSync('git', ['init', '-q', clone]);
    execFileSync('git', ['-C', clone, 'remote', 'add', 'origin', 'git@github.com:acme/shop-api.git']);
    const { fetch, asked } = github(habits);
    expect(await rulesSuggest(undefined, { env: env(), fetch, out: recordOut(), adapter: fakeAdapter(), cwd: clone })).toBe(0);
    expect(asked[0]).toMatch(/^https:\/\/api\.github\.com\/repos\/acme\/shop-api\/pulls\/comments\?/);
  });

  it('says so, and runs no agent, when there are no comments to learn from', async () => {
    const { fetch } = github([]);
    const out = recordOut();
    const adapter = { ...fakeAdapter(), buildInvocation: () => { throw new Error('should not run'); } };
    expect(await rulesSuggest('acme/shop-api', { env: env(), fetch, out, adapter })).toBe(0);
    expect(out.text()).toContain('Read 0 review comments from acme/shop-api.\nNo review comments written by people to learn from');
  });

  it('says so when the agent proposes nothing', async () => {
    const { fetch } = github(habits);
    const out = recordOut();
    const adapter = fakeAdapter({ scenario: join(FAKE_SCENARIOS, 'silent.json') });
    expect(await rulesSuggest('acme/shop-api', { env: env(), fetch, out, adapter })).toBe(0);
    expect(out.text()).toContain('Your agent found no habit that comes up often enough to suggest.');
    expect(out.text()).not.toContain('guidelines:');
  });

  it("exits 1 when the agent's run fails", async () => {
    const { fetch } = github(habits);
    const out = recordOut();
    const adapter = { ...fakeAdapter(), buildInvocation: () => ({ command: process.execPath, args: ['-e', 'process.exit(3)'], env: {}, files: [] }) };
    expect(await rulesSuggest('acme/shop-api', { env: env(), fetch, out, adapter })).toBe(1);
    expect(out.text()).toContain("Your agent's run failed (crash)");
  });

  it('refuses a bad repo name and a folder that is not a clone', async () => {
    const { fetch } = github(habits);
    await expect(rulesSuggest('acme/../x', { env: env(), fetch, out: recordOut(), adapter: fakeAdapter() })).rejects.toThrow(/isn't a repo name/);
    await expect(rulesSuggest(undefined, { env: env(), fetch, out: recordOut(), adapter: fakeAdapter(), cwd: tempDir() })).rejects.toThrow(/not inside a git clone.*Usage: nitpilot rules suggest/);
  });

  it('explains the usage for a missing or unknown subcommand', async () => {
    for (const args of [['rules'], ['rules', 'list'], ['rules', 'suggest', 'a/b', 'extra'], ['rules', 'suggest', '--json']]) {
      const out = recordOut();
      expect(await runCli(args, out)).toBe(1);
      expect(out.text()).toBe('Usage: nitpilot rules suggest [owner/name]');
    }
  });
});

describe('guidelinesYaml', () => {
  it('quotes what YAML would misread, and never folds a long line', () => {
    const tricky = ['# not a comment', 'yes', '- not a list', `${'long '.repeat(50).trim()}.`];
    const text = guidelinesYaml(tricky);
    expect(text.trimEnd().split('\n')).toHaveLength(5);
    expect(parse(text)).toEqual({ guidelines: tricky });
  });
});
