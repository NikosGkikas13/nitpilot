import { appendFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import { FAKE_SCENARIOS, fakeAdapter } from '../agents/fake/adapter';
import type { Out } from '../out';
import { printReview, review } from './review';

function recorder() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out: Out = { log: (t) => lines.push(t), error: (t) => errors.push(t) };
  return { out, lines, errors, text: () => lines.join('\n') };
}

/**
 * A test PR, a config dir, and a fake GitHub that describes it. The job built from GitHub fetches from
 * https://github.com/acme/shop-api.git; the sandbox's git config sends that to the local test repo instead.
 */
function scene() {
  const pr = prRepo();
  appendFileSync(join(pr.home, '.gitconfig'), `[url "${pr.base}"]\n\tinsteadOf = https://github.com/acme/shop-api.git\n`);
  const configDir = tempDir();
  const env = { ...pr.env, NITPILOT_CONFIG_DIR: configDir, GITHUB_TOKEN: 'tok' };
  const pull = {
    title: 'Cursor pagination for orders',
    body: null,
    html_url: 'https://github.com/acme/shop-api/pull/142',
    user: { login: 'maya' },
    base: { ref: 'main', sha: pr.baseSha },
    head: { ref: 'feature/cursor-pagination', sha: pr.headSha, repo: { full_name: 'acme/shop-api' } },
  };
  const fetch = (async (url: string) => {
    if (url.endsWith('/pulls/142')) return new Response(JSON.stringify(pull));
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'leo', id: 1 }));
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { pr, configDir, env, fetch };
}

describe('nitpilot review', () => {
  it("runs your agent on a PR from an unlinked repo and prints its points", async () => {
    const { env, fetch, configDir } = scene();
    const rec = recorder();
    const code = await review('https://github.com/acme/shop-api/pull/142', { env, fetch, out: rec.out, adapter: fakeAdapter() });
    expect(rec.errors).toEqual([]);
    expect(code).toBe(0);
    expect(rec.text()).toContain('fake is reviewing acme/shop-api#142: Cursor pagination for orders');
    expect(rec.text()).toContain('2 points:');
    expect(rec.text()).toContain('  major · bug  src/orders.ts:1\n  Page size is too big\n    Use 25, like the other endpoints.');
    expect(rec.text()).toContain('  nit · docs  the whole PR');
    // The repo was cached for next time; the review's own checkout is gone.
    expect(existsSync(join(configDir, 'cache', 'acme', 'shop-api', '.git'))).toBe(true);
    expect(readdirSync(join(configDir, 'worktrees', 'acme', 'shop-api'))).toEqual([]);
    // Nothing was saved to config.json: the repo stays unlinked.
    expect(existsSync(join(configDir, 'config.json'))).toBe(false);
  });

  it("uses your linked clone when there is one", async () => {
    const { pr, env, fetch, configDir } = scene();
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ repos: { 'acme/shop-api': { path: pr.clone } } }));
    const rec = recorder();
    expect(await review('acme/shop-api#142', { env, fetch, out: rec.out, adapter: fakeAdapter() })).toBe(0);
    expect(rec.text()).toContain('2 points:');
    expect(existsSync(join(configDir, 'cache'))).toBe(false);
  });

  it('says why when the review fails, and exits 1', async () => {
    const { env, fetch } = scene();
    const rec = recorder();
    const adapter = fakeAdapter({ scenario: join(FAKE_SCENARIOS, 'crash.json') });
    expect(await review('acme/shop-api#142', { env, fetch, out: rec.out, adapter })).toBe(1);
    expect(rec.errors.join('\n')).toMatch(/^The review failed \(crash\)/);
  });

  it('explains the usage for a missing or bad PR link', async () => {
    await expect(review(undefined, { env: {} })).rejects.toThrow(/Usage: nitpilot review <pr-url>/);
    await expect(review('not a pr', { env: {} })).rejects.toThrow(/Usage/);
  });
});

describe('printReview', () => {
  it('says so when there is nothing to raise', () => {
    const rec = recorder();
    printReview({ summary: 'Looks good.', points: [], decisions: [], replies: [], push: null, draft: null }, rec.out);
    expect(rec.text()).toBe('\nLooks good.\nNo points: your agent found nothing to raise.');
  });
});
