import { describe, expect, it } from 'vitest';
import { Category, FailureReason, Phase, PointStatus, Severity } from './enums';

describe('enums', () => {
  it('use exactly the spec values', () => {
    expect(Severity.options).toEqual(['blocker', 'major', 'minor', 'nit']);
    expect(Category.options).toEqual(['security', 'bug', 'performance', 'design', 'tests', 'style', 'docs', 'other']);
    expect(PointStatus.options).toEqual(['open', 'addressed', 'resolved', 'escalated']);
    expect(Phase.options).toEqual(['idle', 'reviewing', 'addressing', 'ready', 'escalated', 'closed']);
  });

  it('reject unknown values', () => {
    expect(Severity.safeParse('critical').success).toBe(false);
    expect(Phase.safeParse('done').success).toBe(false);
  });

  it('includes the CLI rejection reasons in FailureReason', () => {
    expect(FailureReason.options).toEqual(expect.arrayContaining(['quota', 'daily_cap', 'branch_moved', 'stale_head']));
  });
});
