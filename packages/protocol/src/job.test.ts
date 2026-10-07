import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { JobBundle } from './job-bundle';
import { JobResult } from './job-result';
import { jobBundle, jobResult } from './test-samples';

function roundTrip<S extends z.ZodType>(schema: S, value: z.infer<S>) {
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
}

describe('job schemas', () => {
  it('round-trips a job result', () => roundTrip(JobResult, jobResult()));
  it('round-trips a job bundle', () => roundTrip(JobBundle, jobBundle()));

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
