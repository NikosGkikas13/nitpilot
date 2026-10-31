import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentJobBundle, BundlePoint, JobResult } from '@nitpilot/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { prRepo } from '../../../test/git-fixtures';
import { mcpJob } from '../../../test/mcp-job';
import { tempDir } from '../../../test/temp';
import { jobTools } from '../../mcp/job-tools';
import { startMcpServer } from '../../mcp/server';
import { agentBaseEnv, runAgent } from '../runner';
import { FAKE_SCENARIOS, fakeAdapter } from './adapter';

// The public demo's story (Plan 4 G4): on a seeded buggy branch, the reviewer raises points from simple rules,
// the author fixes two, answers one and declines one, and the re-review keeps the declined one open for a human.

const CART = [
  'export function cartTotal(items) {',
  '  let sum = 0;',
  '  for (let i = 0; i <= items.length; i++) {',
  "    console.log('adding', items[i]);",
  '    sum += items[i].price;',
  '  }',
  '  // TODO: apply discount codes',
  '  return sum;',
  '}',
  '',
].join('\n');

const seededPr = () => prRepo({ head: { 'src/cart.js': CART } });

/** Run the playground scenario on one job of the PR. */
async function runPlayground(pr: ReturnType<typeof prRepo>, bundle: Partial<AgentJobBundle> = {}) {
  const mcp = await startMcpServer();
  onTestFinished(() => mcp.close());
  const ctx = await mcpJob(pr, bundle);
  const job = mcp.registerJob(jobTools(ctx));
  const adapter = fakeAdapter({ scenario: join(FAKE_SCENARIOS, 'playground.json') });
  const mode = ctx.bundle.type === 'address' ? 'editor' : 'reviewer';
  const invocation = adapter.buildInvocation({ mode, cwd: ctx.worktree.dir, prompt: 'Go.', mcp: job, tmpDir: tempDir(), baseEnv: agentBaseEnv(), maxTurns: 10 });
  const run = await runAgent(adapter, invocation, { cwd: ctx.worktree.dir, timeoutMs: 30_000 });
  expect(run.outcome).toEqual({ ok: true });
  return { result: ctx.buffer.toJobResult(null), dir: ctx.worktree.dir };
}

/** The review's points as the next job sees them in get_job. */
function asBundlePoints(result: JobResult, status: BundlePoint['status'] = 'open'): BundlePoint[] {
  return result.points.map((p, i) => ({
    number: i + 1, origin: 'agent', raisedBy: 'leo', path: p.path ?? null, line: p.line ?? null, side: p.side ?? null, severity: p.severity,
    category: p.category, title: p.title, body: p.body, status, authorResolution: null, round: 1, trusted: true, thread: [],
  }));
}

describe('the playground scenario', () => {
  it('reviews by the rules, the author fixes, answers and declines, and the re-review leaves one point for a human', async () => {
    const pr = seededPr();

    const review = (await runPlayground(pr)).result;
    expect(review.points.map((p) => [p.path, p.line, p.category])).toEqual([
      ['src/cart.js', 1, 'tests'],
      ['src/cart.js', 3, 'bug'],
      ['src/cart.js', 4, 'style'],
      ['src/cart.js', 7, 'other'],
    ]);
    expect(review.points[0]!.title).toBe('`cartTotal` has no test');

    const address = await runPlayground(pr, { type: 'address', you: { login: 'maya', githubId: '7', role: 'author' }, points: asBundlePoints(review) });
    expect(address.result.replies.map((r) => [r.point, r.resolution])).toEqual([[1, 'declined'], [2, 'fixed'], [3, 'fixed'], [4, 'answered']]);
    const fixed = readFileSync(join(address.dir, 'src/cart.js'), 'utf8');
    expect(fixed).toContain('for (let i = 0; i < items.length; i++) {');
    expect(fixed).not.toContain('console.log');
    expect(fixed).toContain('// TODO: apply discount codes');

    const addressed = asBundlePoints(review, 'addressed').map((p, i) => ({ ...p, authorResolution: address.result.replies[i]!.resolution }));
    const reReview = (await runPlayground(pr, { type: 're_review', round: 2, points: addressed })).result;
    expect(reReview.decisions.map((d) => [d.point, d.decision])).toEqual([[1, 'keep_open'], [2, 'resolve'], [3, 'resolve'], [4, 'resolve']]);
    expect(reReview.points).toEqual([]);
  }, 30_000);

  it('gives the same review every time for the same diff', async () => {
    const pr = seededPr();
    expect((await runPlayground(pr)).result).toEqual((await runPlayground(pr)).result);
  }, 30_000);

  it('raises at most four points, in diff order', async () => {
    const { points } = (await runPlayground(prRepo({ head: { 'src/cart.js': `${CART}// FIXME: rounding\n` } }))).result;
    expect(points.map((p) => p.line)).toEqual([1, 3, 4, 7]);
  });

  it('raises no test point when the PR adds a test file for it', async () => {
    const pr = prRepo({ head: { 'src/cart.js': CART, 'src/cart.test.js': 'test("cartTotal", () => {});\n' } });
    const { points } = (await runPlayground(pr)).result;
    expect(points.map((p) => p.category)).toEqual(['bug', 'style', 'other']);
  });

  // The playground repo's demo branches (docs/playground/branches, pushed by docs/playground/seed.sh) must tell the whole story.
  const BRANCHES = join(import.meta.dirname, '../../../../../docs/playground/branches');
  it.each(readdirSync(BRANCHES))('raises all four kinds of point on the seeded demo/%s branch', async (branch) => {
    const [file] = readdirSync(join(BRANCHES, branch, 'src'));
    const { points } = (await runPlayground(prRepo({ head: { [`src/${file}`]: readFileSync(join(BRANCHES, branch, 'src', file!), 'utf8') } }))).result;
    expect(points.map((p) => p.category).sort()).toEqual(['bug', 'other', 'style', 'tests']);
  });

  it('finishes with nothing to raise on a clean diff', async () => {
    const { result } = await runPlayground(prRepo());
    expect(result).toMatchObject({ points: [], summary: 'Nothing to raise: the diff looks clean.' });
  });
});
