import { describe, expect, it } from 'vitest';
import { item, point } from '../test/chat';
import { severityCounts, systemGlyph, timelineRows, withCommitHashes } from './timeline';

describe('timelineRows', () => {
  it("puts each point's card where it was raised, with its replies and decisions inside", () => {
    const items = [
      item(1, { body: "Round 1: leo's agent is reviewing" }),
      item(2, { kind: 'job_summary', body: 'Two points.' }),
      item(3, { kind: 'point_raised', pointNumber: 1 }),
      item(4, { kind: 'point_raised', pointNumber: 2 }),
      item(5, { kind: 'human', body: 'Keep the old endpoint' }),
      item(6, { kind: 'point_reply', pointNumber: 1, body: 'Now 25.' }),
      item(7, { kind: 'point_decision', pointNumber: 1, body: 'Fixed.' }),
    ];
    const rows = timelineRows(items, [point(), point({ number: 2 })]);
    expect(rows.map((r) => (r.kind === 'point' ? `P${r.point.number}` : r.kind))).toEqual(['system', 'summary', 'P1', 'P2', 'human']);
    const p1 = rows[2]!;
    expect(p1.kind === 'point' && p1.thread.map((t) => t.seq)).toEqual([6, 7]);
  });

  it('puts a card where its thread starts when the item that raised it is on an older page', () => {
    const rows = timelineRows([item(40, { kind: 'human', body: 'hi' }), item(41, { kind: 'point_reply', pointNumber: 3 })], [point({ number: 3 })]);
    expect(rows.map((r) => r.kind)).toEqual(['human', 'point']);
  });

  it("waits for the card of a point it doesn't know yet instead of showing its item as a person's message", () => {
    // chat.items arrives before chat.state (the server debounces state), so the point isn't in the view yet.
    const items = [item(1, { kind: 'human', body: 'hi' }), item(2, { kind: 'point_raised', pointNumber: 7 }), item(3, { kind: 'point_reply', pointNumber: 7, body: 'Now 25.' })];
    const rows = timelineRows(items, []);
    expect(rows.map((r) => r.kind)).toEqual(['human']);
  });
});

describe('systemGlyph', () => {
  it('reads the glyph off what the engine says', () => {
    expect(systemGlyph('Ready for approval')).toBe('check');
    expect(systemGlyph('Merged')).toBe('check');
    expect(systemGlyph('leo approved on GitHub')).toBe('check');
    expect(systemGlyph('P1 needs a human decision: security points always go to a person')).toBe('diamond');
    expect(systemGlyph("leo's agent is waiting (daily cap) and will try again later")).toBe('ring');
    expect(systemGlyph('Pull request opened by maya')).toBe('dot');
  });
});

describe('severityCounts', () => {
  it('lists the counts from the worst severity down, and nothing for none', () => {
    expect(severityCounts({ counts: { nit: 1, major: 1, minor: 2 } })).toBe('1 major · 2 minor · 1 nit');
    expect(severityCounts({ counts: {} })).toBe('');
    expect(severityCounts(null)).toBe('');
  });
});

describe('withCommitHashes', () => {
  it('marks the commit hashes in a line', () => {
    expect(withCommitHashes("maya's agent pushed a1b2c3d")).toEqual([{ text: "maya's agent pushed ", hash: false }, { text: 'a1b2c3d', hash: true }]);
    expect(withCommitHashes('Ready for approval')).toEqual([{ text: 'Ready for approval', hash: false }]);
  });
});
