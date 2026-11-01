import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import { FAKE_SCENARIOS, fakeAdapter } from '../agents/fake/adapter';
import type { Out } from '../out';
import { printReview, review, reviewOptions } from './review';

const EVENT = join(import.meta.dirname, '../github/fixtures/pull_request-event.json');

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
function scene(reviews: (headSha: string) => { body: string | null; commit_id: string }[] = () => []) {
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
  /** Reviews posted to GitHub: their request bodies. */
  const posted: { comments: unknown[]; body: string }[] = [];
  /** Every GitHub address read or written. */
  const urls: string[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.includes('/pulls/142/reviews?')) return new Response(JSON.stringify(reviews(pr.headSha)));
    if (init?.method === 'POST' && url.endsWith('/pulls/142/reviews')) {
      posted.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ html_url: 'https://github.com/acme/shop-api/pull/142#pullrequestreview-9' }));
    }
    if (url.endsWith('/pulls/142')) return new Response(JSON.stringify(pull));
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'leo', id: 1 }));
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { pr, configDir, env, fetch, posted, urls };
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

describe('nitpilot review --post', () => {
  it('asks first, then posts the points as your review', async () => {
    const { env, fetch, posted } = scene();
    const rec = recorder();
    const questions: string[] = [];
    const confirm = async (q: string) => (questions.push(q), true);
    expect(await review('acme/shop-api#142', { env, fetch, out: rec.out, adapter: fakeAdapter(), post: true, confirm })).toBe(0);
    expect(questions).toEqual(['Post 2 points to acme/shop-api#142 as your review (@leo)?']);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.comments).toHaveLength(1); // the page-size point; the README one has no line, so it's in the body
    expect(rec.text()).toContain('Posted your review: https://github.com/acme/shop-api/pull/142#pullrequestreview-9');
  });

  it('posts nothing when you say no', async () => {
    const { env, fetch, posted } = scene();
    const rec = recorder();
    expect(await review('acme/shop-api#142', { env, fetch, out: rec.out, adapter: fakeAdapter(), post: true, confirm: async () => false })).toBe(0);
    expect(posted).toEqual([]);
    expect(rec.text()).toContain('Not posted.');
  });

  it('--yes posts without asking', async () => {
    const { env, fetch, posted } = scene();
    const confirm = async () => {
      throw new Error('should not ask');
    };
    expect(await review('acme/shop-api#142', { env, fetch, out: recorder().out, adapter: fakeAdapter(), post: true, yes: true, confirm })).toBe(0);
    expect(posted).toHaveLength(1);
  });
});

