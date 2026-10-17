import { JobResult, type NewPoint } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { ResultBuffer } from './buffer';

const point: NewPoint = { path: 'src/a.ts', line: 3, side: 'RIGHT', severity: 'minor', category: 'style', title: 'Name', body: 'Rename it.', snippet: null };

describe('ResultBuffer', () => {
  it("turns into a valid JobResult, with the agent's summary when it sent one", () => {
    const buffer = new ResultBuffer();
    expect(buffer.isEmpty()).toBe(true);
    buffer.addPoint(point);
    buffer.finish('One naming nit.');
    expect(buffer.isEmpty()).toBe(false);
    const result = buffer.toJobResult({ from: 'a'.repeat(40), to: 'b'.repeat(40) });
    expect(JobResult.parse(result)).toEqual(result);
    expect(result).toEqual({ summary: 'One naming nit.', points: [point], decisions: [], replies: [], push: { from: 'a'.repeat(40), to: 'b'.repeat(40) }, draft: null });
  });

  it('writes the summary itself when the agent never called finish (spec §11)', () => {
    const review = new ResultBuffer();
    review.addPoint(point);
    review.addPoint(point);
    expect(review.toJobResult(null).summary).toBe('Raised 2 points.');

    const reReview = new ResultBuffer();
    reReview.addPoint(point);
    reReview.decide({ point: 1, decision: 'resolve', comment: '' });
    reReview.decide({ point: 2, decision: 'keep_open', comment: '' });
    expect(reReview.toJobResult(null).summary).toBe('Raised 1 point. Resolved 1, kept 1 open.');

    const address = new ResultBuffer();
    address.reply({ point: 1, resolution: 'fixed', comment: '' });
    address.reply({ point: 2, resolution: 'declined', comment: '' });
    expect(address.toJobResult(null).summary).toBe('Fixed 1, answered 0, declined 1.');

    expect(new ResultBuffer().toJobResult(null).summary).toBe('No findings.');
  });
});
