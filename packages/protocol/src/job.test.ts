import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { JobBundle } from './job-bundle';
import { JobResult, MAX_DRAFT_DIFF_BYTES } from './job-result';
import { jobBundle, jobResult, publishBundle } from './test-samples';

function roundTrip<S extends z.ZodType>(schema: S, value: z.infer<S>) {
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
}

describe('job schemas', () => {
  it('round-trips a job result', () => roundTrip(JobResult, jobResult()));
  it('round-trips a job bundle', () => roundTrip(JobBundle, jobBundle()));
  it('round-trips a publish bundle', () => roundTrip(JobBundle, publishBundle()));

  it('tells the two kinds of bundle apart by type', () => {
    expect(JobBundle.parse(publishBundle()).type).toBe('publish');
    // A publish bundle names the draft it pushes; an agent bundle has no draft but needs its points and rules.
    const noDraft: Partial<ReturnType<typeof publishBundle>> = publishBundle();
    delete noDraft.draft;
    expect(JobBundle.safeParse(noDraft).success).toBe(false);
    expect(JobBundle.safeParse({ ...jobBundle(), type: 'publish' }).success).toBe(false);
  });

  it('round-trips a draft result: the commit kept on the laptop, its files and its diff', () => {
    const r = jobResult();
    r.draft = { sha: 'c'.repeat(40), from: 'a'.repeat(40), files: [{ path: 'src/orders/list.ts', adds: 3, dels: 1 }], diff: 'diff --git a/src/orders/list.ts b/src/orders/list.ts\n' };
    roundTrip(JobResult, r);
    r.draft.diff = null; // over 200 KB: the web app shows the files and `git show`
    roundTrip(JobResult, r);
    expect(MAX_DRAFT_DIFF_BYTES).toBe(200 * 1024);
  });

  it('reads a result saved before drafts existed as one without a draft', () => {
    const old: Partial<ReturnType<typeof jobResult>> = jobResult();
    delete old.draft; // a result saved by Plan 1
    expect(JobResult.parse(old).draft).toBeNull();
  });

  it('caps a review at 20 points', () => {
    const r = jobResult();
    r.points = Array.from({ length: 21 }, () => r.points[0]!);
    expect(JobResult.safeParse(r).success).toBe(false);
  });

  it('caps a point body at 4,000 characters', () => {
    const r = jobResult();
    r.points[0]!.body = 'x'.repeat(4001);
    expect(JobResult.safeParse(r).success).toBe(false);
  });

  it('allows a bundle for a PR whose fork was deleted', () => {
    const b = jobBundle();
    b.git.headRepoPath = null;
    expect(JobBundle.safeParse(b).success).toBe(true);
  });
});