describe('nitpilot review --ci', () => {
  /** A GitHub Actions run: the workflow's event and token, and the team's API key. */
  const ci = (env: Record<string, string>) => ({ ...env, GITHUB_EVENT_PATH: EVENT, ANTHROPIC_API_KEY: 'sk-ant-test' });

  it("reviews the event's PR and posts as the workflow, without asking", async () => {
    const { env, fetch, posted, urls } = scene();
    const rec = recorder();
    const confirm = async () => {
      throw new Error('should not ask');
    };
    expect(await review(undefined, { env: ci(env), fetch, out: rec.out, adapter: fakeAdapter(), ci: true, confirm })).toBe(0);
    expect(rec.text()).toContain('fake is reviewing acme/shop-api#142: Cursor pagination for orders');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toMatch(/^🤖 Review by github-actions\[bot\]'s agent/);
    // A workflow's token can't read GET /user.
    expect(urls.some((u) => u.endsWith('/user'))).toBe(false);
  });

  const DAEMONS = "🤖 Review by maya's agent\n\n<!-- nitpilot:v1 chat=c1 task=t1 -->";
  // The crash scenario exits 1, so a 0 means the agent never ran.
  const notRun = () => fakeAdapter({ scenario: join(FAKE_SCENARIOS, 'crash.json') });

  it('skips a PR Nitpilot already reviewed at its head, without running the agent', async () => {
    const { pr, env, fetch, posted } = scene((head) => [{ body: DAEMONS, commit_id: head }]);
    const rec = recorder();
    expect(await review(undefined, { env: ci(env), fetch, out: rec.out, adapter: notRun(), ci: true })).toBe(0);
    expect(rec.text()).toBe(`Nitpilot already reviewed acme/shop-api#142 at ${pr.headSha.slice(0, 7)}: nothing to do.`);
    expect(posted).toEqual([]);
  });

  it('reviews again when Nitpilot reviewed an older commit, or only a person reviewed this one', async () => {
    const older = scene(() => [{ body: DAEMONS, commit_id: 'a'.repeat(40) }]);
    const person = scene((head) => [{ body: 'Looks fine to me, nice work on the cursor.', commit_id: head }]);
    for (const { env, fetch, posted } of [older, person]) {
      expect(await review(undefined, { env: ci(env), fetch, out: recorder().out, adapter: fakeAdapter(), ci: true })).toBe(0);
      expect(posted).toHaveLength(1);
    }
  });

  it('has nothing to review for an event without an open PR', async () => {
    const dir = tempDir();
    const rec = recorder();
    writeFileSync(join(dir, 'push.json'), JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'acme/shop-api' } }));
    writeFileSync(join(dir, 'closed.json'), JSON.stringify({ ...JSON.parse(readFileSync(EVENT, 'utf8')), action: 'closed' }));
    for (const file of ['push.json', 'closed.json']) {
      expect(await review(undefined, { env: { GITHUB_EVENT_PATH: join(dir, file) }, out: rec.out, ci: true }), file).toBe(0);
    }
    expect(rec.lines).toEqual(Array(2).fill('This GitHub event has no open pull request: nothing to review.'));
  });

  it('says what is missing: the event, the token, the key, an agent that runs on a key', async () => {
    await expect(review(undefined, { env: {}, ci: true })).rejects.toThrow('GITHUB_EVENT_PATH is not set');
    await expect(review(undefined, { env: { GITHUB_EVENT_PATH: '/nope.json' }, ci: true })).rejects.toThrow("Couldn't read the GitHub event at /nope.json");
    await expect(review(undefined, { env: { GITHUB_EVENT_PATH: EVENT }, ci: true })).rejects.toThrow('GITHUB_TOKEN is not set');
    const env = { GITHUB_EVENT_PATH: EVENT, GITHUB_TOKEN: 'tok', NITPILOT_CONFIG_DIR: tempDir() };
    await expect(review(undefined, { env, ci: true })).rejects.toThrow('ANTHROPIC_API_KEY is not set. Add it as a repo secret and pass it to the step. (GitHub gives no secrets to PRs from forks.)');
    await expect(review(undefined, { env: { ...env, NITPILOT_AGENT: 'copilot' }, ci: true })).rejects.toThrow('--ci runs claude-code or gemini-cli');
    await expect(review(undefined, { env: { ...env, NITPILOT_AGENT: 'gemini-cli' }, ci: true })).rejects.toThrow('GEMINI_API_KEY is not set');
  });

  it('takes no PR link', async () => {
    await expect(review('acme/shop-api#142', { env: {}, ci: true })).rejects.toThrow(/Usage/);
  });
});

describe('reviewOptions', () => {
  it('reads the PR and the flags in any order', () => {
    expect(reviewOptions(['acme/api#1'])).toEqual({ ref: 'acme/api#1', post: false, yes: false, ci: false });
    expect(reviewOptions(['--post', 'acme/api#1', '--yes'])).toEqual({ ref: 'acme/api#1', post: true, yes: true, ci: false });
    expect(reviewOptions(['--ci'])).toEqual({ ref: undefined, post: false, yes: false, ci: true });
  });

  it('refuses unknown flags, two PRs, and --yes without --post', () => {
    for (const args of [['acme/api#1', '--force'], ['acme/api#1', 'acme/api#2'], ['acme/api#1', '--yes'], ['--ci', 'acme/api#1'], ['--ci', '--post', '--yes']]) {
      expect(() => reviewOptions(args), args.join(' ')).toThrow(/Usage: nitpilot review <pr-url> \[--post \[--yes\]\]/);
    }
  });
});

describe('printReview', () => {
  it('says so when there is nothing to raise', () => {
    const rec = recorder();
    printReview({ summary: 'Looks good.', points: [], decisions: [], replies: [], push: null, draft: null }, rec.out);
    expect(rec.text()).toBe('\nLooks good.\nNo points: your agent found nothing to raise.');
  });
});
